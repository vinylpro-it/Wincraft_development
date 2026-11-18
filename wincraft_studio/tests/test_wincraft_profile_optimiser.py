# -*- coding: utf-8 -*-
"""Tests for wincraft.profile.optimiser — bin-packing algorithm."""
from odoo.tests.common import TransactionCase
from odoo.exceptions import UserError


class TestProfileOptimiser(TransactionCase):
    """Unit tests for the profile optimiser bin-packing logic."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.partner = cls.env['res.partner'].create({
            'name': 'Optimiser Test Client',
            'email': 'opt@example.com',
        })
        cls.material = cls.env['wincraft.material'].create({
            'name': 'Optimiser Test Material',
            'rate_per_sqm': 500,
        })
        cls.glass = cls.env['wincraft.glass.type'].create({
            'name': 'Optimiser Test Glass',
            'rate_per_sqm': 200,
        })
        cls.project = cls.env['wincraft.project'].create({
            'name': 'Optimiser Test Project',
            'partner_id': cls.partner.id,
        })
        # Create a window using the test material
        cls.window = cls.env['wincraft.window'].create({
            'project_id': cls.project.id,
            'window_type': 'casement',
            'width_mm': 1200,
            'height_mm': 1000,
            'panels_horizontal': 2,
            'panels_vertical': 1,
            'frame_material_id': cls.material.id,
            'glass_type_id': cls.glass.id,
        })

    def _create_optimiser(self, **kwargs):
        vals = {
            'project_id': self.project.id,
            'material_id': self.material.id,
            'standard_length': 6000,
            'blade_kerf': 3,
        }
        vals.update(kwargs)
        return self.env['wincraft.profile.optimiser'].create(vals)

    def test_auto_populate_cuts(self):
        """action_populate_cuts should create cut lines from project windows."""
        opt = self._create_optimiser()
        opt.action_populate_cuts()
        self.assertTrue(opt.cut_line_ids)
        # For a 2H×1V casement: 2 horizontal members, 3 vertical members = 5 lines
        self.assertEqual(len(opt.cut_line_ids), 5)

    def test_compute_produces_bars(self):
        """action_compute should create bar records after populating cuts."""
        opt = self._create_optimiser()
        opt.action_populate_cuts()
        opt.action_compute()
        self.assertTrue(opt.bar_ids)
        self.assertEqual(opt.state, 'computed')
        self.assertGreater(opt.total_bars, 0)

    def test_compute_without_cuts_raises(self):
        """action_compute without cut lines should raise UserError."""
        opt = self._create_optimiser()
        with self.assertRaises(UserError):
            opt.action_compute()

    def test_waste_percentage_reasonable(self):
        """Waste percentage should be between 0 and 100."""
        opt = self._create_optimiser()
        opt.action_populate_cuts()
        opt.action_compute()
        self.assertGreaterEqual(opt.waste_pct, 0)
        self.assertLessEqual(opt.waste_pct, 100)

    def test_no_matching_material_raises(self):
        """Populating cuts for a material not used by any window should raise."""
        other_mat = self.env['wincraft.material'].create({
            'name': 'Unused Material',
            'rate_per_sqm': 100,
        })
        opt = self._create_optimiser(material_id=other_mat.id)
        with self.assertRaises(UserError):
            opt.action_populate_cuts()

    def test_reset_clears_bars(self):
        """action_reset should clear bars and set state back to draft."""
        opt = self._create_optimiser()
        opt.action_populate_cuts()
        opt.action_compute()
        self.assertEqual(opt.state, 'computed')
        opt.action_reset()
        self.assertEqual(opt.state, 'draft')
        self.assertFalse(opt.bar_ids)
