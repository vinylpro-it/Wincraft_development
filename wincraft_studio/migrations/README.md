# `migrations/`

## Purpose

Per-version data-migration scripts, run automatically by Odoo when the
module's `version` in `__manifest__.py` is bumped and the module is upgraded
(`-u wincraft_studio`).

## Contents

```
migrations/
├── 19.0.2.1.0/post-migrate.py
├── 19.0.2.2.0/post-migrate.py
├── 19.0.2.3.0/post-migrate.py
├── 19.0.2.4.0/post-migrate.py
└── 19.0.2.13.0/pre-migrate.py
```

Versions between `19.0.2.5.0` and `19.0.2.12.0` have **no** migration
folder — those bumps didn't require a data migration. Don't assume a
missing folder for a given version is an oversight; confirm whether the
change actually needs one before adding an empty script.

## Convention

Folder name must exactly match the manifest version string being migrated
*to*. `post-migrate.py` runs after the new module code is loaded, via the
ORM — that only works if the models involved still exist in the registry
after the upgrade. `19.0.2.13.0/pre-migrate.py` is this addon's first use of
`pre-migrate.py`: it runs *before* the new code loads, using raw SQL,
because that migration (folding `wincraft.color.vendor` into a Char field on
`wincraft.color`) needed to read from a model class that the same change was
deleting — `post-migrate` would have been too late to resolve it via
`env[...]`. Reach for `pre-migrate.py` + raw SQL specifically for that
case (a migration that needs data from a model/field being removed in the
same version); otherwise prefer `post-migrate.py` + the ORM, as the four
examples above do. See `docs/DATABASE.md` "Migrations" for the
rollback-strategy caveat — there is no automated down-migration; take a
manual database backup before running any migration that transforms or
deletes data.

## Parent / related

- Parent: [`wincraft_studio/README.md`](../README.md)
- Related: [`docs/DATABASE.md`](../../docs/DATABASE.md),
  [`docs/TROUBLESHOOTING.md`](../../docs/TROUBLESHOOTING.md)
