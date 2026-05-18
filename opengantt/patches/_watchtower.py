"""Helpers for transforming the matrix-format Watchtower roadmap into
row-per-task records.

Pure functions; no Frappe dependencies.
"""
from __future__ import annotations

import calendar
import csv
from typing import Iterator


_MONTH_ABBREV = {m: i for i, m in enumerate(calendar.month_abbr) if m}


def parse_month_header(label: str) -> tuple[int, int] | None:
    """Parse 'Oct 24' -> (2024, 10). Returns None if not a month label."""
    s = (label or "").strip()
    if not s:
        return None
    parts = s.split()
    if len(parts) != 2:
        return None
    mon, yy = parts
    if mon not in _MONTH_ABBREV:
        return None
    try:
        yi = int(yy)
    except ValueError:
        return None
    year = 2000 + yi if yi < 100 else yi
    return year, _MONTH_ABBREV[mon]


def month_bounds(year: int, month: int) -> tuple[str, str]:
    """First and last day of a month as ISO yyyy-mm-dd."""
    last = calendar.monthrange(year, month)[1]
    return f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{last:02d}"


def read_tsv(path: str) -> list[list[str]]:
    with open(path, encoding="utf-8") as f:
        return [row for row in csv.reader(f, delimiter="\t")]


def build_tasks(rows: list[list[str]]) -> list[dict]:
    """Convert the matrix to a flat list of task dicts ready for bulk_insert_tasks.

    Hierarchy:
        Section group  ->  Module group  ->  Phase-run leaf
    Each phase-run leaf has start_date/end_date covering its month span and
    fields = {"Phase": <label>}.
    """
    if len(rows) < 3:
        return []
    month_headers = rows[2]
    # Map column index -> (year, month) for date columns
    col_dates: dict[int, tuple[int, int]] = {}
    for i, h in enumerate(month_headers):
        ym = parse_month_header(h)
        if ym:
            col_dates[i] = ym

    section_map: dict[str, str] = {}  # section value -> temp_id
    module_map: dict[tuple[str, str], str] = {}  # (section, module) -> temp_id
    tasks: list[dict] = []
    cur_section = ""
    order = 0

    def _tid(prefix: str) -> str:
        nonlocal order
        order += 1
        return f"wt-{prefix}-{order}"

    for r_idx, row in enumerate(rows[3:], start=3):
        if not any(c.strip() for c in row):
            continue
        section_cell = row[0].strip() if len(row) > 0 else ""
        if section_cell:
            cur_section = section_cell
        module = row[1].strip() if len(row) > 1 else ""
        if not module:
            continue

        if cur_section and cur_section not in section_map:
            sid = _tid("section")
            section_map[cur_section] = sid
            tasks.append({
                "temp_id": sid,
                "parent_temp_id": None,
                "task_name": f"Section {cur_section}",
                "kind": "group",
                "sort_order": int(cur_section) if cur_section.isdigit() else 0,
                "fields": {"Section": cur_section},
            })

        mkey = (cur_section, module)
        if mkey not in module_map:
            mid = _tid("module")
            module_map[mkey] = mid
            tasks.append({
                "temp_id": mid,
                "parent_temp_id": section_map.get(cur_section),
                "task_name": module,
                "kind": "group",
                "sort_order": r_idx,
                "fields": {"Section": cur_section, "Module Name": module},
            })

        # Collapse contiguous identical phase cells into runs
        runs: list[tuple[str, int, int]] = []  # (phase, start_col, end_col)
        cur_phase: str | None = None
        cur_start: int | None = None
        for c_idx, _ym in col_dates.items():
            val = row[c_idx].strip() if c_idx < len(row) else ""
            if val and val == cur_phase:
                continue
            if cur_phase is not None and cur_start is not None:
                runs.append((cur_phase, cur_start, _prev_col(col_dates, c_idx)))
            cur_phase = val or None
            cur_start = c_idx if val else None
        if cur_phase is not None and cur_start is not None:
            last_col = max(col_dates.keys())
            runs.append((cur_phase, cur_start, last_col))

        for k, (phase, sc, ec) in enumerate(runs):
            sy, sm = col_dates[sc]
            ey, em = col_dates[ec]
            start, _ = month_bounds(sy, sm)
            _, end = month_bounds(ey, em)
            tasks.append({
                "temp_id": _tid("leaf"),
                "parent_temp_id": module_map[mkey],
                "task_name": phase,
                "kind": "leaf",
                "start_date": start,
                "end_date": end,
                "sort_order": r_idx * 100 + k,
                "fields": {
                    "Section": cur_section,
                    "Module Name": module,
                    "Phase": phase,
                },
            })

    return tasks


def _prev_col(col_dates: dict[int, tuple[int, int]], not_after: int) -> int:
    """Largest indexed date column strictly before `not_after`."""
    keys = sorted(c for c in col_dates if c < not_after)
    return keys[-1] if keys else not_after


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
