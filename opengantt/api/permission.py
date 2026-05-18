import frappe


def has_app_permission(user=None):
    if not user:
        user = frappe.session.user
    if user == "Guest":
        return False
    return True
