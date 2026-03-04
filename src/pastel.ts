import type {
  LayerTypeDefinition,
  LayerPropertySchema,
  LayerProperties,
  LayerBounds,
  RenderResources,
  ValidationError,
} from "@genart-dev/core";
import { parseField, sampleField } from "./vector-field.js";
import { renderDebugOverlay, type DebugMode } from "./debug-overlay.js";
import { createFractalNoise } from "./shared/noise.js";
import { mulberry32 } from "./shared/prng.js";

const PASTEL_PROPERTIES: LayerPropertySchema[] = [
  { key: "field",     label: "Vector Field",  type: "string",  default: "noise:0:0.1:3", group: "field" },
  { key: "fieldCols", label: "Field Columns", type: "number",  default: 20, min: 4, max: 40, step: 1, group: "field" },
  { key: "fieldRows", label: "Field Rows",    type: "number",  default: 20, min: 4, max: 40, step: 1, group: "field" },
  { key: "colors",    label: "Colors",        type: "string",  default: '["#d4a0c8"]', group: "paint" },
  {
    key: "softness", label: "Softness", type: "number",
    default: 0.6, min: 0, max: 1, step: 0.01, group: "paint",
  },
  {
    key: "buildup", label: "Buildup", type: "number",
    default: 0.5, min: 0, max: 1, step: 0.01, group: "paint",
  },
  {
    key: "grain", label: "Grain", type: "number",
    default: 0.4, min: 0, max: 1, step: 0.01, group: "paint",
  },
  { key: "opacity",     label: "Opacity",      type: "number", default: 1,    min: 0,   max: 1,     step: 0.01, group: "paint" },
  { key: "seed",        label: "Seed",         type: "number", default: 0,    min: 0,   max: 99999, step: 1,    group: "paint" },
  { key: "maskCenterY", label: "Mask Center Y",type: "number", default: -1,   min: -1,  max: 1,     step: 0.01, group: "mask" },
  { key: "maskSpread",  label: "Mask Spread",  type: "number", default: 0.25, min: 0.01,max: 1,     step: 0.01, group: "mask" },
  { key: "debug",        label: "Debug Field",     type: "boolean", default: false, group: "debug" },
  { key: "debugOpacity", label: "Overlay Opacity", type: "number",  default: 0.7, min: 0.1, max: 1, step: 0.05, group: "debug" },
  { key: "debugMode",    label: "Overlay Mode",    type: "select",  default: "all",
    options: [{ value: "arrows", label: "Arrows" }, { value: "heatmap", label: "Heatmap" }, { value: "contours", label: "Contours" }, { value: "all", label: "All" }],
    group: "debug" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const n = parseInt(clean, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// Layer type definition
// ---------------------------------------------------------------------------

export const pastelLayerType: LayerTypeDefinition = {
  typeId: "painting:pastel",
  displayName: "Pastel",
  icon: "pastel",
  category: "draw",
  properties: PASTEL_PROPERTIES,
  propertyEditorId: "painting:pastel-editor",

  createDefault(): LayerProperties {
    const props: LayerProperties = {};
    for (const schema of PASTEL_PROPERTIES) props[schema.key] = schema.default;
    return props;
  },

  render(
    properties: LayerProperties,
    ctx: CanvasRenderingContext2D,
    bounds: LayerBounds,
    _resources: RenderResources,
  ): void {
    const fieldStr    = (properties.field as string)     ?? "noise:0:0.1:3";
    const cols        = (properties.fieldCols as number) ?? 20;
    const rows        = (properties.fieldRows as number) ?? 20;
    const colorsStr   = (properties.colors as string)    ?? '["#d4a0c8"]';
    const softness    = (properties.softness as number)  ?? 0.6;
    const buildup     = (properties.buildup as number)   ?? 0.5;
    const grain       = (properties.grain as number)     ?? 0.4;
    const layerOpacity= (properties.opacity as number)   ?? 1;
    const seed        = (properties.seed as number)      ?? 0;
    const maskCenterY = (properties.maskCenterY as number) ?? -1;
    const maskSpread  = (properties.maskSpread as number)  ?? 0.25;
    const debug       = (properties.debug as boolean)    ?? false;
    const debugOpacity= (properties.debugOpacity as number) ?? 0.7;
    const debugMode   = ((properties.debugMode as string) ?? "all") as DebugMode;

    const w = Math.ceil(bounds.width);
    const h = Math.ceil(bounds.height);
    if (w <= 0 || h <= 0) return;

    // Normalize noise and mark sizes to be canvas-size-independent (800px reference)
    const sc = 800 / w;

    const field = parseField(fieldStr, cols, rows);
    const rand  = mulberry32(seed);

    // Paper grain noise (interacts with pastel marks)
    const paperNoise = createFractalNoise(seed + 1111, 4);
    // Mark variation noise (local density/buildup variation)
    const markNoise  = createFractalNoise(seed + 7777, 3);

    let colorList: [number, number, number][];
    try {
      const parsed = JSON.parse(colorsStr) as string[];
      colorList = parsed.map(hexToRgb);
    } catch {
      colorList = [[212, 160, 200]];
    }
    if (colorList.length === 0) colorList = [[212, 160, 200]];

    // ------------------------------------------------------------------
    // Pastel: short directional marks with radial softness falloff,
    // textured by paper grain, density driven by field magnitude.
    // Blend mode: soft-light (applied in the compositing step below).
    // We render via individual marks on a scratch buffer, then soft-light
    // composite onto the destination.
    // ------------------------------------------------------------------

    // Mark length scales with softness and canvas size (reference: 800px wide)
    const markLen = Math.round((4 + softness * 10) / sc);

    const imageData = ctx.getImageData(bounds.x, bounds.y, w, h);
    const data = imageData.data;

    // Scratch buffer: accumulate pastel marks in linear space
    const scratch = new Float32Array(w * h * 4); // [r, g, b, a] as floats 0-255/0-1

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const nx = w > 1 ? px / (w - 1) : 0;
        const ny = h > 1 ? py / (h - 1) : 0;
        const sample = sampleField(field, nx, ny);
        const mag = sample.magnitude;

        // Vertical mask
        const vMask = maskCenterY >= 0
          ? Math.exp(-((ny - maskCenterY) ** 2) / (2 * maskSpread * maskSpread))
          : 1;
        if (vMask < 0.02) continue;

        // Paper grain: pastel catches on paper tooth
        const pn = paperNoise(px * sc / 6, py * sc / 6);
        // Grain mask: low grain values = paper valleys where pastel doesn't stick
        if (grain > 0 && pn < grain * 0.5 && rand() > 0.3) continue;

        // Mark density: buildup × magnitude × local variation
        const mn = markNoise(px * sc / 15, py * sc / 15);
        const density = buildup * mag * lerp(0.4, 1.0, mn);
        if (rand() > density * vMask) continue;

        // Color interpolation along flow direction
        let color: [number, number, number];
        if (colorList.length === 1) {
          color = colorList[0]!;
        } else {
          const t = clamp((sample.dx + 1) * 0.5, 0, 1) * (colorList.length - 1);
          const ci = Math.floor(t);
          const tf = t - ci;
          const ca = colorList[Math.min(ci, colorList.length - 1)]!;
          const cb = colorList[Math.min(ci + 1, colorList.length - 1)]!;
          color = [lerp(ca[0], cb[0], tf), lerp(ca[1], cb[1], tf), lerp(ca[2], cb[2], tf)];
        }

        // Draw a short directional mark along the field vector
        const angle = Math.atan2(sample.dy, sample.dx);
        const halfLen = markLen * (0.5 + rand() * 0.5);

        for (let s = -halfLen; s <= halfLen; s++) {
          const sx = Math.round(px + Math.cos(angle) * s);
          const sy = Math.round(py + Math.sin(angle) * s);
          if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;

          // Radial softness falloff: peak at center, fade at ends
          const t = Math.abs(s) / halfLen;
          // Soft = gentle falloff; hard = abrupt cutoff
          const falloff = softness > 0.5
            ? 1 - Math.pow(t, 2 - softness)
            : 1 - t;
          const markAlpha = clamp(falloff * mag * vMask * layerOpacity, 0, 1);
          if (markAlpha < 0.01) continue;

          // Accumulate into scratch (additive — buildup layers)
          const si = (sy * w + sx) * 4;
          const existing = scratch[si + 3]!;
          const newA = clamp(existing + markAlpha * (1 - existing * 0.7), 0, 1);
          // Blend color weighted by alpha contribution
          const blendW = markAlpha / (newA + 1e-6);
          scratch[si]     = lerp(scratch[si]!,     color[0], blendW);
          scratch[si + 1] = lerp(scratch[si + 1]!, color[1], blendW);
          scratch[si + 2] = lerp(scratch[si + 2]!, color[2], blendW);
          scratch[si + 3] = newA;
        }
      }
    }

    // ------------------------------------------------------------------
    // Soft-light composite: scratch → destination
    // Soft-light formula: dst + src * alpha * (2*dst/255 - 1) * (1 - dst/255)
    // This brightens midtones while preserving darks/highlights — characteristic
    // of pastel on paper.
    // ------------------------------------------------------------------
    for (let i = 0; i < w * h; i++) {
      const si = i * 4;
      const a = scratch[si + 3]!;
      if (a < 0.01) continue;

      const sr = scratch[si]!;
      const sg = scratch[si + 1]!;
      const sb = scratch[si + 2]!;
      const dr = data[si]!;
      const dg = data[si + 1]!;
      const db = data[si + 2]!;

      // Soft-light per channel
      function softLight(dst: number, src: number): number {
        const d = dst / 255;
        const s = src / 255;
        // Pegtop soft-light formula
        const result = (1 - 2 * s) * d * d + 2 * s * d;
        return result * 255;
      }

      data[si]     = Math.round(lerp(dr, softLight(dr, sr), a));
      data[si + 1] = Math.round(lerp(dg, softLight(dg, sg), a));
      data[si + 2] = Math.round(lerp(db, softLight(db, sb), a));
      // alpha channel stays 255
    }

    ctx.putImageData(imageData, bounds.x, bounds.y);

    if (debug) {
      renderDebugOverlay(field, ctx, bounds, { mode: debugMode, opacity: debugOpacity });
    }
  },

  validate(_properties: LayerProperties): ValidationError[] | null {
    return null;
  },
};
