/** @odoo-module **/
/**
 * WinCraft Studio — Panel Tree Utilities
 *
 * Recursive binary tree model for window panel layout.
 * Replaces the flat panels_horizontal / panels_vertical / mullion_positions grid.
 *
 * Tree node types:
 *   Leaf:  { type: "leaf",  id: string, config: PaneConfig }
 *   Split: { type: "split", id: string, direction: "vertical"|"horizontal",
 *            position: number (mm, absolute within window), first: Node, second: Node }
 *
 * direction="vertical"   → divider bar is vertical (splits left ↔ right)
 * direction="horizontal" → divider bar is horizontal (splits top ↔ bottom)
 */

console.log("[WinCraft] ✓ LOADED: utils/panel_tree.js");

/* ─── ID generation ───────────────────────────────────────────── */

let _panelSeq = 0;

function nextId(prefix = "p") {
    return `${prefix}${++_panelSeq}_${Date.now().toString(36)}`;
}

/** Reset sequence (useful for tests). */
export function resetIdSequence() {
    _panelSeq = 0;
}

/* ─── Default pane config ─────────────────────────────────────── */

const DEFAULT_CONFIG = Object.freeze({
    openingType: "fixed",
    hinge: "left",
    glazingType: "double",
    glass1Key: null,
    glass1Attrs: {},
    glass2Key: null,
    glass2Attrs: {},
    glass3Key: null,
    glass3Attrs: {},
    cavityWidth: 16,
    gasFill: "air",
    spacerType: "warm_edge",
    cavityWidth2: 16,
    gasFill2: "air",
    spacerType2: "warm_edge",
    glassTint: "clear",
    label: null,
});

function defaultConfig(overrides) {
    return { ...DEFAULT_CONFIG, ...(overrides || {}) };
}

/* ─── Node constructors ───────────────────────────────────────── */

/**
 * Create a leaf panel node.
 * @param {Object} [config] - pane configuration overrides
 * @returns {{ type: "leaf", id: string, config: Object }}
 */
export function createLeaf(config) {
    return { type: "leaf", id: nextId("p"), config: defaultConfig(config) };
}

/**
 * Create a split node.
 * @param {"vertical"|"horizontal"} direction
 * @param {number} position - absolute mm within window frame
 * @param {Object} first  - first child node (left/top)
 * @param {Object} second - second child node (right/bottom)
 * @returns {{ type: "split", id: string, direction: string, position: number, first: Object, second: Object }}
 */
export function createSplit(direction, position, first, second) {
    return {
        type: "split",
        id: nextId("s"),
        direction,
        position,
        first,
        second,
    };
}

/**
 * Create a single-pane tree (no splits).
 */
export function createSinglePane(config) {
    return createLeaf(config);
}

/* ─── Tree traversal ──────────────────────────────────────────── */

/**
 * Find a node by ID, returning { node, parent, childKey } or null.
 */
export function findNode(tree, nodeId) {
    if (!tree) return null;
    if (tree.id === nodeId) return { node: tree, parent: null, childKey: null };
    if (tree.type === "split") {
        if (tree.first && tree.first.id === nodeId) {
            return { node: tree.first, parent: tree, childKey: "first" };
        }
        if (tree.second && tree.second.id === nodeId) {
            return { node: tree.second, parent: tree, childKey: "second" };
        }
        const inFirst = findNode(tree.first, nodeId);
        if (inFirst) return inFirst;
        return findNode(tree.second, nodeId);
    }
    return null;
}

/**
 * Get all leaf panels in left-to-right, top-to-bottom order.
 * @returns {Array<{ id: string, config: Object }>}
 */
export function getLeafPanels(tree) {
    if (!tree) return [];
    if (tree.type === "leaf") return [tree];
    return [...getLeafPanels(tree.first), ...getLeafPanels(tree.second)];
}

/**
 * Count leaf panels.
 */
export function countLeaves(tree) {
    if (!tree) return 0;
    if (tree.type === "leaf") return 1;
    return countLeaves(tree.first) + countLeaves(tree.second);
}

/**
 * Get all split (divider) nodes.
 * @returns {Array<{ id: string, direction: string, position: number }>}
 */
export function getSplitNodes(tree) {
    if (!tree || tree.type === "leaf") return [];
    return [
        { id: tree.id, direction: tree.direction, position: tree.position, first: tree.first, second: tree.second },
        ...getSplitNodes(tree.first),
        ...getSplitNodes(tree.second),
    ];
}

/* ─── Tree mutations (return new trees, do not mutate) ────────── */

