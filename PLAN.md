# OpenGantt Rebuild Plan (v2 — portfolio demo)

## Intent (unchanged)
Turn spreadsheet project plans (CSV/TSV/XLS/XLSX) into editable, shareable Gantt charts inside Frappe — with an import experience so simple it feels magic.

## What changes vs v1

### 1. One server-side parser (kills the 3-parser divergence)
New module `opengantt/core/parser.py`:
- Reads CSV/TSV (encoding-sniffed: utf-8-sig → latin-1 fallback) and XLSX/XLS (openpyxl, first sheet).
- Header-row auto-detection (skip title/blank rows: pick first row where ≥60% cells non-empty and unique).
- Robust date coercion: date objects, Excel serials, ISO, DD/MM/YYYY, MM/DD/YYYY (disambiguated by column-wide analysis), "Jan 5 2026" etc. via `dateutil`.
- Used by upload-preview, gantt creation, reimport, and seeding. Frontend does **zero** parsing (drop papaparse/xlsx deps → smaller bundle).

### 2. Smart Import wizard (the novel bit)
- `analyze_upload(file_url)` — server parses the file and **auto-detects column roles** via fuzzy header matching (name/task/activity → task_name; start/begin/from → start_date; end/finish/due/to → end_date; owner/assignee, status/phase, %/progress) **plus content sniffing** (a column that's 90% dates is a date candidate; 0–100 numeric → progress). Returns detected mapping + confidence, suggested grouping column(s), preview rows, and detected date format.
- UI: drop file → instant preview table with role chips on each column (editable dropdowns) → live mini-gantt preview → "Create Gantt". One screen, one primary action.
- "Remember this mapping" checkbox auto-saves an OG Template (matched on future imports by header fingerprint → returning users get zero-click mapping).

### 3. Privacy & data lifecycle (new angle)
- **Ownership**: `permission_query_conditions` + `has_permission` hooks — users see/touch only their own Templates/Gantts/Tasks/Shares (System Manager sees all). Every API verifies ownership; drop blanket `ignore_permissions` writes where possible.
- **Shares**: add `expires_on` (Date, optional) and `is_revoked` (Check) to OG Share. Expired/revoked → 410 page. Set `index_web_pages_for_search: 0` + `noindex` robots meta. Revoke button in UI.
- **Source retention**: per-gantt choice at import: keep source file (enables re-import) or "delete after import" (privacy default shown clearly). API `purge_source(gantt)` deletes the File doc + disk file anytime.
- **Delete my data**: `purge_gantt(name)` = tasks + shares + source file + gantt, one confirmed click. Same for templates (non-destructive to gantts, stamped schemas preserved).
- **Fix the killer bug**: seeding runs only on `after_install` / when tables are empty. Never wipes user data on migrate.

### 4. Editor (rebuilt, modular React)
Keep React 18 + Vite (build into `opengantt/public/opengantt/`), but split `App.tsx` monolith into: `ImportWizard`, `GanttChart` (SVG, drag dates), `TaskPanel`, `Toolbar` (grouping/columns/zoom), `ShareDialog` (with expiry + revoke), `SharePage` (read-only from `window.__OG_SHARE_SNAPSHOT__`). Keep hand-rolled routing (small). Export self-contained HTML stays.

## API contract (all `@frappe.whitelist()`, typed args — no raw request parsing)

| Method | Args | Returns |
|---|---|---|
| `opengantt.api.import_flow.analyze_upload` | `file_url` | `{headers, preview_rows(≤30), detected: {field_map, grouping, date_format, confidence}, matched_template?}` |
| `opengantt.api.import_flow.create_gantt` | `title, file_url, field_map(json), grouping(json), display_columns(json), save_template(0/1), template_name?, retain_source(0/1)` | `{gantt, task_count}` |
| `opengantt.api.import_flow.reimport` | `gantt` | `{ok, count}` (uses stamped schema; errors clearly if source purged) |
| `opengantt.api.tasks.get_gantt_data` | `gantt` | `{gantt: {...}, tasks: [...]}` (ownership-checked; replaces raw REST list) |
| `opengantt.api.tasks.update_task` | `name, patch(json)` | `{ok}` |
| `opengantt.api.tasks.rebucket` | `gantt, grouping(json)` | `{ok, leaf_count, group_count}` |
| `opengantt.api.share.publish` | `gantt, snapshot(json), expires_on?` | `{slug, url}` |
| `opengantt.api.share.revoke` | `slug` | `{ok}` |
| `opengantt.api.privacy.purge_source` | `gantt` | `{ok}` |
| `opengantt.api.privacy.purge_gantt` | `name` | `{ok}` |
| `opengantt.api.privacy.purge_template` | `name` | `{ok, detached_gantts}` |
| `opengantt.api.meta.list_gantts` | — | `{gantts: [{name, title, task_count, modified, has_source, shares}]}` |

Doctype changes: OG Share += `expires_on` (Date), `is_revoked` (Check); `index_web_pages_for_search: 0`. OG Gantt += `title` (Data) if missing semantics need it (keep Prompt autoname). All doctypes keep System Manager + OpenGantt User roles but add `if_owner` semantics via hooks.

## Demo polish
- Seeded "Watchtower Roadmap" sample retained (install-time only).
- Landing list page: card per gantt with mini timeline sparkline, task count, share badge.
- Clean visual design (no bland default UI), dark-mode aware.

## Review amendments (binding)
1. Every API method: args arrive as strings via form_dict — use `frappe.parse_json()` / `frappe.utils.cint()` at top. Never `json.loads(frappe.request.data)`. Frontend sends JSON args as strings.
2. Ownership enforced by explicit `_assert_owner(doctype, name)` helper in EVERY api method (owner == frappe.session.user or System Manager). `permission_query_conditions` hooks added too for desk lists, but the helper is the real gate.
3. OG Share revoke: use `published` (Check, default 1) field; revoke sets published=0 + `clear_cache(route)`. Expired/revoked → `get_context` renders friendly "link expired/revoked" template with `frappe.local.response.http_status_code = 410` attempted, 404 fallback acceptable. Share HTML template includes `<meta name="robots" content="noindex">` and emits snapshot via `<script type="application/json">{{ snapshot | tojson }}</script>` parsed by JS (XSS-safe).
4. Drop `.xls`. Support CSV/TSV/XLSX only; clear error otherwise.
5. Uploads: frontend uses `/api/method/upload_file` with `is_private=1`, X-Frappe-CSRF-Token header, NOT attached to any doc (orphan); `create_gantt` re-attaches (sets File.attached_to) . `purge_source`: find File docs by file_url, `frappe.delete_doc("File", ...)` (on_trash removes disk file), clear gantt.source_file. `analyze_upload` resolves file via File doc + owner check.
6. `get_gantt_data` returns full gantt object: `{name, title, field_map, grouping, display_columns, has_source, parsed_at, owner}` and tasks with `{name, task_name, kind, parent_task, start_date, end_date, actual_start, actual_end, sort_order, progress, fields(parsed dict)}`. Errors: frontend surfaces `_server_messages`/`exc_type` in a toast.
7. `update_task`: whitelist `task_name, start_date, end_date, actual_start, actual_end, progress, fields` only; dates wire format `YYYY-MM-DD`.
8. Seed strictly in `after_install` only (guarded once for existing sites via patch); NEVER re-seed on empty tables.
9. OG Task += `progress` (Int 0–100) field.

## Execution
1. Backend agent: parser core + APIs + doctype JSON + hooks/permissions + patches/seed fix.
2. Frontend agent (parallel): rebuild `frontend/` per contract above.
3. Integrate: npm build, migrate, bench build, restart, browser E2E (import sample CSV → edit → share → revoke → purge).
