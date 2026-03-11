/**
 * Parse algorithm stroke paths from `window.__genart_data` (ADR 072).
 *
 * Follows the `"algorithm:channelName"` convention established by
 * `parseField()` in vector-field.ts (ADR 062).
 */

import type { StrokePoint, BrushStroke } from "./brush/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A point on an algorithm-generated path (canvas coordinates). */
export interface AlgorithmPathPoint {
  readonly x: number;
  readonly y: number;
}

/** A stroke path published by an algorithm. */
export interface AlgorithmStrokePath {
  readonly points: readonly AlgorithmPathPoint[];
  readonly pressure?: readonly number[];
  readonly width?: number;
  readonly depth?: number;
  readonly group?: string;
  readonly meta?: Readonly<Record<string, number>>;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a `pathSource` property string and return algorithm stroke paths.
 *
 * Supported formats:
 *   - `"algorithm:channelName"` — reads from `globalThis.__genart_data[channelName]`
 *
 * Returns an empty array if the source is empty, unrecognized, or the
 * algorithm hasn't published data yet.
 */
export function parsePathSource(pathSource: string): AlgorithmStrokePath[] {
  if (!pathSource) return [];

  if (pathSource.startsWith("algorithm:")) {
    const channelName = pathSource.slice("algorithm:".length);
    const algData =
      typeof globalThis !== "undefined"
        ? (globalThis as any).__genart_data
        : undefined;

    if (algData && Array.isArray(algData[channelName])) {
      return algData[channelName] as AlgorithmStrokePath[];
    }
    return [];
  }

  // Unrecognized format
  return [];
}

// ---------------------------------------------------------------------------
// Conversion: AlgorithmStrokePath → BrushStroke
// ---------------------------------------------------------------------------

export interface PathConversionOptions {
  /** Brush preset ID to use for all strokes. */
  readonly brushId: string;
  /** Stroke color as hex string. */
  readonly color: string;
  /** Base opacity override (0–1). */
  readonly opacity?: number;
  /** Base size override in pixels. */
  readonly size?: number;
  /** PRNG seed for scatter/jitter. */
  readonly seed?: number;
  /** Optional group filter — only convert paths with this group key. */
  readonly groupFilter?: string;
}

/**
 * Convert algorithm stroke paths to BrushStroke objects.
 *
 * Each AlgorithmStrokePath becomes one BrushStroke. Per-point pressure
 * is mapped to StrokePoint.pressure. The path's `width` field overrides
 * the base `size` option if present.
 */
export function convertPathsToStrokes(
  paths: readonly AlgorithmStrokePath[],
  options: PathConversionOptions,
): BrushStroke[] {
  const { brushId, color, opacity, size, seed, groupFilter } = options;
  const strokes: BrushStroke[] = [];

  for (const path of paths) {
    if (path.points.length < 2) continue;
    if (groupFilter !== undefined && path.group !== groupFilter) continue;

    const points: StrokePoint[] = path.points.map((pt, i) => ({
      x: pt.x,
      y: pt.y,
      pressure: path.pressure?.[i] ?? 1.0,
    }));

    strokes.push({
      brushId,
      color,
      opacity,
      size: path.width ?? size,
      points,
      seed,
    });
  }

  return strokes;
}
