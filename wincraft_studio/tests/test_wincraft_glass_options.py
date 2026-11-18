# -*- coding: utf-8 -*-
"""Glass Options (wincraft.glass.lite) as the single glass source.

Replaces test_glazing_bom.py (glazing configurations were retired 2026-10-09,
see docs/DECISIONS.md): window BOM glass lines and glass pricing now come from
the Glass Options chosen in the Window Configuration popup.
"""
from odoo.tests.common import TransactionCase

SQFT_PER_M2 = 10.7639


class TestWincraftGlassOptions(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.partner = cls.env['res.partner'].create({'name': 'Glass Opt Client'})
        cls.material = cls.env['wincraft.material'].create({'name': 'GO Material', 'rate_per_sqm': 100})
        cls.glass_type = cls.env['wincraft.glass.type'].create({'name': 'GO Type', 'rate_per_sqm': 200})
        cls.project = cls.env['wincraft.project'].create({'name': 'GO Project', 'partner_id': cls.partner.id})
        Lite = cls.env['wincraft.glass.lite']
        Lite.load(
            ['external_code', 'name', 'thickness', 'sf_price_3mm', 'sf_price_4mm',
             'is_available_outside', 'is_available_middle', 'is_available_inside'],
            [
                ['GO1', 'GO CLEAR', '3', '1.00', '2.00', 'Y', 'Y', 'Y'],
                ['GO2', 'GO INSIDE ONLY', '4', '3.00', '4.00', 'N', 'N', 'Y'],
            ],
        )
        cls.clear = Lite.search([('external_code', '=', 'GO1')])
        cls.inside_only = Lite.search([('external_code', '=', 'GO2')])

    def _window(self, **kwargs):
        vals = {
            'project_id': self.project.id,
            'window_type': 'fixed',
            'width_mm': 1000,
            'height_mm': 1000,
            'frame_material_id': self.material.id,
            'glass_type_id': self.glass_type.id,
        }
        vals.update(kwargs)
        return self.env['wincraft.window'].create(vals)

    def test_glass_cost_falls_back_to_glass_type(self):
        win = self._window()
        self.assertAlmostEqual(win._glass_cost(), 200 * win.area_sqm, places=3)

    def test_glass_cost_popup_options_over_whole_area(self):
        win = self._window(glass_out_lite_id=self.clear.id, glass_in_lite_id=self.inside_only.id)
        # clear: 3mm row -> 1.00/sqft ; inside-only: 4mm row -> 4.00/sqft ; 1 m2 window
        self.assertAlmostEqual(win._glass_cost(), (1.0 + 4.0) * SQFT_PER_M2 * win.area_sqm, places=3)

    def test_glass_cost_per_pane_beats_popup_and_glass_type(self):
        tree = {
            'type': 'leaf',
            'id': 'p1',
            'config': {
                'glazingType': 'double',
                'glass1Key': 'GO1', 'glass1Attrs': {'_ot': '4'},   # 2.00/sqft
                'glass2Key': 'GO2', 'glass2Attrs': {'_ot': '3'},   # 3.00/sqft
            },
        }
        win = self._window(panel_tree=tree, glass_out_lite_id=self.inside_only.id)
        self.assertAlmostEqual(win._glass_cost(), (2.0 + 3.0) * SQFT_PER_M2 * win.area_sqm, places=3)

    def test_glass_cost_single_glazing_uses_outer_only(self):
        tree = {
            'type': 'leaf', 'id': 'p1',
            'config': {'glazingType': 'single', 'glass1Key': 'GO1', 'glass2Key': 'GO2'},
        }
        win = self._window(panel_tree=tree)
        self.assertAlmostEqual(win._glass_cost(), 1.0 * SQFT_PER_M2 * win.area_sqm, places=3)

    def test_bom_glass_lines_prefer_pane_picks_over_popup(self):
        tree = {'type': 'leaf', 'id': 'p1',
                'config': {'glazingType': 'single', 'glass1Key': 'GO1'}}
        win = self._window(panel_tree=tree, glass_in_lite_id=self.inside_only.id)
        glass_lines = [c for c in win._get_bom_components() if c['category'] == 'glass']
        self.assertEqual([c['name'] for c in glass_lines], ['GO CLEAR'])

    def test_bom_glass_lines_use_chosen_options_with_products(self):
        win = self._window(glass_out_lite_id=self.clear.id, glass_in_lite_id=self.inside_only.id)
        glass_lines = [c for c in win._get_bom_components() if c['category'] == 'glass']
        self.assertEqual({c['name'] for c in glass_lines}, {'GO CLEAR', 'GO INSIDE ONLY'})
        self.assertTrue(all(c.get('product_id') for c in glass_lines))

    def test_bom_glass_line_falls_back_to_glass_type(self):
        glass_lines = [c for c in self._window()._get_bom_components() if c['category'] == 'glass']
        self.assertEqual([c['name'] for c in glass_lines], ['GO Type'])

    def test_product_options_expose_availability_and_prices(self):
        from odoo.addons.wincraft_studio.controllers.product_options import WincraftProductOptionsController
        options = {o['glass_key']: o for o in WincraftProductOptionsController._load_glass_options(self.env)}
        self.assertEqual(options['GO2']['available'], {'outside': False, 'middle': False, 'inside': True})
        self.assertEqual(options['GO2']['sf_prices']['4'], 4.0)
        self.assertEqual(options['GO2']['default_ot'], '4')
