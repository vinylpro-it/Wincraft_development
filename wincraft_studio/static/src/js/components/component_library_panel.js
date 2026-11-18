/** @odoo-module **/
/**
 * WinCraft Studio — Configurator Panel (Left)
 * Replaces old drag-library. Click-to-configure: System Type grid,
 * Sash Layout grid, Opening Direction pills, Frame Material pills,
 * Profile Depth toggle.
 */

import { Component, markup, useState } from "@odoo/owl";
import { getWindowTypeIcon } from "../utils/window_svg.js";
import { getTypeConfig, getDefaultOpeningType, getAllWindowTypes } from "../utils/window_type_config.js";
import {
    splitPanelAtMidpoint, mergePanel, canSplitPanel, canMergePanel,
    getLeafPanels, treeFromGrid, treeToGrid,
} from "../utils/panel_tree.js";

console.log("[WinCraft] ✓ LOADED: ComponentLibraryPanel (configurator)");

const SASH_LAYOUTS = [
    { key: "1x1", h: 1, v: 1, label: "1×1" },
    { key: "2x1", h: 2, v: 1, label: "2×1" },
    { key: "3x1", h: 3, v: 1, label: "3×1" },
    { key: "1x2", h: 1, v: 2, label: "1×2" },
    { key: "2x2", h: 2, v: 2, label: "2×2" },
    { key: "3x2", h: 3, v: 2, label: "3×2" },
];

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

export class ComponentLibraryPanel extends Component {
    static template = "wincraft_studio.ComponentLibraryPanel";

    static props = {
        templates: { type: Array },
        materials: { type: Array },
        profileTypes: { type: Array, optional: true },
        enabledTypes: { type: Array, optional: true },
        selectedWindow: { optional: true },
        selectedElement: { optional: true },
        onWindowUpdate: Function,
        onCreateWindow: Function,
        onSelectElement: { type: Function, optional: true },
    };

    setup() {
        console.log("[WinCraft] ComponentLibraryPanel → setup() START");
        this.sashLayouts = SASH_LAYOUTS;
        this.openingDirections = OPENING_DIRECTIONS;
        this.profileDepths = PROFILE_DEPTHS;
        this.templateCategories = [
            { key: 'all', label: 'All' },
            { key: 'residential', label: 'Residential' },
            { key: 'commercial', label: 'Commercial' },
            { key: 'heritage', label: 'Heritage' },
            { key: 'contemporary', label: 'Contemporary' },
            { key: 'specialty', label: 'Specialty' },
        ];
        this.state = useState({
            templateCategory: 'all',
            templateSearch: '',
        });
        console.log("[WinCraft] ComponentLibraryPanel → setup() DONE ✓");
    }

    /* ── Type-aware filtered getters ── */

    get typeConfig() {
        return getTypeConfig(this.selectedType);
    }

    get filteredWindowTypes() {
        const allTypes = getAllWindowTypes();
        const enabled = this.props.enabledTypes;
        if (!enabled || !enabled.length) return allTypes;
        return allTypes.filter(wt => enabled.includes(wt.key));
    }

    get filteredSashLayouts() {
        if (!this.props.selectedWindow) return SASH_LAYOUTS;
        const allowed = this.typeConfig.sashLayouts;
        return SASH_LAYOUTS.filter(sl => allowed.includes(sl.key));
    }

    get filteredOpeningDirections() {
        if (!this.props.selectedWindow) return OPENING_DIRECTIONS;
        const allowed = this.typeConfig.openingDirections;
        return OPENING_DIRECTIONS.filter(od => allowed.includes(od.key));
    }

    get showMullion() {
        return true; // All types support panel splits now
    }

    get showTransom() {
        return true; // All types support panel splits now
    }

    get showDividers() {
        return true;
    }

