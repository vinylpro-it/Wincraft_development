# -*- coding: utf-8 -*-
"""
WinCraft Studio — Dealer Commission Tracking.
Records commissions owed to dealers for each project, with a simple
draft → confirmed → paid settlement workflow.
"""
from odoo import models, fields, api, _
from odoo.exceptions import UserError


COMMISSION_STATE = [
    ('draft', 'Draft'),
    ('confirmed', 'Confirmed'),
    ('paid', 'Paid'),
    ('cancelled', 'Cancelled'),
]


class WincraftDealerCommission(models.Model):
    """Tracks per-project commission owed to a dealer."""

    _name = 'wincraft.dealer.commission'
    _description = 'Dealer Commission'
    _inherit = ['mail.thread']
    _order = 'date desc, id desc'

    name = fields.Char(
        string='Reference',
        readonly=True,
        copy=False,
        default='New',
    )
    dealer_id = fields.Many2one(
        comodel_name='wincraft.dealer',
        string='Dealer',
        required=True,
        ondelete='restrict',
        index=True,
    )
    project_id = fields.Many2one(
        comodel_name='wincraft.project',
        string='Project',
        required=True,
        ondelete='restrict',
        index=True,
    )
    date = fields.Date(
        string='Commission Date',
        default=fields.Date.context_today,
        required=True,
    )
    commission_pct = fields.Float(
        string='Commission %',
        help='Snapshot of dealer commission rate at the time of creation.',
    )
    project_amount = fields.Monetary(
        string='Project Amount',
        currency_field='currency_id',
        help='Snapshot of the project total at the time of commission creation.',
    )
    commission_amount = fields.Monetary(
        string='Commission Amount',
        currency_field='currency_id',
        compute='_compute_commission_amount',
        store=True,
    )
    currency_id = fields.Many2one(
        comodel_name='res.currency',
        string='Currency',
        default=lambda self: self.env.company.currency_id.id,
    )
    state = fields.Selection(
        selection=COMMISSION_STATE,
        string='Status',
        default='draft',
        required=True,
        tracking=True,
        copy=False,
    )
    note = fields.Text(string='Notes')

    # ------------------------------------------------------------------
    # Computed
    # ------------------------------------------------------------------

    @api.depends('project_amount', 'commission_pct')
    def _compute_commission_amount(self):
        for rec in self:
            rec.commission_amount = (rec.project_amount or 0.0) * (rec.commission_pct or 0.0) / 100.0

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', 'New') == 'New':
                vals['name'] = self.env['ir.sequence'].next_by_code(
                    'wincraft.dealer.commission'
                ) or _('New')
        return super().create(vals_list)

    # ------------------------------------------------------------------
    # State actions
    # ------------------------------------------------------------------

    def action_confirm(self):
        for rec in self:
            if rec.state != 'draft':
                raise UserError(_('Only draft commissions can be confirmed.'))
            rec.state = 'confirmed'

    def action_pay(self):
        for rec in self:
            if rec.state != 'confirmed':
                raise UserError(_('Only confirmed commissions can be marked as paid.'))
            rec.state = 'paid'

    def action_cancel(self):
        for rec in self:
            if rec.state == 'paid':
                raise UserError(_('Paid commissions cannot be cancelled.'))
            rec.state = 'cancelled'

    def action_reset_to_draft(self):
        for rec in self:
            if rec.state != 'cancelled':
                raise UserError(_('Only cancelled commissions can be reset to draft.'))
            rec.state = 'draft'
