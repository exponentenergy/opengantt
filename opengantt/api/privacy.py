"""Data lifecycle: purge source files, gantts and templates."""
import frappe
from frappe.website.utils import clear_cache

from opengantt.api import _assert_owner


def _delete_source_files(gantt_name: str, file_url: str | None):
    """Delete File docs backing a gantt's source (on_trash removes disk file)."""
    names = set()
    if file_url:
        names.update(
            f.name for f in frappe.get_all("File", filters={"file_url": file_url})
        )
    names.update(
        f.name for f in frappe.get_all(
            "File",
            filters={"attached_to_doctype": "OG Gantt", "attached_to_name": gantt_name},
        )
    )
    for name in names:
        frappe.delete_doc("File", name, ignore_permissions=True, force=True)


@frappe.whitelist()
def purge_source(gantt):
    """Delete the retained source file (doc + disk) for a gantt."""
    _assert_owner("OG Gantt", gantt)
    file_url = frappe.db.get_value("OG Gantt", gantt, "source_file")
    _delete_source_files(gantt, file_url)
    frappe.db.set_value("OG Gantt", gantt, "source_file", None)
    return {"ok": True}


@frappe.whitelist()
def purge_gantt(name):
    """Delete a gantt with everything it owns: tasks, shares, source file."""
    _assert_owner("OG Gantt", name)

    # Clear share routes from website cache before removing them
    for share in frappe.get_all("OG Share", filters={"gantt": name}, fields=["route"]):
        if share.route:
            clear_cache(share.route)

    frappe.db.sql(
        "UPDATE `tabOG Task` SET parent_task = NULL WHERE gantt = %s", (name,)
    )
    frappe.db.delete("OG Task", {"gantt": name})
    frappe.db.delete("OG Share", {"gantt": name})

    file_url = frappe.db.get_value("OG Gantt", name, "source_file")
    _delete_source_files(name, file_url)

    frappe.db.set_value("OG Gantt", name, {"active_style": None, "source_file": None})
    frappe.delete_doc(
        "OG Gantt", name, ignore_permissions=True, force=True, delete_permanently=True
    )
    return {"ok": True}


@frappe.whitelist()
def purge_template(name):
    """Delete a template + its styles. Gantts keep their stamped schemas."""
    _assert_owner("OG Template", name)
    gantts = [
        g.name for g in frappe.get_all("OG Gantt", filters={"template": name})
    ]
    for gantt in gantts:
        frappe.db.set_value("OG Gantt", gantt, "template", None, update_modified=False)
    for style in frappe.get_all("OG Style", filters={"template": name}):
        frappe.db.set_value("OG Gantt", {"active_style": style.name}, "active_style", None)
    frappe.db.delete("OG Style", {"template": name})
    frappe.delete_doc(
        "OG Template", name, ignore_permissions=True, force=True,
        delete_permanently=True,
    )
    return {"ok": True, "detached_gantts": len(gantts)}
