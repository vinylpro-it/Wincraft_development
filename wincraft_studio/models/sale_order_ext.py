# -*- coding: utf-8 -*-
"""
WinCraft Studio — sale.order extension.
Links a sale order to a WinCraft project and adds a smart button.
"""
import logging

from odoo import models, fields, api, _

_logger = logging.getLogger(__name__)


class SaleOrderExt(models.Model):
    """Extend sale.order with the WinCraft project link."""

    _inherit = 'sale.order'

    wincraft_project_id = fields.Many2one(
        comodel_name='wincraft.project',
        string='WinCraft Project',
        copy=False,
        ondelete='set null',
        help='The WinCraft project this sale order was generated from.',
    )
    wincraft_window_count = fields.Integer(
        string='Windows',
        compute='_compute_wincraft_window_count',
        help='Number of windows in the linked WinCraft project.',
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

    def action_confirm(self):
        """Override: set WinCraft project state to 'accepted' on order confirm."""
        result = super().action_confirm()
        for order in self:
            if order.wincraft_project_id and order.wincraft_project_id.state not in (
                'accepted',
                'fabricating',
                'delivered',
            ):
                order.wincraft_project_id.write({'state': 'accepted'})
                _logger.info(
                    'WinCraft: Project %s moved to accepted on sale order %s confirm',
                    order.wincraft_project_id.ref,
                    order.name,
                )
        return result

    def action_view_wincraft_project(self):
        """Open the linked WinCraft project."""
        self.ensure_one()
        if not self.wincraft_project_id:
            return False
        return {
            'type': 'ir.actions.act_window',
            'name': _('WinCraft Project'),
            'res_model': 'wincraft.project',
            'res_id': self.wincraft_project_id.id,
            'view_mode': 'form',
        }
