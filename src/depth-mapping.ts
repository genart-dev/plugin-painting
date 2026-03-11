/**
 * Depth mapping for algorithm stroke paths (ADR 072).
 *
 * Maps L-system or recursive depth values to brush parameters via
 * linear interpolation. Depth 0 (root/trunk) uses the start value,
 * depth=maxDepth (leaf/tip) uses the end value. Values beyond maxDepth
 * clamp to the end value.
 */

import type { AlgorithmStrokePath } from "./path-source.js";
import type { StrokePoint, BrushStroke } from "./brush/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A [start, end] interpolation range. Start applies at depth 0, end at maxDepth. */
export type DepthRange = readonly [start: number, end: number];

/**
 * Depth mapping configuration — controls how algorithm path depth
 * translates to brush rendering parameters.
 */
export interface DepthMapping {
  /** Maximum depth value for interpolation. Depths beyond this clamp to end values. */
  readonly maxDepth: number;
  /** Width interpolation range [rootWidth, tipWidth] in pixels. */
  readonly width?: DepthRange;
  /** Pressure interpolation range [rootPressure, tipPressure] (0–1). */
  readonly pressure?: DepthRange;
  /** Paint load interpolation range [rootLoad, tipLoad] (0–1). Mapped to stroke opacity. */
  readonly paintLoad?: DepthRange;
  /** Opacity interpolation range [rootOpacity, tipOpacity] (0–1). */
  readonly opacity?: DepthRange;
}

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

/** Linear interpolation between a and b by t ∈ [0, 1]. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Compute normalized depth fraction [0, 1], clamped. */
function depthFraction(depth: number, maxDepth: number): number {
  if (maxDepth <= 0) return 0;
  return Math.min(1, Math.max(0, depth / maxDepth));
}

/** Interpolate a value from a DepthRange at the given depth fraction. */
function interpolateRange(range: DepthRange | undefined, t: number, fallback: number): number {
  if (!range) return fallback;
  return lerp(range[0], range[1], t);
}

// ---------------------------------------------------------------------------
// Apply depth mapping
// ---------------------------------------------------------------------------

/**
 * Convert algorithm stroke paths to BrushStroke objects with depth-based
 * parameter interpolation.
 *
 * @param paths      Algorithm stroke paths (with depth metadata).
 * @param mapping    Depth-to-parameter mapping configuration.
 * @param brushId    Brush preset ID.
 * @param color      Stroke color (hex string).
 * @param baseSeed   PRNG seed.
 * @returns BrushStroke array with depth-interpolated parameters.
 */
export function applyDepthMapping(
  paths: readonly AlgorithmStrokePath[],
  mapping: DepthMapping,
  brushId: string,
  color: string,
  baseSeed?: number,
): BrushStroke[] {
  const strokes: BrushStroke[] = [];

  for (const path of paths) {
    if (path.points.length < 2) continue;

    const depth = path.depth ?? 0;
    const t = depthFraction(depth, mapping.maxDepth);

    const width = interpolateRange(mapping.width, t, path.width ?? 1);
    const pressure = interpolateRange(mapping.pressure, t, 1.0);
    const paintLoad = interpolateRange(mapping.paintLoad, t, 1.0);
    const opacity = interpolateRange(mapping.opacity, t, 1.0);

    // Combine paintLoad into opacity (paintLoad modulates overall stroke density)
    const effectiveOpacity = opacity * paintLoad;

    const points: StrokePoint[] = path.points.map((pt, i) => {
      // Per-point pressure from algorithm, scaled by depth-mapped pressure
      const pointPressure = (path.pressure?.[i] ?? 1.0) * pressure;
      return { x: pt.x, y: pt.y, pressure: pointPressure };
    });

    strokes.push({
      brushId,
      color,
      opacity: effectiveOpacity,
      size: width,
      points,
      seed: baseSeed,
    });
  }

  return strokes;
}

// ---------------------------------------------------------------------------
// JSON parsing
// ---------------------------------------------------------------------------

/**
 * Parse a depthMapping JSON string into a DepthMapping object.
 * Returns `null` if the string is empty or invalid.
 */
export function parseDepthMapping(json: string): DepthMapping | null {
  if (!json) return null;
  try {
    const obj = JSON.parse(json);
    if (typeof obj !== "object" || obj === null) return null;
    if (typeof obj.maxDepth !== "number" || obj.maxDepth < 0) return null;

    const mapping: DepthMapping = { maxDepth: obj.maxDepth };
    const result: Record<string, unknown> = { maxDepth: obj.maxDepth };

    for (const key of ["width", "pressure", "paintLoad", "opacity"] as const) {
      if (Array.isArray(obj[key]) && obj[key].length === 2) {
        const [a, b] = obj[key];
        if (typeof a === "number" && typeof b === "number") {
          result[key] = [a, b] as DepthRange;
        }
      }
    }

    return result as unknown as DepthMapping;
  } catch {
    return null;
  }
}
