# `wizards/`

## Purpose

`TransientModel`-based guided multi-step UI flows — for anything that isn't
a plain form-view edit on a persistent record.

## Contents

| File | Purpose |
|---|---|
| `quick_quote_wizard.py` | Rapid estimate without creating a full `wincraft.project` |
| `wincraft_setup_wizard.py` | Manual guided onboarding (name-entry style setup) |
| `create_sale_order_wizard.py` | Converts an accepted quote/project into a `sale.order` |
| `product_setup_wizard.py` (285 lines) | Multi-step guided "create draft products" flow — the largest/most structurally complex wizard here |
| `cutlist_generate_wizard.py` | Drives cut-list generation for a project |
| `wincraft_color_import_wizard.py` | One-field vendor prompt in front of the native Import screen for `wincraft.color` (see "CSV catalog imports" below — this is not a CSV-parsing wizard) |

Each `.py` file has a matching `_views.xml` file defining its wizard form.

## Pattern

These follow Odoo's standard `TransientModel` wizard shape: a form with
input fields, one or more `type='object'` buttons calling a Python method
that creates/updates real (non-transient) records and returns an action
(usually to open the resulting record).

## CSV catalog imports: retired from this folder (2026-07-24)

Four CSV-upload wizards used to live here (`glass_lite_import_wizard.py`,
`window_type_import_wizard.py`, `grill_import_wizard.py`,
`options_import_wizard.py`, added 2026-07-22/23) — all four are deleted.
Their logic (Y/N booleans, blank-name/price fallbacks, blank-row skipping,
inch→mm conversion, MIL clamping) moved into `load()` overrides on the
target models themselves (`wincraft.addon`, `wincraft.glass.lite`,
`wincraft.window.type` — see `models/README.md` "Native CSV import"),
so these catalogs now import through Odoo's stock "Import records" screen
directly, on the raw supplier file, with no bespoke upload UI. See
`docs/DECISIONS.md` 2026-07-24 for the tradeoffs (mainly: per-row error
messages from native import reference positions after blank-row filtering,
not the original file's line numbers).

**Do not re-introduce a bespoke upload wizard for a new catalog CSV** —
override `load()` on the target model instead, following the pattern in
`models/wincraft_addon.py`/`wincraft_glass_lite.py`/`wincraft_window_type.py`.
A wizard is still the right shape for anything that isn't a bulk-CSV import
onto one model (multi-step flows, cross-model orchestration, etc.).

**Exception, added 2026-09-23**: `wincraft_color_import_wizard.py` is a
wizard sitting in front of a CSV import, but it does not parse the file —
it has no file field at all. It only captures a `default_vendor` value and
then returns an `ir.actions.client`/`tag: 'import'` action (the same action
Odoo's own "Import records" cog-menu button returns, traced via
`base_import`'s `import_records.js`/`import_action.js`), so the actual file
upload and row parsing still goes through the native import screen and
`wincraft.color.load()` unchanged. This pattern (a thin context-seeding
front door) is fine to reuse for a future model that needs a
runtime-typed import default a static list-view action can't provide;
a wizard that reads the uploaded file itself is what stays retired.

## Architecture notes

Load order: wizards load in the manifest **before** the `*_ext_views.xml`
extension views that add buttons referencing these wizards' actions — see
`docs/ARCHITECTURE.md` "Module load order." Don't move a new wizard's views
entry after the extension views that depend on it.

## Testing strategy

The 4 former CSV-import wizards' `TransactionCase` coverage moved with
their logic to `tests/test_wincraft_addon_native_import.py`,
`tests/test_wincraft_glass_lite_native_import.py`,
`tests/test_wincraft_window_type_native_import.py` — now testing the
`load()` overrides on `models/README.md`, not a wizard. None of the 5
wizards remaining in this folder (quick quote, setup, create-sale-order,
product-setup, cutlist generate) have test coverage — see
`docs/TESTING.md` "Coverage gaps."

## Parent / related

- Parent: [`wincraft_studio/README.md`](../README.md)
- Related: [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md),
  [`docs/CODING_STANDARDS.md`](../../docs/CODING_STANDARDS.md),
  [`../views/README.md`](../views/README.md)
