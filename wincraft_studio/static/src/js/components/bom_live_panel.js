/** @odoo-module **/
/**
 * WinCraft Studio — Live BOM Panel (Right Sidebar)
 * Shows a reactive bill of materials grouped by category.
 */

import { Component, useState } from "@odoo/owl";
import { computeLiveBom } from "../utils/bom_calculator.js";
import { formatCurrency } from "../utils/pricing.js";

console.log("[WinCraft] ✓ LOADED: BomLivePanel");

export class BomLivePanel extends Component {
    static template = "wincraft_studio.BomLivePanel";

    static props = {
        selectedWindow: { optional: true },
        materials: { type: Array },
        glassTypes: { type: Array },
        glazingConfigs: { type: Array, optional: true },
        glassConfigs: { type: Array, optional: true },
        hardware: { type: Array },
        profileTypes: { type: Array, optional: true },
        paintProducts: { type: Array, optional: true },
    };

    setup() {
        this.state = useState({
            collapsed: {},
        });
    }

    get bom() {
        return computeLiveBom(
            this.props.selectedWindow,
            this.props.materials,
            this.props.glassTypes,
            this.props.hardware,
            this.props.profileTypes || [],
            this.props.glazingConfigs || [],
            this.props.glassConfigs || [],
            this.props.paintProducts || [],
        );
    }

    get hasWindow() {
        return !!this.props.selectedWindow;
    }

    toggleCategory(key) {
        this.state.collapsed = {
            ...this.state.collapsed,
            [key]: !this.state.collapsed[key],
        };
    }

    isCategoryCollapsed(key) {
        return !!this.state.collapsed[key];
    }

    categorySubtotal(cat) {
        return cat.items.reduce((sum, item) => sum + item.lineCost, 0);
    }

    fmt(v) {
        return formatCurrency(v || 0);
    }
}
