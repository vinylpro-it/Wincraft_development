# -*- coding: utf-8 -*-
from odoo import models, fields


class WincraftSpacerType(models.Model):
    _name = 'wincraft.spacer.type'
    _description = 'WinCraft Spacer Type'
    _order = 'sequence, name'
    _rec_name = 'name'

    name = fields.Char(
        string='Name',
        required=True,
        help='Display label, e.g. "Warm Edge".',
    )
    code = fields.Char(
        string='Code',
        required=True,
        help='Technical code stored in pane config JSON, e.g. "warm_edge".',
    )
    sequence = fields.Integer(string='Sequence', default=10)
    active = fields.Boolean(string='Active', default=True)

    _code_uniq = models.Constraint(
        'UNIQUE(code)',
        'Spacer type code must be unique.',
    )
