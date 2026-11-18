# -*- coding: utf-8 -*-
"""
WinCraft Studio — Hardware model.
Hardware items that can be fitted to a window (handles, hinges, locks, etc.).
"""
import logging

from odoo import models, fields, api, _

_logger = logging.getLogger(__name__)

HARDWARE_CATEGORY = [
    ('handle', 'Handle'),
    ('hinge', 'Hinge'),
    ('lock', 'Lock / Multi-point Lock'),
    ('stay', 'Window Stay / Restrictor'),
    ('vent', 'Trickle Vent'),
    ('sill', 'Window Sill'),
    ('other', 'Other'),
]

HARDWARE_ROLE = [
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


class WincraftHardware(models.Model):
    """Hardware item for window fitting (Many2many on wincraft.window)."""

    _name = 'wincraft.hardware'
    _description = 'WinCraft Hardware Item'
    _order = 'category, name'
    _rec_name = 'name'

    name = fields.Char(
        string='Hardware Name',
        required=True,
        translate=True,
        help='e.g. Chrome Lever Handle, Espagnolette Lock, UPVC Hinge 13mm',
    )
    category = fields.Selection(
        selection=HARDWARE_CATEGORY,
        string='Category',
        required=True,
        default='handle',
    )
    unit_price = fields.Monetary(
        string='Unit Price',
        currency_field='currency_id',
        required=True,
        default=0.0,
        help='Fixed price added per window that includes this hardware item.',
    )
    currency_id = fields.Many2one(
        comodel_name='res.currency',
        string='Currency',
        default=lambda self: self.env.company.currency_id,
        required=True,
    )
    description = fields.Text(
        string='Description',
        translate=True,
    )
    active = fields.Boolean(
        string='Active',
        default=True,
    )
    hardware_role = fields.Selection(
        selection=HARDWARE_ROLE,
        string='Hardware Role',
        help='Functional role for dynamic UI grouping in the designer pane properties.',
    )
    opening_type_ids = fields.Many2many(
        comodel_name='wincraft.opening.type',
        string='Compatible Opening Types',
        help='Opening types this hardware is compatible with. Leave empty for all types.',
    )
    product_tmpl_id = fields.Many2one(
        comodel_name='product.template',
        string='Inventory Product',
        ondelete='set null',
        domain=[('type', 'in', ['consu', 'product'])],
        help='Real stockable product consumed when this hardware is added to a window. '
             'When set, "Generate BOM" adds a BOM line for it (qty per the standard '
             'install count for its role/opening type); when blank, this hardware is '
             'still priced on the quote but produces no BOM line — link a product so '
             'production actually pulls stock for it.',
    )

    _price_non_negative = models.Constraint('CHECK(unit_price >= 0)', 'Unit price must be non-negative.')

    def name_get(self):
        """Display as 'Category — Name' in dropdown lists."""
        category_map = dict(HARDWARE_CATEGORY)
        result = []
        for rec in self:
            cat_label = category_map.get(rec.category, rec.category)
            result.append((rec.id, f'{cat_label} — {rec.name}'))
        return result
