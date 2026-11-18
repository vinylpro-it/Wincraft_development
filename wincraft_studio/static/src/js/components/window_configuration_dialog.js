/** @odoo-module **/
/**
 * WinCraft Studio — Window Configuration Dialog (WS-17)
 *
 * First of the 4 canvas config popups: the "Window Configuration" popup.
 * Confirmed with the user (2026-09-23) that this popup is meant to be
 * usable *first*, before any window exists on canvas — as the "New Window"
 * section (WS-18) comes after it — so it has two modes:
 * - A window is selected on canvas: edits that window's fields directly,
 *   writing live via `onWindowUpdate` (same path Properties Panel uses).
 * - No window exists yet: edits `props.pendingConfig` instead — a plain
 *   draft object (wincraft_designer.js's `state.pendingWindowConfig`, not
 *   persisted to any record) that gets merged onto the next window created
 *   via `_createWindow()`.
 * Both modes share every getter/handler below via the `record` getter,
 * which reads from whichever of `props.window`/`props.pendingConfig` is
 * present — the two are kept in the same field shape (raw ids for M2O,
 * plain id arrays for hardware_ids/addon_ids) specifically so this works
 * without special-casing per field.
 *
 * Reuses two existing mechanisms rather than inventing new ones:
 * - The Vendor Colour cascading Company → Color picker pattern
 *   (properties_panel.js, WS-15/WS-17 2026-09-23) — generalised here to
 *   cover all 5 colour-catalog fields this popup touches (inside/outside/
 *   rubber/brickmould/casing), all sourced from the same wincraft.color
 *   catalog.
 * - The Options Group → Item picker (properties_panel.js's
 *   optionAddons/optionGroups/optionsInSelectedGroup) for the "Casing"
 *   field, which still just writes into addon_ids.
 *
 * In/Middle/Out pane fields are dropdowns of Glass Options
 * (wincraft.glass.lite), each filtered by the supplier price list's
 * Available for Inside/Middle/Outside flags.
 */

import { Component, useState, useRef, useExternalListener } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";
import { useOverlayDialogLayerFix } from "../utils/overlay_dialog_fix.js";

console.log("[WinCraft] ✓ LOADED: WindowConfigurationDialog");

const OPTIONS_CATEGORY_CODE = "option";

// Colour-catalog fields this popup edits, each via the same cascading
// Company -> Color picker. 'inside'/'outside' duplicate the Properties
// Panel's Vendor Colour block on purpose (shared fields, not a second
// storage mechanism) so all colour fields are reachable from one place too.
const COLOUR_PICKS = [
    { key: "inside", field: "inside_vendor_color_id", label: "Inside" },
    { key: "outside", field: "outside_vendor_color_id", label: "Outside" },
    { key: "brickmould", field: "brickmould_colour_id", label: "Brickmould colour" },
    { key: "casing", field: "casing_colour_id", label: "Casing colour" },
    { key: "extension", field: "extension_colour_id", label: "Extension colour" },
    { key: "screen", field: "screen_colour_id", label: "Screen colour" },
];

// Trim & Frame dropdowns, driven by the Options catalog "TYPE" column
// (confirmed with the client 2026-10-09/10): B = Brickmould, C = Casing,
// J = Vinyl Extension, X = Wood Extension (confirmed with the client
// 2026-11-13; Wood has a typed size instead of a colour).
const TRIM_PICKS = [
    { groups: ["B"], label: "Brickmould", colourIdx: 2, colourLabel: "Brickmould colour" },
    { groups: ["C"], label: "Casing", colourIdx: 3, colourLabel: "Casing colour" },
    { groups: ["J"], label: "Vinyl Extension", colourIdx: 4, colourLabel: "Vinyl Extension colour" },
    { groups: ["X"], label: "Wood extention" },
];

export class WindowConfigurationDialog extends Component {
    static template = "wincraft_studio.WindowConfigurationDialog";
    static components = { Dialog };

    static props = {
        window: { type: Object, optional: true },
        pendingConfig: { type: Object, optional: true },
        colors: { type: Array, optional: true },
        configCatalogs: { type: Object, optional: true },
        brickmoulds: { type: Array, optional: true },
        rooms: { type: Array, optional: true },
        hardware: { type: Array, optional: true },
        casementHardware: { type: Array, optional: true },
        addons: { type: Array, optional: true },
        addonCategories: { type: Array, optional: true },
        profileTypes: { type: Array, optional: true },
        glassTypes: { type: Array, optional: true },
        glassLites: { type: Array, optional: true },
        glazingConfigs: { type: Array, optional: true },
        onWindowUpdate: Function,
        onPendingConfigChange: { type: Function, optional: true },
        close: Function,
    };

    setup() {
        useOverlayDialogLayerFix();
        this.state = useState({
            localFields: {},
            colourPick: { inside: null, outside: null, brickmould: null, casing: null, extension: null, screen: null },
            selectedOptionGroup: this._initialOptionGroup(),
            hardwarePanelOpen: false,
            hardwareFilter: "",
        });
        this.hardwareRootRef = useRef("hardwareRoot");
        useExternalListener(window, "click", (ev) => {
            if (this.state.hardwarePanelOpen && this.hardwareRootRef.el
                    && !this.hardwareRootRef.el.contains(ev.target)) {
                this.state.hardwarePanelOpen = false;
            }
        });
    }

