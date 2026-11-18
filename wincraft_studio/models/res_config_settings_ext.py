# -*- coding: utf-8 -*-
"""
WinCraft Studio — res.config.settings extension.
Adds WinCraft-specific configuration parameters.
"""
import logging

from odoo import models, fields, api, _

_logger = logging.getLogger(__name__)


class ResConfigSettings(models.TransientModel):
    """Extend company settings with WinCraft Studio configuration tab."""

    _inherit = 'res.config.settings'

    wincraft_default_validity_days = fields.Integer(
        string='Default Quote Validity (days)',
        config_parameter='wincraft_studio.default_validity_days',
        default=30,
        help='Number of days a WinCraft quote remains valid from creation date.',
    )
    wincraft_installation_rate = fields.Float(
        string='Default Installation Rate',
        config_parameter='wincraft_studio.installation_rate',
        help='Default installation charge applied to new projects.',
    )
    wincraft_terms = fields.Char(
        string='Default Terms & Conditions',
        config_parameter='wincraft_studio.terms',
        help='Default T&C text prepopulated on new projects.',
    )
    wincraft_gst_tax_id = fields.Many2one(
        comodel_name='account.tax',
        string='Default GST Tax',
        config_parameter='wincraft_studio.gst_tax_id',
        help='Tax applied to WinCraft sale order lines.',
    )
    wincraft_anthropic_api_key = fields.Char(
        string='Anthropic API Key',
        config_parameter='wincraft_studio.anthropic_api_key',
        help='API key for Anthropic Claude AI assistant. Leave blank to use regex fallback.',
    )
    wincraft_enabled_window_types = fields.Char(
        string='Enabled Window Types',
        config_parameter='wincraft_studio.enabled_window_types',
        default='casement,sliding,fixed,bifold,awning,arched,bay,bow,tilt_turn,single_hung,double_hung,single_slider,double_slider,end_vent_slider,fixed_casement,custom',
        help='Comma-separated list of enabled window type keys shown in the designer.',
    )
    wincraft_unit_system = fields.Selection(
        [('metric', 'Metric (mm)'), ('imperial', 'Imperial (inches)')],
        string='Unit System',
        config_parameter='wincraft_studio.unit_system',
        default='metric',
        help='Display unit system for window dimensions in the designer.',
    )
    currency_id = fields.Many2one(
        comodel_name='res.currency',
        related='company_id.currency_id',
        readonly=True,
    )

    def get_values(self):
        """Load config_parameter values into the settings form."""
        res = super().get_values()
        params = self.env['ir.config_parameter'].sudo()

        gst_tax_param = params.get_param('wincraft_studio.gst_tax_id', False)
        if gst_tax_param:
            try:
                res['wincraft_gst_tax_id'] = int(gst_tax_param)
            except (ValueError, TypeError):
                res['wincraft_gst_tax_id'] = False

        return res

    def set_values(self):
        """Persist settings to ir.config_parameter."""
        super().set_values()
        params = self.env['ir.config_parameter'].sudo()
        if self.wincraft_gst_tax_id:
            params.set_param('wincraft_studio.gst_tax_id', str(self.wincraft_gst_tax_id.id))
        else:
            params.set_param('wincraft_studio.gst_tax_id', False)
