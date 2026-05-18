import frappe
import json


def bulk_insert_tasks(gantt_name, tasks):
    """Two-pass bulk insert of OG Task records under a Gantt.

    Deletes existing tasks for the gantt, then creates each task with a temp_id->name
    map so parent_task links can be resolved on a second pass.
    Returns (count, temp_map).
    """
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
            "sort_order": t.get("sort_order", 0),
            "fields": fields_val,
        })
        doc.insert(ignore_permissions=True)
        temp_map[t.get("temp_id")] = doc.name

    for t in tasks:
        parent_temp = t.get("parent_temp_id")
        if parent_temp and temp_map.get(parent_temp):
            frappe.db.set_value(
                "OG Task", temp_map[t["temp_id"]], "parent_task", temp_map[parent_temp]
            )

    frappe.db.commit()
    return len(tasks), temp_map


@frappe.whitelist()
def rebucket_gantt():
    """Regenerate persisted synthetic group rows from existing leaves.

    Body: { "gantt": "<gantt name>", "grouping": ["Column", ...] }
    Leaves are preserved, including side-panel edits. Existing group rows are
    replaced and each leaf is reparented based on values in its fields JSON.
    """
    data = json.loads(frappe.request.data or "{}")
    gantt_name = data.get("gantt")
    grouping = data.get("grouping")
    leaf_name_field = data.get("leaf_name_field")
    if not gantt_name:
        frappe.throw("gantt is required")
    if not isinstance(grouping, list):
        frappe.throw("grouping must be a list")

    leaves = frappe.get_all(
        "OG Task",
        filters={"gantt": gantt_name, "kind": "leaf"},
        fields=[
            "name", "gantt", "task_name", "kind", "start_date", "end_date",
            "actual_start", "actual_end", "sort_order", "fields",
        ],
        order_by="sort_order asc, creation asc",
    )

    frappe.db.sql("UPDATE `tabOG Task` SET parent_task = NULL WHERE gantt = %s", (gantt_name,))
    frappe.db.delete("OG Task", {"gantt": gantt_name, "kind": "group"})

    group_cache = {}
    group_sort = 0

    def leaf_fields(task):
        try:
            return json.loads(task.fields or "{}")
        except Exception:
            return {}

    for leaf in leaves:
        fields = leaf_fields(leaf)
        if leaf_name_field and fields.get(leaf_name_field):
            frappe.db.set_value("OG Task", leaf.name, "task_name", str(fields.get(leaf_name_field)))
        parent_name = None
        path = []
        for col in grouping:
            value = fields.get(col)
            if (value is None or value == "") and _gantt_name_column(gantt_name) == col:
                value = leaf.task_name
            if value is None or value == "":
                continue
            path.append(f"{col}:{value}")
            key = tuple(path)
            if key not in group_cache:
                group_sort += 1
                group_doc = frappe.get_doc({
                    "doctype": "OG Task",
                    "gantt": gantt_name,
                    "task_name": str(value),
                    "kind": "group",
                    "parent_task": parent_name,
                    "sort_order": group_sort,
                    "fields": json.dumps({col: value}),
                })
                group_doc.insert(ignore_permissions=True)
                group_cache[key] = group_doc.name
            parent_name = group_cache[key]
        frappe.db.set_value("OG Task", leaf.name, "parent_task", parent_name)

    frappe.db.set_value("OG Gantt", gantt_name, "grouping", json.dumps(grouping))
    if leaf_name_field:
        field_map = _gantt_field_map(gantt_name)
        field_map["name"] = leaf_name_field
        frappe.db.set_value("OG Gantt", gantt_name, "field_map", json.dumps(field_map))
    frappe.db.commit()
    return {"ok": True, "leaf_count": len(leaves), "group_count": len(group_cache)}


def _gantt_field_map(gantt_name):
    raw = frappe.db.get_value("OG Gantt", gantt_name, "field_map")
    try:
        return json.loads(raw or "{}")
    except Exception:
        return {}


def _gantt_name_column(gantt_name):
    return _gantt_field_map(gantt_name).get("name")


@frappe.whitelist()
def parse_upload():
    data = json.loads(frappe.request.data)
    gantt_name = data.get("gantt")
    tasks = data.get("tasks", [])
    if not gantt_name:
        frappe.throw("gantt is required")
    _ensure_gantt_schema_stamped(gantt_name)
    count, _ = bulk_insert_tasks(gantt_name, tasks)
    # Stamp parsed_at server-side (MySQL only accepts 'YYYY-MM-DD HH:MM:SS').
    frappe.db.set_value("OG Gantt", gantt_name, "parsed_at", frappe.utils.now_datetime())
    frappe.db.commit()
    return {"ok": True, "count": count}


def _ensure_gantt_schema_stamped(gantt_name):
    gantt = frappe.get_doc("OG Gantt", gantt_name)
    if gantt.field_map and gantt.grouping and gantt.display_columns:
        return
    if not gantt.template or not frappe.db.exists("OG Template", gantt.template):
        return
    template = frappe.get_doc("OG Template", gantt.template)
    updates = {}
    for field in ("field_map", "grouping", "display_columns"):
        if not getattr(gantt, field, None):
            updates[field] = getattr(template, field, None)
    if updates:
        frappe.db.set_value("OG Gantt", gantt_name, updates, update_modified=False)
