# -*- coding: utf-8 -*-
"""Tests for hardware/addon -> real BOM line generation.

wincraft.hardware and wincraft.addon are priced on the quote regardless, but
previously produced no mrp.bom.line at all ("no product link yet") even when
selected — production never knew to pull stock for them. These tests cover
the new product_tmpl_id link and the BOM-line-generation methods directly,
without needing the full action_generate_bom() frame-resolution pipeline.
"""
from odoo.tests.common import TransactionCase


class TestHardwareAddonBomLines(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.partner = cls.env['res.partner'].create({'name': 'HW BOM Client'})
        cls.material = cls.env['wincraft.material'].create({'name': 'HW BOM Material', 'rate_per_sqm': 0})
        cls.glass = cls.env['wincraft.glass.type'].create({'name': 'HW BOM Glass', 'rate_per_sqm': 0})
        cls.project = cls.env['wincraft.project'].create({'name': 'HW BOM Project', 'partner_id': cls.partner.id})

        cls.handle_product = cls.env['product.template'].create({
            'name': 'Handle SKU', 'type': 'consu',
        })
        cls.hinge_product = cls.env['product.template'].create({
            'name': 'Hinge SKU', 'type': 'consu',
        })
        cls.addon_product = cls.env['product.template'].create({
            'name': 'Fly Screen SKU', 'type': 'consu',
        })

        cls.handle = cls.env['wincraft.hardware'].create({
            'name': 'Linked Handle', 'category': 'handle', 'unit_price': 100,
            'product_tmpl_id': cls.handle_product.id,
        })
        cls.hinge = cls.env['wincraft.hardware'].create({
            'name': 'Linked Hinge', 'category': 'hinge', 'unit_price': 50,
            'product_tmpl_id': cls.hinge_product.id,
        })
        cls.unlinked_hardware = cls.env['wincraft.hardware'].create({
            'name': 'Unlinked Sill', 'category': 'sill', 'unit_price': 75,
        })

        cls.category = cls.env['wincraft.addon.category'].create({
            'name': 'BOM Test Addon Category', 'code': 'bom_test_addon', 'scope': 'window',
        })
        cls.linked_addon = cls.env['wincraft.addon'].create({
            'name': 'Fly Screen', 'category_id': cls.category.id, 'price': 200,
            'product_tmpl_id': cls.addon_product.id,
        })
        cls.unlinked_addon = cls.env['wincraft.addon'].create({
            'name': 'Unlinked Addon', 'category_id': cls.category.id, 'price': 50,
        })

        # Minimal product + BOM to attach lines to, bypassing the frame_config
        # resolution that action_generate_bom() needs.
        cls.frame_product_tmpl = cls.env['product.template'].create({
            'name': 'Test Frame Product', 'type': 'consu',
        })
        cls.frame_product = cls.frame_product_tmpl.product_variant_ids[:1]
        cls.bom = cls.env['mrp.bom'].create({
            'product_tmpl_id': cls.frame_product_tmpl.id,
            'product_id': cls.frame_product.id,
            'product_qty': 1.0,
            'type': 'normal',
            'is_custom': True,
        })

    def _create_window(self, **kwargs):
        vals = {
            'project_id': self.project.id, 'window_type': 'casement',
            'width_mm': 1000, 'height_mm': 1000,
            'frame_material_id': self.material.id, 'glass_type_id': self.glass.id,
        }
        vals.update(kwargs)
        return self.env['wincraft.window'].create(vals)

    def test_window_level_hardware_creates_bom_line_when_linked(self):
        win = self._create_window(hardware_ids=[(6, 0, [self.handle.id])])
        win._add_window_hardware_lines(self.bom)
        lines = self.bom.bom_line_ids.filtered(lambda l: l.product_id.product_tmpl_id == self.handle_product)
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines.product_qty, 1)
        self.assertEqual(lines.component_type, 'hardware')

    def test_window_level_hardware_skipped_when_not_linked(self):
        win = self._create_window(hardware_ids=[(6, 0, [self.unlinked_hardware.id])])
        before = len(self.bom.bom_line_ids)
        win._add_window_hardware_lines(self.bom)
        self.assertEqual(len(self.bom.bom_line_ids), before)

    def test_pane_hardware_creates_bom_line_with_role_quantity(self):
        win = self._create_window()
        cfg = {
            'openingType': 'casement-l',
            'hardwareSelections': {'handle': self.handle.id, 'hinge': self.hinge.id},
        }
        win._add_hardware_lines(self.bom, cfg, 'P1', 0)
        hinge_lines = self.bom.bom_line_ids.filtered(lambda l: l.product_id.product_tmpl_id == self.hinge_product)
        self.assertEqual(len(hinge_lines), 1)
        # casement -> 3 hinges, per _hardware_qty()
        self.assertEqual(hinge_lines.product_qty, 3)
        handle_lines = self.bom.bom_line_ids.filtered(lambda l: l.product_id.product_tmpl_id == self.handle_product)
        self.assertEqual(handle_lines.product_qty, 1)

    def test_addon_creates_bom_line_when_linked(self):
        win = self._create_window(addon_ids=[(6, 0, [self.linked_addon.id])])
        win._add_addon_lines(self.bom)
        lines = self.bom.bom_line_ids.filtered(lambda l: l.product_id.product_tmpl_id == self.addon_product)
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines.component_type, 'addon')
        self.assertEqual(lines.product_qty, 1)

    def test_addon_skipped_when_not_linked(self):
        win = self._create_window(addon_ids=[(6, 0, [self.unlinked_addon.id])])
        before = len(self.bom.bom_line_ids)
        win._add_addon_lines(self.bom)
        self.assertEqual(len(self.bom.bom_line_ids), before)
