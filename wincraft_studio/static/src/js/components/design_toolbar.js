/** @odoo-module **/
/**
 * WinCraft Studio — Design Toolbar
 * Horizontal toolbar below topbar with Dividers, Frame Shapes, Sash Layouts.
 */

import { Component, markup } from "@odoo/owl";
import { getTypeConfig } from "../utils/window_type_config.js";
import {
    splitPanelAtMidpoint, mergePanel, canSplitPanel, canMergePanel,
    getLeafPanels, treeFromGrid, treeToGrid, updateLeafConfig, findNode,
} from "../utils/panel_tree.js";

console.log("[WinCraft] ✓ LOADED: DesignToolbar");

// Opening type definitions with inline SVG window diagrams
const OPENING_TYPES_DEFS = [
    {
        key: "fixed",
        shortLabel: "Fixed",
        label: "Fixed (non-opening)",
        svgFn: () => `<svg width="18" height="22" viewBox="0 0 18 22"><rect x="1" y="1" width="16" height="20" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="4" y1="4" x2="14" y2="18" stroke="currentColor" stroke-width="1" opacity="0.4"/><line x1="14" y1="4" x2="4" y2="18" stroke="currentColor" stroke-width="1" opacity="0.4"/></svg>`,
    },
    {
        key: "casement-l",
        shortLabel: "CS-L",
        label: "Casement Left (hinge left)",
        svgFn: () => `<svg width="18" height="22" viewBox="0 0 18 22"><rect x="1" y="1" width="16" height="20" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="2.5" cy="5.5" r="1.3" fill="currentColor"/><circle cx="2.5" cy="16.5" r="1.3" fill="currentColor"/><path d="M 17 11 Q 9 2 2 4" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 1.5" opacity="0.7"/><polyline points="15,8 17,11 14,13" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
    },
    {
        key: "casement-r",
        shortLabel: "CS-R",
        label: "Casement Right (hinge right)",
        svgFn: () => `<svg width="18" height="22" viewBox="0 0 18 22"><rect x="1" y="1" width="16" height="20" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="15.5" cy="5.5" r="1.3" fill="currentColor"/><circle cx="15.5" cy="16.5" r="1.3" fill="currentColor"/><path d="M 1 11 Q 9 2 16 4" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 1.5" opacity="0.7"/><polyline points="3,8 1,11 4,13" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
    },
    {
        key: "awning",
        shortLabel: "Awning",
        label: "Awning (top-hung, opens at bottom)",
        svgFn: () => `<svg width="18" height="22" viewBox="0 0 18 22"><rect x="1" y="1" width="16" height="20" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="5" cy="2.2" r="1.3" fill="currentColor"/><circle cx="13" cy="2.2" r="1.3" fill="currentColor"/><path d="M 9 21 Q 2 16 2 11" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 1.5" opacity="0.7"/><polyline points="6,19 9,21 12,19" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
    },
    {
        key: "hopper",
        shortLabel: "Hopper",
        label: "Hopper (bottom-hinged, tilts inward)",
        svgFn: () => `<svg width="18" height="22" viewBox="0 0 18 22"><rect x="1" y="1" width="16" height="20" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="5" cy="19.8" r="1.3" fill="currentColor"/><circle cx="13" cy="19.8" r="1.3" fill="currentColor"/><path d="M 9 2 Q 2 7 2 12" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 1.5" opacity="0.7"/><polyline points="6,4 9,2 12,4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
    },
    {
        key: "tiltturn",
        shortLabel: "T&T",
        label: "Tilt & Turn",
        svgFn: () => `<svg width="18" height="22" viewBox="0 0 18 22"><rect x="1" y="1" width="16" height="20" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="9" y1="1" x2="1" y2="21" stroke="currentColor" stroke-width="1" stroke-dasharray="2 1.5" opacity="0.6"/><line x1="1" y1="11" x2="17" y2="11" stroke="currentColor" stroke-width="1" stroke-dasharray="2 1.5" opacity="0.6"/><circle cx="9" cy="2" r="1.2" fill="#4f6ef7"/><circle cx="2" cy="11" r="1.2" fill="#4f6ef7"/></svg>`,
    },
    {
        key: "sliding",
        shortLabel: "Slide",
        label: "Horizontal Slider",
        svgFn: () => `<svg width="18" height="22" viewBox="0 0 18 22"><rect x="1" y="1" width="16" height="20" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="9" y1="1" x2="9" y2="21" stroke="currentColor" stroke-width="1"/><polyline points="12,9 15,11 12,13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><polyline points="6,9 3,11 6,13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`,
    },
    {
        key: "lift-slide",
        shortLabel: "L&S",
        label: "Lift & Slide",
        svgFn: () => `<svg width="18" height="22" viewBox="0 0 18 22"><rect x="1" y="1" width="16" height="20" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="9" y1="1" x2="9" y2="21" stroke="currentColor" stroke-width="1"/><polyline points="3,10 5,7 7,10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><line x1="5" y1="7" x2="5" y2="16" stroke="currentColor" stroke-width="1.2"/><polyline points="12,9 15,11 12,13" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><line x1="10" y1="11" x2="15" y2="11" stroke="currentColor" stroke-width="1.2"/></svg>`,
    },
    {
        key: "single-hung",
        shortLabel: "S-Hung",
        label: "Single Hung (bottom sash slides)",
        svgFn: () => `<svg width="18" height="22" viewBox="0 0 18 22"><rect x="1" y="1" width="16" height="20" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="1" y1="11" x2="17" y2="11" stroke="currentColor" stroke-width="1.5"/><line x1="3" y1="3" x2="15" y2="10" stroke="currentColor" stroke-width="0.8" opacity="0.35"/><line x1="15" y1="3" x2="3" y2="10" stroke="currentColor" stroke-width="0.8" opacity="0.35"/><polyline points="7,17 9,14 11,17" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><line x1="9" y1="14" x2="9" y2="20" stroke="currentColor" stroke-width="1.2"/></svg>`,
    },
    {
        key: "double-hung",
        shortLabel: "D-Hung",
        label: "Double Hung",
        svgFn: () => `<svg width="18" height="22" viewBox="0 0 18 22"><rect x="1" y="1" width="16" height="20" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="1" y1="11" x2="17" y2="11" stroke="currentColor" stroke-width="1.5"/><polyline points="7,5 9,3 11,5" fill="none" stroke="currentColor" stroke-width="1.2"/><polyline points="7,17 9,19 11,17" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`,
    },
    {
        key: "bifold",
        shortLabel: "Bi-Fold",
        label: "Bi-Fold",
        svgFn: () => `<svg width="18" height="22" viewBox="0 0 18 22"><rect x="1" y="1" width="16" height="20" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="6" y1="1" x2="6" y2="21" stroke="currentColor" stroke-width="1"/><line x1="12" y1="1" x2="12" y2="21" stroke="currentColor" stroke-width="1"/><polyline points="4,10 1,11 4,12" fill="none" stroke="currentColor" stroke-width="1.1"/><polyline points="14,10 17,11 14,12" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>`,
    },
    {
        key: "pivot",
        shortLabel: "Pivot",
        label: "Pivot (central axis rotation)",
        svgFn: () => `<svg width="18" height="22" viewBox="0 0 18 22"><rect x="1" y="1" width="16" height="20" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="1" y1="11" x2="17" y2="11" stroke="currentColor" stroke-width="1.5"/><rect x="2" y="2" width="14" height="8.5" fill="currentColor" opacity="0.08" rx="1"/><path d="M 4 5 Q 9 2 14 5" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 1.5" opacity="0.65"/><path d="M 4 17 Q 9 20 14 17" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 1.5" opacity="0.65"/><circle cx="1.5" cy="11" r="1.2" fill="currentColor"/><circle cx="16.5" cy="11" r="1.2" fill="currentColor"/></svg>`,
    },
    {
        key: "louvre",
        shortLabel: "Louvre",
        label: "Louvre / Jalousie (angled slats)",
        svgFn: () => `<svg width="18" height="22" viewBox="0 0 18 22"><rect x="1" y="1" width="16" height="20" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="3" y1="6" x2="15" y2="8" stroke="currentColor" stroke-width="1.5"/><line x1="3" y1="10" x2="15" y2="12" stroke="currentColor" stroke-width="1.5"/><line x1="3" y1="14" x2="15" y2="16" stroke="currentColor" stroke-width="1.5"/></svg>`,
    },
];

