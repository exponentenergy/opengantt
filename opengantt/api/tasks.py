"""Gantt data read + task edit APIs."""
import json

import frappe
from frappe.utils import cint, getdate

from opengantt.api import _assert_owner, _json_field, _parse_json

_DATE_FIELDS = ("start_date", "end_date", "actual_start", "actual_end")
_PATCHABLE = ("task_name", "start_date", "end_date", "actual_start",
              "actual_end", "progress", "fields")


@frappe.whitelist()
def get_gantt_data(gantt):
    """Full gantt object + tasks, ownership-checked."""
    _assert_owner("OG Gantt", gantt)
    doc = frappe.get_doc("OG Gantt", gantt)
    shares = frappe.get_all(
        "OG Share", filters={"gantt": gantt},
        fields=["public_slug", "published", "expires_on", "route"],
    )
    tasks = frappe.get_all(
        "OG Task",
        filters={"gantt": gantt},
        fields=[
            "name", "task_name", "kind", "parent_task", "start_date",
            "end_date", "actual_start", "actual_end", "sort_order",
            "progress", "fields",
        ],
        order_by="sort_order asc, creation asc",
        limit_page_length=0,
        ignore_permissions=True,  # ownership asserted above; tasks share the gantt's owner
    )
    for t in tasks:
        t["fields"] = _json_field(t.get("fields"), {})
        for f in _DATE_FIELDS:
            if t.get(f):
                t[f] = str(t[f])

    return {
        "gantt": {
            "name": doc.name,
            "title": doc.name,
            "template": doc.template,
            "active_style": doc.active_style,
            "field_map": _json_field(doc.field_map, {}),
            "grouping": _json_field(doc.grouping, []),
            "display_columns": _json_field(doc.display_columns, []),
            "has_source": bool(doc.source_file),
            "parsed_at": str(doc.parsed_at) if doc.parsed_at else None,
            "owner": doc.owner,
            "shares": shares,
        },
        "tasks": tasks,
    }


@frappe.whitelist()
def update_task(name, patch):
    """Patch a task. Whitelisted fields only; dates as YYYY-MM-DD."""
    patch = _parse_json(patch, {}) or {}
    if not isinstance(patch, dict) or not patch:
        frappe.throw("patch must be a non-empty JSON object")

    gantt = frappe.db.get_value("OG Task", name, "gantt")
    if not gantt:
        frappe.throw(f"OG Task {name} not found", frappe.DoesNotExistError)
    _assert_owner("OG Gantt", gantt)

    updates = {}
    for key, value in patch.items():
        if key not in _PATCHABLE:
            frappe.throw(f"Field '{key}' cannot be updated via this API")
        if key in _DATE_FIELDS:
            updates[key] = str(getdate(value)) if value else None
        elif key == "progress":
            updates[key] = max(0, min(100, cint(value))) if value is not None else None
        elif key == "fields":
            fields_val = _parse_json(value, {}) or {}
            if not isinstance(fields_val, dict):
                frappe.throw("fields must be a JSON object")
            updates[key] = json.dumps(fields_val)
        else:  # task_name
            if not str(value or "").strip():
                frappe.throw("task_name cannot be empty")
            updates[key] = str(value).strip()

    frappe.db.set_value("OG Task", name, updates)
    return {"ok": True}


@frappe.whitelist()
def rebucket(gantt, grouping):
    """Regenerate synthetic group rows from existing leaves.

    Leaves are preserved (including side-panel edits); group rows are rebuilt
    and each leaf reparented from values in its fields JSON.
    """
    _assert_owner("OG Gantt", gantt)
    grouping = _parse_json(grouping, None)
    if not isinstance(grouping, list):
        frappe.throw("grouping must be a JSON list")

    leaves = frappe.get_all(
        "OG Task",
        filters={"gantt": gantt, "kind": "leaf"},
        fields=["name", "task_name", "fields"],
        order_by="sort_order asc, creation asc",
        limit_page_length=0,
        ignore_permissions=True,
    )

    frappe.db.sql(
        "UPDATE `tabOG Task` SET parent_task = NULL WHERE gantt = %s", (gantt,)
    )
    frappe.db.delete("OG Task", {"gantt": gantt, "kind": "group"})

    name_column = (_json_field(
        frappe.db.get_value("OG Gantt", gantt, "field_map"), {}
    )).get("task_name") or (_json_field(
        frappe.db.get_value("OG Gantt", gantt, "field_map"), {}
    )).get("name")

    group_cache = {}
    group_sort = 0
    for leaf in leaves:
        fields = _json_field(leaf.fields, {})
        parent_name = None
        path = []
        for col in grouping:
            value = fields.get(col)
            if (value is None or value == "") and name_column == col:
                value = leaf.task_name
            if value is None or value == "":
                continue
            path.append(f"{col}:{value}")
            key = tuple(path)
            if key not in group_cache:
                group_sort += 1
                group_doc = frappe.get_doc({
                    "doctype": "OG Task",
                    "gantt": gantt,
                    "task_name": str(value),
                    "kind": "group",
                    "parent_task": parent_name,
                    "sort_order": group_sort,
                    "fields": json.dumps({col: value}),
                })
                group_doc.insert(ignore_permissions=True)
                group_cache[key] = group_doc.name
            parent_name = group_cache[key]
        frappe.db.set_value(
            "OG Task", leaf.name, "parent_task", parent_name, update_modified=False
        )

    frappe.db.set_value("OG Gantt", gantt, "grouping", json.dumps(grouping))
    return {"ok": True, "leaf_count": len(leaves), "group_count": len(group_cache)}
