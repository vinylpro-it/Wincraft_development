/** @odoo-module **/
/**
 * WinCraft Studio — Designer Canvas
 * Pure SVG canvas engine. Handles:
 *   - Pan (middle-click drag / space+drag)
 *   - Zoom (mouse wheel)
 *   - Window drag-move
 *   - Window resize (corner handles)
 *   - Rubber-band multi-select
 *   - Drop new windows from Component Library
 *   - Grid / snap
 *   - Rulers (top + left, 100mm marks)
 *   - Undo / redo via history manager
 *   - Auto-save (debounced 30s) via ORM HTTP route
 */

import { Component, useState, useRef, onMounted, onWillUnmount, onPatched } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { WindowObject } from "./window_object.js";
import { WindowIso3DDialog } from "./window_iso_3d_dialog.js";
import { snapToGrid, clamp, getBoundingBox, debounce } from "../utils/canvas_state.js";
import { getLeafPanels, mergePanel, treeToGrid, canMergePanel, getSplitNodes } from "../utils/panel_tree.js";
import { mmToInch, inchToMm, formatInchesAsFraction, parseInchesFraction } from "../utils/units.js";

console.log("[WinCraft] ✓ LOADED: DesignerCanvas");

const RULER_SIZE = 24;          // px wide/tall
const MIN_SCALE = 0.1;
const MAX_SCALE = 4.0;
const GRID_MM = 25;             // grid step in mm
const MM_PER_PX_BASE = 0.5;    // 1 px = 0.5 mm at 100% zoom
const CANVAS_W_MM = 5000;      // logical canvas size
const CANVAS_H_MM = 4000;

export class DesignerCanvas extends Component {
    static template = "wincraft_studio.DesignerCanvas";
    static components = { WindowObject };

    static props = {
        windows: { type: Array },
        projectId: { type: Number },
        selectedIds: { type: Array },
        selectedElement: { type: Object, optional: true },
        snapEnabled: { type: Boolean },
        canUndo: { type: Boolean },
        canRedo: { type: Boolean },
        history: { type: Object },
        onWindowsChange: Function,    // (updatedWindowsArray) => void
        onSelectChange: Function,     // (ids) => void
        onSaveStatus: Function,       // (isSaving: bool) => void
        onUndo: Function,
        onRedo: Function,
        onToggleSnap: Function,
        onAlign: { type: Function, optional: true },
        onDistribute: { type: Function, optional: true },
        selectedPaneIds: { type: Array, optional: true },
        onSelectElement: { type: Function, optional: true },
        onDividerDrop: { type: Function, optional: true },
        onMullionDelete: { type: Function, optional: true },
        onResetPane: { type: Function, optional: true },
        onWindowUpdate: { type: Function, optional: true },
        onSectionDimEdit: { type: Function, optional: true },
        glazingConfigs: { type: Array, optional: true },
        glassConfigs: { type: Array, optional: true },
        unitSystem: { type: String, optional: true },
    };

    setup() {
        console.log("[WinCraft] DesignerCanvas → setup() START");
        try {
            this.dialogService = useService("dialog");
            console.log("[WinCraft] DesignerCanvas → calling useState");
            this.state = useState({
                viewX: 0,           // canvas pan offset in pixels
                viewY: 0,
                scale: 1.0,         // zoom
                isPanning: false,
                rubberBand: null,   // { startX, startY, curX, curY } in canvas coords
                spaceDown: false,
                showZoomPresets: false,
                showZoomInput: false,
                showGrid: true,     // line grid overlay visible
                dimEditor: null,    // { windowId, dimType, dimValue, x, y } for inline dimension editing
            });
            console.log("[WinCraft] DesignerCanvas → state OK");

            this.svgRef = useRef("svgRef");
            this.containerRef = useRef("containerRef");
            this.dimInputRef = useRef("dimInput");
            this._dragPan = null;
            this._pendingWindowUpdates = {};

            this._autoSave = debounce(this._saveCanvas.bind(this), 30_000);

            onMounted(() => {
                console.log("[WinCraft] DesignerCanvas → onMounted START");
                try {
                    this._fitToContents();
                    this._bindKeyboard();
                    console.log("[WinCraft] DesignerCanvas → onMounted DONE");
                } catch(e) {
                    console.error("[WinCraft] DesignerCanvas → onMounted CRASHED:", e);
                    console.error("[WinCraft] Stack:", e.stack);
                }
            });

            onWillUnmount(() => {
                console.log("[WinCraft] DesignerCanvas → onWillUnmount");
                this._unbindKeyboard();
                this._autoSave.flush && this._autoSave.flush();
            });

            onPatched(() => {
                if (this.state.dimEditor && this.dimInputRef.el) {
                    this.dimInputRef.el.focus();
                    this.dimInputRef.el.select();
                }
            });

            console.log("[WinCraft] DesignerCanvas → setup() DONE ✓");
        } catch(e) {
            console.error("[WinCraft] DesignerCanvas → setup() CRASHED:", e);
            console.error("[WinCraft] Stack:", e.stack);
        }
    }