    get canAddMullion() {
        const w = this.props.selectedWindow;
        if (!w) return false;
        if (w.panel_tree) {
            const el = this.props.selectedElement;
            if (el && el.type === 'pane' && el.panelId) {
                return canSplitPanel(w.panel_tree, el.panelId, 'vertical', w.width_mm, w.height_mm);
            }
            return true;
        }
        return true;
    }

    get canAddTransom() {
        const w = this.props.selectedWindow;
        if (!w) return false;
        if (w.panel_tree) {
            const el = this.props.selectedElement;
            if (el && el.type === 'pane' && el.panelId) {
                return canSplitPanel(w.panel_tree, el.panelId, 'horizontal', w.width_mm, w.height_mm);
            }
            return true;
        }
        return true;
    }

    get canMerge() {
        const w = this.props.selectedWindow;
        const el = this.props.selectedElement;
        if (!w || !el) return false;
        if (w.panel_tree && el.type === 'pane' && el.panelId) {
            return canMergePanel(w.panel_tree, el.panelId);
        }
        return false;
    }

    get typeHint() {
        if (!this.props.selectedWindow) return "";
        return this.typeConfig.label || this.selectedType;
    }

    get filteredTemplates() {
        let list = this.props.templates || [];
        if (this.state.templateCategory !== 'all') {
            list = list.filter(t => t.category === this.state.templateCategory);
        }
        const q = (this.state.templateSearch || '').toLowerCase().trim();
        if (q) {
            list = list.filter(t => (t.name || '').toLowerCase().includes(q));
        }
        return list;
    }

    onTemplateCategoryClick(key) {
        this.state.templateCategory = key;
    }

    onTemplateSearchInput(ev) {
        this.state.templateSearch = ev.target.value;
    }

    onTemplateClick(template) {
        this.props.onCreateWindow({
            window_type: template.window_type,
            width_mm: template.default_width,
            height_mm: template.default_height,
            panels: template.default_panels || 1,
            panels_horizontal: template.panels_horizontal || 1,
            panels_vertical: template.panels_vertical || 1,
            source_template_id: template.id,
        });
    }

    get selectedType() {
        return this.props.selectedWindow?.window_type || "";
    }

    get selectedSashKey() {
        const w = this.props.selectedWindow;
        if (!w) return "1x1";
        const h = w.panels_horizontal || 1;
        const v = w.panels_vertical || 1;
        return `${h}x${v}`;
    }

    get selectedDirection() {
        return this.props.selectedWindow?.opening_direction || "left_right";
    }

    get selectedMaterialId() {
        const w = this.props.selectedWindow;
        if (!w || !w.frame_material_id) return null;
        return Array.isArray(w.frame_material_id) ? w.frame_material_id[0] : w.frame_material_id;
    }

    get selectedProfileDepth() {
        return String(this.props.selectedWindow?.profile_depth_mm || "70");
    }

    get selectedProfileTypeId() {
        const w = this.props.selectedWindow;
        if (!w || !w.profile_type_id) return null;
        return Array.isArray(w.profile_type_id) ? w.profile_type_id[0] : w.profile_type_id;
    }

    get availableProfileDepths() {
        // If a profile system is selected, use its available depths
        const psId = this.selectedProfileTypeId;
        if (psId && this.props.profileTypes) {
            const ps = this.props.profileTypes.find(s => s.id === psId);
            if (ps && ps.available_depths && ps.available_depths.length > 0) {
                return ps.available_depths.map(d => ({ key: String(d), label: `${d}mm` }));
            }
        }
        return PROFILE_DEPTHS;
    }

    onProfileTypeChange(ev) {
        const w = this.props.selectedWindow;
        if (!w) return;
        const val = parseInt(ev.target.value, 10);
        const patch = { profile_type_id: val || false };
        // If profile system has a linked material, auto-set it
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
        this.props.onWindowUpdate(w.id, patch);
    }

    getTypeIcon(typeKey) {
        return markup(getWindowTypeIcon(typeKey, 48));
    }

