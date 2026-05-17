import frappe

@frappe.whitelist()
def duplicate_style():
    data = frappe.parse_json(frappe.request.data)
    style_name = data.get("style_name")
    target_template = data.get("target_template")
    if not style_name or not target_template:
        frappe.throw("style_name and target_template are required")

    source = frappe.get_doc("OG Style", style_name)
    doc = frappe.get_doc({
        "doctype": "OG Style",
        "template": target_template,
        "config": source.config,
    })
    doc.insert(ignore_permissions=True)
    return {"name": doc.name}