export class DesignToolbar extends Component {
    static template = "wincraft_studio.DesignToolbar";

    static props = {
        selectedWindow: { optional: true },
        selectedElement: { optional: true },
        selectedPaneIds: { type: Array, optional: true },
        onWindowUpdate: Function,
        onDividerDrop: Function,
    };

    get hasWindow() {
        return !!this.props.selectedWindow;
    }

    get typeConfig() {
        return getTypeConfig(this.props.selectedWindow?.window_type);
    }

    // ── Dividers (Split / Merge) ──

    get canAddMullion() {
        const w = this.props.selectedWindow;
        if (!w) return false;
        // Panel tree mode: can always split if a panel is selected
        if (w.panel_tree) {
            const el = this.props.selectedElement;
            if (el && el.type === 'pane' && el.panelId) {
                return canSplitPanel(w.panel_tree, el.panelId, 'vertical', w.width_mm, w.height_mm);
            }
            // If no specific panel selected, allow (will split first/largest panel)
            return true;
        }
        if (!this.typeConfig.allowMullion) return false;
        return true; // No panel count limit with tree
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
        if (!this.typeConfig.allowTransom) return false;
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

    get showDividers() {
        return true; // Always show — all types support panel splits now
    }

    addDivider(orientation) {
        const w = this.props.selectedWindow;
        if (!w) return;
        const widthMm = w.width_mm || 1200;
        const heightMm = w.height_mm || 1000;

        // Panel tree mode — split the selected panel (or initialize tree)
        if (w.panel_tree || this._shouldUseTree(w)) {
            let tree = w.panel_tree;
            if (!tree) {
                // Convert legacy grid to tree
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
                // Split the first leaf panel
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
            return;
        }

        // Legacy path (fallback)
        const nH = w.panels_horizontal || 1;
        const nV = w.panels_vertical || 1;

        const positions = w.mullion_positions?.length ? [...w.mullion_positions] : [];

        // Fill equal-division positions if empty for this orientation
        if (!positions.some(m => m.orientation === 'vertical') && nH > 1) {
            for (let c = 1; c < nH; c++) {
                positions.push({ orientation: 'vertical', positionMm: Math.round(widthMm * c / nH) });
            }
        }
        if (!positions.some(m => m.orientation === 'horizontal') && nV > 1) {
            for (let r = 1; r < nV; r++) {
                positions.push({ orientation: 'horizontal', positionMm: Math.round(heightMm * r / nV) });
            }
        }

        if (orientation === 'vertical') {
            const vPos = positions.filter(m => m.orientation === 'vertical').map(m => m.positionMm).sort((a, b) => a - b);
            const edges = [0, ...vPos, widthMm];
            let maxSpan = 0, splitAt = Math.round(widthMm / 2);
            for (let i = 0; i < edges.length - 1; i++) {
                const span = edges[i + 1] - edges[i];
                if (span > maxSpan) { maxSpan = span; splitAt = Math.round((edges[i] + edges[i + 1]) / 2); }
            }
            positions.push({ orientation: 'vertical', positionMm: splitAt });
            this._applyDivider(w, { panels_horizontal: nH + 1, mullion_positions: positions }, nH + 1, nV);
        } else {
            const hPos = positions.filter(m => m.orientation === 'horizontal').map(m => m.positionMm).sort((a, b) => a - b);
            const edges = [0, ...hPos, heightMm];
            let maxSpan = 0, splitAt = Math.round(heightMm / 2);
            for (let i = 0; i < edges.length - 1; i++) {
                const span = edges[i + 1] - edges[i];
                if (span > maxSpan) { maxSpan = span; splitAt = Math.round((edges[i] + edges[i + 1]) / 2); }
            }
            positions.push({ orientation: 'horizontal', positionMm: splitAt });
            this._applyDivider(w, { panels_vertical: nV + 1, mullion_positions: positions }, nH, nV + 1);
        }
    }

    _applyDivider(w, patch, newH, newV) {
        const needed = newH * newV;
        const configs = w.pane_configs ? [...w.pane_configs] : [];
        while (configs.length < needed) {
            configs.push({ openingType: "fixed", hinge: "left", glazingUnit: "double-4-16-4", glassSpec: "clear", glassTint: "clear" });
        }
        patch.pane_configs = configs.slice(0, needed);
        this.props.onWindowUpdate(w.id, patch);
    }

    onDividerDragStart(ev, orientation) {
        ev.dataTransfer.setData("application/wincraft-divider", JSON.stringify({ orientation }));
        ev.dataTransfer.effectAllowed = "copy";
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

    /** Determine if we should upgrade to tree mode for a new split */
    _shouldUseTree(w) {
        // Use tree mode once any split has been made
        return true;
    }

    // ── Opening Types ──

    get openingTypes() {
        const allowed = this.typeConfig?.openingTypes;
        return OPENING_TYPES_DEFS.map(ot => ({
            ...ot,
            svgIcon: markup(ot.svgFn()),
            disabled: allowed ? !allowed.includes(ot.key) : false,
        }));
    }

    /** Opening types grouped with dividers between logical categories */
    get openingTypeGroups() {
        const types = this.openingTypes;
        const byKey = Object.fromEntries(types.map(t => [t.key, t]));
        const GROUP_DEFS = [
            { id: 'static',  keys: ['fixed'] },
            { id: 'hinged',  keys: ['casement-l', 'casement-r', 'awning', 'hopper', 'tiltturn'] },
            { id: 'sliding', keys: ['sliding', 'lift-slide'] },
            { id: 'hung',    keys: ['single-hung', 'double-hung'] },
            { id: 'special', keys: ['bifold', 'pivot', 'louvre'] },
        ];
        return GROUP_DEFS.map(g => ({
            id: g.id,
            types: g.keys.map(k => byKey[k]).filter(Boolean),
        })).filter(g => g.types.length > 0);
    }

    /** Returns the opening type key of the currently selected pane */
    get activeOpeningType() {
        const w = this.props.selectedWindow;
        const el = this.props.selectedElement;
        if (!w || !el || el.type !== 'pane') return null;
        if (w.panel_tree && el.panelId) {
            const found = findNode(w.panel_tree, el.panelId);
            return found?.node?.config?.openingType || 'fixed';
        }
        const idx = el.index ?? 0;
        return (w.pane_configs || [])[idx]?.openingType || 'fixed';
    }

    onOpeningTypeClick(key) {
        const w = this.props.selectedWindow;
        const el = this.props.selectedElement;
        if (!w) return;
        // Reject types not compatible with this window type
        const allowed = this.typeConfig?.openingTypes;
        if (allowed && !allowed.includes(key)) return;
        const paneIds = this.props.selectedPaneIds || [];

        // Smart defaults for pill fields when set via toolbar
        const SMART_DEFAULTS = {
            'casement-l': { hingeSide: 'left', hinge: 'left', foldDirection: null, pivotPosition: null },
            'casement-r': { hingeSide: 'right', hinge: 'right', foldDirection: null, pivotPosition: null },
            'awning':     { hingeSide: null, hinge: 'top', foldDirection: null, pivotPosition: null },
            'hopper':     { hingeSide: null, hinge: 'top', foldDirection: null, pivotPosition: null },
            'bifold':     { foldDirection: 'left', hingeSide: null, pivotPosition: null },
            'pivot':      { pivotPosition: 'horizontal', hingeSide: null, foldDirection: null },
        };
        const defaults = SMART_DEFAULTS[key] || {};
        const configPatch = {
            openingType: key,
            hingeSide: null, foldDirection: null, pivotPosition: null,
            hardwareSelections: {},
            ...defaults,
        };

        // Tree mode
        if (w.panel_tree && el?.panelId) {
            if (paneIds.length > 1) {
                let tree = w.panel_tree;
                for (const pid of paneIds) {
                    tree = updateLeafConfig(tree, pid, configPatch);
                }
                this.props.onWindowUpdate(w.id, { panel_tree: tree });
            } else {
                const newTree = updateLeafConfig(w.panel_tree, el.panelId, configPatch);
                this.props.onWindowUpdate(w.id, { panel_tree: newTree });
            }
            return;
        }
        // Legacy flat pane_configs
        if (!el || el.type !== 'pane') return;
        const idx = el.index ?? 0;
        const configs = [...(w.pane_configs || [])];
        const indices = paneIds.length > 1 ? paneIds : [idx];
        const maxIdx = Math.max(...indices);
        while (configs.length <= maxIdx) configs.push({ openingType: 'fixed' });
        for (const i of indices) {
            configs[i] = { ...configs[i], ...configPatch };
        }
        this.props.onWindowUpdate(w.id, { pane_configs: configs });
    }
}
