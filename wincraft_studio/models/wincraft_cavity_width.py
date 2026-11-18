# -*- coding: utf-8 -*-
from odoo import models, fields


class WincraftCavityWidth(models.Model):
    _name = 'wincraft.cavity.width'
    _description = 'WinCraft Cavity Width'
    _order = 'sequence, width_mm'
    _rec_name = 'name'

    name = fields.Char(
        string='Name',
        required=True,
        help='Display label, e.g. "16 mm".',
    )
    width_mm = fields.Integer(
        string='Width (mm)',
        required=True,
        help='Cavity width in millimetres.',
    )
    sequence = fields.Integer(string='Sequence', default=10)
    active = fields.Boolean(string='Active', default=True)
