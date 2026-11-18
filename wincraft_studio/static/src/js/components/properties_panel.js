/** @odoo-module **/
/**
 * WinCraft Studio — Properties Panel
 * Right sidebar. Dimensions, Glazing (spec + tint), Frame Colour swatches,
 * Notes, and Price Breakdown table.
 */

import { Component, useState, onWillUpdateProps } from "@odoo/owl";
import { trimAddonPrice, calculateWindowPrice, formatCurrency, resolvePricingRule, hardwareQty, paneGlassCost, popupGlassCost } from "../utils/pricing.js";
import { defaultPaneConfig } from "../utils/state_schema.js";
import { validateConfig, validateWithRules } from "../utils/validation.js";
import { OpeningTypeIcon } from "./opening_type_icon.js";
import { getTypeConfig } from "../utils/window_type_config.js";
import { getArchRise } from "../utils/frame_shape_geometry.js";
import { findNode, updateLeafConfig, computePaneBounds, getSplitNodes, updateSplitConfig, moveDivider, getLeafPanels } from "../utils/panel_tree.js";
import { mmToDisplay, mmToInch, displayToMm, unitLabel, formatArea, formatInchesAsFraction, parseInchesFraction } from "../utils/units.js";
import { computeBayBowChords } from "../utils/window_svg.js";

const OPENING_DIRECTIONS = [
    { key: "left_right", label: "Inward" },
    { key: "fixed",      label: "Outward" },
    { key: "tilt_turn",  label: "Tilt & Turn" },
];

const PROFILE_DEPTHS = [
    { key: "40", label: "40mm" },
    { key: "70", label: "70mm" },
    { key: "90", label: "90mm" },
];

// Options (window trim/casing/extension) get a dedicated two-step group ->
// item picker instead of the generic per-category checkbox list — the
// source catalog has ~300 items across 7 groups, too many for checkboxes.
// See getOptionGroups()/optionsInGroup() below and wincraft_addon_category
// data record `addon_cat_option` (code "option").
const OPTIONS_CATEGORY_CODE = "option";

const BAY_ANGLES = [
    { key: "30", label: "30°" },
    { key: "45", label: "45°" },
    { key: "90", label: "90°" },
    { key: "custom", label: "Custom" },
];

const BOW_ANGLES = [
    { key: "5", label: "5°" },
    { key: "10", label: "10°" },
    { key: "15", label: "15°" },
    { key: "20", label: "20°" },
    { key: "custom", label: "Custom" },
];

// frame_shape values whose outline is curved or pointed — a single pane in
// one of these shapes can only be Fixed glazing (mirrors the server-side
// _check_shape_operability constraint on wincraft.window).
const CURVED_FRAME_SHAPES = [
    "arched", "gothic", "circle", "half_circle",
    "triangle", "trapezoid", "rake", "octagon",
];

console.log("[WinCraft] ✓ LOADED: PropertiesPanel");

const GLASS_TINTS = [
    { key: "clear",     label: "Clear",    hex: "#d4eaf7" },
    { key: "green",     label: "Green",    hex: "#8bc9a0" },
    { key: "teal",      label: "Teal",     hex: "#6ba3a0" },
    { key: "bronze",    label: "Bronze",   hex: "#c4a35a" },
    { key: "grey",      label: "Grey",     hex: "#9ca3af" },
    { key: "blue",      label: "Blue",     hex: "#7da7d9" },
];

const FRAME_COLOURS = [
    { label: "White",   hex: "#f0ede8" },
    { label: "Dark",    hex: "#2d2d2d" },
    { label: "Gold",    hex: "#c7a95c" },
    { label: "Teal",    hex: "#6ba3a0" },
    { label: "Grey",    hex: "#6b7280" },
    { label: "Wood",    hex: "#8b6c42" },
];

const OPENING_TYPES = [
    { key: "fixed",       label: "Fixed",        icon: "fa fa-lock" },
    { key: "casement-l",  label: "Casement L",   icon: "fa fa-sign-in" },
    { key: "casement-r",  label: "Casement R",   icon: "fa fa-sign-out" },
    { key: "awning",      label: "Awning",       icon: "fa fa-level-up" },
    { key: "hopper",      label: "Hopper",       icon: "fa fa-level-down" },
    { key: "tiltturn",    label: "Tilt & Turn",  icon: "fa fa-refresh" },
    { key: "sliding",     label: "Sliding",      icon: "fa fa-arrows-h" },
    { key: "lift-slide",  label: "Lift & Slide", icon: "fa fa-arrow-up" },
    { key: "single-hung", label: "Single Hung",  icon: "fa fa-long-arrow-up" },
    { key: "double-hung", label: "Double Hung",  icon: "fa fa-arrows-v" },
    { key: "bifold",      label: "Bi-Fold",      icon: "fa fa-columns" },
    { key: "pivot",       label: "Pivot",        icon: "fa fa-repeat" },
    { key: "louvre",      label: "Louvre",       icon: "fa fa-bars" },
];

export class PropertiesPanel extends Component {
    static template = "wincraft_studio.PropertiesPanel";
    static components = { OpeningTypeIcon };

    static props = {
        selectedWindow: { optional: true },
        selectedElement: { type: Object, optional: true },
        selectedPaneIds: { type: Array, optional: true },
        materials: { type: Array },
        colors: { type: Array, optional: true },
        glassTypes: { type: Array },
        glazingConfigs: { type: Array, optional: true },
        hardware: { type: Array },
        casementHardware: { type: Array, optional: true },
        addons: { type: Array },
        addonCategories: { type: Array, optional: true },
        paintProducts: { type: Array, optional: true },
        rules: { type: Array, optional: true },
        profileTypes: { type: Array, optional: true },
        pricingRules: { type: Array, optional: true },
        productOptions: { optional: true },
        cavityWidths: { type: Array, optional: true },
        gasFills: { type: Array, optional: true },
        spacerTypes: { type: Array, optional: true },
        glassTints: { type: Array, optional: true },
        openingTypeMaster: { type: Array, optional: true },
        unitSystem: { type: String, optional: true },
        onWindowUpdate: Function,
        onSelectElement: { type: Function, optional: true },
    };

    setup() {
        console.log("[WinCraft] PropertiesPanel → setup() START");
        this.state = useState({
            localFields: {},
            isSaving: false,
            priceBreakdown: null,
            validationResults: [],
            activeTab: 'frame',
            selectedOptionGroup: null,
            // Transient "Company" (vendor) picks for the Vendor Colour
            // block below — not persisted on the window; only the final
            // inside_vendor_color_id/outside_vendor_color_id write. Reset
            // whenever the selected window changes (see onWillUpdateProps).
            vendorColourPick: { inside: null, outside: null },
        });

        onWillUpdateProps((nextProps) => {
            const prev = this.props.selectedWindow;
            const next = nextProps.selectedWindow;
            if (!next) {
                this.state.localFields = {};
                this.state.priceBreakdown = null;
                this.state.vendorColourPick = { inside: null, outside: null };
            } else if (!prev || prev.id !== next.id) {
                this.state.localFields = {};
                this.state.vendorColourPick = { inside: null, outside: null };
                this._refreshBreakdown(next);
            } else if (prev && next && prev.id === next.id && !this._saving) {
                // Same window updated externally (e.g. from toolbar) — clear stale local state
                this.state.localFields = {};
            }
            // Auto-switch to Pane tab when a sub-element is selected
            const el = nextProps.selectedElement;
            if (el && (el.type === 'pane' || el.type === 'mullion' || el.type === 'frame_segment')) {
                this.state.activeTab = 'pane';
            }
        });

        this.frameColours = FRAME_COLOURS;  // fallback; overridden by odooFrameColours getter
        this.openingTypes = OPENING_TYPES;
        this.frameShapes = [
            { key: 'rectangular', label: 'Rectangular' },
            { key: 'arched', label: 'Arched Top' },
            { key: 'gothic', label: 'Gothic Arch' },
            { key: 'circle', label: 'Full Circle' },
            { key: 'half_circle', label: 'Half Circle' },
            { key: 'triangle', label: 'Triangle' },
            { key: 'trapezoid', label: 'Trapezoid' },
            { key: 'rake', label: 'Rake (Angled Top)' },
            { key: 'octagon', label: 'Octagon' },
        ];
        this.georgianPatterns = [
            { key: 'none', label: 'None' },
            { key: 'grid', label: 'Grid' },
            { key: 'diamond', label: 'Diamond' },
            { key: 'sunburst', label: 'Sunburst' },
            { key: 'prairie', label: 'Prairie' },
            { key: 'marginal', label: 'Marginal' },
        ];
        console.log("[WinCraft] PropertiesPanel → setup() DONE ✓");
    }

    // ── Unit System ────────────────────────────────────────────────────────────

    get unitSystem() { return this.props.unitSystem || 'metric'; }
    get dimUnit() { return unitLabel(this.unitSystem); }
    /** Imperial dims display as construction-style fractions (e.g. "47 1/4"),
        matching fabricator convention — see WS-2. Metric stays decimal mm. */
    displayDim(mm) {
        if (this.unitSystem === 'imperial') {
            return formatInchesAsFraction(mmToInch(mm));
        }
        return mmToDisplay(mm, this.unitSystem);
    }
    /** True for the dimension-input `type` attribute: imperial inputs must
        be text (fraction strings like "47 1/4" aren't valid `type="number"`
        values), metric inputs keep the native number widget. */
    get dimInputType() { return this.unitSystem === 'imperial' ? 'text' : 'number'; }
    displayAreaStr(sqm) { return formatArea(sqm, this.unitSystem); }

