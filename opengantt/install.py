import frappe

def after_install():
    if not frappe.db.exists("Role", "OpenGantt User"):
        frappe.get_doc({"doctype": "Role", "role_name": "OpenGantt User", "desk_access": 0}).insert(ignore_permissions=True)
