# `report/`

## Purpose

QWeb PDF report definitions — six reports, each an `_action.xml` (the
`ir.actions.report` record, defines the report's name/model/template
reference) paired with a `_report.xml` (the actual QWeb template). Two
reports (`wincraft_cutlist_report.py`, `wincraft_quote_report.py`) also have
a Python model class for report-specific computed data the template needs.

## Reports

| Report | Files | Format |
|---|---|---|
| Quote | `wincraft_quote_report_action.xml`, `wincraft_quote_report.xml`, `wincraft_quote_report.py` | Per-window pricing breakdown, tax, totals, company logo |
| Cut-List | `wincraft_cutlist_report_action.xml`, `wincraft_cutlist_report.xml`, `wincraft_cutlist_report.py` | Per-window cut dimensions and quantities |
| Window Label | `wincraft_window_label_action.xml`, `wincraft_window_label_report.xml` | Shop-floor window identification label |
| Profile Order | `wincraft_profile_order_action.xml`, `wincraft_profile_order_report.xml` | Profile procurement summary |
| Profile Cut-List | `wincraft_profile_cutlist_report.xml` | Cut schedule from the profile optimiser |
| Glass Cut-List | `wincraft_glass_cutlist_report.xml` | Glass pane cutting schedule |

## How reports are wired

`ir.actions.report` (the `*_action.xml` file) → QWeb template (`*_report.xml`)
→ rendered via `ir.actions.report._render_qweb_pdf(...)`. The cut-list PDF is
additionally streamed directly over HTTP by
`controllers/main.py::cutlist_pdf` (`/wincraft/cutlist/<project_id>`) rather
than only being reachable through the standard Odoo "Print" menu — if
changing the cut-list report's action XML ID, update that controller call
too (`request.env.ref('wincraft_studio.action_wincraft_cutlist_report')`).

## Load order

Report actions/templates load **before** the `data/` files that reference
them (email/WhatsApp templates attach a report as an email attachment) — see
`docs/ARCHITECTURE.md` "Module load order." A new report's action must stay
before any data file that references it in the manifest's `data` list.

## Common pitfalls

- QWeb auto-escapes by default — don't manually build HTML strings inside a
  report's Python helper class the way `controllers/main.py::scan_fabricate`
  does for its (non-report) confirmation page; that pattern is acceptable
  there only because the interpolated values are server-controlled, not
  because it's generally safe to copy.

## Parent / related

- Parent: [`wincraft_studio/README.md`](../README.md)
- Related: [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md),
  [`../models/README.md`](../models/README.md)