    // ── Product Options (from wincraft_fenestriflow bridge) ────────────────────

    get productOptions() {
        return this.props.productOptions || null;
    }

    /** Inside Color values from Odoo product.attribute (or empty array as fallback). */
    get odooInsideColors() {
        return this.productOptions?.colorAttributes?.insideColor?.values || [];
    }

    /** Outside Color values from Odoo product.attribute (or empty array as fallback). */
    get odooOutsideColors() {
        return this.productOptions?.colorAttributes?.outsideColor?.values || [];
    }

    /**
     * Frame colour swatches: if Odoo attribute values are available, use them
     * (with a hex colour map fallback for common colour names); otherwise fall
     * back to the hardcoded FRAME_COLOURS array so the UI is always functional.
     */
    get odooFrameColours() {
        const vals = this.odooInsideColors;
        if (!vals.length) return this.frameColours;
        // Map common colour names to hex for the swatch display
        const hexMap = {
            'WHITE': '#f0ede8', 'ALMOND': '#e8dcc8', 'BRONZE': '#c4a35a',
            'GREY': '#6b7280', 'BLACK': '#2d2d2d', 'BROWN': '#8b6c42',
            'TAN': '#c9b48f', 'CLAY': '#a89070', 'DARK BRONZE': '#6b4f2a',
            'MILL': '#c0c0c0', 'ANODIZED': '#909090',
        };
        return vals.map(v => ({
            id: v.id,
            label: v.name,
            hex: hexMap[v.name.toUpperCase()] || '#cccccc',
        }));
    }

    // ── Vendor Colour catalog (WS-15 / WS-17 scoped addition, 2026-09-23) ──────
    // Company → Color cascading picker over wincraft.color, writing
    // inside_vendor_color_id / outside_vendor_color_id. A standalone
    // addition alongside (not a replacement for) the frame_colour hex
    // swatches, the paint-product pickers, and the legacy
    // inside/outside_color_attr_val_id dropdowns above — see
    // docs/sprints/SPRINT_2.md WS-17 scope for why none of the four were
    // unified here.

    /** Sorted, de-duplicated vendor ("Company") names from the catalog. */
    get vendorColourCompanies() {
        const vendors = new Set((this.props.colors || []).map((c) => c.vendor));
        return [...vendors].sort();
    }

    /** The Company currently in effect for `side` ('inside'|'outside'): the
        pending local pick if the user is mid-selection, else the vendor of
        the color already stored on the window, else nothing selected. */
    _vendorColourCompany(side) {
        const pending = this.state.vendorColourPick[side];
        if (pending !== null) return pending;
        const fieldName = side === 'outside' ? 'outside_vendor_color_id' : 'inside_vendor_color_id';
        const current = this.window?.[fieldName];
        if (!current) return '';
        const rec = (this.props.colors || []).find((c) => c.id === current[0]);
        return rec ? rec.vendor : '';
    }

    get vendorColourCompanyInside() { return this._vendorColourCompany('inside'); }
    get vendorColourCompanyOutside() { return this._vendorColourCompany('outside'); }

    /** Colors filtered to the Company currently selected for `side`. */
    _vendorColourOptions(side) {
        const company = this._vendorColourCompany(side);
        if (!company) return [];
        return (this.props.colors || []).filter((c) => c.vendor === company);
    }

    get vendorColourOptionsInside() { return this._vendorColourOptions('inside'); }
    get vendorColourOptionsOutside() { return this._vendorColourOptions('outside'); }

    /** Changing the Company just narrows the Color dropdown — it does not
        write to the window until a Color is actually picked, so switching
        companies by mistake doesn't clear a previously saved colour. */
    onVendorColourCompanyChange(side, vendor) {
        this.state.vendorColourPick[side] = vendor;
    }

    onVendorColourPick(side, rawValue) {
        const fieldName = side === 'outside' ? 'outside_vendor_color_id' : 'inside_vendor_color_id';
        this.onFieldChange(fieldName, rawValue ? parseInt(rawValue, 10) : false);
    }

    /** Glass spec options: the imported Glass Options (see /wincraft/product-options). */
    get glassSpecOptions() {
        return this.productOptions?.glassOptions || [];
    }

    /** Spacer options: dynamic or empty. */
    get spacerOptions() {
        return this.productOptions?.spacerOptions || [];
    }

    // ── Inline Glazing Builder helpers ────────────────────────────────────────

    /** Glass Options from productOptions (wincraft.glass.lite via /wincraft/product-options). */
    get glassConfigOptions() {
        return this.productOptions?.glassOptions || [];
    }

    /**
     * Options offered for one glass position. The supplier price list marks
     * each glass available for Outside / Middle / Inside: position 1 is the
     * outer lite; position 2 is the middle lite of a triple, else the inner
     * lite of a double; position 3 is always the inner lite. A glass already
     * chosen stays listed even if its flag was later turned off.
     */
    glassConfigOptionsFor(position) {
        const gt = this.activePaneConfig?.glazingType || 'double';
        const slot = position === 1 ? 'outside'
            : position === 2 ? (gt === 'triple' ? 'middle' : 'inside')
            : 'inside';
        const current = this.activePaneConfig?.[`glass${position}Key`];
        return this.glassConfigOptions.filter(
            (o) => !o.available || o.available[slot] || o.glass_key === current
        );
    }

    /** Helper: resolve glass config for a given position (1, 2, or 3). */
    _glassConfigFor(position) {
        const key = this.activePaneConfig?.[`glass${position}Key`];
        return key ? this.glassConfigOptions.find(o => o.glass_key === key) || null : null;
    }

    get activeGlass1Config() { return this._glassConfigFor(1); }
    get activeGlass2Config() { return this._glassConfigFor(2); }
    get activeGlass3Config() { return this._glassConfigFor(3); }

    /**
     * Get dynamic attributes for a glass position, enriched with selected value.
     * Returns: [{ attr_id, name, values: [{id, name}], default_value_id, selectedValueId }]
     */
    glassAttributesFor(position) {
        const gcfg = this._glassConfigFor(position);
        if (!gcfg) return [];
        const attrs = gcfg.attributes;
        if (!attrs || !attrs.length) {
            // Legacy fallback: synthesize OT and MIL as pseudo-attributes
            return this._legacyAttrsFor(gcfg, position);
        }
        const paneAttrs = this.activePaneConfig?.[`glass${position}Attrs`] || {};
        return attrs.map(a => ({
            ...a,
            selectedValueId: paneAttrs[String(a.attr_id)] || a.default_value_id,
        }));
    }

    /** Synthesize legacy OT/MIL as pseudo-attribute objects for backward compat. */
    _legacyAttrsFor(gcfg, position) {
        const pc = this.activePaneConfig || {};
        const attrs = pc[`glass${position}Attrs`] || {};
        const result = [];
        if (gcfg.ot_options && gcfg.ot_options.length) {
            result.push({
                attr_id: '_ot',
                name: 'OT',
                values: gcfg.ot_options.map(v => ({ id: v, name: v })),
                default_value_id: gcfg.default_ot || gcfg.ot_options[0],
                selectedValueId: attrs['_ot'] || gcfg.default_ot || gcfg.ot_options[0],
            });
        }
        if (gcfg.mil_options && gcfg.mil_options.length) {
            result.push({
                attr_id: '_mil',
                name: 'MIL',
                values: gcfg.mil_options.map(v => ({ id: v, name: v })),
                default_value_id: gcfg.default_mil || gcfg.mil_options[0],
                selectedValueId: attrs['_mil'] || gcfg.default_mil || gcfg.mil_options[0],
            });
        }
        return result;
    }

    /** Handler for dynamic glass attribute change. */
    onGlassAttrChange(position, attrId, valueId) {
        const pc = this.activePaneConfig || {};
        const currentAttrs = { ...(pc[`glass${position}Attrs`] || {}) };
        currentAttrs[String(attrId)] = valueId;
        this.onPaneConfigChange(`glass${position}Attrs`, currentAttrs);
    }

    /** Get the resolved OT value for a glass position (from dynamic attrs or legacy). */
    _resolvedOTFor(position) {
        const attrs = this.glassAttributesFor(position);
        // Find an attribute whose name is "OT" (case-insensitive)
        const otAttr = attrs.find(a => a.name && a.name.toUpperCase() === 'OT');
        if (otAttr) {
            const selVal = otAttr.values.find(v => v.id === otAttr.selectedValueId || String(v.id) === String(otAttr.selectedValueId));
            return selVal ? selVal.name : '4';
        }
        return '4';
    }

    /** Resolve product variant ID for a glass position from variant_map. */
    resolvedVariantFor(position) {
        const gcfg = this._glassConfigFor(position);
        if (!gcfg || !gcfg.variant_map) return null;
        const paneAttrs = this.activePaneConfig?.[`glass${position}Attrs`] || {};
        const valIds = Object.values(paneAttrs).map(Number).filter(Boolean).sort((a, b) => a - b);
        if (!valIds.length) return null;
        const key = valIds.join(',');
        return gcfg.variant_map[key] || null;
    }

