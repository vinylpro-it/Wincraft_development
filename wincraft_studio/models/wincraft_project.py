# -*- coding: utf-8 -*-
"""
WinCraft Studio — Project model.
Central record tying together a client, windows, canvas, sale order, and CRM lead.
Inherits mail thread and activity mixin for full Odoo chatter support.
"""
import logging
from datetime import timedelta

from odoo import models, fields, api, _
from odoo.exceptions import UserError, ValidationError

_logger = logging.getLogger(__name__)

PROJECT_STATE = [
    ('draft', 'Draft'),
    ('designing', 'Designing'),
    ('quoted', 'Quoted'),
    ('accepted', 'Accepted'),
    ('fabricating', 'Fabricating'),
    ('delivered', 'Delivered'),
]


class WincraftProject(models.Model):
    """WinCraft Studio project — the top-level container for a window fabrication job."""

    _name = 'wincraft.project'
    _description = 'WinCraft Project'
    _inherit = ['mail.thread', 'mail.activity.mixin', 'portal.mixin']
    _order = 'id desc'
    _rec_name = 'name'

    # ------------------------------------------------------------------
    # Core fields
    # ------------------------------------------------------------------

    name = fields.Char(
        string='Project Name',
        required=True,
        tracking=True,
        translate=True,
        help='e.g. Sharma Residence Floor 3 — Chennai',
    )
    ref = fields.Char(
        string='Reference',
        readonly=True,
        copy=False,
        default='/',
        help='Auto-generated project reference from sequence.',
    )
    partner_id = fields.Many2one(
        comodel_name='res.partner',
        string='Client',
        required=True,
        tracking=True,
        ondelete='restrict',
        index=True,
    )
    state = fields.Selection(
        selection=PROJECT_STATE,
        string='Status',
        default='draft',
        required=True,
        tracking=True,
        copy=False,
    )
    active = fields.Boolean(
        string='Active',
        default=True,
        tracking=True,
    )
    is_template_workspace = fields.Boolean(
        string='Template Workspace',
        default=False,
        help='Internal scratch project created by "Design Canvas Template" '
             '(Configuration > Window Types) — never a real customer project, '
             'hidden from the normal Projects list.',
    )

    # ------------------------------------------------------------------
    # Relational fields
    # ------------------------------------------------------------------

    sale_order_id = fields.Many2one(
        comodel_name='sale.order',
        string='Sale Order',
        copy=False,
        tracking=True,
        ondelete='set null',
    )
    lead_id = fields.Many2one(
        comodel_name='crm.lead',
        string='CRM Opportunity',
        copy=False,
        ondelete='set null',
    )
    window_ids = fields.One2many(
        comodel_name='wincraft.window',
        inverse_name='project_id',
        string='Windows',
        copy=True,
    )
    canvas_layout_ids = fields.One2many(
        comodel_name='wincraft.canvas.layout',
        inverse_name='project_id',
        string='Canvas Snapshots',
        copy=False,
    )

    # ------------------------------------------------------------------
    # Financials
    # ------------------------------------------------------------------

    currency_id = fields.Many2one(
        comodel_name='res.currency',
        string='Currency',
        related='company_id.currency_id',
        store=True,
        readonly=True,
    )
    company_id = fields.Many2one(
        comodel_name='res.company',
        string='Company',
        default=lambda self: self.env.company,
        required=True,
        readonly=True,
    )
    installation_charge = fields.Monetary(
        string='Installation Charge',
        currency_field='currency_id',
        default=0.0,
        tracking=True,
    )
    discount_pct = fields.Float(
        string='Discount (%)',
        digits=(5, 2),
        default=0.0,
        tracking=True,
        help='Percentage discount applied to the sub-total.',
    )
    total_windows = fields.Integer(
        string='Total Windows',
        compute='_compute_totals',
        store=True,
    )
    subtotal_price = fields.Monetary(
        string='Sub-total',
        currency_field='currency_id',
        compute='_compute_totals',
        store=True,
    )
    one_time_addon_total = fields.Monetary(
        string='One-Time Add-ons',
        currency_field='currency_id',
        compute='_compute_totals',
        store=True,
        help='Sum of add-ons flagged "Charged Per Window" = No (e.g. a one-time '
             'site survey or consultation fee), billed once for the whole project '
             'regardless of how many windows reference them — deduplicated, so '
             'selecting the same one-time add-on on 5 windows still charges it once.',
    )
    total_price = fields.Monetary(
        string='Total Price',
        currency_field='currency_id',
        compute='_compute_totals',
        store=True,
        tracking=True,
        help='Sum of all window prices + installation − discount.',
    )
    discount_amount = fields.Monetary(
        string='Discount Amount',
        currency_field='currency_id',
        compute='_compute_totals',
        store=True,
    )
    tax_amount = fields.Monetary(
        string='Tax Amount',
        currency_field='currency_id',
        compute='_compute_totals',
        store=True,
    )
    gst_pct = fields.Float(
        string='Tax %',
        compute='_compute_totals',
        store=True,
    )
    cgst_amount = fields.Monetary(
        string='CGST',
        currency_field='currency_id',
        compute='_compute_totals',
        store=True,
    )
    sgst_amount = fields.Monetary(
        string='SGST',
        currency_field='currency_id',
        compute='_compute_totals',
        store=True,
    )

    # ------------------------------------------------------------------
    # Assignment
    # ------------------------------------------------------------------

    user_id = fields.Many2one(
        comodel_name='res.users',
        string='Salesperson',
        default=lambda self: self.env.user,
        tracking=True,
        index=True,
    )
    fabricator_id = fields.Many2one(
        comodel_name='res.users',
        string='Fabricator',
        tracking=True,
    )
    dealer_id = fields.Many2one(
        comodel_name='wincraft.dealer',
        string='Dealer',
        tracking=True,
    )
    branch_id = fields.Many2one(
        comodel_name='wincraft.branch',
        string='Branch',
        tracking=True,
        index=True,
    )
    due_date = fields.Date(
        string='Due Date',
        tracking=True,
    )

    # ------------------------------------------------------------------
    # Notes
    # ------------------------------------------------------------------

    note = fields.Html(
        string='Internal Notes',
        sanitize=True,
    )
    terms = fields.Html(
        string='Terms & Conditions',
        sanitize=True,
    )

    # ------------------------------------------------------------------
    # QR Code
    # ------------------------------------------------------------------

    qr_code_image = fields.Binary(
        string='QR Code',
        compute='_compute_qr_code',
        store=True,
    )
    qr_available = fields.Boolean(
        string='QR Available',
        compute='_compute_qr_available',
    )

    @api.depends()
    def _compute_qr_available(self):
        available = False
        try:
            import qrcode  # noqa: F401
            from PIL import Image  # noqa: F401
            available = True
        except ImportError:
            pass
        for rec in self:
            rec.qr_available = available

    @api.depends('ref')
    def _compute_qr_code(self):
        """Generate a QR code linking to the portal page."""
        try:
            import qrcode
            from PIL import Image  # noqa: F401
            import io
            import base64
        except ImportError:
            _logger.warning(
                'python-qrcode or Pillow not installed — QR codes disabled. '
                'Run: pip install qrcode[pil]'
            )
            for rec in self:
                rec.qr_code_image = False
            return
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url')
        for rec in self:
            if not rec.id:
                rec.qr_code_image = False
                continue
            try:
                url = f"{base_url}/my/wincraft/{rec.id}"
                qr = qrcode.QRCode(version=1, box_size=6, border=2)
                qr.add_data(url)
                qr.make(fit=True)
                img = qr.make_image(fill_color='black', back_color='white')
                buf = io.BytesIO()
                img.save(buf, format='PNG')
                rec.qr_code_image = base64.b64encode(buf.getvalue())
            except Exception:
                _logger.exception('QR code generation failed for project %s', rec.ref)
                rec.qr_code_image = False

    # ------------------------------------------------------------------
    # Quote versioning
    # ------------------------------------------------------------------

    quote_version = fields.Integer(
        string='Quote Version',
        default=1,
        readonly=True,
    )
    quote_history_ids = fields.One2many(
        comodel_name='wincraft.quote.history',
        inverse_name='project_id',
        string='Quote History',
    )

    _ref_unique = models.Constraint('UNIQUE(ref)', 'Project reference must be unique.')
    _discount_range = models.Constraint('CHECK(discount_pct >= 0 AND discount_pct <= 100)', 'Discount must be between 0% and 100%.')

    # ------------------------------------------------------------------
    # Computed field methods
    # ------------------------------------------------------------------

    @api.depends(
        'window_ids', 'window_ids.unit_price',
        'window_ids.addon_ids', 'window_ids.addon_ids.per_window', 'window_ids.addon_ids.price',
        'installation_charge', 'discount_pct',
    )
    def _compute_totals(self):
        """Compute total_windows, subtotal_price, discount_amount, tax_amount, and total_price."""
        gst_pct = float(
            self.env['ir.config_parameter'].sudo().get_param(
                'wincraft_studio.gst_pct', '5'
            )
        )
        for record in self:
            windows = record.window_ids
            record.total_windows = len(windows)
            window_sum = sum(w.unit_price for w in windows)
            # One-time add-ons (per_window=False) are deduplicated across the
            # project's windows and billed once — they were previously summed
            # nowhere at all (excluded from unit_price by design, and never
            # picked up here either), so selecting one silently gave it away.
            one_time_total = sum(windows.addon_ids.filtered(lambda a: not a.per_window).mapped('price'))
            record.one_time_addon_total = one_time_total
            subtotal = window_sum + one_time_total + (record.installation_charge or 0.0)
            discount = subtotal * (record.discount_pct or 0.0) / 100.0
            after_discount = subtotal - discount
            tax = after_discount * gst_pct / 100.0
            record.subtotal_price = subtotal
            record.discount_amount = discount
            record.tax_amount = tax
            record.gst_pct = gst_pct
            record.cgst_amount = tax / 2.0
            record.sgst_amount = tax / 2.0
            record.total_price = after_discount + tax

    # ------------------------------------------------------------------
    # ORM overrides
    # ------------------------------------------------------------------

    @api.model_create_multi
    def create(self, vals_list):
        """Assign sequence reference and default terms on create."""
        for vals in vals_list:
            if vals.get('ref', '/') == '/':
                vals['ref'] = self.env['ir.sequence'].next_by_code('wincraft.project') or '/'
            if not vals.get('terms'):
                vals['terms'] = self.env['ir.config_parameter'].sudo().get_param(
                    'wincraft_studio.terms', ''
                )
        records = super().create(vals_list)
        return records

    def write(self, vals):
        """Track state transitions and trigger integration hooks."""
        old_states = {r.id: r.state for r in self}
        result = super().write(vals)
        if 'state' in vals:
            for record in self:
                old_state = old_states.get(record.id)
                new_state = record.state
                if old_state != new_state:
                    record._on_state_change(old_state, new_state)
        return result

    def _on_state_change(self, old_state, new_state):
        """Hook called when project state changes."""
        self.ensure_one()
        if new_state == 'quoted':
            self._send_quote_email()
        elif new_state == 'accepted':
            self._create_dealer_commission()
        elif new_state == 'fabricating':
            self._create_fabrication_picking()

    # ------------------------------------------------------------------
    # Portal mixin
    # ------------------------------------------------------------------

    def _compute_access_url(self):
        """Generate portal URL for customer self-service view."""
        super()._compute_access_url()
        for record in self:
            record.access_url = f'/my/wincraft/{record.id}'

    # ------------------------------------------------------------------
    # Business actions
    # ------------------------------------------------------------------

    def action_open_designer(self):
        """Open the WinCraft designer canvas client action for this project."""
        self.ensure_one()
        if self.state == 'draft':
            self.write({'state': 'designing'})
        return {
            'type': 'ir.actions.client',
            'tag': 'wincraft_designer',
            'name': _('Designer — %s') % self.name,
            'context': {
                'project_id': self.id,
                'default_state': 'designing',
            },
            'target': 'fullscreen',
        }

    def action_create_sale_order(self):
        """Create a Sale Order from the project windows.

        For each window, find or create a product.product record and add
        a sale.order.line. Adds an installation line if applicable.
        """
        self.ensure_one()
        if not self.window_ids:
            raise UserError(_('Please add at least one window before creating a sale order.'))

        if self.sale_order_id:
            raise UserError(
                _('A sale order already exists for this project: %s') % self.sale_order_id.name
            )

        order_vals, tax_id_cmd = self._prepare_quote_order_vals()
        order = self.env['sale.order'].create(order_vals)

        # Create order lines — one per window
        for idx, window in enumerate(self.window_ids.sorted('sequence'), start=1):
            product = self._get_or_create_window_product(window)
            description = self._build_window_description(window)
            self.env['sale.order.line'].create({
                'order_id': order.id,
                'product_id': product.id,
                'name': description,
                'product_uom_qty': 1,
                'price_unit': window.unit_price,
                'tax_ids': tax_id_cmd,
                'sequence': idx * 10,
            })

        # One-time add-on lines (per_window=False) — billed once each,
        # regardless of how many windows reference them.
        for addon_idx, addon in enumerate(self._get_one_time_addons(), start=1):
            addon_product = self._get_or_create_addon_product(addon)
            self.env['sale.order.line'].create({
                'order_id': order.id,
                'product_id': addon_product.id,
                'name': addon.name,
                'product_uom_qty': 1,
                'price_unit': addon.price,
                'tax_ids': tax_id_cmd,
                'sequence': 9000 + addon_idx,
            })

        # Installation line
        if self.installation_charge > 0:
            install_product = self._get_or_create_installation_product()
            self.env['sale.order.line'].create({
                'order_id': order.id,
                'product_id': install_product.id,
                'name': _('Installation & Site Work'),
                'product_uom_qty': 1,
                'price_unit': self.installation_charge,
                'tax_ids': tax_id_cmd,
                'sequence': 9999,
            })

        # Discount line if applicable
        if self.discount_pct > 0:
            discount_amount = self.subtotal_price * (self.discount_pct / 100.0)
            discount_product = self._get_or_create_discount_product()
            self.env['sale.order.line'].create({
                'order_id': order.id,
                'product_id': discount_product.id,
                'name': _('Discount (%.1f%%)') % self.discount_pct,
                'product_uom_qty': 1,
                'price_unit': -discount_amount,
                'tax_ids': [],
                'sequence': 10000,
            })

        self.write({'sale_order_id': order.id, 'state': 'quoted'})
        _logger.info('WinCraft: Created sale order %s for project %s', order.name, self.ref)

        return {
            'type': 'ir.actions.act_window',
            'name': _('Sale Order'),
            'res_model': 'sale.order',
            'res_id': order.id,
            'view_mode': 'form',
        }

    def _prepare_quote_order_vals(self):
        """Build sale.order create-vals + a resolved tax_id command shared by
        the one-shot create flow (action_create_sale_order) and the
        idempotent sync flow (action_sync_sale_order_for_quote).
        """
        self.ensure_one()
        gst_tax_id_param = self.env['ir.config_parameter'].sudo().get_param(
            'wincraft_studio.gst_tax_id'
        )
        tax_ids = []
        if gst_tax_id_param:
            try:
                tax = self.env['account.tax'].browse(int(gst_tax_id_param))
                if tax.exists():
                    tax_ids = [tax.id]
            except (ValueError, TypeError):
                pass

        validity_days = int(
            self.env['ir.config_parameter'].sudo().get_param(
                'wincraft_studio.default_validity_days', 30
            )
        )
        order_vals = {
            'partner_id': self.partner_id.id,
            'wincraft_project_id': self.id,
            'validity_date': fields.Date.today() + timedelta(days=validity_days),
            'note': self.terms or '',
            'user_id': self.user_id.id,
            'company_id': self.company_id.id,
        }
        return order_vals, [(6, 0, tax_ids)]

    def action_sync_sale_order_for_quote(self):
        """Create or update this project's Sale Order so "Get Quote" always
        reflects the current design, without disturbing an order that has
        already been confirmed (or cancelled).

        Unlike action_create_sale_order (one-shot, errors if an order
        already exists), this is safe to call repeatedly: window lines are
        matched via wincraft.window.sale_order_line_id and updated in place,
        and the installation/discount lines are matched by product.

        Returns a dict with a user-facing 'message' and an optional
        'warning' flag (True when an already-confirmed order was left
        untouched).
        """
        self.ensure_one()
        if not self.window_ids:
            raise UserError(_('Please add at least one window before requesting a quote.'))

        order = self.sale_order_id
        if order and order.state not in ('draft', 'sent'):
            return {
                'message': _(
                    'Sale order %s is already confirmed — the quote PDF reflects the '
                    'current design, but the order itself was not changed.'
                ) % order.name,
                'warning': True,
            }

        order_vals, tax_id_cmd = self._prepare_quote_order_vals()
        if not order:
            order = self.env['sale.order'].create(order_vals)
        else:
            order.write({
                'partner_id': order_vals['partner_id'],
                'note': order_vals['note'],
            })

        # Window lines — update in place when already linked to this order
        for idx, window in enumerate(self.window_ids.sorted('sequence'), start=1):
            description = self._build_window_description(window)
            line = window.sale_order_line_id
            if line and line.order_id == order:
                line.write({
                    'name': description,
                    'price_unit': window.unit_price,
                    'tax_ids': tax_id_cmd,
                    'sequence': idx * 10,
                })
            else:
                product = self._get_or_create_window_product(window)
                line = self.env['sale.order.line'].create({
                    'order_id': order.id,
                    'product_id': product.id,
                    'name': description,
                    'product_uom_qty': 1,
                    'price_unit': window.unit_price,
                    'tax_ids': tax_id_cmd,
                    'sequence': idx * 10,
                })
                window.write({'sale_order_line_id': line.id})

        # One-time add-on lines — matched by product, same pattern as
        # installation/discount below. Stale lines for an add-on no longer
        # referenced by any window in the project are removed.
        one_time_addons = self._get_one_time_addons()
        addon_products = {addon: self._get_or_create_addon_product(addon) for addon in one_time_addons}
        kept_product_ids = {p.id for p in addon_products.values()}
        for addon_idx, (addon, addon_product) in enumerate(addon_products.items(), start=1):
            addon_line = order.order_line.filtered(lambda l: l.product_id == addon_product)[:1]
            vals = {
                'name': addon.name,
                'price_unit': addon.price,
                'tax_ids': tax_id_cmd,
                'sequence': 9000 + addon_idx,
            }
            if addon_line:
                addon_line.write(vals)
            else:
                self.env['sale.order.line'].create({
                    'order_id': order.id, 'product_id': addon_product.id,
                    'product_uom_qty': 1, **vals,
                })
        # Remove any previously-synced one-time add-on line whose add-on is
        # no longer selected on any window in the project.
        addon_product_name_prefix = 'WinCraft — Add-on: '
        stale_addon_lines = order.order_line.filtered(
            lambda l: l.product_id.name and l.product_id.name.startswith(addon_product_name_prefix)
            and l.product_id.id not in kept_product_ids
        )
        stale_addon_lines.unlink()

        # Installation line — matched by product (no dedicated FK like windows have)
        install_product = self._get_or_create_installation_product()
        install_line = order.order_line.filtered(lambda l: l.product_id == install_product)[:1]
        if self.installation_charge > 0:
            vals = {
                'name': _('Installation & Site Work'),
                'price_unit': self.installation_charge,
                'tax_ids': tax_id_cmd,
                'sequence': 9999,
            }
            if install_line:
                install_line.write(vals)
            else:
                self.env['sale.order.line'].create({
                    'order_id': order.id, 'product_id': install_product.id,
                    'product_uom_qty': 1, **vals,
                })
        elif install_line:
            install_line.unlink()

        # Discount line — same matched-by-product pattern
        discount_product = self._get_or_create_discount_product()
        discount_line = order.order_line.filtered(lambda l: l.product_id == discount_product)[:1]
        if self.discount_pct > 0:
            discount_amount = self.subtotal_price * (self.discount_pct / 100.0)
            vals = {
                'name': _('Discount (%.1f%%)') % self.discount_pct,
                'price_unit': -discount_amount,
                'tax_ids': [(6, 0, [])],
                'sequence': 10000,
            }
            if discount_line:
                discount_line.write(vals)
            else:
                self.env['sale.order.line'].create({
                    'order_id': order.id, 'product_id': discount_product.id,
                    'product_uom_qty': 1, **vals,
                })
        elif discount_line:
            discount_line.unlink()

        vals = {'sale_order_id': order.id}
        if self.state in ('draft', 'designing'):
            vals['state'] = 'quoted'
        self.write(vals)

        _logger.info('WinCraft: Synced sale order %s for project %s', order.name, self.ref)
        return {'message': _('Quote synced to %s.') % order.name}

    def action_print_quote(self):
        """Trigger the QWeb quote PDF report.

        config=False skips Odoo's "Configure your document layout"
        interception, which otherwise replaces the PDF with a setup
        wizard for admin users on companies that haven't picked a
        layout yet — silently breaking the "Get Quote" button.
        """
        self.ensure_one()
        return self.env.ref('wincraft_studio.action_wincraft_quote_report').report_action(self, config=False)

    def action_print_cutlist(self):
        """Trigger the QWeb cut-list PDF report."""
        self.ensure_one()
        return self.env.ref('wincraft_studio.action_wincraft_cutlist_report').report_action(self, config=False)

    def action_view_cutlist(self):
        """Open this project's cut-list lines on screen (Frame/Glass/Hardware), exportable to Excel."""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Cut List — %s') % self.name,
            'res_model': 'wincraft.cutlist.line',
            'view_mode': 'list',
            'views': [(self.env.ref('wincraft_studio.view_wincraft_cutlist_line_list').id, 'list')],
            'search_view_id': [self.env.ref('wincraft_studio.view_wincraft_cutlist_line_search').id, 'search'],
            'domain': [('project_id', '=', self.id)],
            'context': {'group_by': ['category']},
        }

    def action_view_sale_order(self):
        """Open the linked sale order."""
        self.ensure_one()
        if not self.sale_order_id:
            raise UserError(_('No sale order linked to this project yet.'))
        return {
            'type': 'ir.actions.act_window',
            'name': _('Sale Order'),
            'res_model': 'sale.order',
            'res_id': self.sale_order_id.id,
            'view_mode': 'form',
        }

    def action_set_state_designing(self):
        """Move project to Designing state."""
        self.write({'state': 'designing'})

    def action_set_state_quoted(self):
        """Move project to Quoted state."""
        self.write({'state': 'quoted'})

    def action_set_state_accepted(self):
        """Move project to Accepted state."""
        self.write({'state': 'accepted'})

    def action_set_state_fabricating(self):
        """Move project to Fabricating state."""
        self.write({'state': 'fabricating'})

    def action_set_state_delivered(self):
        """Move project to Delivered state."""
        self.write({'state': 'delivered'})

    def action_open_wincraft_project(self):
        """Stat-button action — reloads the current project form."""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'res_model': 'wincraft.project',
            'res_id': self.id,
            'view_mode': 'form',
            'target': 'current',
        }

    # ------------------------------------------------------------------
    # Helper methods
    # ------------------------------------------------------------------

    def _get_or_create_window_product(self, window):
        """Find or create a product.product for a given window type/material combo.

        Args:
            window (wincraft.window): The window record.

        Returns:
            product.product: The product to use on the sale order line.
        """
        type_labels = dict(
            [
                ('casement', 'Casement'),
                ('sliding', 'Sliding'),
                ('fixed', 'Fixed / Picture'),
                ('bifold', 'Bi-Fold'),
                ('awning', 'Awning'),
                ('arched', 'Arched / Shaped'),
                ('bay', 'Bay Window'),
                ('bow', 'Bow Window'),
                ('tilt_turn', 'Tilt & Turn'),
                ('single_hung', 'Single Hung'),
                ('double_hung', 'Double Hung'),
                ('single_slider', 'Single Slider'),
                ('double_slider', 'Double Slider'),
                ('end_vent_slider', 'End Vent Slider'),
                ('fixed_casement', 'Fixed Casement'),
            ]
        )
        window_type_label = type_labels.get(window.window_type, window.window_type.capitalize())
        template_name = f'Window — {window_type_label}'

        # Look for an existing product template with this name
        tmpl = self.env['product.template'].search(
            [('name', '=', template_name), ('sale_ok', '=', True)],
            limit=1,
        )
        if not tmpl:
            tmpl = self.env['product.template'].create({
                'name': template_name,
                'type': 'service',
                'sale_ok': True,
                'purchase_ok': False,
                'uom_id': self.env.ref('uom.product_uom_unit').id,
                'invoice_policy': 'order',
            })
            _logger.info('WinCraft: Created product template "%s"', template_name)

        return tmpl.product_variant_ids[:1]

    def _get_or_create_installation_product(self):
        """Find or create the Installation product."""
        install_name = 'WinCraft — Installation & Site Work'
        product = self.env['product.product'].search(
            [('name', '=', install_name)], limit=1
        )
        if not product:
            tmpl = self.env['product.template'].create({
                'name': install_name,
                'type': 'service',
                'sale_ok': True,
                'purchase_ok': False,
                'uom_id': self.env.ref('uom.product_uom_unit').id,
                'invoice_policy': 'order',
            })
            product = tmpl.product_variant_ids[:1]
        return product

    def _get_or_create_discount_product(self):
        """Find or create the Discount product."""
        discount_name = 'WinCraft — Discount'
        product = self.env['product.product'].search(
            [('name', '=', discount_name)], limit=1
        )
        if not product:
            tmpl = self.env['product.template'].create({
                'name': discount_name,
                'type': 'service',
                'sale_ok': True,
                'purchase_ok': False,
                'uom_id': self.env.ref('uom.product_uom_unit').id,
                'invoice_policy': 'order',
            })
            product = tmpl.product_variant_ids[:1]
        return product

    def _get_or_create_addon_product(self, addon):
        """Find or create a product.product for a one-time (project-level) add-on.

        One per wincraft.addon record, so the Sale Order line traces back to
        exactly which add-on was charged (Solar Tinting Film, Site Survey, …).
        """
        product_name = f'WinCraft — Add-on: {addon.name}'
        product = self.env['product.product'].search([('name', '=', product_name)], limit=1)
        if not product:
            tmpl = self.env['product.template'].create({
                'name': product_name,
                'type': 'service',
                'sale_ok': True,
                'purchase_ok': False,
                'uom_id': self.env.ref('uom.product_uom_unit').id,
                'invoice_policy': 'order',
            })
            product = tmpl.product_variant_ids[:1]
        return product

    def _get_one_time_addons(self):
        """Add-ons flagged per_window=False across this project's windows, deduplicated."""
        self.ensure_one()
        return self.window_ids.addon_ids.filtered(lambda a: not a.per_window)

    def _build_window_description(self, window):
        """Build a human-readable sale order line description for a window.

        Args:
            window (wincraft.window): The window record.

        Returns:
            str: Multi-line description for the sale order line.
        """
        parts = [window.name or '']
        if window.frame_material_id:
            parts.append(f'Frame: {window.frame_material_id.name}')
        if window.glass_type_id:
            parts.append(f'Glass: {window.glass_type_id.name}')
        if window.hardware_ids:
            hw_names = ', '.join(window.hardware_ids.mapped('name'))
            parts.append(f'Hardware: {hw_names}')
        if window.addon_ids:
            addon_names = ', '.join(window.addon_ids.mapped('name'))
            parts.append(f'Add-ons: {addon_names}')
        if window.notes:
            parts.append(window.notes)
        return '\n'.join(parts)

    def _send_quote_email(self):
        """Send quote PDF to client via Odoo's email composer."""
        self.ensure_one()
        try:
            template = self.env.ref(
                'wincraft_studio.email_template_wincraft_quote', raise_if_not_found=False
            )
            if template and self.partner_id.email:
                portal_url = self._get_portal_url()
                template.with_context(portal_url=portal_url).send_mail(
                    self.id, force_send=False,
                )
                _logger.info(
                    'WinCraft: Queued quote email for project %s to %s',
                    self.ref,
                    self.partner_id.email,
                )
        except Exception as exc:
            _logger.warning('WinCraft: Failed to queue quote email: %s', exc)

    def _get_portal_url(self):
        """Return the portal URL for this project."""
        self.ensure_one()
        base_url = self.env['ir.config_parameter'].sudo().get_param('web.base.url')
        return f"{base_url}/my/wincraft/{self.id}"

    @api.model
    def _cron_send_fabrication_reminders(self):
        """Send email reminders for projects due in 3 days."""
        target_date = fields.Date.today() + timedelta(days=3)
        projects = self.search([
            ('state', '=', 'fabricating'),
            ('due_date', '=', target_date),
        ])
        for project in projects:
            if project.fabricator_id and project.fabricator_id.email:
                project.message_post(
                    body=_(
                        'Fabrication reminder: Project <b>%s</b> (%s) is due on %s. '
                        'Please ensure all windows are completed on time.'
                    ) % (project.name, project.ref, project.due_date),
                    message_type='comment',
                    subtype_xmlid='mail.mt_note',
                    partner_ids=[project.fabricator_id.partner_id.id],
                )
        _logger.info(
            'WinCraft: Sent fabrication reminders for %d projects due on %s',
            len(projects), target_date,
        )

    def action_create_revision(self):
        """Snapshot current quote and increment version number."""
        self.ensure_one()
        import json
        window_snapshot = []
        for win in self.window_ids:
            window_snapshot.append({
                'name': win.name,
                'window_type': win.window_type,
                'width_mm': win.width_mm,
                'height_mm': win.height_mm,
                'panels_horizontal': win.panels_horizontal,
                'panels_vertical': win.panels_vertical,
                'material': win.frame_material_id.name if win.frame_material_id else '',
                'glass': win.glass_type_id.name if win.glass_type_id else '',
                'unit_price': win.unit_price,
                'margin_pct': win.margin_pct,
            })
        self.env['wincraft.quote.history'].create({
            'project_id': self.id,
            'version': self.quote_version,
            'subtotal': self.subtotal_price,
            'total': self.total_price,
            'window_data': json.dumps(window_snapshot, indent=2),
        })
        self.quote_version += 1
        self.message_post(
            body=_('Quote revised to version %d.') % self.quote_version,
            message_type='comment',
            subtype_xmlid='mail.mt_note',
        )

    def action_share_whatsapp(self):
        """Open WhatsApp Web with a pre-filled quote summary message."""
        self.ensure_one()
        try:
            import urllib.parse
            portal_url = self._get_portal_url()
            msg_lines = [
                f"*{self.env.company.name} — Window Quotation*",
                f"Project: {self.name} ({self.ref})",
                f"Windows: {self.total_windows}",
                f"Total: {self.currency_id.symbol or ''}{self.total_price:,.0f}",
                "",
                f"View & accept online: {portal_url}",
            ]
            message = "\n".join(msg_lines)
            phone = (self.partner_id.mobile or self.partner_id.phone or '').strip()
            phone = ''.join(c for c in phone if c.isdigit() or c == '+')
            if phone:
                wa_url = f"https://wa.me/{phone}?text={urllib.parse.quote(message)}"
            else:
                wa_url = f"https://wa.me/?text={urllib.parse.quote(message)}"
            return {
                'type': 'ir.actions.act_url',
                'url': wa_url,
                'target': 'new',
            }
        except Exception as exc:
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': _('WhatsApp Sharing Failed'),
                    'message': str(exc),
                    'type': 'warning',
                    'sticky': False,
                },
            }

    def _create_dealer_commission(self):
        """Auto-create a commission record when a project is accepted, if dealer is set."""
        self.ensure_one()
        if not self.dealer_id:
            return
        existing = self.env['wincraft.dealer.commission'].search([
            ('project_id', '=', self.id),
            ('dealer_id', '=', self.dealer_id.id),
            ('state', '!=', 'cancelled'),
        ], limit=1)
        if existing:
            return
        self.env['wincraft.dealer.commission'].create({
            'dealer_id': self.dealer_id.id,
            'project_id': self.id,
            'commission_pct': self.dealer_id.commission_pct,
            'project_amount': self.total_price,
        })

    def _create_fabrication_picking(self):
        """Create an internal stock picking for glass sheets when fabrication starts.

        Iterates over all windows and creates a stock.picking for glass material
        reservation. Falls through silently if stock module not configured.
        """
        self.ensure_one()
        try:
            internal_type = self.env['stock.picking.type'].search(
                [('code', '=', 'internal'), ('company_id', '=', self.company_id.id)],
                limit=1,
            )
            if not internal_type:
                return

            # Group windows by glass type and compute total sqm
            glass_demands = {}
            for window in self.window_ids:
                if window.glass_type_id:
                    key = window.glass_type_id.id
                    glass_demands[key] = glass_demands.get(key, 0.0) + window.area_sqm

            if not glass_demands:
                return

            move_vals_list = []
            for glass_id, total_sqm in glass_demands.items():
                glass = self.env['wincraft.glass.type'].browse(glass_id)
                # Try to find a linked product in inventory for this glass type
                glass_product = self.env['product.product'].search(
                    [('name', 'ilike', glass.name), ('type', 'in', ['consu', 'product'])],
                    limit=1,
                )
                if glass_product:
                    move_vals_list.append({
                        'name': f'Glass — {glass.name}',
                        'product_id': glass_product.id,
                        'product_uom': glass_product.uom_id.id,
                        'product_uom_qty': round(total_sqm, 4),
                    })

            if move_vals_list:
                picking = self.env['stock.picking'].create({
                    'picking_type_id': internal_type.id,
                    'origin': self.ref,
                    'partner_id': self.partner_id.id,
                    'company_id': self.company_id.id,
                    'move_ids': [(0, 0, mv) for mv in move_vals_list],
                    'note': _(
                        'Auto-created by WinCraft Studio for project %s'
                    ) % self.ref,
                })
                _logger.info(
                    'WinCraft: Created internal picking %s for project %s',
                    picking.name,
                    self.ref,
                )
        except Exception as exc:
            _logger.warning(
                'WinCraft: Could not create fabrication picking for project %s: %s',
                self.ref,
                exc,
            )

    # ------------------------------------------------------------------
    # BOM Preview & Generation
    # ------------------------------------------------------------------

    def action_preview_bom(self):
        """Return a preview of BOM data without creating any records.

        Returns a list of window dicts, each containing:
        - window name, type, dimensions
        - list of component dicts {name, qty, uom, category}
        - totals per category
        """
        self.ensure_one()
        windows_preview = []
        grand_totals = {}

        for window in self.window_ids:
            components = window._get_bom_components()
            if not components:
                continue

            # Group by category
            by_category = {}
            for comp in components:
                cat = comp.get('category', 'other')
                by_category.setdefault(cat, []).append(comp)
                grand_totals.setdefault(cat, 0)
                grand_totals[cat] += comp['qty']

            windows_preview.append({
                'id': window.id,
                'name': window.name or f"{window.window_type} {window.width_mm}×{window.height_mm}",
                'window_type': window.window_type,
                'width_mm': window.width_mm,
                'height_mm': window.height_mm,
                'panels': f"{window.panels_horizontal}×{window.panels_vertical}",
                'area_sqm': round(window.area_sqm, 3),
                'components': components,
                'by_category': {k: v for k, v in by_category.items()},
                'component_count': len(components),
            })

        return {
            'project_ref': self.ref,
            'project_name': self.name,
            'window_count': len(windows_preview),
            'windows': windows_preview,
            'grand_totals': {k: round(v, 3) for k, v in grand_totals.items()},
            'mrp_installed': self.env.get('mrp.bom') is not None,
        }

    def action_generate_bom(self):
        """Generate an mrp.bom for each window in the project.

        Creates a parent product for each window and a BOM with lines for:
        - Frame profiles (linear metres)
        - Glass units (per pane)
        - Hardware items
        - Seals/gaskets (perimeter)
        - Georgian bar stock (if configured)

        Returns action to view the generated BOMs.
        """
        self.ensure_one()
        MrpBom = self.env.get('mrp.bom')
        if MrpBom is None:
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': 'Manufacturing Module Required',
                    'message': 'Please install the Manufacturing (mrp) module to generate BOMs.',
                    'type': 'warning',
                    'sticky': False,
                },
            }

        Product = self.env['product.product']
        bom_ids = []

        for window in self.window_ids:
            components = window._get_bom_components()
            if not components:
                continue

            # Find or create a product for this window
            product_name = f"{self.ref} — {window.name}"
            product = Product.search([('name', '=', product_name)], limit=1)
            if not product:
                product = Product.create({
                    'name': product_name,
                    'type': 'consu',
                    'uom_id': self.env.ref('uom.product_uom_unit').id,
                })

            # Create BOM lines
            bom_line_vals = []
            for comp in components:
                # Use mapped product_id when available (from glazing config decomposition)
                comp_product = False
                if comp.get('product_id'):
                    comp_product = Product.browse(comp['product_id']).exists()
                if not comp_product:
                    comp_product = Product.search(
                        [('name', '=', comp['name'])], limit=1,
                    )
                if not comp_product:
                    comp_product = Product.create({
                        'name': comp['name'],
                        'type': 'consu',
                        'uom_id': self.env.ref(comp.get('uom_ref', 'uom.product_uom_unit')).id,
                    })
                bom_line_vals.append((0, 0, {
                    'product_id': comp_product.id,
                    'product_qty': comp['qty'],
                    'product_uom_id': comp_product.uom_id.id,
                }))

            bom = MrpBom.create({
                'product_tmpl_id': product.product_tmpl_id.id,
                'product_qty': 1.0,
                'type': 'normal',
                'bom_line_ids': bom_line_vals,
            })
            bom_ids.append(bom.id)
            _logger.info(
                'WinCraft: Created BOM %s for window %s in project %s',
                bom.display_name, window.name, self.ref,
            )

        if not bom_ids:
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': 'No BOM Generated',
                    'message': 'No windows with components found in this project.',
                    'type': 'info',
                    'sticky': False,
                },
            }

        return {
            'type': 'ir.actions.act_window',
            'name': f'BOMs — {self.ref}',
            'res_model': 'mrp.bom',
            'view_mode': 'list,form',
            'domain': [('id', 'in', bom_ids)],
            'target': 'current',
        }
