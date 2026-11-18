/** @odoo-module **/
/**
 * WinCraft Studio — Dashboard
 * Client action registered as "wincraft_dashboard".
 * Shows KPI cards and summary charts using native Odoo ORM calls.
 */

import { Component, useState, onMounted } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { formatCurrency } from "./utils/pricing.js";

console.log("[WinCraft] ✓ LOADED: WincraftDashboard");

export class WincraftDashboard extends Component {
    static template = "wincraft_studio.WincraftDashboard";

    setup() {
        console.log("[WinCraft] WincraftDashboard → setup() START");
        try {
            console.log("[WinCraft] WincraftDashboard → calling useService('orm')");
            this.orm = useService("orm");
            console.log("[WinCraft] WincraftDashboard → orm OK");

            console.log("[WinCraft] WincraftDashboard → calling useService('action')");
            this.action = useService("action");
            console.log("[WinCraft] WincraftDashboard → action OK");

            console.log("[WinCraft] WincraftDashboard → calling useState");
            this.state = useState({
                loaded: false,
                totalProjects: 0,
                drafts: 0,
                designing: 0,
                quoted: 0,
                accepted: 0,
                fabricating: 0,
                delivered: 0,
                totalRevenue: 0,
                totalWindows: 0,
                avgWindowPrice: 0,
                recentProjects: [],
            });
            console.log("[WinCraft] WincraftDashboard → state OK");

            onMounted(() => {
                console.log("[WinCraft] WincraftDashboard → onMounted START");
                try {
                    this._loadKpis();
                    console.log("[WinCraft] WincraftDashboard → onMounted DONE (async _loadKpis fired)");
                } catch(e) {
                    console.error("[WinCraft] WincraftDashboard → onMounted CRASHED:", e);
                    console.error("[WinCraft] Stack:", e.stack);
                }
            });

            console.log("[WinCraft] WincraftDashboard → setup() DONE ✓");
        } catch(e) {
            console.error("[WinCraft] WincraftDashboard → setup() CRASHED:", e);
            console.error("[WinCraft] Stack:", e.stack);
        }
    }

    async _loadKpis() {
        console.log("[WinCraft] WincraftDashboard → _loadKpis() START");
        try {
            // Scratch projects created by "Design Canvas Template" (Configuration >
            // Window Types) are internal-only, never a real customer project — exclude
            // them from every KPI/list below, same as wincraft_project_action(_all)'s domain.
            const NOT_TEMPLATE_WORKSPACE = ["is_template_workspace", "=", false];

            // Counts by state
            const states = ["draft", "designing", "quoted", "accepted", "fabricating", "delivered"];
            const counts = {};
            for (const s of states) {
                counts[s] = await this.orm.searchCount("wincraft.project", [["state", "=", s], NOT_TEMPLATE_WORKSPACE]);
            }
            console.log("[WinCraft] WincraftDashboard → _loadKpis() state counts done");

            const totalProjects = await this.orm.searchCount("wincraft.project", [NOT_TEMPLATE_WORKSPACE]);
            const totalWindows = await this.orm.searchCount("wincraft.window", [["project_id.is_template_workspace", "=", false]]);

            // Revenue: sum total_price of accepted, fabricating, delivered
            const revenueProjects = await this.orm.searchRead(
                "wincraft.project",
                [["state", "in", ["accepted", "fabricating", "delivered"]], NOT_TEMPLATE_WORKSPACE],
                ["total_price"]
            );
            const totalRevenue = revenueProjects.reduce((s, p) => s + (p.total_price || 0), 0);

            // Average window price
            const avgWindowPrice = totalWindows > 0
                ? totalRevenue / totalWindows
                : 0;

            // Recent projects
            const recentProjects = await this.orm.searchRead(
                "wincraft.project",
                [NOT_TEMPLATE_WORKSPACE],
                ["name", "ref", "state", "partner_id", "total_price", "create_date"],
                { limit: 10, order: "create_date desc" }
            );

            Object.assign(this.state, {
                loaded: true,
                totalProjects,
                ...counts,
                totalRevenue,
                totalWindows,
                avgWindowPrice,
                recentProjects,
            });
            console.log("[WinCraft] WincraftDashboard → _loadKpis() DONE, projects:", totalProjects);
        } catch(e) {
            console.error("[WinCraft] WincraftDashboard → _loadKpis() CRASHED:", e);
            console.error("[WinCraft] Stack:", e.stack);
        }
    }

    fmt(v) { return formatCurrency(v); }

    openProjects(state) {
        const domain = [["is_template_workspace", "=", false]];
        if (state) domain.push(["state", "=", state]);
        this.action.doAction({
            type: "ir.actions.act_window",
            name: state ? `Projects — ${state}` : "All Projects",
            res_model: "wincraft.project",
            views: [[false, "list"], [false, "form"]],
            domain,
            target: "current",
        });
    }

    openProject(id) {
        this.action.doAction({
            type: "ir.actions.act_window",
            res_model: "wincraft.project",
            res_id: id,
            views: [[false, "form"]],
            target: "current",
        });
    }

    openWindows() {
        this.action.doAction({
            type: "ir.actions.act_window",
            name: "All Windows",
            res_model: "wincraft.window",
            views: [[false, "list"], [false, "form"]],
            domain: [["project_id.is_template_workspace", "=", false]],
            target: "current",
        });
    }

    get stateCards() {
        return [
            { label: "Draft", key: "draft", count: this.state.drafts, color: "#6c757d" },
            { label: "Designing", key: "designing", count: this.state.designing, color: "#5b8dee" },
            { label: "Quoted", key: "quoted", count: this.state.quoted, color: "#e8c97a" },
            { label: "Accepted", key: "accepted", count: this.state.accepted, color: "#28a745" },
            { label: "Fabricating", key: "fabricating", count: this.state.fabricating, color: "#fd7e14" },
            { label: "Delivered", key: "delivered", count: this.state.delivered, color: "#20c997" },
        ];
    }
}

registry.category("actions").add("wincraft_dashboard", WincraftDashboard);
console.log("[WinCraft] ✓ REGISTERED: wincraft_dashboard action");
