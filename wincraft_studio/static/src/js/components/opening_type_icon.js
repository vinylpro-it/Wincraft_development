/** @odoo-module **/
/**
 * WinCraft Studio — Opening Type Icon
 * Renders an architectural SVG icon for a window opening type.
 * Uses dashed-line + arc + arrow conventions from technical drawings.
 *
 * Props:
 *   type:   'fixed' | 'casement-r' | 'casement-l' | 'awning' | 'tiltturn'
 *           | 'sliding' | 'bifold' | 'single-hung' | 'double-hung'
 *   hinge:  'left' | 'right' | 'top'  (only affects casement/awning)
 *   size:   Number (default 32)
 *   active: Boolean
 */

import { Component, markup } from "@odoo/owl";

console.log("[WinCraft] ✓ LOADED: OpeningTypeIcon");

/* ------------------------------------------------------------------ */
/* Shared drawing constants                                           */
/* ------------------------------------------------------------------ */
const FRAME_STROKE = "var(--wc-icon-frame, #9ca8b9)";
const ACCENT       = "var(--wc-icon-accent, #4f6ef7)";
const GLASS_FILL   = "var(--wc-icon-glass, rgba(168,216,240,0.30))";
const DASH         = "4 3";
const SW           = 1.2;       // main stroke width
const SW_THIN      = 0.8;     // indicator line width
const ARROW_SIZE   = 3;

/* ------------------------------------------------------------------ */
/* Helper: small arrowhead path (open chevron, no fill)                */
/* ------------------------------------------------------------------ */
function arrowHead(x, y, angle) {
    const rad = angle * Math.PI / 180;
    const ax = x + ARROW_SIZE * Math.cos(rad + 2.6);
    const ay = y + ARROW_SIZE * Math.sin(rad + 2.6);
    const bx = x + ARROW_SIZE * Math.cos(rad - 2.6);
    const by = y + ARROW_SIZE * Math.sin(rad - 2.6);
    return `<path d="M${ax.toFixed(1)},${ay.toFixed(1)} L${x},${y} L${bx.toFixed(1)},${by.toFixed(1)}" fill="none" stroke="${ACCENT}" stroke-width="${SW_THIN}" stroke-linecap="round"/>`;
}

