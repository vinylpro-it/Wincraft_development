# -*- coding: utf-8 -*-
"""
WinCraft Studio — res.partner extension.
Adds WinCraft-specific computed statistics to partners.
"""
import logging

from odoo import models, fields, api, _

_logger = logging.getLogger(__name__)


class ResPartnerExt(models.Model):
    """Extend res.partner with WinCraft project statistics."""

    _inherit = 'res.partner'

    wincraft_project_count = fields.Integer(
        string='WinCraft Projects',
        compute='_compute_wincraft_project_count',
        help='Total number of WinCraft projects for this client.',
    )
    wincraft_total_revenue = fields.Monetary(
        string='WinCraft Revenue',
        compute='_compute_wincraft_project_count',
        currency_field='currency_id',
        help='Sum of all accepted/fabricating/delivered project totals.',
    )

    @api.depends('name')
    def _compute_wincraft_project_count(self):
        """Count projects and total revenue for each partner."""
        for record in self:
            projects = self.env['wincraft.project'].search([
                ('partner_id', 'child_of', record.id),
                ('is_template_workspace', '=', False),
            ])
            record.wincraft_project_count = len(projects)
            record.wincraft_total_revenue = sum(
                p.total_price
                for p in projects
                if p.state in ('accepted', 'fabricating', 'delivered')
            )

    def action_view_wincraft_projects(self):
        """Open WinCraft projects for this partner."""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('WinCraft Projects — %s') % self.name,
            'res_model': 'wincraft.project',
            'view_mode': 'kanban,list,form',
            'domain': [
                ('partner_id', 'child_of', self.id),
                ('is_template_workspace', '=', False),
            ],
            'context': {'default_partner_id': self.id},
        }
