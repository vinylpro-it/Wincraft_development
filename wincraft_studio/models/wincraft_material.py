# -*- coding: utf-8 -*-
"""
WinCraft Studio — Frame Material model.
Stores frame material specifications and pricing rate per square metre.
"""
import logging

from odoo import models, fields, api, _
from odoo.exceptions import ValidationError

_logger = logging.getLogger(__name__)


class WincraftMaterial(models.Model):
    """Frame material used in window fabrication (e.g. uPVC White, Aluminium)."""

    _name = 'wincraft.material'
    _description = 'WinCraft Frame Material'
    _order = 'name'
    _rec_name = 'name'

    name = fields.Char(
        string='Material Name',
        required=True,
        translate=True,
        help='e.g. uPVC White, Aluminium Powder-Coated, Timber Pine',
    )
    rate_per_sqm = fields.Float(
        string='Rate per sqm',
        required=True,
        digits=(12, 2),
        default=0.0,
        help='Base material cost per square metre of window area.',
    )
    colour_code = fields.Char(
        string='Colour Hex',
        size=7,
        default='#f0ede8',
        help='Default hex colour for window frame rendering in the designer.',
    )
    description = fields.Text(
        string='Description',
        translate=True,
    )
    active = fields.Boolean(
        string='Active',
        default=True,
        help='Uncheck to archive this material so it no longer appears in new windows.',
    )
    window_count = fields.Integer(
        string='Windows Using This Material',
        compute='_compute_window_count',
        help='Number of configured windows currently using this material.',
    )

    _name_unique = models.Constraint('UNIQUE(name)', 'A frame material with this name already exists.')
    _rate_non_negative = models.Constraint('CHECK(rate_per_sqm >= 0)', 'Rate per sqm must be non-negative.')

    @api.depends('name')
    def _compute_window_count(self):
        """Count how many wincraft.window records reference each material."""
        for record in self:
            record.window_count = self.env['wincraft.window'].search_count(
                [('frame_material_id', '=', record.id)]
            )

    @api.constrains('colour_code')
    def _check_colour_code(self):
        """Validate that colour_code is a valid 6-digit hex string if provided."""
        import re
        for record in self:
            if record.colour_code:
                if not re.match(r'^#[0-9A-Fa-f]{6}$', record.colour_code):
                    raise ValidationError(
                        _('Colour Hex must be a valid 6-digit hex code (e.g. #f0ede8).')
                    )

    def action_view_windows(self):
        """Open list of windows using this material."""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Windows — %s') % self.name,
            'res_model': 'wincraft.window',
            'view_mode': 'list,form',
            'domain': [('frame_material_id', '=', self.id)],
            'context': {'default_frame_material_id': self.id},
        }
