/** @odoo-module **/
/**
 * WinCraft Studio — Window Object
 * Renders a single window as an SVG <g> element within the designer canvas.
 * Handles per-object selection highlight and drag handles.
 */

import { Component, markup } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { getWindowSVG, computeBayBowChords } from "../utils/window_svg.js";
import { computePaneBounds, getDividerLines, getLeafPanels, getSplitNodes, moveDivider } from "../utils/panel_tree.js";
import {
    getShapeAreaPerimeter,
    getShapeBoundaryMm,
    insetBoundaryTowardCentroid,
    isShapedFrame,
    clipPolygonToShape,
    polygonAreaPerimeterMm,
} from "../utils/frame_shape_geometry.js";
import { WindowIso3DDialog } from "./window_iso_3d_dialog.js";

console.log("[WinCraft] ✓ LOADED: WindowObject");

export class WindowObject extends Component {
    static template = "wincraft_studio.WindowObject";

    static props = {
        window: { type: Object },
        scale: { type: Number },
        selected: { type: Boolean },
        selectedPaneIndex: { type: Number, optional: true },
        selectedPaneIndices: { type: Array, optional: true },
        spaceDown: { type: Boolean, optional: true },
        onSelect: Function,
        onDragStart: Function,
        onResizeStart: Function,
        onPaneClick: { type: Function, optional: true },
        onMullionDrag: { type: Function, optional: true },
        onDividerDrop: { type: Function, optional: true },
        onMullionDelete: { type: Function, optional: true },
        onDimEdit: { type: Function, optional: true },
        selectedFrameSegmentId: { type: String, optional: true },
        glazingConfigs: { type: Array, optional: true },
        glassConfigs: { type: Array, optional: true },
        unitSystem: { type: String, optional: true },
    };

    setup() {
        this.dialogService = useService("dialog");
    }

    /** Handle clicks on the bay/bow [3D] badge — opens the iso popup dialog. */
    _handleIsoAction(action) {
        // Guard against double-fire from mousedown+click duplicate handlers.
        const now = Date.now();
        if (this._lastIsoAction && this._lastIsoAction.action === action &&
            now - this._lastIsoAction.t < 400) {
            return;
        }
        this._lastIsoAction = { action, t: now };
        console.log("[WinCraft][3D] _handleIsoAction action=", action, " dialogService?", !!this.dialogService);
        if (action === 'open-3d') {
            try {
                this.dialogService.add(WindowIso3DDialog, {
                    window: this.props.window,
                });
                console.log("[WinCraft][3D] Dialog opened");
            } catch (e) {
                console.error("[WinCraft][3D] Dialog.add threw:", e);
            }
        }
    }

    /** Pixel position and size */
    get px() {
        const { window: w, scale } = this.props;
        return {
            x: (w.canvas_x || 0) * scale,
            y: (w.canvas_y || 0) * scale,
            w: (w.width_mm || 600) * scale,
            h: (w.height_mm || 900) * scale,
        };
    }