    /** Cavity width options from database. */
    get cavityWidthOptions() {
        return this.props.cavityWidths || [];
    }

    /** Gas fill options from database. */
    get gasFillOptions() {
        return this.props.gasFills || [];
    }

    /** Spacer type options from database. */
    get spacerTypeOptions() {
        return this.props.spacerTypes || [];
    }

    /** Glass tint swatches from database. */
    get glassTints() {
        const tints = this.props.glassTints;
        if (tints && tints.length) {
            return tints.map(t => ({ key: t.code, label: t.name, hex: t.hex_colour }));
        }
        return GLASS_TINTS;
    }

    /** Whether current glazing type needs cavity controls (double/triple). */
    get isMultiGlazing() {
        const gt = this.activePaneConfig?.glazingType || 'double';
        return gt === 'double' || gt === 'triple';
    }

    /** Whether current glazing type is triple. */
    get isTripleGlazing() {
        return (this.activePaneConfig?.glazingType || 'double') === 'triple';
    }

    /** Computed total thickness based on dynamic OT attributes + cavities. */
    get computedGlassThickness() {
        const cfg = this.activePaneConfig;
        if (!cfg) return 0;
        const ot1 = parseInt(this._resolvedOTFor(1)) || 4;
        const gt = cfg.glazingType || 'double';
        if (gt === 'single') return ot1;
        const ot2 = parseInt(this._resolvedOTFor(2)) || 4;
        const cav1 = cfg.cavityWidth || 16;
        if (gt === 'double') return ot1 + cav1 + ot2;
        const ot3 = parseInt(this._resolvedOTFor(3)) || 4;
        const cav2 = cfg.cavityWidth2 || 16;
        return ot1 + cav1 + ot2 + cav2 + ot3;
    }

    /** Short code for the glazing stack, e.g. "4-16-4" or "4-14-4-14-4". */
    get glazingShortCode() {
        const cfg = this.activePaneConfig;
        if (!cfg) return '';
        const ot1 = this._resolvedOTFor(1);
        const gt = cfg.glazingType || 'double';
        if (gt === 'single') return `${ot1}`;
        const ot2 = this._resolvedOTFor(2);
        const cav1 = cfg.cavityWidth || 16;
        if (gt === 'double') return `${ot1}-${cav1}-${ot2}`;
        const ot3 = this._resolvedOTFor(3);
        const cav2 = cfg.cavityWidth2 || 16;
        return `${ot1}-${cav1}-${ot2}-${cav2}-${ot3}`;
    }

    get window() {
        return this.props.selectedWindow
            ? { ...this.props.selectedWindow, ...this.state.localFields }
            : null;
    }

    get hasSelection() {
        return !!this.props.selectedWindow;
    }

    get currentFrameColour() {
        return this.window?.frame_colour || "#f0ede8";
    }

    get currentFrameColourOutside() {
        return this.window?.frame_colour_outside || this.currentFrameColour;
    }

    get selectedInsidePaintProductId() {
        const v = this.window?.inside_paint_product_id;
        if (!v) return null;
        return Array.isArray(v) ? v[0] : v;
    }

    get selectedOutsidePaintProductId() {
        const v = this.window?.outside_paint_product_id;
        if (!v) return null;
        return Array.isArray(v) ? v[0] : v;
    }

    /** Paint product picked from inventory (Inside/Outside) — mirrors the
     * product's swatch hex onto frame_colour(_outside) so the canvas updates
     * immediately, without waiting on the server-side write() sync. */
    onPaintProductChange(side, rawValue) {
        const productId = rawValue ? parseInt(rawValue, 10) : false;
        const idField = side === 'outside' ? 'outside_paint_product_id' : 'inside_paint_product_id';
        const colourField = side === 'outside' ? 'frame_colour_outside' : 'frame_colour';
        this.onFieldChange(idField, productId);
        const product = (this.props.paintProducts || []).find(p => p.id === productId);
        if (product && product.x_paint_colour_hex) {
            this.onFieldChange(colourField, product.x_paint_colour_hex);
        }
    }

    get contextType() {
        const t = this.props.selectedElement?.type;
        if (t === 'frame_segment') return 'frame_segment';
        return t || 'frame';
    }

    get selectedPaneIndex() {
        return this.props.selectedElement?.index ?? null;
    }

    get selectedPanelId() {
        return this.props.selectedElement?.panelId || null;
    }

    /** Stable key for the active pane — used as t-key on selects to force recreation on pane switch. */
    get paneKey() {
        return this.selectedPanelId || String(this.selectedPaneIndex ?? '');
    }

    get activePaneConfig() {
        if (this.contextType !== 'pane') return null;
        const w = this.window;
        if (!w) return null;
        // Tree path: look up leaf config by panelId
        if (w.panel_tree && this.selectedPanelId) {
            const found = findNode(w.panel_tree, this.selectedPanelId);
            if (found && found.node.type === 'leaf') {
                return { ...defaultPaneConfig(), ...found.node.config };
            }
        }
        // Legacy path: use numeric index (merge with defaults so new fields exist)
        if (this.selectedPaneIndex === null) return null;
        const configs = w.pane_configs || [];
        return { ...defaultPaneConfig(), ...(configs[this.selectedPaneIndex] || {}) };
    }

    /** Editable panel label (defaults to P{index+1}) */
    get selectedPaneLabel() {
        const cfg = this.activePaneConfig;
        if (cfg && cfg.label) return cfg.label;
        if (this.selectedPaneIndex !== null) return 'P' + (this.selectedPaneIndex + 1);
        return '-';
    }

    /** Pane dimensions in mm, derived from panel tree or grid geometry */
    get selectedPaneDimensions() {
        const w = this.window;
        if (!w) return { width: 0, height: 0 };
        const widthMm = w.width_mm || 600;
        const heightMm = w.height_mm || 900;
        // Bay / Bow path — use chord widths, frame-deduction for height
        if ((w.window_type === 'bay' || w.window_type === 'bow') && this.selectedPaneIndex !== null) {
            const chords = this.bayBowChords;
            const F = Math.max(8, Math.round(Math.min(widthMm, heightMm) * 0.06));
            return {
                width: Math.round(chords[this.selectedPaneIndex] || 0),
                height: Math.round(heightMm - 2 * F),
            };
        }
        if (w.panel_tree && this.selectedPanelId) {
            const mullionThk = Math.max(4, Math.round(Math.min(widthMm, heightMm) * 0.06) * 0.55);
            const panes = computePaneBounds(
                w.panel_tree,
                { x: 0, y: 0, w: widthMm, h: heightMm },
                mullionThk,
            );
            const found = panes.find(p => p.id === this.selectedPanelId);
            if (found) return { width: Math.round(found.bounds.w), height: Math.round(found.bounds.h) };
        }
        // Legacy grid fallback
        const nH = w.panels_horizontal || 1;
        const nV = w.panels_vertical || 1;
        const F = Math.max(8, Math.round(Math.min(widthMm, heightMm) * 0.06));
        const S = Math.max(4, F * 0.55);
        const pW = (widthMm - F * 2 - (nH - 1) * S) / nH;
        const pH = (heightMm - F * 2 - (nV - 1) * S) / nV;
        return { width: Math.round(pW), height: Math.round(pH) };
    }

    /** Pane area in m² */
    get selectedPaneArea() {
        const dims = this.selectedPaneDimensions;
        return (dims.width * dims.height) / 1e6;
    }

    // ─── Bay / Bow lite layout ────────────────────────────────────────────────

    /** Effective bay/bow lite count (clamped to type bounds). */
    get bayBowLiteCount() {
        const w = this.window;
        if (!w) return 0;
        if (w.window_type === 'bow') return Math.max(3, Math.min(w.bay_lite_count || 5, 8));
        if (w.window_type === 'bay') return Math.max(2, Math.min(w.bay_lite_count || 3, 6));
        return 0;
    }

    /** Resolved per-lite chord widths (mm) — single source of truth, mirrors SVG. */
    get bayBowChords() {
        const w = this.window;
        if (!w || (w.window_type !== 'bay' && w.window_type !== 'bow')) return [];
        return computeBayBowChords({
            type: w.window_type,
            n: this.bayBowLiteCount,
            widthMm: w.width_mm || 600,
            bayCentreRatio: w.bay_centre_ratio || 0.5,
            bayLiteWidths: w.bay_lite_widths || null,
        });
    }

    /** True when the current selection is a lite of a bay/bow window. */
    get isBayBowLiteSelected() {
        const w = this.window;
        return !!(w && (w.window_type === 'bay' || w.window_type === 'bow')
            && this.contextType === 'pane' && this.selectedPaneIndex !== null);
    }

    /** Pretty-printed chord widths for the Frame tab summary. */
    get bayBowChordsLabel() {
        const chords = this.bayBowChords;
        if (!chords.length) return '';
        const unit = this.unitSystem === 'imperial' ? '"' : ' mm';
        return chords.map(c => this.displayDim(c)).join(' / ') + unit;
    }