/* ------------------------------------------------------------------ */
/* Icon renderers                                                     */
/* ------------------------------------------------------------------ */
const ICONS = {
    fixed(s) {
        // Dashed X — non-openable pane
        const m = 5, e = s - 5;
        return `<line x1="${m}" y1="${m}" x2="${e}" y2="${e}" stroke="${ACCENT}" stroke-width="${SW_THIN}" stroke-dasharray="${DASH}" opacity="0.5"/>` +
               `<line x1="${e}" y1="${m}" x2="${m}" y2="${e}" stroke="${ACCENT}" stroke-width="${SW_THIN}" stroke-dasharray="${DASH}" opacity="0.5"/>`;
    },

    "casement-l"(s) {
        // Left-hinged: filled triangle — apex right-center, base on left edge
        const m = 5, e = s - 5, cy = s / 2;
        return `<polygon points="${m},${m} ${m},${e} ${e},${cy}" fill="rgba(79,110,247,0.12)" stroke="${ACCENT}" stroke-width="${SW_THIN}"/>`;
    },

    "casement-r"(s) {
        // Right-hinged: filled triangle — apex left-center, base on right edge
        const m = 5, e = s - 5, cy = s / 2;
        return `<polygon points="${e},${m} ${e},${e} ${m},${cy}" fill="rgba(79,110,247,0.12)" stroke="${ACCENT}" stroke-width="${SW_THIN}"/>`;
    },

    awning(s) {
        // Top-hinged: filled triangle — apex bottom-center, base on top edge
        const m = 5, e = s - 5, cx = s / 2;
        return `<polygon points="${m},${m} ${e},${m} ${cx},${e}" fill="rgba(79,110,247,0.12)" stroke="${ACCENT}" stroke-width="${SW_THIN}"/>`;
    },

    tiltturn(s) {
        // Tilt (bottom-center apex, solid) + Turn (left-center apex, dashed)
        const m = 5, e = s - 5, cx = s / 2, cy = s / 2;
        return `<polygon points="${m},${m} ${e},${m} ${cx},${e}" fill="rgba(79,110,247,0.10)" stroke="${ACCENT}" stroke-width="${SW_THIN}"/>` +
               `<polygon points="${e},${m} ${e},${e} ${m},${cy}" fill="none" stroke="${ACCENT}" stroke-width="0.6" stroke-dasharray="${DASH}" opacity="0.5"/>`;
    },

    sliding(s) {
        // Horizontal arrow + vertical mullion divider
        const m = 5, e = s - 5, cy = s / 2, cx = s / 2;
        return `<line x1="${cx}" y1="${m}" x2="${cx}" y2="${e}" stroke="${FRAME_STROKE}" stroke-width="0.8"/>` +
               `<line x1="${m + 3}" y1="${cy}" x2="${e - 2}" y2="${cy}" stroke="${ACCENT}" stroke-width="${SW_THIN}"/>` +
               arrowHead(e - 2, cy, 0);
    },

    bifold(s) {
        // Fold lines + directional arrow
        const m = 5, e = s - 5, cy = s / 2;
        const third = (e - m) / 3;
        let svg = '';
        for (let i = 1; i <= 2; i++) {
            const x = m + third * i;
            svg += `<line x1="${x}" y1="${m}" x2="${x - 3}" y2="${e}" stroke="${ACCENT}" stroke-width="${SW_THIN}" stroke-dasharray="${DASH}"/>`;
        }
        svg += `<line x1="${m + 2}" y1="${cy}" x2="${e - 2}" y2="${cy}" stroke="${ACCENT}" stroke-width="${SW_THIN}" opacity="0.4"/>`;
        svg += arrowHead(e - 2, cy, 0);
        return svg;
    },

    louvre(s) {
        // 4 horizontal parallel lines — louvre slats
        const m = 5, e = s - 5;
        const nLines = 4;
        const spacing = (e - m) / (nLines + 1);
        let svg = '';
        for (let i = 1; i <= nLines; i++) {
            const y = m + spacing * i;
            svg += `<line x1="${m + 1}" y1="${y}" x2="${e - 1}" y2="${y}" stroke="${ACCENT}" stroke-width="${SW_THIN}" opacity="0.6"/>`;
        }
        return svg;
    },

    "single-hung"(s) {
        // Bottom sash arrow up + mid-rail
        const m = 5, e = s - 5, cx = s / 2, cy = s / 2;
        return `<line x1="${m}" y1="${cy}" x2="${e}" y2="${cy}" stroke="${FRAME_STROKE}" stroke-width="0.8"/>` +
               `<line x1="${cx}" y1="${e - 2}" x2="${cx}" y2="${m + 4}" stroke="${ACCENT}" stroke-width="${SW_THIN}"/>` +
               arrowHead(cx, m + 4, 270);
    },

    "double-hung"(s) {
        // Both sashes — up arrow top, down arrow bottom + mid-rail
        const m = 5, e = s - 5, cx = s / 2, cy = s / 2;
        return `<line x1="${m}" y1="${cy}" x2="${e}" y2="${cy}" stroke="${FRAME_STROKE}" stroke-width="0.8"/>` +
               `<line x1="${cx}" y1="${cy - 2}" x2="${cx}" y2="${m + 2}" stroke="${ACCENT}" stroke-width="${SW_THIN}"/>` +
               arrowHead(cx, m + 2, 270) +
               `<line x1="${cx}" y1="${cy + 2}" x2="${cx}" y2="${e - 2}" stroke="${ACCENT}" stroke-width="${SW_THIN}"/>` +
               arrowHead(cx, e - 2, 90);
    },
};

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */
export class OpeningTypeIcon extends Component {
    static template = "wincraft_studio.OpeningTypeIcon";

    static props = {
        type:   { type: String },
        hinge:  { type: String, optional: true },
        size:   { type: Number, optional: true },
        active: { type: Boolean, optional: true },
    };

    get iconSize() { return Number(this.props.size) || 32; }

    get fullSvg() {
        const s = this.iconSize;
        const m = 3, e = s - 3;
        const active = this.props.active ? ' wc-opening-icon--active' : '';
        let inner = `<rect x="${m}" y="${m}" width="${e - m}" height="${e - m}" rx="1.5" fill="${GLASS_FILL}" stroke="${FRAME_STROKE}" stroke-width="${SW}"/>`;
        const renderer = ICONS[this.props.type];
        if (renderer) inner += renderer(s);
        return markup(
            `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg" class="wc-opening-icon${active}">${inner}</svg>`
        );
    }
}
