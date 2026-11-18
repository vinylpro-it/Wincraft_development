# -*- coding: utf-8 -*-
from odoo import models, fields, api


class WincraftRule(models.Model):
    _name = 'wincraft.rule'
    _description = 'WinCraft Design Rule'
    _order = 'sequence, id'

    name = fields.Char(required=True)
    active = fields.Boolean(default=True)
    sequence = fields.Integer(default=10)

    # Scope — which profile type / window type this rule applies to
    profile_type_id = fields.Many2one(
        'wincraft.window.type.series',
        string='Profile Type',
        help='Leave blank to apply to all profile types',
    )
    window_type = fields.Selection([
        ('all', 'All Types'),
        ('casement', 'Casement'),
        ('sliding', 'Sliding'),
        ('fixed', 'Fixed'),
        ('bifold', 'Bi-Fold'),
        ('awning', 'Awning'),
        ('tilt_turn', 'Tilt & Turn'),
        ('single_hung', 'Single Hung'),
        ('double_hung', 'Double Hung'),
        ('single_slider', 'Single Slider'),
        ('double_slider', 'Double Slider'),
        ('end_vent_slider', 'End Vent Slider'),
        ('fixed_casement', 'Fixed Casement'),
        ('bay', 'Bay'),
        ('bow', 'Bow'),
        ('arched', 'Arched'),
        ('custom', 'Custom'),
    ], default='all', required=True)

    # Condition
    condition_field = fields.Selection([
        ('width_mm', 'Window Width (mm)'),
        ('height_mm', 'Window Height (mm)'),
        ('area_sqm', 'Window Area (m²)'),
        ('pane_width_mm', 'Pane Width (mm)'),
        ('pane_height_mm', 'Pane Height (mm)'),
        ('sash_weight_kg', 'Sash Weight (kg)'),
        ('panels_horizontal', 'Horizontal Panels'),
        ('panels_vertical', 'Vertical Panels'),
        ('mullion_count', 'Mullion Count'),
        ('profile_depth_mm', 'Profile Depth (mm)'),
    ], required=True)

    operator = fields.Selection([
        ('>', 'Greater Than'),
        ('>=', 'Greater or Equal'),
        ('<', 'Less Than'),
        ('<=', 'Less or Equal'),
        ('==', 'Equals'),
        ('!=', 'Not Equals'),
        ('between', 'Between'),
    ], required=True, default='>')

    threshold = fields.Float(required=True, help='Threshold value for comparison')
    threshold_upper = fields.Float(help='Upper bound for "between" operator')

    # Action
    severity = fields.Selection([
        ('warning', 'Warning'),
        ('error', 'Error (blocks save)'),
    ], required=True, default='warning')

    message = fields.Char(
        required=True,
        help='Message shown to user. Use {value} for the actual value and {threshold} for the limit.',
    )

    action = fields.Selection([
        ('show_warning', 'Show Warning'),
        ('block_save', 'Block Save'),
        ('disable_option', 'Disable Option'),
    ], required=True, default='show_warning')

    description = fields.Text(help='Internal notes about this rule')

    _check_threshold_bounds = models.Constraint(
        'CHECK(threshold_upper IS NULL OR threshold_upper > threshold)',
        'Upper bound must be greater than lower bound',
    )
