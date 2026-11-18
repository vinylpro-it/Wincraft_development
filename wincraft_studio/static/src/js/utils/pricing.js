/** @odoo-module **/
/**
 * WinCraft Studio — Client-Side Price Calculator
 * Mirrors the server-side `_compute_unit_price` logic for instant feedback.
 * Real prices are always authoritative from the server computed field.
 */

import { session } from "@web/session";
import { user } from "@web/core/user";
import { currencies } from "@web/core/currency";

console.log("[WinCraft] ✓ LOADED: utils/pricing.js");

// Options TYPE -> the window colour field whose choice picks the rate.
const TRIM_COLOUR_FIELDS = {
    B: "brickmould_colour_id",
    C: "casing_colour_id",
    J: "extension_colour_id",
    X: "extension_colour_id",
};

/**
 * Window-level price of one Options add-on (size/colour aware for trim).
 * Mirrors wincraft.addon._price_for_window — keep the two in sync. Linear
 * trim (B/C/J/X) is priced per foot from the window size in inches, at the
 * white / colour / stain rate of the chosen colour; Fixed rows stay flat;
 * Square rows are sq ft x rate. Any other option TYPE keeps its flat price.
 * @param {Object} addon - wincraft.addon record
 * @param {Object} win - window record (width_mm, height_mm, *_colour_id)
 * @param {Array} colours - wincraft.color records (id, vendor, name)
 */
export function trimAddonPrice(addon, win, colours) {
    const colourField = TRIM_COLOUR_FIELDS[addon.group_code || ""];
    if (!colourField) return addon.price || 0;
    const raw = win[colourField];
    const colourId = (Array.isArray(raw) ? raw[0] : raw) || false;
    const colour = colourId ? (colours || []).find((c) => c.id === colourId) : null;
    let rate = addon.white_price || 0;
    if (colour) {
        if ((colour.vendor || "").toLowerCase().includes("stain")) rate = addon.stain_price || 0;
        else if ((colour.name || "").toLowerCase().includes("white")) rate = addon.white_price || 0;
        else rate = addon.colour_price || 0;
    }
    const wIn = (win.width_mm || 0) / 25.4;
    const hIn = (win.height_mm || 0) / 25.4;
    if (addon.pricing_unit === "fix") return rate;
    if (addon.pricing_unit === "sq") return (wIn * hIn / 144) * rate;
    const lengthIn = (addon.width_qty || 0) * (wIn + (addon.pricing_width || 0))
        + (addon.height_qty || 0) * (hIn + (addon.pricing_height || 0));
    return Math.max(lengthIn, 0) / 12 * rate;
}

/**
 * Resolve the best-matching wincraft.pricing.rule for a material+glass
 * combination, mirroring the server's wincraft.window._get_pricing_rule()
 * fallback chain: exact (material+glass) → material-only → glass-only →
 * global fallback (both blank). Previously the canvas never loaded pricing
 * rules at all, so the live estimate used the material/glass's own
 * rate_per_sqm directly and hardcoded fabrication_rate/margin_pct — any
 * combo-specific override configured in Pricing Rules was invisible until
 * the record was saved and the server recomputed it.
 * @param {Array} rules - wincraft.pricing.rule records (id, material_id, glass_type_id, base_rate, fabrication_rate, margin_pct, pricing_method, ui_tiers)
 * @param {number|false} materialId
 * @param {number|false} glassTypeId
 * @returns {Object|null}
 */
export function resolvePricingRule(rules, materialId, glassTypeId) {
    if (!rules || !rules.length) return null;
    const m2oId = (val) => (Array.isArray(val) ? val[0] : val) || false;
    const matId = materialId || false;
    const glaId = glassTypeId || false;

    const exact = rules.find(r => m2oId(r.material_id) === matId && m2oId(r.glass_type_id) === glaId);
    if (exact) return exact;

    if (matId) {
        const materialOnly = rules.find(r => m2oId(r.material_id) === matId && !m2oId(r.glass_type_id));
        if (materialOnly) return materialOnly;
    }
    if (glaId) {
        const glassOnly = rules.find(r => !m2oId(r.material_id) && m2oId(r.glass_type_id) === glaId);
        if (glassOnly) return glassOnly;
    }
    return rules.find(r => !m2oId(r.material_id) && !m2oId(r.glass_type_id)) || null;
}

/**
 * Attach each rule's United-Inches tiers (fetched separately from
 * wincraft.pricing.ui.tier, since it's a one2many) so resolvePricingRule()'s
 * result can be passed straight into calculateWindowPrice() as pricingRule.
 * @param {Array} rules - wincraft.pricing.rule records
 * @param {Array} uiTiers - wincraft.pricing.ui.tier records (rule_id, ui_min, ui_max, price)
 * @returns {Array} rules, each with a `ui_tiers` array attached
 */
