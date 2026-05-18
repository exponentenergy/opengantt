# OpenGantt

**Turn spreadsheet-driven project plans into editable, shareable Gantt charts — inside Frappe.**

OpenGantt is a Frappe app that imports CSV / XLS / XLSX project plans, lets you
map columns to task fields via reusable templates, and renders an interactive
Gantt editor where you can drag dates, edit tasks, group by owner or status,
re-import, and export a self-contained HTML snapshot.

> **Alpha status** — this build is feature-complete for a first testing round.
> The UI works on desktop browsers with a Frappe v15 bench. See known limits
> below.

---

## Features

- **Templates** — Create reusable column-to-field mappings so every import is
  consistent.
- **Import** — Upload CSV, TSV, XLS, or XLSX files. The parser is permissive and
  tolerant of messy spreadsheet data.
- **Stamped schemas** — Each Gantt freezes its own field map at creation time.
  Deleting the original template won't break existing charts.
- **Gantt editor** — Drag-and-drop dates, edit tasks in a side panel, change
  grouping, toggle visible columns, set status and progress.
- **Re-import** — Re-run against the original uploaded source file using the
  Gantt's stamped schema.
- **Export HTML** — Download a self-contained HTML snapshot of any Gantt.
- **Share** — Publish a read-only share link with a Frappe-style layout.
- **Sample data** — OpenGantt ships with three sample files (Program Plan,
  Project Plan, Watchtower Roadmap) that seed example Templates and Gantts on
  first migrate.

---

## Installation

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app https://github.com/askysh/opengantt.git --branch main
bench --site $SITE_NAME migrate
bench install-app opengantt
bench build --app opengantt
bench restart
```

Open the app from the Frappe desk app switcher or directly at:

```text
https://$SITE_NAME/opengantt
```

For a local bench:

```text
http://localhost:8000/opengantt
```

---

## Updating

```bash
bench get-app opengantt --branch main
bench --site $SITE_NAME migrate
bench build --app opengantt
bench restart
```

---

## Quick Start for Testers

1. Open **OpenGantt** from the Frappe app switcher.
2. Try the **Watchtower Roadmap** that was seeded during install — or create a
   new Template that maps spreadsheet columns (task name, planned start/end,
   grouping, visible metadata).
3. Create a **New Gantt** from a CSV/XLS/XLSX file.
4. Explore the editor: change grouping, edit a task, drag a date, re-import,
   export HTML, create a share link.
5. Delete the source Template and verify the Gantt still opens (stamped
   schemas).

---

## Known Alpha Limits

- Frappe **v15 bench** assumed for install and migration.
- **Desktop browsers only** — not yet optimised for mobile.
- **Permissive parser** — malformed spreadsheets may still need manual cleanup.
- **No concurrent editing** — two people editing the same Gantt will overwrite
  each other.

---

## Feedback

Found a bug? Something feels confusing? Open an issue at:

https://github.com/askysh/opengantt/issues

Please include:

- Browser and OS
- Frappe version (`bench version`)
- The page or action where it happened
- Screenshot / screen recording if the issue is visual
- Sample spreadsheet if import or mapping is involved
- Browser console errors and Frappe traceback, if available

---

## Development

Frontend source lives in `frontend/` and builds into
`opengantt/public/opengantt/`.

```bash
cd frontend
npm install
npm run build
```

From the bench root:

```bash
bench --site $SITE_NAME migrate
bench build --app opengantt
```

---

## Contributing

This app uses `pre-commit` for code formatting and linting.

```bash
cd apps/opengantt
pre-commit install
```

Tools configured: ruff, eslint, prettier, pyupgrade.

---

## License

MIT