/**
 * Split a leaf panel into two.
 * @param {Object} tree - current panel tree
 * @param {string} panelId - ID of the leaf to split
 * @param {"vertical"|"horizontal"} direction - split direction
 * @param {number} positionMm - absolute position for the divider
 * @param {Object} [firstConfig] - config for first (left/top) child
 * @param {Object} [secondConfig] - config for second (right/bottom) child
 * @returns {Object} new tree with the split applied
 */
export function splitPanel(tree, panelId, direction, positionMm, firstConfig, secondConfig) {
    if (!tree) return tree;
    if (tree.type === "leaf") {
        if (tree.id === panelId) {
            return createSplit(
                direction,
                positionMm,
                createLeaf(firstConfig || tree.config),
                createLeaf(secondConfig || { ...tree.config }),
            );
        }
        return tree;
    }
    // Split node — recurse
    const newFirst = splitPanel(tree.first, panelId, direction, positionMm, firstConfig, secondConfig);
    const newSecond = splitPanel(tree.second, panelId, direction, positionMm, firstConfig, secondConfig);
    if (newFirst === tree.first && newSecond === tree.second) return tree;
    return { ...tree, first: newFirst, second: newSecond };
}

/**
 * Merge a leaf panel back — removes the parent split, keeping sibling.
 * @param {Object} tree - current panel tree
 * @param {string} panelId - ID of the leaf to merge away
 * @returns {Object} new tree with the merge applied
 */
export function mergePanel(tree, panelId) {
    if (!tree || tree.type === "leaf") return tree;
    // If this split contains the target as a direct child, replace split with sibling
    if (tree.first && tree.first.id === panelId) return tree.second;
    if (tree.second && tree.second.id === panelId) return tree.first;
    // Recurse
    const newFirst = mergePanel(tree.first, panelId);
    const newSecond = mergePanel(tree.second, panelId);
    if (newFirst === tree.first && newSecond === tree.second) return tree;
    return { ...tree, first: newFirst, second: newSecond };
}

/**
 * Move a divider to a new position.
 * @param {Object} tree
 * @param {string} splitId - ID of the split node whose divider to move
 * @param {number} newPositionMm - new absolute position in mm
 * @returns {Object} new tree
 */
export function moveDivider(tree, splitId, newPositionMm) {
    if (!tree) return tree;
    if (tree.type === "leaf") return tree;
    if (tree.id === splitId) {
        return { ...tree, position: newPositionMm };
    }
    const newFirst = moveDivider(tree.first, splitId, newPositionMm);
    const newSecond = moveDivider(tree.second, splitId, newPositionMm);
    if (newFirst === tree.first && newSecond === tree.second) return tree;
    return { ...tree, first: newFirst, second: newSecond };
}

/**
 * Default mullion (split node) configuration.
 */
export function defaultMullionConfig(overrides = {}) {
    return {
        thickness_mm: null,     // null = use frame-derived default
        material: null,         // null = inherit from frame
        colour: null,           // null = inherit from frame colour
        ...overrides,
    };
}

/**
 * Update a split (mullion) node's config.
 * @param {Object} tree
 * @param {string} splitId
 * @param {Object} configPatch - partial config to merge
 * @returns {Object} new tree
 */
export function updateSplitConfig(tree, splitId, configPatch) {
    if (!tree || tree.type === 'leaf') return tree;
    if (tree.id === splitId) {
        return { ...tree, config: { ...(tree.config || {}), ...configPatch } };
    }
    const newFirst = updateSplitConfig(tree.first, splitId, configPatch);
    const newSecond = updateSplitConfig(tree.second, splitId, configPatch);
    if (newFirst === tree.first && newSecond === tree.second) return tree;
    return { ...tree, first: newFirst, second: newSecond };
}

/**
 * Update a leaf panel's config.
 */
export function updateLeafConfig(tree, panelId, configPatch) {
    if (!tree) return tree;
    if (tree.type === "leaf") {
        if (tree.id === panelId) {
            return { ...tree, config: { ...tree.config, ...configPatch } };
        }
        return tree;
    }
    const newFirst = updateLeafConfig(tree.first, panelId, configPatch);
    const newSecond = updateLeafConfig(tree.second, panelId, configPatch);
    if (newFirst === tree.first && newSecond === tree.second) return tree;
    return { ...tree, first: newFirst, second: newSecond };
}

/* ─── Bounds computation ──────────────────────────────────────── */

