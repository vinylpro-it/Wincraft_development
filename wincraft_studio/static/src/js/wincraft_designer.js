/** @odoo-module **/
/**
 * WinCraft Studio — Root Designer Client Action
 * Registered under tag "wincraft_designer". Launched from project form.
 * Composes: DesignerTopbar, ComponentLibraryPanel, DesignerCanvas,
 *           PropertiesPanel, QuoteBreakdown.
 *
 * Owns all shared state and delegates to children via props.
 */

import { Component, useState, onMounted, useRef } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

import { createHistoryManager } from "./utils/canvas_state.js";
import { DesignerTopbar } from "./components/designer_topbar.js";
import { DesignerConfigHeader } from "./components/designer_config_header.js";
import { WindowConfigurationDialog } from "./components/window_configuration_dialog.js";
import { DesignToolbar } from "./components/design_toolbar.js";
import { DesignerCanvas } from "./components/designer_canvas.js";
import { PropertiesPanel } from "./components/properties_panel.js";
import { BomLivePanel } from "./components/bom_live_panel.js";
import { WindowFilmstrip } from "./components/window_filmstrip.js";
import { NewWindowWizard } from "./components/new_window_wizard.js";
import { QuoteBreakdown } from "./components/quote_breakdown.js";
import { BomPreview } from "./components/bom_preview.js";
import { SaveTemplateDialog } from "./components/save_template_dialog.js";

import { getTypeConfig, getMaxPanels, enforceSashInvariant, setWindowTypeConfig } from "./utils/window_type_config.js";
import { treeFromGrid, treeToGrid, splitPanelAtMidpoint, getLeafPanels, computePaneBounds, updateLeafConfig, getSplitNodes, mergePanel, moveDivider } from "./utils/panel_tree.js";
import { attachUiTiers } from "./utils/pricing.js";
import { getWindowSVG } from "./utils/window_svg.js";

// Fields written by the Window Configuration popup — what the New Window form
// pre-fills from and what it maps onto the created window (and so the BOM).
const WINDOW_CONFIG_FIELDS = [
    "view_from", "profile_type_id", "inside_vendor_color_id",
    "outside_vendor_color_id", "rubber_colour", "glass_in_lite_id", "glass_middle_lite_id",
    "glass_out_lite_id", "brickmould_type_id", "brickmould_colour_id", "casing_colour_id",
    "extension_colour_id", "extension_custom_text", "size_basis", "screen_colour_id",
    "handle_cover_colour", "casement_hardware_ids", "addon_ids",
    "view_from_id", "window_size_id", "rubber_colour_cfg_id",
    "cfg_spacer_id", "handle_cover_colour_cfg_id", "screen_bar_colour_id",
    "screen_mesh_colour_id", "wood_extension_size",
];

// Window fields added by the client's Window Configuration redesign (each M2O
// points at a catalog under Configuration → Window Configuration).
const CONFIG_CATALOG_WINDOW_FIELDS = [
    "view_from_id", "window_size_id", "rubber_colour_cfg_id",
    "cfg_spacer_id", "handle_cover_colour_cfg_id", "screen_bar_colour_id",
    "screen_mesh_colour_id", "wood_extension_size",
];

// state.configCatalogs key -> model, loaded by _loadConfigCatalogs().
const CONFIG_CATALOG_MODELS = {
    viewFrom: "wincraft.view_from",
    windowSize: "wincraft.window_size",
    rubberColour: "wincraft.rubber_colour",
    spacer: "wincraft.spacer",
    handleCoverColour: "wincraft.handle_cover_colour",
    screenBarColour: "wincraft.screen_bar_colour",
    screenMeshColour: "wincraft.screen_mesh_colour",
};

class StatusBar extends Component {
    static template = "wincraft_studio.StatusBar";
    static props = {
        windowCount: { type: Number },
        totalArea: { type: String },
        projectName: { type: String, optional: true },
    };
}

console.log("[WinCraft] ✓ LOADED: WincraftDesignerAction");

export class WincraftDesignerAction extends Component {
    static template = "wincraft_studio.WincraftDesignerAction";
    static components = {
        DesignerTopbar,
        DesignerConfigHeader,
        DesignToolbar,
        DesignerCanvas,
        PropertiesPanel,
        BomLivePanel,
        WindowFilmstrip,
        NewWindowWizard,
        QuoteBreakdown,
        StatusBar,
        BomPreview,
    };

    setup() {
        console.log("[WinCraft] WincraftDesignerAction → setup() START");
        try {
            console.log("[WinCraft] WincraftDesignerAction → calling useService('orm')");
            this.orm = useService("orm");
            console.log("[WinCraft] WincraftDesignerAction → orm OK");

            console.log("[WinCraft] WincraftDesignerAction → calling useService('action')");
            this.action = useService("action");
            console.log("[WinCraft] WincraftDesignerAction → action OK");

            console.log("[WinCraft] WincraftDesignerAction → calling useService('notification')");
            this.notification = useService("notification");
            console.log("[WinCraft] WincraftDesignerAction → notification OK");

            console.log("[WinCraft] WincraftDesignerAction → calling useService('dialog')");
            this.dialogService = useService("dialog");
            console.log("[WinCraft] WincraftDesignerAction → dialog OK");

            // params.project_id (explicitly set by the calling Python action)
            // must win over context.active_id: Odoo auto-injects active_id as
            // the *calling record's own id* whenever a type="object" button
            // returns a client action, so a button on wincraft.window.type's
            // form (action_design_canvas_template) would otherwise leak its
            // own id here instead of the scratch project id it created.
            const projectId = this.props.action.params?.project_id || this.props.action.context?.active_id;
            console.log("[WinCraft] WincraftDesignerAction → projectId:", projectId);

            const templateLinkTypeId = this.props.action.params?.template_link_type_id || null;

            console.log("[WinCraft] WincraftDesignerAction → calling useState");
            this.state = useState({
                projectId: projectId || 0,
                templateLinkTypeId: templateLinkTypeId,
                project: null,
                windows: [],
                materials: [],
                colors: [],
                brickmoulds: [],
                configCatalogs: {},
                rooms: [],
                casementHardware: [],
                // WS-17: values set via the "Window Configuration" popup
                // before any window exists yet — applied as defaults onto
                // the next window created via _createWindow(). Same field
                // shapes as the wincraft.window record itself (raw ids for
                // M2O, plain id arrays for hardware_ids/addon_ids) so
                // WindowConfigurationDialog can treat this and a real
                // window record interchangeably.
                pendingWindowConfig: {},
                profileTypes: [],
                rules: [],
                glassTypes: [],
                glazingConfigs: [],
                hardware: [],
                addons: [],
                addonCategories: [],
                paintProducts: [],
                pricingRules: [],
                templates: [],
                selectedIds: [],
                activeWindowIndex: 0,
                selectedElement: { type: null, index: null, orientation: null, panelId: null, splitId: null },
                selectedPaneIds: [],
                isSaving: false,
                isDirty: false,
                snapEnabled: true,
                showBomPreview: false,
                bomPreviewData: null,
                enabledTypes: [],
                showNewWindowWizard: false,
                showBomPanel: true,
                showPropsPanel: true,
                propsPanelWidth: 260,
                bomPanelWidth: 320,
                productOptions: null,
                openingTypeMaster: [],
                unitSystem: 'metric',
            });
            console.log("[WinCraft] WincraftDesignerAction → state OK");

            this.history = createHistoryManager();

            onMounted(async () => {
                console.log("[WinCraft] WincraftDesignerAction → onMounted START");
                try {
                    if (this.state.projectId) {
                        await this._loadAll();
                    }
                    console.log("[WinCraft] WincraftDesignerAction → onMounted DONE");
                } catch(e) {
                    console.error("[WinCraft] WincraftDesignerAction → onMounted CRASHED:", e);
                    console.error("[WinCraft] Stack:", e.stack);
                }
            });

            console.log("[WinCraft] WincraftDesignerAction → setup() DONE ✓");
        } catch(e) {
            console.error("[WinCraft] WincraftDesignerAction → setup() CRASHED:", e);
            console.error("[WinCraft] Stack:", e.stack);
        }
    }

    // ─── Panel resize via drag ────────────────────────────────────────────────

