# -*- coding: utf-8 -*-
"""
WinCraft Studio — Profile Optimiser.
Computes optimal cutting patterns from standard profile lengths to minimise waste.
Uses a first-fit-decreasing bin-packing algorithm.
"""
import logging

from odoo import models, fields, api, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class WincraftProfileOptimiser(models.Model):
    """Profile optimiser run for a project — produces cutting patterns."""

    _name = 'wincraft.profile.optimiser'
    _description = 'WinCraft Profile Optimiser'
    _order = 'create_date desc'

    name = fields.Char(
        string='Reference',
        readonly=True,
        default=lambda self: _('New'),
    )
    project_id = fields.Many2one(
        comodel_name='wincraft.project',
        string='Project',
        required=True,
        ondelete='cascade',
    )
    material_id = fields.Many2one(
        comodel_name='wincraft.material',
        string='Material',
        required=True,
    )
    standard_length = fields.Integer(
        string='Standard Profile Length (mm)',
        required=True,
        default=6000,
        help='Standard stock length of the profile bar.',
    )
    blade_kerf = fields.Integer(
        string='Blade Kerf (mm)',
        default=3,
        help='Width lost per cut due to the saw blade.',
    )
    total_bars = fields.Integer(
        string='Total Bars Needed',
        compute='_compute_results',
        store=True,
    )
    total_waste_mm = fields.Integer(
        string='Total Waste (mm)',
        compute='_compute_results',
        store=True,
    )
    waste_pct = fields.Float(
        string='Waste %',
        compute='_compute_results',
        store=True,
        digits=(5, 1),
    )
    state = fields.Selection(
        selection=[
            ('draft', 'Draft'),
            ('computed', 'Computed'),
        ],
        default='draft',
        string='State',
    )
    cut_line_ids = fields.One2many(
        comodel_name='wincraft.profile.optimiser.line',
        inverse_name='optimiser_id',
        string='Required Cuts',
    )
    bar_ids = fields.One2many(
        comodel_name='wincraft.profile.optimiser.bar',
        inverse_name='optimiser_id',
        string='Cutting Pattern',
    )

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', _('New')) == _('New'):
                vals['name'] = self.env['ir.sequence'].next_by_code(
                    'wincraft.profile.optimiser'
                ) or _('New')
        return super().create(vals_list)

    def action_populate_cuts(self):
        """Auto-populate cut lines from the project's windows for the selected material."""
        self.ensure_one()
        windows = self.project_id.window_ids.filtered(
            lambda w: w.frame_material_id.id == self.material_id.id
        )
        if not windows:
            raise UserError(_('No windows found using material "%s".') % self.material_id.name)

        self.cut_line_ids.unlink()
        lines = []
        for win in windows:
            ph = win.panels_horizontal or 1
            pv = win.panels_vertical or 1
            # Horizontal frame members (top + bottom + internal horizontals)
            h_count = pv + 1  # e.g. 1 row = 2 horizontals
            for i in range(h_count):
                lines.append({
                    'optimiser_id': self.id,
                    'window_id': win.id,
                    'description': f'{win.name} — Horizontal #{i + 1}',
                    'length_mm': win.width_mm,
                    'qty': 1,
                })
            # Vertical frame members (left + right + internal verticals)
            v_count = ph + 1  # e.g. 2 panels = 3 verticals
            for i in range(v_count):
                lines.append({
                    'optimiser_id': self.id,
                    'window_id': win.id,
                    'description': f'{win.name} — Vertical #{i + 1}',
                    'length_mm': win.height_mm,
                    'qty': 1,
                })
        self.env['wincraft.profile.optimiser.line'].create(lines)

    def action_compute(self):
        """Run the first-fit-decreasing bin-packing algorithm."""
        self.ensure_one()
        if not self.cut_line_ids:
            raise UserError(_('Please add cut requirements first.'))

        # Flatten all cuts into a sorted list (descending)
        cuts = []
        for line in self.cut_line_ids:
            for _i in range(line.qty):
                cuts.append({
                    'line_id': line.id,
                    'length': line.length_mm,
                    'description': line.description,
                })
        cuts.sort(key=lambda c: c['length'], reverse=True)

        bar_length = self.standard_length
        kerf = self.blade_kerf

        # Validate
        for c in cuts:
            if c['length'] + kerf > bar_length:
                raise UserError(
                    _('Cut "%s" (%d mm) exceeds standard profile length (%d mm).')
                    % (c['description'], c['length'], bar_length)
                )

        # First-fit decreasing bin packing
        bars = []  # Each bar: {'remaining': int, 'cuts': list}
        for c in cuts:
            placed = False
            needed = c['length'] + kerf
            for bar in bars:
                if bar['remaining'] >= needed:
                    bar['remaining'] -= needed
                    bar['cuts'].append(c)
                    placed = True
                    break
            if not placed:
                new_bar = {'remaining': bar_length - needed, 'cuts': [c]}
                bars.append(new_bar)

        # Clear old results
        self.bar_ids.unlink()

        # Create bar records
        for idx, bar in enumerate(bars, 1):
            used = bar_length - bar['remaining']
            bar_rec = self.env['wincraft.profile.optimiser.bar'].create({
                'optimiser_id': self.id,
                'sequence': idx,
                'used_mm': used,
                'waste_mm': bar['remaining'],
            })
            for cut_idx, c in enumerate(bar['cuts'], 1):
                self.env['wincraft.profile.optimiser.bar.cut'].create({
                    'bar_id': bar_rec.id,
                    'sequence': cut_idx,
                    'line_id': c['line_id'],
                    'length_mm': c['length'],
                    'description': c['description'],
                })

        self.state = 'computed'

    @api.depends('bar_ids', 'bar_ids.waste_mm')
    def _compute_results(self):
        for rec in self:
            bars = rec.bar_ids
            rec.total_bars = len(bars)
            rec.total_waste_mm = sum(b.waste_mm for b in bars)
            total_stock = len(bars) * rec.standard_length if bars else 0
            rec.waste_pct = (rec.total_waste_mm / total_stock * 100) if total_stock else 0.0

    def action_reset(self):
        """Reset to draft."""
        self.ensure_one()
        self.bar_ids.unlink()
        self.state = 'draft'