    // ─── Scale helpers ───────────────────────────────────────────────────────

    get mmToPixel() { return MM_PER_PX_BASE * this.state.scale; }

    _mmToPx(mm) { return mm * this.mmToPixel; }
    _pxToMm(px) { return px / this.mmToPixel; }

    // Total SVG logical size
    get svgW() { return this._mmToPx(CANVAS_W_MM); }
    get svgH() { return this._mmToPx(CANVAS_H_MM); }

    // ─── Coordinate conversion ────────────────────────────────────────────────

    /**
     * Convert a clientX/clientY (browser viewport) to canvas mm coordinates.
     *
     * @param {number} clientX
     * @param {number} clientY
     * @returns {{ x: number, y: number }} in mm
     */
    clientToCanvasMm(clientX, clientY) {
        const rect = this.svgRef.el.getBoundingClientRect();
        const px = clientX - rect.left - this.state.viewX;
        const py = clientY - rect.top - this.state.viewY;
        return { x: this._pxToMm(px), y: this._pxToMm(py) };
    }

    // ─── Fit view ──────────────────────────────────────────────────────────────

    _fitToContents() {
        const windows = this.props.windows;
        if (!windows.length) {
            this.state.viewX = RULER_SIZE;
            this.state.viewY = RULER_SIZE;
            return;
        }
        const bb = getBoundingBox(
            windows.map(w => ({
                x: w.canvas_x || 0,
                y: w.canvas_y || 0,
                w: w.width_mm || 600,
                h: w.height_mm || 900,
            }))
        );
        const el = this.containerRef.el;
        if (!el) return;
        const vw = el.clientWidth - RULER_SIZE;
        const vh = el.clientHeight - RULER_SIZE;
        const scaleX = vw / this._mmToPx(bb.w + 200) * this.state.scale;
        const scaleY = vh / this._mmToPx(bb.h + 200) * this.state.scale;
        const newScale = clamp(Math.min(scaleX, scaleY), MIN_SCALE, MAX_SCALE);
        const mtp = MM_PER_PX_BASE * newScale;
        this.state.scale = newScale;
        this.state.viewX = RULER_SIZE - bb.x * mtp + (vw - bb.w * mtp) / 2;
        this.state.viewY = RULER_SIZE - bb.y * mtp + (vh - bb.h * mtp) / 2;
    }

    // ─── Floating toolbar zoom methods ────────────────────────────────────────

    zoomIn() {
        const newScale = clamp(this.state.scale * 1.25, MIN_SCALE, MAX_SCALE);
        const el = this.containerRef.el;
        if (el) {
            const cx = el.clientWidth / 2;
            const cy = el.clientHeight / 2;
            const ratio = newScale / this.state.scale;
            this.state.viewX = cx - (cx - this.state.viewX) * ratio;
            this.state.viewY = cy - (cy - this.state.viewY) * ratio;
        }
        this.state.scale = newScale;
    }

    zoomOut() {
        const newScale = clamp(this.state.scale * 0.8, MIN_SCALE, MAX_SCALE);
        const el = this.containerRef.el;
        if (el) {
            const cx = el.clientWidth / 2;
            const cy = el.clientHeight / 2;
            const ratio = newScale / this.state.scale;
            this.state.viewX = cx - (cx - this.state.viewX) * ratio;
            this.state.viewY = cy - (cy - this.state.viewY) * ratio;
        }
        this.state.scale = newScale;
    }

    fitToView() {
        this._fitToContents();
    }

    /** Returns the bay/bow window the 3D button should target.
     *  Prefers the selected window when it is bay/bow; otherwise falls back to
     *  the first bay/bow window in the project so the button stays useful even
     *  when the user has clicked the canvas background and cleared selection. */
    get selectedBayBowWindow() {
        const isBayBow = (w) => {
            const t = (w && w.window_type) || 'casement';
            return t === 'bay' || t === 'bow';
        };
        const wins = this.props.windows || [];
        const ids = this.props.selectedIds || [];
        if (ids.length === 1) {
            const w = wins.find((x) => x.id === ids[0]);
            if (w && isBayBow(w)) return w;
        }
        return wins.find(isBayBow) || null;
    }

