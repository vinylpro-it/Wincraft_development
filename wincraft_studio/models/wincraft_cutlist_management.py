# -*- coding: utf-8 -*-
"""
WinCraft Studio — Cutlist Management (Phase 1).

Project-wise manufacturing cutlists generated on demand from each window's
BOM (`mrp.bom.line`, extended with `component_type`/`length_mm`/`width_mm`
in fenestriflow/models/mrp_bom_line.py). Unlike `wincraft.cutlist.line`
(a live SQL view of raw window dimensions, used for quick frame/glass
size lookups), these are stored snapshots: a project's cutlist only
changes when "Generate Cutlists" is run again, which matches the
profile shop / glass vendor workflow of working off a fixed cut sheet.

No stock nesting, CNC export, barcoding, or production tracking here —
that is explicitly out of Phase 1 scope.
"""
from odoo import models, fields, api, _
from odoo.exceptions import UserError

# Component types that represent a linear profile cut to length (Profile
# Cutlist). Glass is handled separately by the Glass Cutlist; hardware,
# add-ons and paint never get a length_mm set by the BOM builder, so they
# fall out naturally rather than needing to be excluded by name.
PROFILE_PART_TYPES = (
    'frame', 'sash', 'mullion', 'reinforcement', 'bead', 'gasket', 'seal', 'spacer',
)

PROFILE_PART_TYPE_SELECTION = [
    ('frame', 'Outer Frame'),
    ('sash', 'Sash Frame'),
    ('mullion', 'Mullion / Transom'),
    ('reinforcement', 'Reinforcement'),
    ('bead', 'Glazing Bead'),
    ('gasket', 'Gasket / Seal'),
    ('seal', 'Weatherseal'),
    ('spacer', 'Spacer'),
]


def _bay_bow_post_face_angle(window):
    """Per-end mitre angle for a bay/bow mulling post, mirroring the
    calculation in WincraftWindowBomBuilder._add_bay_bow_assembly_lines
    (both read wincraft.window._resolve_bay_bow_angle_deg(), the single
    source of truth for the configured bay/bow angle). Regular rectangular
    frames have no stored mitre angle anywhere in the system today, so
    every other profile defaults to a square 0° cut.
    """
    if window.window_type not in ('bay', 'bow'):
        return 0.0
    return window._resolve_bay_bow_angle_deg() / 2.0


class WincraftCutlistProfileLine(models.Model):
    """One aggregated profile cut requirement for a window (a 'Unit')."""

    _name = 'wincraft.cutlist.profile.line'
    _description = 'WinCraft Profile Cutlist Line'
    _order = 'project_id, window_id, part_type, length_mm desc'

    project_id = fields.Many2one(
        comodel_name='wincraft.project', string='Project', required=True,
        ondelete='cascade', index=True,
    )
    ref = fields.Char(string='Project Ref', related='project_id.ref', store=True, readonly=True)
    window_id = fields.Many2one(
        comodel_name='wincraft.window', string='Unit', required=True,
        ondelete='cascade', index=True,
    )
    product_id = fields.Many2one(comodel_name='product.product', string='Profile Product', required=True)
    profile_code = fields.Char(string='Profile Code')
    profile_name = fields.Char(string='Profile Name')
    part_type = fields.Selection(selection=PROFILE_PART_TYPE_SELECTION, string='Part Type')
    length_mm = fields.Float(string='Length (mm)', digits=(12, 1))
    quantity = fields.Integer(string='Quantity', default=1)
    angle_left = fields.Float(string='Angle Left (°)', digits=(5, 1))
    angle_right = fields.Float(string='Angle Right (°)', digits=(5, 1))
    company_id = fields.Many2one(
        comodel_name='res.company', string='Company',
        related='project_id.company_id', store=True, readonly=True,
    )


class WincraftCutlistGlassLine(models.Model):
    """One aggregated glass cut requirement for a window (a 'Unit')."""

    _name = 'wincraft.cutlist.glass.line'
    _description = 'WinCraft Glass Cutlist Line'
    _order = 'project_id, window_id, width_mm desc'

    project_id = fields.Many2one(
        comodel_name='wincraft.project', string='Project', required=True,
        ondelete='cascade', index=True,
    )
    ref = fields.Char(string='Project Ref', related='project_id.ref', store=True, readonly=True)
    window_id = fields.Many2one(
        comodel_name='wincraft.window', string='Unit', required=True,
        ondelete='cascade', index=True,
    )
    product_id = fields.Many2one(comodel_name='product.product', string='Glass Product', required=True)
    glass_type = fields.Char(string='Glass Type')
    width_mm = fields.Float(string='Width (mm)', digits=(12, 1))
    height_mm = fields.Float(string='Height (mm)', digits=(12, 1))
    quantity = fields.Integer(string='Quantity', default=1)
    company_id = fields.Many2one(
        comodel_name='res.company', string='Company',
        related='project_id.company_id', store=True, readonly=True,
    )