    onResizeStart(panel, ev) {
        ev.preventDefault();
        const startX = ev.clientX;
        const startWidth = panel === "props" ? this.state.propsPanelWidth : this.state.bomPanelWidth;
        const minW = 200;
        const maxW = 500;

        const onMove = (e) => {
            const delta = panel === "props" ? e.clientX - startX : startX - e.clientX;
            const newWidth = Math.min(maxW, Math.max(minW, startWidth + delta));
            if (panel === "props") {
                this.state.propsPanelWidth = newWidth;
            } else {
                this.state.bomPanelWidth = newWidth;
            }
        };

        const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };

        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    }

    // ─── Data loading ──────────────────────────────────────────────────────────

    /** Loads the Window Configuration lookup catalogs (name/code/description). */
    async _loadConfigCatalogs() {
        const entries = Object.entries(CONFIG_CATALOG_MODELS);
        const rows = await Promise.all(entries.map(([, model]) =>
            this.orm.searchRead(model, [["active", "=", true]], ["name", "code", "description", "sequence"])));
        this.state.configCatalogs = Object.fromEntries(entries.map(([key], i) => [key, rows[i] || []]));
    }

    async _loadAll() {
        console.log("[WinCraft] WincraftDesignerAction → _loadAll() START");
        try {
            const pid = this.state.projectId;
            console.log("[WinCraft] WincraftDesignerAction → _loadAll() loading project", pid);
            const [project, windows, materials, glassTypes, hardware, glazingConfigs, glassLites, addons, templates, profileTypes, rules, productOptionsResp, cavityWidths, gasFills, spacerTypes, glassTints, openingTypes, windowTypes, addonCategories, paintProducts, pricingRules, pricingUiTiers, windowTypeSeries, windowTypeKinds, colors, brickmoulds, rooms, casementHardware] = await Promise.all([
                this.orm.read("wincraft.project", [pid], [
                    "name", "ref", "state", "partner_id",
                    "installation_charge", "discount_pct", "total_price",
                    "is_template_workspace",
                ]),
                this.orm.searchRead("wincraft.window", [["project_id", "=", pid]], [
                    "name", "window_type", "width_mm", "height_mm",
                    "panels", "panels_horizontal", "panels_vertical",
                    "frame_material_id", "glass_type_id", "frame_colour",
                    "frame_colour_outside", "profile_depth_mm",
                    "inside_paint_product_id", "outside_paint_product_id",
                    "inside_vendor_color_id", "outside_vendor_color_id",
                    "view_from", "profile_type_id", "rubber_colour_id", "rubber_colour", ...CONFIG_CATALOG_WINDOW_FIELDS,
                    "glass_in_lite_id", "glass_middle_lite_id", "glass_out_lite_id",
                    "brickmould_type_id", "brickmould_colour_id", "casing_colour_id", "extension_colour_id", "extension_custom_text",
                    "size_basis", "screen_colour_id", "handle_cover_colour", "room_id",
                    "profile_type_id",
                    "frame_shape", "frame_shape_points",
                    "georgian_bar_config",
                    "pane_configs", "mullion_positions", "panel_tree",
                    "opening_direction", "fabricated",
                    "canvas_x", "canvas_y", "unit_price",
                    "hardware_ids", "casement_hardware_ids", "addon_ids", "notes",
                    "ro_delta_w", "ro_delta_h", "rough_opening_w", "rough_opening_h",
                    "energy_star_zone", "er_value", "u_factor", "shgc",
                    "united_inches",
                    "barcode", "production_id", "production_state", "current_station",
                    // Bay & Bow geometry — required by canvas SVG renderer
                    "bay_angle", "bay_angle_custom_deg", "bow_angle_deg", "bow_angle_custom_deg", "bay_lite_count",
                    "bay_centre_ratio", "bay_lite_widths", "projection_depth_mm",
                    "bay_lite_chord_mm", "bay_total_arc_mm", "bow_radius_mm",
                    // Bay & Bow assembly — mulling post, head/seat boards, support kit
                    "mulling_post_width_mm", "head_board_depth_mm", "head_board_thickness_mm",
                    "seat_board_depth_mm", "seat_board_thickness_mm", "insulated_boards",
                    "seat_board_finish", "bay_support_system",
                ]),
                this.orm.searchRead("wincraft.material", [], ["name", "colour_code", "rate_per_sqm", "active"]),
                this.orm.searchRead("wincraft.glass.type", [], ["name", "rate_per_sqm", "active"]),
                this.orm.searchRead("wincraft.hardware", [], ["name", "category", "hardware_role", "opening_type_ids", "unit_price", "active"]),
                Promise.resolve([]), // glazing configs retired — Glass Options are the single glass source
                this.orm.searchRead("wincraft.glass.lite", [["active", "=", true]], [
                    "name", "thickness", "glass_type", "tint_colour", "coating",
                    "coating_surface", "product_id", "product_price",
                    "external_code", "part_name", "sequence",
                    "is_available_outside", "is_available_middle", "is_available_inside",
                    "sf_price_3mm", "sf_price_4mm", "sf_price_5mm", "sf_price_6mm",
                ]),
                this.orm.searchRead("wincraft.addon", [], ["name", "per_window", "price", "active", "category_id", "addon_code", "group_code", "pricing_unit", "pricing_width", "width_qty", "pricing_height", "height_qty", "white_price", "colour_price", "stain_price", "opening_type_ids", "scope", "config_params", "sequence"]),
                this.orm.searchRead("wincraft.window.template", [], [
                    "name", "category", "window_type",
                    "default_width", "default_height", "default_panels",
                    "panels_horizontal", "panels_vertical",
                    "thumbnail_svg",
                    "frame_shape", "panel_tree", "pane_configs",
                ]),
                this.orm.searchRead("wincraft.window.type.series", [["active", "=", true]], [
                    "name", "material_type", "available_depths", "default_depth_mm",
                    "mullion_width_mm", "max_sash_weight_kg", "max_span_mm",
                    "u_value", "colour_options", "material_id", "display_name",
                    "rate_per_metre",
                ]),
                this.orm.searchRead("wincraft.rule", [["active", "=", true]], [
                    "name", "profile_type_id", "window_type",
                    "condition_field", "operator", "threshold", "threshold_upper",
                    "severity", "message", "action",
                ]),
                // Product options from the wincraft_fenestriflow bridge module.
                // Falls back gracefully if the module is not installed.
                fetch('/wincraft/product-options', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: 1, params: {} }),
                }).then(r => r.json()).catch(() => ({ result: null })),
                this.orm.searchRead("wincraft.cavity.width", [["active", "=", true]], ["name", "width_mm", "sequence"]),
                this.orm.searchRead("wincraft.gas.fill", [["active", "=", true]], ["name", "code", "sequence"]),
                this.orm.searchRead("wincraft.spacer.type", [["active", "=", true]], ["name", "code", "sequence"]),
                this.orm.searchRead("wincraft.glass.tint", [["active", "=", true]], ["name", "code", "hex_colour", "sequence"]),
                this.orm.searchRead("wincraft.opening.type", [["active", "=", true]], ["name", "key", "hardware_roles", "pill_fields", "sequence"]),
                this.orm.searchRead("wincraft.window.type", [["active", "=", true]], [
                    "name", "key", "sequence", "frame_shapes", "sash_layouts",
                    "opening_type_ids", "hinge_sides", "georgian_patterns",
                    "allow_mullion", "allow_transom", "opening_directions",
                    "profile_type_id", "kind_id", "template_id", "icon", "template_thumbnail_svg",
                ]),
                this.orm.searchRead("wincraft.addon.category", [["active", "=", true]], ["name", "code", "icon", "scope", "sequence"]),
                this.orm.searchRead("product.product", [["x_is_paint_product", "=", true]],
                    ["name", "x_paint_colour_hex", "x_paint_consumption_per_inch", "x_paint_layers", "standard_price"]),
                // Fabricator/Viewer roles have no read access to pricing rules
                // by design (cost/margin data is sales-confidential) — fall back
                // to an empty list rather than letting an AccessError here abort
                // the whole Promise.all and block the designer from loading.
                this.orm.searchRead("wincraft.pricing.rule", [], [
                    "name", "material_id", "glass_type_id", "base_rate",
                    "fabrication_rate", "margin_pct", "pricing_method",
                ]).catch(() => []),
                this.orm.searchRead("wincraft.pricing.ui.tier", [], ["rule_id", "ui_min", "ui_max", "price"]).catch(() => []),
                this.orm.searchRead("wincraft.window.type.series", [["active", "=", true]], ["name", "sequence"]),
                this.orm.searchRead("wincraft.window.type.kind", [["active", "=", true]], ["name", "code", "sequence"]),
                // Vendor colour catalog (WS-15), consumed by the canvas
                // "Vendor Colour" Company → Color picker (WS-17 scope,
                // scoped addition 2026-09-23) — see properties_panel.js.
                this.orm.searchRead("wincraft.color", [["active", "=", true]], ["vendor", "name", "code", "sequence"]),
                // Brickmould type catalog (WS-17), for the Window Configuration popup's
                // "Brickmould type" dropdown.
                this.orm.searchRead("wincraft.brickmould", [["active", "=", true]], ["name", "code", "sequence"]),
                // Room catalog, for the Window Configuration popup's "Others" Room dropdown.
                this.orm.searchRead("wincraft.room", [["active", "=", true]], ["name", "sequence"]),
                // Casement hardware price list (ID/Description/Price) for the Window Configuration popup.
                this.orm.searchRead("wincraft.casement.hardware", [["active", "=", true]], ["code", "name", "price", "sequence"]),
            ]);
            console.log("[WinCraft] WincraftDesignerAction → _loadAll() ORM calls done");

            this.state.project = project[0] || null;

            // Auto-migrate legacy windows: build panel_tree from grid if missing.
            // Bay/Bow windows are skipped — they have their own dedicated
            // bay_lite_count/bay_lite_widths geometry and never read panel_tree,
            // so migrating one would just persist a meaningless single-leaf tree
            // that then shadows the bay/bow-specific code paths keyed off
            // `w.panel_tree` truthiness elsewhere (e.g. WindowObject.mullionHandles).
            const treeMigrations = [];
            for (const w of windows) {
                if (w.window_type === 'bay' || w.window_type === 'bow') continue;
                if (!w.panel_tree) {
                    w.panel_tree = treeFromGrid(
                        w.panels_horizontal || 1,
                        w.panels_vertical || 1,
                        w.width_mm || 1200,
                        w.height_mm || 1000,
                        w.mullion_positions,
                        w.pane_configs,
                    );
                    treeMigrations.push(
                        this.orm.write("wincraft.window", [w.id], { panel_tree: w.panel_tree })
                    );
                }
            }
            if (treeMigrations.length) {
                try {
                    await Promise.all(treeMigrations);
                    console.log("[WinCraft] Persisted auto-migrated panel_tree for", treeMigrations.length, "window(s)");
                } catch (e) {
                    console.warn("[WinCraft] panel_tree migration save failed (non-fatal):", e);
                }
            }

            this.state.windows = windows;
            this.state.materials = materials;
            this.state.colors = colors || [];
            this.state.brickmoulds = brickmoulds || [];
            this.state.rooms = rooms || [];
            this.state.casementHardware = casementHardware || [];
            await this._loadConfigCatalogs();
            this.state.glassTypes = glassTypes;
            this.state.glazingConfigs = glazingConfigs || [];
            this.state.glassLites = glassLites || [];
            this.state.hardware = hardware;
            this.state.addons = addons;
            this.state.addonCategories = addonCategories || [];
            this.state.paintProducts = paintProducts || [];
            this.state.pricingRules = attachUiTiers(pricingRules || [], pricingUiTiers || []);
            this.state.templates = templates;
            this.state.profileTypes = profileTypes;
            this.state.rules = rules;
            this.state.cavityWidths = cavityWidths || [];
            this.state.gasFills = gasFills || [];
            this.state.spacerTypes = spacerTypes || [];
            this.state.glassTints = glassTints || [];
            this.state.openingTypeMaster = openingTypes || [];
            this.state.windowTypeMaster = windowTypes || [];
            this.state.windowTypeSeries = windowTypeSeries || [];
            this.state.windowTypeKinds = windowTypeKinds || [];

            // Populate the window-type config cache (frame shapes, sash layouts,
            // allowed opening types, etc.) from the DB instead of a hardcoded map.
            const openingTypeKeyById = Object.fromEntries(
                (openingTypes || []).map((ot) => [ot.id, ot.key])
            );
            const seriesSeqById = Object.fromEntries(
                (windowTypeSeries || []).map((s) => [s.id, s.sequence])
            );
            const kindById = Object.fromEntries(
                (windowTypeKinds || []).map((k) => [k.id, k])
            );
            const splitCsv = (val) => (val || "").split(",").map((s) => s.trim()).filter(Boolean);
            setWindowTypeConfig((windowTypes || []).map((wt) => {
                const kind = wt.kind_id ? kindById[wt.kind_id[0]] : null;
                return {
                    key: wt.key,
                    label: wt.name,
                    frameShapes: splitCsv(wt.frame_shapes),
                    sashLayouts: splitCsv(wt.sash_layouts),
                    openingTypes: (wt.opening_type_ids || []).map((id) => openingTypeKeyById[id]).filter(Boolean),
                    hingeSides: splitCsv(wt.hinge_sides),
                    georgianPatterns: splitCsv(wt.georgian_patterns),
                    allowMullion: wt.allow_mullion,
                    allowTransom: wt.allow_transom,
                    openingDirections: splitCsv(wt.opening_directions),
                    seriesId: wt.profile_type_id ? wt.profile_type_id[0] : null,
                    seriesName: wt.profile_type_id ? wt.profile_type_id[1] : null,
                    seriesSequence: wt.profile_type_id ? (seriesSeqById[wt.profile_type_id[0]] ?? 10) : null,
                    kindCode: kind ? kind.code : null,
                    kindName: kind ? kind.name : null,
                    kindSequence: kind ? kind.sequence : 10,
                    templateId: wt.template_id ? wt.template_id[0] : null,
                    iconUrl: wt.icon ? `data:image/png;base64,${wt.icon}` : null,
                    templateThumbnailSvg: wt.template_thumbnail_svg || null,
                };
            }));

            // Product options from bridge module (frame configs, glass, spacers, colors)
            const poResult = productOptionsResp?.result;
            this.state.productOptions = (poResult && poResult.success) ? poResult : null;

            // Derive glassConfigs from productOptions for BOM calculator
            this.state.glassConfigs = this.state.productOptions?.glassOptions || [];

            // Load enabled window types from settings
            try {
                const paramVal = await this.orm.call(
                    "ir.config_parameter", "get_param",
                    ["wincraft_studio.enabled_window_types"],
                );
                if (paramVal) {
                    this.state.enabledTypes = paramVal.split(",").map(s => s.trim()).filter(Boolean);
                }
            } catch (_e) {
                // Fallback: show all types if param not found
            }

            // Load tax percentage from settings (default 5% GST for Canada)
            try {
                const gstParam = await this.orm.call(
                    "ir.config_parameter", "get_param",
                    ["wincraft_studio.gst_pct"],
                );
                if (gstParam) {
                    this.state.gstPct = parseFloat(gstParam) || 5;
                }
            } catch (_e) {
                // Fallback: 5% default
            }

            // Load unit system preference (metric or imperial)
            try {
                const unitParam = await this.orm.call(
                    "ir.config_parameter", "get_param",
                    ["wincraft_studio.unit_system"],
                );
                if (unitParam === 'imperial') {
                    this.state.unitSystem = 'imperial';
                }
            } catch (_e) {
                // Fallback: metric
            }

            // Seed history with the initial state
            this.history.push({ windows: windows.map(w => ({ ...w })) });

            // Auto-select first window
            if (windows.length > 0) {
                this.state.activeWindowIndex = 0;
                this.state.selectedIds = [windows[0].id];
            }
            console.log("[WinCraft] WincraftDesignerAction → _loadAll() DONE, windows:", windows.length);
        } catch(e) {
            console.error("[WinCraft] WincraftDesignerAction → _loadAll() CRASHED:", e);
            console.error("[WinCraft] Stack:", e.stack);
        }
    }

    // ─── Selection ─────────────────────────────────────────────────────────────

    onSelectChange(ids) {
        this.state.selectedIds = ids;
    }

    onSelectElement(el) {
        if (!el || !el.type) {
            // Clear all selection
            this.state.selectedElement = {
                type: null, index: null, orientation: null, panelId: null, splitId: null, frameSegmentId: null,
            };
            this.state.selectedPaneIds = [];
            return;
        }
        if (el.type === 'pane' && el.additive) {
            // Shift+click: toggle pane in multi-select set
            const id = el.index;
            const current = [...this.state.selectedPaneIds];
            const idx = current.indexOf(id);
            if (idx >= 0) {
                current.splice(idx, 1);
            } else {
                current.push(id);
            }
            this.state.selectedPaneIds = current;
            // Keep selectedElement pointing to last added (or first if removed)
            const lastIdx = current.length > 0 ? current.at(-1) : null;
            this.state.selectedElement = {
                type: current.length > 0 ? 'pane' : null,
                index: lastIdx,
                orientation: null,
                panelId: el.panelId || null,
                splitId: null,
            };
        } else {
            // Single select (replaces multi-select)
            this.state.selectedElement = {
                type: el.type || null,
                index: el.index ?? null,
                orientation: el.orientation || null,
                panelId: el.panelId || null,
                splitId: el.splitId || null,
                frameSegmentId: el.frameSegmentId || null,
            };
            if (el.type === 'pane' && el.index != null) {
                this.state.selectedPaneIds = [el.index];
            } else {
                this.state.selectedPaneIds = [];
            }
        }
    }

    get selectedWindow() {
        if (this.state.windows.length === 0) return null;
        const idx = this.state.activeWindowIndex;
        return this.state.windows[idx] || this.state.windows[0] || null;
    }

    get activeWindowForCanvas() {
        const w = this.selectedWindow;
        return w ? [w] : [];
    }

    get activeWindowIndex() {
        return this.state.activeWindowIndex;
    }

    get windowCount() {
        return this.state.windows.length;
    }

    // A template-design scratch project (wincraft.window.type's "Design
    // Canvas Template" action) exists to produce exactly one saved shape —
    // more than one window in that session has nowhere meaningful to go.
    get canAddWindow() {
        return !(this.state.project?.is_template_workspace && this.state.windows.length >= 1);
    }

    /**
     * WS-18: the config header's "New Window" section stays disabled until
     * Window Configuration's required fields are set — confirmed with the
     * user (2026-09-24): Profile, Colour — inside/outside, Casement
     * Hardware, Brickmould Type. Checked against whichever record
     * WindowConfigurationDialog itself edits (a real selected window, or
     * the pendingWindowConfig draft) — same "record" pattern that dialog
     * already uses. M2O fields come back as an `[id, name]` tuple from a
     * real window (ORM read) but a plain id from the draft (see
     * window_configuration_dialog.js's onSelectChange) — _isFieldSet
     * treats both as "set" without caring which shape it is.
     */
    get canOpenNewWindowSection() {
        if (!this.canAddWindow) return false;
        const record = this.selectedWindow || this.state.pendingWindowConfig || {};
        const requiredScalarFields = [
            "profile_type_id",
            "inside_vendor_color_id",
            "outside_vendor_color_id",
        ];
        // Brickmould is now an Options catalog TYPE "B" pick stored in
        // addon_ids; the legacy brickmould_type_id catalog still counts.
        const addonIds = record.addon_ids || [];
        const hasBrickmould = this._isFieldSet(record.brickmould_type_id)
            || (this.state.addons || []).some((a) => a.group_code === "B" && addonIds.includes(a.id));
        const hasScalarFields = hasBrickmould && requiredScalarFields.every((f) => this._isFieldSet(record[f]));
        const hasHardware = Array.isArray(record.casement_hardware_ids) && record.casement_hardware_ids.length > 0;
        return hasScalarFields && hasHardware;
    }

    _isFieldSet(value) {
        if (value === null || value === undefined || value === false) return false;
        if (Array.isArray(value)) return value.length > 0;
        return true;
    }

    onPrevWindow() {
        if (this.state.windows.length === 0) return;
        this.state.activeWindowIndex = (this.state.activeWindowIndex - 1 + this.state.windows.length) % this.state.windows.length;
        const w = this.state.windows[this.state.activeWindowIndex];
        if (w) this.state.selectedIds = [w.id];
    }

    onNextWindow() {
        if (this.state.windows.length === 0) return;
        this.state.activeWindowIndex = (this.state.activeWindowIndex + 1) % this.state.windows.length;
        const w = this.state.windows[this.state.activeWindowIndex];
        if (w) this.state.selectedIds = [w.id];
    }

    // ─── Canvas data flow ──────────────────────────────────────────────────────

    async onWindowsChange(updatedWindows) {
        console.log("[WinCraft] WincraftDesignerAction → onWindowsChange() START, count:", updatedWindows.length);
        try {
            // Handle new window sentinel objects
            const hasNew = updatedWindows.some(w => w._new);
            if (hasNew) {
                const existing = updatedWindows.filter(w => !w._new);
                const newOnes = updatedWindows.filter(w => w._new);
                console.log("[WinCraft] WincraftDesignerAction → onWindowsChange() creating", newOnes.length, "new windows");
                for (const nw of newOnes) {
                    const newRec = await this._createWindow(nw);
                    if (newRec) existing.push(newRec);
                }
                this.state.windows = existing;
                this.state.isDirty = true;
                return;
            }
            this.state.windows = updatedWindows;
            this.state.isDirty = true;
            console.log("[WinCraft] WincraftDesignerAction → onWindowsChange() DONE");
        } catch(e) {
            console.error("[WinCraft] WincraftDesignerAction → onWindowsChange() CRASHED:", e);
            console.error("[WinCraft] Stack:", e.stack);
        }
    }

    // Copies a wincraft.window.template's saved shape/split onto a new
    // window's create() vals. Used both when creating directly from the
    // Component Library Panel (stub._templateId) and when a Window Type
    // picked in the wizard has a default_template linked.
    _applyTemplateGeometry(vals, tpl) {
        vals.source_template_id = tpl.id;
        if (tpl.frame_shape) vals.frame_shape = tpl.frame_shape;
        if (tpl.panel_tree) {
            vals.panel_tree = tpl.panel_tree;
            // Keep panels_horizontal/vertical in step with the tree —
            // _templateValsFromWindow() guarantees these are consistent on
            // the template record, but copy both together here too so a
            // new window's grid fields never silently disagree with the
            // panel_tree it was actually seeded from.
            if (tpl.panels_horizontal) vals.panels_horizontal = tpl.panels_horizontal;
            if (tpl.panels_vertical) vals.panels_vertical = tpl.panels_vertical;
        }
        if (tpl.pane_configs) vals.pane_configs = tpl.pane_configs;
    }

    async _createWindow(stub) {
        console.log("[WinCraft] WincraftDesignerAction → _createWindow() START", stub);
        if (!this.canAddWindow) {
            this.notification.add(
                "Only one window is allowed while designing a Window Type's canvas template.",
                { type: "warning" },
            );
            return null;
        }
        let vals = {
            project_id: this.state.projectId,
            canvas_x: stub.canvas_x || 0,
            canvas_y: stub.canvas_y || 0,
        };

        // WS-17: seed from any "Window Configuration" defaults set before
        // this window existed — applied first so the wizard/template-derived
        // vals below (window_type/width/height/profile_type_id/etc.) can
        // still override on a field-by-field basis where both set the same
        // key (e.g. an explicit Profile choice in the wizard wins over a
        // pending default).
        const pendingConfig = this.state.pendingWindowConfig || {};
        for (const [key, value] of Object.entries(pendingConfig)) {
            const isEmpty = value === undefined || value === null || value === ''
                || (Array.isArray(value) && value.length === 0);
            if (!isEmpty) vals[key] = value;
        }

        // New Window form: its (possibly locally edited) configuration copy and
        // Room win over the saved draft defaults.
        for (const [key, value] of Object.entries(stub.window_config || {})) {
            if (this._isFieldSet(value)) vals[key] = value;
        }

        if (stub._templateId) {
            const tpl = this.state.templates.find(t => t.id === stub._templateId);
            if (tpl) {
                vals.window_type = tpl.window_type || "casement";
                vals.width_mm = tpl.default_width || 1200;
                vals.height_mm = tpl.default_height || 1000;
                this._applyTemplateGeometry(vals, tpl);
            }
        } else if (stub._type) {
            vals.window_type = stub._type;
            vals.width_mm = 1200;
            vals.height_mm = 1000;
        } else if (stub.window_type) {
            // Called from the new window wizard (passes window_type, width_mm, height_mm directly)
            vals.window_type = stub.window_type;
            vals.width_mm = stub.width_mm || 1200;
            vals.height_mm = stub.height_mm || 1000;
            if (stub.name) vals.name = stub.name;
            if (stub.frame_material_id) vals.frame_material_id = stub.frame_material_id;
            if (stub.profile_type_id) vals.profile_type_id = stub.profile_type_id;
            // Bay / Bow setup from the wizard's inline configuration step
            if (stub.bay_lite_count) vals.bay_lite_count = stub.bay_lite_count;
            if (stub.bay_angle) vals.bay_angle = stub.bay_angle;
            if (stub.bay_angle_custom_deg) vals.bay_angle_custom_deg = stub.bay_angle_custom_deg;
            if (stub.bow_angle_deg) vals.bow_angle_deg = stub.bow_angle_deg;
            if (stub.bow_angle_custom_deg) vals.bow_angle_custom_deg = stub.bow_angle_custom_deg;
            if (stub.bay_centre_ratio) vals.bay_centre_ratio = stub.bay_centre_ratio;
            // If the chosen Window Type has a default canvas template linked
            // (wincraft.window.type.template_id), apply its starting frame
            // shape / panel split — the wizard's own width/height/material
            // choices still win, only the shape/split comes from the template.
            // Falls through untouched (blank rectangular pane) when unset.
            const typeRec = (this.state.windowTypeMaster || []).find(wt => wt.key === stub.window_type);
            const typeTemplateId = typeRec && typeRec.template_id ? typeRec.template_id[0] : null;
            if (typeTemplateId) {
                const tpl = this.state.templates.find(t => t.id === typeTemplateId);
                if (tpl) this._applyTemplateGeometry(vals, tpl);
            }
        }

        try {
            console.log("[WinCraft] WincraftDesignerAction → _createWindow() orm.create", vals);
            const newId = await this.orm.create("wincraft.window", [vals]);
            const records = await this.orm.read("wincraft.window", [newId[0] || newId], [
                "name", "window_type", "width_mm", "height_mm",
                "panels", "panels_horizontal", "panels_vertical",
                "frame_material_id", "glass_type_id", "frame_colour",
                "frame_colour_outside", "profile_depth_mm",
                "inside_paint_product_id", "outside_paint_product_id",
                "inside_vendor_color_id", "outside_vendor_color_id",
                "view_from", "profile_type_id", "rubber_colour_id", "rubber_colour", ...CONFIG_CATALOG_WINDOW_FIELDS,
                    "glass_in_lite_id", "glass_middle_lite_id", "glass_out_lite_id",
                "brickmould_type_id", "brickmould_colour_id", "casing_colour_id", "extension_colour_id", "extension_custom_text",
                    "size_basis", "screen_colour_id", "handle_cover_colour", "room_id",
                "profile_type_id",
                "frame_shape", "frame_shape_points",
                "georgian_bar_config",
                "pane_configs", "mullion_positions", "panel_tree",
                "opening_direction", "fabricated",
                "canvas_x", "canvas_y", "unit_price",
                "hardware_ids", "casement_hardware_ids", "addon_ids", "notes",
                "bay_angle", "bay_angle_custom_deg", "bow_angle_deg", "bow_angle_custom_deg", "bay_lite_count",
                "bay_centre_ratio", "bay_lite_widths", "projection_depth_mm",
                "bay_lite_chord_mm", "bay_total_arc_mm", "bow_radius_mm",
                "mulling_post_width_mm", "head_board_depth_mm", "head_board_thickness_mm",
                "seat_board_depth_mm", "seat_board_thickness_mm", "insulated_boards",
                "seat_board_finish", "bay_support_system",
            ]);
            const rec = records[0];
            // Auto-build panel_tree for new window if not set (bay/bow windows
            // don't use panel_tree — see the auto-migration loop above for why).
            if (!rec.panel_tree && rec.window_type !== 'bay' && rec.window_type !== 'bow') {
                rec.panel_tree = treeFromGrid(
                    rec.panels_horizontal || 1, rec.panels_vertical || 1,
                    rec.width_mm || 1200, rec.height_mm || 1000,
                    rec.mullion_positions, rec.pane_configs,
                );
            }
            this.notification.add(`Window "${rec.name}" added`, { type: "info" });
            console.log("[WinCraft] WincraftDesignerAction → _createWindow() DONE, id:", rec.id);
            return rec;
        } catch (err) {
            console.error("[WinCraft] WincraftDesignerAction → _createWindow() CRASHED:", err);
            console.error("[WinCraft] Stack:", err.stack);
            this.notification.add("Failed to create window", { type: "danger" });
            return null;
        }
    }

    // ─── Window property update (from Properties Panel) ─────────────────────────

    async onWindowUpdate(id, patch) {
        console.log("[WinCraft] WincraftDesignerAction → onWindowUpdate() START", id, patch);
        try {
            // Enforce sash invariant: panel counts must match mullion counts + 1
            const currentW = this.state.windows.find(w => w.id === id);
            if (currentW && patch.mullion_positions) {
                enforceSashInvariant(patch, currentW);
            }
            await this.orm.write("wincraft.window", [id], patch);
            const records = await this.orm.read("wincraft.window", [id], [
                "name", "window_type", "width_mm", "height_mm",
                "panels", "panels_horizontal", "panels_vertical",
                "frame_material_id", "glass_type_id", "frame_colour",
                "frame_colour_outside", "profile_depth_mm",
                "inside_paint_product_id", "outside_paint_product_id",
                "inside_vendor_color_id", "outside_vendor_color_id",
                "view_from", "profile_type_id", "rubber_colour_id", "rubber_colour", ...CONFIG_CATALOG_WINDOW_FIELDS,
                    "glass_in_lite_id", "glass_middle_lite_id", "glass_out_lite_id",
                "brickmould_type_id", "brickmould_colour_id", "casing_colour_id", "extension_colour_id", "extension_custom_text",
                    "size_basis", "screen_colour_id", "handle_cover_colour", "room_id",
                "profile_type_id",
                "frame_shape", "frame_shape_points",
                "georgian_bar_config",
                "pane_configs", "mullion_positions", "panel_tree",
                "opening_direction", "fabricated",
                "canvas_x", "canvas_y", "unit_price",
                "hardware_ids", "casement_hardware_ids", "addon_ids", "notes",
                "ro_delta_w", "ro_delta_h", "rough_opening_w", "rough_opening_h",
                "energy_star_zone", "er_value", "u_factor", "shgc",
                "united_inches",
                "barcode", "production_id", "production_state", "current_station",
                "bay_angle", "bay_angle_custom_deg", "bow_angle_deg", "bow_angle_custom_deg", "bay_lite_count",
                "bay_centre_ratio", "bay_lite_widths", "projection_depth_mm",
                "bay_lite_chord_mm", "bay_total_arc_mm", "bow_radius_mm",
                "mulling_post_width_mm", "head_board_depth_mm", "head_board_thickness_mm",
                "seat_board_depth_mm", "seat_board_thickness_mm", "insulated_boards",
                "seat_board_finish", "bay_support_system",
            ]);
            if (records.length) {
                this.state.windows = this.state.windows.map(w => {
                    if (w.id !== id) return w;
                    const merged = { ...w, ...records[0] };
                    // Preserve in-memory panel_tree if DB returned null
                    // (can happen if tree hasn't been persisted yet)
                    if (!merged.panel_tree && w.panel_tree) {
                        merged.panel_tree = w.panel_tree;
                    }
                    return merged;
                });
            }
            this.state.isDirty = true;
            console.log("[WinCraft] WincraftDesignerAction → onWindowUpdate() DONE");
        } catch (err) {
            console.error("[WinCraft] WincraftDesignerAction → onWindowUpdate() CRASHED:", err);
            console.error("[WinCraft] Stack:", err.stack);
            this.notification.add("Update failed", { type: "danger" });
        }
    }

    // ─── Divider drop & delete (from canvas drag-drop / dblclick) ──────────────

    async onDividerDrop({ windowId, orientation, positionMm, targetPanelId }) {
        const w = this.state.windows.find(win => win.id === windowId);
        if (!w) return;
        const widthMm = w.width_mm || 1200;
        const heightMm = w.height_mm || 1000;

        // Panel tree path — split the target panel at the drop position
        if (w.panel_tree || targetPanelId) {
            let tree = w.panel_tree;
            if (!tree) {
                tree = treeFromGrid(
                    w.panels_horizontal || 1, w.panels_vertical || 1,
                    widthMm, heightMm, w.mullion_positions, w.pane_configs,
                );
            }
            // If targetPanelId specified, split that panel; otherwise find panel at position
            let panelId = targetPanelId;
            if (!panelId) {
                const bounds = { x: 0, y: 0, w: widthMm, h: heightMm };
                const panes = computePaneBounds(tree, bounds, 20);
                const hit = panes.find(p => {
                    if (orientation === 'vertical') {
                        return positionMm > p.bounds.x && positionMm < p.bounds.x + p.bounds.w;
                    }
                    return positionMm > p.bounds.y && positionMm < p.bounds.y + p.bounds.h;
                });
                panelId = hit ? hit.id : null;
            }
            if (!panelId) return;

            const direction = orientation === 'vertical' ? 'vertical' : 'horizontal';
            const newTree = splitPanelAtMidpoint(tree, panelId, direction, widthMm, heightMm);
            const grid = treeToGrid(newTree, widthMm, heightMm);
            await this.onWindowUpdate(w.id, {
                panel_tree: newTree,
                panels_horizontal: grid.panelsH,
                panels_vertical: grid.panelsV,
                mullion_positions: grid.mullionPositions,
                pane_configs: grid.paneConfigs,
            });
            return;
        }

        // Legacy path
        const nH = w.panels_horizontal || 1;
        const nV = w.panels_vertical || 1;

        const positions = w.mullion_positions ? [...w.mullion_positions] : [];
        positions.push({ orientation, positionMm });

        const newH = orientation === 'vertical' ? nH + 1 : nH;
        const newV = orientation === 'horizontal' ? nV + 1 : nV;

        const needed = newH * newV;
        const configs = w.pane_configs ? [...w.pane_configs] : [];
        while (configs.length < needed) {
            configs.push({
                openingType: "fixed", hinge: "left",
                glazingUnit: "double-4-16-4", glassSpec: "clear", glassTint: "clear",
            });
        }

        await this.onWindowUpdate(w.id, {
            panels_horizontal: newH,
            panels_vertical: newV,
            mullion_positions: positions,
            pane_configs: configs.slice(0, needed),
        });
    }

    async onResetPane({ windowId, paneIndex, panelId }) {
        const w = this.state.windows.find(win => win.id === windowId);
        if (!w) return;

        // Tree mode — update the leaf config via panelId
        if (w.panel_tree && panelId) {
            const newTree = updateLeafConfig(w.panel_tree, panelId, { openingType: 'fixed', hinge: 'left' });
            const grid = treeToGrid(newTree, w.width_mm, w.height_mm);
            await this.onWindowUpdate(w.id, {
                panel_tree: newTree,
                pane_configs: grid.paneConfigs,
            });
            return;
        }

        // Legacy path
        const configs = w.pane_configs ? [...w.pane_configs] : [];
        if (configs[paneIndex]) {
            configs[paneIndex] = { ...configs[paneIndex], openingType: 'fixed', hinge: 'left' };
        }
        await this.onWindowUpdate(w.id, { pane_configs: configs });
    }

    async onMullionDelete({ windowId, mullionIndex, orientation, splitId }) {
        const w = this.state.windows.find(win => win.id === windowId);
        if (!w) return;

        // Tree mode — use splitId to merge the split node
        if (w.panel_tree && splitId) {
            const splits = getSplitNodes(w.panel_tree);
            const splitNode = splits.find(s => s.id === splitId);
            if (!splitNode) return;
            const childId = splitNode.second?.id;
            if (!childId) return;
            const newTree = mergePanel(w.panel_tree, childId);
            const grid = treeToGrid(newTree, w.width_mm, w.height_mm);
            await this.onWindowUpdate(w.id, {
                panel_tree: newTree,
                panels_horizontal: grid.panelsH,
                panels_vertical: grid.panelsV,
                mullion_positions: grid.mullionPositions,
                pane_configs: grid.paneConfigs,
            });
            this.state.selectedElement = { type: null, index: null, orientation: null, panelId: null, splitId: null };
            return;
        }

        // Legacy path
        if (!w.mullion_positions) return;

        const positions = [...w.mullion_positions];
        // Find the actual index in mullion_positions that matches
        const matching = [];
        for (let i = 0; i < positions.length; i++) {
            if (positions[i].orientation === orientation) {
                matching.push(i);
            }
        }
        const actualIdx = matching[mullionIndex];
        if (actualIdx === undefined) return;

        positions.splice(actualIdx, 1);

        const nH = w.panels_horizontal || 1;
        const nV = w.panels_vertical || 1;
        const newH = orientation === 'vertical' ? Math.max(1, nH - 1) : nH;
        const newV = orientation === 'horizontal' ? Math.max(1, nV - 1) : nV;

        const needed = newH * newV;
        const configs = w.pane_configs ? [...w.pane_configs] : [];
        while (configs.length < needed) {
            configs.push({
                openingType: "fixed", hinge: "left",
                glazingUnit: "double-4-16-4", glassSpec: "clear", glassTint: "clear",
            });
        }

        await this.onWindowUpdate(w.id, {
            panels_horizontal: newH,
            panels_vertical: newV,
            mullion_positions: positions,
            pane_configs: configs.slice(0, needed),
        });
    }

    async onSectionDimEdit({ windowId, dimType, sectionIndex, oldValue, newValue, delta,
                              leftDividerId, rightDividerId, leftDividerMm, rightDividerMm }) {
        const w = this.state.windows.find(win => win.id === windowId);
        if (!w || !w.panel_tree) return;

        // Decide which divider to move: prefer the right/bottom divider (it grows/shrinks this section)
        // If this is the last section (no right divider), move the left divider instead.
        let dividerId = rightDividerId || leftDividerId;
        let dividerMm = rightDividerId ? rightDividerMm : leftDividerMm;
        if (!dividerId || dividerMm == null) return;

        // Calculate new position:
        // If moving right divider: newPos = oldPos + delta (section grows → divider moves away)
        // If moving left divider: newPos = oldPos - delta (section grows → divider moves towards origin)
        let newPosMm;
        if (dividerId === rightDividerId) {
            newPosMm = dividerMm + delta;
        } else {
            newPosMm = dividerMm - delta;
        }

        // Clamp to valid range
        const maxMm = dimType === 'section-width' ? (w.width_mm || 1200) : (w.height_mm || 1000);
        newPosMm = Math.max(20, Math.min(maxMm - 20, newPosMm));

        const newTree = moveDivider(w.panel_tree, dividerId, newPosMm);
        const grid = treeToGrid(newTree, w.width_mm, w.height_mm);
        await this.onWindowUpdate(w.id, {
            panel_tree: newTree,
            panels_horizontal: grid.panelsH,
            panels_vertical: grid.panelsV,
            mullion_positions: grid.mullionPositions,
            pane_configs: grid.paneConfigs,
        });
    }

    // ─── Topbar actions ────────────────────────────────────────────────────────

    async onSave() {
        console.log("[WinCraft] WincraftDesignerAction → onSave() START");
        this.state.isSaving = true;
        try {
            for (const w of this.state.windows) {
                if (!w._new) {
                    await this.orm.write("wincraft.window", [w.id], {
                        canvas_x: w.canvas_x || 0,
                        canvas_y: w.canvas_y || 0,
                        width_mm: w.width_mm || 600,
                        height_mm: w.height_mm || 900,
                    });
                }
            }
            if (this.state.project?.is_template_workspace) {
                await this._autoSaveTemplateWorkspace();
            }
            this.state.isDirty = false;
            this.notification.add("Canvas saved", { type: "success" });
            console.log("[WinCraft] WincraftDesignerAction → onSave() DONE");
        } catch (err) {
            console.error("[WinCraft] WincraftDesignerAction → onSave() CRASHED:", err);
            console.error("[WinCraft] Stack:", err.stack);
            this.notification.add("Save failed", { type: "danger" });
        } finally {
            this.state.isSaving = false;
        }
    }

    // A "Design Canvas Template" scratch session (is_template_workspace=True)
    // exists for exactly one reason: produce/update this Window Type's
    // template_id. Relying on the user to separately find and click the
    // small "Save as Template" bookmark button left Default Canvas Template
    // permanently blank for anyone who just used the main Save button —
    // so the plain Save button now upserts the linked template itself:
    // updates it in place if template_id is already set, otherwise creates
    // one and links it. The explicit "Save as Template" dialog still exists
    // for naming/categorising a reusable template from a real project.
    async _autoSaveTemplateWorkspace() {
        const typeId = this.state.templateLinkTypeId;
        const w = this.state.windows[0];
        if (!typeId || !w || w._new) return;
        try {
            const typeRec = (this.state.windowTypeMaster || []).find(wt => wt.id === typeId);
            const existingTemplateId = typeRec && typeRec.template_id ? typeRec.template_id[0] : null;
            const vals = this._templateValsFromWindow(w);
            if (existingTemplateId) {
                await this.orm.write("wincraft.window.template", [existingTemplateId], vals);
            } else {
                const typeName = typeRec ? typeRec.name : "Window Type";
                const newId = await this.orm.create("wincraft.window.template", [{
                    name: `${typeName} Template`,
                    category: "residential",
                    ...vals,
                }]);
                const createdId = newId[0] || newId;
                await this.orm.write("wincraft.window.type", [typeId], { template_id: createdId });
                if (typeRec) typeRec.template_id = [createdId, ""];
            }
        } catch (err) {
            console.error("[WinCraft] _autoSaveTemplateWorkspace() failed (non-fatal):", err);
        }
    }

    onUndo() {
        const currentState = { windows: this.state.windows.map(w => ({ ...w })) };
        const prev = this.history.undo(currentState);
        if (prev) {
            this.state.windows = prev.windows;
            this.state.isDirty = true;
        }
    }

    onRedo() {
        const currentState = { windows: this.state.windows.map(w => ({ ...w })) };
        const next = this.history.redo(currentState);
        if (next) {
            this.state.windows = next.windows;
            this.state.isDirty = true;
        }
    }

    toggleSnap() {
        this.state.snapEnabled = !this.state.snapEnabled;
    }

    onAlign(direction) {
        const ids = new Set(this.state.selectedIds);
        if (ids.size < 2) return;
        const selected = this.state.windows.filter(w => ids.has(w.id));
        let updated;

        if (direction === "left") {
            const minX = Math.min(...selected.map(w => w.canvas_x || 0));
            updated = this.state.windows.map(w => ids.has(w.id) ? { ...w, canvas_x: minX } : w);
        } else if (direction === "top") {
            const minY = Math.min(...selected.map(w => w.canvas_y || 0));
            updated = this.state.windows.map(w => ids.has(w.id) ? { ...w, canvas_y: minY } : w);
        } else if (direction === "right") {
            const maxRight = Math.max(...selected.map(w => (w.canvas_x || 0) + (w.width_mm || 600)));
            updated = this.state.windows.map(w => ids.has(w.id)
                ? { ...w, canvas_x: maxRight - (w.width_mm || 600) }
                : w
            );
        } else if (direction === "bottom") {
            const maxBot = Math.max(...selected.map(w => (w.canvas_y || 0) + (w.height_mm || 900)));
            updated = this.state.windows.map(w => ids.has(w.id)
                ? { ...w, canvas_y: maxBot - (w.height_mm || 900) }
                : w
            );
        }
        if (updated) {
            this.history.push({ windows: updated.map(w => ({ ...w })) });
            this.state.windows = updated;
            this.state.isDirty = true;
        }
    }

    onDistribute(axis) {
        const ids = new Set(this.state.selectedIds);
        if (ids.size < 3) return;
        const selected = this.state.windows.filter(w => ids.has(w.id));
        selected.sort((a, b) => (axis === "horizontal" ? a.canvas_x - b.canvas_x : a.canvas_y - b.canvas_y));
        const first = selected[0];
        const last = selected[selected.length - 1];
        const propPos = axis === "horizontal" ? "canvas_x" : "canvas_y";
        const propSize = axis === "horizontal" ? "width_mm" : "height_mm";
        const totalSize = selected.slice(0, -1).reduce((s, w) => s + (w[propSize] || 600), 0);
        const totalGap = ((last[propPos] || 0) + (last[propSize] || 600)) - (first[propPos] || 0) - totalSize - (last[propSize] || 600);
        const gap = totalGap / (selected.length - 1);
        let pos = first[propPos] || 0;
        const posMap = {};
        for (const w of selected) {
            posMap[w.id] = pos;
            pos += (w[propSize] || 600) + gap;
        }
        const updated = this.state.windows.map(w =>
            ids.has(w.id) ? { ...w, [propPos]: posMap[w.id] } : w
        );
        this.history.push({ windows: updated.map(w => ({ ...w })) });
        this.state.windows = updated;
        this.state.isDirty = true;
    }

    async onExportPDF() {
        window.open(`/wincraft/cutlist/${this.state.projectId}`, "_blank");
    }

    async onGenerateBom() {
        try {
            const previewData = await this.orm.call(
                "wincraft.project",
                "action_preview_bom",
                [this.state.projectId],
            );
            if (!previewData || !previewData.windows || previewData.windows.length === 0) {
                this.notification.add("No components found for BOM generation", { type: "info" });
                return;
            }
            this.state.bomPreviewData = previewData;
            this.state.showBomPreview = true;
        } catch (e) {
            console.error("[WinCraft] BOM preview failed:", e);
            this.notification.add("Failed to load BOM preview", { type: "danger" });
        }
    }

    async onBomConfirm() {
        this.state.showBomPreview = false;
        try {
            const result = await this.orm.call(
                "wincraft.project",
                "action_generate_bom",
                [this.state.projectId],
            );
            if (result && result.type === 'ir.actions.act_window') {
                this.action.doAction(result);
            } else if (result && result.params) {
                this.notification.add(result.params.message, { type: result.params.type || 'info' });
            }
        } catch (e) {
            console.error("[WinCraft] Generate BOM failed:", e);
            this.notification.add("Failed to generate BOM", { type: "danger" });
        }
    }

    onBomPreviewClose() {
        this.state.showBomPreview = false;
        this.state.bomPreviewData = null;
    }

    async onGetQuote() {
        try {
            const syncResult = await this.orm.call(
                "wincraft.project",
                "action_sync_sale_order_for_quote",
                [this.state.projectId],
            );
            if (syncResult?.message) {
                this.notification.add(syncResult.message, {
                    type: syncResult.warning ? "warning" : "success",
                });
            }
            const reportAction = await this.orm.call(
                "wincraft.project",
                "action_print_quote",
                [this.state.projectId],
            );
            // Must be awaited — the actual PDF download happens asynchronously
            // after doAction() returns, and an un-awaited rejection here becomes
            // an unhandled promise rejection that this try/catch never sees,
            // so failures show only as a raw browser console error with no
            // user-facing toast.
            await this.action.doAction(reportAction);
        } catch (e) {
            console.error("[WinCraft] Get Quote failed:", e);
            const errMsg = e?.data?.message || e?.message?.data?.message
                || (typeof e?.message === "string" ? e.message : null)
                || "Failed to generate quote";
            this.notification.add(errMsg, { type: "danger" });
        }
    }

    async onExit() {
        // A template-workspace session's project is a hidden scratch record
        // (see is_template_workspace) — landing there on exit is a dead end.
        // Go back to the Window Type this session was designing instead.
        if (this.state.project?.is_template_workspace && this.state.templateLinkTypeId) {
            // Property edits (splits, materials, shape...) autosave to the
            // window immediately via onWindowUpdate(), but the linked
            // template is only a snapshot taken on Save — re-sync it here
            // too, so exiting without a final explicit Save can't leave the
            // Default Canvas Template preview stale relative to the canvas.
            await this._autoSaveTemplateWorkspace();
            this.action.doAction({
                type: "ir.actions.act_window",
                res_model: "wincraft.window.type",
                res_id: this.state.templateLinkTypeId,
                views: [[false, "form"]],
                target: "current",
            });
            return;
        }
        this.action.doAction({
            type: "ir.actions.act_window",
            res_model: "wincraft.project",
            res_id: this.state.projectId,
            views: [[false, "form"]],
            target: "current",
        });
    }

    // ─── Save status from canvas auto-save ────────────────────────────────────

    onSaveStatus(isSaving) {
        this.state.isSaving = isSaving;
    }

    // ─── CanvasLibrary drag hint ──────────────────────────────────────────────

    onLibraryDragStart() {
        // legacy no-op
    }

    // ─── Create window from configurator (left panel click) ───────────────────

    async onCreateWindowFromConfigurator(defaults) {
        const stub = {
            _new: true,
            _type: defaults.window_type || "casement",
            canvas_x: 100,
            canvas_y: 100,
        };
        await this.onWindowsChange([...this.state.windows, stub]);
        // Auto-navigate to the newly created window
        this.state.activeWindowIndex = this.state.windows.length - 1;
        const w = this.state.windows[this.state.activeWindowIndex];
        if (w) this.state.selectedIds = [w.id];
    }

    // ─── New Window Wizard ────────────────────────────────────────────────────

    onOpenNewWindowWizard() {
        this.state.showNewWindowWizard = true;
    }

    onCloseNewWindowWizard() {
        this.state.showNewWindowWizard = false;
    }

    async onNewWindowWizardConfirm(config) {
        this.state.showNewWindowWizard = false;
        const stub = {
            _new: true,
            _type: config.window_type || "casement",
            canvas_x: 100,
            canvas_y: 100,
        };
        // Create the window
        const vals = {
            project_id: this.state.projectId,
            window_type: config.window_type || "casement",
            width_mm: config.width_mm || 1200,
            height_mm: config.height_mm || 1000,
            canvas_x: 100,
            canvas_y: 100,
        };
        vals.window_config = config.window_config;

        try {
            const newRec = await this._createWindow(vals);
            if (newRec) {
                this.state.windows = [...this.state.windows, newRec];
                this.state.activeWindowIndex = this.state.windows.length - 1;
                this.state.selectedIds = [newRec.id];
                this.state.isDirty = true;
            }
        } catch (err) {
            console.error("[WinCraft] Wizard create failed:", err);
        }
    }

    // ─── Filmstrip: select window by index ──────────────────────────────────

    onFilmstripSelect(index) {
        if (index >= 0 && index < this.state.windows.length) {
            this.state.activeWindowIndex = index;
            const w = this.state.windows[index];
            if (w) this.state.selectedIds = [w.id];
        }
    }

    async onDeleteActiveWindow() {
        const w = this.selectedWindow;
        if (!w || w._new) return;
        try {
            await this.orm.unlink("wincraft.window", [w.id]);
            this.state.windows = this.state.windows.filter(win => win.id !== w.id);
            if (this.state.activeWindowIndex >= this.state.windows.length) {
                this.state.activeWindowIndex = Math.max(0, this.state.windows.length - 1);
            }
            const next = this.state.windows[this.state.activeWindowIndex];
            this.state.selectedIds = next ? [next.id] : [];
            this.state.isDirty = true;
            this.notification.add("Window deleted", { type: "info" });
        } catch (err) {
            console.error("[WinCraft] Delete window failed:", err);
            this.notification.add("Delete failed", { type: "danger" });
        }
    }

    // Renders the active window's current shape/panel state to a small SVG
    // string for wincraft.window.template.thumbnail_svg, reusing the same
    // renderer window_object.js uses for the live canvas. Never throws —
    // a rendering failure just leaves the thumbnail blank.
    _buildTemplateThumbnail(w) {
        try {
            const boxW = 240, boxH = 180;
            const wMm = w.width_mm || 1200;
            const hMm = w.height_mm || 1000;
            const scale = Math.min(boxW / wMm, boxH / hMm);
            return getWindowSVG({
                type: w.window_type || "casement",
                widthPx: Math.round(wMm * scale),
                heightPx: Math.round(hMm * scale),
                panelsH: w.panels_horizontal || 1,
                panelsV: w.panels_vertical || 1,
                frameColour: w.frame_colour || "#f0ede8",
                glassOpacity: 0.18,
                widthMm: wMm,
                heightMm: hMm,
                name: "",
                panelTree: w.panel_tree || null,
                paneConfigs: w.pane_configs || null,
                frameShape: w.frame_shape || "rectangular",
                frameShapePoints: w.frame_shape_points || null,
                georgianBarConfig: w.georgian_bar_config || null,
            });
        } catch (e) {
            console.warn("[WinCraft] Template thumbnail render failed (non-fatal):", e);
            return false;
        }
    }

    /**
     * WS-17: usable with or without a window on canvas.
     * - A window is selected: edits that window's fields directly (writes
     *   via onWindowUpdate, same as Properties Panel).
     * - No window exists yet: edits state.pendingWindowConfig instead — a
     *   plain draft object, not persisted anywhere until the next window
     *   is created via _createWindow(), which merges it in as defaults.
     */
    get configCatalogProps() {
        return {
            colors: this.state.colors || [],
            brickmoulds: this.state.brickmoulds || [],
            configCatalogs: this.state.configCatalogs || {},
            rooms: this.state.rooms || [],
            casementHardware: this.state.casementHardware || [],
            hardware: this.state.hardware || [],
            addons: this.state.addons || [],
            addonCategories: this.state.addonCategories || [],
            profileTypes: this.state.profileTypes || [],
            glassTypes: this.state.glassTypes || [],
            glassLites: this.state.glassLites || [],
            glazingConfigs: this.state.glazingConfigs || [],
        };
    }

    /** Saved Window Configuration to pre-fill the New Window form: the
        draft defaults, or — when the configuration was saved onto a selected
        window instead — that window's configuration fields (M2O tuples
        flattened to ids, matching the draft's shape). */
    get newWindowConfigSeed() {
        const pending = this.state.pendingWindowConfig || {};
        const src = Object.keys(pending).length ? pending : (this.selectedWindow || {});
        const seed = {};
        for (const key of WINDOW_CONFIG_FIELDS) {
            const v = src[key];
            if (!this._isFieldSet(v)) continue;
            seed[key] = Array.isArray(v) && v.length === 2 && typeof v[1] === "string" ? v[0] : v;
        }
        return seed;
    }

    onOpenWindowConfigurationDialog() {
        const w = this.selectedWindow;
        // OWL's optional-Object prop validation rejects an explicit `null`
        // (it only tolerates the key being absent/`undefined`) — build the
        // props object with only one of window/pendingConfig actually set,
        // never both keys present with one nulled out.
        const dialogProps = {
            ...this.configCatalogProps,
            onWindowUpdate: this.onWindowUpdate.bind(this),
            onPendingConfigChange: (patch) => {
                Object.assign(this.state.pendingWindowConfig, patch);
            },
        };
        if (w) {
            dialogProps.window = w;
        } else {
            dialogProps.pendingConfig = this.state.pendingWindowConfig;
        }
        this.dialogService.add(WindowConfigurationDialog, dialogProps);
    }

    onOpenSaveTemplateDialog() {
        const w = this.selectedWindow;
        if (!w || w._new) return;
        this.dialogService.add(SaveTemplateDialog, {
            defaultName: w.name ? `${w.name} Template` : "New Template",
            windowTypes: this.state.windowTypeMaster || [],
            initialWindowTypeId: this.state.templateLinkTypeId || null,
            onConfirm: (name, category, linkedWindowTypeId) =>
                this._saveWindowAsTemplate(w, name, category, linkedWindowTypeId),
        });
    }

    // Shared with _autoSaveTemplateWorkspace() — every field wincraft.window.template
    // needs, copied off the live canvas window, minus name/category (those two
    // differ between the explicit "Save as Template" dialog and the template-
    // workspace auto-save path).
    _templateValsFromWindow(w) {
        // A split made via the "legacy" mullion-drop path (see onDividerDrop)
        // has no panel_tree — only mullion_positions + panels_horizontal/
        // vertical. _applyTemplateGeometry() (what actually seeds a *new*
        // window from a template) only ever reads panel_tree, so without
        // this normalisation a legacy-mode split silently vanishes both from
        // the thumbnail preview and from any window later created off this
        // template. Same treeFromGrid() helper _loadAll() already uses to
        // migrate legacy windows on load.
        let panelTree = w.panel_tree;
        if (!panelTree && ((w.panels_horizontal || 1) > 1 || (w.panels_vertical || 1) > 1)) {
            panelTree = treeFromGrid(
                w.panels_horizontal || 1, w.panels_vertical || 1,
                w.width_mm || 1200, w.height_mm || 1000,
                w.mullion_positions, w.pane_configs,
            );
        }
        // Re-derive panels_horizontal/vertical/pane_configs FROM the tree
        // rather than trusting the window's own grid fields — they can
        // drift out of sync with panel_tree (e.g. a tree-path split that,
        // for whatever reason, didn't also persist a matching
        // panels_horizontal back onto the window). panel_tree is the
        // source of truth wherever it exists (bom_calculator.js already
        // treats it that way), so keep the template's snapshot consistent
        // with itself instead of copying already-possibly-stale values.
        let panelsH = w.panels_horizontal || 1;
        let panelsV = w.panels_vertical || 1;
        let paneConfigs = w.pane_configs;
        if (panelTree) {
            const grid = treeToGrid(panelTree, w.width_mm || 1200, w.height_mm || 1000);
            panelsH = grid.panelsH;
            panelsV = grid.panelsV;
            paneConfigs = grid.paneConfigs;
        }
        return {
            window_type: w.window_type || "casement",
            default_width: w.width_mm || 1200,
            default_height: w.height_mm || 1000,
            default_panels: panelsH * panelsV,
            panels_horizontal: panelsH,
            panels_vertical: panelsV,
            frame_material_id: w.frame_material_id ? w.frame_material_id[0] : false,
            glass_type_id: w.glass_type_id ? w.glass_type_id[0] : false,
            opening_direction: w.opening_direction || "left_right",
            frame_colour: w.frame_colour || "#f0ede8",
            frame_shape: w.frame_shape || "rectangular",
            panel_tree: panelTree || false,
            pane_configs: paneConfigs || false,
            thumbnail_svg: this._buildTemplateThumbnail({ ...w, panel_tree: panelTree, panels_horizontal: panelsH, panels_vertical: panelsV }),
        };
    }

    async _saveWindowAsTemplate(w, name, category, linkedWindowTypeId) {
        try {
            const vals = {
                name,
                category: category || "residential",
                ...this._templateValsFromWindow(w),
            };
            const newId = await this.orm.create("wincraft.window.template", [vals]);
            const recs = await this.orm.read("wincraft.window.template", newId, [
                "name", "category", "window_type",
                "default_width", "default_height", "default_panels",
                "panels_horizontal", "panels_vertical",
                "thumbnail_svg", "frame_shape", "panel_tree", "pane_configs",
            ]);
            this.state.templates = [...this.state.templates, recs[0]];
            if (linkedWindowTypeId) {
                await this.orm.write("wincraft.window.type", [linkedWindowTypeId], {
                    template_id: recs[0].id,
                });
            }
            this.notification.add(`Template "${name}" saved`, { type: "success" });
            // Launched from the Window Type form's "Design Canvas Template"
            // button (action_design_canvas_template) — jump back there now
            // that the field it opened this scratch session for is set,
            // rather than leaving the user stranded in a throwaway project.
            if (this.state.templateLinkTypeId) {
                this.action.doAction({
                    type: "ir.actions.act_window",
                    res_model: "wincraft.window.type",
                    res_id: this.state.templateLinkTypeId,
                    views: [[false, "form"]],
                    target: "current",
                });
            }
        } catch (err) {
            console.error("[WinCraft] Save as template failed:", err);
            this.notification.add("Failed to save template", { type: "danger" });
        }
    }

    // ─── Computed ─────────────────────────────────────────────────────────────

    get canUndo() { return this.history.canUndo(); }
    get canRedo() { return this.history.canRedo(); }
    get installationCharge() { return this.state.project?.installation_charge || 0; }
    get discountPct() { return this.state.project?.discount_pct || 0; }
    get gstPct() { return this.state.gstPct ?? 5; }

    get statusWindowCount() { return this.state.windows.length; }

    get statusTotalArea() {
        const total = this.state.windows.reduce((sum, w) => {
            return sum + ((w.width_mm || 600) / 1000) * ((w.height_mm || 900) / 1000);
        }, 0);
        return total.toFixed(2);
    }

    get statusProjectName() {
        return this.state.project?.name || "";
    }

    /**
     * One-time (per_window=False) add-ons selected on any window in the
     * project, deduplicated and summed once — mirrors wincraft.project's
     * server-side _get_one_time_addons()/one_time_addon_total so the quote
     * strip's total matches what action_create_sale_order will actually bill.
     */
    get oneTimeAddonTotal() {
        const allAddons = this.state.addons || [];
        const seenIds = new Set();
        let total = 0;
        for (const w of this.state.windows) {
            for (const id of (w.addon_ids || [])) {
                if (seenIds.has(id)) continue;
                const addon = allAddons.find(a => a.id === id);
                if (addon && !addon.per_window) {
                    seenIds.add(id);
                    total += addon.price;
                }
            }
        }
        return total;
    }
}

registry.category("actions").add("wincraft_designer", WincraftDesignerAction);
console.log("[WinCraft] ✓ REGISTERED: wincraft_designer action");
