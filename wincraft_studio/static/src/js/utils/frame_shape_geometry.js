/** @odoo-module **/
/**
 * WinCraft Studio — Frame shape geometry helpers.
 *
 * The design canvas can fit a window into a non-rectangular frame
 * (circle, arch, octagon, custom outline, ...) but area/perimeter math
 * used to default to the bounding box (width × height). This module
 * mirrors the outlines drawn by `frame()` in window_svg.js so the glass
 * clip, the live BOM panel, and the saved BOM/quotation all agree on the
 * true shape of the frame.
 */

/**
 * Rise of an 'arched'/'gothic' frame — the vertical distance from the
 * springline (where the curve starts) up to the peak, in whatever unit
 * `width`/`height` are given in (px or mm; both window_svg.js's frame()
 * and the boundary functions below call this with their own native unit).
 * Real shop drawings dimension an arch by Width + Rise, not just a plain
 * bounding-box width/height — this is the single source of truth for that
 * "Rise" value so it isn't hand-duplicated per caller.
 */
export function getArchRise(frameShape, width, height) {
    if (frameShape === 'arched') return Math.min(width / 2, height * 0.35);
    if (frameShape === 'gothic') return height * 0.35;
    return 0;
}

function quadraticBezierPoints(p0, p1, p2, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const mt = 1 - t;
        pts.push([
            mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
            mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
        ]);
    }
    return pts;
}

/**
 * Ordered (x, y) mm points tracing the frame outline for `frameShape`.
 * Curved shapes are sampled into short segments; `samples` controls
 * how many points approximate a full revolution (circle) or arch.
 */
export function getShapeBoundaryMm(frameShape, widthMm, heightMm, frameShapePoints = null, samples = 72) {
    const w = widthMm, h = heightMm;

    switch (frameShape) {
        case 'circle': {
            const r = Math.min(w, h) / 2;
            const cx = w / 2, cy = h / 2;
            const pts = [];
            for (let i = 0; i < samples; i++) {
                const a = (2 * Math.PI * i) / samples;
                pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
            }
            return pts;
        }
        case 'half_circle': {
            const r = w / 2;
            const n = Math.max(8, Math.floor(samples / 2));
            const arc = [];
            for (let i = 0; i <= n; i++) {
                const a = (Math.PI * i) / n;
                arc.push([r - r * Math.cos(a), r - r * Math.sin(a)]);
            }
            return [...arc, [w, h], [0, h]];
        }
        case 'arched': {
            const archR = getArchRise('arched', w, h);
            const n = Math.max(4, Math.floor(samples / 4));
            const curve = [
                ...quadraticBezierPoints([0, archR], [0, 0], [w / 2, 0], n),
                ...quadraticBezierPoints([w / 2, 0], [w, 0], [w, archR], n).slice(1),
            ];
            return [[0, h], ...curve, [w, h]];
        }
        case 'gothic': {
            const cp = w * 0.15;
            const peakH = getArchRise('gothic', w, h);
            const n = Math.max(4, Math.floor(samples / 4));
            const curve = [
                ...quadraticBezierPoints([0, peakH], [cp, 0], [w / 2, 0], n),
                ...quadraticBezierPoints([w / 2, 0], [w - cp, 0], [w, peakH], n).slice(1),
            ];
            return [[0, h], ...curve, [w, h]];
        }
        case 'triangle':
            return [[w / 2, 0], [0, h], [w, h]];
        case 'trapezoid': {
            const inset = w * 0.15;
            return [[inset, 0], [w - inset, 0], [w, h], [0, h]];
        }
        case 'rake': {
            const rakeH = h * 0.25;
            return [[0, rakeH], [w, 0], [w, h], [0, h]];
        }
        case 'octagon': {
            const cut = Math.min(w, h) * 0.29;
            return [
                [cut, 0], [w - cut, 0], [w, cut], [w, h - cut],
                [w - cut, h], [cut, h], [0, h - cut], [0, cut],
            ];
        }
        case 'custom':
            if (frameShapePoints && frameShapePoints.length >= 3) {
                return frameShapePoints.map(p => [p.x * w, p.y * h]);
            }
            // No points yet — fall through to rectangular.
            return [[0, 0], [w, 0], [w, h], [0, h]];
        default:
            return [[0, 0], [w, 0], [w, h], [0, h]];
    }
}

export function polygonAreaPerimeterMm(pts) {
    const n = pts.length;
    if (n < 3) return { areaMm2: 0, perimeterMm: 0 };
    let area = 0;
    let perimeter = 0;
    for (let i = 0; i < n; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % n];
        area += x1 * y2 - x2 * y1;
        perimeter += Math.hypot(x2 - x1, y2 - y1);
    }
    return { areaMm2: Math.abs(area) / 2, perimeterMm: perimeter };
}

function polygonSignedArea(pts) {
    let area = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % n];
        area += x1 * y2 - x2 * y1;
    }
    return area / 2;
}