    /** Open the bay/bow 3D iso popup. */
    open3DView() {
        const w = this.selectedBayBowWindow;
        console.log("[WinCraft][3D] open3DView clicked. window=", w && w.name, " dialogService?", !!this.dialogService);
        if (!w) {
            console.warn("[WinCraft][3D] No bay/bow window available to display.");
            return;
        }
        try {
            this.dialogService.add(WindowIso3DDialog, { window: w });
            console.log("[WinCraft][3D] Dialog opened for window id", w.id);
        } catch (e) {
            console.error("[WinCraft][3D] Dialog.add threw:", e);
        }
    }

    get zoomPct() {
        return Math.round(this.state.scale * 100);
    }

    /** Available zoom presets for the dropdown */
    get zoomPresets() {
        return [10, 25, 50, 75, 100, 150, 200, 300, 400];
    }

    /** Set zoom to an exact percentage, keeping the center in view */
    setZoomPercent(pct) {
        const target = clamp(pct / 100, MIN_SCALE, MAX_SCALE);
        const el = this.containerRef.el;
        if (el) {
            const cx = el.clientWidth / 2;
            const cy = el.clientHeight / 2;
            const ratio = target / this.state.scale;
            this.state.viewX = cx - (cx - this.state.viewX) * ratio;
            this.state.viewY = cy - (cy - this.state.viewY) * ratio;
        }
        this.state.scale = target;
    }

    /** Handle typing a custom zoom % in the toolbar */
    onZoomInputCommit(ev) {
        const val = Number.parseInt(ev.target.value, 10);
        if (!Number.isNaN(val) && val >= 10 && val <= 400) {
            this.setZoomPercent(val);
        }
        ev.target.value = this.zoomPct;
        this.state.showZoomInput = false;
    }

    onZoomInputKeydown(ev) {
        if (ev.code === "Enter") {
            ev.target.blur();
        } else if (ev.code === "Escape") {
            ev.target.value = this.zoomPct;
            this.state.showZoomInput = false;
            ev.target.blur();
        }
    }

    onZoomPresetClick(pct) {
        this.setZoomPercent(pct);
        this.state.showZoomPresets = false;
    }

    toggleZoomPresets() {
        this.state.showZoomPresets = !this.state.showZoomPresets;
    }

    // ─── Inline dimension editor ─────────────────────────────────────────────

    get dimEditorStyle() {
        return '';
    }

    get dimEditorLabel() {
        if (!this.state.dimEditor) return '';
        const dt = this.state.dimEditor.dimType;
        if (dt === 'overall-width') return 'Width';
        if (dt === 'overall-height') return 'Height';
        if (dt === 'section-width') return `W${(this.state.dimEditor.dimIndex ?? 0) + 1}`;
        if (dt === 'section-height') return `H${(this.state.dimEditor.dimIndex ?? 0) + 1}`;
        return '';
    }

    /** Imperial mode edits the pill in construction-style fractions, matching
     *  the fraction labels drawn on the canvas (WS-8) and the properties
     *  panel's dimension inputs (WS-2) — mm is the internal source of truth. */
    get dimEditorIsImperial() { return this.props.unitSystem === 'imperial'; }
    get dimEditorInputType() { return this.dimEditorIsImperial ? 'text' : 'number'; }
    get dimEditorUnitLabel() { return this.dimEditorIsImperial ? 'in' : 'mm'; }
    get dimEditorDisplayValue() {
        if (!this.state.dimEditor) return '';
        return this.dimEditorIsImperial
            ? formatInchesAsFraction(mmToInch(this.state.dimEditor.dimValue))
            : this.state.dimEditor.dimValue;
    }

    onDimEdit(detail) {
        this.state.dimEditor = {
            windowId: detail.windowId,
            dimType: detail.dimType,
            dimIndex: detail.dimIndex,
            dimValue: detail.dimValue,
            leftDividerId: detail.leftDividerId,
            rightDividerId: detail.rightDividerId,
            leftDividerMm: detail.leftDividerMm,
            rightDividerMm: detail.rightDividerMm,
            x: detail.clientX,
            y: detail.clientY,
        };
    }

    onDimEditorCommit(ev) {
        const val = this.dimEditorIsImperial
            ? inchToMm(parseInchesFraction(ev.target.value))
            : Number.parseInt(ev.target.value, 10);
        if (val && val > 0 && this.state.dimEditor) {
            const ed = this.state.dimEditor;
            const { windowId, dimType } = ed;

            if (dimType === 'overall-width' || dimType === 'overall-height') {
                // Overall dimension — update width_mm or height_mm directly
                if (val >= 100 && val <= 10000 && this.props.onWindowUpdate) {
                    const field = dimType === 'overall-width' ? 'width_mm' : 'height_mm';
                    this.props.onWindowUpdate(windowId, { [field]: val });
                }
            } else if (dimType === 'section-width' || dimType === 'section-height') {
                // Section dimension — move the divider(s) to achieve the new section size
                const delta = val - ed.dimValue;  // mm change requested
                if (delta !== 0 && this.props.onSectionDimEdit) {
                    this.props.onSectionDimEdit({
                        windowId,
                        dimType,
                        sectionIndex: ed.dimIndex,
                        oldValue: ed.dimValue,
                        newValue: val,
                        delta,
                        leftDividerId: ed.leftDividerId,
                        rightDividerId: ed.rightDividerId,
                        leftDividerMm: ed.leftDividerMm,
                        rightDividerMm: ed.rightDividerMm,
                    });
                }
            }
        }
        this.state.dimEditor = null;
    }

