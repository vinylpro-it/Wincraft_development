/** @odoo-module **/
/**
 * WinCraft Studio - Professional Window SVG Generator
 * Returns a complete <svg> element for each window type, with:
 *   - Thick frame profiles (real uPVC / aluminium appearance)
 *   - Tinted glass with reflection highlight + glare dot
 *   - Mid-rails and mid-stiles between panels
 *   - Opening direction indicators (arcs, arrows)
 *   - Handle and hinge indicators
 *   - Dimension arrows with extension lines
 *   - Fabricated stamp overlay
 */

import { computePaneBounds, getDividerLines, getLeafPanels } from "./panel_tree.js";
import { getShapeBoundaryMm, insetBoundaryTowardCentroid, isShapedFrame, getArchRise, clipPolygonToShape } from "./frame_shape_geometry.js";
import { mmToInch, formatInchesAsFraction } from "./units.js";

console.log("[WinCraft] loaded: utils/window_svg.js");

/* ─── Bay / Bow lite chord helper ─────────────────────────────────
   Single source of truth for per-lite chord widths in mm.
   - bay (n=3): centre ratio + flankers split, OR custom widths.
   - bay (n>3) / bow: equal split, OR custom widths.
   Custom widths override only when array length matches lite count
   AND every entry is a positive number (>= 1 mm). */
export function computeBayBowChords({ type, n, widthMm, bayCentreRatio = 0.5, bayLiteWidths = null }) {
    const realW = Math.max(1, widthMm || 1);
    const customOk = Array.isArray(bayLiteWidths) && bayLiteWidths.length === n
        && bayLiteWidths.every(v => typeof v === 'number' && v >= 1);
    if (customOk) {
        const total = bayLiteWidths.reduce((a, b) => a + b, 0) || realW;
        const k = realW / total;
        return bayLiteWidths.map(v => v * k);
    }
    if (type === 'bay' && n === 3) {
        const cr = Math.max(0.20, Math.min(bayCentreRatio || 0.5, 0.85));
        const c = realW * cr;
        const f = (realW - c) / 2;
        return [f, c, f];
    }
    return Array.from({ length: n }, () => realW / n);
}

/* ─── Colour helpers ──────────────────────────────────────────── */

function darkenHex(hex, factor = 0.75) {
    if (!hex || typeof hex !== 'string') hex = '#f0ede8';
    const h = hex.replace('#', '');
    if (h.length < 6) return 'rgb(180,180,180)';
    const r = Math.round(parseInt(h.slice(0, 2), 16) * factor);
    const g = Math.round(parseInt(h.slice(2, 4), 16) * factor);
    const b = Math.round(parseInt(h.slice(4, 6), 16) * factor);
    return `rgb(${r},${g},${b})`;
}

function isLightColour(hex) {
    if (!hex || typeof hex !== 'string') return true;
    const h = hex.replace('#', '');
    if (h.length < 6) return true;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) > 150;
}

let _idC = 0;
function uid() { return 'ws' + (++_idC) + Math.random().toString(36).slice(2, 5); }

/* ─── Type labels ─────────────────────────────────────────────── */

const TYPE_LABELS = {
    casement: 'Casement', sliding: 'Sliding', fixed: 'Fixed',
    bifold: 'Bi-Fold', awning: 'Awning', arched: 'Arched',
    bay: 'Bay', bow: 'Bow', tilt_turn: 'Tilt & Turn',
    single_hung: 'Single Hung', double_hung: 'Double Hung',
    single_slider: 'Single Slider', double_slider: 'Double Slider',
    end_vent_slider: 'End Vent Slider', fixed_casement: 'Fixed Casement',
    custom: 'Custom',
};

/* ─── Material colour presets ─────────────────────────────────── */

export const MATERIAL_COLOURS = {
    'aluminium_natural': { fill: '#D8D0C4', border: '#8A8070', label: 'Aluminium Natural' },
    'aluminium_black':   { fill: '#2A2A2A', border: '#111111', label: 'Powder-Coated Black' },
    'aluminium_white':   { fill: '#E8E8E8', border: '#AAAAAA', label: 'Aluminium White' },
    'aluminium_grey':    { fill: '#808080', border: '#505050', label: 'Aluminium Grey' },
    'solid_oak':         { fill: '#C8A06E', border: '#7A5C30', label: 'Solid Oak' },
    'meranti':           { fill: '#A05030', border: '#6B3420', label: 'Meranti' },
    'upvc_white':        { fill: '#F0EDE8', border: '#CCCCCC', label: 'uPVC White' },
    'upvc_cream':        { fill: '#F5F0E0', border: '#D0C8B0', label: 'uPVC Cream' },
    'upvc_grey':         { fill: '#707070', border: '#484848', label: 'uPVC Anthracite Grey' },
    'steel':             { fill: '#C0C0C0', border: '#888888', label: 'Steel' },
};

/* ─── Main generator ──────────────────────────────────────────── */

/* ─── Bay/Bow 3D iso renderer (module-scope, used by the popup dialog) ─── */

/**
 * Render a small "3D" badge button on the elevation. Clicks are caught by
 * WindowObject (data-iso-action="open-3d") which opens the iso popup.
 */
function _render3DViewButton(W, dark) {
    const bw = 44, bh = 18;
    const bx = W - bw - 6;
    const by = 6;
    return `<g class="wc-iso-btn" data-iso-action="open-3d" cursor="pointer">`
         + `<title>Open 3D view</title>`
         + `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="3" `
         + `fill="rgba(79,110,247,0.92)" stroke="${dark}" stroke-width="0.6"/>`
         + `<text x="${bx + bw / 2}" y="${by + bh - 5}" `
         + `font-family="'DM Mono',monospace" font-size="10" font-weight="700" `
         + `fill="#ffffff" text-anchor="middle" pointer-events="none">3D ▸</text>`
         + `</g>`;
}

/**
 * Pure cabinet-projection renderer for the bay/bow assembly.
 * Returns SVG markup that draws the seat board, lite faces, head board,
 * wall reference, projection callout, and an optional control bar with
 * rotate / tilt / reset buttons (data-iso-action attributes).
 *
 * Self-contained — no closure dependencies. Used both inline (legacy) and
 * by the WincraftIso3DDialog popup component.
 */
