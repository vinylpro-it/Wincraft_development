# -*- coding: utf-8 -*-
"""
WinCraft Studio — Delivery, Truck Loading, and Installation models.

Sprint 4: Delivery scheduling, truck loading manifest, install confirmation.
"""
import logging
from datetime import timedelta

from odoo import models, fields, api, _
from odoo.exceptions import ValidationError

_logger = logging.getLogger(__name__)


# ─── Delivery Schedule ────────────────────────────────────────────────

class WincraftDelivery(models.Model):
    """Delivery schedule record — groups projects into a delivery run."""

    _name = 'wincraft.delivery'
    _description = 'WinCraft Delivery Schedule'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'scheduled_date, id desc'
    _rec_name = 'name'

    name = fields.Char(
        string='Delivery Reference',
        readonly=True,
        copy=False,
        default='/',
    )
    state = fields.Selection(
        selection=[
            ('draft', 'Draft'),
            ('scheduled', 'Scheduled'),
            ('loading', 'Loading'),
            ('in_transit', 'In Transit'),
            ('delivered', 'Delivered'),
            ('cancelled', 'Cancelled'),
        ],
        string='Status',
        default='draft',
        required=True,
        tracking=True,
    )
    scheduled_date = fields.Date(
        string='Scheduled Date',
        required=True,
        tracking=True,
        default=fields.Date.context_today,
    )
    driver_id = fields.Many2one(
        comodel_name='res.users',
        string='Driver / Courier',
        tracking=True,
    )
    vehicle_ref = fields.Char(
        string='Vehicle / Truck',
        help='Licence plate or fleet reference.',
    )
    branch_id = fields.Many2one(
        comodel_name='wincraft.branch',
        string='Branch',
        tracking=True,
        index=True,
    )
    notes = fields.Text(string='Notes')

    # ── Lines ──
    line_ids = fields.One2many(
        comodel_name='wincraft.delivery.line',
        inverse_name='delivery_id',
        string='Delivery Lines',
    )

    project_count = fields.Integer(
        string='Projects',
        compute='_compute_project_count',
    )
    total_windows = fields.Integer(
        string='Total Windows',
        compute='_compute_project_count',
    )

    @api.depends('line_ids', 'line_ids.project_id')
    def _compute_project_count(self):
        for rec in self:
            rec.project_count = len(rec.line_ids.mapped('project_id'))
            rec.total_windows = sum(rec.line_ids.mapped('window_count'))

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', '/') == '/':
                vals['name'] = self.env['ir.sequence'].next_by_code(
                    'wincraft.delivery'
                ) or _('New')
        return super().create(vals_list)

    # ── State transitions ──
    def action_schedule(self):
        self.write({'state': 'scheduled'})

    def action_start_loading(self):
        self.write({'state': 'loading'})

    def action_depart(self):
        self.write({'state': 'in_transit'})

    def action_mark_delivered(self):
        """Mark all lines as delivered and set projects to delivered state."""
        self.write({'state': 'delivered'})
        for line in self.line_ids.filtered(lambda l: not l.delivered):
            line.write({
                'delivered': True,
                'delivery_date': fields.Datetime.now(),
            })
        # Advance linked projects that are still in fabricating
        projects = self.line_ids.mapped('project_id').filtered(
            lambda p: p.state == 'fabricating'
        )
        projects.write({'state': 'delivered'})

    def action_cancel(self):
        self.write({'state': 'cancelled'})

    def action_reset_draft(self):
        self.filtered(lambda r: r.state == 'cancelled').write({'state': 'draft'})


class WincraftDeliveryLine(models.Model):
    """One project within a delivery run."""

    _name = 'wincraft.delivery.line'
    _description = 'Delivery Line'
    _order = 'load_sequence, id'

    delivery_id = fields.Many2one(
        comodel_name='wincraft.delivery',
        string='Delivery',
        required=True,
        ondelete='cascade',
    )
    project_id = fields.Many2one(
        comodel_name='wincraft.project',
        string='Project',
        required=True,
        ondelete='restrict',
    )
    partner_id = fields.Many2one(
        related='project_id.partner_id',
        string='Client',
        store=True,
    )
    window_count = fields.Integer(
        related='project_id.total_windows',
        string='Windows',
        store=True,
    )
    load_sequence = fields.Integer(
        string='Load Order',
        default=10,
        help='Order in which items load onto the truck (last off = first on).',
    )
    delivered = fields.Boolean(
        string='Delivered',
        default=False,
    )
    delivery_date = fields.Datetime(
        string='Delivered At',
    )
    signed_by = fields.Char(
        string='Signed By',
        help='Name of person who signed for delivery.',
    )
    delivery_notes = fields.Text(string='Delivery Notes')


# ─── Truck Loading Manifest ──────────────────────────────────────────