    get svgMarkup() {
        const { window: w, scale } = this.props;
        const pw = (w.width_mm || 600) * scale;
        const ph = (w.height_mm || 900) * scale;

        // Compute selected pane label + area for info chip
        const indices = this.props.selectedPaneIndices || (this.props.selectedPaneIndex != null ? [this.props.selectedPaneIndex] : []);
        let panelLabel = null;
        let paneArea = null;
        if (indices.length > 0) {
            const widthMm = w.width_mm || 600;
            const heightMm = w.height_mm || 900;
            const targets = this.paneHitTargets;
            const shape = w.frame_shape || 'rectangular';
            const shapeF = Math.max(8, Math.round(Math.min(widthMm * scale, heightMm * scale) * 0.06));
            const innerPtsPx = isShapedFrame(shape)
                ? insetBoundaryTowardCentroid(
                    getShapeBoundaryMm(shape, widthMm * scale, heightMm * scale, w.frame_shape_points), shapeF)
                : null;
            // Sub-pane area clipped to the true (already frame-inset) outline —
            // matches the glass clip-path in paneGrid() so a curved/pointed
            // header pane doesn't report its full rectangular bounding-box area.
            const subPaneAreaM2 = (t) => {
                if (!innerPtsPx) return (t.w / scale) * (t.h / scale) / 1e6;
                const rectPts = [[t.x, t.y], [t.x + t.w, t.y], [t.x + t.w, t.y + t.h], [t.x, t.y + t.h]];
                // Curve is the subject, rect is the clip — rect is always
                // convex (required by Sutherland-Hodgman); the inset curve
                // itself can have tiny non-convex wiggles near a peak.
                const clipped = clipPolygonToShape(innerPtsPx, rectPts);
                if (clipped.length < 3) return (t.w / scale) * (t.h / scale) / 1e6;
                const clippedMm = clipped.map(([px, py]) => [px / scale, py / scale]);
                return polygonAreaPerimeterMm(clippedMm).areaMm2 / 1e6;
            };
            if (indices.length === 1) {
                const t = targets[indices[0]];
                if (t) {
                    panelLabel = 'P' + (indices[0] + 1);
                    if (targets.length === 1 && isShapedFrame(shape)) {
                        // A lone pane spanning the whole window takes the
                        // frame's own shape (e.g. a circle), not its
                        // rectangular bounding box — matches the Live BOM /
                        // saved-BOM area for this same pane.
                        paneArea = getShapeAreaPerimeter(shape, widthMm, heightMm, w.frame_shape_points).areaM2;
                    } else {
                        paneArea = subPaneAreaM2(t);
                    }
                }
            } else {
                // Aggregate area for multi-select
                let totalArea = 0;
                for (const idx of indices) {
                    const t = targets[idx];
                    if (t) totalArea += subPaneAreaM2(t);
                }
                paneArea = totalArea;
            }
        }

        return markup(getWindowSVG({
            type: w.window_type || "casement",
            widthPx: pw,
            heightPx: ph,
            panels: w.panels || 1,
            panelsH: w.panels_horizontal || 1,
            panelsV: w.panels_vertical || 1,
            frameColour: w.frame_colour || "#f0ede8",
            frameMaterial: w.frame_material || null,
            glassOpacity: 0.18,
            widthMm: w.width_mm || 600,
            heightMm: w.height_mm || 900,
            name: w.name || "",
            fabricated: !!w.fabricated,
            mullionPositions: w.mullion_positions || null,
            panelTree: w.panel_tree || null,
            paneConfigs: w.pane_configs || null,
            selectedPaneIndex: this.props.selectedPaneIndex ?? null,
            selectedPaneIndices: indices.length > 0 ? indices : null,
            selectedPanelLabel: panelLabel,
            selectedPaneArea: paneArea,
            frameShape: w.frame_shape || 'rectangular',
            frameShapePoints: w.frame_shape_points || null,
            georgianBarConfig: w.georgian_bar_config || null,
            pixelScale: scale,
            frameSegments: w.frame_segments || null,
            selectedFrameSegmentId: this.props.selectedFrameSegmentId || null,
            glazingConfigs: this.props.glazingConfigs || null,
            glassConfigs: this.props.glassConfigs || null,
            unitSystem: this.props.unitSystem || 'metric',
            // Bay & Bow geometry
            bayAngle: w.bay_angle || '45',
            bayAngleCustomDeg: w.bay_angle_custom_deg || 45,
            bowAngleDeg: w.bow_angle_deg || '10',
            bowAngleCustomDeg: w.bow_angle_custom_deg || 10,
            bayLiteCount: w.bay_lite_count || (w.window_type === 'bow' ? 5 : 3),
            bayCentreRatio: w.bay_centre_ratio || 0.5,
            bayLiteWidths: w.bay_lite_widths || null,
            bayProjectionMm: w.projection_depth_mm || 0,
            bayLiteChordMm: w.bay_lite_chord_mm || 0,
            bowRadiusMm: w.bow_radius_mm || 0,
        }));
    }

    /** Effective bay/bow lite count, clamped to the type's allowed range
        (mirrors PropertiesPanel.bayBowLiteCount — kept in sync by hand). */
    _bayBowLiteCount(w) {
        const minN = w.window_type === 'bow' ? 3 : 2;
        const maxN = w.window_type === 'bow' ? 8 : 6;
        const defaultN = w.window_type === 'bow' ? 5 : 3;
        return Math.max(minN, Math.min(w.bay_lite_count || defaultN, maxN));
    }