export function renderBayBow3DInset({
    x, y, w, h, label, lites, projMm, heightMm,
    yawDeg = 0, alphaDeg = 30, showControls = true,
    dark = '#3a3a3a', frameColour = '#f0ede8',
}) {
    const margin = 8;
    const labelGap = 14;
    const ctrlBarH = showControls ? 16 : 0;
    const panelW = w - margin * 2;
    const panelH = h - margin * 2 - labelGap - ctrlBarH;
    const ALPHA = Math.max(5, Math.min(80, alphaDeg)) * Math.PI / 180;
    const DEPTH_SCALE = 0.55;
    const HEIGHT_SCALE = 0.55;

    if (!lites.length) return '';

    // Apply yaw rotation around the centroid before projection
    const yaw = (yawDeg % 360) * Math.PI / 180;
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const cx0 = lites.reduce((s, l) => s + (l.x1 + l.x2) / 2, 0) / lites.length;
    const cy0 = lites.reduce((s, l) => s + (l.y1 + l.y2) / 2, 0) / lites.length;
    const rotPt = (px, py) => {
        const dx = px - cx0, dy = py - cy0;
        return { x: cx0 + dx * cosY - dy * sinY,
                 y: cy0 + dx * sinY + dy * cosY };
    };
    const xsRaw = lites.flatMap(l => [l.x1, l.x2]);
    const wallA = rotPt(Math.min(0, ...xsRaw), 0);
    const wallB = rotPt(Math.max(0, ...xsRaw), 0);
    lites = lites.map(L => {
        const a = rotPt(L.x1, L.y1);
        const b = rotPt(L.x2, L.y2);
        return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    });

    const xs = lites.flatMap(l => [l.x1, l.x2]).concat([wallA.x, wallB.x]);
    const ys = lites.flatMap(l => [l.y1, l.y2]).concat([wallA.y, wallB.y]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const heightFit = (heightMm || 1) * HEIGHT_SCALE;

    const dpcx = DEPTH_SCALE * Math.cos(ALPHA);
    const dpcy = DEPTH_SCALE * Math.sin(ALPHA);
    const projXmin = minX + Math.min(minY * dpcx, maxY * dpcx);
    const projXmax = maxX + Math.max(minY * dpcx, maxY * dpcx);
    const projYmin = Math.min(minY * dpcy, maxY * dpcy);
    const projYmax = Math.max(minY * dpcy, maxY * dpcy) + heightFit;
    const projW = (projXmax - projXmin) || 1;
    const projH = (projYmax - projYmin) || 1;
    const fit = Math.min(panelW / projW, panelH / projH);

    const ox = x + margin - projXmin * fit;
    const oz = y + margin + labelGap + ctrlBarH + projYmax * fit;
    const proj = (px, py, pz) => ({
        sx: ox + (px + DEPTH_SCALE * py * Math.cos(ALPHA)) * fit,
        sy: oz - (pz + DEPTH_SCALE * py * Math.sin(ALPHA)) * fit,
    });

    const seatPts = [];
    seatPts.push(proj(lites[0].x1, lites[0].y1, 0));
    for (const L of lites) seatPts.push(proj(L.x2, L.y2, 0));
    seatPts.push(proj(wallB.x, wallB.y, 0));
    seatPts.push(proj(wallA.x, wallA.y, 0));
    const seatStr = seatPts.map(p => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(' ');

    const headPts = [];
    headPts.push(proj(lites[0].x1, lites[0].y1, heightFit));
    for (const L of lites) headPts.push(proj(L.x2, L.y2, heightFit));
    headPts.push(proj(wallB.x, wallB.y, heightFit));
    headPts.push(proj(wallA.x, wallA.y, heightFit));
    const headStr = headPts.map(p => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(' ');

    let svg = '';
    svg += `<g class="wc-bay-iso-3d" opacity="0.95">`;
    svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" `
         + `fill="rgba(255,255,255,0.92)" stroke="${dark}" stroke-width="0.8"/>`;
    svg += `<text x="${x + 4}" y="${y + 11}" font-family="'DM Mono',monospace" `
         + `font-size="8" fill="${dark}">${label}</text>`;
    svg += `<polygon points="${seatStr}" fill="rgba(180,140,90,0.55)" `
         + `stroke="${dark}" stroke-width="0.6" stroke-linejoin="round"/>`;
    for (let i = 0; i < lites.length; i++) {
        const L = lites[i];
        const a = proj(L.x1, L.y1, 0);
        const b = proj(L.x2, L.y2, 0);
        const c = proj(L.x2, L.y2, heightFit);
        const d = proj(L.x1, L.y1, heightFit);
        const half = (lites.length - 1) / 2;
        const shade = 0.20 + 0.20 * (1 - Math.abs(i - half) / Math.max(half, 0.5));
        svg += `<polygon points="${a.sx.toFixed(1)},${a.sy.toFixed(1)} `
             + `${b.sx.toFixed(1)},${b.sy.toFixed(1)} `
             + `${c.sx.toFixed(1)},${c.sy.toFixed(1)} `
             + `${d.sx.toFixed(1)},${d.sy.toFixed(1)}" `
             + `fill="rgba(150,200,230,${shade.toFixed(2)})" `
             + `stroke="${frameColour}" stroke-width="1.2" stroke-linejoin="round"/>`;
    }
    svg += `<polygon points="${headStr}" fill="rgba(120,90,60,0.6)" `
         + `stroke="${dark}" stroke-width="0.6" stroke-linejoin="round"/>`;
    const wL = proj(wallA.x, wallA.y, 0);
    const wR = proj(wallB.x, wallB.y, 0);
    svg += `<line x1="${wL.sx.toFixed(1)}" y1="${wL.sy.toFixed(1)}" `
         + `x2="${wR.sx.toFixed(1)}" y2="${wR.sy.toFixed(1)}" `
         + `stroke="${dark}" stroke-width="0.5" stroke-dasharray="2 2" opacity="0.45"/>`;
    if (projMm > 0) {
        svg += `<text x="${x + w - 4}" y="${y + h - 4}" `
             + `font-family="'DM Mono',monospace" font-size="7" `
             + `fill="${dark}" text-anchor="end">P=${Math.round(projMm)}mm</text>`;
    }
    if (showControls) {
        const cbY = y + labelGap + 2;
        const btnSize = 14;
        const gap = 4;
        const totalW = btnSize * 5 + gap * 4;
        const cbX = x + w - totalW - 6;
        const yawRound = Math.round(((yawDeg % 360) + 360) % 360);
        const btn = (sx, action, glyph, tip) => {
            let s = `<g class="wc-iso-btn" data-iso-action="${action}" cursor="pointer">`;
            s += `<title>${tip}</title>`;
            s += `<rect x="${sx}" y="${cbY}" width="${btnSize}" height="${btnSize}" `
               + `rx="2" fill="rgba(79,110,247,0.10)" stroke="${dark}" stroke-width="0.6"/>`;
            s += `<text x="${sx + btnSize / 2}" y="${cbY + btnSize - 4}" `
               + `font-family="'DM Mono',monospace" font-size="11" `
               + `fill="${dark}" text-anchor="middle" pointer-events="none">${glyph}</text>`;
            s += `</g>`;
            return s;
        };
        svg += btn(cbX,                       'tilt-down',  '▾', 'Tilt down (decrease angle)');
        svg += btn(cbX + (btnSize + gap),     'rot-left',   '◀', 'Rotate left −15°');
        svg += btn(cbX + (btnSize + gap) * 2, 'reset',      '⌂', 'Reset to default view');
        svg += btn(cbX + (btnSize + gap) * 3, 'rot-right',  '▶', 'Rotate right +15°');
        svg += btn(cbX + (btnSize + gap) * 4, 'tilt-up',    '▴', 'Tilt up (increase angle)');
        svg += `<text x="${x + 4}" y="${cbY + btnSize - 4}" `
             + `font-family="'DM Mono',monospace" font-size="10" fill="${dark}">`
             + `Y${yawRound}° α${Math.round(alphaDeg)}°</text>`;
    }
    svg += `</g>`;
    return svg;
}

/**
 * Build the iso lite footprint + label for a bay or bow window.
 * Returns { lites, label, projMm, heightMm } ready to feed into
 * renderBayBow3DInset() — used by the popup dialog component.
 */
export function computeBayBowIso({
    type, widthMm = 1800, heightMm = 1500,
    bayAngle = '45', bayAngleCustomDeg = 45,
    bowAngleDeg = '10', bowAngleCustomDeg = 10,
    bayLiteCount = 0, bayCentreRatio = 0.5,
    bowRadiusMm = 0, projectionDepthMm = 0,
}) {
    const lites = [];
    if (type === 'bow') {
        const n = Math.max(3, Math.min(bayLiteCount || 5, 8));
        const degPerLite = bowAngleDeg === 'custom' ? (bowAngleCustomDeg || 10) : parseFloat(bowAngleDeg);
        const phi = (n - 1) * degPerLite * Math.PI / 180;
        const realW = widthMm || 1;
        const radius = bowRadiusMm || ((realW / 2) / Math.sin(phi / 2 || 0.0001));
        const projMm = projectionDepthMm || (radius * (1 - Math.cos(phi / 2)));
        const cyArc = radius - projMm;
        for (let i = 0; i < n; i++) {
            const a1 = -phi / 2 + (phi * i / n);
            const a2 = -phi / 2 + (phi * (i + 1) / n);
            lites.push({
                x1: realW / 2 + radius * Math.sin(a1),
                y1: radius * Math.cos(a1) - cyArc,
                x2: realW / 2 + radius * Math.sin(a2),
                y2: radius * Math.cos(a2) - cyArc,
            });
        }
        return {
            lites,
            label: `3D ISO  ${n}-LITE BOW  R=${Math.round(radius)}mm`,
            projMm,
            heightMm,
        };
    }
    // Bay
    const n = Math.max(2, Math.min(bayLiteCount || 3, 6));
    const angleDeg = bayAngle === 'custom' ? (bayAngleCustomDeg || 45) : parseFloat(bayAngle);
    const theta = angleDeg * Math.PI / 180;
    const realW = widthMm || 1;
    const liteChords = [];
    if (n === 3) {
        const cr = Math.max(0.20, Math.min(bayCentreRatio || 0.5, 0.85));
        const c = realW * cr;
        const f = (realW - c) / 2;
        liteChords.push(f, c, f);
    } else {
        for (let i = 0; i < n; i++) liteChords.push(realW / n);
    }
    if (n === 3) {
        const f = liteChords[0], c = liteChords[1];
        const x2 = f * Math.cos(theta), y2 = f * Math.sin(theta);
        const x3 = x2 + c;
        const x4 = x3 + f * Math.cos(theta);
        lites.push({ x1: 0, y1: 0, x2, y2 });
        lites.push({ x1: x2, y1: y2, x2: x3, y2 });
        lites.push({ x1: x3, y1: y2, x2: x4, y2: 0 });
    } else {
        const half = (n - 1) / 2;
        let curX = 0, curY = 0;
        for (let i = 0; i < n; i++) {
            const a = (i - half) * theta / half;
            const seg = liteChords[i];
            const dx = seg * Math.cos(a);
            const dy = seg * Math.sin(a) * (i < half ? 1 : -1);
            const nx = curX + dx, ny = curY + dy;
            lites.push({ x1: curX, y1: curY, x2: nx, y2: ny });
            curX = nx; curY = ny;
        }
    }
    let projMm = projectionDepthMm;
    if (!projMm && n === 3) projMm = liteChords[0] * Math.sin(theta);
    return {
        lites,
        label: `3D ISO  ${angleDeg}°`,
        projMm: projMm || 0,
        heightMm,
    };
}

export function getWindowSVG(config) {
    const {
        type = 'casement',
        widthPx: W,
        heightPx: H,
        panelsH = 1,
        panelsV = 1,
        panels,
        frameColour: _rawFrameColour = '#f0ede8',
        frameMaterial = null,
        glassOpacity = 0.18,
        widthMm = 0,
        heightMm = 0,
        name = '',
        fabricated = false,
        isIcon = false,
        mullionPositions = null,
        panelTree = null,
        paneConfigs = null,
        selectedPaneIndex = null,
        selectedPaneIndices = null,
        selectedPanelLabel = null,
        selectedPaneArea = null,
        frameShape = 'rectangular',
        frameShapePoints = null,
        georgianBarConfig = null,
        pixelScale = null,
        frameSegments = null,
        selectedFrameSegmentId = null,
        glazingConfigs = null,
        glassConfigs = null,
        // Bay & Bow geometry inputs (optional — defaults applied per type)
        bayAngle = '45',
        bayAngleCustomDeg = 45,
        bowAngleDeg = '10',
        bowAngleCustomDeg = 10,
        bayLiteCount = 0,
        bayCentreRatio = 0.5,
        bayProjectionMm = 0,
        bayLiteChordMm = 0,
        bowRadiusMm = 0,
        bayLiteWidths = null,
        unitSystem = 'metric',
    } = config;

    // Derive frame colour from material preset when available
    const _matPreset = frameMaterial && MATERIAL_COLOURS[frameMaterial];
    const frameColour = _matPreset ? _matPreset.fill : _rawFrameColour;

    const nH = panelsH || panels || 1;
    const nV = panelsV || 1;
    const F = Math.max(8, Math.round(Math.min(W, H) * 0.06));
    const S = Math.max(4, F * 0.55);
    const id = uid();
    const dark = _matPreset ? _matPreset.border : darkenHex(frameColour, 0.7);
    const handleCol = isLightColour(frameColour)
        ? darkenHex(frameColour, 0.35)
        : '#e0e0e0';

    const _ps = pixelScale || 1;        // px-per-mm — declare early so inner helpers can use it
    const gx = F, gy = F, gw = W - F * 2, gh = H - F * 2;

    /* ── Glass tint colour palette ── */
    const GLASS_TINT_RGB = {
        clear:  [168, 216, 240],
        green:  [139, 201, 160],
        teal:   [107, 163, 160],
        bronze: [196, 163,  90],
        grey:   [156, 163, 175],
        blue:   [125, 167, 217],
    };

    /* ── Drawing helpers (closure-local) ── */

    function glass(x, y, w, h, tintKey) {
        if (w <= 0 || h <= 0) return '';
        const [r, g, b] = GLASS_TINT_RGB[tintKey] || GLASS_TINT_RGB.clear;
        const strokeR = Math.round(r * 0.6), strokeG = Math.round(g * 0.6), strokeB = Math.round(b * 0.6);
        return (
            `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" ` +
            `width="${w.toFixed(1)}" height="${h.toFixed(1)}" ` +
            `fill="rgba(${r},${g},${b},${glassOpacity.toFixed(2)})" ` +
            `stroke="rgba(${strokeR},${strokeG},${strokeB},0.4)" stroke-width="1" rx="1"/>` +
            `<line x1="${(x + 4).toFixed(1)}" y1="${(y + 4).toFixed(1)}" ` +
            `x2="${(x + w * 0.35).toFixed(1)}" y2="${(y + h * 0.35).toFixed(1)}" ` +
            `stroke="white" stroke-width="2" opacity="0.22" stroke-linecap="round"/>` +
            `<ellipse cx="${(x + 8).toFixed(1)}" cy="${(y + 8).toFixed(1)}" ` +
            `rx="4" ry="2.5" fill="white" opacity="0.18"/>`
        );
    }

    function frame() {
        const shape = frameShape || 'rectangular';
        switch (shape) {
            case 'arched': {
                const archR = getArchRise('arched', W, H);
                return (
                    `<path d="M0,${H} L0,${archR.toFixed(1)} Q0,0 ${(W / 2).toFixed(1)},0 Q${W},0 ${W},${archR.toFixed(1)} L${W},${H} Z" fill="${frameColour}" stroke="${dark}" stroke-width="2"/>` +
                    `<path d="M${F},${H - F} L${F},${(archR + F * 0.3).toFixed(1)} Q${F},${F} ${(W / 2).toFixed(1)},${F} Q${(W - F)},${F} ${(W - F)},${(archR + F * 0.3).toFixed(1)} L${(W - F)},${(H - F)} Z" fill="none" stroke="${dark}" stroke-width="0.75" stroke-dasharray="2,2" opacity="0.35"/>`
                );
            }
            case 'gothic': {
                const peakY = 0;
                const cp = W * 0.15;
                const peakH = getArchRise('gothic', W, H);
                return (
                    `<path d="M0,${H} L0,${peakH.toFixed(1)} Q${cp.toFixed(1)},${peakY} ${(W / 2).toFixed(1)},${peakY} Q${(W - cp).toFixed(1)},${peakY} ${W},${peakH.toFixed(1)} L${W},${H} Z" fill="${frameColour}" stroke="${dark}" stroke-width="2"/>` +
                    `<path d="M${F},${H - F} L${F},${(peakH + F).toFixed(1)} Q${(cp + F).toFixed(1)},${F} ${(W / 2).toFixed(1)},${F} Q${(W - cp - F).toFixed(1)},${F} ${(W - F)},${(peakH + F).toFixed(1)} L${(W - F)},${(H - F)} Z" fill="none" stroke="${dark}" stroke-width="0.75" stroke-dasharray="2,2" opacity="0.35"/>`
                );
            }
            case 'circle': {
                const r = Math.min(W, H) / 2;
                const cx = W / 2, cy = H / 2;
                return (
                    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${frameColour}" stroke="${dark}" stroke-width="2"/>` +
                    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r - F).toFixed(1)}" fill="none" stroke="${dark}" stroke-width="0.75" stroke-dasharray="2,2" opacity="0.35"/>`
                );
            }
            case 'half_circle': {
                const r = W / 2;
                return (
                    `<path d="M0,${H} L0,${r.toFixed(1)} A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${W},${r.toFixed(1)} L${W},${H} Z" fill="${frameColour}" stroke="${dark}" stroke-width="2"/>` +
                    `<path d="M${F},${H - F} L${F},${(r + F * 0.3).toFixed(1)} A${(r - F).toFixed(1)} ${(r - F).toFixed(1)} 0 0 1 ${(W - F)},${(r + F * 0.3).toFixed(1)} L${(W - F)},${(H - F)} Z" fill="none" stroke="${dark}" stroke-width="0.75" stroke-dasharray="2,2" opacity="0.35"/>`
                );
            }
            case 'triangle': {
                return (
                    `<polygon points="${(W / 2).toFixed(1)},0 0,${H} ${W},${H}" fill="${frameColour}" stroke="${dark}" stroke-width="2"/>` +
                    `<polygon points="${(W / 2).toFixed(1)},${(F * 2.5).toFixed(1)} ${(F * 1.5).toFixed(1)},${(H - F).toFixed(1)} ${(W - F * 1.5).toFixed(1)},${(H - F).toFixed(1)}" fill="none" stroke="${dark}" stroke-width="0.75" stroke-dasharray="2,2" opacity="0.35"/>`
                );
            }
            case 'trapezoid': {
                const inset = W * 0.15;
                return (
                    `<polygon points="${inset.toFixed(1)},0 ${(W - inset).toFixed(1)},0 ${W},${H} 0,${H}" fill="${frameColour}" stroke="${dark}" stroke-width="2"/>` +
                    `<polygon points="${(inset + F).toFixed(1)},${F} ${(W - inset - F).toFixed(1)},${F} ${(W - F)},${(H - F)} ${F},${(H - F)}" fill="none" stroke="${dark}" stroke-width="0.75" stroke-dasharray="2,2" opacity="0.35"/>`
                );
            }
            case 'rake': {
                const rakeH = H * 0.25;
                return (
                    `<polygon points="0,${rakeH.toFixed(1)} ${W},0 ${W},${H} 0,${H}" fill="${frameColour}" stroke="${dark}" stroke-width="2"/>` +
                    `<polygon points="${F},${(rakeH + F * 0.5).toFixed(1)} ${(W - F)},${F} ${(W - F)},${(H - F)} ${F},${(H - F)}" fill="none" stroke="${dark}" stroke-width="0.75" stroke-dasharray="2,2" opacity="0.35"/>`
                );
            }
            case 'octagon': {
                const cut = Math.min(W, H) * 0.29;
                return (
                    `<polygon points="${cut.toFixed(1)},0 ${(W - cut).toFixed(1)},0 ${W},${cut.toFixed(1)} ${W},${(H - cut).toFixed(1)} ${(W - cut).toFixed(1)},${H} ${cut.toFixed(1)},${H} 0,${(H - cut).toFixed(1)} 0,${cut.toFixed(1)}" fill="${frameColour}" stroke="${dark}" stroke-width="2"/>` +
                    `<polygon points="${(cut + F * 0.7).toFixed(1)},${F} ${(W - cut - F * 0.7).toFixed(1)},${F} ${(W - F)},${(cut + F * 0.7).toFixed(1)} ${(W - F)},${(H - cut - F * 0.7).toFixed(1)} ${(W - cut - F * 0.7).toFixed(1)},${(H - F)} ${(cut + F * 0.7).toFixed(1)},${(H - F)} ${F},${(H - cut - F * 0.7).toFixed(1)} ${F},${(cut + F * 0.7).toFixed(1)}" fill="none" stroke="${dark}" stroke-width="0.75" stroke-dasharray="2,2" opacity="0.35"/>`
                );
            }
            case 'custom': {
                if (frameShapePoints && frameShapePoints.length >= 3) {
                    const pts = frameShapePoints.map(p => `${(p.x * W).toFixed(1)},${(p.y * H).toFixed(1)}`).join(' ');
                    const inner = frameShapePoints.map(p => {
                        const ix = F + (p.x * W - F) * ((W - 2 * F) / W);
                        const iy = F + (p.y * H - F) * ((H - 2 * F) / H);
                        return `${ix.toFixed(1)},${iy.toFixed(1)}`;
                    }).join(' ');
                    return (
                        `<polygon points="${pts}" fill="${frameColour}" stroke="${dark}" stroke-width="2"/>` +
                        `<polygon points="${inner}" fill="none" stroke="${dark}" stroke-width="0.75" stroke-dasharray="2,2" opacity="0.35"/>`
                    );
                }
                // fallthrough to rectangular
            }
            default: {
                // ── Resolve per-segment colour (cascade: segment override → window-level) ──
                const segFill = (segId) => {
                    const seg = frameSegments?.[segId];
                    if (seg?.material) {
                        const mp = MATERIAL_COLOURS[seg.material];
                        if (mp) return mp.fill;
                    }
                    if (seg?.colour) return seg.colour;
                    return frameColour;
                };

                const mid = F * 0.45;
                let s = '';

                // Clip path for outer frame shape (rounded corners)
                const clipId = `fc${id}`;
                s += `<defs><clipPath id="${clipId}"><rect width="${W}" height="${H}" rx="2"/></clipPath></defs>`;

                // 4 frame segments clipped to outer shape
                s += `<g clip-path="url(#${clipId})">`;
                s += `<rect x="0" y="0" width="${W}" height="${F}" fill="${segFill('F1')}"/>`;
                s += `<rect x="0" y="${H - F}" width="${W}" height="${F}" fill="${segFill('F2')}"/>`;
                s += `<rect x="0" y="${F}" width="${F}" height="${H - 2 * F}" fill="${segFill('F3')}"/>`;
                s += `<rect x="${W - F}" y="${F}" width="${F}" height="${H - 2 * F}" fill="${segFill('F4')}"/>`;
                s += `</g>`;

                // Outer frame boundary stroke
                s += `<rect width="${W}" height="${H}" rx="2" fill="none" stroke="${dark}" stroke-width="1.5"/>`;

                // Mitered corner lines (45° cuts where rails meet stiles)
                s += `<line x1="0" y1="0" x2="${F}" y2="${F}" stroke="${dark}" stroke-width="1" opacity="0.5"/>`;
                s += `<line x1="${W}" y1="0" x2="${(W - F)}" y2="${F}" stroke="${dark}" stroke-width="1" opacity="0.5"/>`;
                s += `<line x1="0" y1="${H}" x2="${F}" y2="${(H - F)}" stroke="${dark}" stroke-width="1" opacity="0.5"/>`;
                s += `<line x1="${W}" y1="${H}" x2="${(W - F)}" y2="${(H - F)}" stroke="${dark}" stroke-width="1" opacity="0.5"/>`;

                // Outer bevel highlight (light inner edge for depth)
                s += `<rect x="${mid.toFixed(1)}" y="${mid.toFixed(1)}" ` +
                     `width="${(W - mid * 2).toFixed(1)}" height="${(H - mid * 2).toFixed(1)}" ` +
                     `rx="1" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="0.8"/>`;

                // Inner frame edge (glass boundary)
                s += `<rect x="${F}" y="${F}" ` +
                     `width="${gw.toFixed(1)}" height="${gh.toFixed(1)}" ` +
                     `rx="1" fill="none" stroke="${dark}" stroke-width="1.5" opacity="0.6"/>`;

                // Selection highlight on selected frame segment (mitered polygon, not rectangle)
                if (selectedFrameSegmentId) {
                    // Polygons follow the 45° mitered corner joints like real window fabrication
                    const hlPolys = {
                        // F1 (top rail): trapezoid with bottom-inward miter
                        F1: `0,0 ${W},0 ${W - F},${F} ${F},${F}`,
                        // F2 (bottom rail): trapezoid with top-inward miter
                        F2: `${F},${H - F} ${W - F},${H - F} ${W},${H} 0,${H}`,
                        // F3 (left stile): trapezoid with right-inward miter
                        F3: `0,0 ${F},${F} ${F},${H - F} 0,${H}`,
                        // F4 (right stile): trapezoid with left-inward miter
                        F4: `${W - F},${F} ${W},0 ${W},${H} ${W - F},${H - F}`,
                    };
                    const pts = hlPolys[selectedFrameSegmentId];
                    if (pts) {
                        s += `<polygon points="${pts}" ` +
                             `fill="rgba(29,107,243,0.10)" stroke="#1D6BF3" stroke-width="1.5" ` +
                             `pointer-events="none"/>`;
                    }
                }

                return s;
            }
        }
    }

    /* ── Compute pane positions (supports panel tree and custom mullion positions) ── */

    function computePanePositions() {
        const positions = [];

        // Panel tree path — recursive bounds computation
        if (panelTree && widthMm > 0 && heightMm > 0) {
            const scaleX = gw / widthMm;
            const scaleY = gh / heightMm;
            const mullionThk = Math.max(4, Math.round(Math.min(widthMm, heightMm) * 0.06) * 0.55);
            const treeBounds = computePaneBounds(
                panelTree,
                { x: 0, y: 0, w: widthMm, h: heightMm },
                mullionThk,
            );
            for (const pane of treeBounds) {
                const b = pane.bounds;
                positions.push({
                    x: gx + b.x * scaleX,
                    y: gy + b.y * scaleY,
                    w: b.w * scaleX,
                    h: b.h * scaleY,
                    panelId: pane.id,
                    config: pane.config,
                });
            }
            if (positions.length > 0) return positions;
        }

        if (mullionPositions && mullionPositions.length > 0 && widthMm > 0 && heightMm > 0) {
            const scaleX = gw / widthMm;
            const scaleY = gh / heightMm;

            // Get sorted vertical (column dividers) and horizontal (row dividers) in px
            const vEdges = [gx];
            mullionPositions
                .filter(m => m.orientation === 'vertical')
                .map(m => m.positionMm)
                .sort((a, b) => a - b)
                .forEach(mm => vEdges.push(gx + mm * scaleX));
            vEdges.push(gx + gw);

            const hEdges = [gy];
            mullionPositions
                .filter(m => m.orientation === 'horizontal')
                .map(m => m.positionMm)
                .sort((a, b) => a - b)
                .forEach(mm => hEdges.push(gy + mm * scaleY));
            hEdges.push(gy + gh);

            // Build 2D grid of pane rects (row-major order)
            for (let r = 0; r < hEdges.length - 1; r++) {
                for (let c = 0; c < vEdges.length - 1; c++) {
                    const px = (c === 0) ? vEdges[c] : vEdges[c] + S / 2;
                    const py = (r === 0) ? hEdges[r] : hEdges[r] + S / 2;
                    const pw = ((c === vEdges.length - 2) ? vEdges[c + 1] : vEdges[c + 1] - S / 2) - px;
                    const ph = ((r === hEdges.length - 2) ? hEdges[r + 1] : hEdges[r + 1] - S / 2) - py;
                    if (pw > 0 && ph > 0) positions.push({ x: px, y: py, w: pw, h: ph });
                }
            }
        }

        if (positions.length === 0) {
            // Equal division fallback
            const pW = (gw - (nH - 1) * S) / nH;
            const pH = (gh - (nV - 1) * S) / nV;
            for (let r = 0; r < nV; r++) {
                for (let c = 0; c < nH; c++) {
                    positions.push({
                        x: gx + c * (pW + S),
                        y: gy + r * (pH + S),
                        w: pW,
                        h: pH,
                    });
                }
            }
        }
        return positions;
    }

    // Precompute mullion bar positions for drawing
    const _vBarsPx = [];
    const _hBarsPx = [];
    // Panel tree divider lines (partial spans)
    const _treeDividerLines = [];
    if (panelTree && widthMm > 0 && heightMm > 0) {
        const scaleX = gw / widthMm;
        const scaleY = gh / heightMm;
        const mullionThk = Math.max(4, Math.round(Math.min(widthMm, heightMm) * 0.06) * 0.55);
        const divLines = getDividerLines(
            panelTree,
            { x: 0, y: 0, w: widthMm, h: heightMm },
            mullionThk,
        );
        for (const d of divLines) {
            _treeDividerLines.push({
                id: d.id,
                direction: d.direction,
                positionMm: d.position,
                x1: gx + d.x1 * scaleX,
                y1: gy + d.y1 * scaleY,
                x2: gx + d.x2 * scaleX,
                y2: gy + d.y2 * scaleY,
                position: d.direction === 'vertical'
                    ? gx + d.position * scaleX
                    : gy + d.position * scaleY,
                config: d.config || null,
            });
        }
    } else if (mullionPositions && mullionPositions.length > 0 && widthMm > 0 && heightMm > 0) {
        const scaleX = gw / widthMm;
        const scaleY = gh / heightMm;
        mullionPositions
            .filter(m => m.orientation === 'vertical')
            .forEach(m => _vBarsPx.push(gx + m.positionMm * scaleX));
        mullionPositions
            .filter(m => m.orientation === 'horizontal')
            .forEach(m => _hBarsPx.push(gy + m.positionMm * scaleY));
    }

    const computedPanes = computePanePositions();

    // Inner (glazing) boundary for shaped frames — inset from the outer
    // frame outline by the frame thickness, shared by the glazing clip
    // and the shape-correct selection highlight. Memoised since W/H/F/
    // frameShape don't change within a single render.
    let _shapedInnerPtsCache;
    function shapedInnerPts() {
        if (!isShapedFrame(frameShape)) return null;
        if (_shapedInnerPtsCache === undefined) {
            const outerPts = getShapeBoundaryMm(frameShape, W, H, frameShapePoints);
            _shapedInnerPtsCache = insetBoundaryTowardCentroid(outerPts, F);
        }
        return _shapedInnerPtsCache;
    }

    /**
     * If the frame has a curved/pointed shape, clamp the ray from (x0,y0)
     * to (x1,y1) at the first point it crosses the true shape boundary —
     * so a decorative element (e.g. a Sunburst Georgian-bar ray) can never
     * extend past the real curve into a "corner notch" that a rectangular
     * pane's bounding box would otherwise allow. This is on top of, not a
     * replacement for, the group-level clip-path already applied in
     * paneGrid() — the underlying geometry should be correct on its own
     * merits, not rely solely on the browser clipping away the excess.
     * Falls back to the original endpoint when the frame has no curved
     * boundary, or the ray doesn't cross it (already inside).
     */
    function clampRayToShape(x0, y0, x1, y1) {
        const pts = shapedInnerPts();
        if (!pts || pts.length < 3) return [x1, y1];
        const rdx = x1 - x0, rdy = y1 - y0;
        let closestT = 1;
        const n = pts.length;
        for (let i = 0; i < n; i++) {
            const [ax, ay] = pts[i];
            const [bx, by] = pts[(i + 1) % n];
            const edx = bx - ax, edy = by - ay;
            const denom = rdx * edy - rdy * edx;
            if (Math.abs(denom) < 1e-9) continue;
            const t = ((ax - x0) * edy - (ay - y0) * edx) / denom;
            const u = ((ax - x0) * rdy - (ay - y0) * rdx) / denom;
            if (t > 0 && t < closestT && u >= 0 && u <= 1) {
                closestT = t;
            }
        }
        if (closestT < 1) {
            return [x0 + rdx * closestT, y0 + rdy * closestT];
        }
        return [x1, y1];
    }

    // Build set of selected pane indices for fast lookup
    const _selectedSet = new Set();
    if (selectedPaneIndices && selectedPaneIndices.length > 0) {
        for (const idx of selectedPaneIndices) _selectedSet.add(idx);
    } else if (selectedPaneIndex !== null && selectedPaneIndex !== undefined) {
        _selectedSet.add(selectedPaneIndex);
    }

    function paneGrid() {
        let s = '';
        // Layer 1: Glass panes (per-pane tint from config)
        for (let i = 0; i < computedPanes.length; i++) {
            const p = computedPanes[i];
            const cfg = p.config || paneConfigs?.[i] || {};
            s += glass(p.x, p.y, p.w, p.h, cfg.glassTint);
        }
        // Layer 2: Mullion bars — realistic frame-profile appearance with 3D depth
        // Helper: draw a single mullion bar with bevel highlight + dark edge
        function drawMullionBar(rx, ry, rw, rh, mFill, mStroke, isVert) {
            let b = '';
            // Main fill
            b += `<rect x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}" fill="${mFill}" stroke="${mStroke}" stroke-width="0.7"/>`;
            // Bevel highlight (light edge for 3D depth)
            if (isVert) {
                b += `<line x1="${(rx + 1).toFixed(1)}" y1="${ry.toFixed(1)}" x2="${(rx + 1).toFixed(1)}" y2="${(ry + rh).toFixed(1)}" stroke="rgba(255,255,255,0.22)" stroke-width="0.7"/>`;
                b += `<line x1="${(rx + rw - 0.5).toFixed(1)}" y1="${ry.toFixed(1)}" x2="${(rx + rw - 0.5).toFixed(1)}" y2="${(ry + rh).toFixed(1)}" stroke="${mStroke}" stroke-width="0.4" opacity="0.3"/>`;
            } else {
                b += `<line x1="${rx.toFixed(1)}" y1="${(ry + 1).toFixed(1)}" x2="${(rx + rw).toFixed(1)}" y2="${(ry + 1).toFixed(1)}" stroke="rgba(255,255,255,0.22)" stroke-width="0.7"/>`;
                b += `<line x1="${rx.toFixed(1)}" y1="${(ry + rh - 0.5).toFixed(1)}" x2="${(rx + rw).toFixed(1)}" y2="${(ry + rh - 0.5).toFixed(1)}" stroke="${mStroke}" stroke-width="0.4" opacity="0.3"/>`;
            }
            return b;
        }
        if (_treeDividerLines.length > 0) {
            for (const d of _treeDividerLines) {
                const mFill = d.config?.colour || frameColour;
                const mStroke = d.config?.colour ? darkenHex(d.config.colour, 0.7) : dark;
                if (d.direction === 'vertical') {
                    s += drawMullionBar(d.position - S / 2, d.y1, S, d.y2 - d.y1, mFill, mStroke, true);
                } else {
                    s += drawMullionBar(d.x1, d.position - S / 2, d.x2 - d.x1, S, mFill, mStroke, false);
                }
            }
        } else if (_vBarsPx.length > 0) {
            for (const bx of _vBarsPx) {
                s += drawMullionBar(bx - S / 2, gy, S, gh, frameColour, dark, true);
            }
        } else {
            const pW = (gw - (nH - 1) * S) / nH;
            for (let c = 1; c < nH; c++) {
                const sx = gx + c * (pW + S) - S;
                s += drawMullionBar(sx, gy, S, gh, frameColour, dark, true);
            }
        }
        if (_treeDividerLines.length === 0) {
            // Legacy / fallback horizontal bars — skip when tree already drew all dividers
            if (_hBarsPx.length > 0) {
                for (const by of _hBarsPx) {
                    s += drawMullionBar(gx, by - S / 2, gw, S, frameColour, dark, false);
                }
            } else {
                const pH = (gh - (nV - 1) * S) / nV;
                for (let r = 1; r < nV; r++) {
                    const ry = gy + r * (pH + S) - S;
                    s += drawMullionBar(gx, ry, gw, S, frameColour, dark, false);
                }
            }
        }
        // Layer 3: Georgian bars — on top of glass and mullions
        s += drawGeorgianBars();

        // Clip the whole glazing layer to the true (inset) frame outline so a
        // rectangular pane grid never spills outside a circle/arch/octagon/
        // custom-shaped frame — the glass must fit the shape, not just its
        // bounding box.
        const innerPts = shapedInnerPts();
        if (innerPts) {
            const ptsAttr = innerPts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
            const clipId = `pg${id}`;
            return (
                `<defs><clipPath id="${clipId}"><polygon points="${ptsAttr}"/></clipPath></defs>` +
                `<g clip-path="url(#${clipId})">${s}</g>`
            );
        }
        return s;
    }

    /** Selection highlights + info chips rendered on top of everything except dimensions */
    function renderSelection() {
        let s = '';
        // A lone pane spanning the whole window takes the frame's own shape
        // for its highlight (e.g. a circle, not a rectangle) — drawn as-is,
        // matching the glass clip-path exactly. Sub-panes from a split frame
        // get that same outline clipped down to their own slice (curve as
        // the subject, pane rect as the clip — the rect is always convex,
        // which Sutherland-Hodgman requires; the inset curve itself can have
        // tiny non-convex wiggles near a peak, so it must never be the clip
        // polygon), so a header pane can't highlight the "horn" corners
        // outside the curve.
        const innerPts = shapedInnerPts();
        const isLoneSpan = computedPanes.length === 1;
        // Selection highlights — inset by 1px so stroke stays inside pane, never bleeding over mullion
        for (let i = 0; i < computedPanes.length; i++) {
            if (_selectedSet.has(i)) {
                const p = computedPanes[i];
                const inset = 1;
                if (innerPts && isLoneSpan) {
                    const ptsAttr = innerPts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
                    s += `<polygon points="${ptsAttr}" fill="rgba(29,107,243,0.08)" stroke="#1D6BF3" stroke-width="2" pointer-events="none"/>`;
                } else if (innerPts) {
                    const rectPts = [
                        [p.x + inset, p.y + inset],
                        [p.x + p.w - inset, p.y + inset],
                        [p.x + p.w - inset, p.y + p.h - inset],
                        [p.x + inset, p.y + p.h - inset],
                    ];
                    const clipped = clipPolygonToShape(innerPts, rectPts);
                    const outline = clipped.length >= 3 ? clipped : rectPts;
                    const ptsAttr = outline.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
                    s += `<polygon points="${ptsAttr}" fill="rgba(29,107,243,0.08)" stroke="#1D6BF3" stroke-width="2" pointer-events="none"/>`;
                } else {
                    s += `<rect x="${(p.x + inset).toFixed(1)}" y="${(p.y + inset).toFixed(1)}" width="${(p.w - 2 * inset).toFixed(1)}" height="${(p.h - 2 * inset).toFixed(1)}" fill="rgba(29,107,243,0.08)" stroke="#1D6BF3" stroke-width="2" rx="0" pointer-events="none"/>`;
                }
            }
        }
        // Info chips — fixed screen-pixel sizes
        if (_selectedSet.size > 0 && !isIcon) {
            if (_selectedSet.size === 1) {
                const selIdx = _selectedSet.values().next().value;
                const sp = computedPanes[selIdx];
                if (sp && sp.w > 30 && sp.h > 20) {
                    const paneLabel = 'P' + (selIdx + 1);
                    const areaText = selectedPaneArea != null ? ` \u00B7 ${selectedPaneArea.toFixed(3)} m\u00B2` : '';
                    const chipText = paneLabel + areaText;
                    const chipFS = 10;
                    const chipW = Math.min(sp.w * 0.8, Math.max(55, chipText.length * 6 + 12));
                    const chipH = 20;
                    const chipX = sp.x + (sp.w - chipW) / 2;
                    const chipY = sp.y + sp.h - chipH - 8;
                    s += `<rect x="${chipX.toFixed(1)}" y="${chipY.toFixed(1)}" width="${chipW.toFixed(1)}" height="${chipH.toFixed(1)}" rx="10" fill="#1D6BF3" opacity="0.88" pointer-events="none"/>`;
                    s += `<text x="${(chipX + chipW / 2).toFixed(1)}" y="${(chipY + chipH / 2 + 3.5).toFixed(1)}" text-anchor="middle" font-size="${chipFS}" font-family="'DM Mono',monospace" font-weight="600" fill="white" pointer-events="none">${chipText}</text>`;
                }
            } else {
                // Multi-select: show count chip in first selected pane
                const selIdx = _selectedSet.values().next().value;
                const sp = computedPanes[selIdx];
                if (sp && sp.w > 30 && sp.h > 20) {
                    const chipText = `${_selectedSet.size} panels` + (selectedPaneArea != null ? ` \u00B7 ${selectedPaneArea.toFixed(3)} m\u00B2` : '');
                    const chipFS = 10;
                    const chipW = Math.min(sp.w * 0.8, Math.max(65, chipText.length * 6 + 12));
                    const chipH = 20;
                    const chipX = sp.x + (sp.w - chipW) / 2;
                    const chipY = sp.y + sp.h - chipH - 8;
                    s += `<rect x="${chipX.toFixed(1)}" y="${chipY.toFixed(1)}" width="${chipW.toFixed(1)}" height="${chipH.toFixed(1)}" rx="10" fill="#1D6BF3" opacity="0.88" pointer-events="none"/>`;
                    s += `<text x="${(chipX + chipW / 2).toFixed(1)}" y="${(chipY + chipH / 2 + 3.5).toFixed(1)}" text-anchor="middle" font-size="${chipFS}" font-family="'DM Mono',monospace" font-weight="600" fill="white" pointer-events="none">${chipText}</text>`;
                }
            }
        }
        return s;
    }

    /** Draw subtle F1/F2/F3/F4 labels on frame edges for discoverability */
    function drawFrameSegmentLabels() {
        if (isIcon) return '';
        const fs = 8;
        const fc = 'rgba(0,0,0,0.25)';
        const segments = [
            { id: 'F1', x: W / 2, y: F / 2 + 1 },           // top rail
            { id: 'F2', x: W / 2, y: H - F / 2 + 1 },       // bottom rail
            { id: 'F3', x: F / 2, y: H / 2 + 1 },            // left stile
            { id: 'F4', x: W - F / 2, y: H / 2 + 1 },        // right stile
        ];
        let s = '';
        for (const seg of segments) {
            s += `<text x="${seg.x.toFixed(1)}" y="${seg.y.toFixed(1)}" text-anchor="middle" font-size="${fs}" font-family="'DM Mono',monospace" font-weight="500" fill="${fc}" pointer-events="none">${seg.id}</text>`;
        }
        return s;
    }

    function pane(col, row) {
        const idx = row * nH + col;
        if (idx < computedPanes.length) return computedPanes[idx];
        const pW = (gw - (nH - 1) * S) / nH;
        const pH = (gh - (nV - 1) * S) / nV;
        return {
            x: gx + col * (pW + S),
            y: gy + row * (pH + S),
            w: pW,
            h: pH,
        };
    }

    function hinge(x, y, col) {
        const c = col || handleCol;
        const shadow = darkenHex(c || handleCol, 0.5);
        // Realistic barrel hinge with pin and knuckle
        return `<rect x="${(x - 2.5).toFixed(1)}" y="${(y - 5).toFixed(1)}" ` +
               `width="5" height="10" rx="1.5" fill="${c}" stroke="${shadow}" stroke-width="0.4"/>` +
               `<line x1="${x.toFixed(1)}" y1="${(y - 5).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y + 5).toFixed(1)}" stroke="${shadow}" stroke-width="0.5" opacity="0.4"/>`;
    }

    function handle(x, y, vertical, col) {
        const isVert = vertical !== undefined ? vertical : true;
        const c = col || handleCol;
        const knob = darkenHex(c, 0.4);
        const highlight = 'rgba(255,255,255,0.3)';
        if (isVert) {
            // Espagnolette-style handle — base plate + lever + rosette
            let s = '';
            s += `<rect x="${(x - 2.5).toFixed(1)}" y="${(y - 10).toFixed(1)}" width="5" height="20" rx="1.5" fill="${c}" stroke="${knob}" stroke-width="0.5"/>`;
            s += `<rect x="${(x - 1.5).toFixed(1)}" y="${(y - 10).toFixed(1)}" width="1.5" height="20" rx="0.5" fill="${highlight}" opacity="0.5"/>`;
            s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="${knob}"/>`;
            s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1" fill="${highlight}" opacity="0.5"/>`;
            return s;
        }
        let s = '';
        s += `<rect x="${(x - 10).toFixed(1)}" y="${(y - 2.5).toFixed(1)}" width="20" height="5" rx="1.5" fill="${c}" stroke="${knob}" stroke-width="0.5"/>`;
        s += `<rect x="${(x - 10).toFixed(1)}" y="${(y - 1.5).toFixed(1)}" width="20" height="1.5" rx="0.5" fill="${highlight}" opacity="0.5"/>`;
        s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="${knob}"/>`;
        s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1" fill="${highlight}" opacity="0.5"/>`;
        return s;
    }

    /** Flush recessed pull on vertical stile — typical sliding window D-handle */
    function stilePull(x, y, h, col) {
        const c = col || handleCol;
        const shadow = darkenHex(c || handleCol, 0.5);
        const pullH = Math.min(h * 0.25, 24);
        let s = '';
        // Recessed channel
        s += `<rect x="${(x - 2).toFixed(1)}" y="${(y - pullH / 2).toFixed(1)}" width="4" height="${pullH.toFixed(1)}" rx="2" fill="${shadow}" opacity="0.35"/>`;
        // Pull bar
        s += `<rect x="${(x - 1.5).toFixed(1)}" y="${(y - pullH / 2 + 1).toFixed(1)}" width="3" height="${(pullH - 2).toFixed(1)}" rx="1.5" fill="${c}" stroke="${shadow}" stroke-width="0.4"/>`;
        // Highlight edge
        s += `<line x1="${(x - 0.5).toFixed(1)}" y1="${(y - pullH / 2 + 2).toFixed(1)}" x2="${(x - 0.5).toFixed(1)}" y2="${(y + pullH / 2 - 2).toFixed(1)}" stroke="rgba(255,255,255,0.35)" stroke-width="0.5"/>`;
        return s;
    }

    /** Flush recessed pull on horizontal rail — for hung windows */
    function railPull(x, y, w, col) {
        const c = col || handleCol;
        const shadow = darkenHex(c || handleCol, 0.5);
        const pullW = Math.min(w * 0.25, 24);
        let s = '';
        s += `<rect x="${(x - pullW / 2).toFixed(1)}" y="${(y - 2).toFixed(1)}" width="${pullW.toFixed(1)}" height="4" rx="2" fill="${shadow}" opacity="0.35"/>`;
        s += `<rect x="${(x - pullW / 2 + 1).toFixed(1)}" y="${(y - 1.5).toFixed(1)}" width="${(pullW - 2).toFixed(1)}" height="3" rx="1.5" fill="${c}" stroke="${shadow}" stroke-width="0.4"/>`;
        s += `<line x1="${(x - pullW / 2 + 2).toFixed(1)}" y1="${(y - 0.5).toFixed(1)}" x2="${(x + pullW / 2 - 2).toFixed(1)}" y2="${(y - 0.5).toFixed(1)}" stroke="rgba(255,255,255,0.35)" stroke-width="0.5"/>`;
        return s;
    }

    function fixedX(cx, cy, sz, pw, ph) {
        // Full-diagonal cross spanning the given pane area
        const x1 = pw ? cx - pw / 2 : cx - sz;
        const y1 = ph ? cy - ph / 2 : cy - sz;
        const x2 = pw ? cx + pw / 2 : cx + sz;
        const y2 = ph ? cy + ph / 2 : cy + sz;
        return (
            `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" ` +
            `x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ` +
            `stroke="${frameColour}" stroke-width="1" opacity="0.22"/>` +
            `<line x1="${x2.toFixed(1)}" y1="${y1.toFixed(1)}" ` +
            `x2="${x1.toFixed(1)}" y2="${y2.toFixed(1)}" ` +
            `stroke="${frameColour}" stroke-width="1" opacity="0.22"/>`
        );
    }

    function arc(x1, y1, x2, y2, r, flip = false) {
        return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} ` +
               `A${r.toFixed(1)} ${r.toFixed(1)} 0 0 ${flip ? 0 : 1} ` +
               `${x2.toFixed(1)} ${y2.toFixed(1)}" ` +
               `fill="none" stroke="rgba(0,0,0,0.12)" ` +
               `stroke-width="1" stroke-dasharray="4,3"/>`;
    }

    /* ── Per-pane opening-type notation (WindowMaker style) ──────── */

    /** Sash frame thickness — operable panes get a realistic inner frame profile */
    const sashT = Math.max(3, S * 0.75);

    function drawSashFrame(p) {
        const t = sashT;
        let s = '';
        // 4 filled sash frame segments matching outer frame material
        s += `<rect x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" width="${p.w.toFixed(1)}" height="${t.toFixed(1)}" fill="${frameColour}"/>`;
        s += `<rect x="${p.x.toFixed(1)}" y="${(p.y + p.h - t).toFixed(1)}" width="${p.w.toFixed(1)}" height="${t.toFixed(1)}" fill="${frameColour}"/>`;
        s += `<rect x="${p.x.toFixed(1)}" y="${(p.y + t).toFixed(1)}" width="${t.toFixed(1)}" height="${(p.h - 2 * t).toFixed(1)}" fill="${frameColour}"/>`;
        s += `<rect x="${(p.x + p.w - t).toFixed(1)}" y="${(p.y + t).toFixed(1)}" width="${t.toFixed(1)}" height="${(p.h - 2 * t).toFixed(1)}" fill="${frameColour}"/>`;
        // Outer sash edge stroke
        s += `<rect x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" width="${p.w.toFixed(1)}" height="${p.h.toFixed(1)}" fill="none" stroke="${dark}" stroke-width="0.8"/>`;
        // Inner sash edge (glass boundary)
        s += `<rect x="${(p.x + t).toFixed(1)}" y="${(p.y + t).toFixed(1)}" width="${(p.w - 2 * t).toFixed(1)}" height="${(p.h - 2 * t).toFixed(1)}" fill="none" stroke="${dark}" stroke-width="0.7" opacity="0.55"/>`;
        // Mitered corner lines (45° cuts like real sash joinery)
        s += `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${(p.x + t).toFixed(1)}" y2="${(p.y + t).toFixed(1)}" stroke="${dark}" stroke-width="0.5" opacity="0.4"/>`;
        s += `<line x1="${(p.x + p.w).toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${(p.x + p.w - t).toFixed(1)}" y2="${(p.y + t).toFixed(1)}" stroke="${dark}" stroke-width="0.5" opacity="0.4"/>`;
        s += `<line x1="${p.x.toFixed(1)}" y1="${(p.y + p.h).toFixed(1)}" x2="${(p.x + t).toFixed(1)}" y2="${(p.y + p.h - t).toFixed(1)}" stroke="${dark}" stroke-width="0.5" opacity="0.4"/>`;
        s += `<line x1="${(p.x + p.w).toFixed(1)}" y1="${(p.y + p.h).toFixed(1)}" x2="${(p.x + p.w - t).toFixed(1)}" y2="${(p.y + p.h - t).toFixed(1)}" stroke="${dark}" stroke-width="0.5" opacity="0.4"/>`;
        // Bevel highlight (subtle white inner edge for depth)
        const bev = t * 0.35;
        s += `<rect x="${(p.x + bev).toFixed(1)}" y="${(p.y + bev).toFixed(1)}" width="${(p.w - 2 * bev).toFixed(1)}" height="${(p.h - 2 * bev).toFixed(1)}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="0.6"/>`;
        return s;
    }

    /**
     * Render visual indicators for pane-level addon selections.
     * Reads cfg.addonSelections and draws overlays per category type.
     */
    function drawPaneAccessories(p, addonSelections) {
        if (!addonSelections || typeof addonSelections !== 'object') return '';
        let s = '';
        const pad = 3;
        const ix = p.x + pad;
        const iy = p.y + pad;
        const iw = p.w - 2 * pad;
        const ih = p.h - 2 * pad;

        for (const [catCode, sel] of Object.entries(addonSelections)) {
            if (!sel || !sel.addon_id) continue;

            switch (catCode) {
                case 'screen': {
                    // Fine crosshatch mesh overlay
                    const spacing = Math.max(3, Math.min(6, Math.min(iw, ih) * 0.04));
                    s += `<g opacity="0.18">`;
                    for (let dx = spacing; dx < iw; dx += spacing) {
                        s += `<line x1="${(ix + dx).toFixed(1)}" y1="${iy.toFixed(1)}" x2="${(ix + dx).toFixed(1)}" y2="${(iy + ih).toFixed(1)}" stroke="#555" stroke-width="0.3"/>`;
                    }
                    for (let dy = spacing; dy < ih; dy += spacing) {
                        s += `<line x1="${ix.toFixed(1)}" y1="${(iy + dy).toFixed(1)}" x2="${(ix + iw).toFixed(1)}" y2="${(iy + dy).toFixed(1)}" stroke="#555" stroke-width="0.3"/>`;
                    }
                    s += `</g>`;
                    // Small mesh icon badge bottom-left
                    const bx = ix + 2, by = iy + ih - 10;
                    s += `<rect x="${bx}" y="${by}" width="14" height="9" rx="2" fill="#4a9" opacity="0.7"/>`;
                    s += `<text x="${bx + 7}" y="${by + 7}" text-anchor="middle" font-size="6" fill="#fff" font-weight="bold">S</text>`;
                    break;
                }
                case 'grill': {
                    // Vertical and horizontal grill bars
                    const cols = 3, rows = 2;
                    const barW = Math.max(1, iw * 0.015);
                    s += `<g opacity="0.35" stroke="#8B7355" stroke-width="${barW.toFixed(1)}">`;
                    for (let c = 1; c <= cols; c++) {
                        const lx = ix + (iw * c) / (cols + 1);
                        s += `<line x1="${lx.toFixed(1)}" y1="${iy.toFixed(1)}" x2="${lx.toFixed(1)}" y2="${(iy + ih).toFixed(1)}"/>`;
                    }
                    for (let r = 1; r <= rows; r++) {
                        const ly = iy + (ih * r) / (rows + 1);
                        s += `<line x1="${ix.toFixed(1)}" y1="${ly.toFixed(1)}" x2="${(ix + iw).toFixed(1)}" y2="${ly.toFixed(1)}"/>`;
                    }
                    s += `</g>`;
                    break;
                }
                case 'blind': {
                    // Cassette at top + horizontal slat lines
                    const cassH = Math.max(4, ih * 0.06);
                    s += `<rect x="${ix.toFixed(1)}" y="${iy.toFixed(1)}" width="${iw.toFixed(1)}" height="${cassH.toFixed(1)}" fill="#bbb" opacity="0.5" rx="1"/>`;
                    const slatSpacing = Math.max(3, ih * 0.04);
                    s += `<g opacity="0.15">`;
                    for (let dy = cassH + slatSpacing; dy < ih * 0.5; dy += slatSpacing) {
                        s += `<line x1="${ix.toFixed(1)}" y1="${(iy + dy).toFixed(1)}" x2="${(ix + iw).toFixed(1)}" y2="${(iy + dy).toFixed(1)}" stroke="#888" stroke-width="0.5"/>`;
                    }
                    s += `</g>`;
                    break;
                }
                case 'security': {
                    // Shield badge top-left
                    const sx = ix + 2, sy = iy + 2;
                    s += `<rect x="${sx}" y="${sy}" width="14" height="11" rx="2" fill="#c0392b" opacity="0.7"/>`;
                    s += `<text x="${sx + 7}" y="${sy + 8.5}" text-anchor="middle" font-size="7" fill="#fff">⛨</text>`;
                    break;
                }
                case 'sun_control': {
                    // Subtle tinted overlay
                    s += `<rect x="${ix.toFixed(1)}" y="${iy.toFixed(1)}" width="${iw.toFixed(1)}" height="${ih.toFixed(1)}" fill="#f5c542" opacity="0.08"/>`;
                    break;
                }
                case 'decorative': {
                    // Decorative frosted effect — subtle diagonal hatching
                    s += `<g opacity="0.12">`;
                    const dsp = Math.max(5, Math.min(10, iw * 0.06));
                    for (let d = dsp; d < iw + ih; d += dsp) {
                        const x1 = ix + Math.min(d, iw);
                        const y1 = iy + Math.max(0, d - iw);
                        const x2 = ix + Math.max(0, d - ih);
                        const y2 = iy + Math.min(d, ih);
                        s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#aaa" stroke-width="0.4"/>`;
                    }
                    s += `</g>`;
                    break;
                }
                default: {
                    // Generic badge for unknown categories
                    const gx2 = ix + iw - 16, gy2 = iy + ih - 10;
                    s += `<rect x="${gx2}" y="${gy2}" width="14" height="9" rx="2" fill="#666" opacity="0.6"/>`;
                    s += `<text x="${gx2 + 7}" y="${gy2 + 7}" text-anchor="middle" font-size="5" fill="#fff">+</text>`;
                    break;
                }
            }
        }
        return s;
    }

    function drawPaneNotation(p, openingType, idx, hwSel) {
        const nc = 'rgba(0,0,0,0.55)';
        const nd = '5,3';
        // Operable panes have a sash frame — inset symbols past it; fixed panes use minimal margin
        const isOperable = openingType && openingType !== 'fixed';
        const m = isOperable ? sashT + 1 : 3;
        let s = '';
        const x1 = p.x + m, y1 = p.y + m;
        const x2 = p.x + p.w - m, y2 = p.y + p.h - m;
        const cx = p.x + p.w / 2, cy = p.y + p.h / 2;

        // Derive hardware indicator colours — accent when specific hardware is configured
        const hw = hwSel || {};
        const hwCount = Object.keys(hw).length;
        const handleC = hw.handle ? '#D4A017' : null;    // gold accent
        const hingeC  = hw.hinge  ? '#A0A0A0' : null;    // silver accent
        const pullC   = hw.handle ? '#D4A017' : null;

        switch (openingType) {
            case 'fixed': {
                s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${nc}" stroke-width="0.7" stroke-dasharray="${nd}"/>`;
                s += `<line x1="${x2.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${nc}" stroke-width="0.7" stroke-dasharray="${nd}"/>`;
                break;
            }
            case 'casement-l': {
                // Hinged on left stile — handle on right stile at ergonomic height (~55%)
                s += drawSashFrame(p);
                s += `<polygon points="${x1.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="${nc}" stroke-width="1.0"/>`;
                s += hinge(p.x + 2, p.y + p.h * 0.15, hingeC);
                s += hinge(p.x + 2, p.y + p.h * 0.85, hingeC);
                s += handle(p.x + p.w - sashT / 2, p.y + p.h * 0.55, true, handleC);
                break;
            }
            case 'casement-r': {
                // Hinged on right stile — handle on left stile at ergonomic height (~55%)
                s += drawSashFrame(p);
                s += `<polygon points="${x2.toFixed(1)},${cy.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="${nc}" stroke-width="1.0"/>`;
                s += hinge(p.x + p.w - 2, p.y + p.h * 0.15, hingeC);
                s += hinge(p.x + p.w - 2, p.y + p.h * 0.85, hingeC);
                s += handle(p.x + sashT / 2, p.y + p.h * 0.55, true, handleC);
                break;
            }
            case 'awning': {
                // Hinged at top rail — handle on bottom rail centre
                s += drawSashFrame(p);
                s += `<polygon points="${cx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="${nc}" stroke-width="1.0"/>`;
                s += hinge(p.x + p.w * 0.25, p.y + sashT / 2, hingeC);
                s += hinge(p.x + p.w * 0.75, p.y + sashT / 2, hingeC);
                s += handle(cx, p.y + p.h - sashT / 2, false, handleC);
                break;
            }
            case 'tiltturn': {
                // Bottom-hinged tilt + side-hinged turn — handle on right stile at ~50%
                s += drawSashFrame(p);
                s += `<polygon points="${cx.toFixed(1)},${y2.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y1.toFixed(1)}" fill="none" stroke="${nc}" stroke-width="1.0"/>`;
                s += `<polygon points="${x1.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="${nc}" stroke-width="0.6" stroke-dasharray="3,3" opacity="0.5"/>`;
                s += handle(p.x + p.w - sashT / 2, cy, true, handleC);
                break;
            }
            case 'sliding': {
                // Pull on meeting stile edge (opposite to travel direction)
                s += drawSashFrame(p);
                const dir = idx % 2 === 0 ? 1 : -1;
                const arrLen = (p.w - m * 2) * 0.35;
                const ax = cx - dir * arrLen / 2;
                const bx = cx + dir * arrLen / 2;
                s += `<line x1="${ax.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${nc}" stroke-width="1.2"/>`;
                s += `<polygon points="${bx.toFixed(1)},${(cy - 3).toFixed(1)} ${(bx + dir * 4).toFixed(1)},${cy.toFixed(1)} ${bx.toFixed(1)},${(cy + 3).toFixed(1)}" fill="${nc}"/>`;
                // Flush pull on meeting stile: opposite edge from arrow direction
                const pullX = dir === 1
                    ? p.x + sashT / 2           // left stile (meeting rail when sliding right)
                    : p.x + p.w - sashT / 2;    // right stile (meeting rail when sliding left)
                s += stilePull(pullX, cy, p.h, pullC);
                break;
            }
            case 'bifold': {
                s += drawSashFrame(p);
                const zigA = (p.w - m * 2) * 0.06;
                const segH = (p.h - m * 2) * 0.15;
                const startY = p.y + p.h * 0.25;
                s += `<polyline points="${cx.toFixed(1)},${startY.toFixed(1)} ${(cx + zigA).toFixed(1)},${(startY + segH).toFixed(1)} ${(cx - zigA).toFixed(1)},${(startY + segH * 2).toFixed(1)} ${cx.toFixed(1)},${(startY + segH * 3).toFixed(1)}" fill="none" stroke="${nc}" stroke-width="0.8"/>`;
                // Handle on the leading leaf stile, at ergonomic height
                const bfDir = idx % 2 === 0 ? 1 : -1;
                const bfHandleX = bfDir === 1
                    ? p.x + p.w - sashT / 2
                    : p.x + sashT / 2;
                s += handle(bfHandleX, p.y + p.h * 0.55, true, handleC);
                break;
            }
            case 'hopper': {
                // Hinged at bottom rail — handle on top rail centre
                s += drawSashFrame(p);
                s += `<polygon points="${cx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="${nc}" stroke-width="1.0"/>`;
                s += hinge(p.x + p.w * 0.25, p.y + p.h - sashT / 2, hingeC);
                s += hinge(p.x + p.w * 0.75, p.y + p.h - sashT / 2, hingeC);
                s += handle(cx, p.y + sashT / 2, false, handleC);
                break;
            }
            case 'single-hung': {
                s += drawSashFrame(p);
                const shMidY = p.y + p.h / 2;
                const fxL = p.x + m, fxR = p.x + p.w - m;
                // Fixed top half — X marks
                s += `<line x1="${fxL.toFixed(1)}" y1="${(p.y + m).toFixed(1)}" x2="${fxR.toFixed(1)}" y2="${(shMidY - 1).toFixed(1)}" stroke="${nc}" stroke-width="0.6" stroke-dasharray="${nd}" opacity="0.45"/>`;
                s += `<line x1="${fxR.toFixed(1)}" y1="${(p.y + m).toFixed(1)}" x2="${fxL.toFixed(1)}" y2="${(shMidY - 1).toFixed(1)}" stroke="${nc}" stroke-width="0.6" stroke-dasharray="${nd}" opacity="0.45"/>`;
                s += `<line x1="${p.x.toFixed(1)}" y1="${shMidY.toFixed(1)}" x2="${(p.x + p.w).toFixed(1)}" y2="${shMidY.toFixed(1)}" stroke="${nc}" stroke-width="0.8"/>`;
                // Sliding bottom — up arrow
                const shATop = shMidY + m + 2;
                const shABot = p.y + p.h - m - 2;
                s += `<line x1="${cx.toFixed(1)}" y1="${shABot.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(shATop + 5).toFixed(1)}" stroke="${nc}" stroke-width="1.2"/>`;
                s += `<polygon points="${cx.toFixed(1)},${shATop.toFixed(1)} ${(cx - 3).toFixed(1)},${(shATop + 6).toFixed(1)} ${(cx + 3).toFixed(1)},${(shATop + 6).toFixed(1)}" fill="${nc}"/>`;
                // Pull on meeting rail (the horizontal bar between fixed & sliding)
                s += railPull(cx, shMidY, p.w, pullC);
                break;
            }
            case 'double-hung': {
                s += drawSashFrame(p);
                const dhMidY = p.y + p.h / 2;
                s += `<line x1="${p.x.toFixed(1)}" y1="${dhMidY.toFixed(1)}" x2="${(p.x + p.w).toFixed(1)}" y2="${dhMidY.toFixed(1)}" stroke="${nc}" stroke-width="0.8"/>`;
                // Top sash — down arrow
                const dhDT = p.y + m + 2;
                const dhDB = dhMidY - m - 2;
                s += `<line x1="${cx.toFixed(1)}" y1="${dhDT.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(dhDB - 5).toFixed(1)}" stroke="${nc}" stroke-width="1.2"/>`;
                s += `<polygon points="${cx.toFixed(1)},${dhDB.toFixed(1)} ${(cx - 3).toFixed(1)},${(dhDB - 6).toFixed(1)} ${(cx + 3).toFixed(1)},${(dhDB - 6).toFixed(1)}" fill="${nc}"/>`;
                // Bottom sash — up arrow
                const dhUT = dhMidY + m + 2;
                const dhUB = p.y + p.h - m - 2;
                s += `<line x1="${cx.toFixed(1)}" y1="${dhUB.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(dhUT + 5).toFixed(1)}" stroke="${nc}" stroke-width="1.2"/>`;
                s += `<polygon points="${cx.toFixed(1)},${dhUT.toFixed(1)} ${(cx - 3).toFixed(1)},${(dhUT + 6).toFixed(1)} ${(cx + 3).toFixed(1)},${(dhUT + 6).toFixed(1)}" fill="${nc}"/>`;
                // Pull on meeting rail
                s += railPull(cx, dhMidY, p.w, pullC);
                break;
            }
            case 'pivot': {
                s += drawSashFrame(p);
                s += `<line x1="${x1.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${nc}" stroke-width="0.9"/>`;
                s += `<circle cx="${x1.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.5" fill="${nc}" opacity="0.6"/>`;
                s += `<circle cx="${x2.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.5" fill="${nc}" opacity="0.6"/>`;
                s += `<rect x="${x1.toFixed(1)}" y="${y1.toFixed(1)}" width="${(x2 - x1).toFixed(1)}" height="${(cy - y1).toFixed(1)}" fill="none" stroke="${nc}" stroke-width="0.8"/>`;
                break;
            }
            case 'lift-slide': {
                // Lift handle on meeting stile + horizontal slide arrow
                s += drawSashFrame(p);
                const lsDir = idx % 2 === 0 ? 1 : -1;
                const lsLen = (p.w - m * 2) * 0.3;
                const lsAx = cx - lsDir * lsLen / 2;
                const lsBx = cx + lsDir * lsLen / 2;
                // Horizontal slide arrow
                s += `<line x1="${lsAx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${lsBx.toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${nc}" stroke-width="1.2"/>`;
                s += `<polygon points="${lsBx.toFixed(1)},${(cy - 3).toFixed(1)} ${(lsBx + lsDir * 5).toFixed(1)},${cy.toFixed(1)} ${lsBx.toFixed(1)},${(cy + 3).toFixed(1)}" fill="${nc}"/>`;
                // Small up-arrow above the horizontal arrow to indicate lift action
                const lsLTop = cy - 12;
                s += `<line x1="${cx.toFixed(1)}" y1="${(cy - 4).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${(lsLTop + 5).toFixed(1)}" stroke="${nc}" stroke-width="1.0"/>`;
                s += `<polygon points="${cx.toFixed(1)},${lsLTop.toFixed(1)} ${(cx - 3).toFixed(1)},${(lsLTop + 5).toFixed(1)} ${(cx + 3).toFixed(1)},${(lsLTop + 5).toFixed(1)}" fill="${nc}"/>`;
                // Flush pull on meeting stile (opposite to travel direction)
                const lsPullX = lsDir === 1
                    ? p.x + sashT / 2
                    : p.x + p.w - sashT / 2;
                s += stilePull(lsPullX, cy, p.h, pullC);
                break;
            }
            case 'louvre': {
                const nLines = 4;
                const spacing = (p.h - m * 2) / (nLines + 1);
                for (let li = 1; li <= nLines; li++) {
                    const ly = y1 + spacing * li;
                    s += `<line x1="${(x1 + 4).toFixed(1)}" y1="${ly.toFixed(1)}" x2="${(x2 - 4).toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${nc}" stroke-width="0.8" opacity="0.6"/>`;
                }
                break;
            }
            default: {
                s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${nc}" stroke-width="0.7" stroke-dasharray="${nd}"/>`;
                s += `<line x1="${x2.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${nc}" stroke-width="0.7" stroke-dasharray="${nd}"/>`;
                break;
            }
        }

        // Hardware configured badge — small wrench icon in top-right when hardware is selected
        if (hwCount > 0 && !isIcon && p.w > 30 && p.h > 25) {
            const bx = p.x + p.w - 14;
            const by = p.y + 4;
            s += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="12" height="12" rx="3" fill="#D4A017" opacity="0.85"/>`;
            s += `<text x="${(bx + 6).toFixed(1)}" y="${(by + 9).toFixed(1)}" text-anchor="middle" font-size="7" font-family="'DM Mono',monospace" font-weight="700" fill="white">${hwCount}</text>`;
        }

        return s;
    }

    function drawAllPaneNotations(windowType) {
        let s = '';
        // Glass area center for spatial opening-direction resolution
        const glassMidX = gx + gw / 2;
        const glassMidY = gy + gh / 2;
        for (let i = 0; i < computedPanes.length; i++) {
            const p = computedPanes[i];
            // Tree panes carry their own config; legacy panes use paneConfigs array
            const cfg = p.config || paneConfigs?.[i] || {};
            let ot = cfg.openingType;
            if (!ot) {
                // Use pane spatial position (not index) for correct direction after splits
                const paneMidX = p.x + p.w / 2;
                const isLeftHalf = paneMidX <= glassMidX;
                const paneMidY = p.y + p.h / 2;
                const isTopHalf = paneMidY <= glassMidY;
                switch (windowType) {
                    case 'casement': ot = isLeftHalf ? 'casement-l' : 'casement-r'; break;
                    case 'sliding':
                    case 'single_slider': ot = isLeftHalf ? 'fixed' : 'sliding'; break;
                    case 'double_slider': ot = 'sliding'; break;
                    case 'end_vent_slider': ot = (i === 0 || i === computedPanes.length - 1) ? 'sliding' : 'fixed'; break;
                    case 'bifold': ot = 'bifold'; break;
                    case 'tilt_turn': ot = 'tiltturn'; break;
                    case 'awning': ot = 'awning'; break;
                    case 'single_hung': ot = isTopHalf ? 'fixed' : 'sliding'; break;
                    case 'double_hung': ot = 'sliding'; break;
                    case 'fixed_casement':
                        ot = isLeftHalf ? 'fixed' : 'casement-r';
                        break;
                    default: ot = 'fixed'; break;
                }
            }
            // Override casement direction based on explicit hingeSide config
            if (cfg.hingeSide && (ot === 'casement-l' || ot === 'casement-r')) {
                ot = cfg.hingeSide === 'right' ? 'casement-r' : 'casement-l';
            }
            s += drawPaneNotation(p, ot, i, cfg.hardwareSelections);
            s += drawPaneAccessories(p, cfg.addonSelections);

            // ── Pane label (glass type or opening type) ──
            const pcx = p.x + p.w / 2;
            const labelSize = Math.max(7, Math.min(11, Math.min(p.w, p.h) * 0.08));
            let label = '';
            if (cfg.glassSpec && cfg.glassSpec !== 'clear') {
                label = cfg.glassSpec;
            } else if (ot === 'fixed') {
                label = 'FIXED';
            } else if (ot === 'casement-l' || ot === 'casement-r') {
                const side = ot === 'casement-l' ? 'Left' : 'Right';
                label = side;
            } else if (ot === 'sliding') {
                label = 'Sliding';
            } else if (ot === 'tiltturn') {
                label = 'T&T';
            } else if (ot === 'awning') {
                label = 'Awning';
            } else if (ot === 'hopper') {
                label = 'Hopper';
            } else if (ot === 'single-hung') {
                label = 'S-Hung';
            } else if (ot === 'double-hung') {
                label = 'D-Hung';
            } else if (ot === 'pivot') {
                label = 'Pivot';
            } else if (ot === 'lift-slide') {
                label = 'L&S';
            } else if (ot === 'bifold') {
                label = 'Bi-Fold';
            } else if (ot === 'louvre') {
                label = 'Louvre';
            }
            // Glazing shortcode from inline pane config (e.g. "DG 4-16-4")
            let glazingCode = '';
            if (cfg.glazingType) {
                const typePrefix = cfg.glazingType === 'double' ? 'DG' : cfg.glazingType === 'triple' ? 'TG' : 'SG';
                const getGlassThickness = (glassKey, pos) => {
                    // Try dynamic attrs first
                    const attrs = cfg[`glass${pos}Attrs`];
                    if (attrs && glassConfigs) {
                        const gc = glassConfigs.find(g => g.glass_key === glassKey);
                        if (gc && gc.attributes && gc.attributes.length) {
                            const otAttr = gc.attributes.find(a => a.name && a.name.toUpperCase() === 'OT');
                            if (otAttr) {
                                const selId = attrs[String(otAttr.attr_id)];
                                if (selId) {
                                    const selVal = otAttr.values.find(v => v.id === selId || String(v.id) === String(selId));
                                    if (selVal) return +selVal.name;
                                }
                                // Fallback to default
                                const defVal = otAttr.values.find(v => v.id === otAttr.default_value_id);
                                if (defVal) return +defVal.name;
                            }
                        }
                        // Legacy pseudo-attrs
                        if (attrs['_ot']) return +attrs['_ot'];
                    }
                    // Legacy OT field fallback
                    const legacyOT = cfg[`glass${pos}OT`];
                    if (legacyOT) return +legacyOT;
                    if (!glassKey || !glassConfigs) return null;
                    const gc = glassConfigs.find(g => g.glass_key === glassKey);
                    return gc && gc.default_ot ? +gc.default_ot : null;
                };
                const t1 = getGlassThickness(cfg.glass1Key, 1);
                if (t1) {
                    if (cfg.glazingType === 'single') {
                        glazingCode = `${typePrefix} ${t1}`;
                    } else {
                        const cw1 = cfg.cavityWidth || 16;
                        const t2 = getGlassThickness(cfg.glass2Key, 2) || t1;
                        if (cfg.glazingType === 'triple') {
                            const cw2 = cfg.cavityWidth2 || 16;
                            const t3 = getGlassThickness(cfg.glass3Key, 3) || t1;
                            glazingCode = `${typePrefix} ${t1}-${cw1}-${t2}-${cw2}-${t3}`;
                        } else {
                            glazingCode = `${typePrefix} ${t1}-${cw1}-${t2}`;
                        }
                    }
                }
            }

            // Glass unit label below main label — use clean P/G naming
            const glassLabel = `G${i + 1}`;
            // Labels are placed at the bottom of the pane so they never collide
            // with opening-type symbols (handles, arrows, pulls) at the center.
            const hasGlazing = !!glazingCode;
            const labelY = p.y + p.h - labelSize * (hasGlazing ? 2.4 : 1.5);
            const glazingY = p.y + p.h - labelSize * 1.5;
            const glassLabelY = p.y + p.h - labelSize * 0.4;
            if (label) {
                s += `<text x="${pcx.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="'Sora',sans-serif" font-size="${labelSize.toFixed(1)}" font-weight="600" fill="rgba(0,0,0,0.45)" letter-spacing="0.5">${label}</text>`;
            }
            if (glazingCode) {
                s += `<text x="${pcx.toFixed(1)}" y="${glazingY.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="'Sora',sans-serif" font-size="${(labelSize * 0.7).toFixed(1)}" font-weight="500" fill="rgba(59,130,246,0.65)" letter-spacing="0.3">${glazingCode}</text>`;
            }
            s += `<text x="${pcx.toFixed(1)}" y="${glassLabelY.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="'Sora',sans-serif" font-size="${(labelSize * 0.75).toFixed(1)}" fill="rgba(0,0,0,0.32)">${glassLabel}</text>`;
        }

        // Notation glyphs (fixed-pane cross, casement triangles, hinges,
        // handles, sash frames, …) are drawn from each pane's rectangular
        // bounding box, so they must be clipped to the true frame outline
        // the same way the glass itself is — otherwise a "fixed" cross or
        // a sash polygon pokes past a circle/octagon/arch into the frame.
        const innerPts = shapedInnerPts();
        if (innerPts) {
            const ptsAttr = innerPts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
            const clipId = `pn${id}`;
            return (
                `<defs><clipPath id="${clipId}"><polygon points="${ptsAttr}"/></clipPath></defs>` +
                `<g clip-path="url(#${clipId})">${s}</g>`
            );
        }
        return s;
    }

    /* ── Georgian / Decorative Bars ── */

    function drawGeorgianBars() {
        if (!georgianBarConfig || !georgianBarConfig.pattern || georgianBarConfig.pattern === 'none') return '';
        const { pattern, horizontalBars = 0, verticalBars = 0, barWidthMm = 18, colour } = georgianBarConfig;
        const barCol = colour || darkenHex(frameColour, 0.85);
        const barStroke = darkenHex(barCol, 0.7);
        // Bar width in px - scale relative to pane size
        const avgPaneW = computedPanes.length > 0 ? computedPanes.reduce((a, p) => a + p.w, 0) / computedPanes.length : gw;
        const barW = Math.max(1.5, Math.min(4, avgPaneW * 0.02));

        let s = '';
        for (const p of computedPanes) {
            switch (pattern) {
                case 'grid': {
                    // Vertical bars
                    const vCount = verticalBars || 1;
                    for (let i = 1; i <= vCount; i++) {
                        const bx = p.x + (p.w * i) / (vCount + 1);
                        s += `<rect x="${(bx - barW / 2).toFixed(1)}" y="${p.y.toFixed(1)}" ` +
                             `width="${barW.toFixed(1)}" height="${p.h.toFixed(1)}" ` +
                             `fill="${barCol}" stroke="${barStroke}" stroke-width="0.3" opacity="0.85"/>`;
                    }
                    // Horizontal bars
                    const hCount = horizontalBars || 1;
                    for (let i = 1; i <= hCount; i++) {
                        const by = p.y + (p.h * i) / (hCount + 1);
                        s += `<rect x="${p.x.toFixed(1)}" y="${(by - barW / 2).toFixed(1)}" ` +
                             `width="${p.w.toFixed(1)}" height="${barW.toFixed(1)}" ` +
                             `fill="${barCol}" stroke="${barStroke}" stroke-width="0.3" opacity="0.85"/>`;
                    }
                    break;
                }
                case 'diamond': {
                    const cx = p.x + p.w / 2;
                    const cy = p.y + p.h / 2;
                    const dCount = Math.max(1, verticalBars || 2);
                    const cellW = p.w / dCount;
                    const cellH = p.h / dCount;
                    // Draw diamond lattice lines
                    for (let i = 0; i <= dCount * 2; i++) {
                        // Lines going top-left to bottom-right
                        const startX = p.x + (i - dCount) * cellW;
                        s += `<line x1="${Math.max(p.x, startX).toFixed(1)}" y1="${Math.max(p.y, p.y + (Math.max(p.x, startX) - startX) * (cellH / cellW)).toFixed(1)}" ` +
                             `x2="${Math.min(p.x + p.w, startX + dCount * cellW).toFixed(1)}" y2="${Math.min(p.y + p.h, p.y + (Math.min(p.x + p.w, startX + dCount * cellW) - startX) * (cellH / cellW)).toFixed(1)}" ` +
                             `stroke="${barCol}" stroke-width="${barW.toFixed(1)}" opacity="0.8"/>`;
                        // Lines going top-right to bottom-left
                        const startX2 = p.x + p.w - (i - dCount) * cellW;
                        s += `<line x1="${Math.max(p.x, startX2 - dCount * cellW).toFixed(1)}" y1="${Math.min(p.y + p.h, p.y + (startX2 - Math.max(p.x, startX2 - dCount * cellW)) * (cellH / cellW)).toFixed(1)}" ` +
                             `x2="${Math.min(p.x + p.w, startX2).toFixed(1)}" y2="${Math.max(p.y, p.y + (startX2 - Math.min(p.x + p.w, startX2)) * (cellH / cellW)).toFixed(1)}" ` +
                             `stroke="${barCol}" stroke-width="${barW.toFixed(1)}" opacity="0.8"/>`;
                    }
                    break;
                }
                case 'sunburst': {
                    const cx = p.x + p.w / 2;
                    const topY = p.y;
                    const rays = Math.max(3, (verticalBars || 5) + (horizontalBars || 0));
                    // Rays emanate from top-center outward
                    for (let i = 0; i < rays; i++) {
                        const angle = Math.PI * (0.15 + 0.7 * i / (rays - 1));
                        const endX = cx + Math.cos(angle) * p.w * 0.6;
                        const endY = topY + Math.sin(angle) * p.h * 0.9;
                        const rectClampedX = Math.max(p.x, Math.min(p.x + p.w, endX));
                        const rectClampedY = Math.max(p.y, Math.min(p.y + p.h, endY));
                        const [clampedX, clampedY] = clampRayToShape(cx, topY, rectClampedX, rectClampedY);
                        s += `<line x1="${cx.toFixed(1)}" y1="${topY.toFixed(1)}" ` +
                             `x2="${clampedX.toFixed(1)}" y2="${clampedY.toFixed(1)}" ` +
                             `stroke="${barCol}" stroke-width="${barW.toFixed(1)}" opacity="0.8"/>`;
                    }
                    // Decorative "Top arch" flourish — only meaningful on a
                    // rectangular frame (it's meant to suggest an arch on an
                    // otherwise flat-topped window). Its control point sits
                    // above the pane's own top edge by design, which would
                    // extend past the real curve — and potentially past the
                    // window's actual peak entirely — on a frame that's
                    // already arched/gothic/etc., so skip it there.
                    if (!isShapedFrame(frameShape)) {
                        const archR = p.w * 0.35;
                        s += `<path d="M${p.x.toFixed(1)},${(topY + archR * 0.5).toFixed(1)} ` +
                             `Q${cx.toFixed(1)},${(topY - archR * 0.3).toFixed(1)} ` +
                             `${(p.x + p.w).toFixed(1)},${(topY + archR * 0.5).toFixed(1)}" ` +
                             `fill="none" stroke="${barCol}" stroke-width="${barW.toFixed(1)}" opacity="0.8"/>`;
                    }
                    break;
                }
                case 'prairie': {
                    // Prairie style: bars only around the perimeter, leaving center open
                    const inset = Math.min(p.w, p.h) * 0.25;
                    // Top horizontal
                    s += `<rect x="${p.x.toFixed(1)}" y="${(p.y + inset - barW / 2).toFixed(1)}" ` +
                         `width="${p.w.toFixed(1)}" height="${barW.toFixed(1)}" ` +
                         `fill="${barCol}" stroke="${barStroke}" stroke-width="0.3" opacity="0.85"/>`;
                    // Bottom horizontal
                    s += `<rect x="${p.x.toFixed(1)}" y="${(p.y + p.h - inset - barW / 2).toFixed(1)}" ` +
                         `width="${p.w.toFixed(1)}" height="${barW.toFixed(1)}" ` +
                         `fill="${barCol}" stroke="${barStroke}" stroke-width="0.3" opacity="0.85"/>`;
                    // Left vertical
                    s += `<rect x="${(p.x + inset - barW / 2).toFixed(1)}" y="${p.y.toFixed(1)}" ` +
                         `width="${barW.toFixed(1)}" height="${p.h.toFixed(1)}" ` +
                         `fill="${barCol}" stroke="${barStroke}" stroke-width="0.3" opacity="0.85"/>`;
                    // Right vertical
                    s += `<rect x="${(p.x + p.w - inset - barW / 2).toFixed(1)}" y="${p.y.toFixed(1)}" ` +
                         `width="${barW.toFixed(1)}" height="${p.h.toFixed(1)}" ` +
                         `fill="${barCol}" stroke="${barStroke}" stroke-width="0.3" opacity="0.85"/>`;
                    break;
                }
                case 'marginal': {
                    // Marginal bars: single bar near each edge
                    const margin = Math.min(p.w, p.h) * 0.15;
                    // Top
                    s += `<rect x="${p.x.toFixed(1)}" y="${(p.y + margin - barW / 2).toFixed(1)}" ` +
                         `width="${p.w.toFixed(1)}" height="${barW.toFixed(1)}" ` +
                         `fill="${barCol}" stroke="${barStroke}" stroke-width="0.3" opacity="0.85"/>`;
                    // Bottom
                    s += `<rect x="${p.x.toFixed(1)}" y="${(p.y + p.h - margin - barW / 2).toFixed(1)}" ` +
                         `width="${p.w.toFixed(1)}" height="${barW.toFixed(1)}" ` +
                         `fill="${barCol}" stroke="${barStroke}" stroke-width="0.3" opacity="0.85"/>`;
                    break;
                }
            }
        }
        return s;
    }

    /* Note: bay/bow 3D iso renderer is now at module scope (renderBayBow3DInset)
       and surfaced via the WincraftIso3DDialog popup component. The canvas
       only shows a small "3D ▸" button on the bay/bow elevation. */

    /* ── Build type-specific content ── */

    let inner = '';

    switch (type) {
        case 'casement': {
            inner += frame();
            inner += paneGrid();
            inner += drawAllPaneNotations('casement');
            inner += renderSelection();
            inner += drawFrameSegmentLabels();
            break;
        }
        case 'sliding': {
            inner += frame();
            inner += paneGrid();
            inner += drawAllPaneNotations('sliding');
            inner += renderSelection();
            inner += drawFrameSegmentLabels();
            break;
        }
        case 'fixed': {
            inner += frame();
            inner += paneGrid();
            inner += drawAllPaneNotations('fixed');
            inner += renderSelection();
            inner += drawFrameSegmentLabels();
            break;
        }
        case 'bifold': {
            inner += frame();
            inner += paneGrid();
            inner += drawAllPaneNotations('bifold');
            inner += renderSelection();
            inner += drawFrameSegmentLabels();
            break;
        }
        case 'awning': {
            inner += frame();
            inner += paneGrid();
            inner += drawAllPaneNotations('awning');
            inner += renderSelection();
            inner += drawFrameSegmentLabels();
            break;
        }
        case 'arched': {
            const archH = Math.min(W * 0.35, H * 0.33);
            const bodyY = F + archH;
            const bodyH = H - F - bodyY;

            // Outer frame (arched top + rectangular bottom)
            inner += `<path d="M0,${H} L0,${(archH + F).toFixed(1)} Q0,0 ${(W / 2).toFixed(1)},0 Q${W},0 ${W},${(archH + F).toFixed(1)} L${W},${H} Z" fill="${frameColour}" stroke="${dark}" stroke-width="2"/>`;

            // Arch glass (curved top section)
            inner += `<path d="M${F},${bodyY.toFixed(1)} Q${F},${F} ${(W / 2).toFixed(1)},${F} Q${(F + gw).toFixed(1)},${F} ${(F + gw).toFixed(1)},${bodyY.toFixed(1)} Z" fill="rgba(168,216,240,${glassOpacity.toFixed(2)})" stroke="rgba(100,160,200,0.4)" stroke-width="1"/>`;

            // Radial fan bars in arch section
            const radialCount = Math.max(3, Math.min(7, Math.round(gw / 25)));
            const archCx = W / 2;
            const archCy = bodyY;  // centre of radial bars (at transom level)
            const archRadius = gw / 2;
            for (let i = 1; i < radialCount; i++) {
                const angle = Math.PI * i / radialCount;
                const ex = archCx - archRadius * Math.cos(angle);
                const ey = archCy - archRadius * Math.sin(angle) * (archH / (gw / 2));
                inner += `<line x1="${archCx.toFixed(1)}" y1="${archCy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${Math.max(F, ey).toFixed(1)}" stroke="${dark}" stroke-width="1" opacity="0.35"/>`;
            }

            // Highlight
            inner += `<ellipse cx="${(W / 2 - gw * 0.15).toFixed(1)}" cy="${(bodyY - archH * 0.3).toFixed(1)}" rx="6" ry="3" fill="white" opacity="0.2"/>`;

            // Transom bar (divider between arch and body)
            inner += `<rect x="${F.toFixed(1)}" y="${(bodyY - 2).toFixed(1)}" width="${gw.toFixed(1)}" height="4" fill="${frameColour}" stroke="${dark}" stroke-width="0.8" rx="0.5"/>`;

            // Body glass section below the arch
            if (bodyH > 0) {
                inner += glass(gx, bodyY + 2, gw, bodyH - 2);
                inner += fixedX(W / 2, bodyY + 2 + (bodyH - 2) / 2, 0, gw, bodyH - 2);
            }
            break;
        }
        case 'bay': {
            /* ── Industry-standard bay window — elevation + plan inset ──
               Geometry:
                 angle θ (centre↔flanker), n lites, centre ratio (3-lite case).
                 In elevation we project each lite to its visible width
                 (chord × cos θ_lite), giving the splay illusion correctly.
                 Each lite is drawn as a real pane with its own glass +
                 opening notation, so the per-pane editor controls work. */
            const n = Math.max(2, Math.min(bayLiteCount || nH || 3, 6));
            const angleDeg = bayAngle === 'custom' ? (bayAngleCustomDeg || 45) : parseFloat(bayAngle);
            const theta = angleDeg * Math.PI / 180;

            // Compute lite chord widths in real mm (custom widths override when set)
            const realW = widthMm || 1;
            const liteChords = computeBayBowChords({
                type: 'bay', n, widthMm: realW, bayCentreRatio, bayLiteWidths,
            });

            // Each lite's apparent width on the elevation = chord × cos(α_i)
            // where α_i is the lite's angle relative to the wall plane.
            // For bay: outermost lites at θ, centre at 0 (3-lite); for n>3, distributed.
            const liteAngles = [];
            if (n === 3) {
                liteAngles.push(theta, 0, theta);
            } else {
                const half = (n - 1) / 2;
                for (let i = 0; i < n; i++) {
                    liteAngles.push(Math.abs(i - half) * theta / half);
                }
            }

            // Apparent widths
            const apparent = liteChords.map((c, i) => c * Math.cos(liteAngles[i]));
            const apparentTotal = apparent.reduce((a, b) => a + b, 0) || 1;
            // Scale each apparent width to fit gw
            const scaleK = gw / apparentTotal;
            const liteW = apparent.map(a => a * scaleK);

            // Frame band
            inner += `<rect x="0" y="0" width="${W}" height="${H}" rx="3" fill="${frameColour}" stroke="${dark}" stroke-width="2"/>`;
            inner += `<rect x="${F}" y="${F}" width="${gw}" height="${gh}" fill="none" stroke="${dark}" stroke-width="0.6" opacity="0.4"/>`;

            const mullW = Math.max(3, F * 0.5);
            const paneConfigsArr = paneConfigs || [];

            // Draw each lite
            let cx = gx;
            for (let i = 0; i < n; i++) {
                const lw = liteW[i] - (i < n - 1 ? mullW : 0);
                const tint = (paneConfigsArr[i] && paneConfigsArr[i].glassTint) || 'clear';
                inner += `<rect x="${cx.toFixed(1)}" y="${gy.toFixed(1)}" width="${lw.toFixed(1)}" height="${gh.toFixed(1)}" fill="${frameColour}" stroke="${dark}" stroke-width="1.2"/>`;
                inner += glass(cx + 3, gy + 3, lw - 6, gh - 6, tint);

                // Opening direction indicator (X = fixed, /\ = casement, etc.)
                const ot = (paneConfigsArr[i] && paneConfigsArr[i].openingType) || 'fixed';
                const cxc = cx + lw / 2;
                const cyc = gy + gh / 2;
                if (ot === 'fixed') {
                    inner += `<line x1="${(cx + 6).toFixed(1)}" y1="${(gy + 6).toFixed(1)}" x2="${(cx + lw - 6).toFixed(1)}" y2="${(gy + gh - 6).toFixed(1)}" stroke="${dark}" stroke-width="0.8" opacity="0.4"/>`;
                    inner += `<line x1="${(cx + lw - 6).toFixed(1)}" y1="${(gy + 6).toFixed(1)}" x2="${(cx + 6).toFixed(1)}" y2="${(gy + gh - 6).toFixed(1)}" stroke="${dark}" stroke-width="0.8" opacity="0.4"/>`;
                } else if (ot === 'casement-l' || ot === 'casement-r') {
                    const apex = ot === 'casement-l' ? (cx + lw - 6) : (cx + 6);
                    inner += `<polyline points="${(cx + 6).toFixed(1)},${(gy + gh - 6).toFixed(1)} ${apex.toFixed(1)},${(gy + 6).toFixed(1)} ${(cx + lw - 6).toFixed(1)},${(gy + gh - 6).toFixed(1)}" fill="none" stroke="${dark}" stroke-width="1" opacity="0.55"/>`;
                } else if (ot === 'awning') {
                    inner += `<polyline points="${(cx + 6).toFixed(1)},${(gy + gh - 6).toFixed(1)} ${cxc.toFixed(1)},${(gy + 6).toFixed(1)} ${(cx + lw - 6).toFixed(1)},${(gy + gh - 6).toFixed(1)}" fill="none" stroke="${dark}" stroke-width="1" opacity="0.55"/>`;
                }

                // Lite label (L1, L2…) at bottom — width is shown in the
                // chained dimension chain above the elevation.
                inner += `<text x="${cxc.toFixed(1)}" y="${(gy + gh - 4).toFixed(1)}" font-family="'DM Mono',monospace" font-size="9" fill="${dark}" text-anchor="middle" opacity="0.75">L${i + 1}</text>`;

                cx += lw;
                // Mulling post
                if (i < n - 1) {
                    inner += `<rect x="${cx.toFixed(1)}" y="${gy.toFixed(1)}" width="${mullW.toFixed(1)}" height="${gh.toFixed(1)}" fill="${dark}" opacity="0.85"/>`;
                    cx += mullW;
                }
            }

            // 3D view button has been moved to the canvas toolbar (next to Fit to View).
            break;
        }
        case 'bow': {
            /* ── Industry-standard bow window — radial arc layout ──
               Each lite spans an equal arc (user-configurable, default 10°/lite).
               Elevation: lites drawn equal-width on the chord (visual abstraction);
               Plan inset shows the true arc with radius and projection. */
            const n = Math.max(3, Math.min(bayLiteCount || nH || 5, 8));
            const degPerLite = bowAngleDeg === 'custom' ? (bowAngleCustomDeg || 10) : parseFloat(bowAngleDeg);
            const thetaPerLite = degPerLite * Math.PI / 180;
            const phi = (n - 1) * thetaPerLite;
            const realW = widthMm || 1;
            const radius = bowRadiusMm || ((realW / 2) / Math.sin(phi / 2 || 0.0001));
            const projMm = bayProjectionMm || (radius * (1 - Math.cos(phi / 2)));

            inner += `<rect x="0" y="0" width="${W}" height="${H}" rx="3" fill="${frameColour}" stroke="${dark}" stroke-width="2"/>`;
            inner += `<rect x="${F}" y="${F}" width="${gw}" height="${gh}" fill="none" stroke="${dark}" stroke-width="0.6" opacity="0.4"/>`;

            const mullW = Math.max(3, F * 0.45);
            const totalMull = (n - 1) * mullW;
            const liteChordsBow = computeBayBowChords({
                type: 'bow', n, widthMm: realW, bayLiteWidths,
            });
            const chordTotal = liteChordsBow.reduce((a, b) => a + b, 0) || realW;
            const liteWArr = liteChordsBow.map(c => (c / chordTotal) * (gw - totalMull));
            const paneConfigsArr = paneConfigs || [];

            let cx = gx;
            for (let i = 0; i < n; i++) {
                const liteW = liteWArr[i];
                const tint = (paneConfigsArr[i] && paneConfigsArr[i].glassTint) || 'clear';
                inner += `<rect x="${cx.toFixed(1)}" y="${gy.toFixed(1)}" width="${liteW.toFixed(1)}" height="${gh.toFixed(1)}" fill="${frameColour}" stroke="${dark}" stroke-width="1.2"/>`;
                inner += glass(cx + 3, gy + 3, liteW - 6, gh - 6, tint);
                const ot = (paneConfigsArr[i] && paneConfigsArr[i].openingType) || 'fixed';
                const cxc = cx + liteW / 2;
                if (ot === 'fixed') {
                    inner += `<line x1="${(cx + 6).toFixed(1)}" y1="${(gy + 6).toFixed(1)}" x2="${(cx + liteW - 6).toFixed(1)}" y2="${(gy + gh - 6).toFixed(1)}" stroke="${dark}" stroke-width="0.8" opacity="0.4"/>`;
                    inner += `<line x1="${(cx + liteW - 6).toFixed(1)}" y1="${(gy + 6).toFixed(1)}" x2="${(cx + 6).toFixed(1)}" y2="${(gy + gh - 6).toFixed(1)}" stroke="${dark}" stroke-width="0.8" opacity="0.4"/>`;
                } else if (ot === 'casement-l' || ot === 'casement-r') {
                    const apex = ot === 'casement-l' ? (cx + liteW - 6) : (cx + 6);
                    inner += `<polyline points="${(cx + 6).toFixed(1)},${(gy + gh - 6).toFixed(1)} ${apex.toFixed(1)},${(gy + 6).toFixed(1)} ${(cx + liteW - 6).toFixed(1)},${(gy + gh - 6).toFixed(1)}" fill="none" stroke="${dark}" stroke-width="1" opacity="0.55"/>`;
                }
                inner += `<text x="${cxc.toFixed(1)}" y="${(gy + gh - 4).toFixed(1)}" font-family="'DM Mono',monospace" font-size="9" fill="${dark}" text-anchor="middle" opacity="0.75">L${i + 1}</text>`;
                cx += liteW;
                if (i < n - 1) {
                    inner += `<rect x="${cx.toFixed(1)}" y="${gy.toFixed(1)}" width="${mullW.toFixed(1)}" height="${gh.toFixed(1)}" fill="${dark}" opacity="0.85"/>`;
                    cx += mullW;
                }
            }

            // Arc indicator across the top of the elevation
            inner += `<path d="M${(gx + 4).toFixed(1)},${(gy + 8).toFixed(1)} Q${(W / 2).toFixed(1)},${(gy - 4).toFixed(1)} ${(gx + gw - 4).toFixed(1)},${(gy + 8).toFixed(1)}" fill="none" stroke="${dark}" stroke-width="1.2" opacity="0.55" stroke-dasharray="3 2"/>`;

            // 3D view button has been moved to the canvas toolbar (next to Fit to View).
            break;
        }
        case 'tilt_turn': {
            inner += frame();
            inner += paneGrid();
            inner += drawAllPaneNotations('tilt_turn');
            inner += renderSelection();
            inner += drawFrameSegmentLabels();
            break;
        }
        case 'single_hung': {
            inner += frame();
            inner += paneGrid();
            inner += drawAllPaneNotations('single_hung');
            inner += renderSelection();
            inner += drawFrameSegmentLabels();
            break;
        }
        case 'double_hung': {
            inner += frame();
            inner += paneGrid();
            inner += drawAllPaneNotations('double_hung');
            inner += renderSelection();
            inner += drawFrameSegmentLabels();
            break;
        }
        case 'single_slider': {
            inner += frame();
            inner += paneGrid();
            inner += drawAllPaneNotations('single_slider');
            inner += renderSelection();
            inner += drawFrameSegmentLabels();
            break;
        }
        case 'double_slider': {
            inner += frame();
            inner += paneGrid();
            inner += drawAllPaneNotations('double_slider');
            inner += renderSelection();
            inner += drawFrameSegmentLabels();
            break;
        }
        case 'end_vent_slider': {
            inner += frame();
            inner += paneGrid();
            inner += drawAllPaneNotations('end_vent_slider');
            inner += renderSelection();
            inner += drawFrameSegmentLabels();
            break;
        }
        case 'fixed_casement': {
            inner += frame();
            inner += paneGrid();
            inner += drawAllPaneNotations('fixed_casement');
            inner += renderSelection();
            inner += drawFrameSegmentLabels();
            break;
        }
        case 'custom': {
            inner += frame();
            inner += paneGrid();
            inner += drawAllPaneNotations('custom');
            inner += renderSelection();
            inner += drawFrameSegmentLabels();
            break;
        }
        default: {
            // Any window_type key not covered above — every admin-defined
            // Window Type (WS-5) and every CSV-imported type (WS-7) uses an
            // arbitrary `key`, not one of the built-in strings this switch
            // hardcodes. This used to render a single flat, undivided glass
            // pane with one decorative "X", silently discarding the real
            // panel_tree/pane_configs design. drawAllPaneNotations() already
            // handles an unrecognised type gracefully (falls back to 'fixed'
            // only for panes with no explicit openingType), so route custom
            // types through the same rendering every built-in type uses.
            inner += frame();
            inner += paneGrid();
            inner += drawAllPaneNotations(type);
            inner += renderSelection();
            inner += drawFrameSegmentLabels();
            break;
        }
    }

    /* ── Icon mode: return raw content only ── */
    if (isIcon) return inner;

    /* ── Dimension arrows — Fixed screen-pixel sizes ── */
    /* All sizes are constant in screen pixels (1 SVG unit = 1 screen pixel
       because viewBox matches width/height).  Values never change with zoom. */
    const dimCol = '#64748b';            // slate-500 — neutral, professional
    const dimTxt = '#334155';            // slate-700 — readable but not loud
    const font   = "'DM Mono',monospace";
    const dimFS  = 11;                   // font size — always 11px on screen
    const dimFW  = '500';               // font weight — medium
    const extGap = 5;                    // gap between frame edge and extension line
    const arrOff = 28;                   // arrow line offset from frame edge
    const tick   = 3;                    // arrowhead half-size
    const dimLW  = 0.8;                  // dimension line stroke width
    const extLW  = 0.5;                  // extension line stroke width
    const pillPadY = 2;

    let dims = '';
    let bayBowChordMm = null; // populated below for bay/bow so dim chain shows real chord widths

    /* ── Helper: draw a single dimension between two points ── */
    function dimLine(ax, ay, bx, by, valueMm, rotated, extDir, dimType, dimIndex, extraData) {
        let d = '';
        const len = rotated ? Math.abs(by - ay) : Math.abs(bx - ax);
        if (len < 2) return '';
        const vTxt = unitSystem === 'imperial'
            ? formatInchesAsFraction(mmToInch(valueMm))
            : String(Math.round(valueMm));
        const gapW = vTxt.length * 5.5 + 8;
        const editable = true;  // all dimensions are now editable
        const dimCls = `wc-dim-label wc-dim-editable`;
        let dataExtra = '';
        if (extraData) {
            for (const [k, v] of Object.entries(extraData)) {
                if (v != null) dataExtra += ` data-dim-${k}="${v}"`;
            }
        }
        const dimAttrs = `class="${dimCls}" data-dim-type="${dimType || ''}" data-dim-index="${dimIndex ?? ''}" data-dim-value="${Math.round(valueMm)}"${dataExtra}`;
        const pillFill = 'rgba(255,255,255,0.92)';
        const pillStroke = `stroke="${dimCol}" stroke-width="0.5" stroke-opacity="0.3"`;

        if (rotated) {
            // Vertical dimension (height)  |  style: ├─────── value ───────┤
            const mx = ax, my1 = Math.min(ay, by), my2 = Math.max(ay, by);
            const midPt = (my1 + my2) / 2;
            const gT = midPt - gapW / 2, gB = midPt + gapW / 2;
            // Dimension line segments (with gap for text)
            d += `<line x1="${mx.toFixed(1)}" y1="${my1.toFixed(1)}" x2="${mx.toFixed(1)}" y2="${Math.max(my1, gT).toFixed(1)}" stroke="${dimCol}" stroke-width="${dimLW}"/>`;
            d += `<line x1="${mx.toFixed(1)}" y1="${Math.min(my2, gB).toFixed(1)}" x2="${mx.toFixed(1)}" y2="${my2.toFixed(1)}" stroke="${dimCol}" stroke-width="${dimLW}"/>`;
            // Tick marks at endpoints (horizontal bars: ├ at top, ┤ at bottom)
            d += `<line x1="${(mx - tick).toFixed(1)}" y1="${my1.toFixed(1)}" x2="${(mx + tick).toFixed(1)}" y2="${my1.toFixed(1)}" stroke="${dimCol}" stroke-width="${dimLW + 0.3}"/>`;
            d += `<line x1="${(mx - tick).toFixed(1)}" y1="${my2.toFixed(1)}" x2="${(mx + tick).toFixed(1)}" y2="${my2.toFixed(1)}" stroke="${dimCol}" stroke-width="${dimLW + 0.3}"/>`;
            // Interactive pill (vertical orientation — narrow width, tall height, no rotation)
            const pillNarrow = dimFS + pillPadY * 2;
            const pillTall = gapW;
            d += `<g ${dimAttrs} style="cursor:${editable ? 'pointer' : 'default'}">`;
            d += `<rect x="${(mx - pillNarrow / 2).toFixed(1)}" y="${(midPt - pillTall / 2).toFixed(1)}" width="${pillNarrow.toFixed(1)}" height="${pillTall.toFixed(1)}" rx="3" fill="${pillFill}" ${pillStroke} class="wc-dim-pill"/>`;
            // Text rotated -90° (reads bottom-to-top, standard engineering convention)
            d += `<text x="${mx.toFixed(1)}" y="${midPt.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="${font}" font-size="${dimFS}" font-weight="${dimFW}" font-style="normal" fill="${dimTxt}" transform="rotate(-90,${mx.toFixed(1)},${midPt.toFixed(1)})">${vTxt}</text>`;
            d += `</g>`;
        } else {
            // Horizontal dimension (width)  style: ├─────── value ───────┤
            const my = ay, mx1 = Math.min(ax, bx), mx2 = Math.max(ax, bx);
            const midPt = (mx1 + mx2) / 2;
            const gL = midPt - gapW / 2, gR = midPt + gapW / 2;
            // Dimension line segments (with gap for text)
            d += `<line x1="${mx1.toFixed(1)}" y1="${my.toFixed(1)}" x2="${Math.max(mx1, gL).toFixed(1)}" y2="${my.toFixed(1)}" stroke="${dimCol}" stroke-width="${dimLW}"/>`;
            d += `<line x1="${Math.min(mx2, gR).toFixed(1)}" y1="${my.toFixed(1)}" x2="${mx2.toFixed(1)}" y2="${my.toFixed(1)}" stroke="${dimCol}" stroke-width="${dimLW}"/>`;
            // Tick marks at endpoints (vertical bars: |── at left, ──| at right)
            d += `<line x1="${mx1.toFixed(1)}" y1="${(my - tick).toFixed(1)}" x2="${mx1.toFixed(1)}" y2="${(my + tick).toFixed(1)}" stroke="${dimCol}" stroke-width="${dimLW + 0.3}"/>`;
            d += `<line x1="${mx2.toFixed(1)}" y1="${(my - tick).toFixed(1)}" x2="${mx2.toFixed(1)}" y2="${(my + tick).toFixed(1)}" stroke="${dimCol}" stroke-width="${dimLW + 0.3}"/>`;
            // Interactive pill+text group
            const pillW = gapW, pillH = dimFS + pillPadY * 2;
            d += `<g ${dimAttrs} style="cursor:${editable ? 'pointer' : 'default'}">`;
            d += `<rect x="${(midPt - pillW / 2).toFixed(1)}" y="${(my - 3 - pillH).toFixed(1)}" width="${pillW.toFixed(1)}" height="${pillH.toFixed(1)}" rx="3" fill="${pillFill}" ${pillStroke} class="wc-dim-pill"/>`;
            d += `<text x="${midPt.toFixed(1)}" y="${(my - 3).toFixed(1)}" text-anchor="middle" font-family="${font}" font-size="${dimFS}" font-weight="${dimFW}" font-style="normal" fill="${dimTxt}">${vTxt}</text>`;
            d += `</g>`;
        }
        return d;
    }

    /* ── Helper: extension line (dashed) ── */
    function extLine(x1, y1, x2, y2) {
        return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${dimCol}" stroke-width="${extLW}" stroke-dasharray="3,2" stroke-opacity="0.6"/>`;
    }

    if (widthMm && heightMm) {
        // Correct mm-per-pixel ratios for the glass area (where panes live)
        const glassMMpxH = widthMm / gw;
        const glassMMpxV = heightMm / gh;

        /* ── Build section boundaries ── */
        // Tree path: divider center positions → no mullion-gap noise
        // Legacy path: pane edges with close-edge merging
        // Bay/Bow path: chord-derived lite boundaries (pixel scale matches the
        //   per-type renderer above, so the chained dimension chain lines up
        //   tick-perfect with each glass lite below it)
        // colDividers / rowDividers: { px, id, posMm } for each divider boundary
        let colBounds, rowBounds, colDividers = [], rowDividers = [];
        if (type === 'bay' || type === 'bow') {
            // Recompute the same per-lite pixel widths the renderer used.
            const minN = type === 'bow' ? 3 : 2;
            const maxN = type === 'bow' ? 8 : 6;
            const defaultN = type === 'bow' ? 5 : 3;
            const n = Math.max(minN, Math.min(bayLiteCount || defaultN, maxN));
            const chords = computeBayBowChords({
                type, n, widthMm, bayCentreRatio, bayLiteWidths,
            });
            let pixelWidths;
            if (type === 'bow') {
                const mullW = Math.max(3, F * 0.45);
                const totalMull = (n - 1) * mullW;
                const chordTotal = chords.reduce((a, b) => a + b, 0) || 1;
                pixelWidths = chords.map(c => (c / chordTotal) * (gw - totalMull));
            } else {
                const angleDeg = bayAngle === 'custom' ? (bayAngleCustomDeg || 45) : parseFloat(bayAngle);
                const theta = angleDeg * Math.PI / 180;
                const liteAngles = (n === 3)
                    ? [theta, 0, theta]
                    : Array.from({ length: n }, (_, i) => Math.abs(i - (n - 1) / 2) * theta / ((n - 1) / 2));
                const apparent = chords.map((c, i) => c * Math.cos(liteAngles[i]));
                const apparentTotal = apparent.reduce((a, b) => a + b, 0) || 1;
                pixelWidths = apparent.map(a => a / apparentTotal * gw);
            }
            const mullW = type === 'bow' ? Math.max(3, F * 0.45) : Math.max(3, F * 0.5);
            // Chain of inner boundaries — left frame edge → after each lite (and
            // after each mullion) → right frame edge. We want one dim segment
            // per lite, so we use pairs (lite-start, lite-end) and skip the
            // mullion intervals visually by collapsing them into the lite ticks.
            // Simplest: emit a tick at the LEFT edge of each lite plus the
            // right edge of the last one. Mullions are shown as narrow gaps in
            // the dimension chain (matching the canvas mullion bars).
            const bounds = [gx];
            let cx = gx;
            for (let i = 0; i < n; i++) {
                cx += pixelWidths[i];
                bounds.push(cx);
                if (i < n - 1) cx += mullW;
            }
            colBounds = bounds;
            // Per-lite chord values (real mm) live alongside pixel boundaries
            // so the dimLine can show "600 / 1200 / 600" rather than the
            // pixel-back-projected mm — bay/bow chord ≠ apparent width.
            colDividers = bounds.slice(1, -1).map((px, i) => ({
                px,
                id: `lite-mull-${i}`,
                posMm: chords.slice(0, i + 1).reduce((a, b) => a + b, 0),
            }));
            rowBounds = [gy, gy + gh];
            bayBowChordMm = chords.map(c => Math.round(c));
        } else if (_treeDividerLines.length > 0) {
            const vDivs = _treeDividerLines
                .filter(d => d.direction === 'vertical').map(d => ({ px: d.position, id: d.id, posMm: d.positionMm }));
            const hDivs = _treeDividerLines
                .filter(d => d.direction === 'horizontal').map(d => ({ px: d.position, id: d.id, posMm: d.positionMm }));
            // Deduplicate dividers at nearly the same position (from different rows/cols)
            const dedupSortObj = (arr, thr) => {
                if (!arr.length) return [];
                const s = [...arr].sort((a, b) => a.px - b.px);
                const r = [s[0]];
                for (let i = 1; i < s.length; i++) {
                    if (s[i].px - r[r.length - 1].px > thr) r.push(s[i]);
                }
                return r;
            };
            colDividers = dedupSortObj(vDivs, S * 2);
            rowDividers = dedupSortObj(hDivs, S * 2);
            colBounds = [gx, ...colDividers.map(d => d.px), gx + gw];
            rowBounds = [gy, ...rowDividers.map(d => d.px), gy + gh];
        } else {
            // Legacy: collect pane edges and merge close pairs (mullion sides → center)
            const collect = (axis) => {
                const edges = new Set();
                for (const p of computedPanes) {
                    edges.add(Math.round(axis === 'x' ? p.x : p.y));
                    edges.add(Math.round(axis === 'x' ? p.x + p.w : p.y + p.h));
                }
                const sorted = [...edges].sort((a, b) => a - b);
                if (sorted.length <= 2) return sorted;
                const merged = [sorted[0]];
                for (let i = 1; i < sorted.length; i++) {
                    if (sorted[i] - merged[merged.length - 1] <= S * 1.5) {
                        merged[merged.length - 1] = (merged[merged.length - 1] + sorted[i]) / 2;
                    } else {
                        merged.push(sorted[i]);
                    }
                }
                return merged;
            };
            colBounds = collect('x');
            rowBounds = collect('y');
        }

        const hasColSections = colBounds.length > 2;
        const hasRowSections = rowBounds.length > 2;

        /* ── TOP: Width dimension(s) ── */
        if (hasColSections) {
            const secDimY = -arrOff;
            const totalTopY = secDimY - 20;
            // Overall width (above sections)
            dims += extLine(0, 0, 0, totalTopY - extGap);
            dims += extLine(W, 0, W, totalTopY - extGap);
            dims += dimLine(0, totalTopY, W, totalTopY, widthMm, false, 'up', 'overall-width');
            // Per-section widths
            for (const cx of colBounds) {
                dims += extLine(cx, 0, cx, secDimY - extGap);
            }
            for (let i = 0; i < colBounds.length - 1; i++) {
                const lx = colBounds[i], rx = colBounds[i + 1];
                const secWidthMm = bayBowChordMm
                    ? bayBowChordMm[i]
                    : Math.round((rx - lx) * glassMMpxH);
                if (secWidthMm > 0) {
                    // left-divider id (null for frame edge) and right-divider id
                    const ldiv = i > 0 ? colDividers[i - 1] : null;
                    const rdiv = i < colDividers.length ? colDividers[i] : null;
                    dims += dimLine(lx, secDimY, rx, secDimY, secWidthMm, false, 'up', 'section-width', i,
                        { ldiv: ldiv?.id, rdiv: rdiv?.id, lmm: ldiv?.posMm, rmm: rdiv?.posMm });
                }
            }
        } else {
            const topDimY = -arrOff;
            dims += extLine(0, 0, 0, topDimY - extGap);
            dims += extLine(W, 0, W, topDimY - extGap);
            dims += dimLine(0, topDimY, W, topDimY, widthMm, false, 'up', 'overall-width');
        }

        /* ── RIGHT: Per-section heights (only if multiple rows) ── */
        if (hasRowSections) {
            const rightDimX = W + arrOff;
            for (const ry of rowBounds) {
                dims += extLine(W, ry, rightDimX + extGap, ry);
            }
            for (let i = 0; i < rowBounds.length - 1; i++) {
                const ty = rowBounds[i], by = rowBounds[i + 1];
                const secHeightMm = Math.round((by - ty) * glassMMpxV);
                if (secHeightMm > 0) {
                    const tdiv = i > 0 ? rowDividers[i - 1] : null;
                    const bdiv = i < rowDividers.length ? rowDividers[i] : null;
                    dims += dimLine(rightDimX, ty, rightDimX, by, secHeightMm, true, 'right', 'section-height', i,
                        { ldiv: tdiv?.id, rdiv: bdiv?.id, lmm: tdiv?.posMm, rmm: bdiv?.posMm });
                }
            }
        }

        /* ── LEFT: Overall height (always) ── */
        const leftDimX = -arrOff;
        dims += extLine(0, 0, leftDimX - extGap, 0);
        dims += extLine(0, H, leftDimX - extGap, H);
        dims += dimLine(leftDimX, 0, leftDimX, H, heightMm, true, 'left', 'overall-height');

        /* ── Arch/Gothic Rise (springline → peak) ──
           Real shop drawings quote an arch by Width + Rise, not just the
           overall bounding box. Drawn inside the frame near the peak
           (not in the side margins) so it never collides with the width/
           height dimension chains above. */
        if (frameShape === 'arched' || frameShape === 'gothic') {
            const archRPx = getArchRise(frameShape, W, H);
            if (archRPx > 4) {
                const riseMm = Math.round(archRPx * (heightMm / H));
                const riseX = W / 2;
                dims += extLine(riseX, 0, riseX, archRPx);
                dims += `<line x1="${(riseX - tick).toFixed(1)}" y1="0" x2="${(riseX + tick).toFixed(1)}" y2="0" stroke="${dimCol}" stroke-width="${dimLW + 0.3}"/>`;
                dims += `<line x1="${(riseX - tick).toFixed(1)}" y1="${archRPx.toFixed(1)}" x2="${(riseX + tick).toFixed(1)}" y2="${archRPx.toFixed(1)}" stroke="${dimCol}" stroke-width="${dimLW + 0.3}"/>`;
                dims += `<text x="${(riseX + 8).toFixed(1)}" y="${(archRPx / 2).toFixed(1)}" dominant-baseline="central" font-family="${font}" font-size="${(dimFS - 1)}" font-weight="${dimFW}" fill="${dimTxt}">Rise ${riseMm}</text>`;
            }
        }
    }

    // Fabricated stamp
    let stamp = '';
    if (fabricated) {
        const cx = W / 2, cy = H / 2;
        stamp = `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="14" font-weight="bold" fill="#28a745" opacity="0.4" transform="rotate(-30,${cx.toFixed(1)},${cy.toFixed(1)})">DONE</text>`;
    }

    /* ── Wrap in self-contained <svg> ── */
    const pad = 65;  // constant padding — enough room for dimension annotations
    const totalW = W + pad * 2;
    const totalH = H + pad * 2;

    return (
        `<svg xmlns="http://www.w3.org/2000/svg" ` +
        `x="${(-pad).toFixed(1)}" y="${(-pad).toFixed(1)}" ` +
        `viewBox="${(-pad).toFixed(1)} ${(-pad).toFixed(1)} ${totalW.toFixed(1)} ${totalH.toFixed(1)}" ` +
        `width="${totalW.toFixed(1)}" height="${totalH.toFixed(1)}" ` +
        `overflow="visible">` +
        inner +
        dims +
        stamp +
        `</svg>`
    );
}

