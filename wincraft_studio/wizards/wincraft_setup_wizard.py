# -*- coding: utf-8 -*-
from odoo import models, fields, api, _
import logging

_logger = logging.getLogger(__name__)


class WincraftSetupWizard(models.TransientModel):
    """
    WinCraft Studio first-run setup wizard.
    Opens automatically when no wincraft.project exists and
    wincraft_studio.onboarding_done is False.
    """
    _name = 'wincraft.setup.wizard'
    _description = 'WinCraft Studio Setup Wizard'

    # ── Stage tracking ────────────────────────────────────────────────────
    stage = fields.Selection([
        ('welcome',   'Welcome'),
        ('company',   'Company Details'),
        ('catalogue', 'Materials & Glass'),
        ('pricing',   'Pricing Setup'),
        ('done',      'Ready to Go'),
    ], default='welcome', required=True)

    # ── Stage: company ────────────────────────────────────────────────────
    company_gst = fields.Char(
        string='GST Number (GSTIN)',
        help='Your company GSTIN — printed on all quotations',
    )
    company_phone = fields.Char(
        string='Company Phone',
    )

    # ── Stage: catalogue ──────────────────────────────────────────────────
    mat1_name = fields.Char(
        string='Frame Material 1', default='uPVC White',
    )
    mat1_rate = fields.Float(
        string='Rate per sqm', default=2400.0, digits=(12, 2),
    )
    mat2_name = fields.Char(
        string='Frame Material 2', default='Aluminium',
    )
    mat2_rate = fields.Float(
        string='Rate per sqm', default=3800.0, digits=(12, 2),
    )
    glass1_name = fields.Char(
        string='Glass Type 1', default='Double Glazed',
    )
    glass1_rate = fields.Float(
        string='Rate per sqm', default=800.0, digits=(12, 2),
    )
    glass2_name = fields.Char(
        string='Glass Type 2', default='Triple Glazed',
    )
    glass2_rate = fields.Float(
        string='Rate per sqm', default=1200.0, digits=(12, 2),
    )

    # ── Stage: pricing ────────────────────────────────────────────────────
    default_margin_pct = fields.Float(
        string='Default Margin %', default=20.0, digits=(6, 2),
    )
    default_gst_rate = fields.Float(
        string='GST Rate %', default=18.0, digits=(6, 2),
    )
    default_validity_days = fields.Integer(
        string='Quote Validity (days)', default=30,
    )
    default_installation_rate = fields.Float(
        string='Default Installation Charge', default=0.0, digits=(12, 2),
    )

    # ── Navigation ────────────────────────────────────────────────────────
    def action_next(self):
        self.ensure_one()
        if self.stage == 'welcome':
            self.stage = 'company'
        elif self.stage == 'company':
            self._apply_company_settings()
            self.stage = 'catalogue'
        elif self.stage == 'catalogue':
            self._create_catalogue_items()
            self.stage = 'pricing'
        elif self.stage == 'pricing':
            self._apply_pricing_settings()
            self.stage = 'done'
        elif self.stage == 'done':
            return self.action_finish()
        return self._reload()

    def action_prev(self):
        self.ensure_one()
        stages = ['welcome', 'company', 'catalogue', 'pricing', 'done']
        idx = stages.index(self.stage)
        if idx > 0:
            self.stage = stages[idx - 1]
        return self._reload()

    def action_skip(self):
        """Skip the wizard — mark onboarding as done."""
        self.ensure_one()
        self._mark_done()
        return {'type': 'ir.actions.act_window_close'}

    def action_finish(self):
        """Complete the wizard and open the projects kanban."""
        self.ensure_one()
        self._mark_done()
        return {
            'type': 'ir.actions.act_window',
            'name': _('WinCraft Projects'),
            'res_model': 'wincraft.project',
            'view_mode': 'list,form',
            'target': 'current',
        }

    # ── Private helpers ───────────────────────────────────────────────────
    def _reload(self):
        return {
            'type': 'ir.actions.act_window',
            'res_model': self._name,
            'res_id': self.id,
            'view_mode': 'form',
            'target': 'new',
        }

    def _mark_done(self):
        self.env['ir.config_parameter'].sudo().set_param(
            'wincraft_studio.onboarding_done', 'True',
        )

    def _apply_company_settings(self):
        """Save company GST and phone."""
        if self.company_gst:
            self.env.company.sudo().write({'vat': self.company_gst})
        if self.company_phone:
            self.env.company.sudo().write({'phone': self.company_phone})

    def _create_catalogue_items(self):
        """Create default materials and glass types if they don't exist."""
        Material = self.env['wincraft.material']
        Glass = self.env['wincraft.glass.type']

        for name, rate in [
            (self.mat1_name, self.mat1_rate),
            (self.mat2_name, self.mat2_rate),
        ]:
            if name and not Material.search([('name', '=', name)], limit=1):
                Material.create({'name': name, 'rate_per_sqm': rate})

        for name, rate in [
            (self.glass1_name, self.glass1_rate),
            (self.glass2_name, self.glass2_rate),
        ]:
            if name and not Glass.search([('name', '=', name)], limit=1):
                Glass.create({'name': name, 'rate_per_sqm': rate})

        # Create a fallback pricing rule if none exists
        Rule = self.env['wincraft.pricing.rule']
        if not Rule.search([
            ('material_id', '=', False),
            ('glass_type_id', '=', False),
        ], limit=1):
            Rule.create({
                'base_rate': self.mat1_rate or 2400.0,
                'fabrication_rate': 600.0,
                'margin_pct': self.default_margin_pct or 20.0,
            })

    def _apply_pricing_settings(self):
        """Save pricing config parameters."""
        params = self.env['ir.config_parameter'].sudo()
        params.set_param(
            'wincraft_studio.default_gst_rate',
            str(self.default_gst_rate),
        )
        params.set_param(
            'wincraft_studio.default_validity_days',
            str(self.default_validity_days),
        )
        params.set_param(
            'wincraft_studio.installation_rate',
            str(self.default_installation_rate),
        )

    @api.model
    def action_open_if_needed(self):
        """
        Called from the projects kanban action context.
        Opens the setup wizard if onboarding has not been completed.
        """
        done = self.env['ir.config_parameter'].sudo().get_param(
            'wincraft_studio.onboarding_done', default='False',
        )
        if done == 'True':
            return False
        # Also skip if projects already exist (returning user)
        if self.env['wincraft.project'].search_count(
            [('is_template_workspace', '=', False)]
        ) > 0:
            self._mark_done()
            return False
        wizard = self.create({})
        return {
            'type': 'ir.actions.act_window',
            'res_model': self._name,
            'res_id': wizard.id,
            'view_mode': 'form',
            'target': 'new',
            'name': _('Welcome to WinCraft Studio'),
        }
