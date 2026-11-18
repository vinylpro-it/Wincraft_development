/** @odoo-module **/
/**
 * WinCraft Studio — BOM Calculator Utility
 * Computes a live bill of materials from a window configuration.
 */

import { computePaneBounds, getDividerLines } from "./panel_tree.js";
import { getShapeAreaPerimeter, isShapedFrame } from "./frame_shape_geometry.js";
import { hardwareQty } from "./pricing.js";

const CATEGORIES = {
    profile: { label: "Profile", color: "#4f6ef7" },
    glass: { label: "Glass", color: "#22c55e" },
    hardware: { label: "Hardware", color: "#f59e0b" },
    seals: { label: "Seals & Gaskets", color: "#a855f7" },
    georgian: { label: "Georgian Bars", color: "#06b6d4" },
    paint: { label: "Paint", color: "#ec4899" },
    other: { label: "Other", color: "#6b7280" },
};

const SQFT_PER_M2 = 10.7639;

/**
 * Per-m² cost of one glass pane from the supplier price list (prices are per
 * square foot, one per thickness). Falls back to `fallback` when the option
 * has no price for that thickness.
 */
function glassUnitCostPerM2(glassOption, thickness, fallback) {
    const sf = glassOption && glassOption.sf_prices
        ? Number(glassOption.sf_prices[String(thickness)])
        : 0;
    return sf > 0 ? Math.round(sf * SQFT_PER_M2 * 100) / 100 : fallback;
}

/**
 * Compute a live BOM grouped by category.
 * @param {Object} window - window record
 * @param {Array} materials - wincraft.material records
 * @param {Array} glassTypes - wincraft.glass.type records
 * @param {Array} hardware - wincraft.hardware records
 * @param {Array} profileTypes - wincraft.window.type.series records
 * @param {Array} glazingConfigs - unused (glazing configs were retired); kept for call-site compatibility
 * @param {Array} glassConfigs - Glass Options (wincraft.glass.lite) from productOptions.glassOptions
 * @returns {{ categories: Array, totalCost: number, componentCount: number }}
 */
