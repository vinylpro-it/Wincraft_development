/** @odoo-module **/
/**
 * WinCraft Studio — Configuration Validation
 * Client-side validation rules matching industry constraints.
 * Returns an array of warning/error objects for inline display.
 */

import { validateTree, computePaneBounds } from "./panel_tree.js";
import { getArchRise } from "./frame_shape_geometry.js";

console.log("[WinCraft] ✓ LOADED: utils/validation.js");

// frame_shape values whose outline is curved or pointed — a single pane in
// one of these shapes can only be Fixed glazing (mirrors the server-side
// _check_shape_operability constraint on wincraft.window).
const CURVED_FRAME_SHAPES = [
    "arched", "gothic", "circle", "half_circle",
    "triangle", "trapezoid", "rake", "octagon",
];

/**
 * @typedef {Object} ValidationResult
 * @property {number|null} paneIndex  - Pane index (null if window-level)
 * @property {string}      field     - Field name that triggered the warning
 * @property {'warning'|'error'} severity
 * @property {string}      message   - Human-readable message
 */

/**
 * Validate a window configuration against industry rules.
 *
 * @param {{
 *   widthMm: number,
 *   heightMm: number,
 *   windowType: string,
 *   panelsH: number,
 *   panelsV: number,
 *   paneConfigs: Array<{ openingType: string, widthMm: number, heightMm: number }>,
 *   mullionPositions: Array<{ orientation: string, positionMm: number }>,
 *   mullionThickness: number,
 * }} config
 * @returns {ValidationResult[]}
 */