class WincraftProfileOptimiserLine(models.Model):
    """Individual cut requirement for the optimiser."""

    _name = 'wincraft.profile.optimiser.line'
    _description = 'Profile Optimiser Cut Requirement'
    _order = 'length_mm desc'

    optimiser_id = fields.Many2one(
        comodel_name='wincraft.profile.optimiser',
        string='Optimiser',
        required=True,
        ondelete='cascade',
    )
    window_id = fields.Many2one(
        comodel_name='wincraft.window',
        string='Window',
    )
    description = fields.Char(string='Description', required=True)
    length_mm = fields.Integer(string='Length (mm)', required=True)
    qty = fields.Integer(string='Qty', required=True, default=1)


class WincraftProfileOptimiserBar(models.Model):
    """A single bar in the cutting pattern result."""

    _name = 'wincraft.profile.optimiser.bar'
    _description = 'Profile Optimiser Bar'
    _order = 'sequence'

    optimiser_id = fields.Many2one(
        comodel_name='wincraft.profile.optimiser',
        string='Optimiser',
        required=True,
        ondelete='cascade',
    )
    sequence = fields.Integer(string='Bar #', default=1)
    used_mm = fields.Integer(string='Used (mm)')
    waste_mm = fields.Integer(string='Waste (mm)')
    cut_ids = fields.One2many(
        comodel_name='wincraft.profile.optimiser.bar.cut',
        inverse_name='bar_id',
        string='Cuts',
    )
    utilisation_pct = fields.Float(
        string='Utilisation %',
        compute='_compute_utilisation',
    )

    def _compute_utilisation(self):
        for bar in self:
            total = bar.optimiser_id.standard_length or 1
            bar.utilisation_pct = (bar.used_mm / total) * 100


class WincraftProfileOptimiserBarCut(models.Model):
    """A cut placed on a specific bar."""

    _name = 'wincraft.profile.optimiser.bar.cut'
    _description = 'Profile Optimiser Bar Cut'
    _order = 'sequence'

    bar_id = fields.Many2one(
        comodel_name='wincraft.profile.optimiser.bar',
        string='Bar',
        required=True,
        ondelete='cascade',
    )
    sequence = fields.Integer(string='#', default=1)
    line_id = fields.Many2one(
        comodel_name='wincraft.profile.optimiser.line',
        string='Cut Requirement',
    )
    length_mm = fields.Integer(string='Length (mm)')
    description = fields.Char(string='Description')