    /** Computed pane hit targets for click-to-select */
    get paneHitTargets() {
        const { window: w, scale } = this.props;
        const W = (w.width_mm || 600) * scale;
        const H = (w.height_mm || 900) * scale;
        const F = Math.max(8, Math.round(Math.min(W, H) * 0.06));
        const S = Math.max(4, F * 0.55);
        const gw = W - F * 2;
        const gh = H - F * 2;
        const widthMm = w.width_mm || 600;
        const heightMm = w.height_mm || 900;

        // Bay / Bow path — N hit targets along the chord, matching SVG layout
        if (w.window_type === 'bay' || w.window_type === 'bow') {
            const n = this._bayBowLiteCount(w);
            const chords = computeBayBowChords({
                type: w.window_type,
                n,
                widthMm,
                bayCentreRatio: w.bay_centre_ratio || 0.5,
                bayLiteWidths: w.bay_lite_widths || null,
            });
            // Bow: equal pixel distribution after subtracting mullions
            // Bay: apparent widths (chord × cos α) — match SVG renderer
            let pixelWidths;
            if (w.window_type === 'bow') {
                const mullW = Math.max(3, F * 0.45);
                const totalMull = (n - 1) * mullW;
                const chordTotal = chords.reduce((a, b) => a + b, 0) || 1;
                pixelWidths = chords.map(c => (c / chordTotal) * (gw - totalMull));
            } else {
                const angleDeg = w.bay_angle === 'custom'
                    ? (w.bay_angle_custom_deg || 45) : parseFloat(w.bay_angle || '45');
                const theta = angleDeg * Math.PI / 180;
                const liteAngles = (n === 3)
                    ? [theta, 0, theta]
                    : Array.from({ length: n }, (_, i) => Math.abs(i - (n - 1) / 2) * theta / ((n - 1) / 2));
                const apparent = chords.map((c, i) => c * Math.cos(liteAngles[i]));
                const apparentTotal = apparent.reduce((a, b) => a + b, 0) || 1;
                pixelWidths = apparent.map(a => a / apparentTotal * gw);
            }
            const mullW = w.window_type === 'bow'
                ? Math.max(3, F * 0.45)
                : Math.max(3, F * 0.5);
            const targets = [];
            let cx = F;
            for (let i = 0; i < n; i++) {
                const lw = pixelWidths[i] - (w.window_type === 'bow' || i >= n - 1 ? 0 : mullW);
                const drawW = w.window_type === 'bow' ? pixelWidths[i] : lw;
                targets.push({ index: i, x: cx, y: F, w: drawW, h: gh });
                cx += drawW;
                if (i < n - 1) cx += mullW;
            }
            return targets;
        }

        // Every pane's hover/click hit area is clipped to the frame's own
        // curved/pointed outline, not just its rectangular bounding box —
        // mirrors the glass clip and selection-highlight outline so a split
        // header pane can't be clicked in the "horn" corners outside the
        // curve, and a lone pane spanning the whole window gets the frame's
        // exact shape (e.g. a triangle) instead of its bounding box.
        const frameShape = w.frame_shape || 'rectangular';
        const innerHitPts = isShapedFrame(frameShape)
            ? insetBoundaryTowardCentroid(
                getShapeBoundaryMm(frameShape, W, H, w.frame_shape_points || null),
                F,
            )
            : null;
        const shapeHitPoints = innerHitPts
            ? innerHitPts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')
            : null;
        // Sub-panes from a split frame get that same outline clipped down to
        // their own slice — curve as the subject, pane rect as the clip
        // (the rect is always convex, which Sutherland-Hodgman requires;
        // the inset curve itself can have tiny non-convex wiggles near a
        // peak, so it must never be the clip polygon).
        const hitPolygon = (t) => {
            if (!innerHitPts) return null;
            const rectPts = [[t.x, t.y], [t.x + t.w, t.y], [t.x + t.w, t.y + t.h], [t.x, t.y + t.h]];
            const clipped = clipPolygonToShape(innerHitPts, rectPts);
            if (clipped.length < 3) return null;
            return clipped.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
        };
        const applyShapeHitPoints = (targets) => {
            if (!innerHitPts) return;
            if (targets.length === 1) {
                targets[0].points = shapeHitPoints;
            } else {
                targets.forEach(t => { t.points = hitPolygon(t); });
            }
        };

        // Panel tree path
        if (w.panel_tree) {
            const mullionThk = Math.max(4, Math.round(Math.min(widthMm, heightMm) * 0.06) * 0.55);
            const treePanes = computePaneBounds(
                w.panel_tree,
                { x: 0, y: 0, w: widthMm, h: heightMm },
                mullionThk,
            );
            const scaleX = gw / widthMm;
            const scaleY = gh / heightMm;
            const targets = treePanes.map((p, i) => ({
                index: i,
                panelId: p.id,
                x: F + p.bounds.x * scaleX,
                y: F + p.bounds.y * scaleY,
                w: p.bounds.w * scaleX,
                h: p.bounds.h * scaleY,
            }));
            applyShapeHitPoints(targets);
            return targets;
        }

        // Legacy grid path
        const nH = w.panels_horizontal || 1;
        const nV = w.panels_vertical || 1;
        const pW = (gw - (nH - 1) * S) / nH;
        const pH = (gh - (nV - 1) * S) / nV;
        const targets = [];
        for (let r = 0; r < nV; r++) {
            for (let c = 0; c < nH; c++) {
                targets.push({
                    index: r * nH + c,
                    x: F + c * (pW + S),
                    y: F + r * (pH + S),
                    w: pW,
                    h: pH,
                });
            }
        }
        applyShapeHitPoints(targets);
        return targets;
    }

