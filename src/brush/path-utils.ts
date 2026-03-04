import type { StrokePoint } from "./types.js";

// ---------------------------------------------------------------------------
// Centripetal Catmull-Rom spline interpolation
// ---------------------------------------------------------------------------

/**
 * Interpolate stroke points using a centripetal Catmull-Rom spline.
 *
 * @param points - Raw input points (minimum 2).
 * @param smoothing - 0 = return raw points, 1 = full spline with subdivisions.
 * @returns Interpolated points with linearly-interpolated pressure.
 */
export function interpolatePath(
  points: readonly StrokePoint[],
  smoothing: number,
): StrokePoint[] {
  if (points.length < 2) return [...points];
  if (smoothing <= 0) return [...points];

  // Number of subdivisions between each pair of control points.
  // At smoothing=1 we insert 8 intermediate points per segment.
  const subdivisions = Math.max(1, Math.round(smoothing * 8));

  const result: StrokePoint[] = [];

  // Pad the control point array: duplicate first and last for boundary conditions.
  const padded: StrokePoint[] = [
    points[0]!,
    ...points,
    points[points.length - 1]!,
  ];

  for (let i = 1; i < padded.length - 2; i++) {
    const p0 = padded[i - 1]!;
    const p1 = padded[i]!;
    const p2 = padded[i + 1]!;
    const p3 = padded[i + 2]!;

    // Knot parameterization (centripetal: alpha = 0.5)
    const t0 = 0;
    const t1 = t0 + knotInterval(p0, p1, 0.5);
    const t2 = t1 + knotInterval(p1, p2, 0.5);
    const t3 = t2 + knotInterval(p2, p3, 0.5);

    for (let s = 0; s < subdivisions; s++) {
      const t = t1 + (s / subdivisions) * (t2 - t1);
      const pt = catmullRomPoint(p0, p1, p2, p3, t0, t1, t2, t3, t);

      // Linearly interpolate pressure between p1 and p2
      const segT = s / subdivisions;
      const pressure = lerp(p1.pressure ?? 1, p2.pressure ?? 1, segT);

      result.push({ x: pt.x, y: pt.y, pressure });
    }
  }

  // Always include the last point
  const last = points[points.length - 1]!;
  result.push({ x: last.x, y: last.y, pressure: last.pressure });

  return result;
}

/** Knot interval for centripetal parameterization. */
function knotInterval(a: StrokePoint, b: StrokePoint, alpha: number): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  return Math.pow(d2, alpha * 0.5) || 1e-6;
}

/** Evaluate a centripetal Catmull-Rom spline at parameter t. */
function catmullRomPoint(
  p0: StrokePoint,
  p1: StrokePoint,
  p2: StrokePoint,
  p3: StrokePoint,
  t0: number,
  t1: number,
  t2: number,
  t3: number,
  t: number,
): { x: number; y: number } {
  const a1x = ((t1 - t) / (t1 - t0)) * p0.x + ((t - t0) / (t1 - t0)) * p1.x;
  const a1y = ((t1 - t) / (t1 - t0)) * p0.y + ((t - t0) / (t1 - t0)) * p1.y;
  const a2x = ((t2 - t) / (t2 - t1)) * p1.x + ((t - t1) / (t2 - t1)) * p2.x;
  const a2y = ((t2 - t) / (t2 - t1)) * p1.y + ((t - t1) / (t2 - t1)) * p2.y;
  const a3x = ((t3 - t) / (t3 - t2)) * p2.x + ((t - t2) / (t3 - t2)) * p3.x;
  const a3y = ((t3 - t) / (t3 - t2)) * p2.y + ((t - t2) / (t3 - t2)) * p3.y;

  const b1x = ((t2 - t) / (t2 - t0)) * a1x + ((t - t0) / (t2 - t0)) * a2x;
  const b1y = ((t2 - t) / (t2 - t0)) * a1y + ((t - t0) / (t2 - t0)) * a2y;
  const b2x = ((t3 - t) / (t3 - t1)) * a2x + ((t - t1) / (t3 - t1)) * a3x;
  const b2y = ((t3 - t) / (t3 - t1)) * a2y + ((t - t1) / (t3 - t1)) * a3y;

  const cx = ((t2 - t) / (t2 - t1)) * b1x + ((t - t1) / (t2 - t1)) * b2x;
  const cy = ((t2 - t) / (t2 - t1)) * b1y + ((t - t1) / (t2 - t1)) * b2y;

  return { x: cx, y: cy };
}

// ---------------------------------------------------------------------------
// Arc-length parameterization
// ---------------------------------------------------------------------------

export interface ArcLengthTable {
  /** Total arc length of the path. */
  readonly totalLength: number;
  /** Sample position + pressure at a given distance from the start. */
  sampleAt(distance: number): StrokePoint;
}

/**
 * Build an arc-length lookup table from an array of points.
 * Uses binary search for O(log n) `sampleAt()` queries.
 */
export function arcLengthParameterize(
  points: readonly StrokePoint[],
): ArcLengthTable {
  if (points.length === 0) {
    return {
      totalLength: 0,
      sampleAt: () => ({ x: 0, y: 0, pressure: 1 }),
    };
  }
  if (points.length === 1) {
    const p = points[0]!;
    return {
      totalLength: 0,
      sampleAt: () => ({ x: p.x, y: p.y, pressure: p.pressure ?? 1 }),
    };
  }

  // Compute cumulative arc lengths
  const cumLengths = new Float64Array(points.length);
  cumLengths[0] = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    cumLengths[i] = cumLengths[i - 1]! + Math.sqrt(dx * dx + dy * dy);
  }

  const totalLength = cumLengths[points.length - 1]!;

  function sampleAt(distance: number): StrokePoint {
    if (distance <= 0) {
      const p = points[0]!;
      return { x: p.x, y: p.y, pressure: p.pressure ?? 1 };
    }
    if (distance >= totalLength) {
      const p = points[points.length - 1]!;
      return { x: p.x, y: p.y, pressure: p.pressure ?? 1 };
    }

    // Binary search for the segment containing `distance`
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cumLengths[mid]! <= distance) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const segStart = cumLengths[lo]!;
    const segEnd = cumLengths[hi]!;
    const segLen = segEnd - segStart;
    const t = segLen > 0 ? (distance - segStart) / segLen : 0;

    const a = points[lo]!;
    const b = points[hi]!;

    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      pressure: lerp(a.pressure ?? 1, b.pressure ?? 1, t),
    };
  }

  return { totalLength, sampleAt };
}

// ---------------------------------------------------------------------------
// Taper
// ---------------------------------------------------------------------------

/**
 * Compute a taper scale factor (0–1) based on position along the stroke.
 *
 * Linear ramp from 0→1 over `taperStart` px at the beginning,
 * and from 1→0 over `taperEnd` px at the end.
 * Returns 1.0 where both tapers are inactive.
 */
export function taperScale(
  distanceFromStart: number,
  totalLength: number,
  taperStart: number,
  taperEnd: number,
): number {
  let scale = 1.0;

  if (taperStart > 0 && distanceFromStart < taperStart) {
    scale = Math.min(scale, distanceFromStart / taperStart);
  }

  if (taperEnd > 0) {
    const distanceFromEnd = totalLength - distanceFromStart;
    if (distanceFromEnd < taperEnd) {
      scale = Math.min(scale, distanceFromEnd / taperEnd);
    }
  }

  return Math.max(0, scale);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
