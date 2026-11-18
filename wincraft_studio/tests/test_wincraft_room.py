# -*- coding: utf-8 -*-
"""Tests for wincraft.room and the window "Others" fields."""
from odoo.tests.common import TransactionCase


class TestWincraftRoom(TransactionCase):

    def test_room_defaults(self):
        room = self.env['wincraft.room'].create({'name': 'Kitchen'})
        self.assertEqual(room.sequence, 10)
        self.assertTrue(room.active)

    def test_handle_cover_colour_reference_numbers(self):
        sel = dict(self.env['wincraft.window']._fields['handle_cover_colour'].selection)
        self.assertEqual(sel, {'1': 'White', '2': 'Black', '3': 'Brown'})