    /** Update one lite's chord width (mm). Materialises bay_lite_widths from
        current chords if not yet stored, then updates index i. */
    onBayLiteWidthBlur(ev) {
        const isImperial = this.unitSystem === 'imperial';
        const raw = isImperial ? parseInchesFraction(ev.target.value) : Number.parseFloat(ev.target.value);
        if (Number.isNaN(raw) || raw <= 0) return;
        const mm = isImperial ? displayToMm(raw, 'imperial') : Math.round(raw);
        this.onBayLiteWidthChange(mm);
    }

    /** Set the selected lite's chord to exactly `value` mm, redistributing
        the difference across the other lites in proportion to their current
        share. Without this, writing the raw value into one slot and leaving
        stale siblings alone made computeBayBowChords's sum-to-width_mm
        rescale shrink/grow EVERY lite (including the one just edited), so
        the displayed width never matched what was typed — looked like the
        edit silently "didn't take". */
    onBayLiteWidthChange(value) {
        const w = this.window;
        if (!w) return;
        const idx = this.selectedPaneIndex;
        if (idx === null) return;
        const n = this.bayBowLiteCount;
        const totalW = w.width_mm || 600;
        const minEach = 50;
        const mm = Math.round(parseFloat(value) || 0);
        if (mm < minEach) return; // sanity floor

        // Leave at least minEach for every other lite.
        const target = Math.min(mm, totalW - minEach * (n - 1));
        if (target < minEach) return; // window too narrow to fit n lites

        const current = (w.bay_lite_widths && w.bay_lite_widths.length === n)
            ? [...w.bay_lite_widths]
            : this.bayBowChords.map(c => Math.round(c));
        const othersTotal = current.reduce((sum, c, i) => i === idx ? sum : sum + c, 0);
        const remaining = totalW - target;
        const widths = current.map((c, i) => {
            if (i === idx) return target;
            return othersTotal > 0 ? Math.round(c / othersTotal * remaining) : Math.round(remaining / (n - 1));
        });
        this.onFieldChange('bay_lite_widths', widths);
    }

    /** Add or remove a lite. Truncates / extends bay_lite_widths in step. */
    onBayLiteCountChange(delta) {
        const w = this.window;
        if (!w) return;
        const cur = this.bayBowLiteCount;
        const minN = w.window_type === 'bow' ? 3 : 2;
        const maxN = w.window_type === 'bow' ? 8 : 6;
        const next = Math.max(minN, Math.min(cur + delta, maxN));
        if (next === cur) return;
        const patch = { bay_lite_count: next };
        // Sync custom widths if user had any
        if (w.bay_lite_widths && w.bay_lite_widths.length) {
            const widths = [...w.bay_lite_widths];
            const totalW = w.width_mm || 600;
            if (next > cur) {
                const avg = Math.round(totalW / next);
                while (widths.length < next) widths.push(avg);
            } else {
                widths.length = next;
            }
            patch.bay_lite_widths = widths;
        }
        // Sync pane_configs length too (preserve existing where possible)
        const cfgs = (w.pane_configs && w.pane_configs.length) ? [...w.pane_configs] : [];
        while (cfgs.length < next) cfgs.push({ ...defaultPaneConfig() });
        cfgs.length = next;
        patch.pane_configs = cfgs;
        this.props.onWindowUpdate(w.id, patch);
    }

    /** Reset to equal-split / centre-ratio defaults. */
    onBayLiteWidthsReset() {
        const w = this.window;
        if (!w) return;
        this.onFieldChange('bay_lite_widths', null);
    }

    /** Preset angle pills (Bay Angle is a Selection field — values are the
        literal strings '30'/'45'/'90'/'custom', never numbers). */
    get bayAngleOptions() {
        return BAY_ANGLES;
    }

    /** Write the angle directly — must NOT go through onSelectChange(), which
        parseInt()s numeric-looking strings and would corrupt this Selection
        field's '30'/'45'/'90' keys into integers. */
    onBayAngleClick(key) {
        const w = this.window;
        if (!w) return;
        this.onFieldChange('bay_angle', key);
    }

    onBayAngleCustomBlur(ev) {
        const raw = Number.parseFloat(ev.target.value);
        if (Number.isNaN(raw)) return;
        const deg = Math.max(15, Math.min(raw, 120));
        this.onFieldChange('bay_angle_custom_deg', deg);
    }

    /** Preset angle pills for Bow (per-lite arc angle — same Selection-field
        caveat as bayAngleOptions: write through onBowAngleClick(), never
        onSelectChange()). */
    get bowAngleOptions() {
        return BOW_ANGLES;
    }

    onBowAngleClick(key) {
        const w = this.window;
        if (!w) return;
        this.onFieldChange('bow_angle_deg', key);
    }

    onBowAngleCustomBlur(ev) {
        const raw = Number.parseFloat(ev.target.value);
        if (Number.isNaN(raw)) return;
        const deg = Math.max(3, Math.min(raw, 30));
        this.onFieldChange('bow_angle_custom_deg', deg);
    }

    /** Turn the selected window into a Bay or Bow window in one write —
        the one-click fix for "expanding a custom window to bay/bow is
        difficult". Sane defaults + a pane_configs resize, mirroring the
        same resize logic used by onBayLiteCountChange(). */
    onConvertToBayBow(targetType) {
        const w = this.window;
        if (!w) return;
        const n = targetType === 'bow' ? 5 : 3;
        const cfgs = [];
        for (let i = 0; i < n; i++) cfgs.push({ ...defaultPaneConfig() });
        this.props.onWindowUpdate(w.id, {
            window_type: targetType,
            bay_lite_count: n,
            bay_angle: '45',
            bow_angle_deg: '10',
            bay_centre_ratio: 0.5,
            bay_lite_widths: null,
            // Bay/Bow windows never read panel_tree (they use bay_lite_count/
            // bay_lite_widths instead) — clear any tree left over from the
            // window's previous type so it can't shadow the bay/bow-specific
            // code paths keyed off panel_tree truthiness (e.g. mullionHandles).
            panel_tree: null,
            pane_configs: cfgs,
        });
    }

    // ─── Mullion (divider) properties ─────────────────────────────────────────

    get selectedMullionSplitId() {
        return this.props.selectedElement?.splitId || null;
    }

    get selectedMullionInfo() {
        if (this.contextType !== 'mullion') return null;
        const w = this.window;
        if (!w?.panel_tree || !this.selectedMullionSplitId) return null;
        const splits = getSplitNodes(w.panel_tree);
        const split = splits.find(s => s.id === this.selectedMullionSplitId);
        if (!split) return null;
        const found = findNode(w.panel_tree, this.selectedMullionSplitId);
        const config = found?.node?.config || {};
        return {
            id: split.id,
            direction: split.direction,
            position: Math.round(split.position),
            thickness_mm: config.thickness_mm || null,
            material: config.material || null,
            colour: config.colour || null,
        };
    }

    get mullionDefaultThickness() {
        const w = this.window;
        if (!w) return 20;
        const widthMm = w.width_mm || 600;
        const heightMm = w.height_mm || 900;
        return Math.round(Math.max(4, Math.round(Math.min(widthMm, heightMm) * 0.06) * 0.55));
    }

    onMullionConfigChange(field, value) {
        const w = this.window;
        if (!w?.panel_tree || !this.selectedMullionSplitId) return;
        const newTree = updateSplitConfig(w.panel_tree, this.selectedMullionSplitId, { [field]: value });
        this.props.onWindowUpdate(w.id, { panel_tree: newTree });
    }

    // ─── Frame Segment properties ─────────────────────────────────────────────

    get selectedFrameSegmentId() {
        return this.props.selectedElement?.frameSegmentId || null;
    }

    /** Static edge info keyed by segment ID */
    static FRAME_EDGES = {
        F1: { edge: 'top',    label: 'Top Rail' },
        F2: { edge: 'bottom', label: 'Bottom Rail' },
        F3: { edge: 'left',   label: 'Left Stile' },
        F4: { edge: 'right',  label: 'Right Stile' },
    };

    get activeFrameSegment() {
        if (this.contextType !== 'frame_segment') return null;
        const segId = this.selectedFrameSegmentId;
        if (!segId) return null;
        const w = this.window;
        if (!w) return null;
        const edgeInfo = PropertiesPanel.FRAME_EDGES[segId] || { edge: 'unknown', label: segId };
        const widthMm = w.width_mm || 600;
        const heightMm = w.height_mm || 900;
        const defaultFrameMm = Math.round(Math.max(8, Math.round(Math.min(widthMm, heightMm) * 0.06)));
        const isRail = edgeInfo.edge === 'top' || edgeInfo.edge === 'bottom';
        const lengthMm = isRail ? widthMm : Math.round(heightMm - 2 * defaultFrameMm);

        // Merge stored config from frame_segments JSON
        const segments = w.frame_segments || {};
        const stored = segments[segId] || {};
        return {
            id: segId,
            edge: edgeInfo.edge,
            label: stored.label || edgeInfo.label,
            lengthMm: Math.round(lengthMm),
            widthMm: stored.width_mm || defaultFrameMm,
            defaultWidthMm: defaultFrameMm,
            material: stored.material || null,
            colour: stored.colour || null,
        };
    }

