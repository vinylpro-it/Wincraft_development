# `security/`

## Purpose

The actual access-control boundary for this addon (views hiding a field is
UX only — this folder is enforcement). Three files, loaded first in the
manifest (before any data/views), in dependency order.

## Files

1. **`wincraft_groups.xml`** — defines the four `res.groups`:

   | Group | Inherits | Capability |
   |---|---|---|
   | `group_wincraft_viewer` | — | Read-only: projects, windows, catalogue |
   | `group_wincraft_fabricator` | — (independent) | View/update fabrication status on assigned projects only; no pricing/quote access |
   | `group_wincraft_sales` | Viewer | Create/edit projects, configure windows, generate quotes |
   | `group_wincraft_admin` | Sales (→ Viewer) | Full access: catalogue, pricing rules, fabricators, all projects |

2. **`ir.model.access.csv`** (195 rows) — per-model, per-group CRUD flags.
   Every model in `models/` needs a row here or it's completely inaccessible
   (not even readable) to every group, including Admin.

3. **`wincraft_security.xml`** — record rules (row-level filtering on top of
   the model-level CRUD flags above) — e.g. restricting Fabricator visibility
   to assigned projects only.

## How to add a new model's ACL correctly

1. Add the model in `models/`.
2. Add one row per group that needs access in `ir.model.access.csv`
   (`access_<model>_<group>,<model description>,model_<model_underscored>,<group_xml_id>,<read>,<write>,<create>,<unlink>`).
   Missing this step is the single most common "why can't I see my new
   field/model" bug when adding something new.
3. If the model needs row-level filtering beyond flat CRUD (e.g. "only your
   own records"), add a record rule in `wincraft_security.xml`.
4. If a controller touches the model, it must still call
   `check_access_rights`/`check_access_rule` explicitly — the CSV/record
   rules don't automatically protect direct ORM calls from `sudo()`-using
   code (see `controllers/README.md`).

## Security considerations

- This is the layer `docs/SECURITY.md`'s "Authorization model" section
  describes in narrative form — read that for the full picture, including
  open issues (KI-1, KI-4) that touch this area.
- Server-side controller endpoints additionally enforce access — the CSV/
  record rules are necessary but not sufficient on their own for
  `sudo()`-using portal code (see `controllers/README.md`).

## Parent / related

- Parent: [`wincraft_studio/README.md`](../README.md)
- Related: [`docs/SECURITY.md`](../../docs/SECURITY.md),
  [`docs/KNOWN_ISSUES.md`](../../docs/KNOWN_ISSUES.md),
  [`../controllers/README.md`](../controllers/README.md),
  [`../models/README.md`](../models/README.md)