export function computeLiveBom(window, materials, glassTypes, hardware, profileTypes, glazingConfigs, glassConfigs, paintProducts) {
    if (!window) return { categories: [], totalCost: 0, componentCount: 0 };

    const widthMm = window.width_mm || 600;
    const heightMm = window.height_mm || 900;
    const widthM = widthMm / 1000;
    const heightM = heightMm / 1000;
    const frameShape = window.frame_shape || 'rectangular';
    const shaped = isShapedFrame(frameShape);
    // Frame profile / outer seals always follow the true frame outline —
    // a circle's cut length is its circumference, not 2×(w+h).
    const shapeGeom = shaped
        ? getShapeAreaPerimeter(frameShape, widthMm, heightMm, window.frame_shape_points)
        : null;
    const perimeterM = shapeGeom ? shapeGeom.perimeterM : 2 * (widthM + heightM);
    const nH = window.panels_horizontal || 1;
    const nV = window.panels_vertical || 1;

    const profileDepth = Number.parseInt(window.profile_depth_mm) || 70;
    const dualColour = window.frame_colour_outside && window.frame_colour_outside !== window.frame_colour;

    // Determine pane list and divider lines from panel tree (or legacy grid)
    const panelTree = window.panel_tree;
    let panes = [];    // [{id, config, bounds:{x,y,w,h}}]
    let dividers = []; // [{direction, length (mm)}]

    if (panelTree) {
        const bounds = { x: 0, y: 0, w: widthMm, h: heightMm };
        const mullionThick = 20;
        panes = computePaneBounds(panelTree, bounds, mullionThick);
        dividers = getDividerLines(panelTree, bounds, mullionThick);
    } else {
        // Legacy flat grid fallback
        for (let i = 0; i < nH * nV; i++) {
            const col = i % nH;
            const row = Math.floor(i / nH);
            panes.push({
                id: `legacy_${i}`,
                config: (window.pane_configs || [])[i] || {},
                bounds: {
                    x: col * (widthMm / nH),
                    y: row * (heightMm / nV),
                    w: widthMm / nH,
                    h: heightMm / nV,
                },
            });
        }
        // Legacy dividers
        for (let c = 1; c < nH; c++) {
            dividers.push({ direction: 'vertical', length: heightMm });
        }
        for (let r = 1; r < nV; r++) {
            dividers.push({ direction: 'horizontal', length: widthMm });
        }
    }

    const items = [];

    // 1. Profile components
    const psId = window.profile_type_id
        ? (Array.isArray(window.profile_type_id) ? window.profile_type_id[0] : window.profile_type_id)
        : null;
    const ps = psId && profileTypes ? profileTypes.find(s => s.id === psId) : null;
    // Configured Profile Type rate (Configuration → Profile Types) when
    // set; falls back to a flat estimate otherwise so this panel doesn't
    // suddenly show $0 for systems nobody has priced yet. This is a
    // materials-cost (COGS) estimate, independent of the sale price
    // computed by Pricing Rules.
    const psRate = ps && ps.rate_per_metre > 0 ? ps.rate_per_metre : null;

    // Frame profiles (perimeter)
    items.push({
        category: "profile",
        name: `Frame Profile (${profileDepth}mm)`,
        qty: parseFloat(perimeterM.toFixed(2)),
        uom: "m",
        unitCost: psRate ?? (ps ? 250 : 200),
    });

    // A single pane spanning the whole window takes the shape of the frame
    // itself (e.g. one round IGU in a circular frame) rather than a
    // rectangular cut — sub-panes from a split frame stay rectangular.
    function paneShapeOverride(pane) {
        if (!shaped || panes.length !== 1) return null;
        const b = pane.bounds;
        if (Math.abs(b.x) < 0.01 && Math.abs(b.y) < 0.01 &&
            Math.abs(b.w - widthMm) < 0.01 && Math.abs(b.h - heightMm) < 0.01) {
            return shapeGeom;
        }
        return null;
    }

    // Sash profiles — one set per pane
    let sashPerimeter = 0;
    for (const pane of panes) {
        const override = paneShapeOverride(pane);
        sashPerimeter += override ? override.perimeterM : 2 * ((pane.bounds.w / 1000) + (pane.bounds.h / 1000));
    }
    items.push({
        category: "profile",
        name: "Sash Profile",
        qty: parseFloat(sashPerimeter.toFixed(2)),
        uom: "m",
        // Sash extrusion is typically lighter/cheaper than the outer frame —
        // 72% of the frame rate when no configured rate exists, matching the
        // previous hardcoded 180/250 ratio.
        unitCost: psRate ? Math.round(psRate * 0.72) : (ps ? 180 : 150),
    });

    // Mullion / transom profiles from actual divider lines
    const mullionV = dividers.filter(d => d.direction === 'vertical').reduce((sum, d) => sum + d.length / 1000, 0);
    const mullionH = dividers.filter(d => d.direction === 'horizontal').reduce((sum, d) => sum + d.length / 1000, 0);
    const mullionUnitCost = ps ? (psRate ?? (ps.mullion_width_mm || 50) * 3) : 150;
    if (mullionV > 0) {
        items.push({
            category: "profile",
            name: "Mullion (Vertical)",
            qty: parseFloat(mullionV.toFixed(2)),
            uom: "m",
            unitCost: mullionUnitCost,
        });
    }
    if (mullionH > 0) {
        items.push({
            category: "profile",
            name: "Transom (Horizontal)",
            qty: parseFloat(mullionH.toFixed(2)),
            uom: "m",
            unitCost: mullionUnitCost,
        });
    }

    // 2. Glass — per pane from inline config (glass keys, gas, spacer)
    const gtId = window.glass_type_id
        ? (Array.isArray(window.glass_type_id) ? window.glass_type_id[0] : window.glass_type_id)
        : null;
    const gt = gtId && glassTypes ? glassTypes.find(g => g.id === gtId) : null;
    const defaultRate = gt ? gt.rate_per_sqm : 800;
    const gcDb = glassConfigs || [];

    for (let i = 0; i < panes.length; i++) {
        const pane = panes[i];
        const paneW = pane.bounds.w / 1000;
        const paneH = pane.bounds.h / 1000;
        const override = paneShapeOverride(pane);
        const paneArea = parseFloat((override ? override.areaM2 : paneW * paneH).toFixed(3));
        const panePerimeter = parseFloat((override ? override.perimeterM : 2 * (paneW + paneH)).toFixed(2));
        const pc = pane.config || {};
        const glazingType = pc.glazingType || 'double';

        // Helper: resolve OT from dynamic attrs or legacy fields
        const resolveOT = (gcfg, pos) => {
            const attrs = pc[`glass${pos}Attrs`];
            if (attrs && gcfg && gcfg.attributes && gcfg.attributes.length) {
                const otAttr = gcfg.attributes.find(a => a.name && a.name.toUpperCase() === 'OT');
                if (otAttr) {
                    const selId = attrs[String(otAttr.attr_id)];
                    if (selId) {
                        const selVal = otAttr.values.find(v => v.id === selId || String(v.id) === String(selId));
                        if (selVal) return selVal.name;
                    }
                    const defVal = otAttr.values.find(v => v.id === otAttr.default_value_id);
                    if (defVal) return defVal.name;
                }
                if (attrs['_ot']) return attrs['_ot'];
            }
            return pc[`glass${pos}OT`] || (gcfg ? gcfg.default_ot : null) || '4';
        };

        // Resolve glass config records from pane config keys
        const gc1 = pc.glass1Key ? gcDb.find(g => g.glass_key === pc.glass1Key) : null;
        const gc2 = pc.glass2Key ? gcDb.find(g => g.glass_key === pc.glass2Key) : null;
        const gc3 = pc.glass3Key ? gcDb.find(g => g.glass_key === pc.glass3Key) : null;

        const hasInlineConfig = gc1 || gc2 || gc3;

        if (hasInlineConfig) {
            // Build decomposed BOM from inline pane config
            const glassItems = [
                gc1 ? { name: gc1.label, label: "Outer Glass", ot: resolveOT(gc1, 1), gc: gc1 } : null,
                (glazingType !== 'single' && gc2) ? { name: gc2.label, label: glazingType === 'triple' ? "Middle Glass" : "Inner Glass", ot: resolveOT(gc2, 2), gc: gc2 } : null,
                (glazingType === 'triple' && gc3) ? { name: gc3.label, label: "Inner Glass", ot: resolveOT(gc3, 3), gc: gc3 } : null,
            ].filter(Boolean);

            for (const g of glassItems) {
                items.push({
                    category: "glass",
                    name: `P${i + 1} ${g.label}: ${g.name} (OT ${g.ot})`,
                    qty: paneArea,
                    uom: "m²",
                    unitCost: glassUnitCostPerM2(g.gc, g.ot, Math.round(defaultRate * 0.85 / glassItems.length)),
                });
            }

            // Spacer bar (double / triple)
            if (glazingType !== 'single') {
                const spacerType = pc.spacerType || 'warm_edge';
                const spacerLabel = spacerType.replace(/_/g, ' ');
                items.push({
                    category: "glass",
                    name: `P${i + 1} Spacer 1 (${spacerLabel})`,
                    qty: parseFloat(panePerimeter.toFixed(2)),
                    uom: "m",
                    unitCost: 15,
                });
                if (glazingType === 'triple') {
                    const spacerType2 = pc.spacerType2 || 'warm_edge';
                    const spacerLabel2 = spacerType2.replace(/_/g, ' ');
                    items.push({
                        category: "glass",
                        name: `P${i + 1} Spacer 2 (${spacerLabel2})`,
                        qty: parseFloat(panePerimeter.toFixed(2)),
                        uom: "m",
                        unitCost: 15,
                    });
                }
            }

            // Gas fill (double / triple with non-air gas)
            if (glazingType !== 'single') {
                const gas1 = pc.gasFill || 'air';
                const cav1 = pc.cavityWidth || 16;
                if (gas1 && gas1 !== 'air') {
                    const volume = parseFloat((paneArea * cav1 / 1000).toFixed(4));
                    items.push({
                        category: "glass",
                        name: `P${i + 1} Gas 1 (${gas1})`,
                        qty: volume,
                        uom: "m\u00B3",
                        unitCost: gas1 === 'argon' ? 200 : gas1 === 'krypton' ? 1500 : 3000,
                    });
                }
                if (glazingType === 'triple') {
                    const gas2 = pc.gasFill2 || 'air';
                    const cav2 = pc.cavityWidth2 || 16;
                    if (gas2 && gas2 !== 'air') {
                        const volume = parseFloat((paneArea * cav2 / 1000).toFixed(4));
                        items.push({
                            category: "glass",
                            name: `P${i + 1} Gas 2 (${gas2})`,
                            qty: volume,
                            uom: "m\u00B3",
                            unitCost: gas2 === 'argon' ? 200 : gas2 === 'krypton' ? 1500 : 3000,
                        });
                    }
                }
            }
        } else {
            // Fallback — single glass line per pane
            const rate = defaultRate;
            const multiplier = glazingType === 'triple' ? 1.5 : glazingType === 'single' ? 0.7 : 1.0;
            items.push({
                category: "glass",
                name: `Pane ${i + 1}: ${glazingType} glass`,
                qty: paneArea,
                uom: "m²",
                unitCost: Math.round(rate * multiplier),
            });
        }
    }

    // 3. Hardware — per pane. Resolves the user's actual hardwareSelections
    // (role → hardware_id, set in the Properties Panel) against the real
    // wincraft.hardware catalogue for its true name/unit_price; only falls
    // back to a generic guessed name/cost for roles the user hasn't picked
    // a specific product for yet. Previously this block ignored
    // hardwareSelections (and the `hardware` catalogue parameter) entirely
    // and always showed made-up placeholder costs.
    const hardwareDb = hardware || [];
    for (let i = 0; i < panes.length; i++) {
        const pc = panes[i].config || {};
        const ot = pc.openingType || "fixed";
        const hwSel = pc.hardwareSelections || {};

        const pushHardwareItem = (role, guessName, guessQty, guessUnitCost) => {
            const hwId = hwSel[role];
            const hwRec = hwId ? hardwareDb.find(h => h.id === hwId) : null;
            if (hwRec) {
                items.push({
                    category: "hardware",
                    name: `${hwRec.name} (Pane ${i + 1})`,
                    qty: hardwareQty(role, ot),
                    uom: "pc",
                    unitCost: hwRec.unit_price,
                });
            } else {
                items.push({ category: "hardware", name: `${guessName} (Pane ${i + 1})`, qty: guessQty, uom: "pc", unitCost: guessUnitCost });
            }
        };

        if (ot !== "fixed") {
            if (ot.startsWith("casement") || ot === "tiltturn") {
                pushHardwareItem("handle", "Handle", 1, 350);
                pushHardwareItem("hinge", "Hinges", 3, 120);
                if (ot === "tiltturn") {
                    pushHardwareItem("operator", "T&T Mechanism", 1, 800);
                }
            } else if (ot === "sliding") {
                pushHardwareItem("balance", "Roller Set", 2, 250);
                pushHardwareItem("track", "Track", 1, 400);
            } else if (ot === "awning") {
                pushHardwareItem("stay", "Friction Stay", 2, 280);
            }
            // Lock for every operable pane
            pushHardwareItem("lock", "Lock", 1, 180);
        }
    }

    // 4. Seals & Gaskets
    items.push({
        category: "seals",
        name: "Weather Seal (outer)",
        qty: parseFloat(perimeterM.toFixed(2)),
        uom: "m",
        unitCost: 25,
    });
    items.push({
        category: "seals",
        name: "Glazing Gasket",
        qty: parseFloat((perimeterM * 1.2).toFixed(2)),
        uom: "m",
        unitCost: 18,
    });
    if (dualColour) {
        items.push({
            category: "seals",
            name: "Dual Colour Adaptor",
            qty: parseFloat(perimeterM.toFixed(2)),
            uom: "m",
            unitCost: 35,
        });
    }

    // 5. Georgian Bars
    const gc = window.georgian_bar_config || {};
    if (gc.pattern && gc.pattern !== "none") {
        const hBars = gc.horizontalBars || 0;
        const vBars = gc.verticalBars || 0;
        let barLenH = 0;
        let barLenV = 0;
        for (const pane of panes) {
            barLenH += hBars * (pane.bounds.w / 1000);
            barLenV += vBars * (pane.bounds.h / 1000);
        }
        if (barLenH > 0) {
            items.push({
                category: "georgian",
                name: `Georgian Bar (Horizontal ×${hBars})`,
                qty: parseFloat(barLenH.toFixed(2)),
                uom: "m",
                unitCost: 45,
            });
        }
        if (barLenV > 0) {
            items.push({
                category: "georgian",
                name: `Georgian Bar (Vertical ×${vBars})`,
                qty: parseFloat(barLenV.toFixed(2)),
                uom: "m",
                unitCost: 45,
            });
        }
    }

    // 6. Frame Paint — Inside / Outside products from inventory.
    // Mirrors the server-side formula in wincraft_bom_builder._add_paint_lines:
    // perimeter proxy (Width + Height, in inches) × Paint Consumption/inch × Paint Layers.
    const perimeterIn = (widthMm + heightMm) / 25.4;
    const paintDb = paintProducts || [];
    const toId = (v) => (v ? (Array.isArray(v) ? v[0] : v) : null);
    const paintSides = [
        { side: "Inside", id: toId(window.inside_paint_product_id) },
        { side: "Outside", id: toId(window.outside_paint_product_id) },
    ].filter((s) => s.id);
    const paintByProduct = new Map();
    for (const { side, id } of paintSides) {
        const product = paintDb.find((p) => p.id === id);
        if (!product) continue;
        const perInch = product.x_paint_consumption_per_inch || 1.0;
        const layers = product.x_paint_layers || 1;
        const qty = perimeterIn * perInch * layers;
        const entry = paintByProduct.get(id) || { product, qty: 0, sides: [] };
        entry.qty += qty;
        entry.sides.push(side);
        paintByProduct.set(id, entry);
    }
    for (const { product, qty, sides } of paintByProduct.values()) {
        items.push({
            category: "paint",
            name: `${sides.join("/")} Paint: ${product.name}`,
            qty: parseFloat(qty.toFixed(2)),
            uom: "L",
            unitCost: product.standard_price || 0,
        });
    }

    // Group by category
    const grouped = {};
    for (const cat of Object.keys(CATEGORIES)) {
        grouped[cat] = { ...CATEGORIES[cat], key: cat, items: [] };
    }
    let totalCost = 0;
    let componentCount = 0;
    for (const item of items) {
        const lineCost = Math.round(item.qty * item.unitCost);
        const entry = { ...item, lineCost };
        grouped[item.category].items.push(entry);
        totalCost += lineCost;
        componentCount++;
    }

    const categories = Object.values(grouped).filter(c => c.items.length > 0);

    return { categories, totalCost, componentCount };
}
