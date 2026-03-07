import type { ShadingFunction, ShadingAffect } from "./types.js";
import { createValueNoise } from "../shared/noise.js";

// ---------------------------------------------------------------------------
// Shading evaluator
// ---------------------------------------------------------------------------

/**
 * Build a shading evaluator function for the given ShadingFunction definition.
 * Returns a function (x, y) → [0, 1] where 1 = maximum density/weight/opacity.
 *
 * Coordinate system: x and y are canvas pixel coordinates.
 * For linear/radial shading, regionOrigin and regionSize are used to
 * normalise positions into [0,1] space.
 */
export function buildShadingEvaluator(
  shading: ShadingFunction,
  regionX: number,
  regionY: number,
  regionW: number,
  regionH: number,
): (x: number, y: number) => number {
  switch (shading.type) {
    case "uniform":
      return () => 1;

    case "linear": {
      const rad = (shading.angle * Math.PI) / 180;
      const dx = Math.cos(rad);
      const dy = Math.sin(rad);
      const [lo, hi] = shading.range;
      return (x, y) => {
        // Project normalised position onto the direction vector
        const nx = regionW > 0 ? (x - regionX) / regionW : 0;
        const ny = regionH > 0 ? (y - regionY) / regionH : 0;
        const t = (nx * dx + ny * dy + 1) / 2; // remap [-1,1] → [0,1]
        return lo + (hi - lo) * Math.max(0, Math.min(1, t));
      };
    }

    case "radial": {
      const [lo, hi] = shading.range;
      return (x, y) => {
        // cx/cy are in normalised [0,1] region space
        const nx = regionW > 0 ? (x - regionX) / regionW : 0;
        const ny = regionH > 0 ? (y - regionY) / regionH : 0;
        const dist = Math.sqrt((nx - shading.cx) ** 2 + (ny - shading.cy) ** 2);
        // dist 0 at center, ~1 at corner (max ~sqrt(2) for corner of unit square)
        const t = Math.max(0, Math.min(1, dist / 0.7071));
        return lo + (hi - lo) * t;
      };
    }

    case "noise": {
      const noise = createValueNoise(shading.seed);
      const [lo, hi] = shading.range;
      const scale = shading.scale > 0 ? shading.scale : 1;
      return (x, y) => {
        const raw = noise(x / (regionW * scale + 1), y / (regionH * scale + 1));
        return lo + (hi - lo) * raw;
      };
    }

    case "algorithm": {
      const [lo, hi] = shading.range;
      const algData = typeof globalThis !== "undefined"
        ? (globalThis as any).__genart_data
        : undefined;
      const channel: Float32Array | undefined =
        algData && algData[shading.channel] instanceof Float32Array
          ? algData[shading.channel]
          : undefined;

      if (!channel) {
        // No data available — return uniform lo value
        return () => lo;
      }

      const cols: number = algData.cols ?? 1;
      const rows: number = algData.rows ?? 1;

      return (x, y) => {
        // Normalise pixel coords to [0,1] within the region
        const nx = regionW > 0 ? (x - regionX) / regionW : 0;
        const ny = regionH > 0 ? (y - regionY) / regionH : 0;

        // Bilinear sample from the scalar grid
        const gx = Math.max(0, Math.min(cols - 1, nx * (cols - 1)));
        const gy = Math.max(0, Math.min(rows - 1, ny * (rows - 1)));
        const x0 = Math.min(cols - 2, Math.floor(gx));
        const y0 = Math.min(rows - 2, Math.floor(gy));
        const x1 = x0 + 1;
        const y1 = y0 + 1;
        const tx = gx - x0;
        const ty = gy - y0;

        // Scalar channel: single values. Vector channel: take every 3rd (magnitude).
        const isVector = channel.length === cols * rows * 3;
        const stride = isVector ? 3 : 1;
        const offset = isVector ? 2 : 0; // magnitude is 3rd element in vector triples

        const v00 = channel[y0 * cols * stride + x0 * stride + offset] ?? 0;
        const v10 = channel[y0 * cols * stride + x1 * stride + offset] ?? 0;
        const v01 = channel[y1 * cols * stride + x0 * stride + offset] ?? 0;
        const v11 = channel[y1 * cols * stride + x1 * stride + offset] ?? 0;

        const raw = (v00 * (1 - tx) + v10 * tx) * (1 - ty) +
                    (v01 * (1 - tx) + v11 * tx) * ty;

        return lo + (hi - lo) * Math.max(0, Math.min(1, raw));
      };
    }

    default:
      return () => 1;
  }
}

// ---------------------------------------------------------------------------
// Apply shading value to path properties
// ---------------------------------------------------------------------------

/**
 * Given a shading value [0,1] and the set of affected properties,
 * compute opacity and size scale factors for a generated path.
 */
export function applyShadingToPath(
  shadingValue: number,
  affects: ShadingAffect[],
): { opacityScale: number; sizeScale: number } {
  let opacityScale = 1;
  let sizeScale = 1;

  for (const affect of affects) {
    switch (affect) {
      case "opacity":
        opacityScale *= shadingValue;
        break;
      case "weight":
        sizeScale *= Math.max(0.1, shadingValue);
        break;
      case "density":
        // Density is handled at generation time (probabilistic culling / spacing).
        // No post-generation scale needed.
        break;
    }
  }

  return { opacityScale, sizeScale };
}