class WincraftProjectCutlistManagement(models.Model):
    """Adds Profile/Glass cutlist generation to wincraft.project."""

    _inherit = 'wincraft.project'

    # ══════════════════════════════════════════════════════════════════
    #  GENERATION (BOM → aggregated cutlist lines)
    # ══════════════════════════════════════════════════════════════════

    def _generate_profile_cutlist_vals(self):
        """Build (not create) wincraft.cutlist.profile.line vals for this
        project: BOM quantity × unit quantity, aggregated per window by
        (Profile Code, Length, Angle Left, Angle Right, Part Type).
        """
        self.ensure_one()
        vals_list = []
        for window in self.window_ids:
            if not window.bom_id:
                continue
            # One wincraft.window record is always exactly one physical unit
            # today (sale order lines are created with product_uom_qty=1
            # throughout). Kept as an explicit multiplier so a future
            # per-unit quantity field only needs to change this one line.
            unit_qty = 1
            post_angle = (
                _bay_bow_post_face_angle(window) if window.window_type in ('bay', 'bow') else 0.0
            )
            groups = {}
            for line in window.bom_id.bom_line_ids:
                if line.component_type not in PROFILE_PART_TYPES or not line.length_mm:
                    continue
                angle = post_angle if line.component_type == 'mullion' else 0.0
                key = (line.product_id.id, round(line.length_mm, 1), angle, angle, line.component_type)
                grp = groups.setdefault(key, {'qty': 0.0, 'product': line.product_id})
                grp['qty'] += (line.product_qty or 1.0) * unit_qty
            for (product_id, length_mm, angle_left, angle_right, part_type), grp in groups.items():
                vals_list.append({
                    'project_id': self.id,
                    'window_id': window.id,
                    'product_id': product_id,
                    'profile_code': grp['product'].default_code or '',
                    'profile_name': grp['product'].name or '',
                    'part_type': part_type,
                    'length_mm': length_mm,
                    'quantity': int(round(grp['qty'])),
                    'angle_left': angle_left,
                    'angle_right': angle_right,
                })
        return vals_list

    def _generate_glass_cutlist_vals(self):
        """Build (not create) wincraft.cutlist.glass.line vals for this
        project: BOM quantity × unit quantity, aggregated per window by
        (Glass Type, Width, Height).

        Glass BOM lines store the cut width in length_mm and the cut
        height in width_mm (see WincraftWindowBomBuilder
        ._add_glass_line_for_pane); product_qty there holds the pane's
        AREA in m² for costing, not a piece count, so the piece count is
        one per BOM line rather than a sum of product_qty.
        """
        self.ensure_one()
        vals_list = []
        for window in self.window_ids:
            if not window.bom_id:
                continue
            unit_qty = 1
            groups = {}
            for line in window.bom_id.bom_line_ids:
                if line.component_type != 'glass':
                    continue
                width_mm = round(line.length_mm or 0.0, 1)
                height_mm = round(line.width_mm or 0.0, 1)
                if not width_mm or not height_mm:
                    continue
                key = (line.product_id.id, width_mm, height_mm)
                grp = groups.setdefault(key, {'qty': 0.0, 'product': line.product_id})
                grp['qty'] += 1.0 * unit_qty
            for (product_id, width_mm, height_mm), grp in groups.items():
                vals_list.append({
                    'project_id': self.id,
                    'window_id': window.id,
                    'product_id': product_id,
                    'glass_type': grp['product'].name or '',
                    'width_mm': width_mm,
                    'height_mm': height_mm,
                    'quantity': int(round(grp['qty'])),
                })
        return vals_list

    def action_generate_profile_cutlist(self):
        """Regenerate this project's Profile Cutlist from its windows' BOMs."""
        self.ensure_one()
        vals_list = self._generate_profile_cutlist_vals()
        if not vals_list:
            raise UserError(_(
                'No profile BOM data found for this project. '
                'Generate each window\'s BOM first (Designer → Generate BOM).'
            ))
        self.env['wincraft.cutlist.profile.line'].search([('project_id', '=', self.id)]).unlink()
        self.env['wincraft.cutlist.profile.line'].create(vals_list)
        return self._action_view_profile_cutlist()

    def action_generate_glass_cutlist(self):
        """Regenerate this project's Glass Cutlist from its windows' BOMs."""
        self.ensure_one()
        vals_list = self._generate_glass_cutlist_vals()
        if not vals_list:
            raise UserError(_(
                'No glass BOM data found for this project. '
                'Generate each window\'s BOM first (Designer → Generate BOM).'
            ))
        self.env['wincraft.cutlist.glass.line'].search([('project_id', '=', self.id)]).unlink()
        self.env['wincraft.cutlist.glass.line'].create(vals_list)
        return self._action_view_glass_cutlist()

    def action_generate_all_cutlists(self):
        """Regenerate both the Profile and Glass Cutlist for this project."""
        self.ensure_one()
        profile_vals = self._generate_profile_cutlist_vals()
        glass_vals = self._generate_glass_cutlist_vals()
        if not profile_vals and not glass_vals:
            raise UserError(_(
                'No BOM data found for this project. '
                'Generate each window\'s BOM first (Designer → Generate BOM).'
            ))
        self.env['wincraft.cutlist.profile.line'].search([('project_id', '=', self.id)]).unlink()
        self.env['wincraft.cutlist.glass.line'].search([('project_id', '=', self.id)]).unlink()
        if profile_vals:
            self.env['wincraft.cutlist.profile.line'].create(profile_vals)
        if glass_vals:
            self.env['wincraft.cutlist.glass.line'].create(glass_vals)
        return self._action_view_all_cutlists()

    # ══════════════════════════════════════════════════════════════════
    #  ON-SCREEN RESULTS
    # ══════════════════════════════════════════════════════════════════

    def _action_view_profile_cutlist(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Profile Cutlist — %s') % self.name,
            'res_model': 'wincraft.cutlist.profile.line',
            'view_mode': 'list',
            'domain': [('project_id', '=', self.id)],
        }

    def _action_view_glass_cutlist(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Glass Cutlist — %s') % self.name,
            'res_model': 'wincraft.cutlist.glass.line',
            'view_mode': 'list',
            'domain': [('project_id', '=', self.id)],
        }

    def _action_view_all_cutlists(self):
        self.ensure_one()
        return self._action_view_profile_cutlist()
