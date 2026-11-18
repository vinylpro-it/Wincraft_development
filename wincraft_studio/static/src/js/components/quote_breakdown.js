/** @odoo-module **/
/**
 * WinCraft Studio — Quote Breakdown
 * Bottom strip / collapsible panel showing project price summary.
 * Uses the pricing.js utility for all calculations.
 */

import { Component, useState } from "@odoo/owl";
import { calculateProjectTotals, formatCurrency } from "../utils/pricing.js";

console.log("[WinCraft] ✓ LOADED: QuoteBreakdown");

export class QuoteBreakdown extends Component {
    static template = "wincraft_studio.QuoteBreakdown";

    static props = {
        windows: { type: Array },
        installationCharge: { type: Number },
        oneTimeAddonTotal: { type: Number, optional: true },
        discountPct: { type: Number },
        gstPct: { type: Number },
        currencySymbol: { type: String, optional: true },
    };

    setup() {
        console.log("[WinCraft] QuoteBreakdown → setup() START");
        try {
            this.state = useState({ collapsed: false });
            console.log("[WinCraft] QuoteBreakdown → setup() DONE ✓");
        } catch(e) {
            console.error("[WinCraft] QuoteBreakdown → setup() CRASHED:", e);
            console.error("[WinCraft] Stack:", e.stack);
        }
    }

    toggleCollapse() {
        this.state.collapsed = !this.state.collapsed;
    }

    get totals() {
        return calculateProjectTotals({
            windows: this.props.windows,
            installationCharge: this.props.installationCharge,
            oneTimeAddonTotal: this.props.oneTimeAddonTotal || 0,
            discountPct: this.props.discountPct,
            gstPct: this.props.gstPct,
        });
    }

    get windowCount() {
        return this.props.windows.length;
    }

    get totalArea() {
        let sum = 0;
        for (const w of this.props.windows) {
            sum += ((w.width_mm || 0) * (w.height_mm || 0)) / 1_000_000;
        }
        return sum.toFixed(3);
    }

    fmt(v) {
        return formatCurrency(v);
    }
}
