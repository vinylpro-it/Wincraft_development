/** @odoo-module **/
/**
 * WinCraft Studio — Asset Load Order Checker
 * This file runs LAST in the asset bundle.
 * It verifies all WinCraft components registered correctly.
 * REMOVE THIS FILE after the loading issue is fixed.
 */

console.log("[WinCraft LoadCheck] ═══ ASSET LOAD ORDER VERIFICATION ═══");

// Delayed check — runs after all modules finish loading
setTimeout(() => {
    console.log("[WinCraft LoadCheck] Running post-load checks...");

    try {
        const { registry } = odoo.loader.modules.get("@web/core/registry");

        // Check action registrations
        const actionChecks = [
            { key: "wincraft_designer", label: "WincraftDesignerAction" },
            { key: "wincraft_dashboard", label: "WincraftDashboard" },
        ];

        actionChecks.forEach(({ key, label }) => {
            try {
                const reg = registry.category("actions");
                const exists = reg.contains(key);
                if (exists) {
                    console.log(`[WinCraft LoadCheck] ✅ ${label} → registered OK`);
                } else {
                    console.error(`[WinCraft LoadCheck] ❌ ${label} → MISSING from actions registry`);
                }
            } catch(e) {
                console.error(`[WinCraft LoadCheck] ❌ ${label} → CHECK FAILED:`, e.message);
            }
        });

        // Check view_widgets registration
        try {
            const reg = registry.category("view_widgets");
            const exists = reg.contains("profile_optimiser_chart");
            if (exists) {
                console.log("[WinCraft LoadCheck] ✅ ProfileOptimiserWidget → registered OK");
            } else {
                console.error("[WinCraft LoadCheck] ❌ ProfileOptimiserWidget → MISSING from view_widgets registry");
            }
        } catch(e) {
            console.error("[WinCraft LoadCheck] ❌ ProfileOptimiserWidget → CHECK FAILED:", e.message);
        }

        // List expected template names
        const templateNames = [
            "wincraft_studio.WincraftDesignerAction",
            "wincraft_studio.WincraftDashboard",
            "wincraft_studio.DesignerCanvas",
            "wincraft_studio.DesignerTopbar",
            "wincraft_studio.ComponentLibraryPanel",
            "wincraft_studio.WindowObject",
            "wincraft_studio.PropertiesPanel",
            "wincraft_studio.QuoteBreakdown",
            "wincraft_studio.ElevationView",
            "wincraft_studio.ProfileOptimiserWidget",
        ];

        templateNames.forEach(name => {
            console.log(`[WinCraft LoadCheck] 📋 Template expected: ${name}`);
        });

        console.log("[WinCraft LoadCheck] ═══ VERIFICATION COMPLETE ═══");

    } catch(e) {
        console.error("[WinCraft LoadCheck] FAILED:", e);
    }
}, 2000);

console.log("[WinCraft LoadCheck] ✓ Load checker installed (results in 2s)");
