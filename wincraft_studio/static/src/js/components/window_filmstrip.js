/** @odoo-module **/
/**
 * WinCraft Studio — Window Filmstrip
 * Horizontal scrollable strip showing saved window thumbnails at the bottom.
 */

import { Component, markup } from "@odoo/owl";
import { getWindowTypeIcon } from "../utils/window_svg.js";

console.log("[WinCraft] ✓ LOADED: WindowFilmstrip");

export class WindowFilmstrip extends Component {
    static template = "wincraft_studio.WindowFilmstrip";

    static props = {
        windows: { type: Array },
        activeWindowIndex: { type: Number },
        onSelectWindow: Function,
        onNewWindow: Function,
        canAddWindow: { type: Boolean, optional: true },
    };

    getThumb(w) {
        return markup(getWindowTypeIcon(w.window_type || "casement", 32));
    }

    isActive(idx) {
        return idx === this.props.activeWindowIndex;
    }

    onCardClick(idx) {
        this.props.onSelectWindow(idx);
    }
}
