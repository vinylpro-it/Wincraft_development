# `models/`

## Purpose

The business-logic/ORM layer — every `wincraft.*` model, plus the six
`*_ext.py`/`product_template.py` files that extend core Odoo models. This is
the layer that matters most in this addon; controllers and wizards are thin
by comparison (see `docs/ARCHITECTURE.md`).

## Responsibilities

- Domain data (catalog: materials, glass, hardware, profiles; transactional:
  projects, windows, quotes; operational: delivery, installation, station
  logs) and the business rules that operate on it (pricing resolution,
  deduction formulas, BOM assembly, bin-packing).
- Core-model extension points (`sale_order_ext.py`, `crm_lead_ext.py`,
  `res_partner_ext.py`, `mrp_bom_ext.py`, `res_config_settings_ext.py`,
  `product_template.py`) — never edit Odoo core files directly; add fields/
  methods here via `_inherit`.

## Model catalog (authoritative as of 2026-07-22 — verified against source, not copied from an older doc)

| File | Model(s) | Lines | Description |
|---|---|---|---|
| `wincraft_project.py` | `wincraft.project` | 1245 | The quote/job record: canvas, windows, pricing, PDF, CRM link |
| `wincraft_window.py` | `wincraft.window` | 2070 | A configured window: dimensions, panes, glazing, hardware, pricing |
| `wincraft_bom_builder.py` | (helper, no own model) | 1178 | BOM assembly logic |
| `wincraft_delivery.py` | `wincraft.delivery`, `.delivery.line`, `.loading.manifest`, `.installation`, `.installation.check` | 381 | Delivery scheduling, truck loading, installation confirmation/checklist |
| `wincraft_ai_assistant.py` | `wincraft.ai.assistant`, `.ai.suggestion` | 236 | In-module energy-scoring suggestions (not the external Anthropic call — see `controllers/README.md`) |
| `wincraft_profile_optimiser.py` | `wincraft.profile.optimiser`, `.optimiser.line`, `.optimiser.bar`, `.optimiser.bar.cut` | 284 | First-fit-decreasing bin-packing |
| `wincraft_cutlist_management.py` | `wincraft.cutlist.profile.line`, `.cutlist.glass.line` | 269 | Profile and glass cut-list lines |
| `wincraft_deduction_formula.py` | `wincraft.deduction.formula` | 260 | Configurable cut-length deduction engine |
| `wincraft_pricing_rule.py` | `wincraft.pricing.rule`, `.pricing.ui.tier` | 230 | Pricing rule engine + United-Inches tiered pricing |
| `wincraft_production.py` | `wincraft.station.log` | 194 | Shop-floor barcode check-in/out at a work centre |
| `wincraft_glass_lite.py` | `wincraft.glass.lite` | 214 | A single glass pane spec; also carries a "CSV Upload" field group (external_code, part_name, per-thickness SF prices, availability/charge flags) populated via Odoo's native "Import records" screen — a `load()` override normalizes the raw supplier CSV (booleans, MIL clamping), see "Native CSV import" below |
| `wincraft_golive.py` | `wincraft.golive.checklist`, `.health.check.wizard` | 170 | Guided first-install checklist |
| `wincraft_window_template.py` | `wincraft.window.template` | 163 | Reusable window configuration templates |
| `wincraft_frame_config.py` | `wincraft.frame.config` | 158 | Frame product config (opening type × profile system → product) |
| `wincraft_inventory.py` | `wincraft.material.requirement` | 154 | Material availability checks against stock |
| `wincraft_profile_system.py` | `wincraft.profile.system` | 147 | Profile system catalog (PVC/aluminium/etc.) |
| `wincraft_dealer_commission.py` | `wincraft.dealer.commission` | 130 | Commission calculation and tracking |
| `wincraft_cutlist.py` | `wincraft.cutlist.line` | 133 | Cut-list line |
| `wincraft_dealer.py` | `wincraft.dealer` | 123 | Dealer record: territory, contact, performance |
| `wincraft_branch.py` | `wincraft.branch` | 115 | Multi-branch/location support |
| `crm_lead_ext.py` | (extends `crm.lead`) | 109 | Quote link from CRM opportunity |
| `wincraft_addon.py` | `wincraft.addon` | 194 | Generic accessory line item — see `docs/adr/0002-*.md`; carries two CSV-sourced field groups: a shared one (`group_code` — renamed from `pattern_code` once a second CSV needed it, `color`, `material`, `pricing_basis`, `star_price`, `min_charge`, `is_georgian`, `is_painted`) and an Options-only one (~30 fields — dimensions, pricing tiers, Urban/BM/casing reference data), both populated via Odoo's native "Import records" screen (a `load()` override normalizes Y/N booleans, letter-coded selections, blank-name/price fallbacks) — see "Native CSV import" below |
| `wincraft_hardware.py` | `wincraft.hardware` | 107 | Hardware item catalog |
| `wincraft_material.py` | `wincraft.material` | 88 | Raw material catalog |
| `res_config_settings_ext.py` | (extends `res.config.settings`) | 85 | WinCraft system settings |
| `product_template.py` | (extends `product.template`) | 87 | WinCraft-specific product fields |
| `wincraft_rule.py` | `wincraft.rule` | 89 | Configuration validation rule |
| `wincraft_canvas_layout.py` | `wincraft.canvas.layout` | 87 | Versioned canvas JSON snapshot |
| `wincraft_addon_category.py` | `wincraft.addon.category` | 70 | Accessory category (the `code` field drives canvas rendering) |
| `mrp_bom_ext.py` | (extends `mrp.bom`) | 71 | BOM extension link |
| `wincraft_analytics.py` | `wincraft.project.analysis` | 75 | Pivot/graph/list analytics |
| `wincraft_spacer_config.py` | `wincraft.spacer.config` | 73 | Spacer product config |
| `wincraft_window_type.py` | `wincraft.window.type` | 95 | Window type catalog (casement/sliding/fixed/etc.); also carries a "CSV Upload" field group (min/max size in mm, style_code, price_code, is_fh) populated via Odoo's native "Import records" screen — a `load()` override converts the source CSV's inches to mm and Y/N to boolean, see "Native CSV import" below |
| `sale_order_ext.py` | (extends `sale.order`) | 69 | Project back-reference on sale orders |
| `wincraft_quote_history.py` | `wincraft.quote.history` | 66 | Immutable version snapshot per quote revision |
| `wincraft_opening_type.py` | `wincraft.opening.type` | 61 | Opening type catalog |
| `res_partner_ext.py` | (extends `res.partner`) | 54 | Dealer link on partner |
| `wincraft_glass_type.py` | `wincraft.glass.type` | 97 | Glass type catalog (rate, U-value, SHGC) |
| `wincraft_glass_tint.py` | `wincraft.glass.tint` | 32 | Glass tint options |
| `wincraft_gas_fill.py` | `wincraft.gas.fill` | 27 | Argon/air/other gas fill |
| `wincraft_spacer_type.py` | `wincraft.spacer.type` | 27 | Spacer type catalog |
| `wincraft_cavity_width.py` | `wincraft.cavity.width` | 22 | IGU cavity width config |