    getSashIcon(layout) {
        // Generate a mini grid SVG preview
        const sz = 28;
        const gap = 2;
        const cw = (sz - (layout.h - 1) * gap) / layout.h;
        const ch = (sz * 0.7 - (layout.v - 1) * gap) / layout.v;
        let rects = '';
        for (let r = 0; r < layout.v; r++) {
            for (let c = 0; c < layout.h; c++) {
                rects += `<rect x="${c * (cw + gap)}" y="${r * (ch + gap)}" width="${cw}" height="${ch}" rx="1" fill="rgba(79,110,247,0.2)" stroke="rgba(79,110,247,0.5)" stroke-width="0.5"/>`;
            }
        }
        return markup(`<svg width="${sz}" height="${Math.round(sz * 0.7)}" viewBox="0 0 ${sz} ${Math.round(sz * 0.7)}">${rects}</svg>`);
    }

    onTypeClick(typeKey) {
        const w = this.props.selectedWindow;
        if (!w) {
            this.props.onCreateWindow({ window_type: typeKey });
            return;
        }
        if (w.window_type === typeKey) return;

        const cfg = getTypeConfig(typeKey);
        const patch = { window_type: typeKey };

        // Reset frame_shape if incompatible
        if (!cfg.frameShapes.includes(w.frame_shape || "rectangular")) {
            patch.frame_shape = cfg.frameShapes[0] || "rectangular";
        }

        // Reset sash layout if incompatible
        const curSash = `${w.panels_horizontal || 1}x${w.panels_vertical || 1}`;
        if (!cfg.sashLayouts.includes(curSash)) {
            const first = SASH_LAYOUTS.find(sl => sl.key === cfg.sashLayouts[0]);
            if (first) {
                patch.panels_horizontal = first.h;
                patch.panels_vertical = first.v;
            }
        }

        // Reset opening_direction if incompatible
        if (!cfg.openingDirections.includes(w.opening_direction || "left_right")) {
            patch.opening_direction = cfg.openingDirections[0] || "fixed";
        }

        // Reset pane_configs opening types to type defaults
        const nH = patch.panels_horizontal || w.panels_horizontal || 1;
        const nV = patch.panels_vertical || w.panels_vertical || 1;
        const total = nH * nV;
        const newConfigs = [];
        for (let i = 0; i < total; i++) {
            const existing = (w.pane_configs || [])[i] || {};
            newConfigs.push({
                ...existing,
                openingType: getDefaultOpeningType(typeKey, i, total),
                hinge: cfg.hingeSides[0] || "left",
            });
        }
        patch.pane_configs = newConfigs;

        // Reset georgian if incompatible
        const gc = w.georgian_bar_config || {};
        if (gc.pattern && !cfg.georgianPatterns.includes(gc.pattern)) {
            patch.georgian_bar_config = { ...gc, pattern: "none" };
        }

        // All types support dividers now — no need to clear mullion_positions

        this.props.onWindowUpdate(w.id, patch);
    }

    onSashClick(layout) {
        const w = this.props.selectedWindow;
        if (!w) return;

        const typeKey = w.window_type || "casement";
        const cfg = getTypeConfig(typeKey);
        const total = layout.h * layout.v;

        const newConfigs = [];
        for (let i = 0; i < total; i++) {
            const existing = (w.pane_configs || [])[i] || {};
            newConfigs.push({
                ...existing,
                openingType: getDefaultOpeningType(typeKey, i, total),
                hinge: cfg.hingeSides[0] || "left",
            });
        }

        const widthMm = w.width_mm || 1200;
        const heightMm = w.height_mm || 1000;
        const mullionPositions = [];
        for (let c = 1; c < layout.h; c++) {
            mullionPositions.push({ orientation: 'vertical', positionMm: Math.round(widthMm * c / layout.h) });
        }
        for (let r = 1; r < layout.v; r++) {
            mullionPositions.push({ orientation: 'horizontal', positionMm: Math.round(heightMm * r / layout.v) });
        }
        const newTree = treeFromGrid(layout.h, layout.v, widthMm, heightMm, mullionPositions, newConfigs);

        this.props.onWindowUpdate(w.id, {
            panels_horizontal: layout.h,
            panels_vertical: layout.v,
            mullion_positions: mullionPositions,
            pane_configs: newConfigs,
            panel_tree: newTree,
        });
    }

