# OpenGantt

OpenGantt is a Frappe app for turning spreadsheet-driven project plans into
editable, shareable Gantt charts.

This alpha is meant for early testers who can install a Frappe app, import a
sample spreadsheet, create a chart, and report where the workflow breaks or
feels confusing.

## Alpha Scope

What works in this build:

- Create reusable templates that map spreadsheet columns to task fields.
- Import CSV/XLS/XLSX files into an OG Gantt.
- Preserve each Gantt's stamped schema after it is created, so deleting or
  editing the source template does not break existing charts.
- Edit grouping, visible fields, tasks, owners, status, progress, dates, and
  hierarchy from the Gantt editor.
- Re-import from the original uploaded source file against the Gantt's stamped
  schema.
- Export a self-contained HTML snapshot or publish a read-only share snapshot.

Known alpha limits:

- Install and migration flows assume a Frappe v15 bench.
- The UI is optimized for desktop browsers.
- Spreadsheet parsing is intentionally permissive; malformed files may still
  need manual cleanup after import.

## Installation

You can install this app using the [bench](https://github.com/frappe/bench) CLI:

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app https://github.com/askysh/opengantt.git --branch main
bench install-app opengantt
bench --site $SITE_NAME migrate
bench build --app opengantt
bench restart
```

Open the app from the Frappe desk app switcher or directly at:

```text
https://$SITE_NAME/opengantt
```

For a local bench, that is usually:

```text
http://localhost:8000/opengantt
```

## Updating an Existing Alpha Install

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app opengantt --branch main
bench --site $SITE_NAME migrate
bench build --app opengantt
bench restart
```

The latest migration stamps template schema fields onto existing Gantts. After
updating, old Gantts should keep opening even if their original template is
later deleted.

## First Test Pass

1. Open OpenGantt.
2. Create or edit a template and map the spreadsheet columns for task name,
   planned start, planned end, optional actual dates, grouping, and visible
   metadata.
3. Create a new Gantt from a CSV/XLS/XLSX file.
4. Open the Gantt and verify the hierarchy, dates, owners, statuses, progress,
   and grouping.
5. Try changing the stamped grouping from the Gantt editor.
6. Edit a task in the side panel and reload the page.
7. Test Re-import, Export HTML, and Share.
8. Delete the original template and confirm the existing Gantt still opens.

## Feedback Requested

Please include these details when reporting an issue:

- Browser and operating system.
- Frappe and ERPNext versions, if ERPNext is installed.
- The page or action where the issue happened.
- A screenshot or short screen recording when the issue is visual.
- A small sample spreadsheet if the issue is import or mapping related.
- Browser console errors and Frappe traceback text, if present.

## Development

Frontend source lives in `frontend/` and builds into
`opengantt/public/opengantt/` for Frappe to serve.

```bash
cd frontend
npm install
npm run build
```

From the bench root, rebuild and migrate the app with:

```bash
bench --site $SITE_NAME migrate
bench build --app opengantt
```

## Contributing

This app uses `pre-commit` for code formatting and linting. Please [install pre-commit](https://pre-commit.com/#installation) and enable it for this repository:

```bash
cd apps/opengantt
pre-commit install
```

Pre-commit is configured to use the following tools for checking and formatting your code:

- ruff
- eslint
- prettier
- pyupgrade

## License

mit