## Native CSV import (`load()` overrides)

`wincraft.addon`, `wincraft.glass.lite`, and `wincraft.window.type` each
override `load(self, fields, data)` — the method Odoo's own stock
"Import records" screen calls (`base_import` → `execute_import` →
`model.load(...)`) — to normalize raw supplier-catalog CSV values before
Odoo's own field conversion runs. This replaced 4 bespoke upload wizards
(`options_import_wizard.py`, `grill_import_wizard.py`,
`glass_lite_import_wizard.py`, `window_type_import_wizard.py`) on
2026-07-24 — see `docs/DECISIONS.md` for why. Each override handles, only
for columns the user actually mapped in the import screen:

- `Y`/`N` → boolean, generically, for every `fields.Boolean` on the model
  (introspected via `self._fields`, not a hardcoded name list).
- Model-specific letter-coded `Selection` values (`wincraft.addon`'s
  `pricing_unit` L/F/S, `pricing_basis` S/F).
- Blank required-field fallbacks so a real-data row with a blank
  Description doesn't get rejected (`wincraft.addon.name` falls back to
  `addon_code`, then `group_code`+`color`).
- A synthetic `price` column mirrored from `white_price` when the user
  only mapped White Price — `price` is what BOM/quote totals actually read.
- Dropping fully-blank template/filler rows the source spreadsheets pad
  with (checked against whichever identifying columns were mapped, not
  every column — mirrors each removed wizard's original skip rule).
- `wincraft.glass.lite.thickness`: an unrecognised `MIL` value clamps to
  `4mm` instead of failing the row.
- `wincraft.window.type`: `Max/Min Wid/Ht` inches → mm (×25.4, rounded) —
  the model stores mm, the source catalog gives inches.

Category assignment for `wincraft.addon` needs **no code** — Odoo's
"Import records" screen already forwards the current list view's context,
and `wincraft_addon_action_option`/`_grill` already carry
`default_category_id` — the same mechanism that pre-fills Category on
"New" from those filtered lists. Import from the generic (unfiltered)
Add-on list and Category stays whatever the user maps or blank (the field
is optional, not required — see `docs/DECISIONS.md` 2026-07-24).

One accepted trade-off: dropping blank rows before calling
`super().load()` means any per-row error messages Odoo reports reference
positions in the already-filtered list, not the original file's line
numbers. Native import has no per-row line-number channel to preserve
otherwise; this was judged an acceptable cost for not needing a dedicated
wizard per source file.

`data/base_import_mapping_data.xml` pre-seeds `base_import.mapping`
(Odoo core's own "remember my last column↔field choice per model" table)
with the known header→field pairs for all 4 recurring supplier files
(Options/Grill → `wincraft.addon`, glass pane → `wincraft.glass.lite`,
window types → `wincraft.window.type`), keyed by `column_name.strip().lower()`
(confirmed against `base_import`'s own JS — it lowercases/trims column
names before ever reaching the Python side, so seeding anything other than
lowercase silently never matches). This means these 4 files' columns
auto-map correctly on the **very first** load, not just after one manual
run — no wizard, no per-import re-mapping. If a 5th recurring catalog CSV
shows up, add its header→field pairs here rather than making the user
re-map by hand every time.

## Architecture notes

- Naming/`_ext.py` convention: `docs/CODING_STANDARDS.md`.
- Data flow between these models: `docs/ARCHITECTURE.md` "Data flow" and
  "Post-fabrication subsystem."
- Full domain vocabulary: `docs/GLOSSARY.md`.

## Security considerations

Every model here needs a matching row in `security/ir.model.access.csv` —
see `security/README.md`. Models exposing pricing/margin data are gated to
`group_wincraft_sales`+ (Fabricator group has no pricing visibility).

## Testing strategy

Pricing, BOM/deductions, cutlist, and profile-optimiser logic has test
coverage (`tests/`). Everything else in this folder does not — see
`docs/TESTING.md` "Coverage gaps." New model methods with non-trivial logic
should get a `TransactionCase` test in `tests/`, following the existing
pattern.

## Common pitfalls

- Accessories are generic `wincraft.addon` rows, not per-type models — see
  `docs/adr/0002-accessories-as-generic-addon-model.md` before adding a new
  model for what might already exist.
- `wincraft_ai_assistant.py`'s in-module suggestion engine is unrelated to
  the external Anthropic API call in `controllers/main.py` — don't confuse
  the two when working on "AI" features.

## Parent / related

- Parent: [`wincraft_studio/README.md`](../README.md)
- Related: [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md),
  [`docs/GLOSSARY.md`](../../docs/GLOSSARY.md),
  [`docs/CODING_STANDARDS.md`](../../docs/CODING_STANDARDS.md),
  [`../controllers/README.md`](../controllers/README.md),
  [`../security/README.md`](../security/README.md),
  [`../tests/README.md`](../tests/README.md)
