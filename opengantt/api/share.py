"""Public share publish/revoke."""
import json

import frappe
from frappe.utils import getdate, nowdate

from opengantt.api import _assert_owner, _parse_json


@frappe.whitelist()
def publish(gantt, snapshot, expires_on=None):
    """Publish a read-only snapshot of a gantt at a public slug."""
    _assert_owner("OG Gantt", gantt)
    snapshot = _parse_json(snapshot, None)
    if not isinstance(snapshot, dict) or not snapshot:
        frappe.throw("snapshot must be a non-empty JSON object")
    if expires_on:
        expires_on = getdate(expires_on)
        if str(expires_on) < nowdate():
            frappe.throw("expires_on cannot be in the past")

    slug = frappe.generate_hash(length=12)
    doc = frappe.get_doc({
        "doctype": "OG Share",
        "gantt": gantt,
        "public_slug": slug,
        "snapshot": json.dumps(snapshot),
        "route": f"share/{slug}",
        "published": 1,
        "expires_on": expires_on or None,
    })
    doc.insert()
    return {"slug": slug, "url": f"/share/{slug}"}


@frappe.whitelist()
def revoke(slug):
    """Unpublish a share link (keeps the record; page returns 410)."""
    share = frappe.db.get_value(
        "OG Share", {"public_slug": slug}, ["name", "route"], as_dict=True
    )
    if not share:
        frappe.throw("Share link not found", frappe.DoesNotExistError)
    _assert_owner("OG Share", share.name)
    frappe.db.set_value("OG Share", share.name, "published", 0)
    if share.route:
        from frappe.website.utils import clear_cache
        clear_cache(share.route)
    return {"ok": True}
