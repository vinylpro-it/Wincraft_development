# -*- coding: utf-8 -*-
"""
WinCraft Studio — Window model.
Represents one configured window within a project.
Holds all dimensional, material, glass, hardware, and pricing data.
"""
import logging
import math

from markupsafe import Markup

from odoo import models, fields, api, _
from odoo.exceptions import ValidationError

_logger = logging.getLogger(__name__)


def _get_arch_rise_mm(frame_shape, width_mm, height_mm):
    """Rise of an 'arched'/'gothic' frame in mm — the vertical distance
    from the springline up to the peak. Mirrors window_svg.js / the JS
    getArchRise() in frame_shape_geometry.js (kept in sync by hand across
    Python/JS); the single source of truth for this formula on the
    Python side, used by both _frame_shape_boundary_mm and the
    shape/operability constraint below.
    """
    if frame_shape == 'arched':
        return min(width_mm / 2.0, height_mm * 0.35)
    if frame_shape == 'gothic':
        return height_mm * 0.35
    return 0.0


def _quadratic_bezier_points(p0, p1, p2, n):
    """Sample n+1 points along a quadratic Bezier curve p0 -> p1 (control) -> p2."""
    pts = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        pts.append((
            mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
            mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
        ))
    return pts


def _frame_shape_boundary_mm(frame_shape, width_mm, height_mm, frame_shape_points=None, samples=72):
    """Ordered (x, y) mm points tracing the frame outline for `frame_shape`.

    Mirrors the SVG paths drawn by frame() in window_svg.js (and its JS
    twin frame_shape_geometry.js) so area/perimeter on the canvas, the
    live BOM panel, and the saved BOM/quotation all agree on the same
    shape — a circular frame must price and cut as a circle, not its
    bounding rectangle.
    """
    w, h = float(width_mm), float(height_mm)

    if frame_shape == 'circle':
        r = min(w, h) / 2.0
        cx, cy = w / 2.0, h / 2.0
        return [
            (cx + r * math.cos(2 * math.pi * i / samples), cy + r * math.sin(2 * math.pi * i / samples))
            for i in range(samples)
        ]

    if frame_shape == 'half_circle':
        r = w / 2.0
        n = max(8, samples // 2)
        arc = [
            (r - r * math.cos(math.pi * i / n), r - r * math.sin(math.pi * i / n))
            for i in range(n + 1)
        ]
        return arc + [(w, h), (0, h)]

    if frame_shape == 'arched':
        arch_r = _get_arch_rise_mm('arched', w, h)
        n = max(4, samples // 4)
        curve = (
            _quadratic_bezier_points((0, arch_r), (0, 0), (w / 2.0, 0), n)
            + _quadratic_bezier_points((w / 2.0, 0), (w, 0), (w, arch_r), n)[1:]
        )
        return [(0, h)] + curve + [(w, h)]

    if frame_shape == 'gothic':
        cp = w * 0.15
        peak_h = _get_arch_rise_mm('gothic', w, h)
        n = max(4, samples // 4)
        curve = (
            _quadratic_bezier_points((0, peak_h), (cp, 0), (w / 2.0, 0), n)
            + _quadratic_bezier_points((w / 2.0, 0), (w - cp, 0), (w, peak_h), n)[1:]
        )
        return [(0, h)] + curve + [(w, h)]

    if frame_shape == 'triangle':
        return [(w / 2.0, 0), (0, h), (w, h)]

    if frame_shape == 'trapezoid':
        inset = w * 0.15
        return [(inset, 0), (w - inset, 0), (w, h), (0, h)]

    if frame_shape == 'rake':
        rake_h = h * 0.25
        return [(0, rake_h), (w, 0), (w, h), (0, h)]

    if frame_shape == 'octagon':
        cut = min(w, h) * 0.29
        return [
            (cut, 0), (w - cut, 0), (w, cut), (w, h - cut),
            (w - cut, h), (cut, h), (0, h - cut), (0, cut),
        ]

    if frame_shape == 'custom' and frame_shape_points and len(frame_shape_points) >= 3:
        return [(p['x'] * w, p['y'] * h) for p in frame_shape_points]

    # rectangular / fallback / custom-without-points
    return [(0, 0), (w, 0), (w, h), (0, h)]


def _polygon_area_perimeter_mm(points_mm):
    """Shoelace area + summed-edge perimeter for a closed polygon (mm in, mm/mm² out)."""
    n = len(points_mm)
    if n < 3:
        return 0.0, 0.0
    area = 0.0
    perimeter = 0.0
    for i in range(n):
        x1, y1 = points_mm[i]
        x2, y2 = points_mm[(i + 1) % n]
        area += x1 * y2 - x2 * y1
        perimeter += math.hypot(x2 - x1, y2 - y1)
    return abs(area) / 2.0, perimeter


def _shape_area_perimeter_mm(frame_shape, width_mm, height_mm, frame_shape_points=None):
    """Exact area (mm²) + perimeter (mm) for the frame outline.

    'circle' and 'half_circle' have simple closed-form formulas, so those
    are computed directly rather than through polygon sampling (avoids the
    small discretisation error a sampled circle would otherwise carry into
    pricing and cut lists). Straight-edge shapes (triangle, trapezoid,
    rake, octagon, custom) are already exact polygons, so the shoelace
    formula over their vertices has no approximation error either. Only
    the Bezier-curved tops (arched, gothic) are sampled, since they have
    no simple closed form.
    """
    w, h = float(width_mm), float(height_mm)

    if frame_shape == 'circle':
        r = min(w, h) / 2.0
        return math.pi * r * r, 2 * math.pi * r

    if frame_shape == 'half_circle':
        r = w / 2.0
        body_h = max(0.0, h - r)
        area = w * body_h + (math.pi * r * r) / 2.0
        perimeter = w + 2 * body_h + math.pi * r
        return area, perimeter

    pts = _frame_shape_boundary_mm(frame_shape, w, h, frame_shape_points)
    return _polygon_area_perimeter_mm(pts)


def _inset_points_toward_centroid(points, inset):
    """Shrink a closed point list toward its own centroid by `inset` units.

    Mirrors insetBoundaryTowardCentroid() in frame_shape_geometry.js — exact
    for a circle, a reasonable visual approximation for other star-convex
    outlines. Used to derive an inner profile/glass line from the outer
    frame outline without a separate inset formula per shape.
    """
    n = len(points)
    if n == 0:
        return points
    cx = sum(p[0] for p in points) / n
    cy = sum(p[1] for p in points) / n
    result = []
    for x, y in points:
        dx, dy = x - cx, y - cy
        dist = math.hypot(dx, dy) or 1.0
        scale = max(0.0, (dist - inset) / dist)
        result.append((cx + dx * scale, cy + dy * scale))
    return result


def _darken_hex_colour(hex_colour, factor=0.7):
    """Darken a '#rrggbb' colour by `factor` (0-1, lower = darker)."""
    hex_colour = (hex_colour or '#d8d3c8').lstrip('#')
    if len(hex_colour) != 6:
        hex_colour = 'd8d3c8'
    r, g, b = (int(hex_colour[i:i + 2], 16) for i in (0, 2, 4))
    return '#%02x%02x%02x' % (int(r * factor), int(g * factor), int(b * factor))


# Supplier glass prices are per square foot; window areas are in m².
SQFT_PER_M2 = 10.7639

OPENING_DIRECTION_SELECTION = [
    ('left_right', 'Left / Right'),
    ('top_hung', 'Top Hung'),
    ('bottom_hung', 'Bottom Hung'),
    ('fixed', 'Fixed'),
    ('tilt_turn', 'Tilt & Turn'),
]

# frame_shape values whose outline is curved or pointed (not a plain rectangle
# or an arbitrary user-drawn custom polygon). A single pane in one of these
# shapes can only be Fixed glazing — see _check_shape_operability below.
CURVED_FRAME_SHAPES = {
    'arched', 'gothic', 'circle', 'half_circle',
    'triangle', 'trapezoid', 'rake', 'octagon',
}


class WincraftWindow(models.Model):
    """One configured window in a WinCraft project."""

    _name = 'wincraft.window'
    _description = 'WinCraft Window'
    _order = 'project_id, sequence, id'
    _rec_name = 'name'

    # ------------------------------------------------------------------
    # Identification
    # ------------------------------------------------------------------

    project_id = fields.Many2one(
        comodel_name='wincraft.project',
        string='Project',
        required=True,
        ondelete='cascade',
        index=True,
    )
    sequence = fields.Integer(
        string='Sequence',
        default=10,
        help='Ordering within the project.',
    )
    barcode = fields.Char(
        string='Barcode',
        copy=False,
        index='btree_not_null',
        help='Unique barcode for scanning on the fabrication line.',
    )
    name = fields.Char(
        string='Window Name',
        compute='_compute_name',
        store=True,
        readonly=False,
        help='Auto-generated as "Type WxH" but can be overridden.',
    )
    source_template_id = fields.Many2one(
        comodel_name='wincraft.window.template',
        string='Created From Template',
        ondelete='set null',
        readonly=True,
    )

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------

    window_type = fields.Selection(
        selection=lambda self: self.env['wincraft.window.type']._selection_window_type(),
        string='Window Type',
        required=True,
        default='casement',
    )
    frame_shape = fields.Selection(
        selection=[
            ('rectangular', 'Rectangular'),
            ('arched', 'Arched Top'),
            ('gothic', 'Gothic Arch'),
            ('circle', 'Full Circle'),
            ('half_circle', 'Half Circle'),
            ('triangle', 'Triangle'),
            ('trapezoid', 'Trapezoid'),
            ('rake', 'Rake (Angled Top)'),
            ('octagon', 'Octagon'),
            ('custom', 'Custom Outline'),
        ],
        string='Frame Shape',
        default='rectangular',
        help='Non-rectangular frame shape. Custom outline uses frame_shape_points JSON.',
    )
    frame_shape_points = fields.Json(
        string='Custom Shape Points',
        help='JSON array of {x, y} normalised coordinates (0..1) for custom outline.',
    )
    width_mm = fields.Integer(
        string='Width (mm)',
        required=True,
        default=1200,
    )
    height_mm = fields.Integer(
        string='Height (mm)',
        required=True,
        default=1000,
    )

    # ── Rough Opening ──
    ro_delta_w = fields.Integer(
        string='RO Delta Width (mm)',
        default=13,
        help='Gap added to each side of the window for the rough opening (default 13 mm ≈ ½").',
    )
    ro_delta_h = fields.Integer(
        string='RO Delta Height (mm)',
        default=13,
        help='Gap added to top/bottom of the window for the rough opening (default 13 mm ≈ ½").',
    )
    rough_opening_w = fields.Integer(
        string='Rough Opening Width (mm)',
        compute='_compute_rough_opening',
        store=True,
        help='Width + 2 × RO delta width.',
    )
    rough_opening_h = fields.Integer(
        string='Rough Opening Height (mm)',
        compute='_compute_rough_opening',
        store=True,
        help='Height + 2 × RO delta height.',
    )

    # ── Energy Star ──
    energy_star_zone = fields.Selection(
        selection=[
            ('none', 'Not Rated'),
            ('zone_a', 'Zone A'),
            ('zone_b', 'Zone B'),
            ('zone_c', 'Zone C'),
            ('zone_d', 'Zone D'),
        ],
        string='Energy Star Zone',
        default='none',
    )
    er_value = fields.Float(
        string='ER Value',
        digits=(6, 2),
        help='Energy Rating value (NRCan). Higher is better.',
    )
    u_factor = fields.Float(
        string='U-Factor',
        digits=(6, 3),
        help='U-factor (W/m²·K). Lower is better.',
    )
    shgc = fields.Float(
        string='SHGC',
        digits=(6, 3),
        help='Solar Heat Gain Coefficient (0–1). Lower blocks more solar heat.',
    )

    # ── United Inches (Canadian pricing) ──
    united_inches = fields.Float(
        string='United Inches',
        digits=(8, 2),
        compute='_compute_united_inches',
        store=True,
        help='Width (in) + Height (in). Used for tier-based pricing.',
    )

    # ──────────────────────────────────────────────────────────────────
    # Bay & Bow Window Geometry
    # Industry-standard angled / radial multi-lite assemblies.
    # All projection / chord / arc maths derived from these inputs.
    # Used by:
    #   - SVG renderer (elevation + plan view)
    #   - BOM builder (mulling posts, head/seat boards, support kit)
    #   - Quote / cut-list reports
    # ──────────────────────────────────────────────────────────────────
    bay_angle = fields.Selection(
        selection=[
            ('30', '30° Splay'),
            ('45', '45° Splay'),
            ('90', '90° Box'),
            ('custom', 'Custom Angle'),
        ],
        string='Bay Angle',
        default='45',
        help='Angle between the centre lite and each flanker. '
             '30° = shallow, 45° = standard residential, 90° = box bay.',
    )
    bay_angle_custom_deg = fields.Float(
        string='Custom Bay Angle (°)',
        default=45.0,
        help='Used when Bay Angle = Custom. Valid range 15–120°.',
    )
    bow_angle_deg = fields.Selection(
        selection=[
            ('5', '5° per Lite'),
            ('10', '10° per Lite'),
            ('15', '15° per Lite'),
            ('20', '20° per Lite'),
            ('custom', 'Custom Angle'),
        ],
        string='Bow Angle',
        default='10',
        help='Angle each lite spans on the arc relative to its neighbour. '
             'Bow only — larger = a deeper, more pronounced curve.',
    )
    bow_angle_custom_deg = fields.Float(
        string='Custom Bow Angle (° per Lite)',
        default=10.0,
        help='Used when Bow Angle = Custom. Valid range 3–30° per lite.',
    )
    bay_lite_count = fields.Integer(
        string='Number of Lites',
        default=3,
        help='Number of vertical lites. Bay: 3 (typical). Bow: 4–8 (typical 5).',
    )
    bay_centre_ratio = fields.Float(
        string='Centre Lite Ratio',
        default=0.50,
        digits=(4, 3),
        help='Bay only — fraction of total chord width occupied by the centre lite '
             '(0.50 = centre is half the chord). Flankers split the remainder equally.',
    )
    bay_lite_widths = fields.Json(
        string='Custom Lite Chord Widths (mm)',
        help='Optional array of per-lite chord widths in mm, e.g. [600, 1200, 600]. '
             'When length matches bay_lite_count, overrides equal-split / centre-ratio. '
             'Leave empty to use computed defaults.',
    )
    bow_radius_mm = fields.Float(
        string='Bow Radius (mm)',
        compute='_compute_bay_geometry',
        store=True,
        digits=(10, 1),
        help='Bow only — radius of the arc on which the lite chords sit, '
             'derived from total chord width and lite count.',
    )
    projection_depth_mm = fields.Float(
        string='Projection Depth (mm)',
        compute='_compute_bay_geometry',
        store=True,
        digits=(10, 1),
        help='Distance the assembly projects out from the wall plane.',
    )
    bay_lite_chord_mm = fields.Float(
        string='Single Lite Chord (mm)',
        compute='_compute_bay_geometry',
        store=True,
        digits=(10, 1),
        help='Chord width of one flanker / bow lite in plan view.',
    )
    bay_total_arc_mm = fields.Float(
        string='Total Arc / Chord (mm)',
        compute='_compute_bay_geometry',
        store=True,
        digits=(10, 1),
        help='Sum of all lite chords (= unfolded width along the splay/arc).',
    )

    # ── Insulated head & seat boards (CSA A440 typical: 19 mm ply + R-12) ──
    head_board_depth_mm = fields.Integer(
        string='Head Board Depth (mm)',
        default=300,
        help='Front-to-back dimension of the insulated head board. Default 300 mm '
             '(≈ 12") covers projection up to ~280 mm with 20 mm overhang.',
    )
    head_board_thickness_mm = fields.Integer(
        string='Head Board Thickness (mm)',
        default=19,
        help='Plywood thickness for the head board. CSA A440 standard 19 mm (¾").',
    )
    seat_board_depth_mm = fields.Integer(
        string='Seat Board Depth (mm)',
        default=300,
        help='Front-to-back dimension of the insulated seat board.',
    )
    seat_board_thickness_mm = fields.Integer(
        string='Seat Board Thickness (mm)',
        default=19,
        help='Plywood thickness for the seat board.',
    )
    insulated_boards = fields.Boolean(
        string='Insulated Head/Seat Boards',
        default=True,
        help='Add R-12 fibreglass batt insulation between board layers '
             '(required for Energy Star Canada Zone B/C/D bays).',
    )
    seat_board_finish = fields.Selection(
        selection=[
            ('oak_veneer', 'Oak Veneer'),
            ('maple_veneer', 'Maple Veneer'),
            ('white_melamine', 'White Melamine'),
            ('paint_grade', 'Paint Grade'),
            ('none', 'None / Site-Finished'),
        ],
        string='Seat Board Finish',
        default='oak_veneer',
    )

    # ── Mulling post (angled jamb between lites) ──
    mulling_post_width_mm = fields.Integer(
        string='Mulling Post Width (mm)',
        default=70,
        help='Width of the structural mulling post between adjacent lites.',
    )

    # ── Support system ──
    bay_support_system = fields.Selection(
        selection=[
            ('none', 'None (Self-Supporting ≤ 200 mm projection)'),
            ('cable', 'Cable Support Kit'),
            ('knee_brace', 'Knee Braces'),
            ('cable_and_knee', 'Cable + Knee Brace Combo'),
            ('hip_roof', 'Hip Roof / Cap'),
            ('skirt', 'Skirt Below Seat Board'),
            ('full', 'Hip Roof + Skirt + Cables'),
        ],
        string='Support System',
        default='cable',
        help='Structural support recommended for the projection depth and weight. '
             'Cables required when projection > 200 mm; knee braces when > 350 mm.',
    )

    panels = fields.Integer(
        string='Total Panels',
        compute='_compute_panels',
        store=True,
        help='Computed as panels_horizontal × panels_vertical.',
    )
    panels_horizontal = fields.Integer(
        string='Horizontal Panels',
        default=1,
        help='Number of vertical dividers + 1.',
    )
    panels_vertical = fields.Integer(
        string='Vertical Panels',
        default=1,
        help='Number of horizontal dividers + 1.',
    )
    margin_pct = fields.Float(
        string='Margin %',
        default=20.0,
        digits=(6, 2),
        help='Profit margin percentage applied to this window.',
    )
    frame_material_id = fields.Many2one(
        comodel_name='wincraft.material',
        string='Frame Material',
        ondelete='restrict',
        default=lambda self: self._default_catalog_record(
            'wincraft_studio.mat_upvc_white', 'wincraft.material',
        ),
    )
    profile_type_id = fields.Many2one(
        comodel_name='wincraft.window.type.series',
        string='Profile Type',
        ondelete='set null',
        help='Profile Type (e.g. Classic 70, Prestige 90). Drives BOM, '
             'deductions, frame configs and design rules.',
        default=lambda self: self._default_catalog_record(
            'wincraft_studio.profile_upvc_classic', 'wincraft.window.type.series',
        ),
    )
    glass_type_id = fields.Many2one(
        comodel_name='wincraft.glass.type',
        string='Glass Type',
        ondelete='restrict',
        default=lambda self: self._default_catalog_record(
            'wincraft_studio.glass_double_24mm', 'wincraft.glass.type',
        ),
    )
    glass_in_lite_id = fields.Many2one(
        comodel_name='wincraft.glass.lite', string='In Pane',
        ondelete='set null',
        domain=[('is_available_inside', '=', True)],
        help='Glass Option for the inside pane, chosen in the Window '
             'Configuration popup (only options flagged "Available — Inside").',
    )
    glass_middle_lite_id = fields.Many2one(
        comodel_name='wincraft.glass.lite', string='Middle Pane',
        ondelete='set null',
        domain=[('is_available_middle', '=', True)],
        help='See glass_in_lite_id (flag: "Available — Middle").',
    )
    glass_out_lite_id = fields.Many2one(
        comodel_name='wincraft.glass.lite', string='Out Pane',
        ondelete='set null',
        domain=[('is_available_outside', '=', True)],
        help='See glass_in_lite_id (flag: "Available — Outside").',
    )
    opening_direction = fields.Selection(
        selection=OPENING_DIRECTION_SELECTION,
        string='Opening Direction',
        default='left_right',
    )
    inside_paint_product_id = fields.Many2one(
        comodel_name='product.product',
        string='Inside Paint',
        domain=[('x_is_paint_product', '=', True)],
        ondelete='restrict',
        default=lambda self: self._default_paint_product(),
        help='Paint product (from Inventory → Paint Products) applied to the '
             'inside frame face. Drives both the rendered swatch colour and '
             'the paint consumption line on the generated BOM.',
    )
    outside_paint_product_id = fields.Many2one(
        comodel_name='product.product',
        string='Outside Paint',
        domain=[('x_is_paint_product', '=', True)],
        ondelete='restrict',
        default=lambda self: self._default_paint_product(),
        help='Paint product (from Inventory → Paint Products) applied to the '
             'outside frame face. Defaults to the same paint as inside.',
    )
    frame_colour = fields.Char(
        string='Frame Colour (Hex)',
        size=7,
        default='#f0ede8',
        help='Rendering swatch for the inside face. Auto-filled from the '
             'selected Inside Paint product; can still be overridden by hand '
             'for a one-off custom colour not yet in inventory.',
    )
    frame_colour_outside = fields.Char(
        string='Outside Frame Colour (Hex)',
        size=7,
        help='Rendering swatch for the outside face. Auto-filled from the '
             'selected Outside Paint product; left blank, the outside face '
             'renders as (and prices as) the same colour as the inside. '
             'Previously defaulted to a fixed "#f0ede8" independent of the '
             'inside colour, so any window with a non-default inside colour '
             'and an untouched outside field was incorrectly treated as a '
             'dual-colour window and charged the 15% surcharge for it.',
    )
    profile_depth_mm = fields.Selection(
        selection=[('40', '40 mm Slim'), ('70', '70 mm Standard'), ('90', '90 mm Deep')],
        string='Profile Depth',
        default='70',
        help='Frame profile depth in millimetres.',
    )
    pane_configs = fields.Json(
        string='Per-Pane Configuration',
        help='JSON array: [{openingType, hinge, glazingUnit, glassSpec, glassTint}] — one per pane.',
    )
    mullion_positions = fields.Json(
        string='Mullion Positions',
        help='JSON array: [{orientation, positionMm}]. Legacy flat grid format.',
    )
    panel_tree = fields.Json(
        string='Panel Tree',
        help='Recursive binary tree: {type:"split", direction, position, first, second} '
             'or {type:"leaf", id, config}. When set, overrides mullion_positions/panels_h/v.',
    )
    georgian_bar_config = fields.Json(
        string='Georgian Bar Config',
        help='JSON: {pattern, horizontalBars, verticalBars, barWidthMm, barStyle}. Pattern: grid/diamond/sunburst.',
    )
    frame_segments = fields.Json(
        string='Frame Segments',
        help='JSON object keyed by segment name (F1..Fn). '
             'Each: {label, edge:"top"|"bottom"|"left"|"right"|"mullion-v"|"mullion-h", '
             'length_mm, material_id, colour, colour_outside, profile_depth_mm}. '
             'Auto-generated from panel tree; per-segment overrides stored here.',
    )
    hardware_ids = fields.Many2many(
        comodel_name='wincraft.hardware',
        relation='wincraft_window_hardware_rel',
        column1='window_id',
        column2='hardware_id',
        string='Hardware',
    )
    casement_hardware_ids = fields.Many2many(
        comodel_name='wincraft.casement.hardware',
        relation='wincraft_window_casement_hardware_rel',
        column1='window_id',
        column2='casement_hardware_id',
        string='Casement Hardware',
        help='Window Configuration popup "Casement hardware" picks; their '
             'prices are added to the window price.',
    )
    addon_ids = fields.Many2many(
        comodel_name='wincraft.addon',
        relation='wincraft_window_addon_rel',
        column1='window_id',
        column2='addon_id',
        string='Add-ons',
    )
    notes = fields.Text(
        string='Notes',
    )

    # ------------------------------------------------------------------
    # Canvas position and size
    # ------------------------------------------------------------------

    canvas_x = fields.Float(string='Canvas X', default=50.0)
    canvas_y = fields.Float(string='Canvas Y', default=50.0)
    canvas_w = fields.Float(string='Canvas Width (px)', default=120.0)
    canvas_h = fields.Float(string='Canvas Height (px)', default=100.0)

    # ------------------------------------------------------------------
    # Integration fields (BOM / Sale Order / Color)
    # ------------------------------------------------------------------

    bom_id = fields.Many2one(
        comodel_name='mrp.bom',
        string='Bill of Materials',
        ondelete='set null',
        copy=False,
        help='Generated BOM linking this window to manufacturing.',
    )
    bom_state = fields.Selection(
        selection=[
            ('none', 'No BOM'),
            ('draft', 'Draft'),
            ('ready', 'Ready'),
        ],
        string='BOM Status',
        compute='_compute_bom_state',
        store=True,
    )
    sale_order_line_id = fields.Many2one(
        comodel_name='sale.order.line',
        string='SO Line',
        ondelete='set null',
        copy=False,
    )
    sale_order_id = fields.Many2one(
        comodel_name='sale.order',
        string='Sale Order',
        related='sale_order_line_id.order_id',
        store=True,
        readonly=True,
    )
    inside_color_attr_val_id = fields.Many2one(
        comodel_name='product.attribute.value',
        string='Inside Color',
        ondelete='set null',
        help='Product attribute value for the inside frame colour.',
    )
    outside_color_attr_val_id = fields.Many2one(
        comodel_name='product.attribute.value',
        string='Outside Color',
        ondelete='set null',
        help='Product attribute value for the outside frame colour.',
    )
    inside_vendor_color_id = fields.Many2one(
        comodel_name='wincraft.color',
        string='Inside Vendor Color',
        ondelete='set null',
        help='Catalog colour (WS-15) selected for the inside face via the '
             'canvas "Vendor Colour" Company → Color picker. Scoped addition '
             '2026-09-23 — see docs/sprints/SPRINT_2.md WS-17 scope. Purely a '
             'named reference (the catalog has no hex value); it does not '
             'drive the rendered swatch — that stays frame_colour\'s job. '
             'Coexists with, does not replace, the pre-existing frame_colour '
             '/ inside_paint_product_id / inside_color_attr_val_id colour '
             'mechanisms — reconciling all four is still unresolved per the '
             'sprint doc.',
    )
    outside_vendor_color_id = fields.Many2one(
        comodel_name='wincraft.color',
        string='Outside Vendor Color',
        ondelete='set null',
        help='Catalog colour (WS-15) selected for the outside face via the '
             'canvas "Vendor Colour" Company → Color picker. See '
             'inside_vendor_color_id for the coexistence caveat.',
    )
    view_from = fields.Char(
        string='View From',
        help='WS-17 Window Configuration popup field. Meaning not yet '
             'defined by the user (2026-09-09: "not sure, add that field '
             'and note down, will get more info while working on that '
             'task") — stored as free text with no business logic attached. '
             'Same category of gap as is_fh/star_price — do not build logic '
             'on this without confirming its meaning first.',
    )
    rubber_colour_id = fields.Many2one(
        comodel_name='wincraft.color',
        string='Rubber Colour',
        ondelete='set null',
        help='WS-17 Window Configuration popup field. Working assumption, '
             'not yet confirmed with the user: reuses the same wincraft.color '
             'catalog as Vendor Colour (a single field, not sided inside/'
             'outside, since the mockup shows only one "Rubber colour" '
             'field) — flag for confirmation if this turns out wrong.',
    )
    rubber_colour = fields.Selection(
        selection=[('black', 'Black'), ('white', 'White')],
        string='Rubber Colour',
        help='Window Configuration popup field — rubber is only ever black '
             'or white (confirmed 2026-10-10), so it is no longer a company/'
             'colour pick. Supersedes the unused rubber_colour_id.',
    )
    brickmould_type_id = fields.Many2one(
        comodel_name='wincraft.brickmould',
        string='Brickmould Type',
        ondelete='set null',
        help='WS-17 Window Configuration popup field.',
    )
    brickmould_colour_id = fields.Many2one(
        comodel_name='wincraft.color',
        string='Brickmould Colour',
        ondelete='set null',
        help='WS-17 Window Configuration popup field. Reuses the '
             'wincraft.color catalog rather than adding a colour field on '
             'wincraft.brickmould, to avoid a 3rd colour-storage mechanism '
             'alongside inside/outside_vendor_color_id and '
             'casing_colour_id.',
    )
    casing_colour_id = fields.Many2one(
        comodel_name='wincraft.color',
        string='Casing Colour',
        ondelete='set null',
        help='WS-17 Window Configuration popup field. Casing itself is '
             'still picked via the existing Options Group→Item picker '
             '(addon_ids) — this field only stores the colour, since the '
             'Options catalog has no colour attribute of its own.',
    )
    size_basis = fields.Selection(
        selection=[('brickmould', 'Brickmould Size'), ('frame', 'Frame Size')],
        string='Size',
        help='Window Configuration popup "Others" section: whether the '
             'ordered size is the brickmould size or the frame size.',
    )
    screen_colour_id = fields.Many2one(
        comodel_name='wincraft.color',
        string='Screen Colour',
        ondelete='set null',
        help='Window Configuration popup "Others" section; reuses the wincraft.color catalog.',
    )
    handle_cover_colour = fields.Selection(
        selection=[('1', 'White'), ('2', 'Black'), ('3', 'Brown')],
        string='Handle & Cover Colour',
        help='Stored as the reference number (1 = White, 2 = Black, '
             '3 = Brown) — that number is what CSV/Excel exports use.',
    )
    # Window Configuration redesign (client form, 2026-11): one M2O per red
    # field, each to its own small catalog under Configuration → Window
    # Configuration. The older Char/Selection fields above stay for existing data.
    view_from_id = fields.Many2one('wincraft.view_from', string='View From', ondelete='set null')
    window_size_id = fields.Many2one('wincraft.window_size', string='Window Size', ondelete='set null')
    rubber_colour_cfg_id = fields.Many2one('wincraft.rubber_colour', string='Rubber Colour (Config)', ondelete='set null')
    cfg_spacer_id = fields.Many2one('wincraft.spacer', string='Spacer (Config)', ondelete='set null')
    handle_cover_colour_cfg_id = fields.Many2one('wincraft.handle_cover_colour', string='Handle & Cover Colour (Config)', ondelete='set null')
    screen_bar_colour_id = fields.Many2one('wincraft.screen_bar_colour', string='Screen Bar Colour', ondelete='set null')
    screen_mesh_colour_id = fields.Many2one('wincraft.screen_mesh_colour', string='Screen Mesh Colour', ondelete='set null')
    wood_extension_size = fields.Char(string='Wood Extension Size', help='Typed manually (client form).')
    room_id = fields.Many2one(
        comodel_name='wincraft.room',
        string='Room',
        ondelete='set null',
    )
    extension_colour_id = fields.Many2one(
        comodel_name='wincraft.color',
        string='Extension Colour',
        ondelete='set null',
        help='Window Configuration popup field; reuses the wincraft.color catalog.',
    )
    extension_custom_text = fields.Char(
        string='Custom Extension',
        help='Free-text custom value shown on the Window Configuration '
             'popup when an "X" (Extension) option is selected — Options '
             'catalog group X covers custom-sized extensions.',
    )
    frame_attrs = fields.Json(
        string='Frame Attribute Selections',
        default=dict,
        help='JSON dict mapping attribute IDs to selected attribute-value IDs for the frame product.',
    )
    default_spacer_config_id = fields.Many2one(
        comodel_name='wincraft.spacer.config',
        string='Spacer Config',
        ondelete='set null',
        help='Override the default spacer for this window.',
    )

    @api.model
    def _default_catalog_record(self, xml_id, model_name):
        """Resolve a sensible default for a catalog Many2one field.

        Prefers the named seed record (the "standard" choice an installer
        ships); falls back to the first active record of that model so the
        field still defaults to something real if the seed was deleted or
        the seed data module isn't installed.
        """
        record = self.env.ref(xml_id, raise_if_not_found=False)
        if record and record.exists():
            return record.id
        return self.env[model_name].search([], limit=1).id

    @api.model
    def _default_paint_product(self):
        """Default Inside/Outside Paint to the seeded 'White' paint.

        Falls back to any other paint-tagged product if the seed record is
        missing, so the field is only ever empty when no paint product has
        been added to inventory yet (Inventory → Paint Products).
        """
        paint = self.env.ref('wincraft_studio.product_paint_white', raise_if_not_found=False)
        if paint and paint.exists():
            return paint.product_variant_id.id
        return self.env['product.product'].search([('x_is_paint_product', '=', True)], limit=1).id

    @api.depends('bom_id', 'bom_id.bom_line_ids')
    def _compute_bom_state(self):
        for rec in self:
            if not rec.bom_id:
                rec.bom_state = 'none'
            elif rec.bom_id.bom_line_ids:
                rec.bom_state = 'ready'
            else:
                rec.bom_state = 'draft'

    # ------------------------------------------------------------------
    # Fabrication tracking
    # ------------------------------------------------------------------

    fabricated = fields.Boolean(
        string='Fabricated',
        default=False,
        help='Check when this window has been fabricated.',
    )
    fabricated_date = fields.Date(
        string='Fabrication Date',
    )

    # ------------------------------------------------------------------
    # Pricing (computed)
    # ------------------------------------------------------------------

    area_sqm = fields.Float(
        string='Area (sqm)',
        digits=(10, 4),
        compute='_compute_area_sqm',
        store=True,
    )
    unit_price = fields.Monetary(
        string='Unit Price',
        currency_field='currency_id',
        compute='_compute_unit_price',
        store=True,
        help='Computed from pricing rule: (area × rates) + hardware + addons × margin.',
    )
    currency_id = fields.Many2one(
        comodel_name='res.currency',
        string='Currency',
        related='project_id.currency_id',
        store=True,
    )

    # ------------------------------------------------------------------
    # Thumbnail SVG (computed for reports & portal)
    # ------------------------------------------------------------------

    thumbnail_svg = fields.Text(
        string='Thumbnail SVG',
        compute='_compute_thumbnail_svg',
        help='Auto-generated SVG preview used in QWeb reports.',
    )

    # ------------------------------------------------------------------
    # SQL constraints
    # ------------------------------------------------------------------

    _width_positive = models.Constraint('CHECK(width_mm > 0)', 'Window width must be greater than zero.')
    _height_positive = models.Constraint('CHECK(height_mm > 0)', 'Window height must be greater than zero.')
    _panels_h_valid = models.Constraint('CHECK(panels_horizontal >= 1 AND panels_horizontal <= 20)', 'Horizontal panels must be between 1 and 20.')
    _panels_v_valid = models.Constraint('CHECK(panels_vertical >= 1 AND panels_vertical <= 20)', 'Vertical panels must be between 1 and 20.')

    # ------------------------------------------------------------------
    # Computed field methods
    # ------------------------------------------------------------------

    @api.depends('window_type', 'width_mm', 'height_mm')
    def _compute_name(self):
        """Auto-compose window name from type and dimensions."""
        type_labels = dict(self.env['wincraft.window.type']._selection_window_type())
        for record in self:
            if record.window_type and record.width_mm and record.height_mm:
                label = type_labels.get(record.window_type, record.window_type.capitalize())
                record.name = f'{label} {record.width_mm}×{record.height_mm}'
            elif not record.name:
                record.name = _('New Window')

    @api.depends('width_mm', 'height_mm', 'ro_delta_w', 'ro_delta_h')
    def _compute_rough_opening(self):
        """Rough opening = frame size + 2 × delta on each axis."""
        for record in self:
            record.rough_opening_w = record.width_mm + 2 * (record.ro_delta_w or 0)
            record.rough_opening_h = record.height_mm + 2 * (record.ro_delta_h or 0)

    @api.depends('width_mm', 'height_mm')
    def _compute_united_inches(self):
        """United inches = width (in) + height (in)."""
        for record in self:
            record.united_inches = (record.width_mm / 25.4) + (record.height_mm / 25.4)

    # ──────────────────────────────────────────────────────────────────
    # Bay & Bow geometry
    # ──────────────────────────────────────────────────────────────────
    def _resolve_bay_bow_angle_deg(self):
        """The single configured angle in degrees for this window's type —
        bay: splay angle between centre and each flanker; bow: arc angle
        each lite spans relative to its neighbour. Single source of truth
        shared by _compute_bay_geometry (here), the BOM builder's mulling
        post mitre angle, and the cutlist module's mirror of that same
        mitre angle — previously each of those three hand-duplicated this
        resolution (bow's was simply hardcoded to 10°, so a custom bow
        angle never actually reached the BOM or cutlists).
        """
        self.ensure_one()
        if self.window_type == 'bay':
            if self.bay_angle == 'custom':
                return max(min(self.bay_angle_custom_deg or 45.0, 120.0), 15.0)
            return float(self.bay_angle or '45')
        elif self.window_type == 'bow':
            if self.bow_angle_deg == 'custom':
                return max(min(self.bow_angle_custom_deg or 10.0, 30.0), 3.0)
            return float(self.bow_angle_deg or '10')
        return 0.0

    @api.depends(
        'window_type', 'width_mm',
        'bay_angle', 'bay_angle_custom_deg',
        'bow_angle_deg', 'bow_angle_custom_deg',
        'bay_lite_count', 'bay_centre_ratio',
    )
    def _compute_bay_geometry(self):
        """Derive projection, lite chord, total arc and bow radius from inputs.

        Bay (3-lite splay):
            angle θ between centre and each flanker (measured at flanker root).
            centre chord  Cc = width × centre_ratio
            flanker chord Cf = (width − Cc) / 2          (per side, in plan)
            projection    P  = Cf × sin(θ)

        Bay (n>3 lites): treat as repeated splay — flanker chord = width/n,
            projection = (n−1)/2 × Cf × sin(θ).

        Bow (radial arc): each lite spans an equal arc segment.
            Total spread  Φ = (n−1) × θ_per_lite, θ_per_lite from bow_angle_deg
            (default 10°, user-customisable via _resolve_bay_bow_angle_deg()).
            radius        R  = (width / 2) / sin(Φ / 2)
            lite chord    Cl = 2 R × sin(θ_per_lite / 2)
            projection    P  = R × (1 − cos(Φ / 2))
            total arc     A  = R × Φ                     (radians)
        """
        import math
        for rec in self:
            wt = rec.window_type
            n = max(int(rec.bay_lite_count or 0), 1)
            width = rec.width_mm or 0

            if wt == 'bay' and n >= 2 and width > 0:
                theta = math.radians(rec._resolve_bay_bow_angle_deg())

                if n == 3:
                    centre_ratio = max(min(rec.bay_centre_ratio or 0.5, 0.85), 0.20)
                    centre_chord = width * centre_ratio
                    flanker_chord = (width - centre_chord) / 2.0
                    rec.bay_lite_chord_mm = flanker_chord
                    rec.bay_total_arc_mm = centre_chord + 2 * flanker_chord
                    rec.projection_depth_mm = flanker_chord * math.sin(theta)
                else:
                    flanker_chord = width / n
                    rec.bay_lite_chord_mm = flanker_chord
                    rec.bay_total_arc_mm = flanker_chord * n
                    # projection = sum of sin contributions of off-centre lites
                    half = (n - 1) / 2.0
                    rec.projection_depth_mm = flanker_chord * math.sin(theta) * half
                rec.bow_radius_mm = 0.0

            elif wt == 'bow' and n >= 3 and width > 0:
                theta_per_lite = math.radians(rec._resolve_bay_bow_angle_deg())
                phi = (n - 1) * theta_per_lite if n > 1 else theta_per_lite
                # avoid singularity
                half_phi = phi / 2.0
                if math.sin(half_phi) > 1e-6:
                    radius = (width / 2.0) / math.sin(half_phi)
                else:
                    radius = width
                lite_chord = 2.0 * radius * math.sin(theta_per_lite / 2.0)
                rec.bow_radius_mm = radius
                rec.bay_lite_chord_mm = lite_chord
                rec.bay_total_arc_mm = radius * phi
                rec.projection_depth_mm = radius * (1.0 - math.cos(half_phi))
            else:
                rec.bow_radius_mm = 0.0
                rec.bay_lite_chord_mm = 0.0
                rec.bay_total_arc_mm = 0.0
                rec.projection_depth_mm = 0.0

    @api.constrains(
        'window_type', 'bay_lite_count', 'bay_centre_ratio',
        'bay_angle_custom_deg', 'bow_angle_custom_deg',
    )
    def _check_bay_bow_inputs(self):
        for rec in self:
            if rec.window_type == 'bay':
                if not (2 <= (rec.bay_lite_count or 0) <= 6):
                    raise ValidationError(_('Bay window must have between 2 and 6 lites.'))
                if not (0.20 <= (rec.bay_centre_ratio or 0) <= 0.85):
                    raise ValidationError(_('Centre Lite Ratio must be between 0.20 and 0.85.'))
                if rec.bay_angle == 'custom' and not (15 <= (rec.bay_angle_custom_deg or 0) <= 120):
                    raise ValidationError(_('Custom bay angle must be between 15° and 120°.'))
            elif rec.window_type == 'bow':
                if not (3 <= (rec.bay_lite_count or 0) <= 8):
                    raise ValidationError(_('Bow window must have between 3 and 8 lites.'))
                if rec.bow_angle_deg == 'custom' and not (3 <= (rec.bow_angle_custom_deg or 0) <= 30):
                    raise ValidationError(_('Custom bow angle must be between 3° and 30° per lite.'))

    def _get_shape_area_perimeter_m(self):
        """Area (sqm) and cut perimeter (m) of the actual frame outline.

        Equals width × height / 2×(w+h) for 'rectangular'. For shaped
        frames (circle, arch, octagon, custom, ...) it follows the true
        outline so glass area and frame-profile cut length match what is
        rendered on the canvas and quoted to the customer.
        """
        self.ensure_one()
        area_mm2, perimeter_mm = _shape_area_perimeter_mm(
            self.frame_shape or 'rectangular',
            self.width_mm,
            self.height_mm,
            self.frame_shape_points,
        )
        return area_mm2 / 1_000_000.0, perimeter_mm / 1000.0

    @api.depends('width_mm', 'height_mm', 'frame_shape', 'frame_shape_points')
    def _compute_area_sqm(self):
        """Compute window area in square metres, following the actual frame outline."""
        for record in self:
            area_m2, _perimeter_m = record._get_shape_area_perimeter_m()
            record.area_sqm = area_m2

    @api.depends('panels_horizontal', 'panels_vertical')
    def _compute_panels(self):
        """Compute total panels as horizontal × vertical."""
        for record in self:
            record.panels = (record.panels_horizontal or 1) * (record.panels_vertical or 1)

    @api.onchange('frame_material_id', 'glass_type_id')
    def _onchange_material_glass(self):
        """Set margin_pct from the best matching pricing rule."""
        rule = self._get_pricing_rule()
        if rule:
            self.margin_pct = rule.margin_pct

    @api.onchange('profile_type_id')
    def _onchange_profile_type(self):
        """Auto-set Frame Material from the profile type's linked material.

        Matches wincraft.window.type.series.material_id's own help text ("If set,
        selecting this profile auto-sets the frame material") and mirrors
        onProfileSystemChange() in properties_panel.js (the canvas already does
        this) — this onchange brings the classic backend form view in line with
        it, so a window can't end up with a profile type that disagrees with
        an unrelated Frame Material regardless of which UI was used to set it.
        """
        if self.profile_type_id and self.profile_type_id.material_id:
            self.frame_material_id = self.profile_type_id.material_id

    def _get_pricing_rule(self):
        """Find best matching pricing rule: exact → material-only → glass-only → fallback.

        Scoped to the project's company so a rule created for another
        company (e.g. in a multi-branch setup) can never be silently
        applied to this window's price.
        """
        self.ensure_one()
        Rule = self.env['wincraft.pricing.rule']
        company_id = self.project_id.company_id.id if self.project_id and self.project_id.company_id else self.env.company.id
        base_domain = [('company_id', '=', company_id)]

        rule = Rule.search(
            base_domain + [
                ('material_id', '=', self.frame_material_id.id or False),
                ('glass_type_id', '=', self.glass_type_id.id or False),
            ],
            limit=1,
        )
        if not rule and self.frame_material_id:
            rule = Rule.search(
                base_domain + [('material_id', '=', self.frame_material_id.id), ('glass_type_id', '=', False)],
                limit=1,
            )
        if not rule and self.glass_type_id:
            rule = Rule.search(
                base_domain + [('material_id', '=', False), ('glass_type_id', '=', self.glass_type_id.id)],
                limit=1,
            )
        if not rule:
            rule = Rule.search(
                base_domain + [('material_id', '=', False), ('glass_type_id', '=', False)],
                limit=1,
            )
        return rule

    def _get_pane_hardware_total(self):
        """Sum the cost of per-pane hardware selections (Properties Panel → pane hardware).

        Walks panel_tree / pane_configs the same way _get_bom_components() does
        and resolves each pane's hardwareSelections ({role: hardware_id}) to a
        real wincraft.hardware record, multiplying by the typical install
        quantity for that role/opening type (see _hardware_qty). This is the
        hardware a user actually configures by clicking roles on a canvas
        pane — previously invisible to pricing, which only summed the
        separate whole-window hardware_ids multi-select.
        """
        self.ensure_one()
        if self.panel_tree:
            pane_list, _dividers = self._extract_tree_bom(
                self.panel_tree,
                {'x': 0, 'y': 0, 'w': self.width_mm, 'h': self.height_mm},
                20,
            )
        else:
            pane_list = [{'config': pc or {}} for pc in (self.pane_configs or [])]

        if not pane_list:
            return 0.0

        Hardware = self.env['wincraft.hardware']
        total = 0.0
        for pane in pane_list:
            cfg = pane.get('config') or {}
            hw_sel = cfg.get('hardwareSelections')
            if not isinstance(hw_sel, dict):
                continue
            opening_type = cfg.get('openingType', 'fixed')
            for role, hw_id in hw_sel.items():
                if not hw_id:
                    continue
                try:
                    hw_id = int(hw_id)
                except (TypeError, ValueError):
                    continue
                hw_rec = Hardware.browse(hw_id)
                if not hw_rec.exists():
                    continue
                total += hw_rec.unit_price * self._hardware_qty(role, opening_type)
        return total

    def _get_depth_multiplier(self):
        """Profile depth cost multiplier (70mm = baseline). Mirrors pricing.js."""
        try:
            depth = int(self.profile_depth_mm or 70)
        except (TypeError, ValueError):
            depth = 70
        if depth <= 40:
            return 0.85
        if depth >= 90:
            return 1.18
        return 1.0

    def _get_pane_glass_cost(self):
        """Glass cost from the Glass Options picked on each canvas pane.

        Each pane contributes, per lite its glazing type uses (single: outer;
        double: outer + inner; triple: outer + middle + inner), the supplier
        price-list price per sq ft at that lite's thickness, converted to m²,
        times the pane's area. Returns None when no pane has a glass picked,
        so the caller can fall back to the popup defaults / Glass Type.
        """
        self.ensure_one()
        if self.panel_tree:
            pane_list, _dividers = self._extract_tree_bom(
                self.panel_tree,
                {'x': 0, 'y': 0, 'w': self.width_mm, 'h': self.height_mm},
                20,
            )
            if len(pane_list) == 1:
                pane_list[0]['area_m2'] = self.area_sqm or 0.0
        else:
            pane_list = [{'config': pc or {}, 'area_m2': (self.area_sqm or 0.0)}
                         for pc in (self.pane_configs or [])[:1]]

        lites_by_key = None
        total = 0.0
        found = False
        for pane in pane_list:
            cfg = pane.get('config') or {}
            glazing = cfg.get('glazingType') or 'double'
            positions = {'single': (1,), 'double': (1, 2), 'triple': (1, 2, 3)}.get(glazing, (1, 2))
            area = pane.get('area_m2', pane.get('w_m', 0.0) * pane.get('h_m', 0.0))
            for pos in positions:
                key = cfg.get(f'glass{pos}Key')
                if not key:
                    continue
                if lites_by_key is None:
                    lites_by_key = {
                        lite._canvas_key(): lite
                        for lite in self.env['wincraft.glass.lite'].search([('active', '=', True)])
                    }
                lite = lites_by_key.get(key)
                if not lite:
                    continue
                attrs = cfg.get(f'glass{pos}Attrs') or {}
                found = True
                total += lite._sf_price(attrs.get('_ot')) * SQFT_PER_M2 * area
        return total if found else None

    def _glass_cost(self):
        """Total glass cost for the area-based price.

        Priority: (1) Glass Options picked per pane on the canvas; (2) the
        In/Middle/Out Glass Options picked in the Window Configuration popup,
        applied over the whole area; (3) the window's Glass Type rate.
        """
        self.ensure_one()
        pane_cost = self._get_pane_glass_cost()
        if pane_cost is not None:
            return pane_cost
        area = self.area_sqm or 0.0
        lites = self.glass_in_lite_id | self.glass_middle_lite_id | self.glass_out_lite_id
        if lites:
            return area * sum(lite._sf_price() for lite in lites) * SQFT_PER_M2
        return area * (self.glass_type_id.rate_per_sqm if self.glass_type_id else 0.0)

    @api.depends(
        'width_mm',
        'height_mm',
        'frame_material_id',
        'glass_type_id',
        'glass_in_lite_id',
        'glass_middle_lite_id',
        'glass_out_lite_id',
        'hardware_ids',
        'addon_ids',
        'brickmould_colour_id',
        'casing_colour_id',
        'casement_hardware_ids',
        'extension_colour_id',
        'area_sqm',
        'margin_pct',
        'united_inches',
        'profile_depth_mm',
        'frame_colour',
        'frame_colour_outside',
        'pane_configs',
        'panel_tree',
    )
    def _compute_unit_price(self):
        """Compute unit price using the matched pricing rule formula.

        Supports two methods:
        - area: (area × base_rate × depth_multiplier) + glass + hardware
          + addons + fab + dual-colour surcharge, all × margin
        - united_inches: tier flat price + hardware + addons × margin

        Hardware total includes both the whole-window hardware_ids selector
        and per-pane hardwareSelections. The depth multiplier and dual-colour
        surcharge mirror the canvas's live estimate (pricing.js), so the
        number shown while designing matches the saved/quoted price instead
        of silently dropping those two cost factors.
        """
        for record in self:
            area = record.area_sqm or 0.0

            pricing_rule = record._get_pricing_rule()
            pane_hardware_total = record._get_pane_hardware_total()
            dual_colour = bool(record.frame_colour_outside) and record.frame_colour_outside != record.frame_colour

            # ── United inches tier pricing ───────────────────────────
            if pricing_rule and pricing_rule.pricing_method == 'united_inches':
                tier_price = pricing_rule.get_ui_tier_price(record.united_inches)
                hardware_total = (sum(h.unit_price for h in record.hardware_ids) + pane_hardware_total
                              + sum(record.casement_hardware_ids.mapped('price')))
                addon_total = sum(a._price_for_window(record) for a in record.addon_ids if a.per_window)
                margin = record.margin_pct if record.margin_pct else (pricing_rule.margin_pct if pricing_rule else 0.0)
                pre_margin = tier_price + hardware_total + addon_total
                record.unit_price = pre_margin * (1.0 + margin / 100.0)
                continue

            # ── Area-based pricing ────────────────────────────────────
            base_rate = pricing_rule.base_rate if pricing_rule else 0.0
            fabrication_rate = pricing_rule.fabrication_rate if pricing_rule else 0.0

            # Use per-window margin override
            margin = record.margin_pct if record.margin_pct else (pricing_rule.margin_pct if pricing_rule else 0.0)

            glass_cost = record._glass_cost()
            hardware_total = (sum(h.unit_price for h in record.hardware_ids) + pane_hardware_total
                              + sum(record.casement_hardware_ids.mapped('price')))
            addon_total = sum(a._price_for_window(record) for a in record.addon_ids if a.per_window)

            depth_multiplier = record._get_depth_multiplier()
            material_cost = area * base_rate * depth_multiplier
            dual_colour_surcharge = material_cost * 0.15 if dual_colour else 0.0

            pre_margin = (
                material_cost
                + glass_cost
                + hardware_total
                + addon_total
                + (area * fabrication_rate)
                + dual_colour_surcharge
            )
            record.unit_price = pre_margin * (1.0 + margin / 100.0)

    def _compute_thumbnail_svg(self):
        """Generate a compact, shape-aware SVG elevation for each window.

        Used both by the customer portal (small preview) and the quote PDF's
        per-item technical card (larger). The outline follows the real
        frame_shape (circle/octagon/triangle/etc., via _frame_shape_boundary_mm)
        instead of always being a rectangle, and carries simple dimension
        lines — a clean technical line drawing, not a render of the canvas.
        """
        type_labels = dict(self.env['wincraft.window.type']._selection_window_type())
        total_w, total_h = 240, 190
        margin_l, margin_t, margin_r = 30, 10, 10
        margin_b_dim, margin_b_label = 22, 16
        draw_w = total_w - margin_l - margin_r
        draw_h = total_h - margin_t - margin_b_dim - margin_b_label

        for record in self:
            width_mm = max(record.width_mm or 1, 1)
            height_mm = max(record.height_mm or 1, 1)
            scale = min(draw_w / width_mm, draw_h / height_mm)
            shape_w = width_mm * scale
            shape_h = height_mm * scale
            ox = margin_l + (draw_w - shape_w) / 2.0
            oy = margin_t + (draw_h - shape_h) / 2.0

            outer_pts = [
                (ox + px * scale, oy + py * scale)
                for px, py in _frame_shape_boundary_mm(
                    record.frame_shape or 'rectangular', width_mm, height_mm,
                    record.frame_shape_points,
                )
            ]
            outer_attr = ' '.join(f'{x:.1f},{y:.1f}' for x, y in outer_pts)
            svg_id = f'wcthumb{abs(id(record))}'

            # Outer frame outline (any shape) — clean line drawing, no fill effects
            s = f'<polygon points="{outer_attr}" fill="#f8fafc" stroke="#334155" stroke-width="2.5"/>'

            # Panel grid — straight mullion dividers, clipped to the frame's
            # true outline so a divider near a circle/triangle/octagon edge
            # never overshoots the silhouette (mirrors paneGrid()'s clip in
            # window_svg.js).
            panels_h = max(1, record.panels_horizontal or 1)
            panels_v = max(1, record.panels_vertical or 1)
            if panels_h > 1 or panels_v > 1:
                grid = ''
                for c in range(1, panels_h):
                    gx = ox + (width_mm * c / panels_h) * scale
                    grid += (
                        f'<line x1="{gx:.1f}" y1="{oy:.1f}" x2="{gx:.1f}" y2="{oy + shape_h:.1f}" '
                        f'stroke="#334155" stroke-width="1.2"/>'
                    )
                for r in range(1, panels_v):
                    gy = oy + (height_mm * r / panels_v) * scale
                    grid += (
                        f'<line x1="{ox:.1f}" y1="{gy:.1f}" x2="{ox + shape_w:.1f}" y2="{gy:.1f}" '
                        f'stroke="#334155" stroke-width="1.2"/>'
                    )
                s += (
                    f'<defs><clipPath id="{svg_id}"><polygon points="{outer_attr}"/></clipPath></defs>'
                    f'<g clip-path="url(#{svg_id})">{grid}</g>'
                )

            # Dimension lines — simple tick-mark lines + mm labels
            dim_colour = '#64748b'
            dim_y = oy + shape_h + 10
            s += (
                f'<line x1="{ox:.1f}" y1="{dim_y:.1f}" x2="{ox + shape_w:.1f}" y2="{dim_y:.1f}" '
                f'stroke="{dim_colour}" stroke-width="1"/>'
                f'<line x1="{ox:.1f}" y1="{dim_y - 3:.1f}" x2="{ox:.1f}" y2="{dim_y + 3:.1f}" '
                f'stroke="{dim_colour}" stroke-width="1"/>'
                f'<line x1="{ox + shape_w:.1f}" y1="{dim_y - 3:.1f}" x2="{ox + shape_w:.1f}" y2="{dim_y + 3:.1f}" '
                f'stroke="{dim_colour}" stroke-width="1"/>'
                f'<text x="{ox + shape_w / 2:.1f}" y="{dim_y + 12:.1f}" text-anchor="middle" '
                f'font-family="monospace" font-size="8" fill="{dim_colour}">{width_mm:.0f}</text>'
            )
            dim_x = ox - 10
            mid_y = oy + shape_h / 2
            s += (
                f'<line x1="{dim_x:.1f}" y1="{oy:.1f}" x2="{dim_x:.1f}" y2="{oy + shape_h:.1f}" '
                f'stroke="{dim_colour}" stroke-width="1"/>'
                f'<line x1="{dim_x - 3:.1f}" y1="{oy:.1f}" x2="{dim_x + 3:.1f}" y2="{oy:.1f}" '
                f'stroke="{dim_colour}" stroke-width="1"/>'
                f'<line x1="{dim_x - 3:.1f}" y1="{oy + shape_h:.1f}" x2="{dim_x + 3:.1f}" y2="{oy + shape_h:.1f}" '
                f'stroke="{dim_colour}" stroke-width="1"/>'
                f'<text x="{dim_x - 4:.1f}" y="{mid_y:.1f}" text-anchor="middle" '
                f'font-family="monospace" font-size="8" fill="{dim_colour}" '
                f'transform="rotate(-90 {dim_x - 4:.1f} {mid_y:.1f})">{height_mm:.0f}</text>'
            )

            # Type + overall-size label beneath everything
            label = type_labels.get(record.window_type, '')
            dim = f'{record.width_mm}×{record.height_mm}'
            s += (
                f'<text x="{total_w / 2:.1f}" y="{total_h - 4:.1f}" text-anchor="middle" '
                f'font-family="monospace" font-size="9" fill="#334155">{label} {dim}</text>'
            )

            record.thumbnail_svg = (
                f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_w}" height="{total_h}" '
                f'viewBox="0 0 {total_w} {total_h}">{s}</svg>'
            )

    # ------------------------------------------------------------------
    # Quote PDF — pane layout / opening-type / naming helpers
    # ------------------------------------------------------------------

    def _get_quote_pane_layout(self, mullion_thick=20):
        """Ordered list of {'x','y','w','h','config'} (mm), left-to-right
        then top-to-bottom — shared by the quote elevation, 3D illustration,
        and opening-type/configuration-code helpers so they all agree on
        the same pane geometry. Mirrors panel_tree.js's computePaneBounds /
        the legacy grid fallback already used by _get_bom_components.
        """
        self.ensure_one()
        if self.panel_tree:
            layout = self._extract_pane_layout(
                self.panel_tree,
                {'x': 0.0, 'y': 0.0, 'w': float(self.width_mm), 'h': float(self.height_mm)},
                mullion_thick,
            )
            if layout:
                return layout
        nH = max(1, self.panels_horizontal or 1)
        nV = max(1, self.panels_vertical or 1)
        half_bar = mullion_thick / 2.0
        pane_w = self.width_mm / nH
        pane_h = self.height_mm / nV
        pane_configs = self.pane_configs or []
        layout = []
        for i in range(nH * nV):
            col, row = i % nH, i // nH
            layout.append({
                'x': col * pane_w + (half_bar if col > 0 else 0),
                'y': row * pane_h + (half_bar if row > 0 else 0),
                'w': pane_w - (half_bar if col > 0 else 0) - (half_bar if col < nH - 1 else 0),
                'h': pane_h - (half_bar if row > 0 else 0) - (half_bar if row < nV - 1 else 0),
                'config': pane_configs[i] if i < len(pane_configs) else {},
            })
        return layout

    def _extract_pane_layout(self, node, bounds, mullion_thick):
        """Recursive panel_tree walk keeping (x, y, w, h) — position-aware
        sibling of _extract_tree_bom(), for drawing/opening-type purposes."""
        if not node or not isinstance(node, dict):
            return []
        if node.get('type') == 'leaf':
            return [{**bounds, 'config': node.get('config', {})}]
        if node.get('type') == 'split':
            direction = node.get('direction', 'vertical')
            position = node.get('position', 0)
            half_bar = mullion_thick / 2.0
            if direction == 'vertical':
                first_bounds = {
                    'x': bounds['x'], 'y': bounds['y'],
                    'w': max(0.0, position - bounds['x'] - half_bar), 'h': bounds['h'],
                }
                second_bounds = {
                    'x': position + half_bar, 'y': bounds['y'],
                    'w': max(0.0, bounds['x'] + bounds['w'] - position - half_bar), 'h': bounds['h'],
                }
            else:
                first_bounds = {
                    'x': bounds['x'], 'y': bounds['y'],
                    'w': bounds['w'], 'h': max(0.0, position - bounds['y'] - half_bar),
                }
                second_bounds = {
                    'x': bounds['x'], 'y': position + half_bar,
                    'w': bounds['w'], 'h': max(0.0, bounds['y'] + bounds['h'] - position - half_bar),
                }
            return (
                self._extract_pane_layout(node.get('first'), first_bounds, mullion_thick)
                + self._extract_pane_layout(node.get('second'), second_bounds, mullion_thick)
            )
        return []

    def _get_pane_opening_types(self):
        """Ordered opening type per pane (left-to-right, top-to-bottom).

        Uses the explicit pane_configs[i].openingType when set, otherwise
        infers it the same way the canvas does in window_svg.js's
        drawAllPaneNotations() — by window_type and pane position.
        """
        self.ensure_one()
        layout = self._get_quote_pane_layout()
        n = len(layout)
        if not n:
            return []
        glass_mid_x = self.width_mm / 2.0
        glass_mid_y = self.height_mm / 2.0
        wt = self.window_type
        types = []
        for idx, pane in enumerate(layout):
            cfg = pane.get('config') or {}
            ot = cfg.get('openingType')
            if not ot:
                is_left_half = (pane['x'] + pane['w'] / 2.0) <= glass_mid_x
                is_top_half = (pane['y'] + pane['h'] / 2.0) <= glass_mid_y
                if wt == 'casement':
                    ot = 'casement-l' if is_left_half else 'casement-r'
                elif wt in ('sliding', 'single_slider'):
                    ot = 'fixed' if is_left_half else 'sliding'
                elif wt == 'double_slider':
                    ot = 'sliding'
                elif wt == 'end_vent_slider':
                    ot = 'sliding' if (idx == 0 or idx == n - 1) else 'fixed'
                elif wt == 'bifold':
                    ot = 'bifold'
                elif wt == 'tilt_turn':
                    ot = 'tiltturn'
                elif wt == 'awning':
                    ot = 'awning'
                elif wt == 'single_hung':
                    ot = 'fixed' if is_top_half else 'sliding'
                elif wt == 'double_hung':
                    ot = 'sliding'
                elif wt == 'fixed_casement':
                    ot = 'fixed' if is_left_half else 'casement-r'
                else:
                    ot = 'fixed'
            if cfg.get('hingeSide') and ot in ('casement-l', 'casement-r'):
                ot = 'casement-r' if cfg['hingeSide'] == 'right' else 'casement-l'
            types.append(ot)
        return types

    def _get_quote_product_name(self):
        """Catalogue-style product name for the quote PDF heading."""
        self.ensure_one()
        names = {
            'casement': _('Casement Window'),
            'sliding': _('Sliding Window'),
            'fixed': _('Fixed Window'),
            'bifold': _('Bi-Fold Door'),
            'awning': _('Awning Window'),
            'arched': _('Arched Window'),
            'bay': _('Bay Window'),
            'bow': _('Bow Window'),
            'tilt_turn': _('Tilt & Turn Window'),
            'single_hung': _('Single Hung Window'),
            'double_hung': _('Double Hung Window'),
            'single_slider': _('Sliding Window'),
            'double_slider': _('Sliding Window'),
            'end_vent_slider': _('Sliding Window'),
            'fixed_casement': _('Fixed + Casement Window'),
            'custom': _('Custom Window'),
        }
        return names.get(self.window_type) or dict(self.env['wincraft.window.type']._selection_window_type()).get(self.window_type, _('Window'))

    def _get_quote_configuration_code(self):
        """Short configuration code for the spec block: an X/O code for
        sliding-family windows (e.g. "XOX", X=sliding, O=fixed), else a
        short label for the opening style (e.g. "Casement", "Fixed")."""
        self.ensure_one()
        slide_types = {
            'sliding', 'single_slider', 'double_slider', 'end_vent_slider',
            'single_hung', 'double_hung',
        }
        if self.window_type in slide_types:
            code = ''.join('X' if ot == 'sliding' else 'O' for ot in self._get_pane_opening_types())
            if code:
                return code
        short_labels = {
            'casement': _('Casement'),
            'fixed': _('Fixed'),
            'bifold': _('Bi-Fold'),
            'awning': _('Awning'),
            'tilt_turn': _('Tilt & Turn'),
            'fixed_casement': _('Fixed + Casement'),
            'bay': _('Bay'),
            'bow': _('Bow'),
            'arched': _('Arched'),
            'custom': _('Custom'),
        }
        return short_labels.get(self.window_type) or dict(self.env['wincraft.window.type']._selection_window_type()).get(self.window_type, self.window_type)

    def _get_quote_spec_lines(self):
        """Ordered (label, value) pairs for the quote PDF's technical spec
        block. Skips any spec the window doesn't have configured."""
        self.ensure_one()
        lines = [(_('Configuration'), self._get_quote_configuration_code())]
        if self.profile_type_id:
            lines.append((_('Profile Type'), self.profile_type_id.name))
        if self.frame_material_id:
            lines.append((_('Material'), self.frame_material_id.name))
        colour_label = self._get_quote_colour_label()
        if colour_label:
            lines.append((_('Colour'), colour_label))
        if self.glass_type_id:
            glass_value = self.glass_type_id.name
            extras = []
            if self.glass_type_id.u_value:
                extras.append(_('U-value %.2f') % self.glass_type_id.u_value)
            if self.glass_type_id.shgc:
                extras.append(_('SHGC %.2f') % self.glass_type_id.shgc)
            if extras:
                glass_value = '%s (%s)' % (glass_value, ', '.join(extras))
            lines.append((_('Glass'), glass_value))
        if self.hardware_ids:
            lines.append((_('Hardware'), ', '.join(self.hardware_ids.mapped('name'))))
        mesh_addons = self.addon_ids.filtered(
            lambda a: 'screen' in (a.addon_code or a.name or '').lower()
            or 'mesh' in (a.addon_code or a.name or '').lower()
        )
        lines.append((_('Mosquito Mesh'), _('Yes') if mesh_addons else _('No')))
        lines.append((_('Panels'), '%s × %s' % (self.panels_horizontal or 1, self.panels_vertical or 1)))
        if self.frame_shape and self.frame_shape != 'rectangular':
            shape_label = dict(self._fields['frame_shape'].selection).get(self.frame_shape, self.frame_shape)
            lines.append((_('Shape'), shape_label))
        return lines

    def _get_quote_colour_label(self):
        """Human-readable colour for the quote's spec block.

        Prefers the selected Inside/Outside paint product's name (e.g.
        "Red") over the raw rendering hex, so a customer reads an actual
        colour name instead of a hex code. Falls back to the hex only for
        a window with no paint product selected (a manually-typed custom
        swatch). Shows both faces when Inside/Outside differ.
        """
        self.ensure_one()
        inside = self.inside_paint_product_id.name or self.frame_colour
        outside = self.outside_paint_product_id.name or self.frame_colour_outside
        if not inside and not outside:
            return ''
        if outside and outside != inside:
            return _('%(inside)s (Inside) / %(outside)s (Outside)') % {'inside': inside, 'outside': outside}
        return inside or outside

    def _quote_opening_symbol_svg(self, px, py, pw, ph, opening_type):
        """SVG snippet for one pane's operation notation: sliding arrows,
        a casement opening-direction chevron, or a fixed-pane cross."""
        cx, cy = px + pw / 2.0, py + ph / 2.0
        m = max(4.0, min(pw, ph) * 0.12)
        nc = '#475569'
        if opening_type == 'sliding':
            x1, x2 = px + m, px + pw - m
            head = max(3.0, m * 0.6)
            return (
                f'<line x1="{x1:.1f}" y1="{cy:.1f}" x2="{x2:.1f}" y2="{cy:.1f}" stroke="{nc}" stroke-width="1.4"/>'
                f'<polygon points="{x1:.1f},{cy:.1f} {(x1 + head):.1f},{(cy - head / 1.6):.1f} {(x1 + head):.1f},{(cy + head / 1.6):.1f}" fill="none" stroke="{nc}" stroke-width="1.0"/>'
                f'<polygon points="{x2:.1f},{cy:.1f} {(x2 - head):.1f},{(cy - head / 1.6):.1f} {(x2 - head):.1f},{(cy + head / 1.6):.1f}" fill="none" stroke="{nc}" stroke-width="1.0"/>'
            )
        if opening_type in ('casement-l', 'casement-r'):
            x1, y1 = px + m, py + m
            x2, y2 = px + pw - m, py + ph - m
            apex_x = x1 if opening_type == 'casement-l' else x2
            far_x = x2 if opening_type == 'casement-l' else x1
            return (
                f'<polygon points="{far_x:.1f},{y1:.1f} {apex_x:.1f},{cy:.1f} {far_x:.1f},{y2:.1f}" '
                f'fill="none" stroke="{nc}" stroke-width="1.2"/>'
            )
        if opening_type in ('bifold', 'awning', 'tiltturn'):
            # Generic operable notation — inward-pointing chevron from the top edge
            x1, x2 = px + m, px + pw - m
            return (
                f'<polygon points="{x1:.1f},{(py + m):.1f} {cx:.1f},{cy:.1f} {x2:.1f},{(py + m):.1f}" '
                f'fill="none" stroke="{nc}" stroke-width="1.2"/>'
            )
        if opening_type == 'hopper':
            # Bottom-hinged — inward-pointing chevron from the bottom edge (mirror of awning)
            x1, x2 = px + m, px + pw - m
            return (
                f'<polygon points="{x1:.1f},{(py + ph - m):.1f} {cx:.1f},{cy:.1f} {x2:.1f},{(py + ph - m):.1f}" '
                f'fill="none" stroke="{nc}" stroke-width="1.2"/>'
            )
        # fixed / default — corner-to-corner dashed cross
        x1, y1 = px + m, py + m
        x2, y2 = px + pw - m, py + ph - m
        return (
            f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{nc}" stroke-width="0.8" stroke-dasharray="5,3"/>'
            f'<line x1="{x2:.1f}" y1="{y1:.1f}" x2="{x1:.1f}" y2="{y2:.1f}" stroke="{nc}" stroke-width="0.8" stroke-dasharray="5,3"/>'
        )

    def _get_quote_elevation_svg(self):
        """Large, operational front-elevation SVG for the quote PDF card.

        Frame outline (any shape, via _frame_shape_boundary_mm), an inner
        profile line, the pane grid with sliding-arrow / casement-direction
        / fixed-cross notation per pane (_quote_opening_symbol_svg), and
        width/height dimension lines. Bigger and richer than
        _compute_thumbnail_svg(), which stays small and plain for the
        customer portal.
        """
        self.ensure_one()
        total_w, total_h = 340, 260
        margin_l, margin_t, margin_r = 40, 14, 14
        margin_b_dim, margin_b_label = 26, 18
        draw_w = total_w - margin_l - margin_r
        draw_h = total_h - margin_t - margin_b_dim - margin_b_label

        width_mm = max(self.width_mm or 1, 1)
        height_mm = max(self.height_mm or 1, 1)
        scale = min(draw_w / width_mm, draw_h / height_mm)
        shape_w = width_mm * scale
        shape_h = height_mm * scale
        ox = margin_l + (draw_w - shape_w) / 2.0
        oy = margin_t + (draw_h - shape_h) / 2.0

        def to_px(px_mm, py_mm):
            return (ox + px_mm * scale, oy + py_mm * scale)

        outer_pts = [to_px(px, py) for px, py in _frame_shape_boundary_mm(
            self.frame_shape or 'rectangular', width_mm, height_mm, self.frame_shape_points,
        )]
        outer_attr = ' '.join(f'{x:.1f},{y:.1f}' for x, y in outer_pts)
        inner_pts = _inset_points_toward_centroid(outer_pts, max(6.0, scale * 24))
        inner_attr = ' '.join(f'{x:.1f},{y:.1f}' for x, y in inner_pts)
        clip_id = 'qe%d' % (abs(id(self)) % 1_000_000)

        s = f'<polygon points="{outer_attr}" fill="#f8fafc" stroke="#1f2937" stroke-width="3"/>'
        s += f'<polygon points="{inner_attr}" fill="none" stroke="#1f2937" stroke-width="1" opacity="0.5"/>'

        layout = self._get_quote_pane_layout()
        opening_types = self._get_pane_opening_types()
        glass_layer = ''
        for pane, ot in zip(layout, opening_types):
            px, py = to_px(pane['x'], pane['y'])
            pw, ph = pane['w'] * scale, pane['h'] * scale
            glass_layer += (
                f'<rect x="{px:.1f}" y="{py:.1f}" width="{pw:.1f}" height="{ph:.1f}" '
                f'fill="rgba(168,216,240,0.25)" stroke="#1f2937" stroke-width="1"/>'
            )
            glass_layer += self._quote_opening_symbol_svg(px, py, pw, ph, ot)
        s += (
            f'<defs><clipPath id="{clip_id}"><polygon points="{inner_attr}"/></clipPath></defs>'
            f'<g clip-path="url(#{clip_id})">{glass_layer}</g>'
        )

        dim_colour = '#64748b'
        dim_y = oy + shape_h + 14
        s += (
            f'<line x1="{ox:.1f}" y1="{dim_y:.1f}" x2="{(ox + shape_w):.1f}" y2="{dim_y:.1f}" stroke="{dim_colour}" stroke-width="1"/>'
            f'<line x1="{ox:.1f}" y1="{(dim_y - 4):.1f}" x2="{ox:.1f}" y2="{(dim_y + 4):.1f}" stroke="{dim_colour}" stroke-width="1"/>'
            f'<line x1="{(ox + shape_w):.1f}" y1="{(dim_y - 4):.1f}" x2="{(ox + shape_w):.1f}" y2="{(dim_y + 4):.1f}" stroke="{dim_colour}" stroke-width="1"/>'
            f'<text x="{(ox + shape_w / 2):.1f}" y="{(dim_y + 14):.1f}" text-anchor="middle" '
            f'font-family="monospace" font-size="11" fill="{dim_colour}">{width_mm:.0f} mm</text>'
        )
        dim_x = ox - 14
        mid_y = oy + shape_h / 2
        s += (
            f'<line x1="{dim_x:.1f}" y1="{oy:.1f}" x2="{dim_x:.1f}" y2="{(oy + shape_h):.1f}" stroke="{dim_colour}" stroke-width="1"/>'
            f'<line x1="{(dim_x - 4):.1f}" y1="{oy:.1f}" x2="{(dim_x + 4):.1f}" y2="{oy:.1f}" stroke="{dim_colour}" stroke-width="1"/>'
            f'<line x1="{(dim_x - 4):.1f}" y1="{(oy + shape_h):.1f}" x2="{(dim_x + 4):.1f}" y2="{(oy + shape_h):.1f}" stroke="{dim_colour}" stroke-width="1"/>'
            f'<text x="{(dim_x - 6):.1f}" y="{mid_y:.1f}" text-anchor="middle" font-family="monospace" font-size="11" '
            f'fill="{dim_colour}" transform="rotate(-90 {(dim_x - 6):.1f} {mid_y:.1f})">{height_mm:.0f} mm</text>'
        )

        s += (
            f'<text x="{total_w / 2:.1f}" y="{total_h - 6:.1f}" text-anchor="middle" '
            f'font-family="monospace" font-size="10" fill="#334155">Front Elevation</text>'
        )

        return Markup(
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_w}" height="{total_h}" '
            f'viewBox="0 0 {total_w} {total_h}">{s}</svg>'
        )

    def _get_quote_iso_svg(self):
        """Stylized oblique/isometric illustration for the quote PDF card.

        Generalizes the same oblique-projection technique already used for
        bay/bow windows in window_svg.js's renderBayBow3DInset(): the outer
        frame outline is extruded by a shallow depth in a fixed oblique
        direction (drawing a quad band per edge, then the front face on
        top so only the genuine depth sliver shows), giving a frame with
        visible depth, the window's actual colour, and recessed glass.
        This is a flat-shaded technical illustration, not a photorealistic
        render — no 3D engine exists in this codebase.
        """
        self.ensure_one()
        total_w, total_h = 260, 220
        pad = 26
        label_h = 18
        draw_w = total_w - pad * 2
        draw_h = total_h - pad * 2 - label_h

        width_mm = max(self.width_mm or 1, 1)
        height_mm = max(self.height_mm or 1, 1)
        depth_px = min(draw_w, draw_h) * 0.10
        angle = math.radians(35)
        dx, dy = depth_px * math.cos(angle), -depth_px * math.sin(angle)

        scale = min((draw_w - depth_px) / width_mm, (draw_h - depth_px) / height_mm)
        shape_w, shape_h = width_mm * scale, height_mm * scale
        ox = pad + (draw_w - depth_px - shape_w) / 2.0
        oy = pad + depth_px + (draw_h - depth_px - shape_h) / 2.0

        def to_px(px_mm, py_mm):
            return (ox + px_mm * scale, oy + py_mm * scale)

        outer = [to_px(px, py) for px, py in _frame_shape_boundary_mm(
            self.frame_shape or 'rectangular', width_mm, height_mm, self.frame_shape_points,
        )]
        back = [(x + dx, y + dy) for x, y in outer]

        frame_colour = self.frame_colour or '#d8d3c8'
        side_colour = _darken_hex_colour(frame_colour, 0.65)
        edge_colour = _darken_hex_colour(frame_colour, 0.35)

        s = ''
        n = len(outer)
        for i in range(n):
            ax, ay = outer[i]
            bx, by = outer[(i + 1) % n]
            cx, cy = back[(i + 1) % n]
            dxp, dyp = back[i]
            s += (
                f'<polygon points="{ax:.1f},{ay:.1f} {bx:.1f},{by:.1f} {cx:.1f},{cy:.1f} {dxp:.1f},{dyp:.1f}" '
                f'fill="{side_colour}" stroke="{edge_colour}" stroke-width="0.6"/>'
            )

        outer_attr = ' '.join(f'{x:.1f},{y:.1f}' for x, y in outer)
        s += f'<polygon points="{outer_attr}" fill="{frame_colour}" stroke="{edge_colour}" stroke-width="2"/>'

        inner = _inset_points_toward_centroid(outer, max(4.0, depth_px * 0.4))
        inner_attr = ' '.join(f'{x:.1f},{y:.1f}' for x, y in inner)
        s += (
            f'<polygon points="{inner_attr}" fill="rgba(150,200,230,0.45)" '
            f'stroke="rgba(90,140,180,0.6)" stroke-width="1"/>'
        )

        # Mullion seams within the glass area — straight lines, clipped to the inner outline
        clip_id = 'qi%d' % (abs(id(self)) % 1_000_000)
        layout = self._get_quote_pane_layout()
        mullion_layer = ''
        for pane in layout:
            px, py = to_px(pane['x'], pane['y'])
            pw, ph = pane['w'] * scale, pane['h'] * scale
            mullion_layer += (
                f'<rect x="{px:.1f}" y="{py:.1f}" width="{pw:.1f}" height="{ph:.1f}" '
                f'fill="none" stroke="rgba(90,140,180,0.5)" stroke-width="0.8"/>'
            )
        if mullion_layer:
            s += (
                f'<defs><clipPath id="{clip_id}"><polygon points="{inner_attr}"/></clipPath></defs>'
                f'<g clip-path="url(#{clip_id})">{mullion_layer}</g>'
            )

        s += (
            f'<text x="{total_w / 2:.1f}" y="{total_h - 6:.1f}" text-anchor="middle" '
            f'font-family="monospace" font-size="10" fill="#334155">3D Preview</text>'
        )

        return Markup(
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{total_w}" height="{total_h}" '
            f'viewBox="0 0 {total_w} {total_h}">{s}</svg>'
        )

    # ------------------------------------------------------------------
    # Constraints
    # ------------------------------------------------------------------

    @api.constrains('width_mm', 'height_mm')
    def _check_dimensions(self):
        """Enforce minimum and maximum window dimensions."""
        for record in self:
            if record.width_mm < 200:
                raise ValidationError(
                    _('Window width must be at least 200mm (got %dmm).') % record.width_mm
                )
            if record.height_mm < 200:
                raise ValidationError(
                    _('Window height must be at least 200mm (got %dmm).') % record.height_mm
                )
            if record.width_mm > 8000:
                raise ValidationError(
                    _('Window width cannot exceed 8000mm (got %dmm).') % record.width_mm
                )
            if record.height_mm > 5000:
                raise ValidationError(
                    _('Window height cannot exceed 5000mm (got %dmm).') % record.height_mm
                )

    @api.constrains('frame_shape', 'pane_configs', 'panel_tree', 'panels_horizontal', 'panels_vertical')
    def _check_shape_operability(self):
        """Any pane that overlaps the curved/pointed part of the frame must
        be Fixed glazing.

        Real arched/circular/etc. windows are almost always built as a fixed
        transom or fixed lite, not as a sash that is itself (even partly)
        curved AND operable — that combination isn't a real manufactured
        product. For 'arched'/'gothic' the curved part is the rise band at
        the top (spanning the full width); this is checked **per pane**, not
        just "is there only one pane", because a vertical split still leaves
        every resulting pane touching that same top band — splitting left/
        right doesn't separate the curve from the body the way splitting
        top/bottom does (see the "Arch-Top Combination" template). The other
        curved/pointed shapes (circle, octagon, triangle, ...) don't have a
        clean top-only band — most of their perimeter deviates from a
        rectangle — so for those the simpler whole-window rule still applies:
        any split at all means some pane touches the curve, so the window
        must be a single Fixed pane.
        """
        for record in self:
            if record.frame_shape not in CURVED_FRAME_SHAPES:
                continue
            layout = record._get_quote_pane_layout()
            opening_types = record._get_pane_opening_types()
            if not layout or len(layout) != len(opening_types):
                continue
            shape_label = dict(record._fields['frame_shape'].selection).get(
                record.frame_shape, record.frame_shape
            )

            if record.frame_shape in ('arched', 'gothic'):
                rise = _get_arch_rise_mm(record.frame_shape, record.width_mm, record.height_mm)
                for pane, opening_type in zip(layout, opening_types):
                    if pane['y'] < rise and opening_type != 'fixed':
                        raise ValidationError(_(
                            'A %(shape)s frame\'s curved top section must be Fixed glazing — '
                            '"%(opening_type)s" is not a real combination. Split the curved band '
                            'into its own fixed pane, separate from any operable section below.'
                        ) % {'shape': shape_label, 'opening_type': opening_type})
            elif len(layout) == 1 and opening_types[0] != 'fixed':
                raise ValidationError(_(
                    'A %(shape)s frame with a single pane must be Fixed glazing — '
                    '"%(opening_type)s" is not a real combination. Split the window into a '
                    'fixed curved section and a separate rectangular operable section instead.'
                ) % {'shape': shape_label, 'opening_type': opening_types[0]})

    # ------------------------------------------------------------------
    # ORM overrides
    # ------------------------------------------------------------------

    @api.model_create_multi
    def create(self, vals_list):
        """Assign default canvas position and auto-generate barcode."""
        for vals in vals_list:
            if 'canvas_x' not in vals:
                vals['canvas_x'] = 50.0
            if 'canvas_y' not in vals:
                vals['canvas_y'] = 50.0
            if 'canvas_w' not in vals:
                vals['canvas_w'] = max(60.0, (vals.get('width_mm', 1200) / 10.0))
            if 'canvas_h' not in vals:
                vals['canvas_h'] = max(50.0, (vals.get('height_mm', 1000) / 10.0))
            self._sync_frame_colour_from_paint(vals)
        records = super().create(vals_list)
        # Auto-generate barcode for records that don't have one
        for rec in records:
            if not rec.barcode:
                rec.barcode = f'WC-{rec.id:08d}'
        return records

    def write(self, vals):
        """Track fabrication date automatically."""
        if 'fabricated' in vals and vals['fabricated']:
            if 'fabricated_date' not in vals:
                vals['fabricated_date'] = fields.Date.today()
        elif 'fabricated' in vals and not vals['fabricated']:
            vals['fabricated_date'] = False
        self._sync_frame_colour_from_paint(vals)
        return super().write(vals)

    def _sync_frame_colour_from_paint(self, vals):
        """Mirror a newly-selected paint product's swatch onto the render colour.

        The designer canvas writes fields straight via RPC (no onchange), so
        picking a paint product alone would leave the rendered hex stale.
        Skipped when the same call also sets the hex explicitly — that's the
        user manually overriding the swatch, which must win.
        """
        Product = self.env['product.product']
        if 'inside_paint_product_id' in vals and 'frame_colour' not in vals:
            product = Product.browse(vals['inside_paint_product_id'])
            if product.exists() and product.product_tmpl_id.x_paint_colour_hex:
                vals['frame_colour'] = product.product_tmpl_id.x_paint_colour_hex
        if 'outside_paint_product_id' in vals and 'frame_colour_outside' not in vals:
            product = Product.browse(vals['outside_paint_product_id'])
            if product.exists() and product.product_tmpl_id.x_paint_colour_hex:
                vals['frame_colour_outside'] = product.product_tmpl_id.x_paint_colour_hex

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------

    def action_open_form(self):
        """Open this window in a standalone form view."""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': self.name,
            'res_model': 'wincraft.window',
            'res_id': self.id,
            'view_mode': 'form',
            'target': 'new',
        }

    # ------------------------------------------------------------------
    # BOM Component Extraction
    # ------------------------------------------------------------------

    def _get_bom_components(self):
        """Return a list of BOM component dicts for this window.

        Each dict: {name, qty, uom_ref, category}
        """
        self.ensure_one()
        components = []
        w_m = self.width_mm / 1000.0
        h_m = self.height_mm / 1000.0
        # The outer frame profile always follows the true frame outline
        # (e.g. a circle's cut length is its circumference), regardless of
        # how the glazing is internally split into panes.
        _shape_area_m2, perimeter_m = self._get_shape_area_perimeter_m()
        depth = self.profile_depth_mm or '70'
        material = 'uPVC'
        if self.frame_material_id:
            material = self.frame_material_id.name

        # 1. Frame profiles — 4 cuts (2 × width + 2 × height)
        profile_name = f"Frame Profile {material} {depth}mm"
        components.append({
            'name': profile_name,
            'qty': round(perimeter_m, 3),
            'uom_ref': 'uom.product_uom_meter',
            'category': 'profile',
        })

        # Determine pane dimensions and divider lengths from panel tree or legacy grid
        pane_list = []      # [{w_m, h_m, config}]
        divider_list = []   # [{orientation, length_m}]

        if self.panel_tree:
            # Extract from recursive binary tree
            pane_list, divider_list = self._extract_tree_bom(
                self.panel_tree,
                {'x': 0, 'y': 0, 'w': self.width_mm, 'h': self.height_mm},
                20,  # mullion thickness mm
            )
        else:
            # Legacy flat grid fallback
            nH = self.panels_horizontal or 2
            nV = self.panels_vertical or 1
            n_panes = nH * nV
            pane_w_m = w_m / nH
            pane_h_m = h_m / nV
            pane_configs = self.pane_configs or []
            for i in range(n_panes):
                pane_list.append({
                    'w_m': pane_w_m,
                    'h_m': pane_h_m,
                    'config': pane_configs[i] if i < len(pane_configs) else {},
                })
            positions = self.mullion_positions or []
            for mp in positions:
                orientation = mp.get('orientation', 'vertical')
                bar_length_m = h_m if orientation == 'vertical' else w_m
                divider_list.append({'orientation': orientation, 'length_m': bar_length_m})

        # A single pane spanning the whole window takes the shape of the
        # frame itself (e.g. one round IGU in a circular frame) rather than
        # a rectangular cut — sub-panes from a split frame stay rectangular.
        if (
            len(pane_list) == 1
            and self.frame_shape
            and self.frame_shape != 'rectangular'
            and abs(pane_list[0]['w_m'] - w_m) < 1e-6
            and abs(pane_list[0]['h_m'] - h_m) < 1e-6
        ):
            pane_list[0]['area_m2'] = _shape_area_m2
            pane_list[0]['perim_m'] = perimeter_m

        # 2. Mullion / transom bars from divider list
        for div in divider_list:
            bar_name = f"{'Mullion' if div['orientation'] == 'vertical' else 'Transom'} Bar {material} {depth}mm"
            components.append({
                'name': bar_name,
                'qty': round(div['length_m'], 3),
                'uom_ref': 'uom.product_uom_meter',
                'category': 'profile',
            })

        # 3. Glass units — per pane: the Glass Options picked on that pane
        # (canvas), else the popup's In/Middle/Out options, else a flat Glass
        # Type line. Option lines carry their inventory product.
        popup_options = (
            self.glass_out_lite_id | self.glass_middle_lite_id | self.glass_in_lite_id
        )
        lites_by_key = {
            lite._canvas_key(): lite
            for lite in self.env['wincraft.glass.lite'].search([('active', '=', True)])
        }
        sqm_ref = 'uom.product_uom_sqm' if self.env.ref('uom.product_uom_sqm', False) else 'uom.product_uom_unit'
        for pane in pane_list:
            pane_area = pane.get('area_m2', pane['w_m'] * pane['h_m'])
            cfg = pane.get('config') or {}
            positions = {'single': (1,), 'double': (1, 2), 'triple': (1, 2, 3)}.get(
                cfg.get('glazingType') or 'double', (1, 2))
            pane_options = self.env['wincraft.glass.lite']
            for pos in positions:
                pane_options |= lites_by_key.get(cfg.get(f'glass{pos}Key'), pane_options.browse())
            chosen = pane_options or popup_options
            if chosen:
                for lite in chosen:
                    line = {
                        'name': lite.name,
                        'qty': round(pane_area, 4),
                        'uom_ref': sqm_ref,
                        'category': 'glass',
                    }
                    if lite.product_id:
                        line['product_id'] = lite.product_id.id
                    components.append(line)
            else:
                # Flat fallback — single glass line per pane
                glass_name = self.glass_type_id.name if self.glass_type_id else 'Double Glazed Unit'
                components.append({
                    'name': glass_name,
                    'qty': round(pane_area, 4),
                    'uom_ref': sqm_ref,
                    'category': 'glass',
                })

        # 4. Seals / gaskets — perimeter of each glass unit
        seal_total = (
            sum(p.get('perim_m', 2 * (p['w_m'] + p['h_m'])) for p in pane_list)
            if pane_list else perimeter_m
        )
        components.append({
            'name': 'Glazing Seal / Gasket',
            'qty': round(seal_total, 3),
            'uom_ref': 'uom.product_uom_meter',
            'category': 'seal',
        })

        # 5. Hardware
        for hw in self.hardware_ids:
            components.append({
                'name': hw.name,
                'qty': 1,
                'uom_ref': 'uom.product_uom_unit',
                'category': 'hardware',
            })

        # 6. Georgian bars
        gc = self.georgian_bar_config or {}
        pattern = gc.get('pattern', 'none')
        if pattern and pattern != 'none':
            h_bars = gc.get('horizontalBars', 0)
            v_bars = gc.get('verticalBars', 0)
            bar_total_m = 0
            for pane in pane_list:
                bar_total_m += v_bars * pane['h_m']
                bar_total_m += h_bars * pane['w_m']
            if bar_total_m > 0:
                components.append({
                    'name': f'Georgian Bar {material}',
                    'qty': round(bar_total_m, 3),
                    'uom_ref': 'uom.product_uom_meter',
                    'category': 'georgian',
                })

        return components

    def _extract_tree_bom(self, node, bounds, mullion_thick):
        """Recursively extract pane dimensions and divider info from panel tree.

        Returns (pane_list, divider_list).
        """
        if not node or not isinstance(node, dict):
            return [], []

        if node.get('type') == 'leaf':
            return [{
                'w_m': bounds['w'] / 1000.0,
                'h_m': bounds['h'] / 1000.0,
                'config': node.get('config', {}),
            }], []

        if node.get('type') == 'split':
            direction = node.get('direction', 'vertical')
            position = node.get('position', 0)
            half_bar = mullion_thick / 2.0

            if direction == 'vertical':
                # Vertical split → bar runs full height of bounds, at `position` from left
                bar_length_m = bounds['h'] / 1000.0
                first_bounds = {
                    'x': bounds['x'],
                    'y': bounds['y'],
                    'w': max(0, position - bounds['x'] - half_bar),
                    'h': bounds['h'],
                }
                second_bounds = {
                    'x': position + half_bar,
                    'y': bounds['y'],
                    'w': max(0, bounds['x'] + bounds['w'] - position - half_bar),
                    'h': bounds['h'],
                }
            else:
                # Horizontal split → bar runs full width of bounds, at `position` from top
                bar_length_m = bounds['w'] / 1000.0
                first_bounds = {
                    'x': bounds['x'],
                    'y': bounds['y'],
                    'w': bounds['w'],
                    'h': max(0, position - bounds['y'] - half_bar),
                }
                second_bounds = {
                    'x': bounds['x'],
                    'y': position + half_bar,
                    'w': bounds['w'],
                    'h': max(0, bounds['y'] + bounds['h'] - position - half_bar),
                }

            divider = {'orientation': direction, 'length_m': bar_length_m}

            first_panes, first_dividers = self._extract_tree_bom(node.get('first'), first_bounds, mullion_thick)
            second_panes, second_dividers = self._extract_tree_bom(node.get('second'), second_bounds, mullion_thick)

            return (
                first_panes + second_panes,
                [divider] + first_dividers + second_dividers,
            )

        return [], []
