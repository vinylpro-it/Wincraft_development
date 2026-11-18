# -*- coding: utf-8 -*-
from odoo import models, fields


class WincraftGlassTint(models.Model):
    _name = 'wincraft.glass.tint'
    _description = 'WinCraft Glass Tint'
    _order = 'sequence, name'
    _rec_name = 'name'

    name = fields.Char(
        string='Name',
        required=True,
        help='Display label, e.g. "Bronze".',
    )
    code = fields.Char(
        string='Code',
        required=True,
        help='Technical code stored in pane config JSON, e.g. "bronze".',
    )
    hex_colour = fields.Char(
        string='Hex Colour',
        required=True,
        help='CSS hex colour for the swatch, e.g. "#c4a35a".',
    )
    sequence = fields.Integer(string='Sequence', default=10)
    active = fields.Boolean(string='Active', default=True)

    _code_uniq = models.Constraint(
        'UNIQUE(code)',
        'Glass tint code must be unique.',
    )
