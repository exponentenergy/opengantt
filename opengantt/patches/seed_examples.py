"""Seed example Templates + Styles + Gantts on first migrate.

Idempotent — skips templates / gantts that already exist by name.
"""
from __future__ import annotations

import csv
import json
import os

import frappe

from opengantt.api.parse_upload import bulk_insert_tasks
from opengantt.patches import _watchtower


APP_PATH = frappe.get_app_path("opengantt") if hasattr(frappe, "get_app_path") else None


def _samples_dir() -> str:
    if APP_PATH:
        return os.path.join(APP_PATH, "samples")
    here = os.path.dirname(__file__)
    return os.path.abspath(os.path.join(here, "..", "samples"))


def execute():
    _ensure_template(
        name="Program Plan",
        description="Row-per-task program plan (e.g. New Product Plan sheet).",
        field_map={"name": "Program Step", "start_date": "Start Date", "end_date": "End Date"},
        grouping=["Program Stage"],
        display_columns=["Status", "Milestone", "Data pack Owner", "Data pack reviewer"],
        styles=[
            ("Default", {
                "canvas": "light", "font": "Inter",
                "header": "", "footer": "",
                "colors": {"leaf": "#2563eb", "group": "#0f172a"},
            }),
        ],
    )
    _ensure_template(
        name="Project Plan",
        description="Flat row-per-task project plan (e.g. Std Project Plan sheet).",
        field_map={"name": "Project Step", "start_date": "Start Date", "end_date": "End Date"},
        grouping=[],
        display_columns=["Status", "Sequence", "Owner", "Reviewer", "Step ID"],
        styles=[
            ("Default", {
                "canvas": "light", "font": "Inter",
                "header": "", "footer": "",
                "colors": {"leaf": "#16a34a", "group": "#0f172a"},
            }),
        ],
    )
    _ensure_template(
        name="Watchtower Roadmap",
        description="Matrix-format roadmap (months across, modules down, cells = phase labels).",
        field_map={"name": "Module Name"},
        grouping=["Section", "Module Name"],
        display_columns=["Phase"],
        status_field="Phase",
        styles=[
            ("Default", {
                "canvas": "light", "font": "Inter",
                "header": "", "footer": "",
                "colors": {"leaf": "#2563eb", "group": "#0f172a"},
            }),
            ("Phase Colors", {
                "canvas": "light", "font": "Inter",
                "header": "Watchtower Roadmap",
                "footer": "",
                "colors": {"leaf": "#2563eb", "group": "#0f172a"},
                "colors_by_status": _watchtower.PHASE_COLOURS,
                "status_field": "Phase",
            }),
        ],
    )

    _seed_gantt_from_csv(
        gantt_name="New Product Plan (example)",
        template="Program Plan",
        csv_path=os.path.join(_samples_dir(), "program_plan.csv"),
    )
    _seed_gantt_from_csv(
        gantt_name="Std Project Plan (example)",
        template="Project Plan",
        csv_path=os.path.join(_samples_dir(), "project_plan.csv"),
    )
    _seed_watchtower_gantt(
        gantt_name="Watchtower Roadmap (example)",
        template="Watchtower Roadmap",
        tsv_path=os.path.join(_samples_dir(), "watchtower_roadmap.tsv"),
    )


def _ensure_template(name, description, field_map, grouping, display_columns,
                     styles, status_field=None):
    if frappe.db.exists("OG Template", name):
        return
    extras = {}
    if status_field:
        extras["status_field"] = status_field
    doc = frappe.get_doc({
        "doctype": "OG Template",
        "name": name,
        "description": description,
        "field_map": json.dumps(field_map),
        "grouping": json.dumps(grouping),
        "display_columns": json.dumps(display_columns),
    })
    doc.insert(ignore_permissions=True)
    for style_name, cfg in styles:
        if frappe.db.exists("OG Style", style_name):
            continue
        merged = {**cfg, **extras}
        frappe.get_doc({
            "doctype": "OG Style",
            "name": style_name,
            "template": name,
            "config": json.dumps(merged),
        }).insert(ignore_permissions=True)


