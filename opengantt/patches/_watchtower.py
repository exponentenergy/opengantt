"""Watchtower seed styling constants.

The matrix parsing that used to live here has been generalized into
opengantt.core.parser (detect_matrix / build_matrix_tasks) so uploads,
reimports and seeding all share one implementation.
"""
from __future__ import annotations

PHASE_COLOURS = {
    "Scope Discovery": "#2563eb",
    "Development": "#86c46b",
    "Developement": "#86c46b",  # tolerate the misspelling in the legend
    "UAT": "#7eb8e6",
    "Migration": "#cfe9b9",
    "Go-Live": "#16a34a",
    "Sustenance": "#0891b2",
    "Increment - Bug": "#f08a8a",
    "Increment - Feature": "#a05195",
    "Increment - Data Import": "#f59e0b",
}