    /** Frame segment hit targets for click-to-select individual frame pieces */
    get frameSegmentHitTargets() {
        const { window: w, scale } = this.props;
        const W = (w.width_mm || 600) * scale;
        const H = (w.height_mm || 900) * scale;
        const F = Math.max(8, Math.round(Math.min(W, H) * 0.06));
        const widthMm = w.width_mm || 600;
        const heightMm = w.height_mm || 900;
        const fMm = F / scale; // frame thickness in mm

        return [
            { id: 'F1', edge: 'top',    label: 'Top Rail',    x: 0, y: 0,     w: W, h: F, lengthMm: Math.round(widthMm),           widthMm: Math.round(fMm) },
            { id: 'F2', edge: 'bottom', label: 'Bottom Rail', x: 0, y: H - F, w: W, h: F, lengthMm: Math.round(widthMm),           widthMm: Math.round(fMm) },
            { id: 'F3', edge: 'left',   label: 'Left Stile',  x: 0, y: F,     w: F, h: H - 2 * F, lengthMm: Math.round(heightMm - 2 * fMm), widthMm: Math.round(fMm) },
            { id: 'F4', edge: 'right',  label: 'Right Stile', x: W - F, y: F, w: F, h: H - 2 * F, lengthMm: Math.round(heightMm - 2 * fMm), widthMm: Math.round(fMm) },
        ];
    }

    onFrameSegmentClick(ev, segment) {
        // Space held or window not yet selected → drag the whole window
        if (this.props.spaceDown || !this.props.selected) {
            this.onMouseDown(ev);
            return;
        }
        ev.stopPropagation();
        this.props.onSelect({ id: this.props.window.id, additive: false });
        if (this.props.onPaneClick) {
            this.props.onPaneClick({
                windowId: this.props.window.id,
                paneIndex: null,
                elementType: 'frame_segment',
                frameSegmentId: segment.id,
            });
        }
    }

    onPaneMouseDown(ev, paneIndex, panelId) {
        // Space held or window not yet selected → drag the whole window
        if (this.props.spaceDown || !this.props.selected) {
            this.onMouseDown(ev);
            return;
        }
        ev.stopPropagation();
        // Auto-select the parent window so properties panel has context
        this.props.onSelect({ id: this.props.window.id, additive: false });
        if (this.props.onPaneClick) {
            this.props.onPaneClick({
                windowId: this.props.window.id,
                paneIndex,
                panelId: panelId || null,
                additive: ev.shiftKey,
            });
        }
    }

    /** 3D view button has been moved to the canvas toolbar (next to Fit to View),
     *  so no per-window hit-target overlay is needed any more. */
    get isoControls() {
        return [];
    }

