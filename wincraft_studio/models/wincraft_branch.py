# -*- coding: utf-8 -*-
"""
WinCraft Studio — Branch (Warehouse) management.

Sprint 7: Multi-branch / warehouse support.
Each branch maps to an Odoo stock.warehouse and lets the fabricator track
which location owns a project, delivery, or production order.
"""
import logging

from odoo import models, fields, api, _

_logger = logging.getLogger(__name__)


class WincraftBranch(models.Model):
    """A fabricator branch — thin wrapper around ``stock.warehouse``."""

    _name = 'wincraft.branch'
    _description = 'WinCraft Branch'
    _inherit = ['mail.thread']
    _order = 'sequence, name'
    _rec_name = 'name'

    name = fields.Char(
        string='Branch Name',
        required=True,
        tracking=True,
    )
    code = fields.Char(
        string='Short Code',
        required=True,
        help='3-5 character code, e.g. YYZ, VAN, MTL.',
    )
    warehouse_id = fields.Many2one(
        comodel_name='stock.warehouse',
        string='Warehouse',
        required=True,
        ondelete='restrict',
        tracking=True,
        help='Odoo warehouse linked to this branch.',
    )
    active = fields.Boolean(default=True)
    sequence = fields.Integer(default=10)

    address = fields.Text(string='Address')
    manager_id = fields.Many2one(
        comodel_name='res.users',
        string='Branch Manager',
        tracking=True,
    )
    phone = fields.Char(string='Phone')
    email = fields.Char(string='Email')

    company_id = fields.Many2one(
        comodel_name='res.company',
        string='Company',
        default=lambda self: self.env.company,
        required=True,
    )

    # ── Computed counts ──
    project_count = fields.Integer(
        string='Projects',
        compute='_compute_project_count',
    )
    delivery_count = fields.Integer(
        string='Deliveries',
        compute='_compute_delivery_count',
    )

    _code_unique = models.Constraint(
        'UNIQUE(code)',
        'Branch code must be unique.',
    )

    def _compute_project_count(self):
        data = self.env['wincraft.project']._read_group(
            [('branch_id', 'in', self.ids)],
            groupby=['branch_id'],
            aggregates=['__count'],
        )
        counts = {branch.id: cnt for branch, cnt in data}
        for rec in self:
            rec.project_count = counts.get(rec.id, 0)

    def _compute_delivery_count(self):
        data = self.env['wincraft.delivery']._read_group(
            [('branch_id', 'in', self.ids)],
            groupby=['branch_id'],
            aggregates=['__count'],
        )
        counts = {branch.id: cnt for branch, cnt in data}
        for rec in self:
            rec.delivery_count = counts.get(rec.id, 0)

    def action_view_projects(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Branch Projects'),
            'res_model': 'wincraft.project',
            'view_mode': 'list,form',
            'domain': [('branch_id', '=', self.id)],
        }

    def action_view_deliveries(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Branch Deliveries'),
            'res_model': 'wincraft.delivery',
            'view_mode': 'list,form',
            'domain': [('branch_id', '=', self.id)],
        }