function segmentIntersection(p1, p2, a, b) {
    const [x1, y1] = p1, [x2, y2] = p2;
    const [ax, ay] = a, [bx, by] = b;
    const d1x = x2 - x1, d1y = y2 - y1;
    const d2x = bx - ax, d2y = by - ay;
    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-9) return p2;
    const t = ((ax - x1) * d2y - (ay - y1) * d2x) / denom;
    return [x1 + d1x * t, y1 + d1y * t];
}

/**
 * Sutherland-Hodgman intersection of `subjectPts` against the convex
 * polygon `clipPts`. Orientation of `clipPts` (CW/CCW) is detected from
 * its signed area, so callers don't need to pre-normalize winding
 * direction — but `clipPts` itself MUST be convex, or the inside/outside
 * test per edge is wrong and the result is garbage.
 *
 * Callers should pass a pane's rectangular bounds as `clipPts` and a
 * frame outline (from getShapeBoundaryMm/insetBoundaryTowardCentroid) as
 * `subjectPts` — not the other way round. `insetBoundaryTowardCentroid`
 * shrinks each outline point toward the polygon's vertex-average
 * centroid by a fixed Euclidean distance, which is only an approximation
 * of a true offset curve; on curved shapes (arched/gothic) this can
 * leave a few sample points near the peak slightly non-convex. A
 * rectangle is always convex, so using it as the clip side keeps the
 * algorithm's correctness guarantee regardless of that wiggle.
 */
export function clipPolygonToShape(subjectPts, clipPts) {
    if (!clipPts || clipPts.length < 3) return subjectPts;
    const ccw = polygonSignedArea(clipPts) >= 0;
    let output = subjectPts;
    const n = clipPts.length;
    for (let i = 0; i < n && output.length > 0; i++) {
        const a = clipPts[i];
        const b = clipPts[(i + 1) % n];
        const cross = ([x, y]) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
        const input = output;
        output = [];
        for (let j = 0; j < input.length; j++) {
            const cur = input[j];
            const prev = input[(j + input.length - 1) % input.length];
            const curIn = ccw ? cross(cur) >= 0 : cross(cur) <= 0;
            const prevIn = ccw ? cross(prev) >= 0 : cross(prev) <= 0;
            if (curIn) {
                if (!prevIn) output.push(segmentIntersection(prev, cur, a, b));
                output.push(cur);
            } else if (prevIn) {
                output.push(segmentIntersection(prev, cur, a, b));
            }
        }
    }
    return output;
}

/**
 * Area (m²) + perimeter (m) for the frame outline.
 *
 * 'circle' and 'half_circle' use their closed-form formulas directly
 * (matching the Python mirror in wincraft_window.py) instead of the
 * sampled boundary, so pricing/BOM numbers are exact rather than
 * carrying a polygon-approximation error. Straight-edge shapes
 * (triangle, trapezoid, rake, octagon, custom) are already exact
 * polygons. Only the Bezier-curved tops (arched, gothic) are sampled.
 */
export function getShapeAreaPerimeter(frameShape, widthMm, heightMm, frameShapePoints = null) {
    const w = widthMm, h = heightMm;

    if (frameShape === 'circle') {
        const r = Math.min(w, h) / 2;
        return { areaM2: (Math.PI * r * r) / 1_000_000, perimeterM: (2 * Math.PI * r) / 1000 };
    }
    if (frameShape === 'half_circle') {
        const r = w / 2;
        const bodyH = Math.max(0, h - r);
        const areaMm2 = w * bodyH + (Math.PI * r * r) / 2;
        const perimeterMm = w + 2 * bodyH + Math.PI * r;
        return { areaM2: areaMm2 / 1_000_000, perimeterM: perimeterMm / 1000 };
    }

    const pts = getShapeBoundaryMm(frameShape, widthMm, heightMm, frameShapePoints);
    const { areaMm2, perimeterMm } = polygonAreaPerimeterMm(pts);
    return { areaM2: areaMm2 / 1_000_000, perimeterM: perimeterMm / 1000 };
}

/** True when `frameShape` is anything other than a plain rectangle. */
export function isShapedFrame(frameShape) {
    return !!frameShape && frameShape !== 'rectangular';
}

/**
 * Shrink a closed point list toward its own centroid by `insetPx`.
 * Used to derive the inner (glazing) boundary from the outer frame
 * outline without hand-tuning a separate inset formula per shape —
 * exact for a circle (gives radius r − insetPx) and a close visual
 * approximation for the other star-convex outlines.
 */
export function insetBoundaryTowardCentroid(points, insetPx) {
    const n = points.length;
    if (n === 0) return points;
    const cx = points.reduce((s, p) => s + p[0], 0) / n;
    const cy = points.reduce((s, p) => s + p[1], 0) / n;
    return points.map(([x, y]) => {
        const dx = x - cx, dy = y - cy;
        const dist = Math.hypot(dx, dy) || 1;
        const scale = Math.max(0, (dist - insetPx) / dist);
        return [cx + dx * scale, cy + dy * scale];
    });
}
