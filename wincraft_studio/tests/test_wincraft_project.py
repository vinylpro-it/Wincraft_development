# -*- coding: utf-8 -*-
"""Tests for wincraft.project model — totals computation, state transitions, revisions."""
from odoo.tests.common import TransactionCase
from odoo.exceptions import UserError


class TestWincraftProject(TransactionCase):
    """Unit tests for the WinCraft Project model."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.partner = cls.env['res.partner'].create({
            'name': 'Test Client',
            'email': 'test@example.com',
        })
        cls.material = cls.env['wincraft.material'].create({
            'name': 'Test UPVC',
            'rate_per_sqm': 500,
        })
        cls.glass = cls.env['wincraft.glass.type'].create({
            'name': 'Test Double 24mm',
            'rate_per_sqm': 300,
        })
        cls.project = cls.env['wincraft.project'].create({
            'name': 'Test Project',
            'partner_id': cls.partner.id,
            'installation_charge': 10000,
            'discount_pct': 10,
        })

    def _create_window(self, **kwargs):
        vals = {
            'project_id': self.project.id,
            'window_type': 'casement',
            'width_mm': 1000,
            'height_mm': 1000,
            'frame_material_id': self.material.id,
            'glass_type_id': self.glass.id,
        }
        vals.update(kwargs)
        return self.env['wincraft.window'].create(vals)

    def test_auto_reference_on_create(self):
        """Project should get an auto-generated reference on creation."""
        self.assertNotEqual(self.project.ref, '/')
        self.assertTrue(self.project.ref)

    def test_total_windows_count(self):
        """total_windows should equal the number of window records."""
        self.assertEqual(self.project.total_windows, 0)
        self._create_window()
        self._create_window(window_type='sliding', width_mm=1800, height_mm=1200)
        self.project.invalidate_recordset()
        self.assertEqual(self.project.total_windows, 2)

    def test_totals_computation(self):
        """Verify subtotal, discount, tax, and total formulas."""
        win = self._create_window()
        self.project.invalidate_recordset()
        window_price = win.unit_price
        subtotal = window_price + 10000  # + installation
        self.assertAlmostEqual(self.project.subtotal_price, subtotal, places=2)
        discount = subtotal * 10 / 100
        self.assertAlmostEqual(self.project.discount_amount, discount, places=2)
        after_discount = subtotal - discount
        # Default GST 5%
        tax = after_discount * 5 / 100
        self.assertAlmostEqual(self.project.tax_amount, tax, places=2)
        self.assertAlmostEqual(self.project.cgst_amount, tax / 2, places=2)
        self.assertAlmostEqual(self.project.sgst_amount, tax / 2, places=2)
        self.assertAlmostEqual(self.project.total_price, after_discount + tax, places=2)

    def test_one_time_addon_billed_once_across_windows(self):
        """A per_window=False add-on selected on multiple windows must be
        billed exactly once at the project level — previously it was excluded
        from unit_price (by design) but never picked up anywhere else either,
        so it was never billed at all."""
        category = self.env['wincraft.addon.category'].create({
            'name': 'Test One-Time Category', 'code': 'test_one_time', 'scope': 'window',
        })
        addon = self.env['wincraft.addon'].create({
            'name': 'Site Survey Fee',
            'category_id': category.id,
            'price': 600,
            'per_window': False,
        })
        win1 = self._create_window(addon_ids=[(6, 0, [addon.id])])
        win2 = self._create_window(addon_ids=[(6, 0, [addon.id])])
        self.project.invalidate_recordset()
        self.assertEqual(self.project.one_time_addon_total, 600)
        expected_subtotal = win1.unit_price + win2.unit_price + 600 + self.project.installation_charge
        self.assertAlmostEqual(self.project.subtotal_price, expected_subtotal, places=2)

    def test_per_window_addon_not_double_counted_at_project_level(self):
        """A per_window=True add-on is already inside each window's unit_price
        and must NOT also be added to one_time_addon_total."""
        category = self.env['wincraft.addon.category'].create({
            'name': 'Test Per-Window Category', 'code': 'test_per_window', 'scope': 'window',
        })
        addon = self.env['wincraft.addon'].create({
            'name': 'Mosquito Mesh', 'category_id': category.id, 'price': 80, 'per_window': True,
        })
        self._create_window(addon_ids=[(6, 0, [addon.id])])
        self.project.invalidate_recordset()
        self.assertEqual(self.project.one_time_addon_total, 0)

    def test_state_transitions(self):
        """Validate state transitions follow the expected workflow."""
        self.assertEqual(self.project.state, 'draft')
        self.project.action_set_state_designing()
        self.assertEqual(self.project.state, 'designing')
        self.project.action_set_state_quoted()
        self.assertEqual(self.project.state, 'quoted')
        self.project.action_set_state_accepted()
        self.assertEqual(self.project.state, 'accepted')
        self.project.action_set_state_fabricating()
        self.assertEqual(self.project.state, 'fabricating')
        self.project.action_set_state_delivered()
        self.assertEqual(self.project.state, 'delivered')

    def test_quote_revision(self):
        """action_create_revision should snapshot data and increment version."""
        self._create_window()
        self.project.invalidate_recordset()
        self.assertEqual(self.project.quote_version, 1)
        self.project.action_create_revision()
        self.assertEqual(self.project.quote_version, 2)
        self.assertEqual(len(self.project.quote_history_ids), 1)
        history = self.project.quote_history_ids[0]
        self.assertEqual(history.version, 1)
        self.assertAlmostEqual(history.total, self.project.total_price, places=2)

    def test_portal_url(self):
        """Portal URL should contain the project ID."""
        url = self.project._get_portal_url()
        self.assertIn(str(self.project.id), url)

    def test_whatsapp_action_returns_url(self):
        """action_share_whatsapp should return an act_url action."""
        result = self.project.action_share_whatsapp()
        self.assertEqual(result['type'], 'ir.actions.act_url')
        self.assertIn('wa.me', result['url'])
