import type { FillRegion } from "./types.js";
import type { LayerBounds } from "@genart-dev/core";

// ---------------------------------------------------------------------------
// Bounding box of a region
// ---------------------------------------------------------------------------

export interface RegionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Get the axis-aligned bounding box for a region. */
export function regionBounds(region: FillRegion, bounds: LayerBounds): RegionBounds {
  switch (region.type) {
    case "bounds":
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    case "rect":
      return { x: region.x, y: region.y, width: region.width, height: region.height };
    case "ellipse":
      return {
        x: region.cx - region.rx,
        y: region.cy - region.ry,
        width: region.rx * 2,
        height: region.ry * 2,
      };
    case "polygon": {
      if (region.points.length === 0) {
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      }
      let minX = region.points[0]!.x;
      let minY = region.points[0]!.y;
      let maxX = minX;
      let maxY = minY;
      for (const pt of region.points) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
  }
}

// ---------------------------------------------------------------------------
// Clip path construction
// ---------------------------------------------------------------------------

/** Apply the region as a canvas clip path on `ctx`. Call before drawing strokes. */
export function applyRegionClip(
  region: FillRegion,
  bounds: LayerBounds,
  ctx: CanvasRenderingContext2D,
): void {
  ctx.beginPath();
  buildRegionPath(region, bounds, ctx);
  ctx.clip();
}

/** Build the canvas path for a region (without clip/fill/stroke). */
export function buildRegionPath(
  region: FillRegion,
  bounds: LayerBounds,
  ctx: CanvasRenderingContext2D,
): void {
  switch (region.type) {
    case "bounds":
      ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
      break;
    case "rect":
      ctx.rect(region.x, region.y, region.width, region.height);
      break;
    case "ellipse":
      ctx.ellipse(region.cx, region.cy, region.rx, region.ry, 0, 0, Math.PI * 2);
      break;
    case "polygon": {
      const pts = region.points;
      if (pts.length < 3) break;
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i]!.x, pts[i]!.y);
      }
      ctx.closePath();
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Point-in-region test (for shading evaluation and stipple culling)
// ---------------------------------------------------------------------------

/** Returns true if (px, py) is inside the region. */
export function pointInRegion(
  px: number,
  py: number,
  region: FillRegion,
  bounds: LayerBounds,
): boolean {
  switch (region.type) {
    case "bounds":
      return (
        px >= bounds.x &&
        px <= bounds.x + bounds.width &&
        py >= bounds.y &&
        py <= bounds.y + bounds.height
      );
    case "rect":
      return (
        px >= region.x &&
        px <= region.x + region.width &&
        py >= region.y &&
        py <= region.y + region.height
      );
    case "ellipse": {
      const nx = (px - region.cx) / region.rx;
      const ny = (py - region.cy) / region.ry;
      return nx * nx + ny * ny <= 1;
    }
    case "polygon":
      return pointInPolygon(px, py, region.points);
  }
}

/** Ray-casting point-in-polygon test. */
function pointInPolygon(
  px: number,
  py: number,
  polygon: Array<{ x: number; y: number }>,
): boolean {
  const n = polygon.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i]!.x;
    const yi = polygon[i]!.y;
    const xj = polygon[j]!.x;
    const yj = polygon[j]!.y;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Inward polygon offset (for contour fills)
// ---------------------------------------------------------------------------

/**
 * Compute an inward offset of a polygon by `dist` pixels using
 * vertex angle-bisector offset (works well for convex and mildly concave polygons).
 * Returns null if the resulting polygon is degenerate (too small).
 */
export function offsetPolygon(
  polygon: Array<{ x: number; y: number }>,
  dist: number,
): Array<{ x: number; y: number }> | null {
  const n = polygon.length;
  if (n < 3) return null;

  const result: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < n; i++) {
    const prev = polygon[(i - 1 + n) % n]!;
    const curr = polygon[i]!;
    const next = polygon[(i + 1) % n]!;

    // Edge vectors
    const e1x = curr.x - prev.x;
    const e1y = curr.y - prev.y;
    const e2x = next.x - curr.x;
    const e2y = next.y - curr.y;

    // Inward normals (rotate 90°, pointing inward for CW winding)
    const len1 = Math.sqrt(e1x * e1x + e1y * e1y);
    const len2 = Math.sqrt(e2x * e2x + e2y * e2y);
    if (len1 < 1e-8 || len2 < 1e-8) continue;

    const n1x =  e1y / len1;
    const n1y = -e1x / len1;
    const n2x =  e2y / len2;
    const n2y = -e2x / len2;

    // Bisector direction
    let bx = n1x + n2x;
    let by = n1y + n2y;
    const bLen = Math.sqrt(bx * bx + by * by);

    if (bLen < 1e-8) {
      // Parallel edges — use normal directly
      bx = n1x;
      by = n1y;
    } else {
      bx /= bLen;
      by /= bLen;
    }

    // Scale bisector so the offset is `dist` along each edge normal
    const dot = n1x * bx + n1y * by;
    const scale = Math.abs(dot) > 1e-6 ? dist / dot : dist;
    // Clamp scale to avoid extreme miter at very sharp corners
    const clampedScale = Math.min(Math.abs(scale), dist * 4) * Math.sign(scale);

    result.push({ x: curr.x + bx * clampedScale, y: curr.y + by * clampedScale });
  }

  if (result.length < 3) return null;

  // Check if the offset polygon has reasonable area
  const area = Math.abs(polygonArea(result));
  if (area < 1) return null;

  return result;
}

function polygonArea(polygon: Array<{ x: number; y: number }>): number {
  let area = 0;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += polygon[j]!.x * polygon[i]!.y;
    area -= polygon[i]!.x * polygon[j]!.y;
  }
  return area / 2;
}

/**
 * Convert a region to a polygon representation (for contour/offset ops).
 * Ellipses and rects are approximated with polygon vertices.
 */
export function regionToPolygon(
  region: FillRegion,
  bounds: LayerBounds,
): Array<{ x: number; y: number }> {
  switch (region.type) {
    case "bounds":
      return [
        { x: bounds.x, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y + bounds.height },
      ];
    case "rect":
      return [
        { x: region.x, y: region.y },
        { x: region.x + region.width, y: region.y },
        { x: region.x + region.width, y: region.y + region.height },
        { x: region.x, y: region.y + region.height },
      ];
    case "ellipse": {
      const pts: Array<{ x: number; y: number }> = [];
      const steps = 48;
      for (let i = 0; i < steps; i++) {
        const theta = (i / steps) * Math.PI * 2;
        pts.push({
          x: region.cx + Math.cos(theta) * region.rx,
          y: region.cy + Math.sin(theta) * region.ry,
        });
      }
      return pts;
    }
    case "polygon":
      return region.points;
  }
}