    get colourPicks() { return COLOUR_PICKS; }

    /** Rows of one Window Configuration catalog (viewFrom, windowSize, ...). */
    catalog(key) { return (this.props.configCatalogs || {})[key] || []; }

    /** "View from" radios: store the catalog row and keep the legacy
        free-text `view_from` (Inside/Outside) in step for existing readers. */
    onViewFromChange(vf) {
        this.onFieldChange("view_from_id", vf.id);
        this.onFieldChange("view_from", vf.name);
    }

    selectedColourName(pick) {
        const id = this.fieldId(pick.field);
        const rec = (this.props.colors || []).find((c) => c.id === id);
        return rec ? `${rec.vendor} — ${rec.name}` : "";
    }

    get isDraftMode() { return !this.props.window; }

    get dialogTitle() {
        return this.isDraftMode
            ? "Window Configuration — Defaults for Next Window"
            : `Window Configuration — ${this.props.window.name || "Window"}`;
    }

    /** Local-echo merge over whichever base record is live (a real window,
        or the draft pendingConfig) — same pattern as properties_panel.js's
        `get window()`, so edits reflect instantly without waiting on the
        async ORM round-trip. Never null — falls back to {} so every
        getter/template check below can treat draft and window mode
        identically. */
    get window() {
        const base = this.props.window || this.props.pendingConfig || {};
        return { ...base, ...this.state.localFields };
    }

    /** Alias of `window` for templates: OWL treats a bare `window` in a
        t-att/t-esc expression as the browser global, never this getter. */
    get record() { return this.window; }

    /** M2O id regardless of shape: `[id, name]` from the ORM, or the raw id
        that localFields/pendingConfig hold (props never refresh while the
        dialog is open, so the raw echo never gets replaced by a tuple). */
    fieldId(field) {
        const v = this.window[field];
        return Array.isArray(v) ? v[0] : v || false;
    }

    onFieldChange(field, value) {
        this.state.localFields = { ...this.state.localFields, [field]: value };
        if (this.props.window) {
            this.props.onWindowUpdate(this.props.window.id, { [field]: value });
        } else if (this.props.onPendingConfigChange) {
            this.props.onPendingConfigChange({ [field]: value });
        }
    }

    onTextFieldBlur(ev, field) {
        this.onFieldChange(field, ev.target.value);
    }

    onSelectChange(ev, field) {
        const raw = ev.target.value;
        this.onFieldChange(field, raw ? parseInt(raw, 10) : false);
    }

    // ── Generic colour-catalog cascading picker (Company -> Color) ─────────

    get vendorColourCompanies() {
        const vendors = new Set((this.props.colors || []).map((c) => c.vendor));
        return [...vendors].sort();
    }

    colourCompany(pick) {
        const pending = this.state.colourPick[pick.key];
        if (pending !== null) return pending;
        const current = this.fieldId(pick.field);
        if (!current) return "";
        const rec = (this.props.colors || []).find((c) => c.id === current);
        return rec ? rec.vendor : "";
    }

    colourOptions(pick) {
        const company = this.colourCompany(pick);
        if (!company) return [];
        return (this.props.colors || []).filter((c) => c.vendor === company);
    }

    onColourCompanyChange(pick, vendor) {
        this.state.colourPick[pick.key] = vendor;
    }

    onColourPick(pick, rawValue) {
        this.onFieldChange(pick.field, rawValue ? parseInt(rawValue, 10) : false);
    }

    // ── Casing (mirrors properties_panel.js's Options Group -> Item picker) ─

    get optionAddons() {
        const cat = (this.props.addonCategories || []).find((c) => c.code === OPTIONS_CATEGORY_CODE);
        if (!cat) return [];
        return (this.props.addons || []).filter((a) => a.active && a.category_id && a.category_id[0] === cat.id);
    }

    get optionGroups() {
        const groups = new Set(this.optionAddons.map((a) => a.group_code || ""));
        return [...groups].sort((a, b) => {
            if (a === "") return 1;
            if (b === "") return -1;
            return a.localeCompare(b);
        });
    }

    get optionsInSelectedGroup() {
        const group = this.state.selectedOptionGroup;
        return this.optionAddons.filter((a) => (a.group_code || "") === group);
    }

    get selectedWindowOptionId() {
        const windowAddonIds = this.window?.addon_ids || [];
        const current = this.optionAddons.find((a) => windowAddonIds.includes(a.id));
        return current ? current.id : null;
    }

    _initialOptionGroup() {
        const base = this.props.window || this.props.pendingConfig || {};
        const windowAddonIds = base.addon_ids || [];
        const cat = (this.props.addonCategories || []).find((c) => c.code === OPTIONS_CATEGORY_CODE);
        const options = cat
            ? (this.props.addons || []).filter((a) => a.active && a.category_id && a.category_id[0] === cat.id)
            : [];
        const current = options.find((a) => windowAddonIds.includes(a.id));
        if (current) return current.group_code || "";
        const groups = new Set(options.map((a) => a.group_code || ""));
        return [...groups].sort()[0] || "";
    }

