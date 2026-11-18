# -*- coding: utf-8 -*-
"""
WinCraft Studio — Opening Type master data.

Each record defines an opening type (casement-l, awning, sliding, etc.)
together with the hardware roles and pill-field UI controls relevant
to that type.  The properties panel reads these at runtime to render
a fully dynamic "Opening" section per pane.
"""
from odoo import models, fields, api

HARDWARE_ROLE_SELECTION = [
    ('hinge', 'Hinge'),
    ('handle', 'Handle'),
    ('lock', 'Lock'),
    ('operator', 'Operator / Crank'),
    ('balance', 'Balance'),
    ('stay', 'Stay / Restrictor'),
    ('restrictor', 'Restrictor'),
    ('track', 'Track System'),
    ('other', 'Other'),
]


class WincraftOpeningType(models.Model):
    _name = 'wincraft.opening.type'
    _description = 'WinCraft Opening Type'
    _order = 'sequence, key'
    _rec_name = 'name'

    name = fields.Char(string='Name', required=True, translate=True)
    key = fields.Char(
        string='Key',
        required=True,
        help='Matches the JS opening-type key, e.g. "casement-l".',
    )
    hardware_roles = fields.Char(
        string='Hardware Roles',
        help='Comma-separated hardware roles shown for this type, e.g. "hinge,handle,lock,stay".',
    )
    pill_fields = fields.Char(
        string='Pill Fields',
        help='Comma-separated pill-button fields for this type, e.g. "hingeSide" or "foldDirection".',
    )
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)

    _key_uniq = models.Constraint(
        'UNIQUE(key)',
        'Opening type key must be unique.',
    )

    @api.model
    def _selection_opening_type(self):
        """Selection source for any `opening_type` field across the module.

        Lets `wincraft.frame.config`, `wincraft.deduction.formula`, etc. read
        opening types from this table instead of a hardcoded list, so adding
        a new opening type only requires a new record here.
        """
        return [(rec.key, rec.name) for rec in self.search([], order='sequence')]
