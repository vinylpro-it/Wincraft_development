/** @odoo-module **/
/**
 * WinCraft Studio — Canvas State Utilities
 * Undo/redo history, snap-to-grid, and selection helpers.
 */

console.log("[WinCraft] ✓ LOADED: utils/canvas_state.js");

/** Maximum undo history depth. */
const MAX_HISTORY = 50;

/**
 * Create a new history manager instance.
 *
 * @returns {{ push: Function, undo: Function, redo: Function, canUndo: Function, canRedo: Function }}
 */
export function createHistoryManager() {
    /** @type {Array<any>} */
    const past = [];
    /** @type {Array<any>} */
    const future = [];

    return {
        /**
         * Push a new state snapshot onto the history stack.
         *
         * @param {any} state - A serialisable canvas snapshot.
         */
        push(state) {
            past.push(JSON.parse(JSON.stringify(state)));
            if (past.length > MAX_HISTORY) {
                past.shift();
            }
            // New action invalidates the redo stack
            future.length = 0;
        },

        /**
         * Undo: return the previous state or null.
         *
         * @param {any} currentState - The current canvas state to save for redo.
         * @returns {any|null}
         */
        undo(currentState) {
            if (past.length === 0) return null;
            future.push(JSON.parse(JSON.stringify(currentState)));
            return JSON.parse(JSON.stringify(past.pop()));
        },

        /**
         * Redo: restore a previously undone state.
         *
         * @param {any} currentState - The current canvas state to save for undo.
         * @returns {any|null}
         */
        redo(currentState) {
            if (future.length === 0) return null;
            past.push(JSON.parse(JSON.stringify(currentState)));
            return JSON.parse(JSON.stringify(future.pop()));
        },

        /** @returns {boolean} */
        canUndo() { return past.length > 0; },

        /** @returns {boolean} */
        canRedo() { return future.length > 0; },

        /** Reset the entire history. */
        reset() {
            past.length = 0;
            future.length = 0;
        },
    };
}

/**
 * Snap a pixel value to the nearest grid cell.
 *
 * @param {number} value - Pixel position.
 * @param {number} gridSize - Grid cell size in pixels (default 24).
 * @returns {number}
 */
export function snapToGrid(value, gridSize = 24) {
    return Math.round(value / gridSize) * gridSize;
}

/**
 * Clamp a value between min and max.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * Check whether two axis-aligned bounding boxes overlap.
 *
 * @param {{ x: number, y: number, w: number, h: number }} a
 * @param {{ x: number, y: number, w: number, h: number }} b
 * @returns {boolean}
 */
export function aabbOverlap(a, b) {
    return (
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y
    );
}

/**
 * Get the combined bounding box of a set of window records.
 *
 * @param {Array<{ canvas_x: number, canvas_y: number, canvas_w: number, canvas_h: number }>} windows
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function getBoundingBox(windows) {
    if (!windows.length) return { x: 0, y: 0, w: 0, h: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const win of windows) {
        minX = Math.min(minX, win.x);
        minY = Math.min(minY, win.y);
        maxX = Math.max(maxX, win.x + win.w);
        maxY = Math.max(maxY, win.y + win.h);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Create a debounce wrapper.
 *
 * @param {Function} fn - Function to debounce.
 * @param {number} delay - Delay in milliseconds.
 * @returns {Function}
 */
export function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * Convert a world-space point (mm) to screen-space pixels.
 * @param {{ x: number, y: number }} worldPt - Point in mm.
 * @param {{ scale: number, offsetX: number, offsetY: number }} t - Canvas transform.
 * @returns {{ x: number, y: number }}
 */
export function worldToScreen(worldPt, t) {
    return {
        x: worldPt.x * t.scale + t.offsetX,
        y: worldPt.y * t.scale + t.offsetY,
    };
}

/**
 * Convert a screen-space pixel point to world-space mm.
 * @param {{ x: number, y: number }} screenPt - Point in screen pixels.
 * @param {{ scale: number, offsetX: number, offsetY: number }} t - Canvas transform.
 * @returns {{ x: number, y: number }}
 */
export function screenToWorld(screenPt, t) {
    return {
        x: (screenPt.x - t.offsetX) / t.scale,
        y: (screenPt.y - t.offsetY) / t.scale,
    };
}
