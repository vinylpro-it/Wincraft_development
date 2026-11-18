# -*- coding: utf-8 -*-
"""
WinCraft Studio — Glass Type model.
Stores glass specifications, thermal values, and pricing rate per sqm.
"""
import logging

from odoo import models, fields, api, _
from odoo.exceptions import ValidationError

_logger = logging.getLogger(__name__)


class WincraftGlassType(models.Model):
    """Glass type specification (e.g. Single 4mm, Double Glazed, Low-E Triple)."""

    _name = 'wincraft.glass.type'
    _description = 'WinCraft Glass Type'
    _order = 'name'
    _rec_name = 'name'

    name = fields.Char(
        string='Glass Type Name',
        required=True,
        translate=True,
        help='e.g. Single 4mm Clear, Double Glazed 24mm, Low-E Triple',
    )
    rate_per_sqm = fields.Float(
        string='Rate per sqm',
        required=True,
        digits=(12, 2),
        default=0.0,
        help='Additional glass cost per square metre on top of frame material cost.',
    )
    u_value = fields.Float(
        string='U-Value (W/m²·K)',
        digits=(6, 3),
        default=0.0,
        help='Thermal transmittance — lower is better insulation.',
    )
    shgc = fields.Float(
        string='SHGC',
        digits=(6, 3),
        default=0.0,
        help='Solar Heat Gain Coefficient (0.0–1.0).',
    )
    description = fields.Text(
        string='Description',
        translate=True,
    )
    active = fields.Boolean(
        string='Active',
        default=True,
    )
    glass_opacity = fields.Float(
        string='Designer Opacity',
        digits=(4, 2),
        default=0.15,
        help='SVG fill opacity for glass pane in the designer canvas (0.10–0.40).',
    )
    window_count = fields.Integer(
        string='Windows Using This Glass',
        compute='_compute_window_count',
    )

    _name_unique = models.Constraint('UNIQUE(name)', 'A glass type with this name already exists.')
    _rate_non_negative = models.Constraint('CHECK(rate_per_sqm >= 0)', 'Rate per sqm must be non-negative.')
    _u_value_non_negative = models.Constraint('CHECK(u_value >= 0)', 'U-Value must be non-negative.')
    _shgc_range = models.Constraint('CHECK(shgc >= 0 AND shgc <= 1)', 'SHGC must be between 0 and 1.')
    _opacity_range = models.Constraint('CHECK(glass_opacity >= 0.05 AND glass_opacity <= 0.50)', 'Designer opacity must be between 0.05 and 0.50.')

    @api.depends('name')
    def _compute_window_count(self):
        """Count windows using this glass type."""
        for record in self:
            record.window_count = self.env['wincraft.window'].search_count(
                [('glass_type_id', '=', record.id)]
            )

    def action_view_windows(self):
        """Open list of windows using this glass type."""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Windows — %s') % self.name,
            'res_model': 'wincraft.window',
            'view_mode': 'list,form',
            'domain': [('glass_type_id', '=', self.id)],
        }