    onFrameSegmentConfigChange(field, value) {
        const w = this.props.selectedWindow;
        if (!w) return;
        const segId = this.selectedFrameSegmentId;
        if (!segId) return;
        const segments = { ...(w.frame_segments || {}) };
        segments[segId] = { ...(segments[segId] || {}), [field]: value };
        this.onFieldChange('frame_segments', segments);
    }

    onMullionPositionBlur(ev) {
        const w = this.window;
        if (!w?.panel_tree || !this.selectedMullionSplitId) return;
        const val = Number.parseInt(ev.target.value, 10);
        const widthMm = w.width_mm || 600;
        const heightMm = w.height_mm || 900;
        const info = this.selectedMullionInfo;
        if (!info || !val) return;
        const maxMm = info.direction === 'vertical' ? widthMm : heightMm;
        const clamped = Math.max(50, Math.min(maxMm - 50, val));
        const newTree = moveDivider(w.panel_tree, this.selectedMullionSplitId, clamped);
        this.props.onWindowUpdate(w.id, { panel_tree: newTree });
    }

    onMullionColourChange(ev) {
        this.onMullionConfigChange('colour', ev.target.value || null);
    }

    /* ── Type-aware filtered getters ── */

    get typeConfig() {
        const w = this.props.selectedWindow;
        return getTypeConfig(w?.window_type);
    }

    get typeHint() {
        return this.typeConfig.label || "";
    }

    get filteredFrameShapes() {
        const allowed = this.typeConfig.frameShapes;
        return this.frameShapes.filter(fs => allowed.includes(fs.key));
    }

    get filteredGeorgianPatterns() {
        const allowed = this.typeConfig.georgianPatterns;
        return this.georgianPatterns.filter(gp => allowed.includes(gp.key));
    }

    get showGeorgianBars() {
        // Show if the type allows any pattern besides 'none'
        return this.filteredGeorgianPatterns.some(p => p.key !== "none");
    }

    get filteredOpeningTypes() {
        const allowed = this.typeConfig.openingTypes;
        let types = this.openingTypes.filter(ot => allowed.includes(ot.key));
        const w = this.props.selectedWindow;
        if (w && CURVED_FRAME_SHAPES.includes(w.frame_shape)) {
            if (w.frame_shape === "arched" || w.frame_shape === "gothic") {
                // Only the pane(s) actually touching the curved top band are
                // restricted — a vertical split still leaves every pane
                // touching it, but a horizontal split (combination window)
                // correctly frees the bottom pane.
                const widthMm = w.width_mm || 600;
                const heightMm = w.height_mm || 900;
                const rise = getArchRise(w.frame_shape, widthMm, heightMm);
                const paneY = this.selectedPaneY;
                if (paneY !== null && paneY < rise) {
                    types = types.filter(ot => ot.key === "fixed");
                }
            } else if (this.isSinglePane) {
                // Other curved/pointed shapes (circle, octagon, ...) don't have
                // a clean top-only band — any split touches the curve somewhere.
                types = types.filter(ot => ot.key === "fixed");
            }
        }
        return types;
    }

    /**
     * True when the selected window has exactly one pane (no panel_tree
     * split, or a legacy 1x1 grid). Used to restrict curved/pointed
     * frame_shapes to Fixed-only glazing — see filteredOpeningTypes.
     */
    get isSinglePane() {
        const w = this.props.selectedWindow;
        if (!w) return true;
        if (w.panel_tree) {
            const widthMm = w.width_mm || 600;
            const heightMm = w.height_mm || 900;
            const mullionThk = Math.max(4, Math.round(Math.min(widthMm, heightMm) * 0.06) * 0.55);
            const panes = computePaneBounds(w.panel_tree, { x: 0, y: 0, w: widthMm, h: heightMm }, mullionThk);
            return panes.length <= 1;
        }
        return (w.panels_horizontal || 1) === 1 && (w.panels_vertical || 1) === 1;
    }

    /**
     * Top (y, mm) of the currently selected pane, or null if there's no
     * window/selection to resolve a position from. Used to restrict
     * opening types for panes touching an arched/gothic frame's curved
     * top band — see filteredOpeningTypes.
     */
    get selectedPaneY() {
        const w = this.props.selectedWindow;
        if (!w) return null;
        const widthMm = w.width_mm || 600;
        const heightMm = w.height_mm || 900;
        if (w.panel_tree) {
            if (!this.selectedPanelId) return null;
            const mullionThk = Math.max(4, Math.round(Math.min(widthMm, heightMm) * 0.06) * 0.55);
            const panes = computePaneBounds(w.panel_tree, { x: 0, y: 0, w: widthMm, h: heightMm }, mullionThk);
            const found = panes.find(p => p.id === this.selectedPanelId);
            return found ? found.bounds.y : null;
        }
        if (this.selectedPaneIndex === null || this.selectedPaneIndex === undefined) return null;
        const nH = w.panels_horizontal || 1;
        const nV = w.panels_vertical || 1;
        const row = Math.floor(this.selectedPaneIndex / nH);
        return row * (heightMm / nV);
    }

    /**
     * Opening-type master record for the currently selected pane's openingType.
     * Drives which hardware rows and pill fields to render dynamically.
     */
    get activeOpeningTypeMaster() {
        const ot = this.activePaneConfig?.openingType || 'fixed';
        const masters = this.props.openingTypeMaster || [];
        return masters.find(m => m.key === ot) || null;
    }

    /** Pill field definitions for the current opening type (e.g. hingeSide, foldDirection). */
    get openingPillFields() {
        const master = this.activeOpeningTypeMaster;
        if (!master || !master.pill_fields) return [];
        const PILL_DEFS = {
            hingeSide:      { field: 'hingeSide',      label: 'Hinge Side',     options: ['left', 'right'] },
            foldDirection:  { field: 'foldDirection',   label: 'Fold Direction', options: ['left', 'right'] },
            pivotPosition:  { field: 'pivotPosition',   label: 'Pivot',          options: ['horizontal', 'vertical'] },
        };
        return master.pill_fields.split(',').map(k => PILL_DEFS[k.trim()]).filter(Boolean);
    }

    /** Hardware role labels for dropdown rendering. */
    get openingHardwareRoles() {
        const master = this.activeOpeningTypeMaster;
        if (!master || !master.hardware_roles) return [];
        const ROLE_LABELS = {
            hinge: 'Hinge', handle: 'Handle', lock: 'Lock',
            operator: 'Operator', balance: 'Balance', stay: 'Stay',
            restrictor: 'Restrictor', track: 'Track', other: 'Other',
        };
        return master.hardware_roles.split(',').map(r => {
            const role = r.trim();
            return { role, label: ROLE_LABELS[role] || role };
        }).filter(r => r.role);
    }

    /**
     * Hardware items filtered by role and opening-type compatibility.
     * Returns { role: [hwItem, ...], ... }
     */
    get hardwareByRole() {
        const master = this.activeOpeningTypeMaster;
        const allHw = this.props.hardware || [];
        const result = {};
        if (!master) return result;
        for (const item of allHw) {
            if (!item.active || !item.hardware_role) continue;
            // Check opening type compatibility (empty opening_type_ids = all types)
            if (item.opening_type_ids && item.opening_type_ids.length > 0) {
                if (!item.opening_type_ids.includes(master.id)) continue;
            }
            if (!result[item.hardware_role]) result[item.hardware_role] = [];
            result[item.hardware_role].push(item);
        }
        return result;
    }

    /** Addon categories with scope matching 'pane' or 'both'. */
    get paneAddonCategories() {
        return (this.props.addonCategories || [])
            .filter(c => c.scope === 'pane' || c.scope === 'both')
            .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    }

    /** Addon categories with scope matching 'window' or 'both'.
        Excludes Options — it gets its own group->item picker (see below)
        instead of the generic checkbox list, since it has ~300 items. */
    get windowAddonCategories() {
        return (this.props.addonCategories || [])
            .filter(c => (c.scope === 'window' || c.scope === 'both') && c.code !== OPTIONS_CATEGORY_CODE)
            .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    }

    /**
     * Addons grouped by category code, filtered by opening-type compatibility.
     * Returns { category_code: [addonItem, ...], ... }
     */
    get addonsByCategory() {
        const master = this.activeOpeningTypeMaster;
        const allAddons = this.props.addons || [];
        const result = {};
        for (const item of allAddons) {
            if (!item.active || !item.category_id) continue;
            // Find category code
            const cat = (this.props.addonCategories || []).find(c => c.id === item.category_id[0]);
            if (!cat) continue;
            // Check opening type compatibility (empty = universal)
            if (master && item.opening_type_ids && item.opening_type_ids.length > 0) {
                if (!item.opening_type_ids.includes(master.id)) continue;
            }
            if (!result[cat.code]) result[cat.code] = [];
            result[cat.code].push(item);
        }
        return result;
    }

    /** Window-level addon IDs (from addon_ids M2M). */
    get windowAddonIds() {
        const w = this.window;
        return w ? (w.addon_ids || []) : [];
    }

    /** All active Options-category addon items (the "list of original
        products" the two selects below pick from). */
    get optionAddons() {
        const cat = (this.props.addonCategories || []).find(c => c.code === OPTIONS_CATEGORY_CODE);
        if (!cat) return [];
        return (this.props.addons || []).filter(a => a.active && a.category_id && a.category_id[0] === cat.id);
    }

