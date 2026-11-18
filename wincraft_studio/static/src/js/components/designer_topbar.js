/** @odoo-module **/
/**
 * WinCraft Studio — Designer Topbar Component
 * Tab-based navigation bar with branding, tabs, save & get-quote CTA.
 */

import { Component, useState } from "@odoo/owl";

console.log("[WinCraft] ✓ LOADED: DesignerTopbar");

export class DesignerTopbar extends Component {
    static template = "wincraft_studio.DesignerTopbar";

    static props = {
        isSaving: Boolean,
        isDirty: Boolean,
        activeWindowIndex: { type: Number },
        windowCount: { type: Number },
        activeWindowName: { type: String, optional: true },
        onSave: Function,
        onExit: Function,
        onExportPDF: { type: Function, optional: true },
        onGetQuote: { type: Function, optional: true },
        onPrevWindow: { type: Function, optional: true },
        onNextWindow: { type: Function, optional: true },
        onDeleteWindow: { type: Function, optional: true },
        onSaveAsTemplate: { type: Function, optional: true },
        onGenerateBom: { type: Function, optional: true },
    };

    setup() {
        this.state = useState({ activeTab: "configure" });
    }

    get saveLabel() {
        if (this.props.isSaving) return "Saving…";
        if (this.props.isDirty) return "Save*";
        return "Saved";
    }

    setTab(tab) {
        this.state.activeTab = tab;
    }
}
