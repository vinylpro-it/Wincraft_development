# -*- coding: utf-8 -*-
"""Tests for wincraft.pricing.rule and the pricing fixes on wincraft.window:
United-Inches tier edge cases, the exact/material-only/glass-only/fallback
resolution chain, fallback-rule uniqueness, per-pane hardware pricing, and
the depth-multiplier / dual-colour surcharge that mirrors the canvas's live
estimate (pricing.js) in the server-authoritative unit_price.
"""
from odoo.tests.common import TransactionCase
from odoo.exceptions import ValidationError


class TestPricingRuleTiers(TransactionCase):
    """get_ui_tier_price() must use the nearest edge tier, not always the highest."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.material = cls.env['wincraft.material'].create({
            'name': 'UI Tier Material', 'rate_per_sqm': 0,
        })
        cls.rule = cls.env['wincraft.pricing.rule'].create({
            'material_id': cls.material.id,
            'pricing_method': 'united_inches',
            'margin_pct': 0,
        })
        cls.env['wincraft.pricing.ui.tier'].create({
            'rule_id': cls.rule.id, 'ui_min': 60, 'ui_max': 80, 'price': 500,
        })
        cls.env['wincraft.pricing.ui.tier'].create({
            'rule_id': cls.rule.id, 'ui_min': 80.01, 'ui_max': 100, 'price': 700,
        })

    def test_within_range_tiers(self):
        self.assertEqual(self.rule.get_ui_tier_price(70), 500)
        self.assertEqual(self.rule.get_ui_tier_price(90), 700)

    def test_below_lowest_tier_uses_lowest_not_highest(self):
        """A window smaller than every configured tier must use the cheapest
        tier — previously this returned the most expensive tier instead."""
        self.assertEqual(self.rule.get_ui_tier_price(30), 500)

    def test_above_highest_tier_uses_highest(self):
        self.assertEqual(self.rule.get_ui_tier_price(150), 700)

    def test_no_tiers_configured_returns_zero(self):
        # A distinct material_id (not a blank fallback rule, and not the same
        # combo as cls.rule) so this doesn't collide with the UNIQUE(material,
        # glass) constraint or a pre-existing fallback rule in the environment.
        other_material = self.env['wincraft.material'].create({
            'name': 'UI Tier Material (no tiers)', 'rate_per_sqm': 0,
        })
        rule = self.env['wincraft.pricing.rule'].create({
            'material_id': other_material.id, 'pricing_method': 'united_inches',
        })
        self.assertEqual(rule.get_ui_tier_price(70), 0.0)


class TestPricingRuleFallbackChain(TransactionCase):
    """exact -> material-only -> glass-only -> global fallback, company-scoped."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.partner = cls.env['res.partner'].create({'name': 'Pricing Fallback Client'})
        cls.material = cls.env['wincraft.material'].create({'name': 'Fallback Material', 'rate_per_sqm': 100})
        cls.other_material = cls.env['wincraft.material'].create({'name': 'Other Material', 'rate_per_sqm': 50})
        cls.glass = cls.env['wincraft.glass.type'].create({'name': 'Fallback Glass', 'rate_per_sqm': 50})
        cls.project = cls.env['wincraft.project'].create({'name': 'Fallback Project', 'partner_id': cls.partner.id})

    def _create_window(self, material=None, glass=None):
        return self.env['wincraft.window'].create({
            'project_id': self.project.id,
            'window_type': 'fixed',
            'width_mm': 1000,
            'height_mm': 1000,
            'frame_material_id': material.id if material else False,
            'glass_type_id': glass.id if glass else False,
        })

    def test_glass_only_fallback_matched_regardless_of_material(self):
        """A rule with material blank + glass set must apply even though the
        window has an unrelated material selected — previously this tier was
        entirely missing from the lookup chain."""
        glass_rule = self.env['wincraft.pricing.rule'].create({
            'glass_type_id': self.glass.id, 'base_rate': 999, 'margin_pct': 0,
        })
        win = self._create_window(material=self.other_material, glass=self.glass)
        self.assertEqual(win._get_pricing_rule(), glass_rule)

    def test_exact_match_wins_over_glass_only(self):
        self.env['wincraft.pricing.rule'].create({'glass_type_id': self.glass.id, 'base_rate': 1})
        exact_rule = self.env['wincraft.pricing.rule'].create({
            'material_id': self.material.id, 'glass_type_id': self.glass.id, 'base_rate': 2,
        })
        win = self._create_window(material=self.material, glass=self.glass)
        self.assertEqual(win._get_pricing_rule(), exact_rule)

    def test_material_only_wins_over_glass_only(self):
        self.env['wincraft.pricing.rule'].create({'glass_type_id': self.glass.id, 'base_rate': 1})
        material_rule = self.env['wincraft.pricing.rule'].create({
            'material_id': self.material.id, 'base_rate': 2,
        })
        win = self._create_window(material=self.material, glass=self.glass)
        self.assertEqual(win._get_pricing_rule(), material_rule)


class TestFallbackRuleUniqueness(TransactionCase):
    """Only one fully-blank (material+glass unset) pricing rule may exist per company."""

    def test_second_fallback_rule_raises(self):
        # A blank fallback rule may already exist in this environment's own
        # configuration — reuse it instead of assuming a pristine DB; only
        # create (and clean up) one if truly none exists.
        existing = self.env['wincraft.pricing.rule'].search(
            [('material_id', '=', False), ('glass_type_id', '=', False)], limit=1,
        )
        if not existing:
            existing = self.env['wincraft.pricing.rule'].create({'base_rate': 1})
            self.addCleanup(existing.unlink)
        with self.assertRaises(ValidationError):
            self.env['wincraft.pricing.rule'].create({'base_rate': 2})


