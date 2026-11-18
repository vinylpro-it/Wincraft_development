# -*- coding: utf-8 -*-
"""
WinCraft Studio — Add-on Category model.
Dynamic categories allow each customer to define their own accessory product lines
(e.g. Screen, Grill, Blind, Security, Ventilation, Trim).
"""
import logging

from odoo import models, fields

_logger = logging.getLogger(__name__)


class WincraftAddonCategory(models.Model):
    """Category grouping for window add-ons / accessories."""

    _name = 'wincraft.addon.category'
    _description = 'WinCraft Add-on Category'
    _order = 'sequence, name'
    _rec_name = 'name'

    name = fields.Char(
        string='Category Name',
        required=True,
        translate=True,
        help='e.g. Screen, Grill, Blind, Security',
    )
    code = fields.Char(
        string='Code',
        required=True,
        help='Unique slug used by canvas rendering (e.g. "screen", "grill", "blind", "security").',
    )
    icon = fields.Char(
        string='Icon',
        default='fa fa-puzzle-piece',
        help='Font Awesome class for UI display, e.g. "fa fa-shield".',
    )
    scope = fields.Selection(
        selection=[
            ('pane', 'Per Pane'),
            ('window', 'Per Window'),
            ('both', 'Both'),
        ],
        string='Scope',
        default='pane',
        required=True,
        help='Controls where items appear in the designer UI: '
             'Pane tab, Frame tab, or both.',
    )
    sequence = fields.Integer(
        string='Sequence',
        default=10,
    )
    description = fields.Text(
        string='Description',
        translate=True,
    )
    active = fields.Boolean(
        string='Active',
        default=True,
    )
    addon_ids = fields.One2many(
        comodel_name='wincraft.addon',
        inverse_name='category_id',
        string='Add-ons',
    )

    _sql_constraints = [
        ('code_uniq', 'UNIQUE(code)', 'Category code must be unique.'),
    ]