    /** Mullion bar handles for drag-to-reposition */
    get mullionHandles() {
        const { window: w, scale } = this.props;
        const W = (w.width_mm || 600) * scale;
        const H = (w.height_mm || 900) * scale;
        const F = Math.max(8, Math.round(Math.min(W, H) * 0.06));
        const S = Math.max(4, F * 0.55);
        const gw = W - F * 2;
        const gh = H - F * 2;
        const widthMm = w.width_mm || 600;
        const heightMm = w.height_mm || 900;
        const handles = [];

        // Bay / Bow path — checked before panel_tree below. wincraft_designer.js
        // auto-migrates ANY window missing a panel_tree (including bay/bow ones,
        // which have no use for it) into a trivial single-leaf tree and persists
        // it, so `w.panel_tree` is truthy for most bay/bow windows too; checking
        // window_type first avoids that stray tree masking these handles, same
        // ordering paneHitTargets above already uses for the same reason.
        if (w.window_type === 'bay' || w.window_type === 'bow') {
            const n = this._bayBowLiteCount(w);
            if (n < 2) return handles;
            const chords = computeBayBowChords({
                type: w.window_type,
                n,
                widthMm,
                bayCentreRatio: w.bay_centre_ratio || 0.5,
                bayLiteWidths: w.bay_lite_widths || null,
            });
            let pixelWidths;
            if (w.window_type === 'bow') {
                const mullW = Math.max(3, F * 0.45);
                const totalMull = (n - 1) * mullW;
                const chordTotal = chords.reduce((a, b) => a + b, 0) || 1;
                pixelWidths = chords.map(c => (c / chordTotal) * (gw - totalMull));
            } else {
                const angleDeg = w.bay_angle === 'custom'
                    ? (w.bay_angle_custom_deg || 45) : parseFloat(w.bay_angle || '45');
                const theta = angleDeg * Math.PI / 180;
                const liteAngles = (n === 3)
                    ? [theta, 0, theta]
                    : Array.from({ length: n }, (_, i) => Math.abs(i - (n - 1) / 2) * theta / ((n - 1) / 2));
                const apparent = chords.map((c, i) => c * Math.cos(liteAngles[i]));
                const apparentTotal = apparent.reduce((a, b) => a + b, 0) || 1;
                pixelWidths = apparent.map(a => a / apparentTotal * gw);
            }
            const mullW = w.window_type === 'bow' ? Math.max(3, F * 0.45) : Math.max(3, F * 0.5);
            let cx = F;
            for (let i = 0; i < n - 1; i++) {
                cx += pixelWidths[i];
                handles.push({
                    bayBoundary: i,
                    orientation: 'vertical',
                    x: cx - mullW / 2 - 3,
                    y: F,
                    w: mullW + 6,
                    h: gh,
                    cursor: 'col-resize',
                });
                cx += mullW;
            }
            return handles;
        }

        // Panel tree path — create handles from tree divider lines
        if (w.panel_tree) {
            const mullionThk = Math.max(4, Math.round(Math.min(widthMm, heightMm) * 0.06) * 0.55);
            const scaleX = gw / widthMm;
            const scaleY = gh / heightMm;
            const divLines = getDividerLines(
                w.panel_tree,
                { x: 0, y: 0, w: widthMm, h: heightMm },
                mullionThk,
            );
            for (let i = 0; i < divLines.length; i++) {
                const d = divLines[i];
                if (d.direction === 'vertical') {
                    const mx = F + d.position * scaleX;
                    const dy1 = F + d.y1 * scaleY;
                    const dy2 = F + d.y2 * scaleY;
                    handles.push({
                        index: i,
                        splitId: d.id,
                        orientation: 'vertical',
                        x: mx - S / 2 - 3,
                        y: dy1,
                        w: S + 6,
                        h: dy2 - dy1,
                        cursor: 'col-resize',
                    });
                } else {
                    const my = F + d.position * scaleY;
                    const dx1 = F + d.x1 * scaleX;
                    const dx2 = F + d.x2 * scaleX;
                    handles.push({
                        index: i,
                        splitId: d.id,
                        orientation: 'horizontal',
                        x: dx1,
                        y: my - S / 2 - 3,
                        w: dx2 - dx1,
                        h: S + 6,
                        cursor: 'row-resize',
                    });
                }
            }
            return handles;
        }

        // Legacy grid path
        const nH = w.panels_horizontal || 1;
        const nV = w.panels_vertical || 1;
        const mp = w.mullion_positions;

        // Vertical mullions
        const vPositions = (mp && mp.length > 0)
            ? mp.filter(m => m.orientation === 'vertical').map(m => m.positionMm).sort((a, b) => a - b)
            : [];
        if (vPositions.length > 0) {
            const scaleX = gw / widthMm;
            for (let i = 0; i < vPositions.length; i++) {
                const mx = F + vPositions[i] * scaleX;
                handles.push({
                    index: i,
                    orientation: 'vertical',
                    x: mx - S / 2 - 3,
                    y: F,
                    w: S + 6,
                    h: gh,
                    cursor: 'col-resize',
                });
            }
        } else if (nH > 1) {
            const pW = (gw - (nH - 1) * S) / nH;
            for (let c = 1; c < nH; c++) {
                const mx = F + c * (pW + S) - S / 2;
                handles.push({
                    index: c - 1,
                    orientation: 'vertical',
                    x: mx - 3,
                    y: F,
                    w: S + 6,
                    h: gh,
                    cursor: 'col-resize',
                });
            }
        }

        // Horizontal mullions
        const hPositions = (mp && mp.length > 0)
            ? mp.filter(m => m.orientation === 'horizontal').map(m => m.positionMm).sort((a, b) => a - b)
            : [];
        if (hPositions.length > 0) {
            const scaleY = gh / heightMm;
            for (let i = 0; i < hPositions.length; i++) {
                const my = F + hPositions[i] * scaleY;
                handles.push({
                    index: i,
                    orientation: 'horizontal',
                    x: F,
                    y: my - S / 2 - 3,
                    w: gw,
                    h: S + 6,
                    cursor: 'row-resize',
                });
            }
        } else if (nV > 1) {
            const pH = (gh - (nV - 1) * S) / nV;
            for (let r = 1; r < nV; r++) {
                const my = F + r * (pH + S) - S / 2;
                handles.push({
                    index: r - 1,
                    orientation: 'horizontal',
                    x: F,
                    y: my - 3,
                    w: gw,
                    h: S + 6,
                    cursor: 'row-resize',
                });
            }
        }
        return handles;
    }

