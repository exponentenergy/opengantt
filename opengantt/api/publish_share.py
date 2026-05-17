import frappe
import json

@frappe.whitelist()
def publish_share():
    data = json.loads(frappe.request.data)
    gantt_name = data.get("gantt")
    snapshot = data.get("snapshot")
    if not gantt_name or not snapshot:
        frappe.throw("gantt and snapshot are required")

    slug = frappe.generate_hash(length=12)
    doc = frappe.get_doc({
        "doctype": "OG Share",
        "gantt": gantt_name,
        "public_slug": slug,
        "snapshot": json.dumps(snapshot) if isinstance(snapshot, dict) else snapshot,
        "route": f"share/{slug}",
    })
    doc.insert(ignore_permissions=True)
    return {"slug": slug, "url": f"/share/{slug}"}
