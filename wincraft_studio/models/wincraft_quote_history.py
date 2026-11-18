# -*- coding: utf-8 -*-
"""
WinCraft Studio — Quote History model.
Stores snapshots of previous quote versions for a project.
"""
from odoo import models, fields, api, _

import json
import logging

_logger = logging.getLogger(__name__)


class WincraftQuoteHistory(models.Model):
    """Snapshot of a project quote at a specific version."""

    _name = 'wincraft.quote.history'
    _description = 'WinCraft Quote History'
    _order = 'version desc'

    project_id = fields.Many2one(
        comodel_name='wincraft.project',
        string='Project',
        required=True,
        ondelete='cascade',
    )
    version = fields.Integer(string='Version', required=True)
    snapshot_date = fields.Datetime(
        string='Snapshot Date',
        default=fields.Datetime.now,
        readonly=True,
    )
    subtotal = fields.Monetary(
        string='Subtotal',
        currency_field='currency_id',
    )
    total = fields.Monetary(
        string='Total',
        currency_field='currency_id',
    )
    currency_id = fields.Many2one(
        related='project_id.currency_id',
        store=True,
    )
    window_data = fields.Text(
        string='Window Snapshot (JSON)',
        help='JSON snapshot of all window configurations at this version.',
    )
    note = fields.Text(string='Revision Notes')
    created_by = fields.Many2one(
        comodel_name='res.users',
        string='Created By',
        default=lambda self: self.env.user,
    )

    def action_view_snapshot(self):
        """Open a readonly view of the snapshot data."""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Quote V%d — %s') % (self.version, self.project_id.name),
            'res_model': 'wincraft.quote.history',
            'res_id': self.id,
            'view_mode': 'form',
            'target': 'new',
        }