    onMullionMouseDown(ev, handle) {
        // Space held → drag the whole window
        if (this.props.spaceDown) {
            this.onMouseDown(ev);
            return;
        }
        ev.stopPropagation();
        ev.preventDefault();
        const { window: w, scale } = this.props;

        // Bay / Bow path — drag redistributes width between the two lites
        // straddling this boundary, keeping their combined width (and so the
        // overall per-lite total) exactly constant. No mullion-config UI
        // exists for bay/bow (single global mulling_post_width_mm instead),
        // so this skips the onPaneClick "select mullion" step below.
        if (handle.bayBoundary !== undefined) {
            const i = handle.bayBoundary;
            const n = this._bayBowLiteCount(w);
            const widthMm = w.width_mm || 600;
            const minEach = 50;
            const origWidths = (w.bay_lite_widths && w.bay_lite_widths.length === n)
                ? [...w.bay_lite_widths]
                : computeBayBowChords({
                    type: w.window_type, n, widthMm,
                    bayCentreRatio: w.bay_centre_ratio || 0.5,
                    bayLiteWidths: w.bay_lite_widths || null,
                }).map(c => Math.round(c));
            const startClientX = ev.clientX;

            const onMove = (moveEv) => {
                const rawDeltaMm = (moveEv.clientX - startClientX) / scale;
                const deltaMm = Math.max(
                    minEach - origWidths[i],
                    Math.min(origWidths[i + 1] - minEach, rawDeltaMm),
                );
                const widths = [...origWidths];
                widths[i] = Math.round(origWidths[i] + deltaMm);
                widths[i + 1] = Math.round(origWidths[i + 1] - deltaMm);
                if (this.props.onMullionDrag) {
                    this.props.onMullionDrag({ windowId: w.id, bayLiteWidths: widths });
                }
            };
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            return;
        }

        // Select mullion on click
        if (this.props.onPaneClick) {
            this.props.onPaneClick({
                windowId: this.props.window.id,
                paneIndex: null,
                elementType: 'mullion',
                mullionIndex: handle.index,
                orientation: handle.orientation,
                splitId: handle.splitId || null,
            });
        }
        const widthMm = w.width_mm || 600;
        const heightMm = w.height_mm || 900;
        const startClientX = ev.clientX;
        const startClientY = ev.clientY;

        // Panel tree path — drag modifies the split node's position
        if (w.panel_tree && handle.splitId) {
            const origPos = (() => {
                const splits = getSplitNodes(w.panel_tree);
                const target = splits.find(s => s.id === handle.splitId);
                return target ? target.position : 0;
            })();

            const onMove = (moveEv) => {
                let deltaMm;
                if (handle.orientation === 'vertical') {
                    deltaMm = (moveEv.clientX - startClientX) / scale;
                } else {
                    deltaMm = (moveEv.clientY - startClientY) / scale;
                }
                const maxMm = handle.orientation === 'vertical' ? widthMm : heightMm;
                const newPos = Math.max(50, Math.min(maxMm - 50, Math.round(origPos + deltaMm)));

                if (this.props.onMullionDrag) {
                    const newTree = moveDivider(w.panel_tree, handle.splitId, newPos);
                    this.props.onMullionDrag({
                        windowId: w.id,
                        panelTree: newTree,
                    });
                }
            };

            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            return;
        }

        // Legacy grid path
        const nH = w.panels_horizontal || 1;
        const nV = w.panels_vertical || 1;

        // Build initial mullion_positions from current equal division
        const F_mm = Math.max(8, Math.round(Math.min(widthMm, heightMm) * 0.06)) / scale;
        const S_mm = Math.max(4, F_mm * 0.55 * scale) / scale;
        const positions = w.mullion_positions && w.mullion_positions.length > 0
            ? [...w.mullion_positions]
            : [];
        // Ensure vertical mullions exist
        if (positions.filter(m => m.orientation === 'vertical').length === 0 && nH > 1) {
            const innerW = widthMm;
            for (let c = 1; c < nH; c++) {
                positions.push({ orientation: 'vertical', positionMm: Math.round(innerW * c / nH) });
            }
        }
        // Ensure horizontal mullions exist
        if (positions.filter(m => m.orientation === 'horizontal').length === 0 && nV > 1) {
            const innerH = heightMm;
            for (let r = 1; r < nV; r++) {
                positions.push({ orientation: 'horizontal', positionMm: Math.round(innerH * r / nV) });
            }
        }

        // Find which mullion entry to modify
        const sameOrientation = positions.filter(m => m.orientation === handle.orientation);
        const mullionIdx = handle.index;
        const origPos = sameOrientation[mullionIdx] ? sameOrientation[mullionIdx].positionMm : 0;

        const onMove = (moveEv) => {
            let deltaMm;
            if (handle.orientation === 'vertical') {
                deltaMm = (moveEv.clientX - startClientX) / scale;
            } else {
                deltaMm = (moveEv.clientY - startClientY) / scale;
            }
            const maxMm = handle.orientation === 'vertical' ? widthMm : heightMm;
            const newPos = Math.max(50, Math.min(maxMm - 50, Math.round(origPos + deltaMm)));

            // Update the matching entry
            const updated = positions.map(m => ({ ...m }));
            const matching = updated.filter(m => m.orientation === handle.orientation);
            if (matching[mullionIdx]) matching[mullionIdx].positionMm = newPos;

            if (this.props.onMullionDrag) {
                this.props.onMullionDrag({
                    windowId: w.id,
                    mullionPositions: updated,
                });
            }
        };

        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }

