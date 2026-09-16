import type {
  LayerTypeDefinition,
  LayerPropertySchema,
  LayerProperties,
  LayerBounds,
  RenderResources,
  ValidationError,
} from "@genart-dev/core";
import type { FillRegion } from "./fill/types.js";
import { regionToPolygon } from "./fill/region-utils.js";
import { createFractalNoise, createValueNoise } from "./shared/noise.js";
import { createOffscreenCanvas } from "./brush/stamp-renderer.js";

// A flat wash laid inside a region in one pass, the way a loaded brush floods
// a shape on dry paper. Built for washes that strokes cannot make: every
// arrangement of wash strokes shows its structure (bands, bars, overlapping
// rows), while a real wash has no direction at all. Its only structure is
// where the pigment pooled as it dried (a darker rim just inside the edge),
// low-frequency mottling, fine granulation and a ragged edge.
//
// Additive, not a modifier: it writes straight-alpha colour to its own
// surface and never reads the pixels under it, so the compositor's blend
// mode, opacity and masks all apply to it.

// ---------------------------------------------------------------------------
// Property schema
// ---------------------------------------------------------------------------

const WASH_PROPERTIES: LayerPropertySchema[] = [
  { key: "region", label: "Region (JSON)", type: "string", default: '{"type":"bounds"}', group: "wash" },
  { key: "color", label: "Color", type: "color", default: "#8c867c", group: "wash" },
  { key: "density", label: "Density", type: "number", default: 0.5, min: 0, max: 1, step: 0.01, group: "wash" },
  {
    key: "gradient",
    label: "Gradient (JSON)",
    type: "string",
    // {"angle": degrees, "from": multiplier, "to": multiplier} across the region
    default: "",
    group: "wash",
  },
  { key: "pool", label: "Edge Pooling", type: "number", default: 0.35, min: 0, max: 1, step: 0.01, group: "edge" },
  { key: "poolWidth", label: "Pool Width", type: "number", default: 6, min: 0.5, max: 100, step: 0.5, group: "edge" },
  {
    key: "edgeWeights",
    label: "Edge Weights (JSON)",
    type: "string",
    // One number per polygon vertex, scaling the pooling along each edge
    default: "",
    group: "edge",
  },
  { key: "ragged", label: "Ragged Edge", type: "number", default: 2, min: 0, max: 50, step: 0.5, group: "edge" },
  { key: "raggedScale", label: "Ragged Scale", type: "number", default: 12, min: 1, max: 200, step: 1, group: "edge" },
  { key: "feather", label: "Feather", type: "number", default: 1, min: 0.5, max: 50, step: 0.5, group: "edge" },
  { key: "mottle", label: "Mottle", type: "number", default: 0.3, min: 0, max: 1, step: 0.01, group: "texture" },
  { key: "mottleScale", label: "Mottle Scale", type: "number", default: 80, min: 4, max: 1000, step: 1, group: "texture" },
  // Streaks: the mottle stretched along mottleAngle (degrees) by mottleStretch
  { key: "mottleAngle", label: "Mottle Angle", type: "number", default: 90, min: -180, max: 180, step: 1, group: "texture" },
  { key: "mottleStretch", label: "Mottle Stretch", type: "number", default: 1, min: 1, max: 10, step: 0.1, group: "texture" },
  { key: "granulation", label: "Granulation", type: "number", default: 0.2, min: 0, max: 1, step: 0.01, group: "texture" },
  { key: "granScale", label: "Granulation Scale", type: "number", default: 3, min: 1, max: 50, step: 0.5, group: "texture" },
  { key: "seed", label: "Seed", type: "number", default: 0, min: 0, max: 99999, step: 1, group: "texture" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Pt {
  x: number;
  y: number;
}

interface WashGradient {
  angle: number;
  from: number;
  to: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampSigned(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** The x positions where the row at `y` crosses the polygon, sorted. */
function rowCrossings(poly: Pt[], y: number): number[] {
  const xs: number[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  return xs.sort((p, q) => p - q);
}

/**
 * Render the wash into straight-alpha RGBA covering `box` (canvas pixels).
 * Exported for tests; the layer draws the result over its target.
 */
export function renderWashPixels(
  properties: LayerProperties,
  bounds: LayerBounds,
): { data: Uint8ClampedArray; x: number; y: number; width: number; height: number } | null {
  const region = parseJson<FillRegion>(properties.region, { type: "bounds" });
  // Device pixels per layout unit (ADR 111). The bounds arrive already scaled,
  // so everything that comes from the properties instead — the region's own
  // coordinates and every length below — is scaled to match. Noise is sampled
  // as position/scale, so scaling the scales keeps each feature the same
  // physical size and the wash looks identical, just resolved finer.
  const sc = bounds.scale ?? 1;
  const rawPoly = regionToPolygon(region, bounds);
  const poly =
    sc === 1 || region.type === "bounds"
      ? rawPoly
      : rawPoly.map((pt) => ({ x: pt.x * sc, y: pt.y * sc }));
  if (poly.length < 3) return null;

  const [cr, cg, cb] = hexToRgb((properties.color as string) ?? "#8c867c");
  const density = (properties.density as number) ?? 0.5;
  const pool = (properties.pool as number) ?? 0.35;
  const poolWidth = Math.max(0.5, (properties.poolWidth as number) ?? 6) * sc;
  const ragged = ((properties.ragged as number) ?? 2) * sc;
  const raggedScale = Math.max(1, (properties.raggedScale as number) ?? 12) * sc;
  const feather = Math.max(0.5, (properties.feather as number) ?? 1) * sc;
  const mottle = (properties.mottle as number) ?? 0.3;
  const mottleScale = Math.max(4, (properties.mottleScale as number) ?? 80) * sc;
  const mottleStretch = Math.max(1, (properties.mottleStretch as number) ?? 1);
  // Value noise is built on a square lattice with axis-aligned gradients, so
  // at large scales its blotches come out square. Sampling it in a frame
  // rotated off the axes (and stretched along the streak) hides the lattice.
  const mAngle = (((properties.mottleAngle as number) ?? 90) * Math.PI) / 180 + 0.61;
  const mCos = Math.cos(mAngle);
  const mSin = Math.sin(mAngle);
  const granulation = (properties.granulation as number) ?? 0.2;
  const granScale = Math.max(1, (properties.granScale as number) ?? 3) * sc;
  const seed = (properties.seed as number) ?? 0;
  const gradient = parseJson<WashGradient | null>(properties.gradient, null);
  const weightsIn = parseJson<number[] | null>(properties.edgeWeights, null);
  const weights = Array.isArray(weightsIn) && weightsIn.length === poly.length ? weightsIn : null;

  // Region box, grown by how far the ragged edge can push out past it
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const grow = ragged + feather + 1;
  const x0 = Math.max(Math.floor(bounds.x), Math.floor(minX - grow));
  const y0 = Math.max(Math.floor(bounds.y), Math.floor(minY - grow));
  const x1 = Math.min(Math.ceil(bounds.x + bounds.width), Math.ceil(maxX + grow));
  const y1 = Math.min(Math.ceil(bounds.y + bounds.height), Math.ceil(maxY + grow));
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) return null;

  // Distances beyond this band change nothing: the pool has decayed and the
  // ragged edge cannot reach, so the search only looks at nearby edges.
  const band = Math.max(poolWidth * 5, ragged + feather + 2);

  const raggedNoise = createFractalNoise(seed + 101, 3);
  const mottleNoise = createFractalNoise(seed + 202, 3);
  const granNoise = createValueNoise(seed + 303);

  let gdx = 0, gdy = 0, gMin = 0, gSpan = 1;
  if (gradient) {
    const a = ((gradient.angle ?? 0) * Math.PI) / 180;
    gdx = Math.cos(a);
    gdy = Math.sin(a);
    gMin = Infinity;
    let gMax = -Infinity;
    for (const p of poly) {
      const t = p.x * gdx + p.y * gdy;
      if (t < gMin) gMin = t;
      if (t > gMax) gMax = t;
    }
    gSpan = gMax - gMin || 1;
  }

  const n = poly.length;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let py = 0; py < height; py++) {
    const y = y0 + py + 0.5;
    const xs = rowCrossings(poly, y);

    // Edges whose vertical extent comes within the band of this row
    const near: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % n]!;
      if (Math.min(a.y, b.y) - band <= y && Math.max(a.y, b.y) + band >= y) near.push(i);
    }

    let crossing = 0;
    for (let px = 0; px < width; px++) {
      const x = x0 + px + 0.5;
      while (crossing < xs.length && xs[crossing]! < x) crossing++;
      const inside = crossing % 2 === 1;

      // Unsigned distance to the nearest edge within the band, and that
      // edge's weight at the nearest point
      let best = band * band;
      let w = 1;
      for (const i of near) {
        const a = poly[i]!;
        const b = poly[(i + 1) % n]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        let t = len2 > 0 ? ((x - a.x) * ex + (y - a.y) * ey) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = a.x + ex * t - x;
        const dy = a.y + ey * t - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < best) {
          best = d2;
          if (weights) w = weights[i]! + (weights[(i + 1) % n]! - weights[i]!) * t;
        }
      }
      const dist = Math.sqrt(best);
      const signed = (inside ? dist : -dist) + ragged * (2 * raggedNoise(x / raggedScale, y / raggedScale) - 1);
      const cover = clamp01(signed / feather + 0.5);
      if (cover <= 0) continue;

      let a = density;
      if (gradient) {
        const t = (x * gdx + y * gdy - gMin) / gSpan;
        a *= gradient.from + (gradient.to - gradient.from) * clamp01(t);
      }
      // fBm clusters tightly around 0.5, so stretch it before use or even
      // full mottle barely shows
      if (mottle > 0) {
        // Along the streak (rotated back by the 0.61 lattice offset) and across it
        const along = (x * Math.cos(mAngle - 0.61) + y * Math.sin(mAngle - 0.61)) / (mottleScale * mottleStretch);
        const across = (-x * Math.sin(mAngle - 0.61) + y * Math.cos(mAngle - 0.61)) / mottleScale;
        const n = mottleNoise(along * mCos - across * mSin, along * mSin + across * mCos);
        a *= 1 + mottle * clampSigned(5 * (n - 0.5));
      }
      // Pigment carried to the edge as the wash dried, over the body tone
      if (pool > 0 && w > 0) {
        const rim = clamp01(pool * w) * Math.exp(-Math.max(0, signed) / poolWidth);
        a = 1 - (1 - clamp01(a)) * (1 - rim);
      }
      if (granulation > 0) a *= 1 + granulation * (2 * granNoise(x / granScale, y / granScale) - 1);

      const alpha = clamp01(a) * cover;
      if (alpha <= 0) continue;
      const k = (py * width + px) * 4;
      data[k] = cr;
      data[k + 1] = cg;
      data[k + 2] = cb;
      data[k + 3] = Math.round(alpha * 255);
    }
  }

  return { data, x: x0, y: y0, width, height };
}