/* ─── Library icon helper ─────────────────────────────────────── */

export function getWindowTypeIcon(type, size = 56) {
    const h = Math.round(size * 0.8);
    // Custom type: show a + icon to convey "build from scratch"
    if (type === 'custom') {
        const cx = size / 2, cy = h / 2, arm = Math.round(size * 0.22);
        return (
            `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${h}" viewBox="0 0 ${size} ${h}">` +
            `<rect x="2" y="2" width="${size - 4}" height="${h - 4}" rx="3" fill="none" stroke="#2563eb" stroke-width="1.5" stroke-dasharray="4 2"/>` +
            `<line x1="${cx}" y1="${cy - arm}" x2="${cx}" y2="${cy + arm}" stroke="#2563eb" stroke-width="2" stroke-linecap="round"/>` +
            `<line x1="${cx - arm}" y1="${cy}" x2="${cx + arm}" y2="${cy}" stroke="#2563eb" stroke-width="2" stroke-linecap="round"/>` +
            `</svg>`
        );
    }
    const nH = ['bifold'].includes(type) ? 4
             : type === 'bow' ? 5
             : ['bay', 'end_vent_slider', 'fixed_casement'].includes(type) ? 3
             : 2;
    const inner = getWindowSVG({
        type,
        widthPx: size,
        heightPx: h,
        panelsH: nH,
        panelsV: 1,
        frameColour: '#2563eb',
        glassOpacity: 0.22,
        isIcon: true,
    });
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" ` +
        `width="${size}" height="${h}" ` +
        `viewBox="0 0 ${size} ${h}">` +
        inner +
        `</svg>`
    );
}
