/** @odoo-module **/
/**
 * WinCraft Studio — Bay/Bow 3D Iso Popup Dialog
 *
 * Renders the rotatable axonometric view of a bay or bow window inside a
 * standard Odoo Dialog so it doesn't disrupt the canvas elevation.
 */

import { Component, markup, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";
import { renderBayBow3DInset, computeBayBowIso } from "../utils/window_svg.js";
import { useOverlayDialogLayerFix } from "../utils/overlay_dialog_fix.js";

console.log("[WinCraft] ✓ LOADED: WindowIso3DDialog");

export class WindowIso3DDialog extends Component {
    static template = "wincraft_studio.WindowIso3DDialog";
    static components = { Dialog };
    static props = {
        window: { type: Object },
        close: Function,
    };

    setup() {
        this.state = useState({ yawDeg: 0, alphaDeg: 30 });
        useOverlayDialogLayerFix();
    }

    get title() {
        const w = this.props.window;
        const t = (w.window_type || '').toUpperCase();
        return `${t} 3D View — ${w.name || ''}`;
    }

    get svgMarkup() {
        const w = this.props.window;
        const cfg = computeBayBowIso({
            type: w.window_type,
            widthMm: w.width_mm,
            heightMm: w.height_mm,
            bayAngle: w.bay_angle,
            bayAngleCustomDeg: w.bay_angle_custom_deg,
            bowAngleDeg: w.bow_angle_deg,
            bowAngleCustomDeg: w.bow_angle_custom_deg,
            bayLiteCount: w.bay_lite_count,
            bayCentreRatio: w.bay_centre_ratio,
            bowRadiusMm: w.bow_radius_mm,
            projectionDepthMm: w.projection_depth_mm,
        });
        const W = 640, H = 480;
        const inner = renderBayBow3DInset({
            x: 0, y: 0, w: W, h: H,
            label: cfg.label,
            lites: cfg.lites,
            projMm: cfg.projMm,
            heightMm: cfg.heightMm,
            yawDeg: this.state.yawDeg,
            alphaDeg: this.state.alphaDeg,
            showControls: true,
            dark: '#3a3a3a',
            frameColour: w.frame_colour || '#f0ede8',
        });
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" `
                  + `viewBox="0 0 ${W} ${H}" width="100%" height="100%" `
                  + `style="display:block;background:#fafafa;border-radius:4px">`
                  + `${inner}</svg>`;
        return markup(svg);
    }

    onSvgMouseDown(ev) {
        const btn = ev.target.closest('[data-iso-action]');
        if (!btn) return;
        ev.preventDefault();
        ev.stopPropagation();
        const action = btn.getAttribute('data-iso-action');
        switch (action) {
            case 'rot-left':  this.state.yawDeg -= 15; break;
            case 'rot-right': this.state.yawDeg += 15; break;
            case 'tilt-up':   this.state.alphaDeg = Math.min(75, this.state.alphaDeg + 5); break;
            case 'tilt-down': this.state.alphaDeg = Math.max(10, this.state.alphaDeg - 5); break;
            case 'reset':     this.state.yawDeg = 0; this.state.alphaDeg = 30; break;
        }
    }
}
