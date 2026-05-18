import frappe


def execute():
    """Stamp Template schema fields onto existing Gantts.

    Idempotent: existing Gantt values are kept, and missing values are copied
    from the linked Template when one is still available.
    """
    for gantt in frappe.get_all(
        "OG Gantt",
        fields=["name", "template", "field_map", "grouping", "display_columns"],
    ):
        if not gantt.template or not frappe.db.exists("OG Template", gantt.template):
            continue
        template = frappe.get_doc("OG Template", gantt.template)
        updates = {}
        for field in ("field_map", "grouping", "display_columns"):
            if not getattr(gantt, field, None):
                updates[field] = getattr(template, field, None)
        if updates:
            frappe.db.set_value("OG Gantt", gantt.name, updates, update_modified=False)
