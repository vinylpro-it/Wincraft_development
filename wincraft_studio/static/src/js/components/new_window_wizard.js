/** @odoo-module **/
/**
 * WinCraft Studio — New Window Creation Wizard
 * Single-form modal: order line, room, size and a summary of the saved Window
 * Configuration. Always creates a "custom" window drawn on the canvas.
 */

import { Component, useState } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { displayToMm, unitLabel, parseInchesFraction } from "../utils/units.js";
import { WindowConfigurationDialog } from "./window_configuration_dialog.js";

console.log("[WinCraft] ✓ LOADED: NewWindowWizard");

export class NewWindowWizard extends Component {
    static template = "wincraft_studio.NewWindowWizard";

    static props = {
        // Saved Window Configuration (draft defaults) seeding this window's
        // read-only summary; a copy is edited locally, never written back.
        initialConfig: { type: Object, optional: true },
        // Catalogs for summary lookups and the embedded editor dialog (the
        // same props WindowConfigurationDialog takes, minus config/handlers).
        catalogs: { type: Object, optional: true },
        rooms: { type: Array, optional: true },
        orderLine: { type: Number, optional: true },
        unitSystem: { type: String, optional: true },
        onConfirm: Function,
        onClose: Function,
    };

    setup() {
        this.dialog = useService("dialog");
        this.state = useState({
            config: { ...(this.props.initialConfig || {}), view_from: "Outside" },
            roomId: false,
            // Always a custom window — the shape/layout is drawn on the canvas.
            selectedType: "custom",
            // Decimal text in the active unit (inches when imperial). Typical
            // opening is 26 x 50 in.
            width: this.props.unitSystem === "imperial" ? "26" : "660",
            height: this.props.unitSystem === "imperial" ? "50" : "1270",
        });
    }

    get isImperial() { return this.props.unitSystem === "imperial"; }
    get dimUnit() { return unitLabel(this.isImperial ? "imperial" : "metric"); }

    onWidthInput(ev) { this.state.width = ev.target.value; }
    onHeightInput(ev) { this.state.height = ev.target.value; }
    onRoomChange(ev) { this.state.roomId = ev.target.value ? parseInt(ev.target.value, 10) : false; }

    /** Typed dimension (decimal, or fraction like "26 1/2") in the active
        unit -> mm, or null when it isn't a positive number. */
    _toMm(text) {
        const n = this.isImperial ? parseInchesFraction(text) : Number.parseFloat(text);
        return Number.isFinite(n) && n > 0 ? displayToMm(n, this.isImperial ? "imperial" : "metric") : null;
    }

    get canConfirm() {
        return this._toMm(this.state.width) !== null
            && this._toMm(this.state.height) !== null;
    }

    // ── Read-only summary of the saved Window Configuration ────────────────

    _byId(list, id) {
        return (list || []).find((x) => x.id === id);
    }

    _colourLabel(id) {
        const c = this._byId(this.props.catalogs?.colors, id);
        return c ? `${c.vendor} ${c.name}` : "";
    }

    _optionName(groups) {
        const ids = this.state.config.addon_ids || [];
        const a = (this.props.catalogs?.addons || []).find(
            (x) => groups.includes(x.group_code || "") && ids.includes(x.id));
        return a ? a.name : "";
    }

    _join(parts, sep = " – ") {
        return parts.filter(Boolean).join(sep);
    }

    get configSummary() {
        const c = this.state.config;
        const cat = this.props.catalogs || {};
        const m2o = (v) => (Array.isArray(v) ? v[0] : v || false);
        const profile = this._byId(cat.profileTypes, m2o(c.profile_type_id))?.name || "";
        const hardware = (cat.casementHardware || [])
            .filter((h) => (c.casement_hardware_ids || []).includes(h.id)).map((h) => h.name);
        const glass = ["glass_in_lite_id", "glass_middle_lite_id", "glass_out_lite_id"]
            .map((f) => this._byId(cat.glassLites, m2o(c[f]))?.name || "—");
        const cfgCat = cat.configCatalogs || {};
        const cfgName = (key, field) => this._byId(cfgCat[key], m2o(c[field]))?.name || "";
        const rows = [
            { label: "Profile type", value: profile },
            { label: "View from", value: cfgName("viewFrom", "view_from_id") },
            { label: "Window size", value: cfgName("windowSize", "window_size_id") },
            { label: "Casement hardware", value: hardware.join(", ") },
            { label: "Spacer", value: cfgName("spacer", "cfg_spacer_id") },
            { label: "Screen bar", value: cfgName("screenBarColour", "screen_bar_colour_id") },
            { label: "Screen mesh", value: cfgName("screenMeshColour", "screen_mesh_colour_id") },
            { label: "Glass (In / Mid / Out)", value: glass.every((g) => g === "—") ? "" : glass.join(" / ") },
            { label: "Brickmould", value: this._join([this._optionName(["B"]), this._colourLabel(m2o(c.brickmould_colour_id))]) },
            { label: "Casing", value: this._join([this._optionName(["C"]), this._colourLabel(m2o(c.casing_colour_id))]) },
            { label: "Vinyl extension", value: this._join([this._optionName(["J"]), this._colourLabel(m2o(c.extension_colour_id))]) },
            { label: "Wood extension", value: this._join([this._optionName(["X"]), c.wood_extension_size]) },
            { label: "Colour inside", value: this._colourLabel(m2o(c.inside_vendor_color_id)) },
            { label: "Colour outside", value: this._colourLabel(m2o(c.outside_vendor_color_id)) },
            { label: "Rubber", value: cfgName("rubberColour", "rubber_colour_cfg_id") },
            { label: "Handle & cover", value: cfgName("handleCoverColour", "handle_cover_colour_cfg_id") },
        ];
        return rows.filter((r) => r.value);
    }

    /** Edits this window's own copy of the configuration — the saved
        defaults for the next "New Window" are left untouched. */
    onEditConfig() {
        this.dialog.add(WindowConfigurationDialog, {
            ...(this.props.catalogs || {}),
            pendingConfig: this.state.config,
            onWindowUpdate: () => {},
            onPendingConfigChange: (patch) => Object.assign(this.state.config, patch),
        });
    }

    onConfirm() {
        if (!this.canConfirm) return;
        const config = {
            window_type: this.state.selectedType,
            width_mm: this._toMm(this.state.width),
            height_mm: this._toMm(this.state.height),
            window_config: { ...this.state.config, room_id: this.state.roomId || false },
        };
        this.props.onConfirm(config);
    }

    onOverlayClick(ev) {
        if (ev.target === ev.currentTarget) {
            this.props.onClose();
        }
    }
}
