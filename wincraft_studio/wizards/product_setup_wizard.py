# -*- coding: utf-8 -*-
"""
WinCraft Studio — Product Setup Wizard.

Bulk-creates placeholder products for frame/glass/spacer configs
so that the admin can quickly set up the product catalogue required
by the WinCraft Studio BOM builder and Sale Order generator.
"""
import logging

from odoo import models, fields, api, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class WincraftProductSetupWizard(models.TransientModel):
    """Wizard: bulk-create frame/glass/spacer products and configs."""

    _name = 'wincraft.product.setup.wizard'
    _description = 'WinCraft Product Setup Wizard'

    # ── Stage tracking ────────────────────────────────────────────────────
    stage = fields.Selection([
        ('profile', 'Profile Type'),
        ('openings', 'Opening Types'),
        ('colors', 'Colors'),
        ('glass', 'Glass Products'),
        ('spacer', 'Spacer Products'),
        ('summary', 'Summary'),
    ], default='profile', required=True)

    # ── Stage: Profile Type ─────────────────────────────────────────────
    profile_type_id = fields.Many2one(
        comodel_name='wincraft.window.type.series',
        string='Profile Type',
        help='Select the profile type to create frame products for.',
    )

    # ── Stage: Opening Types ──────────────────────────────────────────────
    opening_type_ids = fields.Char(
        string='Opening Types',
        default='fixed,casement-l,casement-r,awning,sliding,tiltturn',
        help='Comma-separated list of opening type keys to create products for.',
    )

    # ── Stage: Colors ─────────────────────────────────────────────────────
    color_attribute_id = fields.Many2one(
        comodel_name='product.attribute',
        string='Color Attribute',
        help='The product attribute to use for frame colors (e.g. "Color").',
    )
    color_value_ids = fields.Many2many(
        comodel_name='product.attribute.value',
        string='Color Values',
        help='Select which color variants to create for each frame product.',
    )

    # ── Stage: Glass ──────────────────────────────────────────────────────
    create_glass_products = fields.Boolean(
        string='Create Glass Products',
        default=True,
        help='Create placeholder products for glass options that have no product linked.',
    )

    # ── Stage: Spacer ─────────────────────────────────────────────────────
    create_spacer_products = fields.Boolean(
        string='Create Spacer Products',
        default=True,
        help='Create placeholder products for spacer configs that have no product linked.',
    )

    # ── Summary ───────────────────────────────────────────────────────────
    summary_html = fields.Html(
        string='Summary',
        readonly=True,
        compute='_compute_summary_html',
    )

    # ── Computed counts ───────────────────────────────────────────────────
    frame_count = fields.Integer(
        string='Frame Products to Create',
        compute='_compute_counts',
    )
    glass_count = fields.Integer(
        string='Glass Products to Create',
        compute='_compute_counts',
    )
    spacer_count = fields.Integer(
        string='Spacer Products to Create',
        compute='_compute_counts',
    )

    @api.depends('opening_type_ids', 'profile_type_id', 'create_glass_products', 'create_spacer_products')
    def _compute_counts(self):
        for rec in self:
            ot_list = [t.strip() for t in (rec.opening_type_ids or '').split(',') if t.strip()]
            existing = self.env['wincraft.frame.config'].search([
                ('profile_type_id', '=', rec.profile_type_id.id),
                ('opening_type', 'in', ot_list),
            ]) if rec.profile_type_id and ot_list else self.env['wincraft.frame.config']
            rec.frame_count = len(ot_list) - len(existing)

            if rec.create_glass_products:
                rec.glass_count = self.env['wincraft.glass.lite'].search_count([
                    ('product_id', '=', False),
                    ('active', '=', True),
                ])
            else:
                rec.glass_count = 0

            if rec.create_spacer_products:
                rec.spacer_count = self.env['wincraft.spacer.config'].search_count([
                    ('product_tmpl_id', '=', False),
                    ('active', '=', True),
                ])
            else:
                rec.spacer_count = 0

    @api.depends('frame_count', 'glass_count', 'spacer_count', 'profile_type_id', 'color_value_ids')
    def _compute_summary_html(self):
        for rec in self:
            parts = []
            if rec.profile_type_id:
                parts.append(f'<b>Profile Type:</b> {rec.profile_type_id.name}')
            if rec.frame_count > 0:
                color_count = len(rec.color_value_ids)
                variant_note = f' ({color_count} color variants each)' if color_count else ''
                parts.append(f'<b>{rec.frame_count}</b> frame products{variant_note}')
            if rec.glass_count > 0:
                parts.append(f'<b>{rec.glass_count}</b> glass products')
            if rec.spacer_count > 0:
                parts.append(f'<b>{rec.spacer_count}</b> spacer products')
            if not parts:
                rec.summary_html = '<p class="text-muted">Nothing to create — all products already exist.</p>'
            else:
                rec.summary_html = '<p>Will create:</p><ul>' + ''.join(f'<li>{p}</li>' for p in parts) + '</ul>'

    # ── Navigation ────────────────────────────────────────────────────────
    def action_next(self):
        self.ensure_one()
        stages = ['profile', 'openings', 'colors', 'glass', 'spacer', 'summary']
        idx = stages.index(self.stage)
        if self.stage == 'summary':
            return self.action_create_products()
        if idx < len(stages) - 1:
            self.stage = stages[idx + 1]
        return self._reload()

    def action_prev(self):
        self.ensure_one()
        stages = ['profile', 'openings', 'colors', 'glass', 'spacer', 'summary']
        idx = stages.index(self.stage)
        if idx > 0:
            self.stage = stages[idx - 1]
        return self._reload()

    def _reload(self):
        return {
            'type': 'ir.actions.act_window',
            'res_model': self._name,
            'res_id': self.id,
            'view_mode': 'form',
            'target': 'new',
        }

    # ── Main creation action ──────────────────────────────────────────────
    def action_create_products(self):
        """Create all selected products and configs."""
        self.ensure_one()
        created_configs = self.env['wincraft.frame.config']

        # 1. Frame products
        if self.profile_type_id and self.opening_type_ids:
            created_configs = self._create_frame_products()

        # 2. Glass products
        if self.create_glass_products:
            self._create_glass_products()

        # 3. Spacer products
        if self.create_spacer_products:
            self._create_spacer_products()

        # Return action showing frame configs
        if created_configs:
            return {
                'type': 'ir.actions.act_window',
                'name': _('Created Frame Mappings'),
                'res_model': 'wincraft.frame.config',
                'view_mode': 'list,form',
                'domain': [('id', 'in', created_configs.ids)],
                'target': 'current',
            }
        return {'type': 'ir.actions.act_window_close'}

    def _create_frame_products(self):
        """Create frame product templates + wincraft.frame.config records."""
        self.ensure_one()
        ot_labels = dict(self.env['wincraft.opening.type']._selection_opening_type())
        ot_list = [t.strip() for t in (self.opening_type_ids or '').split(',') if t.strip()]
        profile = self.profile_type_id
        created_configs = self.env['wincraft.frame.config']

        for ot_key in ot_list:
            # Skip if config already exists
            existing = self.env['wincraft.frame.config'].search([
                ('opening_type', '=', ot_key),
                ('profile_type_id', '=', profile.id),
            ], limit=1)
            if existing:
                continue

            ot_label = ot_labels.get(ot_key, ot_key.replace('-', ' ').title())
            product_name = f'[DRAFT] {profile.name} — {ot_label}'

            # Create product.template
            tmpl_vals = {
                'name': product_name,
                'type': 'consu',
                'sale_ok': True,
                'purchase_ok': True,
                'default_code': f'WC-{profile.name[:6].upper()}-{ot_key.upper()[:8]}',
            }
            tmpl = self.env['product.template'].create(tmpl_vals)

            # Add color attribute line if colors selected
            if self.color_attribute_id and self.color_value_ids:
                self.env['product.template.attribute.line'].create({
                    'product_tmpl_id': tmpl.id,
                    'attribute_id': self.color_attribute_id.id,
                    'value_ids': [(6, 0, self.color_value_ids.ids)],
                })

            # Create wincraft.frame.config
            config = self.env['wincraft.frame.config'].create({
                'opening_type': ot_key,
                'profile_type_id': profile.id,
                'product_tmpl_id': tmpl.id,
            })
            created_configs |= config
            _logger.info('ProductSetup: Created frame product "%s" (tmpl=%s) → config=%s',
                         product_name, tmpl.id, config.id)

        return created_configs

    def _create_glass_products(self):
        """Create placeholder products for glass options without a product."""
        self.ensure_one()
        options = self.env['wincraft.glass.lite'].search([
            ('product_id', '=', False),
            ('active', '=', True),
        ])
        for opt in options:
            product_name = f'[DRAFT] Glass — {opt.name}'
            tmpl = self.env['product.template'].create({
                'name': product_name,
                'type': 'consu',
                'sale_ok': True,
                'purchase_ok': True,
                'default_code': f'WC-GLASS-{(opt._canvas_key() or str(opt.id)).upper()[:10]}',
            })
            opt.product_id = tmpl.product_variant_id
            _logger.info('ProductSetup: Created glass product "%s" → glass_option=%s',
                         product_name, opt.id)

    def _create_spacer_products(self):
        """Create placeholder products for spacer configs without a product."""
        self.ensure_one()
        configs = self.env['wincraft.spacer.config'].search([
            ('product_tmpl_id', '=', False),
            ('active', '=', True),
        ])
        for cfg in configs:
            product_name = f'[DRAFT] Spacer — {cfg.label}'
            tmpl = self.env['product.template'].create({
                'name': product_name,
                'type': 'consu',
                'sale_ok': True,
                'purchase_ok': True,
                'default_code': f'WC-SPCR-{cfg.spacer_key.upper()[:10]}',
            })
            cfg.product_tmpl_id = tmpl
            _logger.info('ProductSetup: Created spacer product "%s" → spacer_config=%s',
                         product_name, cfg.id)
