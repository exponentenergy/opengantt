import frappe


def get_context(context):
    if frappe.session.user == "Guest":
        frappe.local.flags.redirect_location = "/login"
        raise frappe.Redirect
    context.no_cache = 1
    context.csrf_token = frappe.sessions.get_csrf_token()
    context.user = frappe.session.user
