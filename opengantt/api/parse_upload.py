import frappe
import json

@frappe.whitelist()
def parse_upload():
    data = json.loads(frappe.request.data)
    gantt_name = data.get("gantt")
    tasks = data.get("tasks", [])
    if not gantt_name:
        frappe.throw("gantt is required")

    # Remove existing tasks for this gantt
    frappe.db.delete("OG Task", {"gantt": gantt_name})

    temp_map = {}
    # First pass: create all tasks
    for t in tasks:
        doc = frappe.get_doc({
            "doctype": "OG Task",
            "gantt": gantt_name,
            "task_name": t.get("task_name"),
            "kind": t.get("kind", "leaf"),
            "start_date": t.get("start_date"),
            "end_date": t.get("end_date"),
            "actual_start": t.get("actual_start"),
            "actual_end": t.get("actual_end"),
            "sort_order": t.get("sort_order", 0),
            "fields": json.dumps(t.get("fields", {})) if isinstance(t.get("fields"), dict) else t.get("fields"),
        })
        doc.insert(ignore_permissions=True)
        temp_map[t.get("temp_id")] = doc.name

    # Second pass: assign parents
    for t in tasks:
        parent_temp = t.get("parent_temp_id")
        if parent_temp and temp_map.get(parent_temp):
            frappe.db.set_value("OG Task", temp_map[t["temp_id"]], "parent_task", temp_map[parent_temp])

    frappe.db.commit()
    return {"ok": True, "count": len(tasks)}
