/** @odoo-module **/
/**
 * WinCraft Studio — Window Type Configuration Cache
 *
 * Maps each window type to its allowed UI options: frame shapes, sash
 * layouts, opening types, hinge sides, Georgian bar patterns, and divider
 * (mullion/transom) support.
 *
 * Backed by the wincraft.window.type model (Configuration > Window Types)
 * instead of a hardcoded map, so adding a new window type only requires a
 * new record there. wincraft_designer.js populates this cache once via
 * setWindowTypeConfig() after loading the records; the Component Library
 * Panel and Properties Panel keep reading through getTypeConfig() as before.
 */

const ALL_FRAME_SHAPES = [
    "rectangular", "arched", "gothic", "circle",
    "half_circle", "triangle", "trapezoid", "rake", "octagon",
];

const ALL_GEORGIAN = ["none", "grid", "diamond", "sunburst", "prairie", "marginal"];

let windowTypeConfig = {};

/**
 * Populate the cache from wincraft.window.type records.
 * Each entry: { key, label, frameShapes, sashLayouts, openingTypes,
 *               hingeSides, georgianPatterns, allowMullion, allowTransom,
 *               openingDirections }.
 */
export function setWindowTypeConfig(entries) {
    const next = {};
    for (const entry of entries || []) {
        if (entry && entry.key) {
            next[entry.key] = entry;
        }
    }
    windowTypeConfig = next;
}

/**
 * Get the configuration for a window type.
 * Returns a permissive fallback if the type is unknown (including before
 * the cache has been populated for the first time).
 */
export function getTypeConfig(windowType) {
    return windowTypeConfig[windowType] || {
        label: windowType || "Unknown",
        frameShapes: ALL_FRAME_SHAPES,
        sashLayouts: ["1x1", "2x1", "3x1", "1x2", "2x2", "3x2"],
        openingTypes: ["fixed", "casement-l", "casement-r", "awning", "tiltturn", "sliding", "bifold", "louvre"],
        hingeSides: ["left", "right", "top"],
        georgianPatterns: ALL_GEORGIAN,
        allowMullion: true,
        allowTransom: true,
        openingDirections: ["left_right", "fixed", "tilt_turn"],
    };
}

/**
 * List all known window types as { key, label, seriesId, seriesName,
 * seriesSequence, kindCode, kindName, kindSequence, iconUrl, templateId,
 * templateThumbnailSvg }, in catalogue order. Used to populate the Choose
 * Window Type wizard and the Component Library Panel instead of a
 * hardcoded array, so admin-added types (and their series/kind/icon/
 * template) show up there too.
 */
export function getAllWindowTypes() {
    return Object.entries(windowTypeConfig).map(([key, cfg]) => ({
        key,
        label: cfg.label || key,
        seriesId: cfg.seriesId ?? null,
        seriesName: cfg.seriesName || null,
        seriesSequence: cfg.seriesSequence ?? null,
        kindCode: cfg.kindCode || null,
        kindName: cfg.kindName || null,
        kindSequence: cfg.kindSequence ?? 10,
        iconUrl: cfg.iconUrl || null,
        templateId: cfg.templateId || null,
        templateThumbnailSvg: cfg.templateThumbnailSvg || null,
    }));
}

/**
 * Get default per-pane opening types for a window type.
 * Used when resetting pane_configs after a type change.
 */
export function getDefaultOpeningType(windowType, paneIndex, totalPanes) {
    switch (windowType) {
        case "casement":
            return paneIndex % 2 === 0 ? "casement-l" : "casement-r";
        case "sliding":
        case "single_slider":
            return paneIndex === 0 ? "fixed" : "sliding";
        case "double_slider":
            return "sliding";
        case "end_vent_slider":
            return (paneIndex === 0 || paneIndex === totalPanes - 1) ? "sliding" : "fixed";
        case "bifold":
            return "bifold";
        case "tilt_turn":
            return "tiltturn";
        case "awning":
            return "awning";
        case "single_hung":
            return paneIndex === 0 ? "fixed" : "sliding";
        case "double_hung":
            return "sliding";
        case "fixed":
        case "arched":
            return "fixed";
        case "fixed_casement":
            if (paneIndex === 0) return "fixed";
            return paneIndex % 2 === 1 ? "casement-r" : "casement-l";
        case "bay":
            if (paneIndex === 0) return "casement-l";
            if (paneIndex === totalPanes - 1) return "casement-r";
            return "fixed";
        case "bow":
            // Bow: alternating fixed / operable from outside lites inward.
            if (paneIndex === 0) return "casement-l";
            if (paneIndex === totalPanes - 1) return "casement-r";
            return "fixed";
        case "custom":
            return "fixed";
        default:
            return "fixed";
    }
}

/**
 * Derive maximum horizontal/vertical panel counts from a type's sashLayouts.
 * e.g. casement ["1x1","2x1","3x1"] → { maxH: 3, maxV: 1 }
 */
export function getMaxPanels(windowType) {
    const cfg = getTypeConfig(windowType);
    const layouts = cfg.sashLayouts || ["1x1"];
    let maxH = 1, maxV = 1;
    for (const key of layouts) {
        const [h, v] = key.split("x").map(Number);
        if (h > maxH) maxH = h;
        if (v > maxV) maxV = v;
    }
    return { maxH, maxV };
}

/**
 * Enforce the sash invariant: panel counts must equal mullion counts + 1.
 * If mullion_positions is present in the patch, auto-correct panel counts
 * and trim/expand pane_configs accordingly.
 */
export function enforceSashInvariant(patch, currentWindow) {
    const positions = patch.mullion_positions;
    if (!positions) return patch;

    const vCount = positions.filter(m => m.orientation === 'vertical').length;
    const hCount = positions.filter(m => m.orientation === 'horizontal').length;
    const correctH = vCount + 1;
    const correctV = hCount + 1;

    const patchH = patch.panels_horizontal ?? currentWindow.panels_horizontal ?? 1;
    const patchV = patch.panels_vertical ?? currentWindow.panels_vertical ?? 1;

    if (patchH !== correctH || patchV !== correctV) {
        patch.panels_horizontal = correctH;
        patch.panels_vertical = correctV;
        // Trim/expand pane_configs to match
        const needed = correctH * correctV;
        let configs;
        if (patch.pane_configs) {
            configs = [...patch.pane_configs];
        } else if (currentWindow.pane_configs) {
            configs = [...currentWindow.pane_configs];
        } else {
            configs = [];
        }
        while (configs.length < needed) {
            configs.push({
                openingType: "fixed", hinge: "left",
                glazingUnit: "double-4-16-4", glassSpec: "clear", glassTint: "clear",
            });
        }
        patch.pane_configs = configs.slice(0, needed);
    }
    return patch;
}

console.log("[WinCraft] ✓ LOADED: window_type_config");
