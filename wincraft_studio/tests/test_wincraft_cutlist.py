# -*- coding: utf-8 -*-
"""Tests for the wincraft.cutlist.line reporting view — category breakdown."""
from odoo.tests.common import TransactionCase


class TestWincraftCutlistLine(TransactionCase):
    """Unit tests for the Cut-List Line SQL view."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.partner = cls.env['res.partner'].create({
            'name': 'Cutlist Test Client',
            'email': 'cutlist@example.com',
        })
        cls.material = cls.env['wincraft.material'].create({
            'name': 'Cutlist Test UPVC',
            'rate_per_sqm': 500,
        })
        cls.glass = cls.env['wincraft.glass.type'].create({
            'name': 'Cutlist Test Double 24mm',
            'rate_per_sqm': 300,
        })
        cls.project = cls.env['wincraft.project'].create({
            'name': 'Cutlist Test Project',
            'partner_id': cls.partner.id,
        })
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

    def _lines(self, **domain_kwargs):
        domain = [('window_id', '=', self.window.id)]
        domain += [(k, '=', v) for k, v in domain_kwargs.items()]
        return self.env['wincraft.cutlist.line'].search(domain)

    def test_one_line_per_category(self):
        """Each window should produce exactly one frame row and one glass row."""
        self.assertEqual(len(self._lines(category='frame')), 1)
        self.assertEqual(len(self._lines(category='glass')), 1)

    def test_frame_dimensions_match_window(self):
        """Frame row dimensions should equal the raw window dimensions."""
        frame_line = self._lines(category='frame')
        self.assertEqual(frame_line.dim1_mm, 1200)
        self.assertEqual(frame_line.dim2_mm, 1000)
        self.assertEqual(frame_line.material, self.material.name)

    def test_glass_dimensions_apply_frame_deduction(self):
        """Glass row dimensions should be reduced by the 40mm frame deduction."""
        glass_line = self._lines(category='glass')
        self.assertEqual(glass_line.dim1_mm, 1160)
        self.assertEqual(glass_line.dim2_mm, 960)
        self.assertEqual(glass_line.quantity, 2)
        self.assertEqual(glass_line.material, self.glass.name)

    def test_lines_carry_project_context(self):
        """Lines should expose project-level fields for filtering/grouping."""
        frame_line = self._lines(category='frame')
        self.assertEqual(frame_line.project_id, self.project)
        self.assertEqual(frame_line.partner_id, self.partner)
        self.assertEqual(frame_line.ref, self.project.ref)

    def test_deleting_window_removes_lines(self):
        """Cut-list lines are a live view — they disappear when the window is deleted."""
        self.window.unlink()
        self.assertFalse(self._lines())