    onDimEditorKeydown(ev) {
        ev.stopPropagation();
        if (ev.key === 'Enter') {
            ev.preventDefault();
            this.onDimEditorCommit(ev);
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            this.state.dimEditor = null;
        }
    }

    // ─── Keyboard ─────────────────────────────────────────────────────────────

    _bindKeyboard() {
        this._onKeyDown = (ev) => {
            if (ev.code === "Space" && !ev.repeat) {
                ev.preventDefault();
                this.state.spaceDown = true;
            }
            if (ev.ctrlKey && ev.code === "KeyZ" && !ev.shiftKey) {
                ev.preventDefault();
                this._undo();
            }
            if (ev.ctrlKey && (ev.code === "KeyY" || (ev.code === "KeyZ" && ev.shiftKey))) {
                ev.preventDefault();
                this._redo();
            }
            if (ev.code === "Delete" || ev.code === "Backspace") {
                if (document.activeElement === this.svgRef.el || document.activeElement === this.containerRef.el) {
                    this._deleteSelected();
                }
            }
            // Escape: dismiss dim editor first, then deselect pane, then window
            if (ev.code === "Escape") {
                if (this.state.dimEditor) {
                    this.state.dimEditor = null;
                    return;
                }
                const el = this.props.selectedElement;
                if (el && el.type) {
                    if (this.props.onSelectElement) {
                        this.props.onSelectElement({ type: null, index: null });
                    }
                } else if (this.props.selectedIds.length > 0) {
                    this.props.onSelectChange([]);
                }
            }
            // Tab: cycle through panes in the active window
            if (ev.code === "Tab" && (document.activeElement === this.svgRef.el || document.activeElement === this.containerRef.el)) {
                ev.preventDefault();
                this._cyclePaneSelection(ev.shiftKey);
            }
            // F: fit to view (only when not typing in an input)
            if (ev.code === "KeyF" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
                const tag = document.activeElement?.tagName?.toLowerCase();
                if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
                    ev.preventDefault();
                    this._fitToContents();
                }
            }
        };
        this._onKeyUp = (ev) => {
            if (ev.code === "Space") this.state.spaceDown = false;
        };