    /** Distinct group codes among Options addons (source CSV "TYPE" column
        — e.g. B/C/J/X/E/N/blank), sorted with blank last. First select's
        choices; group meaning wasn't confirmed with the source system so
        the raw code is shown rather than a guessed label. */
    get optionGroups() {
        const groups = new Set(this.optionAddons.map(a => a.group_code || ''));
        return [...groups].sort((a, b) => {
            if (!a) return 1;
            if (!b) return -1;
            return a.localeCompare(b);
        });
    }

    /** Currently active group for the Options picker. Defaults to the group
        of the window's already-selected Option (if any) rather than the
        first group, so switching windows shows a consistent picker state. */
    get selectedOptionGroup() {
        if (this.state.selectedOptionGroup !== null) {
            return this.state.selectedOptionGroup;
        }
        const current = this.optionAddons.find(a => this.windowAddonIds.includes(a.id));
        return current ? (current.group_code || '') : '';
    }

    /** Second select's choices: Options addons in the currently active group. */
    get optionsInSelectedGroup() {
        const group = this.selectedOptionGroup;
        return this.optionAddons.filter(a => (a.group_code || '') === group);
    }

    /** The window's currently chosen Option addon id, if any (single choice
        — see onWindowOptionChange). */
    get selectedWindowOptionId() {
        const current = this.optionAddons.find(a => this.windowAddonIds.includes(a.id));
        return current ? current.id : null;
    }

    onOptionGroupChange(group) {
        this.state.selectedOptionGroup = group;
    }

    /** Options are a single choice per window (not a multi-select toggle
        like the generic Add-ons checkboxes) — picking a new one replaces
        whichever Option addon was previously in addon_ids, leaving every
        other category's addons (Grill, Screen, ...) untouched. */
    onWindowOptionChange(addonId) {
        const optionIds = new Set(this.optionAddons.map(a => a.id));
        const withoutOldOption = [...(this.window?.addon_ids || [])].filter(id => !optionIds.has(id));
        if (addonId) withoutOldOption.push(addonId);
        this.onFieldChange('addon_ids', withoutOldOption);
    }

    // Legacy compat — kept for any code referencing showHingeSide
    get showHingeSide() { return false; }
    get filteredHingeSides() { return []; }

    get validationResults() {
        return this.state.validationResults || [];
    }

    get paneValidations() {
        const panelId = this.selectedPanelId;
        if (panelId) {
            return this.validationResults.filter(v => v.panelId === panelId || v.paneIndex === this.selectedPaneIndex);
        }
        if (this.selectedPaneIndex === null) return [];
        return this.validationResults.filter(v => v.paneIndex === this.selectedPaneIndex);
    }

    get frameValidations() {
        return this.validationResults.filter(v => v.paneIndex === null);
    }

    _runValidation() {
        const w = this.window;
        if (!w) { this.state.validationResults = []; return; }
        const cfg = {
            widthMm: w.width_mm || 600,
            heightMm: w.height_mm || 900,
            windowType: w.window_type,
            panelsH: w.panels_horizontal || 1,
            panelsV: w.panels_vertical || 1,
            paneConfigs: w.pane_configs || [],
            mullionPositions: w.mullion_positions || [],
            panelTree: w.panel_tree || null,
            profileTypeId: w.profile_type_id ? (w.profile_type_id[0] || w.profile_type_id) : null,
            profileDepthMm: w.profile_depth_mm || 70,
            frameShape: w.frame_shape || "rectangular",
        };
        const hardcoded = validateConfig(cfg);
        const dbRules = validateWithRules(cfg, this.props.rules || []);
        this.state.validationResults = [...hardcoded, ...dbRules];
    }

    onContextClick(type) {
        if (this.props.onSelectElement) {
            this.props.onSelectElement({ type, index: type === 'pane' ? 0 : null });
        }
    }

    onPaneConfigChange(field, value) {
        console.log("[WinCraft] onPaneConfigChange:", field, "=", value, "paneIdx:", this.selectedPaneIndex, "panelId:", this.selectedPanelId);

        // When openingType changes, set smart defaults for pill fields and clear irrelevant hardware selections
        if (field === 'openingType') {
            const SMART_DEFAULTS = {
                'casement-l': { hingeSide: 'left', hinge: 'left' },
                'casement-r': { hingeSide: 'right', hinge: 'right' },
                'awning':     { hingeSide: null, hinge: 'top' },
                'hopper':     { hingeSide: null, hinge: 'top' },
                'bifold':     { foldDirection: 'left' },
                'pivot':      { pivotPosition: 'horizontal' },
            };
            const defaults = SMART_DEFAULTS[value] || {};
            // Clear all pill fields and hardware selections, then apply relevant defaults
            this._applyPaneConfigBatch({
                openingType: value,
                hingeSide: null, foldDirection: null, pivotPosition: null,
                hardwareSelections: {},
                hinge: defaults.hinge || 'left',
                ...defaults,
            });
            return;
        }

        // Hardware selection changes: merge into hardwareSelections object
        if (field === 'hardwareSelection') {
            const cur = { ...(this.activePaneConfig?.hardwareSelections || {}) };
            // value is { role, id }
            if (value.id) {
                cur[value.role] = value.id;
            } else {
                delete cur[value.role];
            }
            this._applyPaneConfigBatch({ hardwareSelections: cur });
            return;
        }

        // Addon selection changes: merge into addonSelections by category code
        if (field === 'addonSelection') {
            const cur = { ...(this.activePaneConfig?.addonSelections || {}) };
            // value is { categoryCode, addonId }
            if (value.addonId) {
                cur[value.categoryCode] = { addon_id: value.addonId };
            } else {
                delete cur[value.categoryCode];
            }
            this._applyPaneConfigBatch({ addonSelections: cur });
            return;
        }

        // When a glass key changes, cascade default attribute values
        const glassKeyMatch = field.match(/^glass(\d)Key$/);
        if (glassKeyMatch) {
            const pos = glassKeyMatch[1];
            const cfg = value ? this.glassConfigOptions.find(o => o.glass_key === value) : null;
            // Build default attrs dict from the glass config's attributes
            const defaultAttrs = {};
            if (cfg && cfg.attributes && cfg.attributes.length) {
                for (const attr of cfg.attributes) {
                    defaultAttrs[String(attr.attr_id)] = attr.default_value_id;
                }
            } else if (cfg) {
                // Legacy fallback: populate _ot and _mil pseudo-attrs
                if (cfg.default_ot) defaultAttrs['_ot'] = cfg.default_ot;
                if (cfg.default_mil) defaultAttrs['_mil'] = cfg.default_mil;
            }
            this._applyPaneConfigBatch({
                [field]: value || null,
                [`glass${pos}Attrs`]: value ? defaultAttrs : {},
            });
            return;
        }

        // Use this.window (includes pending local changes) not this.props.selectedWindow
        // to avoid race conditions when making rapid changes before async save completes
        const w = this.window;
        if (!w) { console.warn("[WinCraft] onPaneConfigChange: no window, abort"); return; }

        const paneIds = this.props.selectedPaneIds || [];

        // Tree path: update leaf config via updateLeafConfig
        if (w.panel_tree && this.selectedPanelId) {
            console.log("[WinCraft] onPaneConfigChange: using TREE path");
            if (paneIds.length > 1) {
                let tree = w.panel_tree;
                for (const pid of paneIds) {
                    tree = updateLeafConfig(tree, pid, { [field]: value });
                }
                this.onFieldChange('panel_tree', tree);
            } else {
                const newTree = updateLeafConfig(w.panel_tree, this.selectedPanelId, { [field]: value });
                this.onFieldChange('panel_tree', newTree);
            }
            return;
        }
        // Legacy path: update flat pane_configs array
        console.log("[WinCraft] onPaneConfigChange: using LEGACY path, paneIndex:", this.selectedPaneIndex);
        if (this.selectedPaneIndex === null) { console.warn("[WinCraft] selectedPaneIndex is null, abort"); return; }
        const configs = [...(w.pane_configs || [])];
        const indices = paneIds.length > 1 ? paneIds : [this.selectedPaneIndex];
        const maxIdx = Math.max(...indices);
        while (configs.length <= maxIdx) {
            configs.push(defaultPaneConfig());
        }
        for (const idx of indices) {
            configs[idx] = { ...configs[idx], [field]: value };
        }
        console.log("[WinCraft] onPaneConfigChange: updated config =", JSON.stringify(configs[indices[0]]));
        this.onFieldChange('pane_configs', configs);
    }