class WincraftLoadingManifest(models.Model):
    """Truck loading manifest — per-window tracking of what goes on the truck."""

    _name = 'wincraft.loading.manifest'
    _description = 'Truck Loading Manifest'
    _order = 'load_sequence, id'

    delivery_id = fields.Many2one(
        comodel_name='wincraft.delivery',
        string='Delivery',
        required=True,
        ondelete='cascade',
        index=True,
    )
    window_id = fields.Many2one(
        comodel_name='wincraft.window',
        string='Window',
        required=True,
        ondelete='restrict',
    )
    project_id = fields.Many2one(
        related='window_id.project_id',
        string='Project',
        store=True,
    )
    barcode = fields.Char(
        related='window_id.barcode',
        string='Barcode',
        store=True,
    )
    load_sequence = fields.Integer(
        string='Load Order',
        default=10,
    )
    loaded = fields.Boolean(
        string='Loaded',
        default=False,
    )
    loaded_at = fields.Datetime(string='Loaded At')
    loaded_by = fields.Many2one(
        comodel_name='res.users',
        string='Loaded By',
    )

    def action_mark_loaded(self):
        """Mark this window as loaded onto the truck."""
        self.ensure_one()
        self.write({
            'loaded': True,
            'loaded_at': fields.Datetime.now(),
            'loaded_by': self.env.user.id,
        })


# ─── Installation Confirmation ───────────────────────────────────────

class WincraftInstallation(models.Model):
    """Installation confirmation for a delivered project."""

    _name = 'wincraft.installation'
    _description = 'WinCraft Installation Confirmation'
    _inherit = ['mail.thread']
    _order = 'scheduled_date, id desc'
    _rec_name = 'name'

    name = fields.Char(
        string='Installation Reference',
        readonly=True,
        copy=False,
        default='/',
    )
    state = fields.Selection(
        selection=[
            ('scheduled', 'Scheduled'),
            ('in_progress', 'In Progress'),
            ('completed', 'Completed'),
            ('issue', 'Issue Reported'),
        ],
        string='Status',
        default='scheduled',
        required=True,
        tracking=True,
    )
    project_id = fields.Many2one(
        comodel_name='wincraft.project',
        string='Project',
        required=True,
        ondelete='restrict',
        index=True,
    )
    partner_id = fields.Many2one(
        related='project_id.partner_id',
        string='Client',
        store=True,
    )
    delivery_id = fields.Many2one(
        comodel_name='wincraft.delivery',
        string='Delivery',
        help='Delivery that brought the windows.',
    )
    scheduled_date = fields.Date(
        string='Scheduled Date',
        required=True,
        tracking=True,
    )
    installer_id = fields.Many2one(
        comodel_name='res.users',
        string='Installer',
        tracking=True,
    )

    # ── Completion fields ──
    started_at = fields.Datetime(string='Started At')
    completed_at = fields.Datetime(string='Completed At')
    customer_sign = fields.Char(
        string='Customer Signature Name',
        help='Name of customer who signed off on installation.',
    )
    issue_description = fields.Text(string='Issue Description')
    photo_ids = fields.Many2many(
        comodel_name='ir.attachment',
        string='Photos',
        help='Photos of completed installation or issues.',
    )
    notes = fields.Text(string='Installation Notes')

    # ── Window-level checklist ──
    check_ids = fields.One2many(
        comodel_name='wincraft.installation.check',
        inverse_name='installation_id',
        string='Window Checks',
    )

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', '/') == '/':
                vals['name'] = self.env['ir.sequence'].next_by_code(
                    'wincraft.installation'
                ) or _('New')
        return super().create(vals_list)

    def action_start(self):
        self.write({'state': 'in_progress', 'started_at': fields.Datetime.now()})

    def action_complete(self):
        self.write({'state': 'completed', 'completed_at': fields.Datetime.now()})

    def action_report_issue(self):
        self.write({'state': 'issue'})

    def action_generate_checks(self):
        """Auto-create one check line per window in the project."""
        self.ensure_one()
        existing_window_ids = self.check_ids.mapped('window_id').ids
        new_checks = []
        for win in self.project_id.window_ids:
            if win.id not in existing_window_ids:
                new_checks.append({
                    'installation_id': self.id,
                    'window_id': win.id,
                })
        if new_checks:
            self.env['wincraft.installation.check'].create(new_checks)


class WincraftInstallationCheck(models.Model):
    """Per-window check during installation."""

    _name = 'wincraft.installation.check'
    _description = 'Installation Window Check'
    _order = 'sequence, id'

    installation_id = fields.Many2one(
        comodel_name='wincraft.installation',
        string='Installation',
        required=True,
        ondelete='cascade',
    )
    window_id = fields.Many2one(
        comodel_name='wincraft.window',
        string='Window',
        required=True,
        ondelete='restrict',
    )
    sequence = fields.Integer(
        related='window_id.sequence',
        store=True,
    )
    result = fields.Selection(
        selection=[
            ('pending', 'Pending'),
            ('pass', 'Pass'),
            ('fail', 'Fail'),
        ],
        string='Result',
        default='pending',
        required=True,
    )
    notes = fields.Text(string='Notes')
