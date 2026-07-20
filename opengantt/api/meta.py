"""Listing/metadata APIs for the landing page."""
import frappe

from opengantt.api import _is_manager


@frappe.whitelist()
def list_gantts():
    """List the session user's gantts (System Manager sees all)."""
    filters = {} if _is_manager() else {"owner": frappe.session.user}
    gantts = frappe.get_all(
        "OG Gantt",
        filters=filters,
        fields=["name", "modified", "source_file", "template", "active_style"],
        order_by="modified desc",
        limit_page_length=0,
    )
    out = []
    for g in gantts:
        task_count = frappe.db.count("OG Task", {"gantt": g.name, "kind": "leaf"})
        shares = frappe.get_all(
            "OG Share", filters={"gantt": g.name, "published": 1},
            fields=["public_slug", "expires_on"],
        )
        out.append({
            "name": g.name,
            "title": g.name,
            "task_count": task_count,
            "modified": str(g.modified),
            "has_source": bool(g.source_file),
            "shares": shares,
        })
    return {"gantts": out}