    /** Apply multiple pane config fields at once (used for cascading glass defaults). */
    _applyPaneConfigBatch(updates) {
        const w = this.window;
        if (!w) return;
        const paneIds = this.props.selectedPaneIds || [];

        if (w.panel_tree && this.selectedPanelId) {
            if (paneIds.length > 1) {
                let tree = w.panel_tree;
                for (const pid of paneIds) {
                    tree = updateLeafConfig(tree, pid, updates);
                }
                this.onFieldChange('panel_tree', tree);
            } else {
                const newTree = updateLeafConfig(w.panel_tree, this.selectedPanelId, updates);
                this.onFieldChange('panel_tree', newTree);
            }
            return;
        }
        // Legacy path
        if (this.selectedPaneIndex === null) return;
        const configs = [...(w.pane_configs || [])];
        const indices = paneIds.length > 1 ? paneIds : [this.selectedPaneIndex];
        const maxIdx = Math.max(...indices);
        while (configs.length <= maxIdx) {
            configs.push(defaultPaneConfig());
        }
        for (const idx of indices) {
            configs[idx] = { ...configs[idx], ...updates };
        }
        this.onFieldChange('pane_configs', configs);
    }

    onFrameColourOutsideClick(hex) {
        this.onFieldChange("frame_colour_outside", hex);
    }

    /** Toggle a window-level addon (checkbox in Frame tab Add-ons section). */
    onWindowAddonToggle(addonId, checked) {
        const cur = [...(this.window?.addon_ids || [])];
        if (checked && !cur.includes(addonId)) {
            cur.push(addonId);
        } else if (!checked) {
            const idx = cur.indexOf(addonId);
            if (idx >= 0) cur.splice(idx, 1);
        }
        this.onFieldChange('addon_ids', cur);
    }

    get priceBreakdown() {
        const bd = this.state.priceBreakdown;
        if (!bd) return { frameCost: 0, glassCost: 0, sealsCost: 0, fabricationCost: 0 };
        return {
            frameCost: bd.frameCost || bd.areaSqm * (bd.baseRate || 0),
            glassCost: bd.glassCost || bd.areaSqm * (bd.glassRate || 0),
            sealsCost: bd.sealsCost || Math.round(bd.areaSqm * 50),
            fabricationCost: bd.fabricationCost || Math.round(bd.areaSqm * 150),
        };
    }

    /** Collect per-window addon items from window-level addon_ids + per-pane addonSelections. */
    _collectAddonItems(w) {
        const allAddons = this.props.addons || [];
        const items = [];
        // Window-level addon_ids (M2M)
        const wIds = w.addon_ids || [];
        for (const id of wIds) {
            const a = allAddons.find(x => x.id === id);
            if (a) items.push({ price: trimAddonPrice(a, w, this.props.colors || []), per_window: a.per_window });
        }
        // Per-pane addonSelections
        const configs = w.pane_configs || [];
        for (const cfg of configs) {
            const sel = cfg?.addonSelections || {};
            for (const catCode of Object.keys(sel)) {
                const addonId = sel[catCode]?.addon_id;
                if (addonId) {
                    const a = allAddons.find(x => x.id === addonId);
                    if (a) items.push({ price: a.price, per_window: true });
                }
            }
        }
        return items;
    }

    /**
     * Collect per-window hardware cost items from window-level hardware_ids
     * (qty 1 each — sill, vent, etc.) + per-pane hardwareSelections (qty from
     * hardwareQty(), matching wincraft_bom_builder.py's _hardware_qty() so a
     * casement's 3 hinges cost 3x here too). Previously this preview always
     * passed hardwareItems: [] — hardware cost was completely invisible while
     * designing even though it's included in the saved/quoted unit_price.
     */
    _collectHardwareItems(w) {
        const allHardware = this.props.hardware || [];
        const items = [];
        const wIds = w.hardware_ids || [];
        for (const id of wIds) {
            const h = allHardware.find(x => x.id === id);
            if (h) items.push({ unit_price: h.unit_price });
        }
        for (const id of w.casement_hardware_ids || []) {
            const h = (this.props.casementHardware || []).find(x => x.id === id);
            if (h) items.push({ unit_price: h.price });
        }
        const leaves = w.panel_tree
            ? getLeafPanels(w.panel_tree)
            : (w.pane_configs || []).map(config => ({ config }));
        for (const leaf of leaves) {
            const cfg = leaf.config || {};
            const sel = cfg.hardwareSelections || {};
            const openingType = cfg.openingType || 'fixed';
            for (const role of Object.keys(sel)) {
                const hwId = sel[role];
                if (!hwId) continue;
                const h = allHardware.find(x => x.id === hwId);
                if (!h) continue;
                items.push({ unit_price: h.unit_price * hardwareQty(role, openingType) });
            }
        }
        return items;
    }

    _refreshBreakdown(w) {
        if (!w) return;
        const merged = { ...w, ...this.state.localFields };
        const m2oId = (val) => (Array.isArray(val) ? val[0] : val) || false;
        const materialId = m2oId(merged.frame_material_id);
        const glassTypeId = m2oId(merged.glass_type_id);
        const mat = this.props.materials.find(m => m.id === materialId) || {};
        const glass = this.props.glassTypes.find(g => g.id === glassTypeId) || {};
        const widthM = (merged.width_mm || 600) / 1000;
        const heightM = (merged.height_mm || 900) / 1000;
        const areaSqm = widthM * heightM;

        // Resolve the real configured Pricing Rule (exact → material-only →
        // glass-only → fallback) — the same lookup the server uses. Falls
        // back to the material/glass's own rate_per_sqm with no fabrication
        // rate when no rule is configured at all, or when this user's role
        // has no read access to pricing rules (see wincraft_designer.js).
        const rule = resolvePricingRule(this.props.pricingRules || [], materialId, glassTypeId);
        const baseRate = rule ? rule.base_rate : (mat.rate_per_sqm || 0);
        const fabricationRate = rule ? rule.fabrication_rate : 0;
        // Glass cost priority (mirrors wincraft.window._glass_cost): Glass
        // Options picked per pane → popup In/Middle/Out choices → Glass Type rate.
        const glassOptions = this.productOptions?.glassOptions || [];
        let glassCostTotal = null;
        if (merged.panel_tree) {
            const leaves = computePaneBounds(
                merged.panel_tree, { x: 0, y: 0, w: merged.width_mm || 600, h: merged.height_mm || 900 }, 20,
            );
            glassCostTotal = paneGlassCost(
                leaves.map(p => ({
                    areaSqm: leaves.length === 1 ? areaSqm : (p.bounds.w * p.bounds.h) / 1e6,
                    config: p.config,
                })),
                glassOptions,
            );
        }
        if (glassCostTotal === null) {
            glassCostTotal = popupGlassCost(
                areaSqm,
                [m2oId(merged.glass_in_lite_id), m2oId(merged.glass_middle_lite_id), m2oId(merged.glass_out_lite_id)],
                glassOptions,
            );
        }
        const glassRate = glassCostTotal !== null
            ? (areaSqm > 0 ? glassCostTotal / areaSqm : 0)
            : (glass.rate_per_sqm || 0);

        const bd = calculateWindowPrice({
            widthMm: merged.width_mm || 600,
            heightMm: merged.height_mm || 900,
            pricingRule: {
                base_rate: baseRate,
                fabrication_rate: fabricationRate,
                margin_pct: merged.margin_pct || (rule ? rule.margin_pct : 20),
                pricing_method: rule ? rule.pricing_method : 'area',
                ui_tiers: rule ? rule.ui_tiers : [],
            },
            glassRatePerSqm: glassRate,
            hardwareItems: this._collectHardwareItems(merged),
            addonItems: this._collectAddonItems(merged),
            profileDepthMm: parseInt(merged.profile_depth_mm) || 70,
            dualColour: merged.frame_colour_outside && merged.frame_colour_outside !== merged.frame_colour,
            paneConfigs: merged.pane_configs || [],
        });
        this.state.priceBreakdown = {
            ...bd,
            areaSqm,
            baseRate,
            glassRate,
            frameCost: Math.round(areaSqm * baseRate),
            glassCost: Math.round(areaSqm * glassRate),
            sealsCost: Math.round(areaSqm * 50),
            fabricationCost: Math.round(areaSqm * fabricationRate),
        };
        this._runValidation();
    }

    async onFieldChange(field, value) {
        console.log("[WinCraft] onFieldChange:", field, "saving:", this._saving);
        this.state.localFields = { ...this.state.localFields, [field]: value };
        const w = this.props.selectedWindow;
        if (!w) return;
        this._refreshBreakdown({ ...w, ...this.state.localFields });

        // Queue the change — merge with any pending patch
        this._pendingSave = { ...(this._pendingSave || {}), [field]: value };

        // If a save is already in flight, the queued patch will be picked up
        // when the current save completes — prevents concurrent ORM writes
        // from racing and overwriting each other.
        if (this._saving) { console.log("[WinCraft] onFieldChange: save in flight, queued"); return; }

        this.state.isSaving = true;
        while (this._pendingSave) {
            const patch = this._pendingSave;
            this._pendingSave = null;
            this._saving = true;
            console.log("[WinCraft] onFieldChange: writing patch", Object.keys(patch));
            try {
                await this.props.onWindowUpdate(w.id, patch);
                console.log("[WinCraft] onFieldChange: save OK for", Object.keys(patch));
            } catch (e) {
                console.error("[WinCraft] PropertiesPanel → onFieldChange CRASHED:", e);
            }
            this._saving = false;
        }
        this.state.isSaving = false;
    }