def _seed_gantt_from_csv(gantt_name, template, csv_path):
    if frappe.db.exists("OG Gantt", gantt_name):
        return
    if not os.path.exists(csv_path):
        frappe.log_error(f"Sample not found: {csv_path}", "OpenGantt seed")
        return
    rows = _read_csv(csv_path)
    template_doc = frappe.get_doc("OG Template", template)
    field_map = json.loads(template_doc.field_map or "{}")
    grouping = json.loads(template_doc.grouping or "[]")
    tasks = _build_tasks_from_rows(rows, field_map, grouping)
    gantt = frappe.get_doc({
        "doctype": "OG Gantt",
        "name": gantt_name,
        "template": template,
        "parsed_at": frappe.utils.now_datetime(),
    })
    gantt.insert(ignore_permissions=True)
    bulk_insert_tasks(gantt.name, tasks)


def _seed_watchtower_gantt(gantt_name, template, tsv_path):
    if frappe.db.exists("OG Gantt", gantt_name):
        return
    if not os.path.exists(tsv_path):
        frappe.log_error(f"Sample not found: {tsv_path}", "OpenGantt seed")
        return
    rows = _watchtower.read_tsv(tsv_path)
    tasks = _watchtower.build_tasks(rows)
    style_name = "Phase Colors" if frappe.db.exists("OG Style", "Phase Colors") else None
    gantt = frappe.get_doc({
        "doctype": "OG Gantt",
        "name": gantt_name,
        "template": template,
        "active_style": style_name,
        "parsed_at": frappe.utils.now_datetime(),
    })
    gantt.insert(ignore_permissions=True)
    bulk_insert_tasks(gantt.name, tasks)


def _read_csv(path):
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _build_tasks_from_rows(rows, field_map, grouping):
    """Python mirror of frontend parseSheet, used by the seed only."""
    canonical = {"name", "start_date", "end_date", "actual_start", "actual_end"}
    group_cache: dict[tuple, str] = {}
    tasks: list[dict] = []
    counter = {"n": 0}

    def _tid(prefix):
        counter["n"] += 1
        return f"seed-{prefix}-{counter['n']}"

    name_col = field_map.get("name")
    s_col = field_map.get("start_date")
    e_col = field_map.get("end_date")
    as_col = field_map.get("actual_start")
    ae_col = field_map.get("actual_end")
    mapped_cols = {c for c in (name_col, s_col, e_col, as_col, ae_col) if c}

    def _iso(v):
        if v is None or v == "":
            return None
        s = str(v)
        # csv stores dates as ISO already; keep first 10 chars if so
        if len(s) >= 10 and s[4] == "-" and s[7] == "-":
            return s[:10]
        return s

    for i, row in enumerate(rows):
        parent_temp = None
        path: list[str] = []
        for g_col in grouping:
            v = row.get(g_col)
            if v is None or v == "":
                continue
            path.append(str(v))
            key = tuple(path)
            if key not in group_cache:
                tid = _tid("g")
                group_cache[key] = tid
                tasks.append({
                    "temp_id": tid,
                    "parent_temp_id": parent_temp,
                    "task_name": str(v),
                    "kind": "group",
                    "sort_order": len(group_cache),
                    "fields": {g_col: str(v)},
                })
            parent_temp = group_cache[key]

        leaf_name = row.get(name_col) if name_col else None
        if leaf_name in (None, ""):
            continue
        fields = {}
        for col, val in row.items():
            if val in (None, ""):
                continue
            if col in mapped_cols or col in grouping:
                continue
            fields[col] = val
        tasks.append({
            "temp_id": _tid("l"),
            "parent_temp_id": parent_temp,
            "task_name": str(leaf_name),
            "kind": "leaf",
            "start_date": _iso(row.get(s_col)) if s_col else None,
            "end_date": _iso(row.get(e_col)) if e_col else None,
            "actual_start": _iso(row.get(as_col)) if as_col else None,
            "actual_end": _iso(row.get(ae_col)) if ae_col else None,
            "sort_order": i,
            "fields": fields,
        })
    return tasks