// ---------------------------------------------------------------------------
// Layer type definition
// ---------------------------------------------------------------------------

/** A wash flooded inside a polygon, rect or ellipse, with pooled edges, mottling and granulation. */
export const washLayerType: LayerTypeDefinition = {
  typeId: "painting:wash",
  // Builds its pixels at the canvas's own resolution (ADR 111).
  resolution: "device",
  displayName: "Wash",
  icon: "watercolor",
  category: "draw",
  properties: WASH_PROPERTIES,
  propertyEditorId: "painting:wash-editor",

  createDefault(): LayerProperties {
    const props: LayerProperties = {};
    for (const schema of WASH_PROPERTIES) props[schema.key] = schema.default;
    return props;
  },

  render(
    properties: LayerProperties,
    ctx: CanvasRenderingContext2D,
    bounds: LayerBounds,
    _resources: RenderResources,
  ): void {
    const out = renderWashPixels(properties, bounds);
    if (!out) return;
    const scratch = createOffscreenCanvas(out.width, out.height, ctx);
    if (!scratch) return;
    const sctx = scratch.getContext("2d") as CanvasRenderingContext2D | null;
    if (!sctx) return;
    const img = sctx.createImageData(out.width, out.height);
    img.data.set(out.data);
    sctx.putImageData(img, 0, 0);
    // drawImage, not putImageData, so whatever is already on the target stays
    ctx.drawImage(scratch as CanvasImageSource, out.x, out.y);
  },

  validate(properties: LayerProperties): ValidationError[] | null {
    const errors: ValidationError[] = [];
    for (const key of ["region", "gradient", "edgeWeights"] as const) {
      const val = properties[key];
      if (typeof val === "string" && val.trim() !== "") {
        try {
          JSON.parse(val);
        } catch {
          errors.push({ property: key, message: `${key} must be valid JSON` });
        }
      }
    }
    const density = properties.density;
    if (density !== undefined && (typeof density !== "number" || density < 0 || density > 1)) {
      errors.push({ property: "density", message: "Density must be 0–1" });
    }
    return errors.length > 0 ? errors : null;
  },
};
