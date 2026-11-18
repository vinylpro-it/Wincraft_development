# -*- coding: utf-8 -*-
from odoo import models, fields


class WincraftGasFill(models.Model):
    _name = 'wincraft.gas.fill'
    _description = 'WinCraft Gas Fill'
    _order = 'sequence, name'
    _rec_name = 'name'

    name = fields.Char(
        string='Name',
        required=True,
        help='Display label, e.g. "Argon".',
    )
    code = fields.Char(
        string='Code',
        required=True,
        help='Technical code stored in pane config JSON, e.g. "argon".',
    )
    sequence = fields.Integer(string='Sequence', default=10)
    active = fields.Boolean(string='Active', default=True)

    _code_uniq = models.Constraint(
        'UNIQUE(code)',
        'Gas fill code must be unique.',
    )
