"""Ownership-based permission hooks for all OpenGantt doctypes."""
import frappe


def has_app_permission():
    if frappe.session.user == "Administrator":
        return True
    return "OpenGantt User" in frappe.get_roles()


def _is_manager(user=None):
    user = user or frappe.session.user
    return user == "Administrator" or "System Manager" in frappe.get_roles(user)


def permission_query(user=None, doctype=None):
    """permission_query_conditions hook: restrict lists to own docs."""
    user = user or frappe.session.user
    if _is_manager(user):
        return ""
    column = f"`tab{doctype}`.`owner`" if doctype else "`owner`"
    return f"{column} = {frappe.db.escape(user)}"


def has_permission(doc, ptype=None, user=None):
    """has_permission hook (v15 signature): deny access to others' docs."""
    user = user or frappe.session.user
    if _is_manager(user):
        return True
    if doc.get("owner") in (None, "", user):
        return True
    return False