class TestPaneHardwarePricing(TransactionCase):
    """Per-pane hardwareSelections (Properties Panel) must be included in
    unit_price, not just the separate window-level hardware_ids selector."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.partner = cls.env['res.partner'].create({'name': 'Hardware Pricing Client'})
        cls.material = cls.env['wincraft.material'].create({'name': 'HW Pricing Material', 'rate_per_sqm': 0})
        cls.glass = cls.env['wincraft.glass.type'].create({'name': 'HW Pricing Glass', 'rate_per_sqm': 0})
        cls.project = cls.env['wincraft.project'].create({'name': 'HW Pricing Project', 'partner_id': cls.partner.id})
        cls.handle = cls.env['wincraft.hardware'].create({
            'name': 'Test Handle', 'category': 'handle', 'unit_price': 100,
        })
        cls.hinge = cls.env['wincraft.hardware'].create({
            'name': 'Test Hinge', 'category': 'hinge', 'unit_price': 50,
        })
        # Exact-match rule scoped to this class's own material+glass, with
        # base_rate/margin both 0, so unit_price == pane hardware total exactly
        # regardless of any blank fallback rule other test classes may have
        # left behind (a fallback rule lookup only reaches the global blank
        # tier when no exact/material-only/glass-only match exists).
        cls.env['wincraft.pricing.rule'].create({
            'material_id': cls.material.id, 'glass_type_id': cls.glass.id,
            'base_rate': 0, 'fabrication_rate': 0, 'margin_pct': 0,
        })

    def test_pane_hardware_selections_add_to_unit_price(self):
        win = self.env['wincraft.window'].create({
            'project_id': self.project.id,
            'window_type': 'casement',
            'width_mm': 1000,
            'height_mm': 1000,
            'frame_material_id': self.material.id,
            'glass_type_id': self.glass.id,
            'margin_pct': 0,
            'pane_configs': [{
                'openingType': 'casement-l',
                'hardwareSelections': {'handle': self.handle.id, 'hinge': self.hinge.id},
            }],
        })
        # handle qty 1 @ 100 = 100; hinge qty 3 (casement, per _hardware_qty) @ 50 = 150
        self.assertAlmostEqual(win._get_pane_hardware_total(), 250.0, places=2)
        self.assertAlmostEqual(win.unit_price, 250.0, places=2)

    def test_no_hardware_selected_gives_zero(self):
        win = self.env['wincraft.window'].create({
            'project_id': self.project.id,
            'window_type': 'fixed',
            'width_mm': 1000,
            'height_mm': 1000,
            'frame_material_id': self.material.id,
            'glass_type_id': self.glass.id,
            'margin_pct': 0,
        })
        self.assertEqual(win._get_pane_hardware_total(), 0.0)


class TestDepthMultiplierAndDualColour(TransactionCase):
    """unit_price must apply the same profile-depth multiplier and dual-colour
    surcharge shown live on the canvas (pricing.js), so the two never diverge."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.partner = cls.env['res.partner'].create({'name': 'Depth Test Client'})
        cls.material = cls.env['wincraft.material'].create({'name': 'Depth Material', 'rate_per_sqm': 100})
        cls.glass = cls.env['wincraft.glass.type'].create({'name': 'Depth Glass', 'rate_per_sqm': 0})
        cls.project = cls.env['wincraft.project'].create({'name': 'Depth Project', 'partner_id': cls.partner.id})
        cls.env['wincraft.pricing.rule'].create({
            'material_id': cls.material.id, 'glass_type_id': cls.glass.id,
            'base_rate': 100, 'fabrication_rate': 0, 'margin_pct': 0,
        })

    def _create_window(self, **kwargs):
        vals = {
            'project_id': self.project.id, 'window_type': 'fixed',
            'width_mm': 1000, 'height_mm': 1000,
            'frame_material_id': self.material.id, 'glass_type_id': self.glass.id,
            'margin_pct': 0,
        }
        vals.update(kwargs)
        return self.env['wincraft.window'].create(vals)

    def test_deep_profile_costs_more(self):
        base = self._create_window(profile_depth_mm='70')
        deep = self._create_window(profile_depth_mm='90')
        self.assertAlmostEqual(deep.unit_price, base.unit_price * 1.18, places=2)

    def test_shallow_profile_costs_less(self):
        base = self._create_window(profile_depth_mm='70')
        shallow = self._create_window(profile_depth_mm='40')
        self.assertAlmostEqual(shallow.unit_price, base.unit_price * 0.85, places=2)

    def test_dual_colour_surcharge_applies_to_material_cost_only(self):
        single = self._create_window(frame_colour='#ffffff')
        dual = self._create_window(frame_colour='#ffffff', frame_colour_outside='#000000')
        material_cost = single.area_sqm * 100  # base_rate=100, depth 70 -> multiplier 1.0
        self.assertAlmostEqual(dual.unit_price, single.unit_price + material_cost * 0.15, places=2)

    def test_same_colour_both_sides_no_surcharge(self):
        win = self._create_window(frame_colour='#ffffff', frame_colour_outside='#ffffff')
        no_outside = self._create_window(frame_colour='#ffffff')
        self.assertAlmostEqual(win.unit_price, no_outside.unit_price, places=2)
