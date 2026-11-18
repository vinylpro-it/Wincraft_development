# `controllers/`

## Purpose

HTTP/JSON-RPC entry points — the only way the OWL frontend or the customer
portal talks to the ORM. Thin by design: business logic lives in `models/`,
controllers validate input, check access, delegate, and shape the response.

## Files

- **`main.py`** (715 lines) — canvas save/load, live-pricing RPC, cut-list
  PDF streaming, the full customer portal (list/view/accept/revision/
  tracking), the QR-scan fabrication-confirmation page, the AI natural-
  language parser, and the barcode work-centre check-in/out endpoints.
- **`product_options.py`** (159 lines) — one endpoint
  (`/wincraft/product-options`) that assembles frame/glass/spacer config and
  colour-attribute data for the canvas's dropdowns, split into four private
  loader methods (`_load_frame_configs`, `_load_glass_options`,
  `_load_spacer_options`, `_load_color_attributes`) — follow this
  one-loader-per-data-shape split for new multi-part endpoints.

## Full route list

See `docs/ARCHITECTURE.md` "Full controller route inventory" — kept in one
place to avoid drift between two copies of the same table.

## Public interfaces

Every route is `@http.route(...)` — there's no separate "public API" surface
distinct from what's declared per-route. See `docs/API_GUIDELINES.md` for the
conventions (response shape, `auth=`/`csrf=` choices, access-check placement)
every new route should follow.

## Security considerations

- `auth='user'` everywhere — no anonymous routes.
- Backend routes: `check_access_rights`/`check_access_rule` before any
  read/write.
- Portal routes: `sudo()` for the lookup (needed since a portal user has no
  direct ACL on `wincraft.project`), followed by an explicit
  `partner_id`/`commercial_partner_id` ownership check — this check *is* the
  access boundary for portal routes, not `auth='user'` alone. Never remove it.
- Barcode station routes (`/wincraft/station/scan`, `/wincraft/station/workcenters`)
  have no group-level restriction beyond `auth='user'` — tracked as KI-4 in
  `docs/KNOWN_ISSUES.md`.
- The AI-parse route sends user-provided text to a third-party API when
  configured — see `docs/SECURITY.md` "External integrations & data
  handling" before changing that code path.

## Error handling

Every method catches `AccessError` specifically (→ generic `'Access denied'`
message, never leaking Odoo's internal error text) and has a catch-all
`except Exception` that logs the full traceback
(`_logger.exception`/`.warning`) before returning a bounded error payload.
Match this shape for new routes — see `docs/CODING_STANDARDS.md` and
`docs/API_GUIDELINES.md`.

## Known gap

`ai_assistant.js`/`.xml`, the frontend component that would call
`/wincraft/ai/parse_windows`, is **not registered in the manifest's asset
list** — that endpoint currently has no UI consumer at all. See KI-5 in
`docs/KNOWN_ISSUES.md` before assuming this feature is live end-to-end.

## Testing strategy

No test coverage exists for this folder — see `docs/TESTING.md` "Coverage
gaps." This is a real gap, not an intentional exclusion.

## Parent / related

- Parent: [`wincraft_studio/README.md`](../README.md)
- Related: [`docs/API_GUIDELINES.md`](../../docs/API_GUIDELINES.md),
  [`docs/SECURITY.md`](../../docs/SECURITY.md),
  [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md),
  [`../models/README.md`](../models/README.md),
  [`../static/src/README.md`](../static/src/README.md)
