# -*- coding: utf-8 -*-
"""
WinCraft Studio — Window Template model.
Reusable saved window configurations for the component library.
"""
import logging

from odoo import models, fields, api, _

_logger = logging.getLogger(__name__)


class WincraftWindowTemplate(models.Model):
    """Pre-configured window template shown in the designer component library."""

    _name = 'wincraft.window.template'
    _description = 'WinCraft Window Template'
    _order = 'category, window_type, name'
    _rec_name = 'name'

    name = fields.Char(
        string='Template Name',
        required=True,
        translate=True,
        help='e.g. Standard Casement 1200×1000, Slim Sliding 2400×1200',
    )
    category = fields.Selection([
        ('residential', 'Residential'),
        ('commercial', 'Commercial'),
        ('heritage', 'Heritage'),
        ('contemporary', 'Contemporary'),
        ('specialty', 'Specialty'),
    ], string='Category', default='residential', required=True)
    window_type = fields.Selection(
        selection=lambda self: self.env['wincraft.window.type']._selection_window_type(),
        string='Window Type',
        required=True,
        default='casement',
    )
    default_width = fields.Integer(
        string='Default Width (mm)',
        required=True,
        default=1200,
    )
    default_height = fields.Integer(
        string='Default Height (mm)',
        required=True,
        default=1000,
    )
    default_panels = fields.Integer(
        string='Default Panels',
        default=2,
    )
    panels_horizontal = fields.Integer(
        string='Panels Horizontal',
        default=2,
    )
    panels_vertical = fields.Integer(
        string='Panels Vertical',
        default=1,
    )
    frame_material_id = fields.Many2one(
        comodel_name='wincraft.material',
        string='Default Frame Material',
        ondelete='set null',
    )
    glass_type_id = fields.Many2one(
        comodel_name='wincraft.glass.type',
        string='Default Glass Type',
        ondelete='set null',
    )
    opening_direction = fields.Selection(
        selection=[
            ('left_right', 'Left / Right'),
            ('top_hung', 'Top Hung'),
            ('bottom_hung', 'Bottom Hung'),
            ('fixed', 'Fixed'),
            ('tilt_turn', 'Tilt & Turn'),
        ],
        string='Opening Direction',
        default='left_right',
    )
    frame_colour = fields.Char(
        string='Frame Colour (Hex)',
        size=7,
        default='#f0ede8',
    )
    frame_shape = fields.Selection(
        selection=[
            ('rectangular', 'Rectangular'),
            ('arched', 'Arched Top'),
            ('gothic', 'Gothic Arch'),
            ('circle', 'Full Circle'),
            ('half_circle', 'Half Circle'),
            ('triangle', 'Triangle'),
            ('trapezoid', 'Trapezoid'),
            ('rake', 'Rake (Angled Top)'),
            ('octagon', 'Octagon'),
            ('custom', 'Custom Outline'),
        ],
        string='Frame Shape',
        default='rectangular',
        help='Non-rectangular frame shape applied to windows created from this template.',
    )
    panel_tree = fields.Json(
        string='Panel Tree',
        help='Optional saved panel split (same shape as wincraft.window.panel_tree). '
             'When set, windows created from this template start with this split instead '
             'of a plain panels_horizontal × panels_vertical grid — used for combination '
             'templates such as a fixed curved top over an operable rectangular sash.',
    )
    pane_configs = fields.Json(
        string='Pane Configurations',
        help='Optional saved per-pane configuration (same shape as wincraft.window.pane_configs), '
             'used together with panel_tree.',
    )
    thumbnail_svg = fields.Text(
        string='Thumbnail SVG',
        help='SVG markup used in the component library panel. '
             'Auto-generated if left blank.',
    )
    product_id = fields.Many2one(
        comodel_name='product.product',
        string='Linked Product',
        ondelete='set null',
        help='Optional: link to an Inventory product for BOM/stock integration.',
    )
    description = fields.Text(
        string='Description',
        translate=True,
    )
    active = fields.Boolean(
        string='Active',
        default=True,
    )
    usage_count = fields.Integer(
        string='Times Used',
        compute='_compute_usage_count',
        help='How many canvas windows were created from this template.',
    )

    _width_positive = models.Constraint('CHECK(default_width > 0)', 'Default width must be positive.')
    _height_positive = models.Constraint('CHECK(default_height > 0)', 'Default height must be positive.')
    _panels_positive = models.Constraint('CHECK(default_panels >= 1)', 'Default panels must be at least 1.')

    @api.depends('name')
    def _compute_usage_count(self):
        """Count windows that were created from this template."""
        for record in self:
            record.usage_count = self.env['wincraft.window'].search_count(
                [('source_template_id', '=', record.id)]
            )

    def action_view_windows(self):
        """Open windows created from this template."""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Windows from %s', self.name),
            'res_model': 'wincraft.window',
            'view_mode': 'list,form',
            'domain': [('source_template_id', '=', self.id)],
        }
