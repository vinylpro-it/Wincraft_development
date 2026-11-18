# -*- coding: utf-8 -*-
"""
WinCraft Studio — Create Sale Order Wizard.

Creates a sale.order from a wincraft.project, with one SO line per window.
Automatically generates BOMs for windows that don't have one yet.
"""
import logging

from odoo import models, fields, api, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

_MM_TO_IN = 1.0 / 25.4   # millimetres → inches


class WincraftCreateSOWizard(models.TransientModel):
    """Wizard: create a Sale Order from a WinCraft project."""

    _name = 'wincraft.create.so.wizard'
    _description = 'Create Sale Order from WinCraft Project'

    # ── Core fields ──────────────────────────────────────────────────

    project_id = fields.Many2one(
        comodel_name='wincraft.project',
        string='Project',
        required=True,
        ondelete='cascade',
    )
    partner_id = fields.Many2one(
        comodel_name='res.partner',
        string='Customer',
        required=True,
    )
    pricelist_id = fields.Many2one(
        comodel_name='product.pricelist',
        string='Pricelist',
    )
    window_ids = fields.Many2many(
        comodel_name='wincraft.window',
        string='Windows to quote',
        help='Select which windows to include. Defaults to all windows in the project.',
    )

    # ── Defaults ─────────────────────────────────────────────────────

    @api.model
    def default_get(self, fields_list):
        res = super().default_get(fields_list)
        project_id = self._context.get('default_project_id') or self._context.get('active_id')
        if project_id:
            project = self.env['wincraft.project'].browse(project_id)
            res['project_id'] = project.id
            res['partner_id'] = project.partner_id.id
            # Include all windows that don't yet belong to a Sale Order
            open_windows = project.window_ids.filtered(lambda w: not w.sale_order_line_id)
            res['window_ids'] = [(6, 0, open_windows.ids)] if open_windows else [(6, 0, project.window_ids.ids)]
        return res

    # ── Onchange ─────────────────────────────────────────────────────

    @api.onchange('project_id')
    def _onchange_project_id(self):
        if self.project_id:
            self.partner_id = self.project_id.partner_id

    # ── Action ───────────────────────────────────────────────────────

    def action_create_sale_order(self):
        self.ensure_one()
        project = self.project_id
        windows = self.window_ids or project.window_ids

        if not windows:
            raise UserError(_('No windows found to include in the Sale Order.'))

        # 1. Generate BOMs for windows that don't have one yet
        for win in windows:
            if not win.bom_id:
                try:
                    win.action_generate_bom()
                except Exception as exc:
                    _logger.warning('BOM generation failed for window %s: %s', win.id, exc)

        # 2. Create the Sale Order
        so_vals = {
            'partner_id': self.partner_id.id,
            'origin': project.ref or project.name,
        }
        if self.pricelist_id:
            so_vals['pricelist_id'] = self.pricelist_id.id
        # Auto-detect fiscal position from customer address
        fpos = self.env['account.fiscal.position']._get_fiscal_position(self.partner_id)
        if fpos:
            so_vals['fiscal_position_id'] = fpos.id
        so = self.env['sale.order'].create(so_vals)

        # Resolve default tax from WinCraft settings
        gst_tax_param = self.env['ir.config_parameter'].sudo().get_param(
            'wincraft_studio.gst_tax_id', False
        )
        default_tax = False
        if gst_tax_param:
            try:
                default_tax = self.env['account.tax'].browse(int(gst_tax_param)).exists()
            except (ValueError, TypeError):
                pass

        # 3. Create one SO line per window
        seq = 10
        for win in windows:
            frame_product = self._get_frame_product(win)
            if not frame_product:
                _logger.warning(
                    'No frame product resolved for window %s — skipping SO line.', win.id
                )
                continue

            line_desc = win.name or (
                f"{win.window_type} {win.width_mm}\u00d7{win.height_mm}mm"
            )

            sol_vals = {
                'order_id': so.id,
                'product_id': frame_product.id,
                'name': line_desc,
                'product_uom_qty': 1.0,
                'price_unit': win.unit_price,
                'sequence': seq,
            }
            # Apply tax: product taxes → fiscal position remap → fallback to default GST
            taxes = frame_product.taxes_id.filtered(lambda t: t.type_tax_use == 'sale')
            if not taxes and default_tax:
                taxes = default_tax
            if taxes and fpos:
                taxes = fpos.map_tax(taxes)
            if taxes:
                sol_vals['tax_ids'] = [(6, 0, taxes.ids)]
            sol = self.env['sale.order.line'].create(sol_vals)

            # Write SO line reference back to window
            win.write({'sale_order_line_id': sol.id})
            seq += 10

        # 4. Link SO to project
        project.write({'sale_order_id': so.id})

        # 5. Return SO form action
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'sale.order',
            'res_id': so.id,
            'view_mode': 'form',
            'target': 'current',
        }

    # ── Helpers ──────────────────────────────────────────────────────

    def _get_frame_product(self, window):
        """Return a product.product for the given window's frame."""
        # Prefer the frame product already on the BOM
        if window.bom_id and window.bom_id.product_tmpl_id:
            tmpl = window.bom_id.product_tmpl_id
            if window.inside_color_attr_val_id or window.outside_color_attr_val_id:
                attr_val_ids = []
                if window.inside_color_attr_val_id:
                    attr_val_ids.append(window.inside_color_attr_val_id.id)
                if window.outside_color_attr_val_id:
                    attr_val_ids.append(window.outside_color_attr_val_id.id)
                for variant in tmpl.product_variant_ids:
                    variant_attr_ids = variant.product_template_attribute_value_ids.mapped(
                        'product_attribute_value_id'
                    ).ids
                    if all(av in variant_attr_ids for av in attr_val_ids):
                        return variant
            return tmpl.product_variant_ids[:1] or None

        # Fallback: look up frame config directly
        opening_type = window._dominant_opening_type() if hasattr(window, '_dominant_opening_type') else None
        if opening_type:
            config = self.env['wincraft.frame.config'].search(
                [('opening_type', '=', opening_type)], limit=1
            )
            if config and config.product_tmpl_id:
                return config.product_tmpl_id.product_variant_ids[:1]

        return None
