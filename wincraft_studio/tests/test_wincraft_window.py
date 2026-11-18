# -*- coding: utf-8 -*-
"""Tests for wincraft.window model — pricing, constraints, computed fields."""
import math

from odoo.tests.common import TransactionCase
from odoo.exceptions import ValidationError


class TestWincraftWindow(TransactionCase):
    """Unit tests for the WinCraft Window model."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.partner = cls.env['res.partner'].create({
            'name': 'Window Test Client',
            'email': 'win@example.com',
        })
        cls.material = cls.env['wincraft.material'].create({
            'name': 'Test Aluminium',
            'rate_per_sqm': 600,
        })
        cls.glass = cls.env['wincraft.glass.type'].create({
            'name': 'Test Single 6mm',
            'rate_per_sqm': 200,
        })
        cls.project = cls.env['wincraft.project'].create({
            'name': 'Window Test Project',
            'partner_id': cls.partner.id,
        })

    def _create_window(self, **kwargs):
        vals = {
            'project_id': self.project.id,
            'window_type': 'fixed',
            'width_mm': 1000,
            'height_mm': 1000,
            'frame_material_id': self.material.id,
            'glass_type_id': self.glass.id,
        }
        vals.update(kwargs)
        return self.env['wincraft.window'].create(vals)

    def test_area_sqm_computation(self):
        """area_sqm should be width × height in square metres."""
        win = self._create_window(width_mm=2000, height_mm=1500)
        self.assertAlmostEqual(win.area_sqm, 3.0, places=4)

    def test_area_sqm_circle_shape(self):
        """A circular frame's area must follow the inscribed circle, not its bounding box."""
        win = self._create_window(width_mm=1200, height_mm=1000, frame_shape='circle')
        radius_m = min(1.2, 1.0) / 2.0
        self.assertAlmostEqual(win.area_sqm, math.pi * radius_m ** 2, places=4)
        self.assertNotAlmostEqual(win.area_sqm, 1.2, places=2)

    def test_shape_perimeter_circle(self):
        """Frame profile cut length for a circle must be its circumference."""
        win = self._create_window(width_mm=1000, height_mm=1000, frame_shape='circle')
        _area_m2, perimeter_m = win._get_shape_area_perimeter_m()
        self.assertAlmostEqual(perimeter_m, math.pi * 1.0, places=3)
        self.assertNotAlmostEqual(perimeter_m, 4.0, places=2)

    def test_shape_geometry_rectangular_matches_bounding_box(self):
        """Default/rectangular frame shape must reduce to plain width × height math."""
        win = self._create_window(width_mm=2000, height_mm=1500)
        area_m2, perimeter_m = win._get_shape_area_perimeter_m()
        self.assertAlmostEqual(area_m2, 3.0, places=4)
        self.assertAlmostEqual(perimeter_m, 7.0, places=4)

    def test_panels_computed_from_h_v(self):
        """panels should equal panels_horizontal × panels_vertical."""
        win = self._create_window(panels_horizontal=3, panels_vertical=2)
        self.assertEqual(win.panels, 6)

    def test_name_includes_type_and_dims(self):
        """Window name should mention the type and dimensions."""
        win = self._create_window(window_type='casement', width_mm=1200, height_mm=800)
        self.assertIn('1200', win.name)
        self.assertIn('800', win.name)

    def test_min_dimension_constraint(self):
        """Creating a window under 200mm should raise ValidationError."""
        with self.assertRaises(ValidationError):
            self._create_window(width_mm=100, height_mm=1000)
        with self.assertRaises(ValidationError):
            self._create_window(width_mm=1000, height_mm=100)

    def test_max_dimension_constraint(self):
        """Creating a window over 8000mm wide or 5000mm tall should fail."""
        with self.assertRaises(ValidationError):
            self._create_window(width_mm=9000, height_mm=1000)
        with self.assertRaises(ValidationError):
            self._create_window(width_mm=1000, height_mm=6000)

    def test_unit_price_positive(self):
        """Window price should be positive when material and glass are set."""
        win = self._create_window()
        self.assertGreater(win.unit_price, 0)

    def test_margin_affects_price(self):
        """Higher margin should produce a higher unit price."""
        win_low = self._create_window(margin_pct=10)
        win_high = self._create_window(margin_pct=40)
        self.assertGreater(win_high.unit_price, win_low.unit_price)

    def test_thumbnail_svg_generated(self):
        """Window should have a non-empty SVG thumbnail."""
        win = self._create_window()
        self.assertTrue(win.thumbnail_svg)
        self.assertIn('<svg', win.thumbnail_svg)

    # ------------------------------------------------------------------
    # Quote PDF helpers (EvA-style premium catalogue redesign)
    # ------------------------------------------------------------------

    def test_pane_layout_legacy_grid(self):
        """A 2x1 legacy grid window should yield 2 panes, left then right."""
        win = self._create_window(width_mm=2000, height_mm=1000, panels_horizontal=2, panels_vertical=1)
        layout = win._get_quote_pane_layout()
        self.assertEqual(len(layout), 2)
        self.assertLess(layout[0]['x'], layout[1]['x'], "panes should be ordered left to right")

    def test_pane_opening_types_casement(self):
        """A 2-pane casement window should infer hinge-left / hinge-right by position."""
        win = self._create_window(window_type='casement', width_mm=2000, height_mm=1000,
                                   panels_horizontal=2, panels_vertical=1)
        types = win._get_pane_opening_types()
        self.assertEqual(types, ['casement-l', 'casement-r'])

    def test_pane_opening_types_sliding(self):
        """A 2-pane sliding window should infer fixed-left / sliding-right by position."""
        win = self._create_window(window_type='sliding', width_mm=2000, height_mm=1000,
                                   panels_horizontal=2, panels_vertical=1)
        types = win._get_pane_opening_types()
        self.assertEqual(types, ['fixed', 'sliding'])

    def test_configuration_code_sliding(self):
        """Sliding window configuration code should be an X/O string matching pane count."""
        win = self._create_window(window_type='sliding', width_mm=2000, height_mm=1000,
                                   panels_horizontal=2, panels_vertical=1)
        self.assertEqual(win._get_quote_configuration_code(), 'OX')

    def test_configuration_code_casement(self):
        """Non-sliding window configuration code should fall back to a short type label."""
        win = self._create_window(window_type='casement')
        self.assertEqual(win._get_quote_configuration_code(), 'Casement')

    def test_quote_product_name(self):
        """Product name should be a catalogue-style label, not the raw selection key."""
        win = self._create_window(window_type='sliding')
        self.assertEqual(win._get_quote_product_name(), 'Sliding Window')

    def test_quote_spec_lines_include_configuration_and_mesh(self):
        """Spec block must always surface Configuration and Mosquito Mesh."""
        win = self._create_window(window_type='casement')
        labels = [label for label, _value in win._get_quote_spec_lines()]
        self.assertIn('Configuration', labels)
        self.assertIn('Mosquito Mesh', labels)

    def test_quote_elevation_and_iso_svg_generated(self):
        """Elevation and 3D-illustration generators must return non-empty SVG markup."""
        win = self._create_window(window_type='sliding', panels_horizontal=2)
        elevation = win._get_quote_elevation_svg()
        iso = win._get_quote_iso_svg()
        self.assertIn('<svg', elevation)
        self.assertIn('<svg', iso)

    def test_quote_elevation_svg_circle_shape(self):
        """Elevation generator must not crash on a non-rectangular frame shape."""
        win = self._create_window(width_mm=1200, height_mm=1000, frame_shape='circle')
        self.assertIn('<svg', win._get_quote_elevation_svg())
        self.assertIn('<svg', win._get_quote_iso_svg())