export function attachUiTiers(rules, uiTiers) {
    const byRule = {};
    for (const t of (uiTiers || [])) {
        const ruleId = Array.isArray(t.rule_id) ? t.rule_id[0] : t.rule_id;
        if (!byRule[ruleId]) byRule[ruleId] = [];
        byRule[ruleId].push({ ui_min: t.ui_min, ui_max: t.ui_max, price: t.price });
    }
    return (rules || []).map(r => ({ ...r, ui_tiers: byRule[r.id] || [] }));
}

/**
 * Standard install quantity for a hardware role given an opening type.
 * Mirrors wincraft_bom_builder.py's _hardware_qty() exactly, so the canvas
 * estimate and the BOM agree on how many units of e.g. a hinge a window needs.
 * @param {string} role
 * @param {string} openingType
 * @returns {number}
 */
export function hardwareQty(role, openingType) {
    if (role === 'hinge') {
        if (['casement-l', 'casement-r', 'awning', 'hopper'].includes(openingType)) return 3;
        if (openingType === 'tiltturn') return 2;
        if (openingType === 'bifold') return 2;
        return 2;
    }
    if (role === 'handle') return 1;
    if (role === 'lock') return ['sliding', 'lift-slide'].includes(openingType) ? 2 : 1;
    if (role === 'track') return 1;
    if (role === 'balance') return 2;
    return 1;
}

export const SQFT_PER_M2 = 10.7639;

/** Per-m² price of one Glass Option at a thickness (price list is per sq ft). */
function glassOptionSqmPrice(option, thickness) {
    const sf = option && option.sf_prices
        ? Number(option.sf_prices[String(thickness || option.default_ot)])
        : 0;
    return sf > 0 ? sf * SQFT_PER_M2 : 0;
}

/**
 * Total glass cost for a window from the Glass Options picked on each pane
 * (mirrors wincraft.window._glass_cost on the server).
 *
 * @param {Array<{areaSqm:number, config:Object}>} panes
 * @param {Array} options - productOptions.glassOptions
 * @returns {number|null} null when no pane has a glass picked
 */
export function paneGlassCost(panes, options) {
    let total = 0;
    let found = false;
    for (const pane of panes) {
        const cfg = pane.config || {};
        const glazing = cfg.glazingType || "double";
        const positions = glazing === "single" ? [1] : glazing === "triple" ? [1, 2, 3] : [1, 2];
        for (const pos of positions) {
            const key = cfg[`glass${pos}Key`];
            const opt = key ? options.find(o => o.glass_key === key) : null;
            if (!opt) continue;
            const attrs = cfg[`glass${pos}Attrs`] || {};
            found = true;
            total += glassOptionSqmPrice(opt, attrs._ot) * pane.areaSqm;
        }
    }
    return found ? total : null;
}

/** Glass cost from the popup's In/Middle/Out choices, over the whole area. */
export function popupGlassCost(areaSqm, liteIds, options) {
    const ids = liteIds.filter(Boolean);
    if (!ids.length) return null;
    let perSqm = 0;
    for (const id of ids) {
        perSqm += glassOptionSqmPrice(options.find(o => o.lite_id === id), null);
    }
    return perSqm * areaSqm;
}

/**
 * Calculate the estimated unit price for a window configuration.
 * This is used for instant UI feedback; the server re-computes on save.
 *
 * @param {{
 *   widthMm: number,
 *   heightMm: number,
 *   pricingRule: { base_rate: number, fabrication_rate: number, margin_pct: number } | null,
 *   glassRatePerSqm: number,
 *   hardwareItems: Array<{ unit_price: number }>,
 *   addonItems: Array<{ price: number, per_window: boolean }>,
 * }} config
 * @returns {{ unitPrice: number, areaSqm: number, breakdown: Object }}
 */