    /** Resize handle size in pixels */
    get handleSize() {
        return 8;
    }

    // ── Divider drop handling ───────────────────────────────────────

    onDividerDragOver(ev) {
        if (ev.dataTransfer.types.includes("application/wincraft-divider")) {
            ev.preventDefault();
            ev.dataTransfer.dropEffect = "copy";
        }
    }

    onDividerDrop(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        const raw = ev.dataTransfer.getData("application/wincraft-divider");
        if (!raw) return;

        const { orientation } = JSON.parse(raw);
        const { window: w, scale } = this.props;
        const widthMm = w.width_mm || 600;
        const heightMm = w.height_mm || 900;

        // Get the SVG element's bounding rect to compute drop position in mm
        const svgEl = ev.currentTarget;
        const rect = svgEl.getBoundingClientRect();
        let positionMm;
        if (orientation === 'vertical') {
            const relX = ev.clientX - rect.left;
            positionMm = Math.round((relX / rect.width) * widthMm);
            positionMm = Math.max(50, Math.min(widthMm - 50, positionMm));
        } else {
            const relY = ev.clientY - rect.top;
            positionMm = Math.round((relY / rect.height) * heightMm);
            positionMm = Math.max(50, Math.min(heightMm - 50, positionMm));
        }

        // For panel tree, find which panel the drop landed in
        let targetPanelId = null;
        if (w.panel_tree) {
            const mullionThk = Math.max(4, Math.round(Math.min(widthMm, heightMm) * 0.06) * 0.55);
            const paneBounds = computePaneBounds(
                w.panel_tree,
                { x: 0, y: 0, w: widthMm, h: heightMm },
                mullionThk,
            );
            const dropX = (ev.clientX - rect.left) / rect.width * widthMm;
            const dropY = (ev.clientY - rect.top) / rect.height * heightMm;
            for (const pb of paneBounds) {
                const b = pb.bounds;
                if (dropX >= b.x && dropX <= b.x + b.w && dropY >= b.y && dropY <= b.y + b.h) {
                    targetPanelId = pb.id;
                    break;
                }
            }
        }

        if (this.props.onDividerDrop) {
            this.props.onDividerDrop({
                windowId: w.id,
                orientation,
                positionMm,
                targetPanelId,
            });
        }
    }

    // ── Mullion delete (double-click or right-click) ──────────────

