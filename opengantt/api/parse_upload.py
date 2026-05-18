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
def parse_upload():
    data = json.loads(frappe.request.data)
    gantt_name = data.get("gantt")
    tasks = data.get("tasks", [])
    if not gantt_name:
        frappe.throw("gantt is required")
    count, _ = bulk_insert_tasks(gantt_name, tasks)
    # Stamp parsed_at server-side (MySQL only accepts 'YYYY-MM-DD HH:MM:SS').
    frappe.db.set_value("OG Gantt", gantt_name, "parsed_at", frappe.utils.now_datetime())
    frappe.db.commit()
    return {"ok": True, "count": count}