    onIntFieldBlur(ev, field) {
        const dimFields = ['width_mm', 'height_mm', 'ro_delta_w', 'ro_delta_h'];
        const isImperialDim = dimFields.includes(field) && this.unitSystem === 'imperial';
        // Dimension fields in imperial mode accept fraction entry ("47 1/4");
        // everything else is a plain decimal.
        const raw = isImperialDim ? parseInchesFraction(ev.target.value) : Number.parseFloat(ev.target.value);
        if (Number.isNaN(raw) || raw < 0) return;
        // Dimension fields: positive required; RO deltas: zero allowed
        if ((field === 'width_mm' || field === 'height_mm') && raw <= 0) return;
        // For dimension fields, convert from display unit to mm
        if (isImperialDim) {
            this.onFieldChange(field, displayToMm(raw, 'imperial'));
        } else {
            this.onFieldChange(field, Math.round(raw));
        }
    }

    onFloatFieldBlur(ev, field) {
        const raw = Number.parseFloat(ev.target.value);
        if (Number.isNaN(raw) || raw < 0) return;
        this.onFieldChange(field, Math.round(raw * 1000) / 1000);
    }

    onSelectChange(ev, field) {
        let value = ev.target.value;
        if (!isNaN(parseInt(value, 10))) value = parseInt(value, 10);
        this.onFieldChange(field, value);
    }

    onTextareaBlur(ev, field) {
        this.onFieldChange(field, ev.target.value);
    }

    onFrameColourClick(hex) {
        this.onFieldChange("frame_colour", hex);
    }

    formatPrice(v) { return formatCurrency(v || 0); }

    // ── Material / Profile / Direction handlers (moved from ComponentLibraryPanel) ──

    get openingDirections() { return OPENING_DIRECTIONS; }

    get filteredOpeningDirections() {
        if (!this.props.selectedWindow) return OPENING_DIRECTIONS;
        const allowed = this.typeConfig.openingDirections;
        return OPENING_DIRECTIONS.filter(od => allowed.includes(od.key));
    }

    get selectedDirection() {
        return this.props.selectedWindow?.opening_direction || "left_right";
    }

    get selectedMaterialId() {
        const w = this.props.selectedWindow;
        if (!w || !w.frame_material_id) return null;
        return Array.isArray(w.frame_material_id) ? w.frame_material_id[0] : w.frame_material_id;
    }

    get selectedProfileTypeId() {
        const w = this.props.selectedWindow;
        if (!w || !w.profile_type_id) return null;
        return Array.isArray(w.profile_type_id) ? w.profile_type_id[0] : w.profile_type_id;
    }

    get selectedProfileDepth() {
        return String(this.props.selectedWindow?.profile_depth_mm || "70");
    }

    get availableProfileDepths() {
        const psId = this.selectedProfileTypeId;
        if (psId && this.props.profileTypes) {
            const ps = this.props.profileTypes.find(s => s.id === psId);
            if (ps && ps.available_depths && ps.available_depths.length > 0) {
                return ps.available_depths.map(d => ({ key: String(d), label: `${d}mm` }));
            }
        }
        return PROFILE_DEPTHS;
    }

    onDirectionClick(dir) {
        const w = this.props.selectedWindow;
        if (w) this.props.onWindowUpdate(w.id, { opening_direction: dir });
    }

    onMaterialClick(matId) {
        const w = this.props.selectedWindow;
        if (w) this.props.onWindowUpdate(w.id, { frame_material_id: matId });
    }

    onProfileDepthClick(depth) {
        const w = this.props.selectedWindow;
        if (w) this.props.onWindowUpdate(w.id, { profile_depth_mm: depth });
    }

    onProfileTypeChange(ev) {
        const w = this.props.selectedWindow;
        if (!w) return;
        const val = parseInt(ev.target.value, 10);
        const patch = { profile_type_id: val || false };
        if (val && this.props.profileTypes) {
            const ps = this.props.profileTypes.find(s => s.id === val);
            if (ps) {
                if (ps.material_id) {
                    const matId = Array.isArray(ps.material_id) ? ps.material_id[0] : ps.material_id;
                    patch.frame_material_id = matId;
                }
                if (ps.default_depth_mm) {
                    patch.profile_depth_mm = String(ps.default_depth_mm);
                }
            }
        }
        // Auto-populate default frame_attrs from matched frame config
        const fc = this._frameConfigForPS(val);
        if (fc && fc.attributes && fc.attributes.length) {
            const defaults = {};
            for (const attr of fc.attributes) {
                defaults[String(attr.attr_id)] = attr.default_value_id;
            }
            patch.frame_attrs = defaults;
        } else {
            patch.frame_attrs = {};
        }
        this.props.onWindowUpdate(w.id, patch);
    }

    // ── Dynamic Frame Product Attributes ─────────────────────────────────────

    /**
     * Compute the dominant opening type across all panes in the current window.
     * Prefers non-fixed types; falls back to 'fixed'.
     */
    _dominantOpeningType() {
        const w = this.window;
        if (!w) return 'fixed';
        const counts = {};
        // Walk panel_tree leaves
        if (w.panel_tree) {
            this._countOTInTree(w.panel_tree, counts);
        }
        // Fall back to pane_configs
        if (!Object.keys(counts).length && w.pane_configs) {
            for (const pc of w.pane_configs) {
                if (pc && pc.openingType) {
                    counts[pc.openingType] = (counts[pc.openingType] || 0) + 1;
                }
            }
        }
        if (!Object.keys(counts).length) return 'fixed';
        const nonFixed = Object.entries(counts).filter(([k]) => k !== 'fixed');
        if (nonFixed.length) {
            return nonFixed.sort((a, b) => b[1] - a[1])[0][0];
        }
        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }

    _countOTInTree(node, counts) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'leaf') {
            const ot = node.config?.openingType;
            if (ot) counts[ot] = (counts[ot] || 0) + 1;
        } else {
            this._countOTInTree(node.first, counts);
            this._countOTInTree(node.second, counts);
        }
    }

    /**
     * Find frame config entry matching profile_type_id + dominant OT.
     * Falls back to any entry for the profile system.
     */
    _frameConfigForPS(psId) {
        const configs = this.productOptions?.frameConfigs;
        if (!configs || !psId) return null;
        const ot = this._dominantOpeningType();
        // Exact match first
        let match = configs.find(c => c.profile_type_id === psId && c.opening_type === ot);
        if (!match) {
            // Fallback: any config for this profile system
            match = configs.find(c => c.profile_type_id === psId);
        }
        return match || null;
    }

    /** The active frame config for the current window's profile system + opening type. */
    get activeFrameConfig() {
        const psId = this.selectedProfileTypeId;
        return this._frameConfigForPS(psId);
    }

    /**
     * Dynamic attributes for the active frame product, enriched with selected values.
     * Returns: [{ attr_id, name, values: [{id, name}], default_value_id, selectedValueId }]
     */
    get frameAttributes() {
        const fc = this.activeFrameConfig;
        if (!fc || !fc.attributes || !fc.attributes.length) return [];
        const w = this.window;
        const frameAttrs = w?.frame_attrs || {};
        return fc.attributes.map(a => ({
            ...a,
            selectedValueId: frameAttrs[String(a.attr_id)] || a.default_value_id,
        }));
    }

    /** Handler for dynamic frame attribute change. */
    onFrameAttrChange(attrId, valueId) {
        const w = this.window;
        if (!w) return;
        const currentAttrs = { ...(w.frame_attrs || {}) };
        currentAttrs[String(attrId)] = valueId;
        this.onFieldChange('frame_attrs', currentAttrs);
    }

    /** Resolve product variant ID for the frame from variant_map. */
    get resolvedFrameVariant() {
        const fc = this.activeFrameConfig;
        if (!fc || !fc.variant_map) return null;
        const w = this.window;
        const frameAttrs = w?.frame_attrs || {};
        const valIds = Object.values(frameAttrs).map(Number).filter(Boolean).sort((a, b) => a - b);
        if (!valIds.length) return null;
        const key = valIds.join(',');
        return fc.variant_map[key] || null;
    }

    get areaSqm() {
        if (!this.state.priceBreakdown) return "—";
        return this.state.priceBreakdown.areaSqm.toFixed(3) + " m²";
    }

    get unitPriceFormatted() {
        if (!this.state.priceBreakdown) return "—";
        return formatCurrency(this.state.priceBreakdown.unitPrice);
    }

    get currentGeorgianConfig() {
        const w = this.window;
        return w?.georgian_bar_config || { pattern: 'none', horizontalBars: 1, verticalBars: 1 };
    }

    onGeorgianPatternChange(ev) {
        const cfg = { ...this.currentGeorgianConfig, pattern: ev.target.value };
        this.onFieldChange('georgian_bar_config', cfg);
    }

    onGeorgianBarCountChange(ev, field) {
        const val = parseInt(ev.target.value, 10);
        const max = field === 'barWidthMm' ? 50 : 20;
        if (!isNaN(val) && val >= 0 && val <= max) {
            const cfg = { ...this.currentGeorgianConfig, [field]: val };
            this.onFieldChange('georgian_bar_config', cfg);
        }
    }

    onGeorgianColourChange(ev) {
        const colour = ev.target.value || null;
        const cfg = { ...this.currentGeorgianConfig, colour };
        this.onFieldChange('georgian_bar_config', cfg);
    }
}
