# -*- coding: utf-8 -*-
"""
WinCraft Studio — Pricing Rule model.
Formula parameters per material+glass combination.
Controls base rate, fabrication rate, and target margin.
"""
import logging

from odoo import models, fields, api, _
from odoo.exceptions import ValidationError

_logger = logging.getLogger(__name__)



class WincraftPricingRule(models.Model):
    """Pricing rule: defines rates applied when computing a window's unit price."""

    _name = 'wincraft.pricing.rule'
    _description = 'WinCraft Pricing Rule'
    _order = 'material_id, glass_type_id'
    _rec_name = 'name'

    name = fields.Char(
        string='Rule Name',
        translate=True,
        compute='_compute_name',
        store=True,
        readonly=False,
        help='Auto-computed from material + glass combination. Not required at the '
             'database level — required=True here would force the column NOT NULL, '
             'but this is a computed+store+readonly=False field whose value is only '
             'filled in by _compute_name() after the initial INSERT, which raised '
             '`null value in column "name" violates not-null constraint` on every '
             'create() that did not pass an explicit name. _compute_name() already '
             'guarantees a non-blank value (falls back to "Default Pricing Rule").',
    )
    material_id = fields.Many2one(
        comodel_name='wincraft.material',
        string='Frame Material',
        ondelete='restrict',
        help='Leave blank to apply this rule as a fallback for any material.',
    )
    glass_type_id = fields.Many2one(
        comodel_name='wincraft.glass.type',
        string='Glass Type',
        ondelete='restrict',
        help='Leave blank to apply this rule as a fallback for any glass.',
    )
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
    )
    base_rate = fields.Monetary(
        string='Base Material Rate (/sqm)',
        currency_field='currency_id',
        required=True,
        default=0.0,
        help='Cost per sqm from the frame material itself (may overlap with material.rate_per_sqm '
             'or replace it for combo-specific overrides).',
    )
    fabrication_rate = fields.Monetary(
        string='Fabrication Rate (/sqm)',
        currency_field='currency_id',
        required=True,
        default=0.0,
        help='Labour/fabrication cost per sqm of window area.',
    )
    margin_pct = fields.Float(
        string='Target Margin (%)',
        required=True,
        digits=(5, 2),
        default=20.0,
        help='Percentage mark-up applied after all costs to arrive at unit price.',
    )

    # ── United Inches tier pricing (Canadian market) ──
    pricing_method = fields.Selection(
        selection=[
            ('area', 'Area-based (per sqm)'),
            ('united_inches', 'United Inches tiers'),
        ],
        string='Pricing Method',
        default='area',
        help='Area-based uses base_rate × sqm. United Inches uses a tiered '
             'flat price based on (width_in + height_in).',
    )
    ui_tier_ids = fields.One2many(
        comodel_name='wincraft.pricing.ui.tier',
        inverse_name='rule_id',
        string='United Inches Tiers',
        help='Flat-price tiers by united inches range.',
    )
    is_fallback = fields.Boolean(
        string='Fallback Rule',
        compute='_compute_is_fallback',
        store=True,
        help='True when both material and glass are unset — used as default rule.',
    )

    _base_rate_non_negative = models.Constraint('CHECK(base_rate >= 0)', 'Base rate must be non-negative.')
    _fabrication_rate_non_negative = models.Constraint('CHECK(fabrication_rate >= 0)', 'Fabrication rate must be non-negative.')
    _margin_non_negative = models.Constraint('CHECK(margin_pct >= 0)', 'Margin % must be non-negative.')
    _unique_combo = models.Constraint('UNIQUE(material_id, glass_type_id)', 'A pricing rule for this material + glass combination already exists.')

    @api.depends('material_id', 'glass_type_id')
    def _compute_name(self):
        """Auto-compose rule name from material and glass names."""
        for record in self:
            parts = []
            if record.material_id:
                parts.append(record.material_id.name)
            if record.glass_type_id:
                parts.append(record.glass_type_id.name)
            if parts:
                record.name = ' + '.join(parts)
            elif not record.name:
                record.name = _('Default Pricing Rule')

    @api.depends('material_id', 'glass_type_id')
    def _compute_is_fallback(self):
        """Mark this rule as a fallback if neither material nor glass is set."""
        for record in self:
            record.is_fallback = not record.material_id and not record.glass_type_id

    @api.constrains('margin_pct')
    def _check_margin(self):
        """Warn if margin is unrealistically high (> 500%)."""
        for record in self:
            if record.margin_pct > 500:
                raise ValidationError(
                    _('Target margin of %.1f%% seems unrealistic. Please verify.') % record.margin_pct
                )

    @api.constrains('material_id', 'glass_type_id', 'company_id')
    def _check_unique_fallback(self):
        """Enforce at most one fallback rule (material and glass both blank) per company.

        The SQL UNIQUE(material_id, glass_type_id) constraint can't catch this case:
        Postgres treats every NULL as distinct from every other NULL, so multiple
        fully-blank rows can coexist and _get_pricing_rule()'s search(limit=1) would
        then return whichever one happens to sort first — non-deterministic pricing.
        """
        for record in self:
            if record.material_id or record.glass_type_id:
                continue
            duplicate = self.search([
                ('id', '!=', record.id),
                ('material_id', '=', False),
                ('glass_type_id', '=', False),
                ('company_id', '=', record.company_id.id),
            ], limit=1)
            if duplicate:
                raise ValidationError(
                    _('A fallback pricing rule (no material, no glass) already exists '
                      'for this company: "%s". Only one fallback rule is allowed so '
                      'price lookups stay deterministic.') % duplicate.name
                )

    def get_ui_tier_price(self, united_inches):
        """Return the flat tier price for the given united inches value.

        Falls back to the nearest edge tier (lowest tier if below every
        configured range, highest tier if above every configured range)
        when no exact match is found. Previously this always returned the
        highest tier's price for any unmatched value, which overcharged
        windows smaller than the smallest configured tier.
        """
        self.ensure_one()
        if self.pricing_method != 'united_inches' or not self.ui_tier_ids:
            return 0.0
        tiers = self.ui_tier_ids.sorted('ui_min')
        for tier in tiers:
            if tier.ui_min <= united_inches <= tier.ui_max:
                return tier.price
        if united_inches < tiers[0].ui_min:
            return tiers[0].price
        return tiers[-1].price


class WincraftPricingUITier(models.Model):
    """United Inches pricing tier — flat price for a range of united inches."""

    _name = 'wincraft.pricing.ui.tier'
    _description = 'United Inches Pricing Tier'
    _order = 'ui_min'

    rule_id = fields.Many2one(
        comodel_name='wincraft.pricing.rule',
        string='Pricing Rule',
        required=True,
        ondelete='cascade',
    )
    ui_min = fields.Float(
        string='Min UI',
        required=True,
        digits=(8, 2),
        help='Minimum united inches (inclusive) for this tier.',
    )
    ui_max = fields.Float(
        string='Max UI',
        required=True,
        digits=(8, 2),
        help='Maximum united inches (inclusive) for this tier.',
    )
    price = fields.Monetary(
        string='Tier Price',
        currency_field='currency_id',
        required=True,
        help='Flat price for windows falling in this united inches range.',
    )
    currency_id = fields.Many2one(
        comodel_name='res.currency',
        related='rule_id.currency_id',
        store=True,
    )

    _tier_range_valid = models.Constraint(
        'CHECK(ui_max >= ui_min)',
        'Max UI must be >= Min UI.',
    )
