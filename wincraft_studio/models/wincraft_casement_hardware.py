# -*- coding: utf-8 -*-
"""
WinCraft Studio — Casement Hardware model.
Small admin-managed price list (ID, Description, Price) feeding the
"Casement hardware" multi-select on the Window Configuration popup. Kept
separate from `wincraft.hardware` (per-pane hardware with roles/opening
types) on explicit request — the window's casement hardware is its own list.
"""
from odoo import models, fields


class WincraftCasementHardware(models.Model):
    """One casement hardware item: ID, Description, Price."""

    _name = 'wincraft.casement.hardware'
    _description = 'WinCraft Casement Hardware'
    _order = 'sequence, code, name'
    _rec_name = 'name'

    code = fields.Char(string='ID', required=True, index=True, help='Hardware reference ID / part number.')
    name = fields.Char(string='Description', required=True, translate=True)
    price = fields.Monetary(string='Price', currency_field='currency_id', default=0.0)
    currency_id = fields.Many2one(
        comodel_name='res.currency',
        string='Currency',
        default=lambda self: self.env.company.currency_id,
        required=True,
    )
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)

    _price_non_negative = models.Constraint('CHECK(price >= 0)', 'Price must be non-negative.')
