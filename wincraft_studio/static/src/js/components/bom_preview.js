/** @odoo-module **/
import { Component, useState } from "@odoo/owl";

const CATEGORY_LABELS = {
    profile: "Frame Profiles",
    glass: "Glazing Units",
    seal: "Seals & Gaskets",
    hardware: "Hardware",
    georgian: "Georgian Bars",
    other: "Other",
};

const CATEGORY_ICONS = {
    profile: "fa-bars",
    glass: "fa-diamond",
    seal: "fa-circle-o",
    hardware: "fa-wrench",
    georgian: "fa-th",
    other: "fa-cube",
};

export class BomPreview extends Component {
    static template = "wincraft_studio.BomPreview";
    static props = {
        data: { type: Object },
        onConfirm: Function,
        onClose: Function,
    };

    setup() {
        this.state = useState({
            expandedWindows: {},
            activeCategory: "all",
        });
        this.categoryLabels = CATEGORY_LABELS;
        this.categoryIcons = CATEGORY_ICONS;
    }

    get windows() {
        return this.props.data?.windows || [];
    }

    get grandTotals() {
        return this.props.data?.grand_totals || {};
    }

    get mrpInstalled() {
        return this.props.data?.mrp_installed ?? false;
    }

    get totalComponents() {
        return this.windows.reduce((s, w) => s + w.component_count, 0);
    }

    get categories() {
        const cats = new Set();
        for (const w of this.windows) {
            for (const c of w.components) {
                cats.add(c.category);
            }
        }
        return [...cats];
    }

    get filteredWindows() {
        if (this.state.activeCategory === "all") return this.windows;
        return this.windows
            .map((w) => ({
                ...w,
                components: w.components.filter(
                    (c) => c.category === this.state.activeCategory,
                ),
            }))
            .filter((w) => w.components.length > 0);
    }

    getCategoryLabel(cat) {
        return CATEGORY_LABELS[cat] || cat;
    }

    getCategoryIcon(cat) {
        return CATEGORY_ICONS[cat] || "fa-cube";
    }

    toggleWindow(windowId) {
        this.state.expandedWindows[windowId] =
            !this.state.expandedWindows[windowId];
    }

    isExpanded(windowId) {
        return !!this.state.expandedWindows[windowId];
    }

    setCategory(cat) {
        this.state.activeCategory = cat;
    }

    formatQty(qty) {
        return typeof qty === "number" ? qty.toFixed(3) : String(qty);
    }

    getUomLabel(uomRef) {
        if (!uomRef) return "unit";
        if (uomRef.includes("meter")) return "m";
        if (uomRef.includes("sqm")) return "m²";
        return "unit";
    }

    onConfirmClick() {
        this.props.onConfirm();
    }

    onCloseClick() {
        this.props.onClose();
    }
}

console.log("[WinCraft] ✓ LOADED: BomPreview");
