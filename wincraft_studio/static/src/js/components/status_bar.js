/** @odoo-module **/
/**
 * WinCraft Studio — Status Bar
 * Thin footer showing validation status, window count, total area, project name.
 */

import { Component } from "@odoo/owl";

console.log("[WinCraft] ✓ LOADED: StatusBar");

export class StatusBar extends Component {
    static template = "wincraft_studio.StatusBar";

    static props = {
        windowCount: { type: Number },
        totalArea: { type: String },
        projectName: { type: String, optional: true },
    };
}
