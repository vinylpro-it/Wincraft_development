# -*- coding: utf-8 -*-
"""
WinCraft Studio — Spacer Config model.

Maps a spacer key (e.g. 'alu', 'warm-edge', 'super-spacer') used in the
canvas pane config to a real Odoo product.template.
"""
import logging

from odoo import models, fields, api, _

_logger = logging.getLogger(__name__)


class WincraftSpacerConfig(models.Model):
    """Connects a canvas spacer key to a real spacer product."""

    _name = 'wincraft.spacer.config'
    _description = 'WinCraft Spacer Product Configuration'
    _order = 'sequence, label'
    _rec_name = 'label'

    label = fields.Char(
        string='Display Label',
        required=True,
        help='Human-readable label shown in the canvas (e.g. "Aluminium Spacer", "Warm Edge").',
    )
    spacer_key = fields.Char(
        string='Canvas Key',
        required=True,
        help='Internal key stored in pane config JSON (e.g. "alu", "warm-edge").',
    )
    product_tmpl_id = fields.Many2one(
        comodel_name='product.template',
        string='Spacer Product',
        required=True,
        ondelete='restrict',
        domain=[('type', 'in', ['consu', 'product'])],
        help='The spacer product template.',
    )
    product_code = fields.Char(
        related='product_tmpl_id.default_code',
        string='Product Code',
        store=True,
        readonly=True,
    )
    is_default = fields.Boolean(
        string='Default Spacer',
        default=False,
        help='If checked, this spacer is pre-selected in newly created pane configs.',
    )
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    notes = fields.Text(string='Notes')

    # v19: models.Constraint
    _unique_spacer_key = models.Constraint(
        'UNIQUE(spacer_key)',
        'A spacer config with this canvas key already exists.',
    )

    @api.constrains('is_default')
    def _check_single_default(self):
        """Ensure at most one spacer is marked as default."""
        for rec in self:
            if rec.is_default:
                others = self.search([
                    ('is_default', '=', True),
                    ('id', '!=', rec.id),
                    ('active', '=', True),
                ])
                if others:
                    others.write({'is_default': False})
