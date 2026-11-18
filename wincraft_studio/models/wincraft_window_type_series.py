# -*- coding: utf-8 -*-
"""
WinCraft Studio — Profile Type model.

The single "Profile Type" catalog (e.g. Classic 70, Prestige 90, SlimLine 40).
It is the former Window Type Series list merged with the former Profile System
model (2026-11): one record carries the material family, available depths,
mullion properties, weight/span limits, thermal data and extrusion rate that
drive BOM, deductions, frame configs and design rules, and it also groups
window types in the Choose Window Type wizard.

The technical model name `wincraft.window.type.series` is kept to avoid a
table/ir.model rename; user-facing labels and field names say "Profile Type".
"""
from odoo import models, fields, api


class WincraftWindowTypeSeries(models.Model):
    """A profile type: engineering data plus a grouping label for window types."""

    _name = 'wincraft.window.type.series'
    _description = 'WinCraft Profile Type'
    _order = 'sequence, name'
    _rec_name = 'name'

    name = fields.Char(
        string='Profile Type',
        required=True,
        translate=True,
        help='e.g. Classic 70, Prestige 90, SlimLine 40',
    )
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    material_type = fields.Selection(
        selection=[
            ('upvc', 'uPVC'),
            ('aluminium', 'Aluminium'),
            ('timber', 'Timber'),
            ('composite', 'Composite'),
            ('steel', 'Steel'),
        ],
        string='Material Family',
        required=True,
        default='upvc',
    )
    available_depths = fields.Json(
        string='Available Depths (mm)',
        default=[40, 70, 90],
        help='JSON array of available profile depths in mm for this profile type.',
    )
    default_depth_mm = fields.Integer(
        string='Default Depth (mm)',
        default=70,
    )
    mullion_width_mm = fields.Integer(
        string='Mullion Width (mm)',
        default=20,
        help='Width of mullion/transom bar for this profile type.',
    )
    max_sash_weight_kg = fields.Float(
        string='Max Sash Weight (kg)',
        default=80.0,
        digits=(8, 1),
        help='Maximum allowed sash weight for opening panes.',
    )
    max_span_mm = fields.Integer(
        string='Max Unsupported Span (mm)',
        default=1500,
        help='Maximum mullion span without structural reinforcement.',
    )
    rate_per_metre = fields.Monetary(
        string='Rate per Lineal Metre',
        currency_field='currency_id',
        default=0.0,
        help='Extrusion cost per lineal metre for this profile type, used by the '
             'canvas Live BOM panel for frame/sash/mullion cut-cost estimates. This '
             'is a materials-cost (COGS) estimate, separate from the sale price set '
             'by Pricing Rules — the two are not expected to be equal.',
    )
    currency_id = fields.Many2one(
        comodel_name='res.currency',
        string='Currency',
        default=lambda self: self.env.company.currency_id,
    )
    u_value = fields.Float(
        string='U-Value (W/m²K)',
        digits=(6, 2),
        default=1.4,
        help='Thermal transmittance rating.',
    )
    colour_options = fields.Json(
        string='Available Colours',
        default=[],
        help='JSON array of {name, hex} colour options for this profile type.',
    )
    material_id = fields.Many2one(
        comodel_name='wincraft.material',
        string='Linked Material',
        ondelete='set null',
        help='If set, selecting this profile auto-sets the frame material.',
    )
    description = fields.Text(
        string='Description',
        translate=True,
    )
    window_count = fields.Integer(
        string='Windows Using This Profile Type',
        compute='_compute_window_count',
    )

    _mullion_positive = models.Constraint(
        'CHECK(mullion_width_mm > 0)',
        'Mullion width must be positive.',
    )
    _depth_positive = models.Constraint(
        'CHECK(default_depth_mm > 0)',
        'Default depth must be positive.',
    )
    _rate_non_negative = models.Constraint(
        'CHECK(rate_per_metre >= 0)',
        'Rate per lineal metre must be non-negative.',
    )

    @api.depends('name')
    def _compute_window_count(self):
        for rec in self:
            rec.window_count = self.env['wincraft.window'].search_count(
                [('profile_type_id', '=', rec.id)]
            )