export function calculateWindowPrice(config) {
    const {
        widthMm = 0,
        heightMm = 0,
        pricingRule = null,
        glassRatePerSqm = 0,
        hardwareItems = [],
        addonItems = [],
        profileDepthMm = 70,
        dualColour = false,
        paneConfigs = [],
    } = config;

    const areaSqm = (widthMm / 1000) * (heightMm / 1000);
    const unitedInches = (widthMm / 25.4) + (heightMm / 25.4);
    const marginPct = pricingRule?.margin_pct ?? 0;

    const hardwareCost = hardwareItems.reduce((sum, h) => sum + (h.unit_price ?? 0), 0);
    const addonCost = addonItems
        .filter(a => a.per_window)
        .reduce((sum, a) => sum + (a.price ?? 0), 0);

    // ── United inches tier pricing ──────────────────────────────────
    if (pricingRule?.pricing_method === 'united_inches' && pricingRule?.ui_tiers?.length) {
        const tiers = pricingRule.ui_tiers;
        let tierPrice = null;
        for (const t of tiers) {
            if (unitedInches >= t.ui_min && unitedInches <= t.ui_max) {
                tierPrice = t.price;
                break;
            }
        }
        if (tierPrice === null) {
            // No exact match: fall back to the nearest edge tier instead of
            // always assuming "above all tiers" — a value below the smallest
            // configured tier must use the lowest tier, not the highest.
            const lowest = tiers.reduce((min, t) => t.ui_min < min.ui_min ? t : min, tiers[0]);
            const highest = tiers.reduce((max, t) => t.ui_max > max.ui_max ? t : max, tiers[0]);
            tierPrice = unitedInches < lowest.ui_min ? lowest.price : highest.price;
        }
        const preMargin = tierPrice + hardwareCost + addonCost;
        const unitPrice = preMargin * (1 + marginPct / 100);
        return {
            unitPrice: Math.round(unitPrice * 100) / 100,
            areaSqm: Math.round(areaSqm * 10000) / 10000,
            unitedInches: Math.round(unitedInches * 100) / 100,
            breakdown: {
                areaSqm,
                unitedInches,
                tierPrice: Math.round(tierPrice * 100) / 100,
                hardwareCost: Math.round(hardwareCost * 100) / 100,
                addonCost: Math.round(addonCost * 100) / 100,
                marginPct,
                unitPrice: Math.round(unitPrice * 100) / 100,
            },
        };
    }

    // ── Area-based pricing (default) ────────────────────────────────
    const baseRate = pricingRule?.base_rate ?? 0;
    const fabricationRate = pricingRule?.fabrication_rate ?? 0;

    // Profile depth multiplier (70mm = baseline)
    const depth = parseInt(profileDepthMm) || 70;
    const depthMultiplier = depth <= 40 ? 0.85 : depth >= 90 ? 1.18 : 1.0;

    const materialCost = areaSqm * baseRate * depthMultiplier;
    const glassCost = areaSqm * glassRatePerSqm;
    const fabricationCost = areaSqm * fabricationRate;

    // Dual colour surcharge (15% on material)
    const dualColourSurcharge = dualColour ? materialCost * 0.15 : 0;

    const preMarginalTotal = materialCost + glassCost + fabricationCost + hardwareCost + addonCost + dualColourSurcharge;
    const unitPrice = preMarginalTotal * (1 + marginPct / 100);

    return {
        unitPrice: Math.round(unitPrice * 100) / 100,
        areaSqm: Math.round(areaSqm * 10000) / 10000,
        unitedInches: Math.round(unitedInches * 100) / 100,
        breakdown: {
            areaSqm,
            unitedInches,
            materialCost: Math.round(materialCost * 100) / 100,
            glassCost: Math.round(glassCost * 100) / 100,
            fabricationCost: Math.round(fabricationCost * 100) / 100,
            hardwareCost: Math.round(hardwareCost * 100) / 100,
            addonCost: Math.round(addonCost * 100) / 100,
            dualColourSurcharge: Math.round(dualColourSurcharge * 100) / 100,
            depthMultiplier,
            marginPct,
            unitPrice: Math.round(unitPrice * 100) / 100,
        },
    };
}

/**
 * Calculate project totals from an array of window unit prices.
 *
 * @param {{
 *   windows: Array<{ unit_price: number }>,
 *   installationCharge: number,
 *   oneTimeAddonTotal: number,
 *   discountPct: number,
 *   gstPct: number,
 * }} project
 * @returns {{
 *   windowsTotal: number,
 *   subtotal: number,
 *   discount: number,
 *   taxableAmount: number,
 *   gst: number,
 *   total: number,
 * }}
 */
export function calculateProjectTotals({ windows = [], installationCharge = 0, oneTimeAddonTotal = 0, discountPct = 0, gstPct = 0 }) {
    const windowsTotal = windows.reduce((sum, w) => sum + (w.unit_price ?? 0), 0);
    const subtotal = windowsTotal + installationCharge + oneTimeAddonTotal;
    const discount = subtotal * (discountPct / 100);
    const taxableAmount = subtotal - discount;
    const gst = taxableAmount * (gstPct / 100);
    const total = taxableAmount + gst;

    return {
        windowsTotal: Math.round(windowsTotal * 100) / 100,
        oneTimeAddonTotal: Math.round(oneTimeAddonTotal * 100) / 100,
        subtotal: Math.round(subtotal * 100) / 100,
        discount: Math.round(discount * 100) / 100,
        taxableAmount: Math.round(taxableAmount * 100) / 100,
        gst: Math.round(gst * 100) / 100,
        total: Math.round(total * 100) / 100,
    };
}

/**
 * Format a number using the company's currency.
 * Uses Odoo's session currencies and user's active company currency.
 *
 * @param {number} value
 * @returns {string}
 */
export function formatCurrency(value) {
    const num = Math.round(value || 0);

    try {
        const currencyId = user.activeCompany?.currency_id;
        const currency = currencyId && currencies[currencyId];

        if (currency) {
            const symbol = currency.symbol || '';
            const position = currency.position || 'before';
            const formatted = num.toLocaleString();
            return position === 'after'
                ? `${formatted}\u00a0${symbol}`
                : `${symbol}${formatted}`;
        }
    } catch {
        // user/currencies not yet initialized — fall back
    }

    return num.toLocaleString();
}

/**
 * @deprecated Use formatCurrency() instead.
 */
export const formatINR = formatCurrency;
