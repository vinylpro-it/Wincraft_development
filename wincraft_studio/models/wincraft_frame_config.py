# -*- coding: utf-8 -*-
"""
WinCraft Studio — Frame Config model.

Maps a canvas opening type + profile type → a real Odoo product.template
(i.e. the frame product such as CS-L, AW, DH, etc.).

Admin sets these up once per profile family so that when a designer uses
an opening type in WinCraft Studio, the system knows which frame product
to put on the BOM / Sale Order.
"""
import logging

from odoo import models, fields, api, _
from odoo.exceptions import ValidationError

_logger = logging.getLogger(__name__)


class WincraftFrameConfig(models.Model):
    """Maps a WinCraft canvas opening type + profile type to a frame product."""

    _name = 'wincraft.frame.config'
    _inherit = ['mail.thread']
    _description = 'WinCraft Frame Product Configuration'
    _order = 'profile_type_id, opening_type'
    _rec_name = 'display_name'

    opening_type = fields.Selection(
        selection=lambda self: self.env['wincraft.opening.type']._selection_opening_type(),
        string='Opening Type',
        required=True,
        tracking=True,
        help='The opening type as used in the WinCraft Studio canvas.',
    )
    profile_type_id = fields.Many2one(
        comodel_name='wincraft.window.type.series',
        string='Profile Type',
        required=True,
        ondelete='cascade',
        tracking=True,
        help='The profile type (brand/series) this mapping applies to.',
    )
    product_tmpl_id = fields.Many2one(
        comodel_name='product.template',
        string='Frame Product',
        required=True,
        ondelete='restrict',
        domain=[('type', 'in', ['consu', 'product'])],
        tracking=True,
        help='The frame product template to use in BOMs and Sale Orders.',
    )
    product_code = fields.Char(
        related='product_tmpl_id.default_code',
        string='Product Code',
        store=True,
        readonly=True,
    )
    default_attr_values = fields.Json(
        string='Default Attribute Values',
        default=dict,
        help='JSON dict mapping attribute IDs to default attribute-value IDs, '
             'e.g. {"5": 11, "8": 20}. Used to pre-select dropdowns when this frame config is active.',
    )

    active = fields.Boolean(default=True)
    notes = fields.Text(string='Notes')

    display_name = fields.Char(
        string='Display Name',
        compute='_compute_display_name',
        store=True,
    )

    # v19: use models.Constraint instead of _sql_constraints
    _unique_opening_type_profile = models.Constraint(
        'UNIQUE(opening_type, profile_type_id)',
        'A frame product mapping already exists for this opening type + profile type combination.',
    )

    @api.depends('opening_type', 'profile_type_id', 'product_tmpl_id')
    def _compute_display_name(self):
        ot_labels = dict(self.env['wincraft.opening.type']._selection_opening_type())
        for rec in self:
            ot = ot_labels.get(rec.opening_type, rec.opening_type or '?')
            ps = rec.profile_type_id.name or '?'
            prod = rec.product_tmpl_id.default_code or rec.product_tmpl_id.name or '?'
            rec.display_name = f'{ot} / {ps} → {prod}'

    @api.constrains('opening_type', 'profile_type_id', 'product_tmpl_id')
    def _check_required_fields(self):
        for rec in self:
            if not rec.opening_type or not rec.profile_type_id or not rec.product_tmpl_id:
                raise ValidationError(_('Opening type, profile type, and frame product are all required.'))

    # ── Dynamic attribute reading ─────────────────────────────────────────────

    def get_product_attributes(self):
        """Read product attributes from the linked product template.

        Returns a list of dicts:
        [
            {
                "attr_id": 5, "name": "Inside Color",
                "values": [{"id": 10, "name": "White"}, {"id": 11, "name": "Black"}],
                "default_value_id": 11
            },
            ...
        ]
        """
        self.ensure_one()
        tmpl = self.product_tmpl_id
        if not tmpl:
            return []

        defaults = self.default_attr_values or {}
        result = []
        for line in tmpl.attribute_line_ids.sorted('sequence'):
            attr = line.attribute_id
            values = [
                {'id': v.id, 'name': v.name}
                for v in line.value_ids.sorted('sequence')
            ]
            if not values:
                continue
            default_id = defaults.get(str(attr.id))
            if default_id and not any(v['id'] == default_id for v in values):
                default_id = values[0]['id']
            if not default_id:
                default_id = values[0]['id']
            result.append({
                'attr_id': attr.id,
                'name': attr.name,
                'values': values,
                'default_value_id': default_id,
            })
        return result

    def get_variant_map(self):
        """Build a mapping of sorted attribute-value IDs → product.product variant ID.

        Returns dict like: {"10,20": 456, "11,21": 457}
        """
        self.ensure_one()
        tmpl = self.product_tmpl_id
        if not tmpl:
            return {}
        variant_map = {}
        for variant in tmpl.product_variant_ids:
            val_ids = sorted(
                variant.product_template_attribute_value_ids.mapped(
                    'product_attribute_value_id'
                ).ids
            )
            if val_ids:
                key = ','.join(str(v) for v in val_ids)
                variant_map[key] = variant.id
        return variant_map