    onOptionGroupChange(ev) {
        this.state.selectedOptionGroup = ev.target.value;
    }

    onWindowOptionChange(addonId) {
        const optionIds = new Set(this.optionAddons.map((a) => a.id));
        const withoutOldOption = [...(this.window?.addon_ids || [])].filter((id) => !optionIds.has(id));
        if (addonId) withoutOldOption.push(addonId);
        this.onFieldChange("addon_ids", withoutOldOption);
    }

    // ── Trim & Frame dropdowns: one per Options catalog TYPE (B/C/J/X) ─────

    get sizeBasisOptions() {
        return [{ value: "brickmould", label: "Brickmould size" }, { value: "frame", label: "Frame size" }];
    }

    // Reference numbers are what CSV/Excel exports use (1 White, 2 Black, 3 Brown).
    get handleCoverOptions() {
        return [{ value: "1", label: "1 - White" }, { value: "2", label: "2 - Black" }, { value: "3", label: "3 - Brown" }];
    }

    get trimPicks() { return TRIM_PICKS; }

    trimOptions(trim) {
        return this.optionAddons.filter((a) => trim.groups.includes(a.group_code || ""));
    }

    selectedTrimId(trim) {
        const ids = this.window?.addon_ids || [];
        const current = this.trimOptions(trim).find((a) => ids.includes(a.id));
        return current ? current.id : null;
    }

    /** Replaces only this TYPE's selection, leaving the other trim types
        (and any non-trim addons) in addon_ids untouched. */
    onTrimChange(trim, rawValue) {
        const groupIds = new Set(this.trimOptions(trim).map((a) => a.id));
        const next = (this.window?.addon_ids || []).filter((id) => !groupIds.has(id));
        if (rawValue) next.push(parseInt(rawValue, 10));
        this.onFieldChange("addon_ids", next);
    }

    // ── Casement hardware (window-level hardware_ids multi-select) ─────────
    // Rendered as a closed, select-styled control (WS-17 redesign,
    // 2026-09-24) that opens a floating filterable checklist on click,
    // rather than an always-open checkbox grid — keeps the dialog's
    // collapsed height in line with every other field.

    get hardwareOptions() {
        return this.props.casementHardware || [];
    }

    // Single-select for now: stored as a one-element casement_hardware_ids.
    get selectedCasementHardwareId() {
        return (this.window?.casement_hardware_ids || [])[0] || null;
    }

    onCasementHardwareChange(rawValue) {
        this.onFieldChange("casement_hardware_ids", rawValue ? [parseInt(rawValue, 10)] : []);
    }

    get filteredHardwareOptions() {
        const q = this.state.hardwareFilter.trim().toLowerCase();
        if (!q) return this.hardwareOptions;
        return this.hardwareOptions.filter((h) => `${h.code} ${h.name}`.toLowerCase().includes(q));
    }

    get selectedHardwareNames() {
        const selected = new Set(this.window?.casement_hardware_ids || []);
        return this.hardwareOptions.filter((h) => selected.has(h.id)).map((h) => h.name);
    }

    get hardwareControlLabel() {
        const names = this.selectedHardwareNames;
        if (!names.length) return "— Select hardware —";
        const preview = names.slice(0, 2).join(", ");
        return `${names.length} selected — ${preview}${names.length > 2 ? "…" : ""}`;
    }

    isHardwareSelected(hardwareId) {
        return (this.window?.casement_hardware_ids || []).includes(hardwareId);
    }

    onHardwareToggle(hardwareId) {
        const current = this.window?.casement_hardware_ids || [];
        const next = current.includes(hardwareId)
            ? current.filter((id) => id !== hardwareId)
            : [...current, hardwareId];
        this.onFieldChange("casement_hardware_ids", next);
    }

    toggleHardwarePanel() {
        this.state.hardwarePanelOpen = !this.state.hardwarePanelOpen;
    }

    onHardwareFilterInput(ev) {
        this.state.hardwareFilter = ev.target.value;
    }

    clearAllHardware() {
        this.onFieldChange("casement_hardware_ids", []);
    }

    // ── Glass panes: one dropdown per layer, listing Glass Options ─────────
    // Each option is only offered where the supplier price list marks it
    // available (Outside / Middle / Inside columns).

    get glassPanes() {
        return [
            { field: "glass_in_lite_id", label: "In pane", available: "is_available_inside" },
            { field: "glass_middle_lite_id", label: "Middle pane", available: "is_available_middle" },
            { field: "glass_out_lite_id", label: "Out pane", available: "is_available_outside" },
        ];
    }

    glassOptionsFor(pane) {
        const current = this.fieldId(pane.field);
        return (this.props.glassLites || []).filter(
            (g) => g[pane.available] || g.id === current
        );
    }
}
