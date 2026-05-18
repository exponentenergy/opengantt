import frappe


def has_app_permission():
    if frappe.session.user == "Administrator":
        return True

    return "OpenGantt User" in frappe.get_roles()
