"""Smart Import flow: analyze an uploaded spreadsheet, create/reimport gantts."""
import json
from datetime import date, datetime

import frappe
from frappe.utils import cint

from opengantt.api import _assert_owner, _is_manager, _json_field, _parse_json
from opengantt.core import parser as core_parser

PREVIEW_ROWS = 30


def _resolve_file(file_url: str):
    """Resolve a private upload by file_url with an ownership check."""
    if not file_url:
        frappe.throw("file_url is required")
    file_name = frappe.db.get_value("File", {"file_url": file_url}, "name")
    if not file_name:
        frappe.throw("Uploaded file not found", frappe.DoesNotExistError)
    file_doc = frappe.get_doc("File", file_name)
    if file_doc.owner != frappe.session.user and not _is_manager():
        frappe.throw("You do not own this upload", frappe.PermissionError)
    return file_doc


def _jsonable(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()[:10]
    return v


@frappe.whitelist()
def analyze_upload(file_url):
    """Parse an uploaded file and auto-detect column roles.

    Returns {headers, preview_rows, detected: {field_map, grouping,
    date_format, confidence}, matched_template}.
    """
    file_doc = _resolve_file(file_url)
    path = file_doc.get_full_path()

    raw = core_parser.read_matrix(path)
    matrix_info = core_parser.detect_matrix(raw)
    if matrix_info:
        return _analyze_matrix(raw, matrix_info)

    parsed = core_parser.parse_file(path)
    headers, rows = parsed["headers"], parsed["rows"]
    if not headers:
        frappe.throw("Could not find a header row in this file")

    detected = core_parser.detect_roles(headers, rows)
    fingerprint = detected["fingerprint"]

    matched_template = None
    tmpl = frappe.get_all(
        "OG Template",
        filters={"header_fingerprint": fingerprint, "owner": frappe.session.user},
        fields=["name", "field_map", "grouping", "display_columns"],
        limit=1,
    )
    if tmpl:
        t = tmpl[0]
        matched_template = {
            "name": t.name,
            "field_map": _json_field(t.field_map, {}),
            "grouping": _json_field(t.grouping, []),
            "display_columns": _json_field(t.display_columns, []),
        }

    preview = [
        [_jsonable(r.get(h)) for h in headers] for r in rows[:PREVIEW_ROWS]
    ]
    return {
        "headers": headers,
        "preview_rows": preview,
        "row_count": len(rows),
        "detected": {
            "mode": "table",
            "field_map": detected["field_map"],
            "grouping": detected["grouping"],
            "date_format": detected["date_format"],
            "confidence": detected["confidence"],
        },
        "matched_template": matched_template,
    }


def _analyze_matrix(raw: list[list], info: dict) -> dict:
    """analyze_upload response for a detected timeline matrix."""
    summary = core_parser.matrix_summary(raw, info)
    header_row = raw[info["header_row"]]
    headers = [str(c).strip() if c is not None else "" for c in header_row]
    preview = [
        [_jsonable(c) if c not in (None, "") else None for c in row]
        for row in raw[info["header_row"] :][: PREVIEW_ROWS + 1]
    ]
    return {
        "headers": headers,
        "preview_rows": preview,
        "row_count": summary["modules_count"],
        "detected": {
            "mode": "matrix",
            "field_map": {},
            "grouping": [],
            "date_format": "month-matrix",
            "confidence": 1.0,
            "modules_count": summary["modules_count"],
            "months_range": summary["months_range"],
            "phases": summary["phases"],
        },
        "matrix_preview": summary["matrix_preview"],
        "matched_template": None,
    }


def bulk_insert_tasks(gantt_name: str, tasks: list[dict]) -> int:
    """Two-pass insert of OG Task rows (replaces any existing tasks).

    Caller must have asserted ownership of the gantt first. Role perms cover
    OG Task creation; ignore_permissions on the insert is acceptable here.
    """
    frappe.db.sql(
        "UPDATE `tabOG Task` SET parent_task = NULL WHERE gantt = %s", (gantt_name,)
    )
    frappe.db.delete("OG Task", {"gantt": gantt_name})

    temp_map = {}
    for t in tasks:
        fields_val = t.get("fields")
        if isinstance(fields_val, dict):
            fields_val = json.dumps(fields_val)
        doc = frappe.get_doc({
            "doctype": "OG Task",
            "gantt": gantt_name,
            "task_name": t.get("task_name"),
            "kind": t.get("kind", "leaf"),
            "start_date": t.get("start_date") or None,
            "end_date": t.get("end_date") or None,
            "actual_start": t.get("actual_start") or None,
            "actual_end": t.get("actual_end") or None,
            "progress": t.get("progress"),
            "sort_order": t.get("sort_order", 0),
            "fields": fields_val,
        })
        doc.insert(ignore_permissions=True)
        temp_map[t.get("temp_id")] = doc.name

    for t in tasks:
        parent_temp = t.get("parent_temp_id")
        if parent_temp and temp_map.get(parent_temp):
            frappe.db.set_value(
                "OG Task", temp_map[t["temp_id"]], "parent_task",
                temp_map[parent_temp], update_modified=False,
            )
    return len(tasks)


def _unique_gantt_name(title: str) -> str:
    title = (title or "").strip()
    if not title:
        frappe.throw("title is required")
    name, n = title, 1
    while frappe.db.exists("OG Gantt", name):
        n += 1
        name = f"{title}-{n}"
    return name


@frappe.whitelist()
def create_gantt(title, file_url, field_map, grouping=None, display_columns=None,
                 save_template=0, template_name=None, retain_source=1, mode="table"):
    """Create a gantt (and its tasks) from an uploaded file + mapping.

    mode="matrix" routes the file through the timeline-matrix builder and
    stamps field_map={"__mode__": "matrix"} so reimport re-runs the same path.
    """
    field_map = _parse_json(field_map, {}) or {}
    grouping = _parse_json(grouping, []) or []
    display_columns = _parse_json(display_columns, []) or []
    save_template = cint(save_template)
    retain_source = cint(retain_source)
    mode = (mode or "table").strip()
    if mode not in ("table", "matrix"):
        frappe.throw(f"Unknown import mode '{mode}'")

    file_doc = _resolve_file(file_url)
    template = None

    if mode == "matrix":
        raw = core_parser.read_matrix(file_doc.get_full_path())
        info = core_parser.detect_matrix(raw)
        if not info:
            frappe.throw("This file does not look like a timeline matrix")
        tasks = core_parser.build_matrix_tasks(raw, info)
        field_map = {"__mode__": "matrix"}
        grouping = []
        if not display_columns:
            display_columns = ["Phase"]
    else:
        if not field_map.get("task_name") and not field_map.get("name"):
            frappe.throw("field_map must map a task name column")
        parsed = core_parser.parse_file(file_doc.get_full_path())
        tasks = core_parser.build_tasks(parsed["rows"], field_map, grouping)
        if save_template:
            template = _save_template(
                template_name or f"{title} mapping",
                parsed["headers"], field_map, grouping, display_columns,
            )
    if not tasks:
        frappe.throw("No tasks found in the file with this mapping")

    gantt = frappe.get_doc({
        "doctype": "OG Gantt",
        "__newname": _unique_gantt_name(title),
        "template": template,
        "field_map": json.dumps(field_map),
        "grouping": json.dumps(grouping),
        "display_columns": json.dumps(display_columns),
        "parsed_at": frappe.utils.now_datetime(),
    })
    gantt.insert()

    count = bulk_insert_tasks(gantt.name, tasks)

    if retain_source:
        file_doc.attached_to_doctype = "OG Gantt"
        file_doc.attached_to_name = gantt.name
        file_doc.attached_to_field = "source_file"
        file_doc.save(ignore_permissions=True)
        frappe.db.set_value("OG Gantt", gantt.name, "source_file", file_doc.file_url)
    else:
        frappe.delete_doc("File", file_doc.name, ignore_permissions=True)

    return {"gantt": gantt.name, "task_count": count}


def _save_template(name, headers, field_map, grouping, display_columns) -> str:
    name = (name or "").strip() or "Saved mapping"
    base, n = name, 1
    while frappe.db.exists("OG Template", name):
        n += 1
        name = f"{base}-{n}"
    doc = frappe.get_doc({
        "doctype": "OG Template",
        "__newname": name,
        "description": "Saved from Smart Import",
        "field_map": json.dumps(field_map),
        "grouping": json.dumps(grouping),
        "display_columns": json.dumps(display_columns),
        "header_fingerprint": core_parser.header_fingerprint(headers),
    })
    doc.insert()
    return doc.name


@frappe.whitelist()
def reimport(gantt):
    """Re-parse the retained source file against the gantt's stamped schema."""
    _assert_owner("OG Gantt", gantt)
    doc = frappe.get_doc("OG Gantt", gantt)
    if not doc.source_file:
        frappe.throw(
            "This gantt has no retained source file (it was purged or never kept). "
            "Re-upload via the import wizard instead."
        )
    field_map = _json_field(doc.field_map, {})
    grouping = _json_field(doc.grouping, [])
    if not field_map:
        frappe.throw("This gantt has no stamped field map; cannot re-import.")

    file_name = frappe.db.get_value("File", {"file_url": doc.source_file}, "name")
    if not file_name:
        frappe.throw("Source file record is missing; cannot re-import.")
    file_doc = frappe.get_doc("File", file_name)

    if field_map.get("__mode__") == "matrix":
        raw = core_parser.read_matrix(file_doc.get_full_path())
        info = core_parser.detect_matrix(raw)
        if not info:
            frappe.throw("The source file no longer looks like a timeline matrix")
        tasks = core_parser.build_matrix_tasks(raw, info)
    else:
        parsed = core_parser.parse_file(file_doc.get_full_path())
        tasks = core_parser.build_tasks(parsed["rows"], field_map, grouping)
    count = bulk_insert_tasks(gantt, tasks)
    frappe.db.set_value("OG Gantt", gantt, "parsed_at", frappe.utils.now_datetime())
    return {"ok": True, "count": count}
