/** @odoo-module **/
/**
 * WinCraft Studio — Unit Conversion Utilities
 * All internal storage is in mm. These helpers convert for display/input
 * when the unit system is set to imperial.
 */

const MM_PER_INCH = 25.4;

/**
 * Convert mm to inches (rounded to 1/16").
 * @param {number} mm
 * @returns {number}
 */
export function mmToInch(mm) {
    return mm / MM_PER_INCH;
}

/**
 * Convert inches to mm.
 * @param {number} inches
 * @returns {number}
 */
export function inchToMm(inches) {
    return Math.round(inches * MM_PER_INCH);
}

/**
 * Format mm as a display string based on the unit system.
 * @param {number} mm
 * @param {"metric"|"imperial"} unitSystem
 * @returns {string}  e.g. "1200 mm" or "47.24 in"
 */
export function formatDimension(mm, unitSystem) {
    if (unitSystem === 'imperial') {
        return `${mmToInch(mm).toFixed(2)} in`;
    }
    return `${Math.round(mm)} mm`;
}

/**
 * Get the unit label abbreviation.
 * @param {"metric"|"imperial"} unitSystem
 * @returns {string}
 */
export function unitLabel(unitSystem) {
    return unitSystem === 'imperial' ? 'in' : 'mm';
}

/**
 * Convert a display value (in the current unit system) to mm for storage.
 * @param {number} value  — the number the user typed
 * @param {"metric"|"imperial"} unitSystem
 * @returns {number}  mm value (rounded integer)
 */
export function displayToMm(value, unitSystem) {
    if (unitSystem === 'imperial') {
        return inchToMm(value);
    }
    return Math.round(value);
}

/**
 * Convert mm to display value in current unit system.
 * @param {number} mm
 * @param {"metric"|"imperial"} unitSystem
 * @returns {number}
 */
export function mmToDisplay(mm, unitSystem) {
    if (unitSystem === 'imperial') {
        return Number.parseFloat(mmToInch(mm).toFixed(2));
    }
    return Math.round(mm);
}

/**
 * Format area based on unit system.
 * @param {number} sqm — area in square meters
 * @param {"metric"|"imperial"} unitSystem
 * @returns {string}
 */
export function formatArea(sqm, unitSystem) {
    if (unitSystem === 'imperial') {
        const sqft = sqm * 10.7639;
        return `${sqft.toFixed(2)} sq ft`;
    }
    return `${sqm.toFixed(3)} m²`;
}

const DEFAULT_FRACTION_DENOMINATOR = 16;

/**
 * Format decimal inches as a construction-style fraction, rounded to the
 * nearest 1/16" (Canadian/US fabricator convention) and reduced, e.g.
 * 47.24 -> "47 1/4", 48.0 -> "48". No unit suffix — callers already show
 * the unit separately (see `dimUnit` usage in properties_panel.xml).
 * @param {number} inches
 * @param {number} [denominator] — must be a power of 2
 * @returns {string}
 */
export function formatInchesAsFraction(inches, denominator = DEFAULT_FRACTION_DENOMINATOR) {
    const whole = Math.trunc(inches);
    let numerator = Math.round((inches - whole) * denominator);
    let denom = denominator;
    if (numerator === denom) {
        return `${whole + 1}`;
    }
    if (numerator === 0) {
        return `${whole}`;
    }
    while (numerator % 2 === 0) {
        numerator /= 2;
        denom /= 2;
    }
    return `${whole} ${numerator}/${denom}`;
}

/**
 * Parse a dimension string typed by the user back into decimal inches.
 * Accepts fraction form ("47 1/4", "47-1/4"), bare fraction ("3/4"), or
 * plain decimal ("47.25"). Returns NaN if unparseable.
 * @param {string|number} value
 * @returns {number}
 */
export function parseInchesFraction(value) {
    if (typeof value === 'number') return value;
    const parts = String(value).trim().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
    if (!parts.length || parts.length > 2) return NaN;
    if (parts.length === 1) {
        return parts[0].includes('/') ? fractionTokenToDecimal(parts[0]) : Number.parseFloat(parts[0]);
    }
    const whole = Number.parseFloat(parts[0]);
    const frac = fractionTokenToDecimal(parts[1]);
    return Number.isNaN(whole) || Number.isNaN(frac) ? NaN : whole + frac;
}

function fractionTokenToDecimal(token) {
    const [numStr, denStr] = token.split('/');
    const num = Number.parseInt(numStr, 10);
    const den = Number.parseInt(denStr, 10);
    return den ? num / den : NaN;
}
