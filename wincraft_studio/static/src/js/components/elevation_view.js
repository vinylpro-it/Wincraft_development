/** @odoo-module **/
/**
 * WinCraft Studio — Elevation View Component
 * Renders a front/side elevation of the building wall showing window positions.
 * Pure SVG rendering, no external dependencies.
 */

import { Component, useState, onMounted, markup } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

console.log("[WinCraft] ✓ LOADED: ElevationView");

const WALL_COLOUR = "#e8e0d4";
const GROUND_COLOUR = "#8b7d6b";
const LABEL_FONT = "'DM Mono', monospace";

export class ElevationView extends Component {
    static template = "wincraft_studio.ElevationView";

    static props = {
        projectId: Number,
        windows: { type: Array },
        wallWidth: { type: Number, optional: true },
        wallHeight: { type: Number, optional: true },
    };

    setup() {
        console.log("[WinCraft] ElevationView → setup() START");
        try {
            this.state = useState({
                scale: 0.15, // mm to px
                hoveredId: null,
            });

            console.log("[WinCraft] ElevationView → calling useService('orm')");
            this.orm = useService("orm");
            console.log("[WinCraft] ElevationView → orm OK");

            console.log("[WinCraft] ElevationView → setup() DONE ✓");
        } catch(e) {
            console.error("[WinCraft] ElevationView → setup() CRASHED:", e);
            console.error("[WinCraft] Stack:", e.stack);
        }
    }

    get wallW() {
        return (this.props.wallWidth || 6000) * this.state.scale;
    }

    get wallH() {
        return (this.props.wallHeight || 3000) * this.state.scale;
    }

    get svgWidth() {
        return this.wallW + 80;
    }

    get svgHeight() {
        return this.wallH + 100;
    }

    get wallSVG() {
        const w = this.wallW;
        const h = this.wallH;
        const ox = 40; // offset from left
        const oy = 30; // offset from top

        let svg = "";

        // Wall background
        svg += `<rect x="${ox}" y="${oy}" width="${w}" height="${h}" fill="${WALL_COLOUR}" stroke="#5a5040" stroke-width="2" rx="2"/>`;

        // Ground line
        svg += `<rect x="${ox - 10}" y="${oy + h}" width="${w + 20}" height="20" fill="${GROUND_COLOUR}" rx="2"/>`;

        // Wall dimension labels
        const wallWidthMM = this.props.wallWidth || 6000;
        const wallHeightMM = this.props.wallHeight || 3000;
        svg += `<text x="${ox + w / 2}" y="${oy + h + 40}" text-anchor="middle" font-family="${LABEL_FONT}" font-size="11" fill="#333">${wallWidthMM} mm</text>`;
        svg += `<text x="${ox - 20}" y="${oy + h / 2}" text-anchor="middle" font-family="${LABEL_FONT}" font-size="11" fill="#333" transform="rotate(-90, ${ox - 20}, ${oy + h / 2})">${wallHeightMM} mm</text>`;

        // Render each window
        const scale = this.state.scale;
        const windows = this.props.windows || [];

        windows.forEach((win, idx) => {
            const wW = (win.width_mm || 600) * scale;
            const wH = (win.height_mm || 900) * scale;
            // Auto position: distribute evenly if no elevation coords
            const spacing = w / (windows.length + 1);
            const wx = ox + (win.elevation_x != null ? win.elevation_x * scale : spacing * (idx + 1) - wW / 2);
            const wy = oy + (win.elevation_y != null ? win.elevation_y * scale : h - wH - 200 * scale);

            const isHovered = this.state.hoveredId === win.id;
            const strokeCol = isHovered ? "#e8c97a" : "#2e3440";
            const strokeW = isHovered ? 3 : 2;

            // Window opening in wall
            svg += `<rect x="${wx}" y="${wy}" width="${wW}" height="${wH}" fill="#a8d8f0" fill-opacity="0.3" stroke="${strokeCol}" stroke-width="${strokeW}" rx="1"/>`;

            // Panel grid lines
            const pH = win.panels_horizontal || 1;
            const pV = win.panels_vertical || 1;
            const panelW = wW / pH;
            const panelH = wH / pV;

            for (let c = 1; c < pH; c++) {
                const lx = wx + c * panelW;
                svg += `<line x1="${lx}" y1="${wy}" x2="${lx}" y2="${wy + wH}" stroke="${strokeCol}" stroke-width="1"/>`;
            }
            for (let r = 1; r < pV; r++) {
                const ly = wy + r * panelH;
                svg += `<line x1="${wx}" y1="${ly}" x2="${wx + wW}" y2="${ly}" stroke="${strokeCol}" stroke-width="1"/>`;
            }

            // Label
            svg += `<text x="${wx + wW / 2}" y="${wy + wH + 14}" text-anchor="middle" font-family="${LABEL_FONT}" font-size="9" fill="#333">${win.name || 'W' + (idx + 1)}</text>`;
            svg += `<text x="${wx + wW / 2}" y="${wy - 5}" text-anchor="middle" font-family="${LABEL_FONT}" font-size="8" fill="#666">${win.width_mm}×${win.height_mm}</text>`;
        });

        return markup(svg);
    }

    onWindowHover(id) {
        this.state.hoveredId = id;
    }

    onWindowLeave() {
        this.state.hoveredId = null;
    }
}
