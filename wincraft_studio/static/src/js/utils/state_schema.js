/** @odoo-module **/
/**
 * WinCraft Studio — Configurator State Schema
 *
 * This file documents the complete state shape for the window configurator.
 * It is used as a reference and for default-value generation — not a runtime schema enforcer.
 *
 * All state lives in the root `WincraftDesignerAction.state` (OWL useState)
 * and flows to children via props.
 */

console.log("[WinCraft] ✓ LOADED: utils/state_schema.js");

/**
 * Default pane configuration object.
 * Used when the per-pane overlay is not yet customised.
 */
export function defaultPaneConfig(overrides = {}) {
    return {
        openingType: "fixed",           // 'fixed' | 'casement-l' | 'casement-r' | 'awning' | 'tiltturn' | 'sliding' | 'bifold' | 'louvre' | etc.
        hinge: "left",                  // DEPRECATED — kept for backward compat; use hingeSide
        hingeSide: null,                // 'left' | 'right' — for casement types
        foldDirection: null,            // 'left' | 'right' — for bifold
        pivotPosition: null,            // 'horizontal' | 'vertical' — for pivot
        hardwareSelections: {},         // { role: hardware_record_id } e.g. { handle: 5, lock: 12 }
        glazingType: "double",          // 'single' | 'double' | 'triple'
        glass1Key: null,                // Glass Option key (Optiway code), outer
        glass1Attrs: {},                // Dynamic attribute selections {attr_id: attr_value_id} (outer)
        glass2Key: null,                // glass_key (middle/inner for double, middle for triple)
        glass2Attrs: {},                // Dynamic attribute selections (middle/inner)
        glass3Key: null,                // glass_key (inner, triple only)
        glass3Attrs: {},                // Dynamic attribute selections (inner, triple only)
        cavityWidth: 16,               // mm — cavity 1 gap between lite 1 & 2
        gasFill: "air",                // cavity 1 gas: 'air' | 'argon' | 'krypton' | 'xenon'
        spacerType: "warm_edge",       // cavity 1 spacer
        cavityWidth2: 16,              // mm — cavity 2 gap between lite 2 & 3 (triple only)
        gasFill2: "air",               // cavity 2 gas (triple only)
        spacerType2: "warm_edge",      // cavity 2 spacer (triple only)
        glassTint: "clear",            // 'clear' | 'bronze' | 'grey' | 'blue' | 'green' | 'teal'
        addonSelections: {},           // { category_code: { addon_id: Number, config: {} } }
        label: null,                   // Custom panel label override (e.g. "G1")
        ...overrides,
    };
}

/**
 * Full window configuration shape (one element in `state.windows[]`).
 *
 * Fields prefixed with `_` are transient (not saved to Odoo).
 */
export const WINDOW_SCHEMA = {
    // ── Identity (from ORM) ──────────────────────────────────────────
    id:                 null,       // Integer (ORM record id)
    name:               "",         // Char — auto-composed "Type WxH"

    // ── Core geometry ────────────────────────────────────────────────
    window_type:        "casement", // Selection — key from wincraft.window.type
    width_mm:           1200,       // Integer
    height_mm:          1000,       // Integer
    panels_horizontal:  2,          // Integer (1–6)
    panels_vertical:    1,          // Integer (1–6)
    profile_depth_mm:   70,         // Integer — 40 | 70 | 90

    // ── Per-pane config (JSON field) ─────────────────────────────────
    pane_configs: [
        // One entry per pane (panels_horizontal × panels_vertical).
        // If null or shorter, defaults are synthesised from window-level fields.
        // { openingType, hinge, glazingUnit, glassSpec, glassTint }
    ],

    // ── Mullion positions (JSON field) ───────────────────────────────
    mullion_positions: [
        // { orientation: 'vertical' | 'horizontal', positionMm: Number }
        // If null, positions are computed from equal division.
    ],

    // ── Appearance ───────────────────────────────────────────────────
    frame_colour:           "#f0ede8",   // Char(7) — inside colour (synced from inside_paint_product_id)
    frame_colour_outside:   false,       // Char(7) — outside colour (synced from outside_paint_product_id); blank = same as inside, not a fixed default (see wincraft_window.py)
    inside_paint_product_id:  null,      // Many2one → product.product (x_is_paint_product=True); defaults to seeded "Standard White"
    outside_paint_product_id: null,      // Many2one → product.product (x_is_paint_product=True); defaults to seeded "Standard White"
    frame_material_id:      null,        // Many2one → wincraft.material; server defaults to "uPVC White"
    frame_attrs:            {},          // Dynamic frame attribute selections {attr_id: attr_value_id}
    glass_type_id:          null,        // Many2one → wincraft.glass.type; server defaults to "Double 24mm"
    opening_direction:      "left_right", // Selection — window-level default

    // ── Canvas position ──────────────────────────────────────────────
    canvas_x:   50.0,
    canvas_y:   50.0,

    // ── Pricing ──────────────────────────────────────────────────────
    unit_price: 0,                  // Monetary — computed
    margin_pct: 20.0,               // Float

    // ── Extras ───────────────────────────────────────────────────────
    hardware_ids:   [],             // Many2many → wincraft.hardware
    addon_ids:      [],             // Many2many → wincraft.addon
    notes:          "",             // Text
    fabricated:     false,          // Boolean
};

/**
 * Selection state for contextual right panel.
 */
export const SELECTED_ELEMENT_SCHEMA = {
    type:   null,   // 'frame' | 'pane' | 'mullion' | null
    index:  null,   // Pane index (0-based) or mullion index, or null
};

/**
 * Full configurator root state shape (WincraftDesignerAction.state).
 */
export const ROOT_STATE_SCHEMA = {
    projectId:          0,
    project:            null,       // ORM record from wincraft.project
    windows:            [],         // Array of WINDOW_SCHEMA objects
    materials:          [],         // ORM records from wincraft.material
    glassTypes:         [],         // ORM records from wincraft.glass.type
    hardware:           [],         // ORM records from wincraft.hardware
    addons:             [],         // ORM records from wincraft.addon
    addonCategories:    [],         // ORM records from wincraft.addon.category
    templates:          [],         // ORM records from wincraft.window.template
    selectedIds:        [],         // Array of window IDs
    activeWindowIndex:  0,          // Index into windows[]
    selectedElement:    { ...SELECTED_ELEMENT_SCHEMA },
    isSaving:           false,
    isDirty:            false,
    snapEnabled:        true,
};