export function validateConfig(config) {
    const results = [];
    const {
        widthMm = 0,
        heightMm = 0,
        panelsH = 1,
        panelsV = 1,
        paneConfigs = [],
        mullionThickness = 20,
        mullionPositions = [],
        panelTree = null,
        frameShape = "rectangular",
    } = config;
    const isCurvedShape = CURVED_FRAME_SHAPES.includes(frameShape);
    const isArchedOrGothic = frameShape === "arched" || frameShape === "gothic";

    // ── Window-level ───────────────────────────────────────────────
    if (widthMm < 200) {
        results.push({ paneIndex: null, field: "widthMm", severity: "error", message: `Width ${widthMm}mm is below the minimum 200mm` });
    }
    if (heightMm < 200) {
        results.push({ paneIndex: null, field: "heightMm", severity: "error", message: `Height ${heightMm}mm is below the minimum 200mm` });
    }
    if (widthMm > 8000) {
        results.push({ paneIndex: null, field: "widthMm", severity: "error", message: `Width ${widthMm}mm exceeds maximum 8000mm` });
    }
    if (heightMm > 5000) {
        results.push({ paneIndex: null, field: "heightMm", severity: "error", message: `Height ${heightMm}mm exceeds maximum 5000mm` });
    }

    // ── Panel Tree validation ─────────────────────────────────────
    if (panelTree) {
        const treeResult = validateTree(panelTree, widthMm, heightMm, mullionThickness);
        if (treeResult && treeResult.errors) {
            for (const err of treeResult.errors) {
                results.push({
                    paneIndex: null,
                    field: "panelTree",
                    severity: "error",
                    message: err,
                });
            }
        }
        if (treeResult && treeResult.warnings) {
            for (const warn of treeResult.warnings) {
                results.push({
                    paneIndex: null,
                    field: "panelTree",
                    severity: "warning",
                    message: warn,
                });
            }
        }

        // Tree-based per-pane validation
        const bounds = { x: 0, y: 0, w: widthMm, h: heightMm };
        const panes = computePaneBounds(panelTree, bounds, mullionThickness);
        for (let i = 0; i < panes.length; i++) {
            const pane = panes[i];
            const pw = pane.bounds.w;
            const ph = pane.bounds.h;
            const pc = pane.config || {};
            const type = pc.openingType || "fixed";

            if (pw < 100) {
                results.push({ paneIndex: i, field: "widthMm", severity: "error", message: `Panel ${pane.id} width ${Math.round(pw)}mm is below minimum 100mm` });
            }
            if (ph < 100) {
                results.push({ paneIndex: i, field: "heightMm", severity: "error", message: `Panel ${pane.id} height ${Math.round(ph)}mm is below minimum 100mm` });
            }
            if ((type === "casement-l" || type === "casement-r" || type === "casement") && pw > 900) {
                results.push({ paneIndex: i, field: "widthMm", severity: "warning", message: `Panel ${pane.id}: casement width ${Math.round(pw)}mm exceeds recommended 900mm max` });
            }
            if ((type === "casement-l" || type === "casement-r" || type === "casement") && ph > 1400) {
                results.push({ paneIndex: i, field: "heightMm", severity: "warning", message: `Panel ${pane.id}: casement height ${Math.round(ph)}mm exceeds recommended 1400mm max` });
            }
            if (type === "awning" && pw > 900) {
                results.push({ paneIndex: i, field: "widthMm", severity: "warning", message: `Panel ${pane.id}: awning width ${Math.round(pw)}mm exceeds recommended 900mm max` });
            }
            if (type === "awning" && ph > 1400) {
                results.push({ paneIndex: i, field: "heightMm", severity: "warning", message: `Panel ${pane.id}: awning height ${Math.round(ph)}mm exceeds recommended 1400mm max` });
            }
            if (type === "tiltturn" || type === "tilt_turn") {
                const areaSqm = (pw / 1000) * (ph / 1000);
                const weight = areaSqm * 25;
                if (weight > 80) {
                    results.push({ paneIndex: i, field: "weight", severity: "warning", message: `Panel ${pane.id}: tilt+turn estimated weight ${weight.toFixed(1)}kg exceeds 80kg sash limit` });
                }
            }
            if (type === "sliding" && pw < 400) {
                results.push({ paneIndex: i, field: "widthMm", severity: "warning", message: `Panel ${pane.id}: sliding panel width ${Math.round(pw)}mm is below recommended 400mm min` });
            }
        }

        // Any pane overlapping the curved/pointed part of the frame must be
        // Fixed glazing. For arched/gothic that's the top rise band — checked
        // per pane, since a vertical split still leaves every pane touching
        // it. Other curved shapes don't have a clean top-only band, so the
        // simpler whole-window rule applies there.
        if (isArchedOrGothic) {
            const rise = getArchRise(frameShape, widthMm, heightMm);
            for (const pane of panes) {
                const type = pane.config?.openingType || "fixed";
                if (pane.bounds.y < rise && type !== "fixed") {
                    results.push({
                        paneIndex: null, field: "openingType", severity: "error",
                        message: `A ${frameShape} frame's curved top section must be Fixed glazing — "${type}" is not a real combination. Split the curved band into its own fixed pane, separate from any operable section below.`,
                    });
                }
            }
        } else if (isCurvedShape && panes.length === 1) {
            const onlyType = panes[0].config?.openingType || "fixed";
            if (onlyType !== "fixed") {
                results.push({
                    paneIndex: null, field: "openingType", severity: "error",
                    message: `A ${frameShape} frame with a single pane must be Fixed glazing — "${onlyType}" is not a real combination. Split the window into a fixed curved section and a separate rectangular operable section instead.`,
                });
            }
        }

        return results;
    }

    // Check total width = sum of pane widths + mullion thicknesses
    if (paneConfigs.length > 1) {
        const sumPaneWidths = paneConfigs.reduce((s, p) => s + (p.widthMm || 0), 0);
        const totalMullions = (paneConfigs.length - 1) * mullionThickness;
        const expectedWidth = sumPaneWidths + totalMullions;
        if (Math.abs(expectedWidth - widthMm) > 2) {
            results.push({
                paneIndex: null, field: "widthMm", severity: "warning",
                message: `Total width (${widthMm}mm) doesn't match pane widths + mullions (${expectedWidth}mm)`,
            });
        }
    }

    // ── Mullion position rules ───────────────────────────────────────
    if (mullionPositions && mullionPositions.length > 0) {
        const MIN_EDGE = 50;   // Minimum distance from frame edge (mm)
        const MIN_GAP = 80;    // Minimum gap between adjacent mullions (mm)

        const vPositions = mullionPositions
            .filter(m => m.orientation === 'vertical')
            .map(m => m.positionMm)
            .sort((a, b) => a - b);
        const hPositions = mullionPositions
            .filter(m => m.orientation === 'horizontal')
            .map(m => m.positionMm)
            .sort((a, b) => a - b);

        for (const pos of vPositions) {
            if (pos < MIN_EDGE) {
                results.push({ paneIndex: null, field: "mullion", severity: "error", message: `Vertical mullion at ${pos}mm is too close to left frame edge (min ${MIN_EDGE}mm)` });
            }
            if (pos > widthMm - MIN_EDGE) {
                results.push({ paneIndex: null, field: "mullion", severity: "error", message: `Vertical mullion at ${pos}mm is too close to right frame edge (min ${MIN_EDGE}mm gap)` });
            }
        }
        for (let i = 1; i < vPositions.length; i++) {
            if (vPositions[i] - vPositions[i - 1] < MIN_GAP) {
                results.push({ paneIndex: null, field: "mullion", severity: "warning", message: `Vertical mullions at ${vPositions[i - 1]}mm and ${vPositions[i]}mm are only ${vPositions[i] - vPositions[i - 1]}mm apart (min ${MIN_GAP}mm)` });
            }
        }

        for (const pos of hPositions) {
            if (pos < MIN_EDGE) {
                results.push({ paneIndex: null, field: "mullion", severity: "error", message: `Horizontal transom at ${pos}mm is too close to top frame edge (min ${MIN_EDGE}mm)` });
            }
            if (pos > heightMm - MIN_EDGE) {
                results.push({ paneIndex: null, field: "mullion", severity: "error", message: `Horizontal transom at ${pos}mm is too close to bottom frame edge (min ${MIN_EDGE}mm gap)` });
            }
        }
        for (let i = 1; i < hPositions.length; i++) {
            if (hPositions[i] - hPositions[i - 1] < MIN_GAP) {
                results.push({ paneIndex: null, field: "mullion", severity: "warning", message: `Horizontal transoms at ${hPositions[i - 1]}mm and ${hPositions[i]}mm are only ${hPositions[i] - hPositions[i - 1]}mm apart (min ${MIN_GAP}mm)` });
            }
        }

        // Max divider count
        if (vPositions.length > 10) {
            results.push({ paneIndex: null, field: "mullion", severity: "warning", message: `${vPositions.length} vertical mullions may be excessive (max recommended: 10)` });
        }
        if (hPositions.length > 10) {
            results.push({ paneIndex: null, field: "mullion", severity: "warning", message: `${hPositions.length} horizontal transoms may be excessive (max recommended: 10)` });
        }
    }

    // ── Per-pane rules ─────────────────────────────────────────────
    for (let i = 0; i < paneConfigs.length; i++) {
        const pane = paneConfigs[i];
        const pw = pane.widthMm || (widthMm / panelsH);
        const ph = pane.heightMm || (heightMm / panelsV);
        const type = pane.openingType || "fixed";

        // Minimum pane size
        if (pw < 100) {
            results.push({ paneIndex: i, field: "widthMm", severity: "error", message: `Pane ${i + 1} width ${Math.round(pw)}mm is below minimum 100mm` });
        }
        if (ph < 100) {
            results.push({ paneIndex: i, field: "heightMm", severity: "error", message: `Pane ${i + 1} height ${Math.round(ph)}mm is below minimum 100mm` });
        }

        // Casement / awning max dimensions
        if (type === "casement-l" || type === "casement-r" || type === "casement") {
            if (pw > 900) {
                results.push({ paneIndex: i, field: "widthMm", severity: "warning", message: `Pane ${i + 1}: casement width ${Math.round(pw)}mm exceeds recommended 900mm max` });
            }
            if (ph > 1400) {
                results.push({ paneIndex: i, field: "heightMm", severity: "warning", message: `Pane ${i + 1}: casement height ${Math.round(ph)}mm exceeds recommended 1400mm max` });
            }
        }
        if (type === "awning") {
            if (pw > 900) {
                results.push({ paneIndex: i, field: "widthMm", severity: "warning", message: `Pane ${i + 1}: awning width ${Math.round(pw)}mm exceeds recommended 900mm max` });
            }
            if (ph > 1400) {
                results.push({ paneIndex: i, field: "heightMm", severity: "warning", message: `Pane ${i + 1}: awning height ${Math.round(ph)}mm exceeds recommended 1400mm max` });
            }
        }

        // Tilt+turn weight limit: width × height × 25 kg/m² ≤ 80 kg
        if (type === "tiltturn" || type === "tilt_turn") {
            const areaSqm = (pw / 1000) * (ph / 1000);
            const weight = areaSqm * 25;
            if (weight > 80) {
                results.push({
                    paneIndex: i, field: "weight", severity: "warning",
                    message: `Pane ${i + 1}: tilt+turn estimated weight ${weight.toFixed(1)}kg exceeds 80kg sash limit`,
                });
            }
        }

        // Sliding min width
        if (type === "sliding") {
            if (pw < 400) {
                results.push({ paneIndex: i, field: "widthMm", severity: "warning", message: `Pane ${i + 1}: sliding panel width ${Math.round(pw)}mm is below recommended 400mm min` });
            }
        }

        // Any pane overlapping the curved/pointed part of the frame must be
        // Fixed glazing (see the matching check in the panelTree branch above).
        if (isArchedOrGothic) {
            const row = Math.floor(i / panelsH);
            const paneY = row * (heightMm / panelsV);
            const rise = getArchRise(frameShape, widthMm, heightMm);
            if (paneY < rise && type !== "fixed") {
                results.push({
                    paneIndex: null, field: "openingType", severity: "error",
                    message: `A ${frameShape} frame's curved top section must be Fixed glazing — "${type}" is not a real combination. Split the curved band into its own fixed pane, separate from any operable section below.`,
                });
            }
        }
    }

    // Curved/pointed (non-arched/gothic) frame shape with a single pane must be Fixed glazing
    if (!isArchedOrGothic && isCurvedShape && panelsH * panelsV === 1) {
        const onlyType = paneConfigs[0]?.openingType || "fixed";
        if (onlyType !== "fixed") {
            results.push({
                paneIndex: 0, field: "openingType", severity: "error",
                message: `A ${frameShape} frame with a single pane must be Fixed glazing — "${onlyType}" is not a real combination. Split the window into a fixed curved section and a separate rectangular operable section instead.`,
            });
        }
    }

    return results;
}

