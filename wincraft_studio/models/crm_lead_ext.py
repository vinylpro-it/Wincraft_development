# -*- coding: utf-8 -*-
"""
WinCraft Studio — crm.lead extension.
Links a CRM opportunity/lead to a WinCraft project.
"""
import logging

from odoo import models, fields, api, _

_logger = logging.getLogger(__name__)


class CrmLeadExt(models.Model):
    """Extend crm.lead with WinCraft project integration."""

    _inherit = 'crm.lead'

    wincraft_project_id = fields.Many2one(
        comodel_name='wincraft.project',
        string='WinCraft Project',
        copy=False,
        ondelete='set null',
        help='The WinCraft project linked to this opportunity.',
    )
    wincraft_window_count = fields.Integer(
        string='Windows',
        compute='_compute_wincraft_window_count',
    )

    @api.depends('wincraft_project_id', 'wincraft_project_id.total_windows')
    def _compute_wincraft_window_count(self):
        """Read window count from linked project."""
        for record in self:
            record.wincraft_window_count = (
                record.wincraft_project_id.total_windows
                if record.wincraft_project_id
                else 0
            )

    def action_create_wincraft_project(self):
        """Create a new WinCraft project from this CRM opportunity."""
        self.ensure_one()
        if self.wincraft_project_id:
            return self.action_open_wincraft_project()

        partner = self.partner_id or (
            self.env['res.partner'].create({
                'name': self.partner_name or self.contact_name or self.name,
                'email': self.email_from,
                'phone': self.phone,
            })
            if not self.partner_id
            else self.partner_id
        )

        project = self.env['wincraft.project'].create({
            'name': self.name,
            'partner_id': partner.id,
            'lead_id': self.id,
            'user_id': self.user_id.id,
        })
        self.write({'wincraft_project_id': project.id})
        _logger.info(
            'WinCraft: Created project %s from lead %s', project.ref, self.name
        )
        return {
            'type': 'ir.actions.act_window',
            'name': _('WinCraft Project'),
            'res_model': 'wincraft.project',
            'res_id': project.id,
            'view_mode': 'form',
        }

    def action_open_wincraft_project(self):
        """Open the linked WinCraft project."""
        self.ensure_one()
        if not self.wincraft_project_id:
            return self.action_create_wincraft_project()
        return {
            'type': 'ir.actions.act_window',
            'name': _('WinCraft Project'),
            'res_model': 'wincraft.project',
            'res_id': self.wincraft_project_id.id,
            'view_mode': 'form',
        }

    def action_open_wincraft_designer(self):
        """Open the designer canvas from the CRM lead, creating a project if needed."""
        self.ensure_one()
        if not self.wincraft_project_id:
            self.action_create_wincraft_project()
        return self.wincraft_project_id.action_open_designer()

    def action_set_won_rainbowman(self):
        """Override: also accept the linked WinCraft project and create sale order."""
        result = super().action_set_won_rainbowman()
        for lead in self:
            if lead.wincraft_project_id:
                project = lead.wincraft_project_id
                if project.state not in ('accepted', 'fabricating', 'delivered'):
                    project.write({'state': 'accepted'})
                if not project.sale_order_id and project.window_ids:
                    try:
                        project.action_create_sale_order()
                    except Exception as exc:
                        _logger.warning(
                            'WinCraft: Could not auto-create sale order on won lead: %s', exc
                        )
        return result
