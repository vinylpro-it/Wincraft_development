# -*- coding: utf-8 -*-
"""
WinCraft Studio — Brickmould model.
Small admin-manageable catalog for brickmould types (WS-17's "Brickmould
type" field on the Window Configuration popup) — same minimal shape as
`wincraft.color` (name/code/sequence/active, no CSV import path since no
source file exists for it). Brickmould colour reuses the existing
`wincraft.color` catalog instead of a colour field on this model — see
`wincraft.window.brickmould_colour_id`'s docstring for why.
"""
from odoo import models, fields


class WincraftBrickmould(models.Model):
    """A single brickmould type entry (e.g. "1-1/4\"", "2\"", "Nailfin")."""

    _name = 'wincraft.brickmould'
    _description = 'WinCraft Brickmould Type'
    _order = 'sequence, name'
    _rec_name = 'name'

    name = fields.Char(
        string='Name',
        required=True,
        help='Brickmould type name/size (e.g. "1-1/4\"", "2\"").',
    )
    code = fields.Char(
        string='Code',
        help='Optional short reference code for this brickmould type.',
    )
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
