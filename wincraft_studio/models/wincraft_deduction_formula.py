# -*- coding: utf-8 -*-
"""
WinCraft Studio — Deduction Formula model.

Configurable deduction parameters per (opening_type + profile_type).
These formulas drive the BOM builder's cut-list calculations:
outer frame pieces, sash frame pieces, glass sizes, beads, gaskets,
reinforcement, and weatherseal lengths.

Industry-standard defaults are seeded via XML data; administrators
can override any value per profile family.
"""
import logging

from odoo import models, fields, api

_logger = logging.getLogger(__name__)

# Opening types that do NOT have an operable sash
_FIXED_TYPES = {'fixed'}


class WincraftDeductionFormula(models.Model):
    """Deduction parameters per opening type + profile type.

    Used by the BOM builder to compute accurate cut lengths for every
    component in a window unit — outer frame, sash, glass, beads,
    gaskets, reinforcement, and weatherseal.
    """

    _name = 'wincraft.deduction.formula'
    _description = 'WinCraft Deduction Formula'
    _order = 'opening_type, profile_type_id'
    _rec_name = 'display_name'

    # ── Identity ─────────────────────────────────────────────────────────
    opening_type = fields.Selection(
        selection=lambda self: self.env['wincraft.opening.type']._selection_opening_type(),
        string='Opening Type',
        required=True,
    )
    profile_type_id = fields.Many2one(
        comodel_name='wincraft.window.type.series',
        string='Profile Type',
        ondelete='cascade',
        help='Leave blank to define fallback defaults for this opening type.',
    )
    display_name = fields.Char(
        compute='_compute_display_name',
        store=True,
    )
    has_sash = fields.Boolean(
        string='Has Sash',
        compute='_compute_has_sash',
        store=True,
        help='Computed from opening type — True for all operable types.',
    )
    active = fields.Boolean(default=True)

    # ── Outer Frame ──────────────────────────────────────────────────────
    frame_rebate_mm = fields.Float(
        string='Frame Rebate (mm)',
        default=12.0,
        help='Rebate depth cut into the outer frame to receive glass or sash.',
    )
    frame_mitre_allowance_mm = fields.Float(
        string='Frame Mitre Allowance (mm)',
        default=3.0,
        help='Extra material per end for 45° mitre cut (applied ×2 per piece).',
    )
    frame_weld_allowance_mm = fields.Float(
        string='Frame Weld Allowance (mm)',
        default=3.0,
        help='Weld/fusion allowance per end for uPVC frames (applied ×2 per piece). '
             'Set to 0 for aluminium/timber mechanically joined frames.',
    )

    # ── Sash Frame ───────────────────────────────────────────────────────
    sash_clearance_mm = fields.Float(
        string='Sash Clearance (mm)',
        default=3.0,
        help='Gap between outer frame inner face and sash outer face (per side).',
    )
    sash_rebate_mm = fields.Float(
        string='Sash Rebate (mm)',
        default=10.0,
        help='Rebate depth in the sash profile for glass seating.',
    )
    sash_mitre_allowance_mm = fields.Float(
        string='Sash Mitre Allowance (mm)',
        default=3.0,
        help='Mitre cutting allowance per end for sash members (×2 per piece).',
    )
    sash_weld_allowance_mm = fields.Float(
        string='Sash Weld Allowance (mm)',
        default=3.0,
        help='Weld/fusion allowance per end for sash members (×2 per piece).',
    )

    # ── Glass ────────────────────────────────────────────────────────────
    glass_clearance_mm = fields.Float(
        string='Glass Clearance (mm)',
        default=3.0,
        help='Gap between glass edge and rebate pocket (per side). '
             'Accommodates manufacturing tolerance and thermal expansion.',
    )

    # ── Glazing Bead & Gasket ────────────────────────────────────────────
    glazing_bead_depth_mm = fields.Float(
        string='Glazing Bead Depth (mm)',
        default=15.0,
        help='Depth of the internal glazing bead that retains the glass unit.',
    )
    gasket_allowance_mm = fields.Float(
        string='Gasket Corner Allowance (mm)',
        default=10.0,
        help='Extra gasket length per corner for overlap/butt joint (×4 per unit).',
    )

    # ── Reinforcement ────────────────────────────────────────────────────
    reinforcement_required = fields.Boolean(
        string='Reinforcement Required',
        default=True,
        help='Whether steel reinforcement inserts are needed (typical for uPVC).',
    )
    reinforcement_deduction_mm = fields.Float(
        string='Reinforcement Deduction (mm)',
        default=30.0,
        help='Total deduction from the frame/sash piece length to derive '
             'the steel reinforcement cut length (clearance at both ends).',
    )

    # ── Weatherseal ──────────────────────────────────────────────────────
    weatherseal_overlap_mm = fields.Float(
        string='Weatherseal Overlap (mm)',
        default=20.0,
        help='Extra seal length beyond the sash perimeter for overlap at the joint.',
    )

    # ── Product links (optional — for component-specific products) ───────
    sash_product_tmpl_id = fields.Many2one(
        comodel_name='product.template',
        string='Sash Profile Product',
        ondelete='set null',
        help='If set, used as the sash profile product instead of the frame product.',
    )
    bead_product_tmpl_id = fields.Many2one(
        comodel_name='product.template',
        string='Glazing Bead Product',
        ondelete='set null',
    )
    gasket_product_tmpl_id = fields.Many2one(
        comodel_name='product.template',
        string='Gasket Product',
        ondelete='set null',
    )
    reinforcement_product_tmpl_id = fields.Many2one(
        comodel_name='product.template',
        string='Reinforcement Product',
        ondelete='set null',
        help='Steel reinforcement insert product (typically for uPVC profiles).',
    )
    weatherseal_product_tmpl_id = fields.Many2one(
        comodel_name='product.template',
        string='Weatherseal Product',
        ondelete='set null',
    )

    # ── Constraints ──────────────────────────────────────────────────────
    _unique_combo = models.Constraint(
        'UNIQUE(opening_type, profile_type_id)',
        'A deduction formula for this opening type + profile type already exists.',
    )

    # ── Computed ─────────────────────────────────────────────────────────
    @api.depends('opening_type', 'profile_type_id')
    def _compute_display_name(self):
        labels = dict(self.env['wincraft.opening.type']._selection_opening_type())
        for rec in self:
            ot_label = labels.get(rec.opening_type, rec.opening_type or '')
            ps_label = rec.profile_type_id.name or 'Default'
            rec.display_name = f'{ot_label} — {ps_label}'

    @api.depends('opening_type')
    def _compute_has_sash(self):
        for rec in self:
            rec.has_sash = rec.opening_type not in _FIXED_TYPES

    # ── Public API ───────────────────────────────────────────────────────
    def get_glass_size(self, pane_width_mm, pane_height_mm):
        """Return (glass_width_mm, glass_height_mm) after deductions.

        For fixed panes the glass sits directly in the outer frame rebate.
        For operable panes the glass sits inside the sash rebate.
        """
        self.ensure_one()
        if self.has_sash:
            sash_w = pane_width_mm - 2 * self.sash_clearance_mm
            sash_h = pane_height_mm - 2 * self.sash_clearance_mm
            glass_w = sash_w - 2 * (self.sash_rebate_mm + self.glass_clearance_mm)
            glass_h = sash_h - 2 * (self.sash_rebate_mm + self.glass_clearance_mm)
        else:
            glass_w = pane_width_mm - 2 * (self.frame_rebate_mm + self.glass_clearance_mm)
            glass_h = pane_height_mm - 2 * (self.frame_rebate_mm + self.glass_clearance_mm)
        return max(glass_w, 0), max(glass_h, 0)

    def get_sash_size(self, pane_width_mm, pane_height_mm):
        """Return (sash_width_mm, sash_height_mm) — inner dimension of the sash opening."""
        self.ensure_one()
        if not self.has_sash:
            return 0.0, 0.0
        return (
            pane_width_mm - 2 * self.sash_clearance_mm,
            pane_height_mm - 2 * self.sash_clearance_mm,
        )

    def get_sash_cut_lengths(self, pane_width_mm, pane_height_mm):
        """Return (horizontal_cut_mm, vertical_cut_mm) for sash frame pieces."""
        self.ensure_one()
        if not self.has_sash:
            return 0.0, 0.0
        sash_w, sash_h = self.get_sash_size(pane_width_mm, pane_height_mm)
        allowance = 2 * (self.sash_mitre_allowance_mm + self.sash_weld_allowance_mm)
        return sash_w + allowance, sash_h + allowance

    def get_frame_cut_lengths(self, window_width_mm, window_height_mm):
        """Return (horizontal_cut_mm, vertical_cut_mm) for outer frame pieces."""
        self.ensure_one()
        allowance = 2 * (self.frame_mitre_allowance_mm + self.frame_weld_allowance_mm)
        return window_width_mm + allowance, window_height_mm + allowance

    def get_bead_cut_lengths(self, glass_width_mm, glass_height_mm):
        """Return (horizontal_cut_mm, vertical_cut_mm) for glazing bead pieces."""
        self.ensure_one()
        return (
            glass_width_mm + 2 * self.glazing_bead_depth_mm,
            glass_height_mm + 2 * self.glazing_bead_depth_mm,
        )

    def get_gasket_length(self, glass_width_mm, glass_height_mm):
        """Return total gasket length (mm) for one glass unit (inner + outer run)."""
        self.ensure_one()
        perimeter = 2 * (glass_width_mm + glass_height_mm)
        corner_extra = 4 * self.gasket_allowance_mm
        return 2 * perimeter + 2 * corner_extra  # inner + outer gasket run

    def get_reinforcement_length(self, frame_piece_mm):
        """Return reinforcement insert cut length for one frame/sash piece."""
        self.ensure_one()
        if not self.reinforcement_required:
            return 0.0
        return max(frame_piece_mm - self.reinforcement_deduction_mm, 0)

    def get_weatherseal_length(self, pane_width_mm, pane_height_mm):
        """Return weatherseal length for one operable pane."""
        self.ensure_one()
        if not self.has_sash:
            return 0.0
        sash_w, sash_h = self.get_sash_size(pane_width_mm, pane_height_mm)
        return 2 * (sash_w + sash_h) + self.weatherseal_overlap_mm
