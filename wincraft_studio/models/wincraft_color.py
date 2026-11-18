# -*- coding: utf-8 -*-
"""
WinCraft Studio — Color model.
Reference catalog of vendor frame/finish color names (WS-15) — e.g. Gentek,
Kaycan, and a Stain line. Pure lookup data for now: no price field yet (the
CSV upload description mentions pricing, but the user explicitly deferred
it — see docs/sprints/SPRINT_2.md). Consumed by the canvas vendor-colour
picker (properties_panel.js's "Vendor Colour" block, scoped 2026-09-23 — see
docs/sprints/SPRINT_2.md WS-17 scope) via `inside_vendor_color_id` /
`outside_vendor_color_id` on `wincraft.window`.

WS-15 originally shipped this as two models (`wincraft.color.vendor` +
`wincraft.color`). Collapsed to a single model on 2026-09-23 per explicit
user instruction ("all color csv files will have same columns only, keep
only one model... track vendor name, add one more column") — the vendor
classifier model was removed and `vendor_id` replaced with a free-text
`vendor` Char below. A free-text field (not a hardcoded Selection) was
chosen so a new vendor's CSV still imports with zero code changes.

Populated via Odoo's native "Import records" screen, from the single
"Colors" Configuration menu entry (no more per-vendor filtered views).
Since the source CSVs (VPR058/059/060) don't carry a vendor column
themselves, either add one before importing (a "Vendor" column filled with
"Gentek"/"Kaycan"/"Stain" for every row auto-maps to the `vendor` field by
name — no base_import.mapping entry needed for it), or use the "Import
Colors" menu item (`wizards/wincraft_color_import_wizard.py`) — a one-field
prompt that seeds `default_vendor` in the native import screen's context
for you, so an unmapped "vendor" column falls back to what you typed
instead of blocking. Re-uploading an updated CSV updates existing rows
matched by (vendor, name) instead of duplicating them (see `load()` below)
— per the original explicit user instruction ("normal odoo import and
update records based on names"), now scoped by vendor+name since a single
import can span more than one vendor's rows.
"""
import logging

from odoo import models, fields, api

_logger = logging.getLogger(__name__)


class WincraftColor(models.Model):
    """A single vendor color/finish entry."""

    _name = 'wincraft.color'
    _description = 'WinCraft Color'
    _order = 'vendor, sequence, code'
    _rec_name = 'name'

    vendor = fields.Char(
        string='Vendor',
        required=True,
        index=True,
        help='Supplier/vendor name for this color (e.g. "Gentek", "Kaycan", '
             '"Stain"). Free text, not a separate model — see the module '
             'docstring for why.',
    )
    code = fields.Char(
        string='Vendor Code',
        help='The vendor\'s own sequence/reference number for this color '
             '(source CSV column "<Vendor> No"). Not guaranteed unique or '
             'stable across catalog revisions — do not treat as a primary key.',
    )
    name = fields.Char(
        string='Description',
        required=True,
        help='Color/finish name as given by the vendor (source CSV column '
             '"Description").',
    )
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)

    @api.model
    def load(self, fields, data):
        fields, data = self._normalize_csv_import(fields, data)
        return super().load(fields, data)

    def _normalize_csv_import(self, fields, data):
        """Skip blank filler rows and update-in-place on a (vendor, name) match.

        The source catalogs pad every sheet out to a fixed row count
        (e.g. 999 rows) with no data past the real entries — skip any row
        with a blank "name" (Description) column. For rows that do have a
        name, resolve a vendor for the row (its own "vendor" column if the
        CSV carries one, else the import context's `default_vendor` — set
        by the "Import Colors" wizard, `wincraft_color_import_wizard.py`),
        then look up an existing color for that (vendor, name) pair and
        update it in place rather than creating a duplicate, so re-uploading
        a vendor's refreshed price list doesn't pile up old entries.

        Known caveat, not silently glossed over: at least one real source
        file (Gentek) has a handful of rows sharing the same Description
        with a different vendor "No" (e.g. "ALMOND 532" appears twice) —
        matching by name is what was explicitly requested, so on a
        collision the first existing match found is updated and any
        further same-named rows create new records instead.
        """
        col = {f: i for i, f in enumerate(fields) if f and '/' not in f}
        name_idx = col.get('name')
        code_idx = col.get('code')
        vendor_idx = col.get('vendor')

        kept = [row for row in data if name_idx is None or row[name_idx].strip()]
        if name_idx is None:
            return fields, kept

        default_vendor = self.env.context.get('default_vendor')

        def row_vendor(row):
            if vendor_idx is not None and row[vendor_idx].strip():
                return row[vendor_idx].strip()
            return default_vendor

        existing_by_key = {}
        for rec in self.search([]):
            existing_by_key.setdefault((rec.vendor, rec.name), rec.id)

        create_rows = []
        for row in kept:
            key = (row_vendor(row), row[name_idx].strip())
            match_id = existing_by_key.get(key) if key[0] else None
            if match_id:
                vals = {}
                if code_idx is not None:
                    vals['code'] = row[code_idx].strip()
                self.browse(match_id).write(vals)
            else:
                create_rows.append(row)

        return fields, create_rows
