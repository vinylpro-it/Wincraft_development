/** @odoo-module **/
/**
 * WinCraft Studio — Save as Template Dialog
 *
 * Small modal that names a new wincraft.window.template record captured
 * from the currently selected canvas window, with an optional one-step
 * link back to a Window Type's "Default Canvas Template" field.
 */

import { Component, useState } from "@odoo/owl";
import { Dialog } from "@web/core/dialog/dialog";
import { useOverlayDialogLayerFix } from "../utils/overlay_dialog_fix.js";

console.log("[WinCraft] ✓ LOADED: SaveTemplateDialog");

export class SaveTemplateDialog extends Component {
    static template = "wincraft_studio.SaveTemplateDialog";
    static components = { Dialog };

    static props = {
        defaultName: { type: String, optional: true },
        windowTypes: { type: Array, optional: true },
        initialWindowTypeId: { type: Number, optional: true },
        onConfirm: Function,
        close: Function,
    };

    setup() {
        useOverlayDialogLayerFix();
        this.state = useState({
            name: this.props.defaultName || "",
            category: "residential",
            linkedWindowTypeId: this.props.initialWindowTypeId ? String(this.props.initialWindowTypeId) : "",
        });
    }

    get categoryOptions() {
        return [
            { key: "residential", label: "Residential" },
            { key: "commercial", label: "Commercial" },
            { key: "heritage", label: "Heritage" },
            { key: "contemporary", label: "Contemporary" },
            { key: "specialty", label: "Specialty" },
        ];
    }

    get windowTypeOptions() {
        return this.props.windowTypes || [];
    }

    onNameChange(ev) {
        this.state.name = ev.target.value;
    }

    onCategoryChange(ev) {
        this.state.category = ev.target.value;
    }

    onLinkedWindowTypeChange(ev) {
        this.state.linkedWindowTypeId = ev.target.value;
    }

    onConfirmClick() {
        const name = this.state.name.trim();
        if (!name) return;
        const linkedId = this.state.linkedWindowTypeId ? parseInt(this.state.linkedWindowTypeId, 10) : null;
        this.props.onConfirm(name, this.state.category, linkedId);
        this.props.close();
    }
}