/**
 * Evaluate data-driven rules loaded from wincraft.rule model.
 *
 * @param {{
 *   widthMm: number,
 *   heightMm: number,
 *   windowType: string,
 *   panelsH: number,
 *   panelsV: number,
 *   profileTypeId: number|null,
 *   profileDepthMm: number,
 *   paneConfigs: Array,
 *   mullionPositions: Array,
 * }} config
 * @param {Array<{
 *   profile_type_id: [number,string]|false,
 *   window_type: string,
 *   condition_field: string,
 *   operator: string,
 *   threshold: number,
 *   threshold_upper: number,
 *   severity: string,
 *   message: string,
 *   action: string,
 * }>} rules
 * @returns {ValidationResult[]}
 */
export function validateWithRules(config, rules) {
    if (!rules || rules.length === 0) return [];
    const results = [];
    const {
        widthMm = 0,
        heightMm = 0,
        windowType = 'casement',
        panelsH = 1,
        panelsV = 1,
        profileTypeId = null,
        profileDepthMm = 70,
        paneConfigs = [],
        mullionPositions = [],
    } = config;

    const areaSqm = (widthMm / 1000) * (heightMm / 1000);
    const mullionCount = mullionPositions ? mullionPositions.length : 0;

    for (const rule of rules) {
        // Check scope: profile system
        const ruleProfileId = rule.profile_type_id ? rule.profile_type_id[0] : null;
        if (ruleProfileId && ruleProfileId !== profileTypeId) continue;

        // Check scope: window type
        if (rule.window_type !== 'all' && rule.window_type !== windowType) continue;

        // Resolve window-level value
        const fieldMap = {
            width_mm: widthMm,
            height_mm: heightMm,
            area_sqm: areaSqm,
            panels_horizontal: panelsH,
            panels_vertical: panelsV,
            mullion_count: mullionCount,
            profile_depth_mm: profileDepthMm,
        };

        // Per-pane fields need iteration
        const isPerPane = ['pane_width_mm', 'pane_height_mm', 'sash_weight_kg'].includes(rule.condition_field);

        if (isPerPane) {
            for (let i = 0; i < Math.max(1, paneConfigs.length); i++) {
                const pane = paneConfigs[i] || {};
                const pw = pane.widthMm || (widthMm / panelsH);
                const ph = pane.heightMm || (heightMm / panelsV);
                let value;
                switch (rule.condition_field) {
                    case 'pane_width_mm': value = pw; break;
                    case 'pane_height_mm': value = ph; break;
                    case 'sash_weight_kg': value = (pw / 1000) * (ph / 1000) * 25; break;
                    default: value = 0;
                }
                if (_evalCondition(value, rule.operator, rule.threshold, rule.threshold_upper)) {
                    results.push({
                        paneIndex: i,
                        field: rule.condition_field,
                        severity: rule.severity === 'error' ? 'error' : 'warning',
                        message: _formatRuleMessage(rule.message, value, rule.threshold),
                    });
                }
            }
        } else {
            const value = fieldMap[rule.condition_field];
            if (value !== undefined && _evalCondition(value, rule.operator, rule.threshold, rule.threshold_upper)) {
                results.push({
                    paneIndex: null,
                    field: rule.condition_field,
                    severity: rule.severity === 'error' ? 'error' : 'warning',
                    message: _formatRuleMessage(rule.message, value, rule.threshold),
                });
            }
        }
    }
    return results;
}

function _evalCondition(value, operator, threshold, thresholdUpper) {
    switch (operator) {
        case '>': return value > threshold;
        case '>=': return value >= threshold;
        case '<': return value < threshold;
        case '<=': return value <= threshold;
        case '==': return value === threshold;
        case '!=': return value !== threshold;
        case 'between': return value >= threshold && value <= (thresholdUpper || threshold);
        default: return false;
    }
}

function _formatRuleMessage(template, value, threshold) {
    let msg = template || '';
    const fmtVal = typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(1)) : value;
    const fmtThr = typeof threshold === 'number' ? (Number.isInteger(threshold) ? threshold : threshold.toFixed(1)) : threshold;
    msg = msg.replace(/\{value\}/g, fmtVal);
    msg = msg.replace(/\{threshold\}/g, fmtThr);
    return msg;
}
