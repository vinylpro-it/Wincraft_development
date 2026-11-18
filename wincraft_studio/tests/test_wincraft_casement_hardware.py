# -*- coding: utf-8 -*-
from odoo.tests.common import TransactionCase


class TestWincraftCasementHardware(TransactionCase):

    def test_create_and_defaults(self):
        hw = self.env['wincraft.casement.hardware'].create({'code': 'H-1', 'name': 'Bi-Fold D-Handle', 'price': 12.5})
        self.assertEqual(hw.price, 12.5)
        self.assertTrue(hw.active)
