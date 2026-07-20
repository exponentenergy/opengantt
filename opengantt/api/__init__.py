"""OpenGantt API package — shared helpers."""
import json

import frappe


def _is_manager(user=None):
    user = user or frappe.session.user
    return user == "Administrator" or "System Manager" in frappe.get_roles(user)


def _assert_owner(doctype, name):
    """Throw unless the current session user owns the doc (System Manager exempt).

    Returns the doc's owner on success.
    """
    if not name:
        frappe.throw(f"{doctype} name is required")
    owner = frappe.db.get_value(doctype, name, "owner")
    if owner is None:
        frappe.throw(f"{doctype} {name} not found", frappe.DoesNotExistError)
    if owner != frappe.session.user and not _is_manager():
        frappe.throw("You do not own this document", frappe.PermissionError)
    return owner


def _parse_json(value, default=None):
    """Tolerant JSON arg parsing: accepts dict/list already, or JSON string."""
    if value is None or value == "":
        return default
    if isinstance(value, (dict, list)):
        return value
    parsed = frappe.parse_json(value)
    return parsed if parsed is not None else default


def _json_field(raw, default):
    try:
        return json.loads(raw) if raw else default
    except Exception:
        return default
