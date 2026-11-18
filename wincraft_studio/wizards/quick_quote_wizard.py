# -*- coding: utf-8 -*-
"""
WinCraft Studio — Quick Quote Wizard.
Lets sales staff rapidly add multiple windows and generate a rough quote
without opening the full canvas designer.
"""
from odoo import models, fields, api, _
from odoo.exceptions import UserError


class QuickQuoteWizard(models.TransientModel):
    """Quick-quote wizard — creates a project with windows in one step."""

    _name = 'wincraft.quick.quote.wizard'
    _description = 'Quick Quote Wizard'

    partner_id = fields.Many2one(
        comodel_name='res.partner',
        string='Customer',
        required=True,
    )
    project_name = fields.Char(
        string='Project Name',
        required=True,
    )
    installation_charge = fields.Float(
        string='Installation Charge',
        default=0.0,
    )
    line_ids = fields.One2many(
        comodel_name='wincraft.quick.quote.wizard.line',
        inverse_name='wizard_id',
        string='Windows',
    )
    estimated_total = fields.Float(
        string='Estimated Total',
        compute='_compute_estimated_total',
    )

    @api.depends('line_ids.estimated_price', 'installation_charge')
    def _compute_estimated_total(self):
        for wiz in self:
            wiz.estimated_total = (
                sum(line.estimated_price for line in wiz.line_ids)
                + (wiz.installation_charge or 0.0)
            )

    def action_create_project(self):
        """Create the project and windows from wizard data."""
        self.ensure_one()
        if not self.line_ids:
            raise UserError(_('Please add at least one window.'))

        project = self.env['wincraft.project'].create({
            'name': self.project_name,
            'partner_id': self.partner_id.id,
            'installation_charge': self.installation_charge,
        })

        for idx, line in enumerate(self.line_ids, start=1):
            self.env['wincraft.window'].create({
                'project_id': project.id,
                'name': line.name or f'Window {idx}',
                'window_type': line.window_type,
                'width_mm': line.width_mm,
                'height_mm': line.height_mm,
                'panels_horizontal': line.panels_horizontal,
                'panels_vertical': line.panels_vertical,
                'frame_material_id': line.material_id.id if line.material_id else False,
                'glass_type_id': line.glass_type_id.id if line.glass_type_id else False,
                'sequence': idx * 10,
            })

        return {
            'type': 'ir.actions.act_window',
            'name': project.name,
            'res_model': 'wincraft.project',
            'res_id': project.id,
            'view_mode': 'form',
            'target': 'current',
        }


class QuickQuoteWizardLine(models.TransientModel):
    """One window line in the quick-quote wizard."""

    _name = 'wincraft.quick.quote.wizard.line'
    _description = 'Quick Quote Wizard Line'

    wizard_id = fields.Many2one(
        comodel_name='wincraft.quick.quote.wizard',
        string='Wizard',
        required=True,
        ondelete='cascade',
    )
    name = fields.Char(string='Label', default='Window')
    window_type = fields.Selection(
        selection=[
            ('casement', 'Casement'),
            ('sliding', 'Sliding'),
            ('fixed', 'Fixed'),
            ('bifold', 'Bi-Fold'),
            ('awning', 'Awning'),
            ('arched', 'Arched'),
            ('bay', 'Bay'),
            ('bow', 'Bow'),
            ('tilt_turn', 'Tilt & Turn'),
        ],
        string='Type',
        default='casement',
        required=True,
    )
    width_mm = fields.Integer(string='Width (mm)', default=1200, required=True)
    height_mm = fields.Integer(string='Height (mm)', default=1500, required=True)
    panels_horizontal = fields.Integer(string='Panels H', default=2)
    panels_vertical = fields.Integer(string='Panels V', default=1)
    material_id = fields.Many2one(
        comodel_name='wincraft.material',
        string='Material',
    )
    glass_type_id = fields.Many2one(
        comodel_name='wincraft.glass.type',
        string='Glass',
    )
    estimated_price = fields.Float(
        string='Est. Price',
        compute='_compute_estimated_price',
    )

    @api.depends('width_mm', 'height_mm', 'material_id', 'glass_type_id')
    def _compute_estimated_price(self):
        for line in self:
            area = (line.width_mm / 1000.0) * (line.height_mm / 1000.0)
            mat_rate = line.material_id.rate_per_sqm if line.material_id else 0
            glass_rate = line.glass_type_id.rate_per_sqm if line.glass_type_id else 0
            line.estimated_price = area * (mat_rate + glass_rate + 150) * 1.2  # 20% margin
