# -*- coding: utf-8 -*-
"""
WinCraft Studio — Manufacturing extensions.

Extends mrp.production to link back to wincraft.window and track
station-by-station progress through the fabrication line.
"""
import logging

from odoo import models, fields, api, _

_logger = logging.getLogger(__name__)


class MrpProductionExt(models.Model):
    """Extend manufacturing orders with window link + scheduling helpers."""

    _inherit = 'mrp.production'

    wincraft_window_id = fields.Many2one(
        comodel_name='wincraft.window',
        string='WinCraft Window',
        ondelete='set null',
        index=True,
        help='The window design this production order manufactures.',
    )
    wincraft_project_id = fields.Many2one(
        comodel_name='wincraft.project',
        string='WinCraft Project',
        related='wincraft_window_id.project_id',
        store=True,
        readonly=True,
    )
    window_barcode = fields.Char(
        related='wincraft_window_id.barcode',
        string='Window Barcode',
        store=True,
        readonly=True,
    )

    def action_open_wincraft_window(self):
        """Open the linked WinCraft window form."""
        self.ensure_one()
        if not self.wincraft_window_id:
            return
        return {
            'type': 'ir.actions.act_window',
            'name': self.wincraft_window_id.name,
            'res_model': 'wincraft.window',
            'res_id': self.wincraft_window_id.id,
            'view_mode': 'form',
            'target': 'current',
        }


class WincraftWindowProduction(models.Model):
    """Extend wincraft.window with production order link and station log."""

    _inherit = 'wincraft.window'

    production_id = fields.Many2one(
        comodel_name='mrp.production',
        string='Production Order',
        ondelete='set null',
        copy=False,
        help='Active manufacturing order for this window.',
    )
    production_state = fields.Selection(
        related='production_id.state',
        string='Production State',
        readonly=True,
    )
    station_log_ids = fields.One2many(
        comodel_name='wincraft.station.log',
        inverse_name='window_id',
        string='Station Log',
    )
    current_station = fields.Char(
        string='Current Station',
        compute='_compute_current_station',
        store=True,
        help='Work centre where this window is currently being processed.',
    )

    @api.depends('station_log_ids', 'station_log_ids.checked_out')
    def _compute_current_station(self):
        for rec in self:
            active = rec.station_log_ids.filtered(lambda l: not l.checked_out)
            rec.current_station = active[:1].workcenter_id.name if active else ''

    def action_create_production(self):
        """Create a manufacturing order from the window's BOM."""
        self.ensure_one()
        if not self.bom_id:
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': _('No BOM'),
                    'message': _('Generate a BOM first before creating a production order.'),
                    'type': 'warning',
                },
            }
        if self.production_id and self.production_id.state not in ('done', 'cancel'):
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': _('Production Exists'),
                    'message': _('An active production order already exists for this window.'),
                    'type': 'info',
                },
            }

        mo = self.env['mrp.production'].create({
            'product_id': self.bom_id.product_id.id or self.bom_id.product_tmpl_id.product_variant_id.id,
            'product_qty': 1,
            'bom_id': self.bom_id.id,
            'wincraft_window_id': self.id,
            'origin': f'{self.project_id.ref or ""}/{self.name or ""}',
        })
        self.production_id = mo.id
        return {
            'type': 'ir.actions.act_window',
            'name': mo.name,
            'res_model': 'mrp.production',
            'res_id': mo.id,
            'view_mode': 'form',
            'target': 'current',
        }


class WincraftStationLog(models.Model):
    """Station check-in/check-out log for a window moving through the line."""

    _name = 'wincraft.station.log'
    _description = 'Window Station Log'
    _order = 'check_in desc'

    window_id = fields.Many2one(
        comodel_name='wincraft.window',
        string='Window',
        required=True,
        ondelete='cascade',
        index=True,
    )
    workcenter_id = fields.Many2one(
        comodel_name='mrp.workcenter',
        string='Work Centre',
        required=True,
        ondelete='restrict',
    )
    operator_id = fields.Many2one(
        comodel_name='res.users',
        string='Operator',
        default=lambda self: self.env.user,
    )
    check_in = fields.Datetime(
        string='Check In',
        default=fields.Datetime.now,
        required=True,
    )
    checked_out = fields.Datetime(
        string='Check Out',
    )
    duration_minutes = fields.Float(
        string='Duration (min)',
        compute='_compute_duration',
        store=True,
    )
    result = fields.Selection(
        selection=[
            ('pass', 'Pass'),
            ('fail', 'Fail'),
            ('rework', 'Rework'),
        ],
        string='Result',
        default='pass',
    )
    notes = fields.Text(string='Notes')

    @api.depends('check_in', 'checked_out')
    def _compute_duration(self):
        for rec in self:
            if rec.check_in and rec.checked_out:
                delta = rec.checked_out - rec.check_in
                rec.duration_minutes = delta.total_seconds() / 60.0
            else:
                rec.duration_minutes = 0.0

    def action_check_out(self):
        """Mark check-out time for this station log entry."""
        self.ensure_one()
        self.checked_out = fields.Datetime.now()
