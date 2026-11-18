# `views/`

## Purpose

42 XML files defining the Odoo backend UI (form/list/kanban/pivot/search
views + menus) plus one portal-template file and one asset-bundle file.
Views are grouped roughly by domain: catalog/config (material, glass,
hardware, profile system, opening/window type), core transactional
(project, window), commerce (dealer, dealer commission, analytics), and
operations (delivery, branch, inventory, production, cutlist).

## Structure notes

- **`wincraft_menus.xml`** must stay last in the manifest's `data` list — it
  references actions defined by every other view file.
- **`wincraft_window_ext_views.xml`** and other `*_ext_views.xml`-style files
  extend views defined earlier (e.g. adding a smart button that depends on a
  wizard action) — they're deliberately loaded after `wizards/` in the
  manifest for that reason. See `docs/ARCHITECTURE.md` "Module load order."
- **`wincraft_assets.xml`** is not a UI view — it's an asset-related XML
  record; don't confuse it with a form/list view when scanning this folder.
- **`portal_wincraft_templates.xml`** — the customer-portal QWeb templates
  rendered by `controllers/main.py`'s portal routes.
- **`res_config_settings_views.xml`** — extends Odoo's Settings screen with
  WinCraft-specific config (pairs with `models/res_config_settings_ext.py`).

## Chatter convention (load-bearing — read before adding a new chatter)

Use `<chatter/>` (Odoo 17+'s built-in element), never the old raw
`<div class="oe_chatter"><field name="message_follower_ids"/>...</div>`
pattern. Three views (`wincraft_project_views.xml`,
`wincraft_dealer_commission_views.xml`, `wincraft_dealer_views.xml`) had the
old pattern with unwidgeted fields, which Odoo rendered as full raw
one2many tables that broke at non-default browser zoom — fixed 2026-07-22.
See the "Resolved" section of `docs/KNOWN_ISSUES.md` for the full story.
Grep for `message_follower_ids` with no `widget=` before assuming a new view
is safe if you're copying an older view as a starting template.

## Notebook / group patterns observed

- Multi-tab detail forms (`wincraft_project_views.xml`) use `<notebook>` with
  named `<page>` elements (`name="windows"`, `name="canvas"`, etc.) — keep
  `name=` attributes stable, other views/inherited views may target a
  specific page by name.
- Two-column field groups: `<group><group>...</group><group>...</group></group>`
  is the standard layout for a form's main field area (see
  `wincraft_project_views.xml`'s main info block and Pricing section).

## Security considerations

Views don't enforce security themselves — field/button visibility via
`groups="wincraft_studio.group_wincraft_*"` attributes is a UX convenience,
**not** the actual access boundary (that's `security/ir.model.access.csv` +
record rules). Don't rely on hiding a field in a view as the only protection
for sensitive data — see `security/README.md`.

## Common pitfalls

- Reordering the manifest's `data` list without understanding the
  security → data → reports → data-depending-on-reports → views → wizards →
  extension-views → menus ordering will break install — see
  `docs/ARCHITECTURE.md`.

## Parent / related

- Parent: [`wincraft_studio/README.md`](../README.md)
- Related: [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md),
  [`docs/KNOWN_ISSUES.md`](../../docs/KNOWN_ISSUES.md),
  [`../security/README.md`](../security/README.md),
  [`../models/README.md`](../models/README.md)
