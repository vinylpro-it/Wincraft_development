# -*- coding: utf-8 -*-
"""
Pre-migration: fold wincraft.color.vendor into wincraft.color.vendor (Char).

WS-15 originally shipped `wincraft.color` with a `vendor_id` Many2one to a
separate `wincraft.color.vendor` classifier model. Collapsed to a single
model on 2026-09-23 per explicit user instruction — the vendor model is
removed and `vendor_id` replaced with a free-text `vendor` Char (see
wincraft_color.py's docstring).

The old model class is gone from the registry, so this can't go through the
ORM (`env['wincraft.color.vendor']` no longer resolves) — raw SQL against
the still-present `wincraft_color_vendor` table and `wincraft_color.
vendor_id` column, before Odoo's schema sync for this module runs. Odoo
doesn't auto-drop orphaned columns/tables, so this is idempotent and safe to
re-run — it's a no-op once `vendor` is populated or the legacy objects are
already gone (e.g. a fresh install that never had them).
"""
import logging

_logger = logging.getLogger(__name__)


def migrate(cr, version):
    cr.execute("SELECT to_regclass('public.wincraft_color')")
    if not cr.fetchone()[0]:
        return  # fresh install, nothing to migrate

    cr.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'wincraft_color'
    """)
    columns = {row[0] for row in cr.fetchall()}
    if 'vendor_id' not in columns:
        return  # already migrated (or never had the old shape)

    if 'vendor' not in columns:
        cr.execute("ALTER TABLE wincraft_color ADD COLUMN vendor varchar")

    cr.execute("SELECT to_regclass('public.wincraft_color_vendor')")
    if cr.fetchone()[0]:
        cr.execute("""
            UPDATE wincraft_color c
            SET vendor = v.name
            FROM wincraft_color_vendor v
            WHERE c.vendor_id = v.id AND c.vendor IS NULL
        """)
        _logger.info(
            'wincraft_studio migration: copied wincraft_color.vendor_id -> '
            'vendor (Char) from wincraft_color_vendor before the vendor '
            'model was removed.',
        )