/**
 * Compute absolute bounds {x, y, w, h} in mm for every leaf panel.
 * @param {Object} tree
 * @param {{ x: number, y: number, w: number, h: number }} bounds - the containing area
 * @param {number} [mullionThickness=20] - mullion bar thickness in mm
 * @returns {Array<{ id: string, config: Object, bounds: {x,y,w,h} }>}
 */
export function computePaneBounds(tree, bounds, mullionThickness = 20) {
    if (!tree) return [];
    const halfBar = mullionThickness / 2;

    if (tree.type === "leaf") {
        return [{ id: tree.id, config: tree.config, bounds: { ...bounds } }];
    }

    // Split node — divide bounds at the split position
    const { direction, position } = tree;

    if (direction === "vertical") {
        // Vertical divider at absolute X = position
        // Clamp position to within bounds
        const splitX = Math.max(bounds.x + halfBar, Math.min(position, bounds.x + bounds.w - halfBar));
        const firstBounds = {
            x: bounds.x,
            y: bounds.y,
            w: splitX - bounds.x - halfBar,
            h: bounds.h,
        };
        const secondBounds = {
            x: splitX + halfBar,
            y: bounds.y,
            w: bounds.x + bounds.w - splitX - halfBar,
            h: bounds.h,
        };
        return [
            ...computePaneBounds(tree.first, firstBounds, mullionThickness),
            ...computePaneBounds(tree.second, secondBounds, mullionThickness),
        ];
    } else {
        // Horizontal divider at absolute Y = position
        const splitY = Math.max(bounds.y + halfBar, Math.min(position, bounds.y + bounds.h - halfBar));
        const firstBounds = {
            x: bounds.x,
            y: bounds.y,
            w: bounds.w,
            h: splitY - bounds.y - halfBar,
        };
        const secondBounds = {
            x: bounds.x,
            y: splitY + halfBar,
            w: bounds.w,
            h: bounds.y + bounds.h - splitY - halfBar,
        };
        return [
            ...computePaneBounds(tree.first, firstBounds, mullionThickness),
            ...computePaneBounds(tree.second, secondBounds, mullionThickness),
        ];
    }
}

/**
 * Get all divider lines with their start/end coordinates in mm.
 * Unlike flat mullions which span full width/height, tree dividers
 * only span within their parent panel's bounds.
 *
 * @param {Object} tree
 * @param {{ x: number, y: number, w: number, h: number }} bounds
 * @param {number} [mullionThickness=20]
 * @returns {Array<{ id: string, direction: string, position: number,
 *                   x1: number, y1: number, x2: number, y2: number,
 *                   length: number }>} length is in mm, matching x1/y1/x2/y2.
 */
export function getDividerLines(tree, bounds, mullionThickness = 20) {
    if (!tree || tree.type === "leaf") return [];
    const halfBar = mullionThickness / 2;

    const lines = [];
    const { direction, position } = tree;

    if (direction === "vertical") {
        const splitX = Math.max(bounds.x + halfBar, Math.min(position, bounds.x + bounds.w - halfBar));
        lines.push({
            id: tree.id,
            direction: "vertical",
            position: splitX,
            x1: splitX, y1: bounds.y,
            x2: splitX, y2: bounds.y + bounds.h,
            length: bounds.h, // mm — a vertical divider spans the panel height
            config: tree.config || null,
        });
        // Recurse into children with their bounds
        const firstBounds = { x: bounds.x, y: bounds.y, w: splitX - bounds.x - halfBar, h: bounds.h };
        const secondBounds = { x: splitX + halfBar, y: bounds.y, w: bounds.x + bounds.w - splitX - halfBar, h: bounds.h };
        lines.push(...getDividerLines(tree.first, firstBounds, mullionThickness));
        lines.push(...getDividerLines(tree.second, secondBounds, mullionThickness));
    } else {
        const splitY = Math.max(bounds.y + halfBar, Math.min(position, bounds.y + bounds.h - halfBar));
        lines.push({
            id: tree.id,
            direction: "horizontal",
            position: splitY,
            x1: bounds.x, y1: splitY,
            x2: bounds.x + bounds.w, y2: splitY,
            length: bounds.w, // mm — a horizontal divider spans the panel width
            config: tree.config || null,
        });
        const firstBounds = { x: bounds.x, y: bounds.y, w: bounds.w, h: splitY - bounds.y - halfBar };
        const secondBounds = { x: bounds.x, y: splitY + halfBar, w: bounds.w, h: bounds.y + bounds.h - splitY - halfBar };
        lines.push(...getDividerLines(tree.first, firstBounds, mullionThickness));
        lines.push(...getDividerLines(tree.second, secondBounds, mullionThickness));
    }

    return lines;
}

