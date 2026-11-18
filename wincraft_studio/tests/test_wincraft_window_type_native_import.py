# -*- coding: utf-8 -*-
"""Tests for wincraft.window.type's native-import support (`load()` override).

Replaces test_window_type_import_wizard.py (removed 2026-07-24, see
docs/DECISIONS.md) — same scenarios, driven through `Model.load(fields,
data)` directly instead of a bespoke upload wizard.
"""
from odoo.tests.common import TransactionCase


class TestWincraftWindowTypeNativeImport(TransactionCase):

    def test_boolean_converted_inch_to_mm_and_blank_row_skipped(self):
        fields = ['key', 'name', 'max_width_mm', 'min_width_mm', 'max_height_mm', 'min_height_mm', 'is_fh']
        data = [
            ['C-L', 'CONT. 3-1/4 CASMENT LEFT', '38.0000', '15.5000', '72.0000', '18.0000', 'Y'],
            ['L-FSH', '', '0.0000', '0.0000', '0.0000', '0.0000', 'N'],  # blank Description: filler row
        ]
        before = self.env['wincraft.window.type'].search_count([])
        self.env['wincraft.window.type'].load(fields, data)
        after = self.env['wincraft.window.type'].search_count([])

        self.assertEqual(after - before, 1, 'blank-description filler row must not create a junk record')
        rec = self.env['wincraft.window.type'].search([('key', '=', 'C-L')])
        self.assertEqual(len(rec), 1)
        self.assertEqual(rec.max_width_mm, round(38.0 * 25.4))
        self.assertEqual(rec.min_width_mm, round(15.5 * 25.4))
        self.assertEqual(rec.max_height_mm, round(72.0 * 25.4))
        self.assertEqual(rec.min_height_mm, round(18.0 * 25.4))
        self.assertTrue(rec.is_fh)

    def test_duplicate_key_rejected_per_row_not_fatal_to_batch(self):
        self.env['wincraft.window.type'].create({'name': 'Existing', 'key': 'DUPTYPE'})
        fields = ['key', 'name']
        data = [
            ['DUPTYPE', 'SHOULD BE SKIPPED'],
            ['NEWTYPE', 'SHOULD BE CREATED'],
        ]
        result = self.env['wincraft.window.type'].load(fields, data)
        self.assertTrue(self.env['wincraft.window.type'].search([('key', '=', 'NEWTYPE')]))
        self.assertEqual(self.env['wincraft.window.type'].search_count([('key', '=', 'DUPTYPE')]), 1)
        self.assertTrue(any(m.get('type') == 'error' for m in result['messages']))

    def test_blank_integer_cell_does_not_error(self):
        fields = ['key', 'name', 'style_code']
        data = [['STYLELESS', 'NO STYLE CODE', '']]
        result = self.env['wincraft.window.type'].load(fields, data)
        self.assertFalse(result['messages'], result['messages'])
        rec = self.env['wincraft.window.type'].search([('key', '=', 'STYLELESS')])
        self.assertEqual(rec.style_code, 0)

    def test_bad_numeric_value_reported_not_fatal_to_batch(self):
        fields = ['key', 'name', 'max_width_mm']
        data = [
            ['GOODROW', 'GOOD ROW', '38.0000'],
            ['BADROW', 'BAD ROW', 'not-a-number'],
        ]
        result = self.env['wincraft.window.type'].load(fields, data)
        self.assertTrue(self.env['wincraft.window.type'].search([('key', '=', 'GOODROW')]))
        self.assertFalse(self.env['wincraft.window.type'].search([('key', '=', 'BADROW')]))
        self.assertTrue(any(m.get('type') == 'error' for m in result['messages']))