    onMullionDblClick(ev, handle) {
        ev.stopPropagation();
        ev.preventDefault();
        // Bay/Bow lite count is managed via the Frame tab's +/- controls,
        // not by deleting a boundary (there's no merge semantics for lites).
        if (handle.bayBoundary !== undefined) return;
        if (this.props.onMullionDelete) {
            this.props.onMullionDelete({
                windowId: this.props.window.id,
                mullionIndex: handle.index,
                orientation: handle.orientation,
                splitId: handle.splitId || null,
            });
        }
    }

    onMullionContextMenu(ev, handle) {
        ev.stopPropagation();
        ev.preventDefault();
        if (handle.bayBoundary !== undefined) return;
        if (this.props.onMullionDelete) {
            this.props.onMullionDelete({
                windowId: this.props.window.id,
                mullionIndex: handle.index,
                orientation: handle.orientation,
                splitId: handle.splitId || null,
            });
        }
    }

    get windowDescription() {
        const w = this.props.window;
        const type = (w.window_type || "casement").replace(/_/g, " ");
        const capitalType = type.charAt(0).toUpperCase() + type.slice(1);
        const panels = w.panels_horizontal || 1;
        const dir = (w.opening_direction || "left_right").replace(/_/g, " ");
        return `${capitalType} — ${panels} sash — ${dir}`;
    }

    onMouseDown(ev) {
        if (ev.button !== 0) return;

        // Iso 3D control buttons (rotate / tilt / reset) — short-circuit
        const isoBtn = ev.target.closest('[data-iso-action]');
        if (isoBtn) {
            ev.stopPropagation();
            ev.preventDefault();
            this._handleIsoAction(isoBtn.getAttribute('data-iso-action'));
            return;
        }

        // Check if clicking on an editable dimension label
        const dimLabel = ev.target.closest('.wc-dim-editable');
        if (dimLabel && this.props.onDimEdit) {
            ev.stopPropagation();
            ev.preventDefault();
            const ds = dimLabel.dataset;
            this.props.onDimEdit({
                windowId: this.props.window.id,
                dimType: ds.dimType,
                dimIndex: ds.dimIndex !== '' ? Number.parseInt(ds.dimIndex, 10) : null,
                dimValue: Number.parseInt(ds.dimValue, 10),
                // Divider references for section dimensions
                leftDividerId: ds.dimLdiv || null,
                rightDividerId: ds.dimRdiv || null,
                leftDividerMm: ds.dimLmm ? Number.parseFloat(ds.dimLmm) : null,
                rightDividerMm: ds.dimRmm ? Number.parseFloat(ds.dimRmm) : null,
                clientX: ev.clientX,
                clientY: ev.clientY,
            });
            return;
        }

        ev.stopPropagation();
        // When Space is held, just drag without changing selection
        if (!this.props.spaceDown) {
            const shift = ev.shiftKey;
            this.props.onSelect({ id: this.props.window.id, additive: shift });
        }

        const startX = ev.clientX;
        const startY = ev.clientY;
        const origX = this.props.window.canvas_x || 0;
        const origY = this.props.window.canvas_y || 0;
        const scale = this.props.scale;

        const onMove = (moveEv) => {
            const dx = (moveEv.clientX - startX) / scale;
            const dy = (moveEv.clientY - startY) / scale;
            this.props.onDragStart({
                id: this.props.window.id,
                newX: origX + dx,
                newY: origY + dy,
            });
        };

        const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }

    onResizeMouseDown(ev, corner) {
        ev.stopPropagation();
        ev.preventDefault();
        const startX = ev.clientX;
        const startY = ev.clientY;
        const origW = this.props.window.width_mm || 600;
        const origH = this.props.window.height_mm || 900;
        const scale = this.props.scale;

        const onMove = (moveEv) => {
            const dxMm = (moveEv.clientX - startX) / scale;
            const dyMm = (moveEv.clientY - startY) / scale;
            let newW = origW;
            let newH = origH;
            if (corner === "se") { newW = Math.max(200, origW + dxMm); newH = Math.max(200, origH + dyMm); }
            if (corner === "sw") { newW = Math.max(200, origW - dxMm); newH = Math.max(200, origH + dyMm); }
            if (corner === "ne") { newW = Math.max(200, origW + dxMm); newH = Math.max(200, origH - dyMm); }
            if (corner === "nw") { newW = Math.max(200, origW - dxMm); newH = Math.max(200, origH - dyMm); }
            this.props.onResizeStart({
                id: this.props.window.id,
                newW: Math.round(newW),
                newH: Math.round(newH),
            });
        };

        const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    }
}