    onDirectionClick(dir) {
        const w = this.props.selectedWindow;
        if (w) {
            this.props.onWindowUpdate(w.id, { opening_direction: dir });
        }
    }

    onMaterialClick(matId) {
        const w = this.props.selectedWindow;
        if (w) {
            this.props.onWindowUpdate(w.id, { frame_material_id: matId });
        }
    }

    onProfileDepthClick(depth) {
        const w = this.props.selectedWindow;
        if (w) {
            this.props.onWindowUpdate(w.id, { profile_depth_mm: depth });
        }
    }

    // ── Divider drag-and-drop (Mullion / Transom) ────────────────────

    onDividerDragStart(ev, orientation) {
        ev.dataTransfer.setData(
            "application/wincraft-divider",
            JSON.stringify({ orientation })
        );
        ev.dataTransfer.effectAllowed = "copy";
    }

    /**
     * Add a mullion or transom to the active window at the midpoint.
     * Called when clicking the divider button (non-drag fallback).
     */
    addDivider(orientation) {
        const w = this.props.selectedWindow;
        if (!w) return;
        const widthMm = w.width_mm || 1200;
        const heightMm = w.height_mm || 1000;

        // Panel tree mode — split the selected panel (or initialize tree)
        let tree = w.panel_tree;
        if (!tree) {
            tree = treeFromGrid(
                w.panels_horizontal || 1, w.panels_vertical || 1,
                widthMm, heightMm,
                w.mullion_positions, w.pane_configs,
            );
        }
        const el = this.props.selectedElement;
        let targetPanelId;
        if (el && el.type === 'pane' && el.panelId) {
            targetPanelId = el.panelId;
        } else {
            const leaves = getLeafPanels(tree);
            targetPanelId = leaves.length > 0 ? leaves[0].id : null;
        }
        if (!targetPanelId) return;

        const direction = orientation === 'vertical' ? 'vertical' : 'horizontal';
        const newTree = splitPanelAtMidpoint(tree, targetPanelId, direction, widthMm, heightMm);
        const grid = treeToGrid(newTree, widthMm, heightMm);
        this.props.onWindowUpdate(w.id, {
            panel_tree: newTree,
            panels_horizontal: grid.panelsH,
            panels_vertical: grid.panelsV,
            mullion_positions: grid.mullionPositions,
            pane_configs: grid.paneConfigs,
        });
    }

    mergePanels() {
        const w = this.props.selectedWindow;
        const el = this.props.selectedElement;
        if (!w || !w.panel_tree || !el || el.type !== 'pane' || !el.panelId) return;

        const newTree = mergePanel(w.panel_tree, el.panelId);
        const grid = treeToGrid(newTree, w.width_mm, w.height_mm);
        this.props.onWindowUpdate(w.id, {
            panel_tree: newTree,
            panels_horizontal: grid.panelsH,
            panels_vertical: grid.panelsV,
            mullion_positions: grid.mullionPositions,
            pane_configs: grid.paneConfigs,
        });
    }

    /**
     * Expand pane_configs array to match new panel count,
     * filling new entries with defaults.
     */
    _expandPaneConfigs(existing, newH, newV) {
        const needed = newH * newV;
        const configs = existing ? [...existing] : [];
        while (configs.length < needed) {
            configs.push({
                openingType: "fixed",
                hinge: "left",
                glazingUnit: "double-4-16-4",
                glassSpec: "clear",
                glassTint: "clear",
            });
        }
        return configs.slice(0, needed);
    }
}