        window.addEventListener("keydown", this._onKeyDown);
        window.addEventListener("keyup", this._onKeyUp);
    }

    _unbindKeyboard() {
        window.removeEventListener("keydown", this._onKeyDown);
        window.removeEventListener("keyup", this._onKeyUp);
    }

    // ─── Undo / Redo ──────────────────────────────────────────────────────────

    _undo() {
        const currentState = { windows: this.props.windows.map(w => ({ ...w })) };
        const prev = this.props.history.undo(currentState);
        if (prev) this.props.onWindowsChange(prev.windows || []);
    }

    _redo() {
        const currentState = { windows: this.props.windows.map(w => ({ ...w })) };
        const next = this.props.history.redo(currentState);
        if (next) this.props.onWindowsChange(next.windows || []);
    }

    _deleteSelected() {
        const ids = new Set(this.props.selectedIds);
        if (!ids.size) return;
        const newWindows = this.props.windows.filter(w => !ids.has(w.id));
        this._pushHistory(newWindows);
        this.props.onWindowsChange(newWindows);
        this.props.onSelectChange([]);
    }

    _pushHistory(windows) {
        this.props.history.push({ windows: windows.map(w => ({ ...w })) });
    }

    // ─── Auto-save ────────────────────────────────────────────────────────────

    async _saveCanvas() {
        console.log("[WinCraft] DesignerCanvas → _saveCanvas() START");
        const payload = {
            project_id: this.props.projectId,
            windows: this.props.windows.map(w => ({
                id: w.id,
                canvas_x: w.canvas_x,
                canvas_y: w.canvas_y,
                width_mm: w.width_mm,
                height_mm: w.height_mm,
            })),
            view: {
                scale: this.state.scale,
                viewX: this.state.viewX,
                viewY: this.state.viewY,
            },
        };
        this.props.onSaveStatus(true);
        try {
            console.log("[WinCraft] DesignerCanvas → _saveCanvas() fetching /wincraft/canvas/save");
            await fetch("/wincraft/canvas/save", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: payload }),
            });
            console.log("[WinCraft] DesignerCanvas → _saveCanvas() DONE");
        } catch(e) {
            console.error("[WinCraft] DesignerCanvas → _saveCanvas() CRASHED:", e);
            console.error("[WinCraft] Stack:", e.stack);
        } finally {
            this.props.onSaveStatus(false);
        }
    }

    _triggerAutoSave() {
        this._autoSave();
    }

    // ─── Wheel zoom ───────────────────────────────────────────────────────────

    onWheel(ev) {
        ev.preventDefault();
        const factor = ev.deltaY < 0 ? 1.1 : 0.9;
        const rect = this.svgRef.el.getBoundingClientRect();
        const ox = ev.clientX - rect.left;
        const oy = ev.clientY - rect.top;
        const newScale = clamp(this.state.scale * factor, MIN_SCALE, MAX_SCALE);
        const scaleRatio = newScale / this.state.scale;
        this.state.viewX = ox - (ox - this.state.viewX) * scaleRatio;
        this.state.viewY = oy - (oy - this.state.viewY) * scaleRatio;
        this.state.scale = newScale;
    }

    // ─── Pan (middle-click or space+drag) ─────────────────────────────────────

    onSvgMouseDown(ev) {
        // Dismiss inline dimension editor on any background click
        if (this.state.dimEditor) {
            this.state.dimEditor = null;
        }

        // Middle mouse or Space+Left mouse → pan
        if (ev.button === 1 || (ev.button === 0 && this.state.spaceDown)) {
            ev.preventDefault();
            this._dragPan = {
                startClientX: ev.clientX,
                startClientY: ev.clientY,
                startViewX: this.state.viewX,
                startViewY: this.state.viewY,
            };
            this.state.isPanning = true;
            return;
        }

        // Left click on background → start rubber-band
        if (ev.button === 0) {
            const mm = this.clientToCanvasMm(ev.clientX, ev.clientY);
            this.state.rubberBand = { startX: mm.x, startY: mm.y, curX: mm.x, curY: mm.y };
            if (!ev.shiftKey) {
                this.props.onSelectChange([]);
                // Also clear pane/mullion selection
                if (this.props.onSelectElement) {
                    this.props.onSelectElement({ type: null, index: null });
                }
            }
        }
    }

    onSvgMouseMove(ev) {
        if (this.state.isPanning && this._dragPan) {
            this.state.viewX = this._dragPan.startViewX + (ev.clientX - this._dragPan.startClientX);
            this.state.viewY = this._dragPan.startViewY + (ev.clientY - this._dragPan.startClientY);
            return;
        }

        if (this.state.rubberBand) {
            const mm = this.clientToCanvasMm(ev.clientX, ev.clientY);
            this.state.rubberBand = { ...this.state.rubberBand, curX: mm.x, curY: mm.y };
        }
    }

    onSvgMouseUp(ev) {
        if (this.state.isPanning) {
            this._dragPan = null;
            this.state.isPanning = false;
            return;
        }

        if (this.state.rubberBand) {
            const rb = this.state.rubberBand;
            const minX = Math.min(rb.startX, rb.curX);
            const maxX = Math.max(rb.startX, rb.curX);
            const minY = Math.min(rb.startY, rb.curY);
            const maxY = Math.max(rb.startY, rb.curY);
            const tolerance = 4; // mm — ignore tiny clicks
            if (maxX - minX > tolerance || maxY - minY > tolerance) {
                const selected = this.props.windows
                    .filter(w => {
                        const wx = w.canvas_x || 0;
                        const wy = w.canvas_y || 0;
                        const ww = w.width_mm || 600;
                        const wh = w.height_mm || 900;
                        return wx < maxX && wx + ww > minX && wy < maxY && wy + wh > minY;
                    })
                    .map(w => w.id);
                this.props.onSelectChange(ev.shiftKey
                    ? [...new Set([...this.props.selectedIds, ...selected])]
                    : selected
                );
            }
            this.state.rubberBand = null;
        }

        // Flush pending position/size updates after drag
        if (Object.keys(this._pendingWindowUpdates).length) {
            const pendingCopy = { ...this._pendingWindowUpdates };
            const updated = this.props.windows.map(w => {
                const patch = pendingCopy[w.id];
                return patch ? { ...w, ...patch } : w;
            });
            this._pendingWindowUpdates = {};
            this._pushHistory(updated);
            this.props.onWindowsChange(updated);
            this._triggerAutoSave();

            // Persist mullion_positions, panel_tree and bay/bow lite widths to ORM
            for (const [id, patch] of Object.entries(pendingCopy)) {
                const ormPatch = {};
                if (patch.mullion_positions) ormPatch.mullion_positions = patch.mullion_positions;
                if (patch.panel_tree) ormPatch.panel_tree = patch.panel_tree;
                if (patch.bay_lite_widths) ormPatch.bay_lite_widths = patch.bay_lite_widths;
                if (Object.keys(ormPatch).length > 0 && this.props.onWindowUpdate) {
                    this.props.onWindowUpdate(Number.parseInt(id, 10), ormPatch);
                }
            }
        }
    }

    // ─── Window move/resize handlers ──────────────────────────────────────────

    onWindowDragMove({ id, newX, newY }) {
        const snap = this.props.snapEnabled;
        const x = snap ? snapToGrid(newX, GRID_MM) : newX;
        const y = snap ? snapToGrid(newY, GRID_MM) : newY;
        this._pendingWindowUpdates[id] = {
            ...(this._pendingWindowUpdates[id] || {}),
            canvas_x: x,
            canvas_y: y,
        };
        // Live-update view via a shallow map (mutating the displayed list without history push)
        const liveWindows = this.props.windows.map(w =>
            w.id === id ? { ...w, ...this._pendingWindowUpdates[id] } : w
        );
        this.props.onWindowsChange(liveWindows);
    }

    onWindowResizeMove({ id, newW, newH }) {
        const snap = this.props.snapEnabled;
        const w = snap ? snapToGrid(newW, GRID_MM) : newW;
        const h = snap ? snapToGrid(newH, GRID_MM) : newH;
        this._pendingWindowUpdates[id] = {
            ...(this._pendingWindowUpdates[id] || {}),
            width_mm: Math.max(200, w),
            height_mm: Math.max(200, h),
        };
        const liveWindows = this.props.windows.map(win =>
            win.id === id ? { ...win, ...this._pendingWindowUpdates[id] } : win
        );
        this.props.onWindowsChange(liveWindows);
    }

    onWindowSelect({ id, additive }) {
        if (additive) {
            const current = this.props.selectedIds;
            if (current.includes(id)) {
                this.props.onSelectChange(current.filter(i => i !== id));
            } else {
                this.props.onSelectChange([...current, id]);
            }
        } else {
            this.props.onSelectChange([id]);
        }
    }

    /** Build array of selected pane indices for multi-select rendering */
    get selectedPaneIndicesArray() {
        const el = this.props.selectedElement;
        if (!el || el.type !== 'pane') return [];
        const ids = this.props.selectedPaneIds || [];
        if (ids.length > 0) return ids;
        if (el.index != null) return [el.index];
        return [];
    }

    onPaneClick({ windowId, paneIndex, elementType, mullionIndex, orientation, panelId, splitId, additive, frameSegmentId }) {
        if (this.props.onSelectElement) {
            if (elementType === 'mullion') {
                this.props.onSelectElement({ type: 'mullion', index: mullionIndex, orientation, splitId: splitId || null });
            } else if (elementType === 'frame_segment') {
                this.props.onSelectElement({ type: 'frame_segment', frameSegmentId: frameSegmentId || null });
            } else {
                this.props.onSelectElement({ type: 'pane', index: paneIndex, panelId: panelId || null, additive: !!additive });
            }
        }
    }

    get selectedElementInfo() {
        const el = this.props.selectedElement;
        if (!el || !el.type) return null;
        if (el.type === 'pane') {
            const win = this.props.windows[0];
            const canRemove = win && (win.panel_tree
                ? true  // Tree mode — merge check happens in remove handler
                : ((win.panels_horizontal || 1) > 1 || (win.panels_vertical || 1) > 1));
            const label = `P${(el.index ?? 0) + 1}`;
            return { type: 'pane', label, index: el.index, panelId: el.panelId || null, canRemove };
        }
        if (el.type === 'mullion') {
            const dir = el.orientation === 'vertical' ? 'Vertical' : 'Horizontal';
            return { type: 'mullion', label: `${dir} Divider ${(el.index ?? 0) + 1}`, index: el.index, orientation: el.orientation, splitId: el.splitId || null };
        }
        if (el.type === 'frame_segment') {
            return { type: 'frame_segment', label: el.frameSegmentId || 'Frame', frameSegmentId: el.frameSegmentId };
        }
        return null;
    }

    onRemoveSelectedElement() {
        const el = this.props.selectedElement;
        if (!el || !el.type) return;
        const win = this.props.windows[0];
        if (!win) return;

        // Panel tree path — merge the selected panel
        if (win.panel_tree && el.type === 'pane' && el.panelId) {
            if (!canMergePanel(win.panel_tree, el.panelId)) return;
            const newTree = mergePanel(win.panel_tree, el.panelId);
            const grid = treeToGrid(newTree, win.width_mm, win.height_mm);
            if (this.props.onWindowUpdate) {
                this.props.onWindowUpdate(win.id, {
                    panel_tree: newTree,
                    panels_horizontal: grid.panelsH,
                    panels_vertical: grid.panelsV,
                    mullion_positions: grid.mullionPositions,
                    pane_configs: grid.paneConfigs,
                });
            }
            this.props.onSelectElement({ type: null, index: null });
            return;
        }

        // Panel tree mullion path — merge using the split ID
        if (win.panel_tree && el.type === 'mullion' && el.splitId) {
            const splits = getSplitNodes(win.panel_tree);
            const splitNode = splits.find(s => s.id === el.splitId);
            if (!splitNode) return;
            const childId = splitNode.second?.id;
            if (!childId) return;
            const newTree = mergePanel(win.panel_tree, childId);
            const grid = treeToGrid(newTree, win.width_mm, win.height_mm);
            if (this.props.onWindowUpdate) {
                this.props.onWindowUpdate(win.id, {
                    panel_tree: newTree,
                    panels_horizontal: grid.panelsH,
                    panels_vertical: grid.panelsV,
                    mullion_positions: grid.mullionPositions,
                    pane_configs: grid.paneConfigs,
                });
            }
            this.props.onSelectElement({ type: null, index: null });
            return;
        }

        // Legacy path
        if (el.type === 'mullion' && this.props.onMullionDelete) {
            this.props.onMullionDelete({
                windowId: win.id,
                mullionIndex: el.index,
                orientation: el.orientation,
            });
            this.props.onSelectElement({ type: null, index: null });
        } else if (el.type === 'pane') {
            const nH = win.panels_horizontal || 1;
            const nV = win.panels_vertical || 1;
            const paneIdx = el.index ?? 0;
            const col = paneIdx % nH;
            const row = Math.floor(paneIdx / nH);
            if (col > 0 && this.props.onMullionDelete) {
                this.props.onMullionDelete({ windowId: win.id, mullionIndex: col - 1, orientation: 'vertical' });
            } else if (col < nH - 1 && this.props.onMullionDelete) {
                this.props.onMullionDelete({ windowId: win.id, mullionIndex: col, orientation: 'vertical' });
            } else if (row > 0 && this.props.onMullionDelete) {
                this.props.onMullionDelete({ windowId: win.id, mullionIndex: row - 1, orientation: 'horizontal' });
            } else if (row < nV - 1 && this.props.onMullionDelete) {
                this.props.onMullionDelete({ windowId: win.id, mullionIndex: row, orientation: 'horizontal' });
            }
            this.props.onSelectElement({ type: null, index: null });
        }
    }

    onResetSelectedPane() {
        const el = this.props.selectedElement;
        if (!el || el.type !== 'pane') return;
        const win = this.props.windows[0];
        if (!win || !this.props.onResetPane) return;
        this.props.onResetPane({ windowId: win.id, paneIndex: el.index, panelId: el.panelId || null });
    }

    onDeselectElement() {
        if (this.props.onSelectElement) {
            this.props.onSelectElement({ type: null, index: null });
        }
    }

    /** Cycle pane selection via Tab / Shift+Tab */
    _cyclePaneSelection(reverse) {
        const win = this.props.windows[0];
        if (!win) return;
        // Determine total pane count
        let totalPanes = 0;
        let paneEntries = []; // { index, panelId }
        if (win.panel_tree) {
            const leaves = getLeafPanels(win.panel_tree);
            totalPanes = leaves.length;
            paneEntries = leaves.map((l, i) => ({ index: i, panelId: l.id }));
        } else {
            totalPanes = (win.panels_horizontal || 1) * (win.panels_vertical || 1);
            paneEntries = Array.from({ length: totalPanes }, (_, i) => ({ index: i, panelId: null }));
        }
        if (totalPanes === 0) return;
        const el = this.props.selectedElement;
        const currentIdx = (el && el.type === 'pane') ? (el.index ?? -1) : -1;
        let nextIdx;
        if (reverse) {
            nextIdx = currentIdx <= 0 ? totalPanes - 1 : currentIdx - 1;
        } else {
            nextIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % totalPanes;
        }
        const entry = paneEntries[nextIdx];
        if (this.props.onSelectElement) {
            this.props.onSelectElement({ type: 'pane', index: entry.index, panelId: entry.panelId || null });
        }
    }

    onMullionDrag({ windowId, mullionPositions, panelTree, bayLiteWidths }) {
        const patch = {};
        if (panelTree) {
            patch.panel_tree = panelTree;
        }
        if (mullionPositions) {
            patch.mullion_positions = mullionPositions;
        }
        if (bayLiteWidths) {
            patch.bay_lite_widths = bayLiteWidths;
        }
        this._pendingWindowUpdates[windowId] = {
            ...(this._pendingWindowUpdates[windowId] || {}),
            ...patch,
        };
        const liveWindows = this.props.windows.map(w =>
            w.id === windowId ? { ...w, ...patch } : w
        );
        this.props.onWindowsChange(liveWindows);
    }

    onDividerDrop(detail) {
        if (this.props.onDividerDrop) {
            this.props.onDividerDrop(detail);
        }
    }

    onMullionDelete(detail) {
        if (this.props.onMullionDelete) {
            this.props.onMullionDelete(detail);
        }
    }

    // ─── Drop from component library ──────────────────────────────────────────

    onDragOver(ev) {
        if (
            ev.dataTransfer.types.includes("application/wincraft-window-type") ||
            ev.dataTransfer.types.includes("application/wincraft-window-template")
        ) {
            ev.preventDefault();
            ev.dataTransfer.dropEffect = "copy";
        }
    }

    onDrop(ev) {
        ev.preventDefault();
        const mm = this.clientToCanvasMm(ev.clientX, ev.clientY);
        const snap = this.props.snapEnabled;
        const dropX = snap ? snapToGrid(mm.x, GRID_MM) : mm.x;
        const dropY = snap ? snapToGrid(mm.y, GRID_MM) : mm.y;

        if (ev.dataTransfer.types.includes("application/wincraft-window-type")) {
            const data = JSON.parse(ev.dataTransfer.getData("application/wincraft-window-type"));
            this._spawnWindowFromType(data.type, dropX, dropY);
        } else if (ev.dataTransfer.types.includes("application/wincraft-window-template")) {
            const data = JSON.parse(ev.dataTransfer.getData("application/wincraft-window-template"));
            this._spawnWindowFromTemplate(data.templateId, dropX, dropY);
        }
    }

    _spawnWindowFromType(windowType, x, y) {
        // Create a new window record via ORM, then add to canvas
        // The parent component (WincraftDesignerAction) will handle the actual ORM call.
        // We emit a synthetic create event up via onWindowsChange with a sentinel.
        const newWindow = {
            _new: true,
            _type: windowType,
            canvas_x: Math.max(0, x),
            canvas_y: Math.max(0, y),
        };
        this.props.onWindowsChange([...this.props.windows, newWindow]);
    }

    _spawnWindowFromTemplate(templateId, x, y) {
        const newWindow = {
            _new: true,
            _templateId: templateId,
            canvas_x: Math.max(0, x),
            canvas_y: Math.max(0, y),
        };
        this.props.onWindowsChange([...this.props.windows, newWindow]);
    }

    // ─── Ruler helpers ────────────────────────────────────────────────────────

    /**
     * Compute ruler tick positions in the visible viewport.
     *
     * @param {'horizontal'|'vertical'} axis
     * @returns {{ pos: number, label: string }[]}
     */
    rulerTicks(axis) {
        const el = this.containerRef.el;
        if (!el) return [];
        const size = axis === "horizontal" ? el.clientWidth : el.clientHeight;
        const ticks = [];
        const mtp = this.mmToPixel;
        const offset = axis === "horizontal" ? this.state.viewX : this.state.viewY;
        const step = GRID_MM * 4; // marks every 100mm
        const startMm = Math.floor(-offset / mtp / step) * step;
        for (let mm = startMm; mm <= startMm + size / mtp + step * 2; mm += step) {
            const px = mm * mtp + offset + RULER_SIZE;
            if (px >= RULER_SIZE && px <= size) {
                ticks.push({ pos: px, label: `${mm}` });
            }
        }
        return ticks;
    }

    // ─── Rubber band rect ─────────────────────────────────────────────────────

    get rubberBandRect() {
        const rb = this.state.rubberBand;
        if (!rb) return null;
        const mtp = this.mmToPixel;
        const ox = this.state.viewX + RULER_SIZE;
        const oy = this.state.viewY + RULER_SIZE;
        return {
            x: Math.min(rb.startX, rb.curX) * mtp + ox,
            y: Math.min(rb.startY, rb.curY) * mtp + oy,
            w: Math.abs(rb.curX - rb.startX) * mtp,
            h: Math.abs(rb.curY - rb.startY) * mtp,
        };
    }

    // ─── Grid lines ───────────────────────────────────────────────────────────

    get gridPatternId() { return `wc-grid-${this.props.projectId}`; }

    get gridPatternSize() {
        return this._mmToPx(GRID_MM);
    }

    /** 100 mm line grid pattern size for overlay */
    get lineGridSize() {
        return this._mmToPx(100);
    }

    toggleGrid() {
        this.state.showGrid = !this.state.showGrid;
    }
}
