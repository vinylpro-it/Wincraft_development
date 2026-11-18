/** @odoo-module **/
/**
 * WinCraft Studio — Profile Optimiser Frontend Component
 * Renders an interactive bar/cut visualisation for the profile optimiser.
 * Used as an inline widget in the form view via OWL component registry.
 */

import { Component, useState, onMounted } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

console.log("[WinCraft] ✓ LOADED: ProfileOptimiserWidget");

export class ProfileOptimiserWidget extends Component {
    static template = "wincraft_studio.ProfileOptimiserWidget";

    setup() {
        console.log("[WinCraft] ProfileOptimiserWidget → setup() START");
        try {
            console.log("[WinCraft] ProfileOptimiserWidget → calling useService('orm')");
            this.orm = useService("orm");
            console.log("[WinCraft] ProfileOptimiserWidget → orm OK");

            console.log("[WinCraft] ProfileOptimiserWidget → calling useState");
            this.state = useState({
                bars: [],
                totalBars: 0,
                wastePct: 0,
                standardLength: 6000,
                isLoaded: false,
            });
            console.log("[WinCraft] ProfileOptimiserWidget → state OK");

            onMounted(async () => {
                console.log("[WinCraft] ProfileOptimiserWidget → onMounted START");
                try {
                    await this._loadData();
                    console.log("[WinCraft] ProfileOptimiserWidget → onMounted DONE");
                } catch(e) {
                    console.error("[WinCraft] ProfileOptimiserWidget → onMounted CRASHED:", e);
                    console.error("[WinCraft] Stack:", e.stack);
                }
            });

            console.log("[WinCraft] ProfileOptimiserWidget → setup() DONE ✓");
        } catch(e) {
            console.error("[WinCraft] ProfileOptimiserWidget → setup() CRASHED:", e);
            console.error("[WinCraft] Stack:", e.stack);
        }
    }

    async _loadData() {
        console.log("[WinCraft] ProfileOptimiserWidget → _loadData() START");
        try {
            const recordId = this.props.record?.resId;
            if (!recordId) {
                console.log("[WinCraft] ProfileOptimiserWidget → _loadData() no recordId, skipping");
                return;
            }

            console.log("[WinCraft] ProfileOptimiserWidget → _loadData() reading optimiser", recordId);
            const [optimiser] = await this.orm.read(
                "wincraft.profile.optimiser",
                [recordId],
                ["total_bars", "waste_pct", "standard_length", "state"]
            );

            if (!optimiser || optimiser.state !== "computed") {
                console.log("[WinCraft] ProfileOptimiserWidget → _loadData() not computed, skipping");
                return;
            }

            this.state.totalBars = optimiser.total_bars;
            this.state.wastePct = optimiser.waste_pct;
            this.state.standardLength = optimiser.standard_length;

            console.log("[WinCraft] ProfileOptimiserWidget → _loadData() reading bars");
            const bars = await this.orm.searchRead(
                "wincraft.profile.optimiser.bar",
                [["optimiser_id", "=", recordId]],
                ["sequence", "used_mm", "waste_mm", "utilisation_pct"],
                { order: "sequence asc" }
            );

            this.state.bars = bars;
            this.state.isLoaded = true;
            console.log("[WinCraft] ProfileOptimiserWidget → _loadData() DONE, bars:", bars.length);
        } catch(e) {
            console.error("[WinCraft] ProfileOptimiserWidget → _loadData() CRASHED:", e);
            console.error("[WinCraft] Stack:", e.stack);
        }
    }

    /**
     * Returns an SVG-style width percentage for a bar segment.
     */
    getUsedWidth(bar) {
        return ((bar.used_mm / this.state.standardLength) * 100).toFixed(1) + "%";
    }

    getWasteWidth(bar) {
        return ((bar.waste_mm / this.state.standardLength) * 100).toFixed(1) + "%";
    }

    getBarColour(bar) {
        if (bar.utilisation_pct >= 90) return "#28a745";
        if (bar.utilisation_pct >= 70) return "#e8c97a";
        return "#dc3545";
    }
}

registry.category("view_widgets").add("profile_optimiser_chart", {
    component: ProfileOptimiserWidget,
});
console.log("[WinCraft] ✓ REGISTERED: profile_optimiser_chart view_widget");
