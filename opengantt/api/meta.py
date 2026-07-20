"""Listing/metadata APIs for the landing page."""
import json

import frappe

from opengantt.api import _is_manager, _json_field

#: max leaf segments returned per gantt for the card sparkline
SPARK_SEGMENTS = 40


def _spark_color_key(field_map: dict) -> str | None:
    """Which task.fields key colours this gantt's bars (phase or status)."""
    if field_map.get("__mode__") == "matrix":
        return "Phase"
    return field_map.get("status") or None


@frappe.whitelist()
def list_gantts():
    """List the session user's gantts (System Manager sees all).

    Each card includes `spark`: up to 40 dated leaf segments
    [{start, end, color_value}] for the mini timeline sparkline.
    """
    filters = {} if _is_manager() else {"owner": frappe.session.user}
    gantts = frappe.get_all(
        "OG Gantt",
        filters=filters,
        fields=["name", "modified", "source_file", "template", "active_style", "field_map"],
        order_by="modified desc",
        limit_page_length=0,
    )
    out = []
    for g in gantts:
        task_count = frappe.db.count("OG Task", {"gantt": g.name, "kind": "leaf"})
        share_count = frappe.db.count("OG Share", {"gantt": g.name, "published": 1})

        color_key = _spark_color_key(_json_field(g.field_map, {}))
        segs = frappe.get_all(
            "OG Task",
            filters={"gantt": g.name, "kind": "leaf"},
            fields=["start_date", "end_date", "fields"],
            order_by="sort_order asc",
            limit_page_length=SPARK_SEGMENTS,
        )
        spark = []
        for s in segs:
            if not s.start_date or not s.end_date:
                continue
            color_value = None
            if color_key:
                try:
                    color_value = (json.loads(s.fields or "{}") or {}).get(color_key)
                except Exception:
                    color_value = None
            spark.append({
                "start": str(s.start_date),
                "end": str(s.end_date),
                "color_value": color_value,
            })

        out.append({
            "name": g.name,
            "title": g.name,
            "task_count": task_count,
            "modified": str(g.modified),
            "has_source": bool(g.source_file),
            "shares": share_count,
            "spark": spark,
        })
    return {"gantts": out}
