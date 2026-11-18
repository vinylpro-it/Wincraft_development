# -*- coding: utf-8 -*-
"""Tests for wincraft.brickmould — minimal admin-manageable catalog (WS-17)."""
from odoo.tests.common import TransactionCase


class TestWincraftBrickmould(TransactionCase):
    """Basic CRUD coverage — this model carries no pricing/BOM logic."""

    def test_create_and_defaults(self):
        brickmould = self.env['wincraft.brickmould'].create({
            'name': '1-1/4" Brickmould',
        })
        self.assertEqual(brickmould.sequence, 10)
        self.assertTrue(brickmould.active)
        self.assertFalse(brickmould.code)

    def test_write_and_archive(self):
        brickmould = self.env['wincraft.brickmould'].create({
            'name': '2" Brickmould',
            'code': 'BM-2',
        })
        brickmould.write({'active': False})
        self.assertFalse(brickmould.active)
        active_brickmoulds = self.env['wincraft.brickmould'].search([])
        self.assertNotIn(brickmould, active_brickmoulds)

    def test_window_links_to_brickmould_and_colour_fields(self):
        """WS-17: wincraft.window's new fields resolve to the right models."""
        brickmould = self.env['wincraft.brickmould'].create({'name': 'Nailfin'})
        colour = self.env['wincraft.color'].create({'vendor': 'Gentek', 'name': 'Almond'})
        partner = self.env['res.partner'].create({'name': 'WS-17 Test Client'})
        project = self.env['wincraft.project'].create({
            'name': 'WS-17 Test Project',
            'partner_id': partner.id,
        })
        material = self.env['wincraft.material'].create({'name': 'Test UPVC', 'rate_per_sqm': 500})
        glass = self.env['wincraft.glass.type'].create({'name': 'Test Glass', 'rate_per_sqm': 300})
        window = self.env['wincraft.window'].create({
            'project_id': project.id,
            'window_type': 'casement',
            'width_mm': 1000,
            'height_mm': 1000,
            'frame_material_id': material.id,
            'glass_type_id': glass.id,
            'view_from': 'Interior',
            'rubber_colour_id': colour.id,
            'brickmould_type_id': brickmould.id,
            'brickmould_colour_id': colour.id,
            'casing_colour_id': colour.id,
        })
        self.assertEqual(window.view_from, 'Interior')
        self.assertEqual(window.rubber_colour_id, colour)
        self.assertEqual(window.brickmould_type_id, brickmould)
        self.assertEqual(window.brickmould_colour_id, colour)
        self.assertEqual(window.casing_colour_id, colour)
