"""Delete helpers for OG Template and OG Gantt.

Frappe's standard delete refuses to remove a doc that is linked from another
doc (LinkValidationError). For OpenGantt we want the user-facing Delete
button to "do the right thing" — remove the parent and everything that
depends on it.

Deleting a Template only clears the provenance link on Gantts. Gantts own their
stamped schema and remain functional after the source Template is removed.
"""
import frappe


def _delete_tasks_for_gantt(gantt_name):
    # Two passes to clear parent_task self-references before deleting rows
    frappe.db.sql("UPDATE `tabOG Task` SET parent_task = NULL WHERE gantt = %s", (gantt_name,))
    frappe.db.delete("OG Task", {"gantt": gantt_name})


def _delete_shares_for_gantt(gantt_name):
    frappe.db.delete("OG Share", {"gantt": gantt_name})


def _cascade_delete_gantt(gantt_name):
    if not frappe.db.exists("OG Gantt", gantt_name):
        return 0
    _delete_tasks_for_gantt(gantt_name)
    _delete_shares_for_gantt(gantt_name)
    # Detach active_style link before delete so OG Style remove doesn't trip
    frappe.db.set_value("OG Gantt", gantt_name, "active_style", None)
    frappe.delete_doc("OG Gantt", gantt_name, ignore_permissions=True, force=True, delete_permanently=True)
    return 1


@frappe.whitelist()
def delete_gantt(name):
    if not name:
        frappe.throw("name is required")
    _cascade_delete_gantt(name)
    frappe.db.commit()
    return {"ok": True}


@frappe.whitelist()
def delete_template(name):
    if not name:
        frappe.throw("name is required")
    gantts = [g.name for g in frappe.get_all("OG Gantt", filters={"template": name}, fields=["name"])]
    for gantt in gantts:
        frappe.db.set_value("OG Gantt", gantt, "template", None)
    frappe.db.delete("OG Style", {"template": name})
    if frappe.db.exists("OG Template", name):
        frappe.delete_doc("OG Template", name, ignore_permissions=True, force=True, delete_permanently=True)
    frappe.db.commit()
    return {"ok": True, "detached_gantts": len(gantts)}
