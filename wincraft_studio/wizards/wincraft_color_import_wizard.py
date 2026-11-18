# -*- coding: utf-8 -*-
"""
WinCraft Studio — Color Import Wizard.

A one-field front door onto Odoo's native "Import records" screen for
`wincraft.color`. The source vendor CSVs (VPR058/059/060) carry no Vendor
column of their own, so a plain native import leaves that required field
unmapped and blocks. Typing the vendor here doesn't parse the file itself —
it only seeds `default_vendor` on the import screen's context, the same
context key `wincraft.color`'s `load()` override already reads for any row
whose own "vendor" column (if the file has one) is blank. See
`models/wincraft_color.py`'s docstring for the read side of this.

Kept deliberately thin (no file field, no CSV parsing) so this doesn't
reintroduce the bespoke upload-wizard pattern retired 2026-07-24 — see
`wizards/README.md`. The actual import still runs entirely through Odoo's
stock `base_import.import` client action.
"""
from odoo import models, fields


class WincraftColorImportWizard(models.TransientModel):
    """Captures a vendor name, then hands off to the native import screen."""

    _name = 'wincraft.color.import.wizard'
    _description = 'Import Colors — Vendor Prompt'

    vendor = fields.Char(
        string='Vendor',
        required=True,
        help='Supplier/vendor name to use for every row in the file you are '
             'about to upload (e.g. "Gentek", "Kaycan", "Stain"). Only '
             'needed because the source CSVs don\'t carry their own Vendor '
             'column — if a file does have one, its value wins per row.',
    )

    def action_open_import(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.client',
            'tag': 'import',
            'params': {
                'active_model': 'wincraft.color',
                'context': {'default_vendor': self.vendor},
            },
        }
