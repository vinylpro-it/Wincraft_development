# -*- coding: utf-8 -*-
"""Tests for wincraft.color's native-import support (`load()` override).

Same driving style as test_wincraft_addon_native_import.py — calls
`Model.load(fields, data)` directly, matching what Odoo's stock "Import
records" screen actually invokes, rather than a bespoke upload wizard.

Updated 2026-09-23 for the vendor-model → free-text `vendor` Char
collapse (see wincraft_color.py's docstring) — `default_vendor_id` (an
FK id) is now `default_vendor` (a plain string), and matching for
reimport/dedup is scoped by (vendor, name) instead of just name within an
implicit per-vendor context.
"""
from odoo.tests.common import TransactionCase


class TestWincraftColorNativeImport(TransactionCase):

    def _model(self, vendor):
        # Mirrors a caller wanting a default vendor value for rows whose CSV
        # has no "vendor" column of its own (no menu currently sets this
        # context — kept as a fallback for a future convenience action).
        return self.env['wincraft.color'].with_context(default_vendor=vendor)

    def test_blank_filler_row_skipped(self):
        fields = ['code', 'name']
        data = [
            ['1', 'BLACK 525'],
            ['2', ''],  # blank template row, padded to a fixed row count
            ['3', 'SANDSTONE 540'],
        ]
        model = self._model('Gentek')
        before = model.search_count([('vendor', '=', 'Gentek')])
        model.load(fields, data)
        after = model.search_count([('vendor', '=', 'Gentek')])
        self.assertEqual(after - before, 2, 'blank filler row must not create a junk record')

    def test_create_scoped_to_vendor_from_context(self):
        fields = ['code', 'name']
        data = [['1', 'BLACK 525']]
        self._model('Gentek').load(fields, data)
        rec = self.env['wincraft.color'].search([('name', '=', 'BLACK 525'), ('vendor', '=', 'Gentek')])
        self.assertEqual(len(rec), 1)
        self.assertEqual(rec.vendor, 'Gentek')
        self.assertEqual(rec.code, '1')

    def test_vendor_column_in_csv_wins_over_context_default(self):
        fields = ['vendor', 'code', 'name']
        data = [['Kaycan', '1', 'K-IVORY 08']]
        self._model('Gentek').load(fields, data)
        rec = self.env['wincraft.color'].search([('name', '=', 'K-IVORY 08')])
        self.assertEqual(len(rec), 1)
        self.assertEqual(rec.vendor, 'Kaycan')

    def test_reimport_updates_existing_row_by_vendor_and_name_instead_of_duplicating(self):
        fields = ['code', 'name']
        self._model('Gentek').load(fields, [['1', 'BLACK 525']])
        # Vendor reissues the price list with a renumbered sequence.
        self._model('Gentek').load(fields, [['5', 'BLACK 525']])
        recs = self.env['wincraft.color'].search([
            ('vendor', '=', 'Gentek'), ('name', '=', 'BLACK 525'),
        ])
        self.assertEqual(len(recs), 1, 'reimport by (vendor, name) must update, not duplicate')
        self.assertEqual(recs.code, '5')

    def test_same_name_different_vendor_creates_separate_records(self):
        fields = ['code', 'name']
        self._model('Gentek').load(fields, [['1', 'IVORY']])
        self._model('Kaycan').load(fields, [['1', 'IVORY']])
        recs = self.env['wincraft.color'].search([('name', '=', 'IVORY')])
        self.assertEqual(len(recs), 2)
        self.assertEqual(set(recs.mapped('vendor')), {'Gentek', 'Kaycan'})

    def test_no_vendor_anywhere_reports_error_not_crash(self):
        """No 'vendor' CSV column and no default_vendor context — must not
        crash on the missing vendor; the row still fails at create() since
        vendor is required, and that failure is reported per-row (not a
        fatal exception), same as any other required-field-missing import
        row."""
        fields = ['code', 'name']
        data = [['1', 'NO VENDOR ANYWHERE']]
        result = self.env['wincraft.color'].load(fields, data)
        self.assertTrue(any(m.get('type') == 'error' for m in result['messages']))
        self.assertFalse(self.env['wincraft.color'].search([('name', '=', 'NO VENDOR ANYWHERE')]))
