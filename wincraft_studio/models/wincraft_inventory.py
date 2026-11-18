# -*- coding: utf-8 -*-
"""
WinCraft Studio — Inventory Integration helpers.

Sprint 8: Stock availability check and material requirement summary.
"""
import logging

from odoo import models, fields, api, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class WincraftMaterialRequirement(models.Model):
    """Material requirement line — computed snapshot of what a project needs."""

    _name = 'wincraft.material.requirement'
    _description = 'WinCraft Material Requirement'
    _order = 'project_id, product_id'

    project_id = fields.Many2one(
        comodel_name='wincraft.project',
        string='Project',
        required=True,
        ondelete='cascade',
        index=True,
    )
    product_id = fields.Many2one(
        comodel_name='product.product',
        string='Product',
        required=True,
        ondelete='restrict',
    )
    product_uom_id = fields.Many2one(
        comodel_name='uom.uom',
        string='UoM',
        related='product_id.uom_id',
        store=True,
    )
    qty_required = fields.Float(
        string='Required Qty',
        digits='Product Unit of Measure',
    )
    qty_available = fields.Float(
        string='On Hand',
        compute='_compute_stock',
        digits='Product Unit of Measure',
    )
    qty_shortage = fields.Float(
        string='Shortage',
        compute='_compute_stock',
        digits='Product Unit of Measure',
    )
    state = fields.Selection(
        selection=[
            ('ok', 'Available'),
            ('short', 'Shortage'),
        ],
        string='Status',
        compute='_compute_stock',
        store=True,
    )

    @api.depends('product_id', 'qty_required')
    def _compute_stock(self):
        for rec in self:
            on_hand = rec.product_id.qty_available if rec.product_id else 0.0
            rec.qty_available = on_hand
            shortage = rec.qty_required - on_hand
            rec.qty_shortage = max(shortage, 0.0)
            rec.state = 'short' if shortage > 0 else 'ok'


class WincraftProjectInventoryMixin(models.Model):
    """Add inventory helpers to wincraft.project."""

    _inherit = 'wincraft.project'

    material_requirement_ids = fields.One2many(
        comodel_name='wincraft.material.requirement',
        inverse_name='project_id',
        string='Material Requirements',
    )
    stock_status = fields.Selection(
        selection=[
            ('unchecked', 'Not Checked'),
            ('ok', 'All Available'),
            ('short', 'Shortages'),
        ],
        string='Stock Status',
        default='unchecked',
    )
    picking_count = fields.Integer(
        string='Transfers',
        compute='_compute_picking_count',
    )

    def _compute_picking_count(self):
        picking_obj = self.env['stock.picking']
        for rec in self:
            rec.picking_count = picking_obj.search_count(
                [('origin', 'like', rec.ref or '___NONE___')]
            ) if rec.ref else 0

    def action_check_stock(self):
        """Compute material requirements from BOMs and check availability."""
        self.ensure_one()
        req_model = self.env['wincraft.material.requirement']

        # Clear previous requirements
        self.material_requirement_ids.unlink()

        product_qty_map = {}  # product_id -> total qty
        for window in self.window_ids:
            if not window.bom_id:
                continue
            for line in window.bom_id.bom_line_ids:
                pid = line.product_id.id
                product_qty_map[pid] = product_qty_map.get(pid, 0.0) + line.product_qty

        vals_list = []
        for pid, qty in product_qty_map.items():
            vals_list.append({
                'project_id': self.id,
                'product_id': pid,
                'qty_required': qty,
            })

        if vals_list:
            req_model.create(vals_list)

        has_shortage = any(r.state == 'short' for r in self.material_requirement_ids)
        self.stock_status = 'short' if has_shortage else 'ok'

        return {
            'type': 'ir.actions.act_window',
            'name': _('Material Requirements — %s') % self.name,
            'res_model': 'wincraft.material.requirement',
            'view_mode': 'list',
            'domain': [('project_id', '=', self.id)],
            'target': 'current',
        }

    def action_view_pickings(self):
        """Open stock pickings related to this project."""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Transfers — %s') % self.name,
            'res_model': 'stock.picking',
            'view_mode': 'list,form',
            'domain': [('origin', 'like', self.ref or '___NONE___')],
        }
