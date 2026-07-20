"""Install-time setup: role + example seed data.

Seeding happens ONLY here (after_install) — never on migrate.
"""
import json
import os

import frappe

from opengantt.core import parser as core_parser
from opengantt.patches import _watchtower


def after_install():
    _ensure_role()
    try:
        seed_examples()
    except Exception:
        frappe.log_error(frappe.get_traceback(), "OpenGantt seed failed")


def _ensure_role():
    if not frappe.db.exists("Role", "OpenGantt User"):
        frappe.get_doc({
            "doctype": "Role", "role_name": "OpenGantt User", "desk_access": 0,
        }).insert(ignore_permissions=True)


def _samples_dir():
    return os.path.join(frappe.get_app_path("opengantt"), "samples")


def seed_examples():
    """Create the 3 example templates/styles/gantts. Idempotent, never wipes."""
    previous_user = frappe.session.user
    frappe.set_user("Administrator")
    try:
        _seed_all()
    finally:
        frappe.set_user(previous_user)


def _sample_fingerprint(path):
    try:
        parsed = core_parser.parse_file(path)
        return core_parser.header_fingerprint(parsed["headers"])
    except Exception:
        return None


def _seed_all():
    samples = _samples_dir()
    program_csv = os.path.join(samples, "program_plan.csv")
    project_csv = os.path.join(samples, "project_plan.csv")
    watchtower_tsv = os.path.join(samples, "watchtower_roadmap.tsv")

    _ensure_template(
        name="Program Plan",
        description="Row-per-task program plan (e.g. New Product Plan sheet).",
        field_map={"task_name": "Program Step", "start_date": "Start Date", "end_date": "End Date"},
        grouping=["Program Stage"],
        display_columns=["Status", "Milestone", "Data pack Owner", "Data pack reviewer"],
        fingerprint=_sample_fingerprint(program_csv),
        styles=[("Default", {
            "canvas": "light", "font": "Inter", "header": "", "footer": "",
            "colors": {"leaf": "#2563eb", "group": "#0f172a"},
        })],
    )
    _ensure_template(
        name="Project Plan",
        description="Flat row-per-task project plan (e.g. Std Project Plan sheet).",
        field_map={"task_name": "Project Step", "start_date": "Start Date", "end_date": "End Date"},
        grouping=[],
        display_columns=["Status", "Sequence", "Owner", "Reviewer", "Step ID"],
        fingerprint=_sample_fingerprint(project_csv),
        styles=[("Default", {
            "canvas": "light", "font": "Inter", "header": "", "footer": "",
            "colors": {"leaf": "#16a34a", "group": "#0f172a"},
        })],
    )
    _ensure_template(
        name="Watchtower Roadmap",
        description="Matrix-format roadmap (months across, modules down, cells = phase labels).",
        field_map={"__mode__": "matrix"},
        grouping=["Module"],
        display_columns=["Phase"],
        status_field="Phase",
        styles=[
            ("Default", {
                "canvas": "light", "font": "Inter", "header": "", "footer": "",
                "colors": {"leaf": "#2563eb", "group": "#0f172a"},
            }),
            ("Phase Colors", {
                "canvas": "light", "font": "Inter",
                "header": "Watchtower Roadmap", "footer": "",
                "colors": {"leaf": "#2563eb", "group": "#0f172a"},
                "colors_by_status": _watchtower.PHASE_COLOURS,
                "status_field": "Phase",
            }),
        ],
    )

    _seed_gantt_from_sheet("New Product Plan (example)", "Program Plan", program_csv)
    _seed_gantt_from_sheet("Std Project Plan (example)", "Project Plan", project_csv)
    _seed_watchtower_gantt("Watchtower Roadmap (example)", "Watchtower Roadmap", watchtower_tsv)


def _ensure_template(name, description, field_map, grouping, display_columns,
                     styles, status_field=None, fingerprint=None):
    if not frappe.db.exists("OG Template", name):
        frappe.get_doc({
            "doctype": "OG Template",
            "__newname": name,
            "description": description,
            "field_map": json.dumps(field_map),
            "grouping": json.dumps(grouping),
            "display_columns": json.dumps(display_columns),
            "header_fingerprint": fingerprint,
        }).insert(ignore_permissions=True)
    extras = {"status_field": status_field} if status_field else {}
    for style_name, cfg in styles:
        if frappe.db.exists("OG Style", style_name):
            continue
        frappe.get_doc({
            "doctype": "OG Style",
            "__newname": style_name,
            "template": name,
            "config": json.dumps({**cfg, **extras}),
        }).insert(ignore_permissions=True)


def _insert_gantt(gantt_name, template, tasks, active_style=None):
    from opengantt.api.import_flow import bulk_insert_tasks

    template_doc = frappe.get_doc("OG Template", template)
    gantt = frappe.get_doc({
        "doctype": "OG Gantt",
        "__newname": gantt_name,
        "template": template,
        "field_map": template_doc.field_map,
        "grouping": template_doc.grouping,
        "display_columns": template_doc.display_columns,
        "active_style": active_style,
        "parsed_at": frappe.utils.now_datetime(),
    })
    gantt.insert(ignore_permissions=True)
    bulk_insert_tasks(gantt.name, tasks)


def _seed_gantt_from_sheet(gantt_name, template, path):
    if frappe.db.exists("OG Gantt", gantt_name):
        return
    if not os.path.exists(path):
        frappe.log_error(f"Sample not found: {path}", "OpenGantt seed")
        return
    template_doc = frappe.get_doc("OG Template", template)
    field_map = json.loads(template_doc.field_map or "{}")
    grouping = json.loads(template_doc.grouping or "[]")
    parsed = core_parser.parse_file(path)
    tasks = core_parser.build_tasks(parsed["rows"], field_map, grouping)
    _insert_gantt(gantt_name, template, tasks)


def _seed_watchtower_gantt(gantt_name, template, tsv_path):
    if frappe.db.exists("OG Gantt", gantt_name):
        return
    if not os.path.exists(tsv_path):
        frappe.log_error(f"Sample not found: {tsv_path}", "OpenGantt seed")
        return
    raw = core_parser.read_matrix(tsv_path)
    tasks = core_parser.build_matrix_tasks(raw)
    style = "Phase Colors" if frappe.db.exists("OG Style", "Phase Colors") else None
    _insert_gantt(gantt_name, template, tasks, active_style=style)
