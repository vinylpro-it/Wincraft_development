# `data/`

## Purpose

Seed/reference XML data loaded on install — taxes, units of measure,
manufacturing/delivery config, opening/window type catalogs, glass config,
paint products, standard templates, and the email/WhatsApp/automation
records that depend on report actions existing first.

## Files (in manifest load order)

| File | Contents |
|---|---|
| `uom_data.xml` | Units of measure |
| `canadian_tax_data.xml` | Canadian tax rates (current seed data's tax jurisdiction — not a hardcoded assumption elsewhere in the code, just what's seeded) |
| `manufacturing_data.xml` | Manufacturing config |
| `delivery_data.xml` | Delivery config |
| `opening_type_data.xml` | Opening type catalog (casement, awning, fixed, etc.) |
| `window_type_data.xml` | Window type catalog |
| `wincraft_data.xml` | Core seed data — includes `wincraft.addon.category` records (e.g. `addon_cat_grill`) and `wincraft.addon` records (e.g. grill/screen/blind options) — **check here before assuming a new accessory type needs a new model**, see `docs/adr/0002-*.md` |
| `wincraft_paint_product_data.xml` | Paint product options |
| `standard_templates.xml` | Reusable window configuration templates |
| `wincraft_email_template.xml` | Quote email template (loads after report actions — attaches the quote PDF) |
| `wincraft_whatsapp_template.xml` | WhatsApp share message template |
| `wincraft_automated_actions.xml` | `base.automation` records |
| `wincraft_onboarding.xml` | Go-live/onboarding checklist seed data |

`demo/wincraft_demo.xml` is separate (loaded via the manifest's `demo` key,
not `data`) — sample records for a fresh non-production install, not
referenced elsewhere; not given its own README since it's a single file with
no internal structure to document beyond "demo data."

## Load-order dependency

This folder's files split across two positions in the manifest: most load
right after `security/`, but three (`wincraft_email_template.xml`,
`wincraft_whatsapp_template.xml`, `wincraft_automated_actions.xml`,
`wincraft_onboarding.xml`) load **after** `report/` because they reference
report actions. See `docs/ARCHITECTURE.md` "Module load order" — don't move
a new data file earlier than the last thing it references.

## Parent / related

- Parent: [`wincraft_studio/README.md`](../README.md)
- Related: [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md),
  [`docs/adr/0002-accessories-as-generic-addon-model.md`](../../docs/adr/0002-accessories-as-generic-addon-model.md),
  [`../report/README.md`](../report/README.md)
