/** @odoo-module **/
/**
 * WinCraft Studio — Designer Config Header (WS-17/WS-18)
 *
 * New top header with 4 clickable sections, each meant to open its own
 * canvas configuration popup — one per not-yet-started ticket besides these
 * two. Sections 3-4 render disabled until their own tickets land.
 *
 * "Window Configuration" (section 1) is always clickable, with or without a
 * window on canvas — confirmed with the user (2026-09-23) that this is meant
 * to be usable *first*, to set defaults the next created window picks up.
 * See wincraft_designer.js's onOpenWindowConfigurationDialog()/
 * pendingWindowConfig.
 *
 * "New Window" (section 2, WS-18) reuses the existing NewWindowWizard.
 * Confirmed with the user (2026-09-24): it stays disabled until section 1's
 * required fields (profile, inside/outside colour, casement hardware,
 * brickmould type) are set — see wincraft_designer.js's
 * canOpenNewWindowSection getter, passed in as newWindowEnabled.
 */

import { Component } from "@odoo/owl";

export class DesignerConfigHeader extends Component {
    static template = "wincraft_studio.DesignerConfigHeader";

    static props = {
        newWindowEnabled: { type: Boolean, optional: true },
        onOpenWindowConfiguration: Function,
        onOpenNewWindow: Function,
    };

    get sections() {
        return [
            { key: "window_configuration", label: "Window Configuration", enabled: true },
            {
                key: "new_window",
                label: "New Window",
                enabled: !!this.props.newWindowEnabled,
                disabledHint: "Fill in Window Configuration first (Profile, Colour — inside/outside, Casement Hardware, Brickmould Type)",
            },
            { key: "combination_window", label: "Coming soon", enabled: false },
            { key: "grid_configuration", label: "Coming soon", enabled: false },
        ];
    }

    onSectionClick(section) {
        if (!section.enabled) return;
        if (section.key === "window_configuration") {
            this.props.onOpenWindowConfiguration();
        } else if (section.key === "new_window") {
            this.props.onOpenNewWindow();
        }
    }
}
