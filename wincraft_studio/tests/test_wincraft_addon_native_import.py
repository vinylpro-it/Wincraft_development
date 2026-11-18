# -*- coding: utf-8 -*-
"""Tests for wincraft.addon's native-import support (`load()` override).

Replaces test_options_import_wizard.py / test_grill_import_wizard.py
(removed 2026-07-24, see docs/DECISIONS.md) — same scenarios, but driven
through `Model.load(fields, data)` directly (what Odoo's stock "Import
records" screen actually calls) instead of a bespoke upload wizard.
"""
from odoo.tests.common import TransactionCase


class TestWincraftAddonNativeImport(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.options_category = cls.env['wincraft.addon.category'].search(
            [('code', '=', 'option')], limit=1)
        if not cls.options_category:
            cls.options_category = cls.env['wincraft.addon.category'].create({
                'name': 'Options', 'code': 'option', 'scope': 'window',
            })
        cls.grill_category = cls.env['wincraft.addon.category'].search(
            [('code', '=', 'grill')], limit=1)
        if not cls.grill_category:
            cls.grill_category = cls.env['wincraft.addon.category'].create({
                'name': 'Grill / Grille', 'code': 'grill', 'scope': 'pane',
            })

    def _model(self, category):
        # Mirrors wincraft_addon_action_option/_grill's
        # context="{'default_category_id': ...}" — this is what the native
        # "Import records" screen forwards automatically when launched from
        # one of those filtered list views, no extra code needed for it.
        return self.env['wincraft.addon'].with_context(default_category_id=category.id)

    def test_boolean_yn_converted_and_blank_filler_row_skipped(self):
        fields = ['sequence', 'addon_code', 'group_code', 'name', 'is_discount_eligible', 'is_painted_inside', 'white_price']
        data = [
            ['1', 'BM', 'B', '1-1/4 BRICKMOULD', 'Y', 'N', '2.88'],
            ['2', '', '', '', 'N', 'N', '0.00'],  # fully blank template row from the source spreadsheet
            ['3', 'BRM', 'B', '2" BRICKMOULD', 'Y', 'N', '4.33'],
        ]
        model = self._model(self.options_category)
        before = model.search_count([('category_id', '=', self.options_category.id)])
        model.load(fields, data)
        after = model.search_count([('category_id', '=', self.options_category.id)])

        self.assertEqual(after - before, 2, 'blank filler row must not create a junk record')
        bm = model.search([('addon_code', '=', 'BM')])
        self.assertEqual(len(bm), 1)
        self.assertTrue(bm.is_discount_eligible)
        self.assertFalse(bm.is_painted_inside)
        self.assertEqual(bm.category_id, self.options_category)

    def test_blank_name_falls_back_to_addon_code(self):
        """Options-shaped row: real pricing/short code but blank Description."""
        fields = ['addon_code', 'group_code', 'name', 'white_price']
        data = [['PENCIL', 'J', '', '11.20']]
        self._model(self.options_category).load(fields, data)
        rec = self.env['wincraft.addon'].search([('addon_code', '=', 'PENCIL')])
        self.assertEqual(len(rec), 1)
        self.assertEqual(rec.name, 'PENCIL')

    def test_blank_name_falls_back_to_group_code_and_color(self):
        """Grill-shaped row: no addon_code column at all, falls back to Type+Color."""
        fields = ['group_code', 'color', 'name', 'price']
        data = [['PENCIL', 'IN&OT', '', '11.20']]
        self._model(self.grill_category).load(fields, data)
        rec = self.env['wincraft.addon'].search([('group_code', '=', 'PENCIL'), ('color', '=', 'IN&OT')])
        self.assertEqual(len(rec), 1)
        self.assertEqual(rec.name, 'PENCIL IN&OT')

    def test_price_defaults_from_white_price_when_price_not_mapped(self):
        fields = ['addon_code', 'name', 'white_price']
        data = [['BRM', '2" BRICKMOULD', '4.33']]
        self._model(self.options_category).load(fields, data)
        rec = self.env['wincraft.addon'].search([('addon_code', '=', 'BRM')])
        self.assertEqual(rec.white_price, 4.33)
        self.assertEqual(rec.price, 4.33, 'price (read by BOM/quote totals) must not silently stay 0')

    def test_pricing_unit_letters_mapped_to_selection_keys(self):
        fields = ['addon_code', 'name', 'white_price', 'pricing_unit']
        data = [['SHP', 'SHAPE UPCHARGE', '280.00', 'L']]
        self._model(self.options_category).load(fields, data)
        rec = self.env['wincraft.addon'].search([('addon_code', '=', 'SHP')])
        self.assertEqual(rec.pricing_unit, 'lin')

    def test_pricing_basis_letters_mapped_to_selection_keys(self):
        fields = ['group_code', 'color', 'name', 'price', 'pricing_basis']
        data = [['COLONL', 'BRASS', '5/8" COLONIAL BRASS', '6.30', 'F']]
        self._model(self.grill_category).load(fields, data)
        rec = self.env['wincraft.addon'].search([('group_code', '=', 'COLONL'), ('color', '=', 'BRASS')])
        self.assertEqual(rec.pricing_basis, 'flat')

    def test_blank_integer_and_float_cells_do_not_error(self):
        """Real data quirk in MIRND006: most rows leave URBAN CODE (Integer)
        blank — Odoo's own int('')/float('') raises "does not seem to be an
        integer" for every such row unless blank is normalized to '0' first."""
        fields = ['addon_code', 'name', 'white_price', 'urban_code', 'bins', 'pricing_width']
        data = [['WDR', '3/4 WOOD RETURN', '2.16', '', '', '']]
        result = self._model(self.options_category).load(fields, data)
        self.assertFalse(result['messages'], result['messages'])
        rec = self.env['wincraft.addon'].search([('addon_code', '=', 'WDR')])
        self.assertEqual(len(rec), 1)
        self.assertEqual(rec.urban_code, 0)
        self.assertEqual(rec.bins, 0)
        self.assertEqual(rec.pricing_width, 0.0)

    def test_bad_numeric_value_reported_not_fatal_to_batch(self):
        fields = ['addon_code', 'name', 'white_price']
        data = [
            ['GOOD', 'GOOD ROW', '5.00'],
            ['BAD', 'BAD ROW', 'not-a-number'],
        ]
        result = self._model(self.options_category).load(fields, data)
        self.assertTrue(self.env['wincraft.addon'].search([('addon_code', '=', 'GOOD')]))
        self.assertFalse(self.env['wincraft.addon'].search([('addon_code', '=', 'BAD')]))
        self.assertTrue(any(m.get('type') == 'error' for m in result['messages']))


class TestWincraftTrimPricing(TransactionCase):
    """Options TYPE B/C/J/X are priced per foot from window size + colour."""

    def _addon(self, **vals):
        base = {'name': 'BM', 'group_code': 'B', 'price': 2.88, 'white_price': 2.88,
                'colour_price': 4.35, 'stain_price': 9.80, 'pricing_unit': 'lin',
                'pricing_width': 2.375, 'width_qty': 2, 'pricing_height': 2.375, 'height_qty': 2}
        base.update(vals)
        return self.env['wincraft.addon'].create(base)

    def _window(self, **vals):
        w = self.env['wincraft.window'].new({'width_mm': 914.4, 'height_mm': 1219.2})  # 36" x 48"
        for k, v in vals.items():
            w[k] = v
        return w

    def test_linear_trim_uses_white_rate_without_colour(self):
        # 2*(36+2.375) + 2*(48+2.375) = 177.5 in = 14.7917 ft
        price = self._addon()._price_for_window(self._window())
        self.assertAlmostEqual(price, 177.5 / 12 * 2.88, places=4)

    def test_colour_and_stain_rates(self):
        colour = self.env['wincraft.color'].create({'vendor': 'Gentek', 'name': 'Brown'})
        stain = self.env['wincraft.color'].create({'vendor': 'Stain', 'name': 'Oak'})
        addon = self._addon()
        self.assertAlmostEqual(addon._price_for_window(self._window(brickmould_colour_id=colour)), 177.5 / 12 * 4.35, places=4)
        self.assertAlmostEqual(addon._price_for_window(self._window(brickmould_colour_id=stain)), 177.5 / 12 * 9.80, places=4)

    def test_fixed_and_non_trim_stay_flat(self):
        self.assertEqual(self._addon(pricing_unit='fix')._price_for_window(self._window()), 2.88)
        self.assertEqual(self._addon(group_code='E')._price_for_window(self._window()), 2.88)
