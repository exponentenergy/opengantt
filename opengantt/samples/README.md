# OpenGantt sample files

Three reference files used by `opengantt/patches/seed_examples.py` to populate
example Templates + Gantts on first migrate. Also useful as standalone re-import
sources via the **New Gantt** flow.

| File | Shape | Template |
|------|-------|----------|
| `program_plan.csv` | Row-per-task, dates empty | Program Plan |
| `project_plan.csv` | Row-per-task, flat list | Project Plan |
| `watchtower_roadmap.tsv` | Matrix-format Gantt: rows = modules grouped by section number, cols = months grouped into quarters, cells = phase labels | Watchtower Roadmap |

The Watchtower file is the example that exercises dated bars and status-keyed
colours. The patch transforms it from matrix to row-per-task by collapsing each
module row's contiguous identical-phase cells into one task per phase-run.
