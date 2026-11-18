# -*- coding: utf-8 -*-
"""
WinCraft Studio — BOM Builder (Industry-Standard Cut-List).

Generates a full cut-list BOM for each window design using real
fenestration deduction formulas.  Every pane produces individual
BOM lines for: outer frame, sash frame, glass, glazing beads,
gaskets, reinforcement, hardware, and weatherseal — with accurate
millimetre dimensions derived from configurable deduction parameters.
"""
import json
import logging

from odoo import models, fields, api, _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

# Sequence ranges for BOM line grouping
SEQ_FRAME = 100
SEQ_SASH = 200
SEQ_GLASS = 300
SEQ_BEAD = 400
SEQ_GASKET = 500
SEQ_REINFORCEMENT = 600
SEQ_HARDWARE = 700
SEQ_SEAL = 800
SEQ_MULLION = 900
SEQ_SPACER = 950
SEQ_ADDON = 1000
SEQ_PAINT = 1100


class WincraftWindowBomBuilder(models.Model):
    """Mixin on wincraft.window — adds BOM generation capability."""

    _inherit = 'wincraft.window'

    # ══════════════════════════════════════════════════════════════════════
    #  PUBLIC ACTION
    # ══════════════════════════════════════════════════════════════════════

    def action_generate_bom(self):
        """Generate (or regenerate) the mrp.bom for this window design."""
        self.ensure_one()
        env = self.env

        # 1. Dominant opening type (for BOM header / frame product)
        dominant_ot = self._dominant_opening_type()
        _logger.info('BOM: window %s  dominant OT = %s', self.id, dominant_ot)

        # 2. Frame product from wincraft.frame.config
        frame_config = env['wincraft.frame.config'].search([
            ('opening_type', '=', dominant_ot),
            ('profile_type_id', '=', self.profile_type_id.id),
            ('active', '=', True),
        ], limit=1)
        if not frame_config:
            raise UserError(_(
                'No frame product configured for opening type "%(ot)s" '
                'with profile type "%(ps)s".\n\n'
                'Go to Configuration → Frame Product Mappings and add a mapping.',
                ot=dominant_ot,
                ps=self.profile_type_id.name or 'N/A',
            ))
        frame_tmpl = frame_config.product_tmpl_id

        # 3. Frame variant
        frame_product = self._resolve_frame_variant(frame_tmpl)

        # 4. Find or create mrp.bom
        bom = self._find_or_create_bom(frame_product)

        # 5. Calculate pane layout with dimensions + perimeter flags
        panes = self._calculate_pane_layout()
        _logger.info('BOM: window %s  %d pane(s) extracted', self.id, len(panes))

        # 6. Generate cut-list lines for each pane
        for idx, pane in enumerate(panes):
            self._generate_pane_bom_lines(bom, pane, idx, frame_product)

        # 7. Mullion / transom bars
        # For bay/bow, regular mullions are replaced with angled mulling posts
        # added by _add_bay_bow_assembly_lines below.
        if self.window_type not in ('bay', 'bow'):
            self._add_mullion_lines(bom, panes, frame_product)

        # 7b. Bay / Bow extras: angled mulling posts, head & seat boards,
        #     support kit. Mandatory for fabrication of these assemblies.
        if self.window_type in ('bay', 'bow'):
            self._add_bay_bow_assembly_lines(bom, panes, frame_product)

        # 8. Spacer lines
        self._add_spacer_bom_line(bom, panes)

        # 8b. Whole-window hardware (hardware_ids — trickle vent, sill, etc.,
        # not tied to a specific pane like the per-pane hardwareSelections
        # already added inside _generate_pane_bom_lines above)
        self._add_window_hardware_lines(bom)

        # 9. Add-on items
        self._add_addon_lines(bom)

        # 9b. Frame paint (Inside/Outside paint products, from inventory)
        self._add_paint_lines(bom)

        # 10. Auto-create routing operations if work centres exist
        self._ensure_routing_operations(bom)

        # 11. Persist
        self.bom_id = bom
        return {
            'type': 'ir.actions.act_window',
            'name': _('Generated BOM'),
            'res_model': 'mrp.bom',
            'res_id': bom.id,
            'view_mode': 'form',
            'target': 'current',
        }

    def _ensure_routing_operations(self, bom):
        """Add default routing operations to the BOM if none exist yet."""
        if bom.operation_ids:
            return  # Already has operations
        RoutingOp = self.env['mrp.routing.workcenter']
        wc_xml_ids = [
            ('wincraft_studio.workcenter_cut', 'Profile Cutting', 10, 8.0),
            ('wincraft_studio.workcenter_weld', 'Frame Welding / Joining', 20, 12.0),
            ('wincraft_studio.workcenter_hardware', 'Hardware Installation', 30, 10.0),
            ('wincraft_studio.workcenter_glazing', 'Glass & Seal', 40, 15.0),
            ('wincraft_studio.workcenter_qc', 'Quality Inspection', 50, 5.0),
        ]
        for xml_id, op_name, seq, cycle_time in wc_xml_ids:
            wc = self.env.ref(xml_id, raise_if_not_found=False)
            if wc:
                RoutingOp.create({
                    'name': op_name,
                    'workcenter_id': wc.id,
                    'bom_id': bom.id,
                    'sequence': seq,
                    'time_cycle_manual': cycle_time,
                })

    # ══════════════════════════════════════════════════════════════════════
    #  PANE LAYOUT CALCULATOR
    # ══════════════════════════════════════════════════════════════════════

    def _calculate_pane_layout(self):
        """Return a list of pane dicts with actual mm dimensions and perimeter flags.

        For Bay & Bow assemblies each lite is treated as an independent
        pane whose width is the real chord (not the splayed elevation
        width). Each lite is a perimeter pane on all four edges since
        it is bordered by an angled mulling post or the outer jamb.
        """
        self.ensure_one()

        # Bay / Bow: per-lite chord widths
        if self.window_type in ('bay', 'bow'):
            return self._panes_from_bay_bow()

        W = float(self.width_mm or 1200)
        H = float(self.height_mm or 1000)

        # Try panel_tree first
        tree = self._parse_json_field(self.panel_tree)
        if tree:
            panes = []
            mullion_w = float(self.profile_type_id.mullion_width_mm or 20)
            self._extract_panes_from_tree(tree, 0, 0, W, H, mullion_w, panes)
            if panes:
                return panes

        # Legacy flat grid
        return self._panes_from_grid(W, H)

    def _extract_panes_from_tree(self, node, x, y, w, h, mullion_w, panes):
        """Recursively walk panel_tree and collect pane geometry."""
        if not isinstance(node, dict):
            return
        if node.get('type') == 'leaf':
            cfg = node.get('config', {}) if isinstance(node.get('config'), dict) else {}
            panes.append({
                'id': node.get('id', f'pane-{len(panes)}'),
                'config': cfg,
                'x': x, 'y': y,
                'width_mm': w, 'height_mm': h,
                'peri_left': x < 1,
                'peri_right': abs(x + w - float(self.width_mm)) < 1,
                'peri_top': y < 1,
                'peri_bottom': abs(y + h - float(self.height_mm)) < 1,
            })
            return

        direction = node.get('direction', 'vertical')
        pos = float(node.get('position', w / 2 if direction == 'vertical' else h / 2))
        half_m = mullion_w / 2.0

        if direction == 'vertical':
            left_w = pos - x - half_m
            right_x = pos + half_m
            right_w = (x + w) - right_x
            self._extract_panes_from_tree(node.get('first', {}), x, y, max(left_w, 0), h, mullion_w, panes)
            self._extract_panes_from_tree(node.get('second', {}), right_x, y, max(right_w, 0), h, mullion_w, panes)
        else:
            top_h = pos - y - half_m
            bot_y = pos + half_m
            bot_h = (y + h) - bot_y
            self._extract_panes_from_tree(node.get('first', {}), x, y, w, max(top_h, 0), mullion_w, panes)
            self._extract_panes_from_tree(node.get('second', {}), x, bot_y, w, max(bot_h, 0), mullion_w, panes)

    def _panes_from_grid(self, W, H):
        """Legacy flat grid pane extraction."""
        nH = max(int(self.panels_horizontal or 1), 1)
        nV = max(int(self.panels_vertical or 1), 1)
        mullion_w = float(self.profile_type_id.mullion_width_mm or 20) if self.profile_type_id else 20.0

        total_mullion_h = (nH - 1) * mullion_w
        total_mullion_v = (nV - 1) * mullion_w
        pane_w = (W - total_mullion_h) / nH
        pane_h = (H - total_mullion_v) / nV

        pane_configs = self._parse_json_field(self.pane_configs) or []
        panes = []
        for row in range(nV):
            for col in range(nH):
                idx = row * nH + col
                x = col * (pane_w + mullion_w)
                y = row * (pane_h + mullion_w)
                pc = pane_configs[idx] if idx < len(pane_configs) and isinstance(pane_configs[idx], dict) else {}
                panes.append({
                    'id': f'pane-{idx}',
                    'config': pc,
                    'x': x, 'y': y,
                    'width_mm': pane_w, 'height_mm': pane_h,
                    'peri_left': col == 0,
                    'peri_right': col == nH - 1,
                    'peri_top': row == 0,
                    'peri_bottom': row == nV - 1,
                })
        return panes

    # ──────────────────────────────────────────────────────────────────
    # Bay & Bow per-lite layout
    # ──────────────────────────────────────────────────────────────────
    def _panes_from_bay_bow(self):
        """Return one pane per lite using real chord widths.

        Bay (3-lite): centre = chord × centre_ratio, flankers split rest.
        Bay (n>3) and Bow: equal-width lites of bay_lite_chord_mm.
        Each lite is full-perimeter: bordered by jamb (left/right of assembly)
        or angled mulling post (between lites). Both behave like an outer frame
        edge from the lite's point of view, so peri_* flags = True.
        """
        self.ensure_one()
        H = float(self.height_mm or 1000)
        n = max(int(self.bay_lite_count or 3), 2)
        W = float(self.width_mm or 1200)

        if self.window_type == 'bay' and n == 3:
            cr = max(0.20, min(self.bay_centre_ratio or 0.5, 0.85))
            centre = W * cr
            flanker = (W - centre) / 2.0
            chords = [flanker, centre, flanker]
        else:
            chord = self.bay_lite_chord_mm or (W / n)
            chords = [chord] * n

        pane_configs = self._parse_json_field(self.pane_configs) or []
        panes = []
        x = 0.0
        for i, c in enumerate(chords):
            pc = pane_configs[i] if i < len(pane_configs) and isinstance(pane_configs[i], dict) else {}
            panes.append({
                'id': f'lite-{i + 1}',
                'config': dict(pc, label=f'L{i + 1}'),
                'x': x, 'y': 0.0,
                'width_mm': c, 'height_mm': H,
                'peri_left': True,
                'peri_right': True,
                'peri_top': True,
                'peri_bottom': True,
            })
            x += c
        return panes

    # ──────────────────────────────────────────────────────────────────
    # Bay & Bow assembly: angled mulling posts, head & seat boards,
    # and structural support kit.
    # ──────────────────────────────────────────────────────────────────
    def _add_bay_bow_assembly_lines(self, bom, panes, frame_product):
        """Emit assembly-level BOM lines for bay and bow windows.

        - Mulling posts: one between each pair of adjacent lites, cut to
          frame height + mitre allowance, with the per-end angle stored
          in x_notes for the saw operator.
        - Head board & Seat board: insulated plywood panels spanning the
          unfolded chord/arc length plus a 20 mm overhang per end.
        - Support kit: cable / knee brace / hip roof / skirt as configured.
        """
        import math
        env = self.env
        BomLine = env['mrp.bom.line']
        H = float(self.height_mm or 1000)
        n = max(int(self.bay_lite_count or 3), 2)

        # Mitre / weld allowance from the dominant deduction formula
        formula = self._get_deduction_formula(self._dominant_opening_type())
        allowance = 0.0
        if formula:
            allowance = 2 * (formula.frame_mitre_allowance_mm + formula.frame_weld_allowance_mm)

        # ── Per-end angle on each mulling post ───────────────────────
        full_angle = self._resolve_bay_bow_angle_deg()

        # Each post is cut at half the bend angle on each face so the two
        # adjacent lites meet at the desired included angle.
        post_face_angle = full_angle / 2.0

        post_count = n - 1
        post_len = H + allowance
        for i in range(post_count):
            BomLine.create({
                'bom_id': bom.id,
                'product_id': frame_product.id,
                'product_qty': 1,
                'length_mm': round(post_len, 1),
                'component_type': 'mullion',
                'x_notes': (
                    f'{self.window_type.upper()} Mulling Post {i + 1} of {post_count} — '
                    f'{round(post_len, 1)}mm, cut {post_face_angle:.1f}° each face '
                    f'(included angle {full_angle:.0f}°)'
                ),
                'sequence': SEQ_MULLION + i,
            })

        # ── Head & seat boards ───────────────────────────────────────
        # Length = unfolded chord/arc length + 20 mm overhang per end
        board_len = (self.bay_total_arc_mm or float(self.width_mm or 1200)) + 40.0

        head_thk = self.head_board_thickness_mm or 19
        head_dep = self.head_board_depth_mm or 300
        BomLine.create({
            'bom_id': bom.id,
            'product_id': frame_product.id,
            'product_qty': 1,
            'length_mm': round(board_len, 1),
            'width_mm': float(head_dep),
            'component_type': 'addon',
            'x_notes': (
                f'Head Board — {round(board_len, 1)}mm × {head_dep}mm × {head_thk}mm plywood'
                + (' + R-12 batt insulation' if self.insulated_boards else '')
            ),
            'sequence': SEQ_ADDON + 10,
        })
        seat_thk = self.seat_board_thickness_mm or 19
        seat_dep = self.seat_board_depth_mm or 300
        finish = dict(self._fields['seat_board_finish'].selection).get(
            self.seat_board_finish, 'Site-Finished'
        )
        BomLine.create({
            'bom_id': bom.id,
            'product_id': frame_product.id,
            'product_qty': 1,
            'length_mm': round(board_len, 1),
            'width_mm': float(seat_dep),
            'component_type': 'addon',
            'x_notes': (
                f'Seat Board — {round(board_len, 1)}mm × {seat_dep}mm × {seat_thk}mm plywood, '
                f'finish: {finish}'
                + (' + R-12 batt insulation' if self.insulated_boards else '')
            ),
            'sequence': SEQ_ADDON + 11,
        })

        # ── Support kit ──────────────────────────────────────────────
        proj = self.projection_depth_mm or 0
        sup = self.bay_support_system or 'cable'
        kit_items = []
        if sup in ('cable', 'cable_and_knee', 'full'):
            kit_items.append((1, f'Cable Support Kit — 2 × steel cables, sized for {round(proj)}mm projection'))
        if sup in ('knee_brace', 'cable_and_knee'):
            kit_items.append((2, f'Knee Brace — wood/steel, {round(proj * 1.4)}mm long, mitred at {post_face_angle:.0f}°'))
        if sup in ('hip_roof', 'full'):
            kit_items.append((1, f'Hip Roof Cap Assembly — covers {round(board_len)}mm × {round(proj + 50)}mm'))
        if sup in ('skirt', 'full'):
            kit_items.append((1, f'Skirt Panel — {round(board_len)}mm × {round(proj + 100)}mm, matches seat board finish'))

        for seq_offset, (qty, note) in enumerate(kit_items):
            BomLine.create({
                'bom_id': bom.id,
                'product_id': frame_product.id,
                'product_qty': qty,
                'length_mm': 0.0,
                'component_type': 'addon',
                'x_notes': note,
                'sequence': SEQ_ADDON + 20 + seq_offset,
            })

        # Assembly summary line (informational)
        if self.window_type == 'bow':
            summary = (
                f'BOW ASSEMBLY — {n} lites, {full_angle:.0f}°/lite, R={round(self.bow_radius_mm)}mm, '
                f'projection={round(proj)}mm, arc={round(self.bay_total_arc_mm)}mm'
            )
        else:
            summary = (
                f'BAY ASSEMBLY — {n} lites @ {full_angle:.0f}°, '
                f'projection={round(proj)}mm, chord={round(self.bay_total_arc_mm)}mm'
            )
        BomLine.create({
            'bom_id': bom.id,
            'product_id': frame_product.id,
            'product_qty': 0,
            'length_mm': 0.0,
            'component_type': 'other',
            'x_notes': summary,
            'sequence': SEQ_ADDON + 30,
        })

    # ══════════════════════════════════════════════════════════════════════
    #  PER-PANE CUT-LIST GENERATION
    # ══════════════════════════════════════════════════════════════════════

    def _generate_pane_bom_lines(self, bom, pane, idx, frame_product):
        """Generate all BOM lines for a single pane."""
        env = self.env
        cfg = pane['config']
        ot = cfg.get('openingType', 'fixed')
        pw = pane['width_mm']
        ph = pane['height_mm']
        pane_label = cfg.get('label') or pane['id']

        # Lookup deduction formula
        formula = self._get_deduction_formula(ot)
        if not formula:
            _logger.warning('BOM: No deduction formula for OT=%s — using fixed defaults', ot)
            formula = self._get_deduction_formula('fixed')
        if not formula:
            _logger.error('BOM: No deduction formula at all — skipping pane %s', pane_label)
            return

        BomLine = env['mrp.bom.line']

        # ── Outer frame pieces (only for perimeter edges) ────────────────
        frame_allowance = 2 * (formula.frame_mitre_allowance_mm + formula.frame_weld_allowance_mm)
        perimeter_sides = []
        if pane['peri_top']:
            perimeter_sides.append(('Top Rail', pw + frame_allowance, 'horizontal'))
        if pane['peri_bottom']:
            perimeter_sides.append(('Bottom Rail', pw + frame_allowance, 'horizontal'))
        if pane['peri_left']:
            perimeter_sides.append(('Left Stile', ph + frame_allowance, 'vertical'))
        if pane['peri_right']:
            perimeter_sides.append(('Right Stile', ph + frame_allowance, 'vertical'))

        for side_name, cut_len, _ in perimeter_sides:
            BomLine.create({
                'bom_id': bom.id,
                'product_id': frame_product.id,
                'product_qty': 1,
                'length_mm': round(cut_len, 1),
                'component_type': 'frame',
                'x_notes': f'{pane_label} — Outer Frame {side_name} — {round(cut_len, 1)}mm',
                'sequence': SEQ_FRAME + idx,
            })

            # Reinforcement for each outer frame piece
            if formula.reinforcement_required:
                reinf_len = formula.get_reinforcement_length(cut_len)
                if reinf_len > 0:
                    reinf_product = self._get_product_variant(formula.reinforcement_product_tmpl_id)
                    if reinf_product:
                        BomLine.create({
                            'bom_id': bom.id,
                            'product_id': reinf_product.id,
                            'product_qty': 1,
                            'length_mm': round(reinf_len, 1),
                            'component_type': 'reinforcement',
                            'x_notes': f'{pane_label} — Reinforcement {side_name} — {round(reinf_len, 1)}mm',
                            'sequence': SEQ_REINFORCEMENT + idx,
                        })

        # ── Sash frame (operable panes only) ─────────────────────────────
        if formula.has_sash:
            sash_cut_h, sash_cut_v = formula.get_sash_cut_lengths(pw, ph)
            sash_product = self._get_product_variant(formula.sash_product_tmpl_id) or frame_product

            for name, cut_len in [('Top Rail', sash_cut_h), ('Bottom Rail', sash_cut_h),
                                   ('Left Stile', sash_cut_v), ('Right Stile', sash_cut_v)]:
                BomLine.create({
                    'bom_id': bom.id,
                    'product_id': sash_product.id,
                    'product_qty': 1,
                    'length_mm': round(cut_len, 1),
                    'component_type': 'sash',
                    'x_notes': f'{pane_label} — Sash {name} — {round(cut_len, 1)}mm',
                    'sequence': SEQ_SASH + idx,
                })

                # Sash reinforcement
                if formula.reinforcement_required:
                    reinf_len = formula.get_reinforcement_length(cut_len)
                    if reinf_len > 0:
                        reinf_product = self._get_product_variant(formula.reinforcement_product_tmpl_id)
                        if reinf_product:
                            BomLine.create({
                                'bom_id': bom.id,
                                'product_id': reinf_product.id,
                                'product_qty': 1,
                                'length_mm': round(reinf_len, 1),
                                'component_type': 'reinforcement',
                                'x_notes': f'{pane_label} — Sash Reinf. {name} — {round(reinf_len, 1)}mm',
                                'sequence': SEQ_REINFORCEMENT + idx,
                            })

        # ── Glass ────────────────────────────────────────────────────────
        glass_w, glass_h = formula.get_glass_size(pw, ph)
        if glass_w > 0 and glass_h > 0:
            self._add_glass_line_for_pane(bom, cfg, glass_w, glass_h, pane_label, idx)

            # ── Glazing beads (4 pieces per glass unit) ──────────────────
            bead_h, bead_v = formula.get_bead_cut_lengths(glass_w, glass_h)
            bead_product = self._get_product_variant(formula.bead_product_tmpl_id)
            if bead_product:
                for name, cut_len in [('Top', bead_h), ('Bottom', bead_h),
                                       ('Left', bead_v), ('Right', bead_v)]:
                    BomLine.create({
                        'bom_id': bom.id,
                        'product_id': bead_product.id,
                        'product_qty': 1,
                        'length_mm': round(cut_len, 1),
                        'component_type': 'bead',
                        'x_notes': f'{pane_label} — Bead {name} — {round(cut_len, 1)}mm',
                        'sequence': SEQ_BEAD + idx,
                    })

            # ── Gaskets ──────────────────────────────────────────────────
            gasket_len = formula.get_gasket_length(glass_w, glass_h)
            gasket_product = self._get_product_variant(formula.gasket_product_tmpl_id)
            if gasket_product and gasket_len > 0:
                BomLine.create({
                    'bom_id': bom.id,
                    'product_id': gasket_product.id,
                    'product_qty': 1,
                    'length_mm': round(gasket_len, 1),
                    'component_type': 'gasket',
                    'x_notes': f'{pane_label} — Gasket (inner+outer) — {round(gasket_len, 1)}mm',
                    'sequence': SEQ_GASKET + idx,
                })

        # ── Weatherseal (operable panes) ─────────────────────────────────
        if formula.has_sash:
            seal_len = formula.get_weatherseal_length(pw, ph)
            seal_product = self._get_product_variant(formula.weatherseal_product_tmpl_id)
            if seal_product and seal_len > 0:
                BomLine.create({
                    'bom_id': bom.id,
                    'product_id': seal_product.id,
                    'product_qty': 1,
                    'length_mm': round(seal_len, 1),
                    'component_type': 'seal',
                    'x_notes': f'{pane_label} — Weatherseal — {round(seal_len, 1)}mm',
                    'sequence': SEQ_SEAL + idx,
                })

        # ── Hardware ─────────────────────────────────────────────────────
        self._add_hardware_lines(bom, cfg, pane_label, idx)

    # ══════════════════════════════════════════════════════════════════════
    #  GLASS LINE (per pane, with real dimensions)
    # ══════════════════════════════════════════════════════════════════════

    def _add_glass_line_for_pane(self, bom, cfg, glass_w, glass_h, pane_label, idx):
        """Add glass BOM line(s) for one pane using actual deducted dimensions."""
        env = self.env

        # Try each glass position (triple glazing has 3 lites)
        added = False
        for pos in (1, 2, 3):
            glass_key = cfg.get(f'glass{pos}Key')
            if not glass_key:
                continue

            glass_cfg = self._find_glass_option(glass_key)
            if not glass_cfg:
                _logger.warning('BOM: No glass option for key "%s"', glass_key)
                continue

            # One inventory product per glass option; the pane's chosen
            # thickness (OT) is recorded in the line note.
            attrs = cfg.get(f'glass{pos}Attrs') or {}
            ot_val = str(attrs.get('_ot') or glass_cfg.thickness)
            notes = f'{ot_val}mm'
            variant = glass_cfg.product_id
            if not variant:
                _logger.warning('BOM: Glass option "%s" has no inventory product', glass_key)
                continue

            glass_area_m2 = (glass_w / 1000.0) * (glass_h / 1000.0)
            env['mrp.bom.line'].create({
                'bom_id': bom.id,
                'product_id': variant.id,
                'product_qty': round(glass_area_m2, 4),
                'length_mm': round(glass_w, 1),
                'width_mm': round(glass_h, 1),
                'component_type': 'glass',
                'x_notes': f'{pane_label} — Glass L{pos}: {glass_cfg.name} ({notes}) — '
                           f'{round(glass_w, 1)}×{round(glass_h, 1)}mm ({round(glass_area_m2, 3)}m²)',
                'sequence': SEQ_GLASS + idx,
            })
            added = True

        # Backward compat: single glassSpec
        if not added:
            glass_key = cfg.get('glassSpec') or cfg.get('glass_key')
            glass_cfg = self._find_glass_option(glass_key) if glass_key else None
            variant = glass_cfg.product_id if glass_cfg else None
            if variant:
                glass_area_m2 = (glass_w / 1000.0) * (glass_h / 1000.0)
                env['mrp.bom.line'].create({
                    'bom_id': bom.id,
                    'product_id': variant.id,
                    'product_qty': round(glass_area_m2, 4),
                    'length_mm': round(glass_w, 1),
                    'width_mm': round(glass_h, 1),
                    'component_type': 'glass',
                    'x_notes': f'{pane_label} — Glass: {glass_cfg.name} — '
                               f'{round(glass_w, 1)}×{round(glass_h, 1)}mm',
                    'sequence': SEQ_GLASS + idx,
                })

    def _find_glass_option(self, glass_key):
        """Glass Option (wincraft.glass.lite) for a pane-config glass key."""
        return self.env['wincraft.glass.lite'].search([
            ('active', '=', True),
            '|', ('external_code', '=', glass_key), ('part_name', '=', glass_key),
        ], limit=1)

    # ══════════════════════════════════════════════════════════════════════
    #  HARDWARE LINES (per pane from hardwareSelections)
    # ══════════════════════════════════════════════════════════════════════

    def _add_hardware_lines(self, bom, cfg, pane_label, idx):
        """Add hardware BOM lines from pane config hardwareSelections.

        Only hardware records with an Inventory Product (product_tmpl_id)
        linked produce a real BOM line — resolved to that template's first
        variant, at the standard install quantity for the role/opening type
        (_hardware_qty(), the same heuristic wincraft.window._compute_unit_price
        uses for pricing). Hardware with no linked product is still priced on
        the quote but logged and skipped here — link a product on the
        Hardware record (Configuration → Hardware) so production actually
        pulls stock for it.
        """
        env = self.env
        hw_sel = cfg.get('hardwareSelections', {})
        if not isinstance(hw_sel, dict):
            return

        ot = cfg.get('openingType', 'fixed')
        for role, hw_id in hw_sel.items():
            if not hw_id:
                continue
            try:
                hw_id = int(hw_id)
            except (ValueError, TypeError):
                continue

            hw_rec = env['wincraft.hardware'].browse(hw_id)
            if not hw_rec.exists():
                continue

            if not hw_rec.product_tmpl_id:
                _logger.warning(
                    'BOM: Hardware "%s" (%s) on pane %s has no Inventory Product '
                    'linked — priced on the quote but no BOM line generated.',
                    hw_rec.name, role, pane_label,
                )
                continue

            variant = hw_rec.product_tmpl_id.product_variant_ids[:1]
            if not variant:
                continue

            qty = self._hardware_qty(role, ot)
            env['mrp.bom.line'].create({
                'bom_id': bom.id,
                'product_id': variant.id,
                'product_qty': qty,
                'component_type': 'hardware',
                'x_notes': f'{pane_label} — Hardware ({role}): {hw_rec.name} × {qty}',
                'sequence': SEQ_HARDWARE + idx,
            })

    def _add_window_hardware_lines(self, bom):
        """Add BOM lines for whole-window hardware_ids (e.g. trickle vent, sill).

        Unlike per-pane hardwareSelections (resolved per opening in
        _add_hardware_lines), these aren't tied to a specific pane, so each
        selected item adds one qty-1 BOM line. Same product-link requirement
        and skip-with-warning behaviour as the per-pane case.
        """
        BomLine = self.env['mrp.bom.line']
        for seq_offset, hw_rec in enumerate(self.hardware_ids):
            if not hw_rec.product_tmpl_id:
                _logger.warning(
                    'BOM: Hardware "%s" (window-level) has no Inventory Product '
                    'linked — priced on the quote but no BOM line generated.',
                    hw_rec.name,
                )
                continue
            variant = hw_rec.product_tmpl_id.product_variant_ids[:1]
            if not variant:
                continue
            BomLine.create({
                'bom_id': bom.id,
                'product_id': variant.id,
                'product_qty': 1,
                'component_type': 'hardware',
                'x_notes': f'Window-level hardware: {hw_rec.name}',
                'sequence': SEQ_HARDWARE + 50 + seq_offset,
            })

    def _hardware_qty(self, role, opening_type):
        """Return the standard quantity for a hardware role given an opening type."""
        if role == 'hinge':
            if opening_type in ('casement-l', 'casement-r', 'awning', 'hopper'):
                return 3  # typical: 2 hinges + 1 friction stay
            if opening_type == 'tiltturn':
                return 2
            if opening_type in ('bifold',):
                return 2
            return 2
        if role == 'handle':
            return 1
        if role == 'lock':
            if opening_type in ('sliding', 'lift-slide'):
                return 2  # top + bottom locks
            return 1
        if role == 'track':
            return 1
        if role == 'balance':
            return 2  # pair of spring balances for hung windows
        return 1

    # ══════════════════════════════════════════════════════════════════════
    #  MULLION / TRANSOM LINES
    # ══════════════════════════════════════════════════════════════════════

    def _add_mullion_lines(self, bom, panes, frame_product):
        """Add mullion/transom bar lines based on pane layout."""
        if len(panes) <= 1:
            return

        env = self.env
        W = float(self.width_mm)
        H = float(self.height_mm)

        # Detect dividers from pane boundaries
        vertical_dividers = set()
        horizontal_dividers = set()

        for pane in panes:
            x_right = pane['x'] + pane['width_mm']
            y_bottom = pane['y'] + pane['height_mm']
            if not pane['peri_right'] and x_right < W - 1:
                vertical_dividers.add(round(x_right, 1))
            if not pane['peri_bottom'] and y_bottom < H - 1:
                horizontal_dividers.add(round(y_bottom, 1))

        formula = self._get_deduction_formula(
            self._dominant_opening_type()
        )
        allowance = 0
        if formula:
            allowance = 2 * (formula.frame_mitre_allowance_mm + formula.frame_weld_allowance_mm)

        for pos in sorted(vertical_dividers):
            cut_len = H + allowance
            env['mrp.bom.line'].create({
                'bom_id': bom.id,
                'product_id': frame_product.id,
                'product_qty': 1,
                'length_mm': round(cut_len, 1),
                'component_type': 'mullion',
                'x_notes': f'Mullion (vertical) at {round(pos, 1)}mm — {round(cut_len, 1)}mm',
                'sequence': SEQ_MULLION,
            })

        for pos in sorted(horizontal_dividers):
            cut_len = W + allowance
            env['mrp.bom.line'].create({
                'bom_id': bom.id,
                'product_id': frame_product.id,
                'product_qty': 1,
                'length_mm': round(cut_len, 1),
                'component_type': 'mullion',
                'x_notes': f'Transom (horizontal) at {round(pos, 1)}mm — {round(cut_len, 1)}mm',
                'sequence': SEQ_MULLION,
            })

    # ══════════════════════════════════════════════════════════════════════
    #  SPACER LINE (per pane, with actual perimeter)
    # ══════════════════════════════════════════════════════════════════════

    def _add_spacer_bom_line(self, bom, panes):
        """Add spacer product lines based on actual glass perimeters."""
        self.ensure_one()
        env = self.env

        spacer_config = self.default_spacer_config_id
        if not spacer_config:
            spacer_config = env['wincraft.spacer.config'].search([
                ('is_default', '=', True), ('active', '=', True),
            ], limit=1)
        if not spacer_config:
            return

        spacer_variant = spacer_config.product_tmpl_id.product_variant_ids[:1]
        if not spacer_variant:
            return

        for pane in panes:
            cfg = pane['config']
            ot = cfg.get('openingType', 'fixed')
            formula = self._get_deduction_formula(ot)
            if not formula:
                continue
            glass_w, glass_h = formula.get_glass_size(pane['width_mm'], pane['height_mm'])
            if glass_w <= 0 or glass_h <= 0:
                continue

            glazing_type = cfg.get('glazingType', 'double')
            cavity_count = {'single': 0, 'double': 1, 'triple': 2}.get(glazing_type, 1)
            if cavity_count == 0:
                continue

            perimeter_mm = 2 * (glass_w + glass_h)
            total_spacer = perimeter_mm * cavity_count
            pane_label = cfg.get('label') or pane['id']

            env['mrp.bom.line'].create({
                'bom_id': bom.id,
                'product_id': spacer_variant.id,
                'product_qty': 1,
                'length_mm': round(total_spacer, 1),
                'component_type': 'spacer',
                'x_notes': f'{pane_label} — Spacer: {spacer_config.label} — '
                           f'{round(total_spacer, 1)}mm ({cavity_count} cavity)',
                'sequence': SEQ_SPACER,
            })

    # ══════════════════════════════════════════════════════════════════════
    #  ADD-ON LINES
    # ══════════════════════════════════════════════════════════════════════

    def _add_addon_lines(self, bom):
        """Add BOM lines for window-level add-ons (addon_ids).

        Only add-ons with an Inventory Product (product_tmpl_id) linked
        produce a real qty-1 BOM line. An add-on with no linked product is
        still priced on the quote but logged and skipped here — link a
        product on the Add-on record (Configuration → Add-ons) so production
        actually pulls stock for it.
        """
        BomLine = self.env['mrp.bom.line']
        for seq_offset, addon in enumerate(self.addon_ids):
            if not addon.product_tmpl_id:
                _logger.warning(
                    'BOM: Add-on "%s" has no Inventory Product linked — '
                    'priced on the quote but no BOM line generated.', addon.name,
                )
                continue
            variant = addon.product_tmpl_id.product_variant_ids[:1]
            if not variant:
                continue
            BomLine.create({
                'bom_id': bom.id,
                'product_id': variant.id,
                'product_qty': 1,
                'component_type': 'addon',
                'x_notes': f'Add-on: {addon.name}',
                'sequence': SEQ_ADDON + seq_offset,
            })

    # ══════════════════════════════════════════════════════════════════════
    #  FRAME PAINT LINES (Inside / Outside, from inventory)
    # ══════════════════════════════════════════════════════════════════════

    def _add_paint_lines(self, bom):
        """Add frame paint product line(s) consumed by this window.

        Consumption follows the same convention as the legacy CSV order
        pipeline's frame-paint formula: perimeter proxy (Width + Height, in
        inches) × the paint product's Paint Consumption/inch rate × its
        Paint Layers (coat count). Inside and Outside are combined into one
        line when the same paint product is used on both faces.
        """
        self.ensure_one()
        sides = (
            ('inside', self.inside_paint_product_id),
            ('outside', self.outside_paint_product_id),
        )
        if not any(product for _side, product in sides):
            return

        perimeter_in = (float(self.width_mm) + float(self.height_mm)) / 25.4
        by_product = {}
        for side, product in sides:
            if not product:
                continue
            tmpl = product.product_tmpl_id
            per_inch = tmpl.x_paint_consumption_per_inch or 1.0
            layers = tmpl.x_paint_layers or 1
            entry = by_product.setdefault(product.id, {'product': product, 'qty': 0.0, 'sides': []})
            entry['qty'] += perimeter_in * per_inch * layers
            entry['sides'].append(side)

        BomLine = self.env['mrp.bom.line']
        for seq_offset, entry in enumerate(by_product.values()):
            BomLine.create({
                'bom_id': bom.id,
                'product_id': entry['product'].id,
                'product_qty': round(entry['qty'], 4),
                'component_type': 'paint',
                'x_notes': f"Frame paint — {'/'.join(entry['sides'])} ({entry['product'].name})",
                'sequence': SEQ_PAINT + seq_offset,
            })

    # ══════════════════════════════════════════════════════════════════════
    #  DEDUCTION FORMULA LOOKUP
    # ══════════════════════════════════════════════════════════════════════

    def _get_deduction_formula(self, opening_type):
        """Find the deduction formula for the given opening type + current profile type.

        Falls back to: specific OT + specific profile → specific OT + no profile → 'fixed' fallback.
        """
        Formula = self.env['wincraft.deduction.formula']
        ps_id = self.profile_type_id.id if self.profile_type_id else False

        # 1. Exact match: opening_type + profile_type
        if ps_id:
            formula = Formula.search([
                ('opening_type', '=', opening_type),
                ('profile_type_id', '=', ps_id),
                ('active', '=', True),
            ], limit=1)
            if formula:
                return formula

        # 2. Fallback: opening_type + no profile
        formula = Formula.search([
            ('opening_type', '=', opening_type),
            ('profile_type_id', '=', False),
            ('active', '=', True),
        ], limit=1)
        if formula:
            return formula

        # 3. Ultimate fallback: fixed type
        if opening_type != 'fixed':
            return self._get_deduction_formula('fixed')

        return None

    # ══════════════════════════════════════════════════════════════════════
    #  KEPT HELPERS (variant resolution, BOM find/create)
    # ══════════════════════════════════════════════════════════════════════

    def _resolve_frame_variant(self, frame_tmpl):
        """Resolve the frame product variant from attributes or color."""
        frame_attrs = self.frame_attrs or {}
        if frame_attrs:
            attr_value_ids = sorted(int(v) for v in frame_attrs.values() if v)
            if attr_value_ids:
                variant = self._find_variant_by_attr_values(frame_tmpl, attr_value_ids)
                if variant:
                    return variant
                _logger.warning('BOM: No variant for frame %s with attrs %s — using first.',
                                frame_tmpl.name, attr_value_ids)
            return frame_tmpl.product_variant_ids[:1]

        return self._resolve_color_variant(
            frame_tmpl,
            self.inside_color_attr_val_id,
            self.outside_color_attr_val_id,
        )

    def _dominant_opening_type(self):
        """Return the most-used non-fixed opening type across all panes."""
        self.ensure_one()
        counts = {}

        pane_configs = self._parse_json_field(self.pane_configs) or []
        for pc in pane_configs:
            ot = pc.get('openingType') if isinstance(pc, dict) else None
            if ot:
                counts[ot] = counts.get(ot, 0) + 1

        if not counts:
            tree = self._parse_json_field(self.panel_tree)
            if tree:
                self._count_ot_in_tree(tree, counts)

        if not counts:
            return _window_type_to_ot(self.window_type)

        non_fixed = {k: v for k, v in counts.items() if k != 'fixed'}
        if non_fixed:
            return max(non_fixed, key=non_fixed.get)
        return max(counts, key=counts.get)

    def _count_ot_in_tree(self, node, counts):
        """Recursively walk panel_tree JSON and count openingType leaf values."""
        if not isinstance(node, dict):
            return
        if node.get('type') == 'leaf':
            cfg = node.get('config', {})
            ot = cfg.get('openingType') if isinstance(cfg, dict) else None
            if ot:
                counts[ot] = counts.get(ot, 0) + 1
        else:
            self._count_ot_in_tree(node.get('first'), counts)
            self._count_ot_in_tree(node.get('second'), counts)

    def _resolve_color_variant(self, product_tmpl, inside_val, outside_val):
        """Find the product.product variant matching the given color attribute values."""
        self.ensure_one()
        if not product_tmpl:
            return self.env['product.product']

        variants = product_tmpl.product_variant_ids
        if not variants:
            raise UserError(_(
                'Frame product "%s" has no variants. '
                'Please configure at least one variant.'
            ) % product_tmpl.name)

        if not inside_val and not outside_val:
            return variants[:1]

        wanted_ids = set()
        if inside_val:
            wanted_ids.add(inside_val.id)
        if outside_val:
            wanted_ids.add(outside_val.id)

        for variant in variants:
            val_ids = set(variant.product_template_attribute_value_ids.mapped(
                'product_attribute_value_id.id'
            ))
            if wanted_ids <= val_ids:
                return variant

        _logger.warning('BOM: No variant for inside=%s outside=%s on %s — using first.',
                        inside_val, outside_val, product_tmpl.name)
        return variants[:1]

    def _find_or_create_bom(self, frame_product):
        """Find an existing custom BOM for frame_product or create a new one."""
        self.ensure_one()
        BOM = self.env['mrp.bom']

        if self.bom_id and self.bom_id.product_id == frame_product:
            self.bom_id.bom_line_ids.unlink()
            return self.bom_id

        existing = BOM.search([
            ('product_id', '=', frame_product.id),
            ('is_custom', '=', True),
        ], limit=1)
        if existing:
            existing.bom_line_ids.unlink()
            return existing

        bom = BOM.create({
            'product_tmpl_id': frame_product.product_tmpl_id.id,
            'product_id': frame_product.id,
            'product_qty': 1.0,
            'type': 'normal',
            'is_custom': True,
            'code': f'WC-{self.project_id.ref or "PRJ"}-W{self.id}',
        })
        _logger.info('BOM: Created BOM %s for window %s', bom.id, self.id)
        return bom

    def _find_variant_by_attr_values(self, tmpl, attr_value_ids):
        """Find product variant matching the exact set of attribute value IDs."""
        target_set = set(attr_value_ids)
        for variant in tmpl.product_variant_ids:
            variant_val_ids = set(
                variant.product_template_attribute_value_ids.mapped(
                    'product_attribute_value_id'
                ).ids
            )
            if variant_val_ids == target_set:
                return variant
        return None

    def _get_product_variant(self, product_tmpl):
        """Get the first variant of a product template, or None."""
        if not product_tmpl:
            return None
        variants = product_tmpl.product_variant_ids
        return variants[:1] if variants else None

    @staticmethod
    def _parse_json_field(value):
        """Safely parse a JSON field that might be a string, dict, list, or None."""
        if value is None:
            return None
        if isinstance(value, (dict, list)):
            return value
        if isinstance(value, str):
            try:
                return json.loads(value)
            except (ValueError, TypeError):
                return None
        return None


def _window_type_to_ot(window_type):
    """Map a wincraft.window window_type to the equivalent canvas opening type string."""
    mapping = {
        'casement':       'casement-l',
        'sliding':        'sliding',
        'fixed':          'fixed',
        'bifold':         'bifold',
        'awning':         'awning',
        'tilt_turn':      'tiltturn',
        'single_hung':    'single-hung',
        'double_hung':    'double-hung',
        'single_slider':  'sliding',
        'double_slider':  'sliding',
        'end_vent_slider': 'sliding',
        'fixed_casement': 'fixed',
        'bay': 'casement-l',
        'bow': 'fixed',
    }
    return mapping.get(window_type, 'fixed')