/* ─── Conversion: flat grid ↔ tree ────────────────────────────── */

/**
 * Convert legacy flat mullion_positions + panels_h/v to a panel tree.
 * Creates a grid-compatible tree (all mullions span full width/height).
 *
 * Strategy: split by vertical positions first (columns), then by horizontal (rows).
 */
export function treeFromGrid(panelsH, panelsV, widthMm, heightMm, mullionPositions, paneConfigs) {
    panelsH = panelsH || 1;
    panelsV = panelsV || 1;

    // Get sorted positions, or compute equal-division positions
    let vPositions = [];
    let hPositions = [];
    if (mullionPositions && mullionPositions.length > 0) {
        vPositions = mullionPositions
            .filter(m => m.orientation === "vertical")
            .map(m => m.positionMm)
            .sort((a, b) => a - b);
        hPositions = mullionPositions
            .filter(m => m.orientation === "horizontal")
            .map(m => m.positionMm)
            .sort((a, b) => a - b);
    }
    // Fill in equal positions if mullionPositions is empty
    if (vPositions.length === 0 && panelsH > 1) {
        for (let c = 1; c < panelsH; c++) {
            vPositions.push(Math.round(widthMm * c / panelsH));
        }
    }
    if (hPositions.length === 0 && panelsV > 1) {
        for (let r = 1; r < panelsV; r++) {
            hPositions.push(Math.round(heightMm * r / panelsV));
        }
    }

    const configs = paneConfigs || [];

    // Build row tree using horizontal positions, then within each row split by vertical positions
    function buildColumnTree(colPositions, rowIndex, totalCols) {
        if (colPositions.length === 0) {
            const paneIndex = rowIndex * totalCols;
            return createLeaf(configs[paneIndex] || {});
        }
        const pos = colPositions[0];
        const rest = colPositions.slice(1);
        const leftLeaf = createLeaf(configs[rowIndex * totalCols + (totalCols - 1 - rest.length - 1)] || {});
        // Actually build this properly with index tracking
        return _buildVSplits(colPositions, rowIndex, totalCols, 0, configs);
    }

    function _buildVSplits(vPos, rowIdx, totalCols, colOffset, cfgs) {
        if (vPos.length === 0) {
            const idx = rowIdx * totalCols + colOffset;
            return createLeaf(cfgs[idx] || {});
        }
        const pos = vPos[0];
        const first = createLeaf(cfgs[rowIdx * totalCols + colOffset] || {});
        const rest = vPos.slice(1);
        const second = _buildVSplits(rest, rowIdx, totalCols, colOffset + 1, cfgs);
        return createSplit("vertical", pos, first, second);
    }

    function _buildHSplits(hPos, vPos, totalCols, rowOffset, cfgs) {
        if (hPos.length === 0) {
            return _buildVSplits(vPos, rowOffset, totalCols, 0, cfgs);
        }
        const pos = hPos[0];
        const first = _buildVSplits(vPos, rowOffset, totalCols, 0, cfgs);
        const rest = hPos.slice(1);
        const second = _buildHSplits(rest, vPos, totalCols, rowOffset + 1, cfgs);
        return createSplit("horizontal", pos, first, second);
    }

    const totalCols = Math.max(1, vPositions.length + 1);
    return _buildHSplits(hPositions, vPositions, totalCols, 0, configs);
}

/**
 * Convert a panel tree back to flat grid format for backward compatibility.
 * This is an approximate conversion — works perfectly for grid-like trees,
 * but complex T-shaped trees lose some nuance.
 *
 * @returns {{ panelsH: number, panelsV: number, mullionPositions: Array, paneConfigs: Array }}
 */
export function treeToGrid(tree, widthMm, heightMm) {
    const leaves = getLeafPanels(tree);
    const dividers = getSplitNodes(tree);

    const vDividers = dividers.filter(d => d.direction === "vertical");
    const hDividers = dividers.filter(d => d.direction === "horizontal");

    // Deduplicate positions (for grid-like trees, same-level splits share positions)
    const vPositions = [...new Set(vDividers.map(d => d.position))].sort((a, b) => a - b);
    const hPositions = [...new Set(hDividers.map(d => d.position))].sort((a, b) => a - b);

    const mullionPositions = [
        ...vPositions.map(p => ({ orientation: "vertical", positionMm: p })),
        ...hPositions.map(p => ({ orientation: "horizontal", positionMm: p })),
    ];

    const paneConfigs = leaves.map(l => l.config || {});

    return {
        panelsH: vPositions.length + 1,
        panelsV: hPositions.length + 1,
        mullionPositions,
        paneConfigs,
    };
}

