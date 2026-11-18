# -*- coding: utf-8 -*-
"""
WinCraft Studio — Dealer Network.
Allows fabricators to manage a network of dealers/retailers who can create quotes.
"""
from odoo import models, fields, api, _


class WincraftDealer(models.Model):
    """A dealer/retailer in the fabricator's network."""

    _name = 'wincraft.dealer'
    _description = 'WinCraft Dealer'
    _inherit = ['mail.thread']
    _order = 'name'

    name = fields.Char(
        string='Dealer Name',
        required=True,
    )
    partner_id = fields.Many2one(
        comodel_name='res.partner',
        string='Contact',
        required=True,
    )
    code = fields.Char(
        string='Dealer Code',
        required=True,
    )
    active = fields.Boolean(default=True)
    commission_pct = fields.Float(
        string='Commission %',
        default=10.0,
        help='Percentage commission on sales.',
    )
    territory = fields.Char(
        string='Territory / Region',
    )
    credit_limit = fields.Monetary(
        string='Credit Limit',
        currency_field='currency_id',
    )
    outstanding_amount = fields.Monetary(
        string='Outstanding',
        currency_field='currency_id',
        compute='_compute_outstanding',
    )
    currency_id = fields.Many2one(
        comodel_name='res.currency',
        string='Currency',
        default=lambda self: self.env.company.currency_id.id,
    )
    project_count = fields.Integer(
        string='Projects',
        compute='_compute_project_count',
    )
    commission_count = fields.Integer(
        string='Commissions',
        compute='_compute_commission_count',
    )
    total_commission = fields.Monetary(
        string='Total Commission',
        currency_field='currency_id',
        compute='_compute_commission_count',
    )
    note = fields.Text(string='Notes')

    _code_unique = models.Constraint(
        'UNIQUE(code)',
        'Dealer code must be unique.',
    )

    def _compute_project_count(self):
        data = self.env['wincraft.project']._read_group(
            [('dealer_id', 'in', self.ids)],
            groupby=['dealer_id'],
            aggregates=['__count'],
        )
        counts = {dealer.id: count for dealer, count in data}
        for dealer in self:
            dealer.project_count = counts.get(dealer.id, 0)

    def _compute_outstanding(self):
        data = self.env['wincraft.project']._read_group(
            [('dealer_id', 'in', self.ids), ('state', 'in', ['accepted', 'fabricating'])],
            groupby=['dealer_id'],
            aggregates=['total_price:sum'],
        )
        totals = {dealer.id: total or 0.0 for dealer, total in data}
        for dealer in self:
            dealer.outstanding_amount = totals.get(dealer.id, 0.0)

    def action_view_projects(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Projects — %s') % self.name,
            'res_model': 'wincraft.project',
            'view_mode': 'list,form',
            'domain': [('dealer_id', '=', self.id)],
        }

    def _compute_commission_count(self):
        data = self.env['wincraft.dealer.commission']._read_group(
            [('dealer_id', 'in', self.ids)],
            groupby=['dealer_id'],
            aggregates=['__count', 'commission_amount:sum'],
        )
        mapped = {dealer.id: (count, total or 0.0) for dealer, count, total in data}
        for dealer in self:
            count, total = mapped.get(dealer.id, (0, 0.0))
            dealer.commission_count = count
            dealer.total_commission = total

    def action_view_commissions(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Commissions — %s') % self.name,
            'res_model': 'wincraft.dealer.commission',
            'view_mode': 'list,form',
            'domain': [('dealer_id', '=', self.id)],
        }
