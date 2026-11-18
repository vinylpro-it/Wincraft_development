# -*- coding: utf-8 -*-
"""Tests for deduction formula calculations.

Validates that the deduction formulas produce correct cut-list
dimensions for common window configurations.
"""
from odoo.tests.common import TransactionCase


class TestDeductionFormula(TransactionCase):
    """Unit tests for wincraft.deduction.formula computation methods."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()

        # A minimal profile type
        cls.material = cls.env['wincraft.material'].create({
            'name': 'Test uPVC',
            'rate_per_sqm': 100,
        })
        cls.profile = cls.env['wincraft.window.type.series'].create({
            'name': 'Test Profile 60mm',
            'material_id': cls.material.id,
            'mullion_width_mm': 20.0,
        })

        # Fixed window formula (no sash)
        cls.formula_fixed = cls.env['wincraft.deduction.formula'].create({
            'opening_type': 'fixed',
            'profile_type_id': cls.profile.id,
            'frame_rebate_mm': 12.0,
            'frame_mitre_allowance_mm': 3.0,
            'frame_weld_allowance_mm': 3.0,
            'sash_clearance_mm': 0.0,
            'sash_rebate_mm': 0.0,
            'sash_mitre_allowance_mm': 0.0,
            'sash_weld_allowance_mm': 0.0,
            'glass_clearance_mm': 3.0,
            'glazing_bead_depth_mm': 15.0,
            'gasket_allowance_mm': 10.0,
            'reinforcement_deduction_mm': 30.0,
            'reinforcement_required': True,
            'weatherseal_overlap_mm': 0.0,
        })

        # Casement (operable) formula
        cls.formula_casement = cls.env['wincraft.deduction.formula'].create({
            'opening_type': 'casement-l',
            'profile_type_id': cls.profile.id,
            'frame_rebate_mm': 12.0,
            'frame_mitre_allowance_mm': 3.0,
            'frame_weld_allowance_mm': 3.0,
            'sash_clearance_mm': 3.0,
            'sash_rebate_mm': 10.0,
            'sash_mitre_allowance_mm': 3.0,
            'sash_weld_allowance_mm': 3.0,
            'glass_clearance_mm': 3.0,
            'glazing_bead_depth_mm': 15.0,
            'gasket_allowance_mm': 10.0,
            'reinforcement_deduction_mm': 30.0,
            'reinforcement_required': True,
            'weatherseal_overlap_mm': 20.0,
        })

    # ── Fixed window glass size ──────────────────────────────────────────

    def test_fixed_glass_size(self):
        """Fixed glass = pane - 2×(frame_rebate + glass_clearance)."""
        # Pane 1000×800 mm
        gw, gh = self.formula_fixed.get_glass_size(1000.0, 800.0)
        # Expected: 1000 - 2*(12+3) = 1000 - 30 = 970
        self.assertAlmostEqual(gw, 970.0, places=1)
        self.assertAlmostEqual(gh, 770.0, places=1)

    def test_fixed_has_no_sash(self):
        """Fixed formula should have has_sash = False."""
        self.assertFalse(self.formula_fixed.has_sash)

    # ── Casement sash size ───────────────────────────────────────────────

    def test_casement_has_sash(self):
        """Casement formula should have has_sash = True."""
        self.assertTrue(self.formula_casement.has_sash)

    def test_casement_sash_size(self):
        """Casement sash outer = pane - 2×sash_clearance."""
        sw, sh = self.formula_casement.get_sash_size(1000.0, 800.0)
        # Expected: 1000 - 2*3 = 994
        self.assertAlmostEqual(sw, 994.0, places=1)
        self.assertAlmostEqual(sh, 794.0, places=1)

    def test_casement_sash_cut_lengths(self):
        """Casement sash cut = sash_outer - 2×(sash_mitre + sash_weld)."""
        ch, cv = self.formula_casement.get_sash_cut_lengths(1000.0, 800.0)
        # Sash outer W = 994, sash allowance = 2*(3+3) = 12
        # Cut horizontal = 994 + 12 = 1006
        # (using the formula: sash_outer + 2*(mitre+weld))
        sw, sh = self.formula_casement.get_sash_size(1000.0, 800.0)
        sash_allow = 2 * (self.formula_casement.sash_mitre_allowance_mm +
                          self.formula_casement.sash_weld_allowance_mm)
        self.assertAlmostEqual(ch, sw + sash_allow, places=1)
        self.assertAlmostEqual(cv, sh + sash_allow, places=1)

    def test_casement_glass_size(self):
        """Casement glass = sash_inner - 2×(sash_rebate + glass_clearance)."""
        gw, gh = self.formula_casement.get_glass_size(1000.0, 800.0)
        # Sash outer: 994×794
        # Glass: 994 - 2*(10+3) = 994 - 26 = 968
        self.assertAlmostEqual(gw, 968.0, places=1)
        self.assertAlmostEqual(gh, 768.0, places=1)

    # ── Frame cut lengths ────────────────────────────────────────────────

    def test_frame_cut_lengths(self):
        """Frame cut = pane + 2×(mitre + weld)."""
        fh, fv = self.formula_fixed.get_frame_cut_lengths(1000.0, 800.0)
        allowance = 2 * (3.0 + 3.0)  # 12
        self.assertAlmostEqual(fh, 1000.0 + allowance, places=1)
        self.assertAlmostEqual(fv, 800.0 + allowance, places=1)

    # ── Bead cut lengths ─────────────────────────────────────────────────

    def test_bead_cut_lengths(self):
        """Bead = glass dimension + 2 × bead_depth."""
        bh, bv = self.formula_fixed.get_bead_cut_lengths(970.0, 770.0)
        expected_h = 970.0 + 2 * 15.0  # 1000
        expected_v = 770.0 + 2 * 15.0  # 800
        self.assertAlmostEqual(bh, expected_h, places=1)
        self.assertAlmostEqual(bv, expected_v, places=1)

    # ── Gasket length ────────────────────────────────────────────────────

    def test_gasket_length(self):
        """Gasket = 2 × glass perimeter + allowance."""
        gasket = self.formula_fixed.get_gasket_length(970.0, 770.0)
        perimeter = 2 * (970.0 + 770.0)  # 3480
        expected = 2 * perimeter + 10.0  # inner + outer + allowance
        self.assertAlmostEqual(gasket, expected, places=1)

    # ── Reinforcement length ─────────────────────────────────────────────

    def test_reinforcement_length(self):
        """Reinforcement = profile_length - deduction."""
        reinf = self.formula_fixed.get_reinforcement_length(1000.0)
        self.assertAlmostEqual(reinf, 970.0, places=1)

    # ── Weatherseal ──────────────────────────────────────────────────────

    def test_weatherseal_fixed_zero(self):
        """Fixed window has zero weatherseal."""
        ws = self.formula_fixed.get_weatherseal_length(1000.0, 800.0)
        self.assertAlmostEqual(ws, 0.0, places=1)

    def test_weatherseal_casement(self):
        """Casement weatherseal = sash perimeter + overlap."""
        ws = self.formula_casement.get_weatherseal_length(1000.0, 800.0)
        # sash outer: 994×794, perimeter = 2*(994+794) = 3576
        sw, sh = self.formula_casement.get_sash_size(1000.0, 800.0)
        expected = 2 * (sw + sh) + self.formula_casement.weatherseal_overlap_mm
        self.assertAlmostEqual(ws, expected, places=1)