/* ─── Smart split helpers ─────────────────────────────────────── */

/**
 * Split a panel at the midpoint of its current bounds.
 * Automatically computes the position based on the panel's actual bounds in the tree.
 */
export function splitPanelAtMidpoint(tree, panelId, direction, widthMm, heightMm, mullionThickness = 20) {
    const allBounds = computePaneBounds(tree, { x: 0, y: 0, w: widthMm, h: heightMm }, mullionThickness);
    const panelBounds = allBounds.find(b => b.id === panelId);
    if (!panelBounds) return tree;

    const { bounds } = panelBounds;
    let positionMm;
    if (direction === "vertical") {
        positionMm = Math.round(bounds.x + bounds.w / 2);
    } else {
        positionMm = Math.round(bounds.y + bounds.h / 2);
    }

    return splitPanel(tree, panelId, direction, positionMm);
}

/**
 * Check if a panel can be split (has enough room).
 * Minimum panel width/height after split: 80mm.
 */
export function canSplitPanel(tree, panelId, direction, widthMm, heightMm, mullionThickness = 20) {
    const MIN_PANEL = 80;
    const allBounds = computePaneBounds(tree, { x: 0, y: 0, w: widthMm, h: heightMm }, mullionThickness);
    const panelBounds = allBounds.find(b => b.id === panelId);
    if (!panelBounds) return false;

    const { bounds } = panelBounds;
    if (direction === "vertical") {
        return bounds.w >= (MIN_PANEL * 2 + mullionThickness);
    } else {
        return bounds.h >= (MIN_PANEL * 2 + mullionThickness);
    }
}

/**
 * Check if a panel can be merged (has a sibling to merge with).
 */
export function canMergePanel(tree, panelId) {
    const result = findNode(tree, panelId);
    return result && result.parent && result.parent.type === "split";
}

/* ─── Validation ──────────────────────────────────────────────── */

/**
 * Validate the panel tree. Returns an array of validation results.
 */
export function validateTree(tree, widthMm, heightMm, mullionThickness = 20) {
    const results = [];
    const MIN_PANEL = 80;
    const MIN_EDGE = 50;

    const bounds = { x: 0, y: 0, w: widthMm, h: heightMm };
    const paneBounds = computePaneBounds(tree, bounds, mullionThickness);
    const dividers = getDividerLines(tree, bounds, mullionThickness);

    // Check each leaf panel's size
    for (const pane of paneBounds) {
        if (pane.bounds.w < MIN_PANEL) {
            results.push({
                panelId: pane.id,
                field: "width",
                severity: "error",
                message: `Panel width ${Math.round(pane.bounds.w)}mm is below minimum ${MIN_PANEL}mm`,
            });
        }
        if (pane.bounds.h < MIN_PANEL) {
            results.push({
                panelId: pane.id,
                field: "height",
                severity: "error",
                message: `Panel height ${Math.round(pane.bounds.h)}mm is below minimum ${MIN_PANEL}mm`,
            });
        }
    }

    // Check divider positions relative to frame edges
    for (const div of dividers) {
        if (div.direction === "vertical") {
            if (div.position < MIN_EDGE) {
                results.push({
                    panelId: div.id,
                    field: "mullion",
                    severity: "error",
                    message: `Vertical divider at ${Math.round(div.position)}mm too close to left edge (min ${MIN_EDGE}mm)`,
                });
            }
            if (div.position > widthMm - MIN_EDGE) {
                results.push({
                    panelId: div.id,
                    field: "mullion",
                    severity: "error",
                    message: `Vertical divider at ${Math.round(div.position)}mm too close to right edge`,
                });
            }
        } else {
            if (div.position < MIN_EDGE) {
                results.push({
                    panelId: div.id,
                    field: "mullion",
                    severity: "error",
                    message: `Horizontal divider at ${Math.round(div.position)}mm too close to top edge`,
                });
            }
            if (div.position > heightMm - MIN_EDGE) {
                results.push({
                    panelId: div.id,
                    field: "mullion",
                    severity: "error",
                    message: `Horizontal divider at ${Math.round(div.position)}mm too close to bottom edge`,
                });
            }
        }
    }

    return results;
}

/* ─── Deep clone helper ───────────────────────────────────────── */

export function cloneTree(tree) {
    if (!tree) return null;
    return JSON.parse(JSON.stringify(tree));
}
