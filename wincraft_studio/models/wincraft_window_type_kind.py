# -*- coding: utf-8 -*-
"""
WinCraft Studio — Window Type Kind model.
Classifies a wincraft.window.type record as a full window construction or a
shape-only entry (e.g. the existing "Arched / Shaped" type), so the Choose
Window Type wizard can group its tabs accordingly. Admin-extensible data (the
`code` field is the render-dispatch key), not a hardcoded Python Selection —
same pattern as wincraft.addon.category.code.
"""
from odoo import models, fields


class WincraftWindowTypeKind(models.Model):
    """Window-vs-shape classifier for wincraft.window.type records."""

    _name = 'wincraft.window.type.kind'
    _description = 'WinCraft Window Type Kind'
    _order = 'sequence, name'
    _rec_name = 'name'

    name = fields.Char(string='Kind Name', required=True, translate=True)
    code = fields.Char(
        string='Code',
        required=True,
        help='Unique slug used by the Choose Window Type wizard to build its '
             'tabs, e.g. "window", "shape".',
    )
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)

    _code_uniq = models.Constraint(
        'UNIQUE(code)',
        'Kind code must be unique.',
    )
