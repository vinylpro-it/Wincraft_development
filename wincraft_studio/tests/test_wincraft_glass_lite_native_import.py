# -*- coding: utf-8 -*-
"""Tests for wincraft.glass.lite's native-import support (`load()` override).

Replaces test_glass_lite_import_wizard.py (removed 2026-07-24, see
docs/DECISIONS.md) — same scenarios, driven through `Model.load(fields,
data)` directly instead of a bespoke upload wizard.
"""
from odoo.tests.common import TransactionCase


class TestWincraftGlassLiteNativeImport(TransactionCase):

    def test_boolean_converted_thickness_clamped_blank_row_skipped(self):
        fields = ['part_name', 'name', 'is_discount_eligible', 'is_available_outside', 'thickness']
        data = [
            ['CLEAR', 'CLEAR', 'N', 'Y', '3'],
            ['', '', 'N', 'Y', '3'],  # fully blank template row
            ['LOWE180', 'LOWE 180ESC', 'Y', 'Y', '99'],  # unrecognised MIL value
        ]
        before = self.env['wincraft.glass.lite'].search_count([])
        self.env['wincraft.glass.lite'].load(fields, data)
        after = self.env['wincraft.glass.lite'].search_count([])

        self.assertEqual(after - before, 2, 'blank filler row must not create a junk record')
        rec = self.env['wincraft.glass.lite'].search([('part_name', '=', 'LOWE180')])
        self.assertEqual(len(rec), 1)
        self.assertTrue(rec.is_discount_eligible)
        self.assertTrue(rec.is_available_outside)
        self.assertEqual(rec.thickness, '4', 'unrecognised MIL value should default rather than fail the row')

    def test_blank_integer_and_float_cells_do_not_error(self):
        fields = ['part_name', 'name', 'sequence', 'sf_price_3mm']
        data = [['CLEAR', 'CLEAR', '', '']]
        result = self.env['wincraft.glass.lite'].load(fields, data)
        self.assertFalse(result['messages'], result['messages'])
        rec = self.env['wincraft.glass.lite'].search([('part_name', '=', 'CLEAR')])
        self.assertEqual(rec.sequence, 0)
        self.assertEqual(rec.sf_price_3mm, 0.0)

    def test_bad_numeric_value_reported_not_fatal_to_batch(self):
        fields = ['part_name', 'name', 'sf_price_3mm']
        data = [
            ['GOODROW', 'GOOD ROW', '1.00'],
            ['BADROW', 'BAD ROW', 'not-a-number'],
        ]
        result = self.env['wincraft.glass.lite'].load(fields, data)
        self.assertTrue(self.env['wincraft.glass.lite'].search([('part_name', '=', 'GOODROW')]))
        self.assertFalse(self.env['wincraft.glass.lite'].search([('part_name', '=', 'BADROW')]))
        self.assertTrue(any(m.get('type') == 'error' for m in result['messages']))

    def test_reimport_updates_in_place_by_optiway_code(self):
        Lite = self.env['wincraft.glass.lite']
        fields = ['external_code', 'name', 'thickness', 'sf_price_3mm', 'sf_price_4mm', 'is_available_inside']
        Lite.load(fields, [['ZZ1', 'ZZ TEST GLASS', '3', '1.00', '2.00', 'Y']])
        Lite.load(fields, [['ZZ1', 'ZZ TEST GLASS', '3', '1.50', '2.00', 'N']])
        recs = Lite.search([('external_code', '=', 'ZZ1')])
        self.assertEqual(len(recs), 1, 're-upload must update, not duplicate')
        self.assertEqual(recs.sf_price_3mm, 1.5)
        self.assertFalse(recs.is_available_inside)

    def test_import_creates_and_reprices_inventory_product(self):
        Lite = self.env['wincraft.glass.lite']
        fields = ['external_code', 'name', 'thickness', 'sf_price_3mm', 'sf_price_4mm']
        Lite.load(fields, [['ZZ2', 'ZZ PRODUCT GLASS', '4', '1.00', '2.00']])
        rec = Lite.search([('external_code', '=', 'ZZ2')])
        self.assertTrue(rec.product_id, 'import must link an inventory product')
        self.assertEqual(rec.product_id.default_code, 'ZZ2')
        self.assertEqual(rec.product_id.lst_price, 2.0, 'priced at the row\'s own thickness')
        Lite.load(fields, [['ZZ2', 'ZZ PRODUCT GLASS', '4', '1.00', '2.50']])
        self.assertEqual(rec.product_id.lst_price, 2.5)
        self.assertEqual(
            self.env['product.template'].search_count([('default_code', '=', 'ZZ2')]), 1)
