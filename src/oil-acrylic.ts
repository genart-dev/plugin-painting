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

const OIL_PROPERTIES: LayerPropertySchema[] = [
  { key: "field",      label: "Vector Field",  type: "string",  default: "noise:0:0.1:3", group: "field" },
  { key: "fieldCols",  label: "Field Columns", type: "number",  default: 20, min: 4, max: 40, step: 1, group: "field" },
  { key: "fieldRows",  label: "Field Rows",    type: "number",  default: 20, min: 4, max: 40, step: 1, group: "field" },
  { key: "colors",     label: "Colors",        type: "string",  default: '["#c8723a"]', group: "paint" },
  { key: "impasto",    label: "Impasto",       type: "boolean", default: false, group: "paint" },
  { key: "scumble",    label: "Scumble",       type: "boolean", default: false, group: "paint" },
  {
    key: "blendRadius", label: "Blend Radius", type: "number",
    default: 8, min: 0, max: 50, step: 1, group: "paint",
  },
  { key: "opacity",     label: "Opacity",      type: "number",  default: 1,    min: 0,   max: 1,     step: 0.01, group: "paint" },
  { key: "seed",        label: "Seed",         type: "number",  default: 0,    min: 0,   max: 99999, step: 1,    group: "paint" },
  { key: "maskCenterY", label: "Mask Center Y",type: "number",  default: -1,   min: -1,  max: 1,     step: 0.01, group: "mask" },
  { key: "maskSpread",  label: "Mask Spread",  type: "number",  default: 0.25, min: 0.01,max: 1,     step: 0.01, group: "mask" },
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

export const oilAcrylicLayerType: LayerTypeDefinition = {
  typeId: "painting:oil",
  displayName: "Oil / Acrylic",
  icon: "oil",
  category: "draw",
  properties: OIL_PROPERTIES,
  propertyEditorId: "painting:oil-editor",

  createDefault(): LayerProperties {
    const props: LayerProperties = {};
    for (const schema of OIL_PROPERTIES) props[schema.key] = schema.default;
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
    const colorsStr   = (properties.colors as string)    ?? '["#c8723a"]';
    const impasto     = (properties.impasto as boolean)  ?? false;
    const scumble     = (properties.scumble as boolean)  ?? false;
    const blendRadius = (properties.blendRadius as number) ?? 8;
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

    // Scale factor: normalize pixel coords so noise frequency is canvas-size-independent.
    // At 800px wide the base scale is 1.0; larger canvases use proportionally coarser sampling.
    const sc = 800 / w;

    const field = parseField(fieldStr, cols, rows);
    const rand  = mulberry32(seed);

    // Scumble gap noise — dry-brush gaps in low-magnitude zones
    const scumbleNoise = createFractalNoise(seed + 1234, 3);
    // Impasto bevel noise — fine variation for ridged paint texture
    const impastoNoise = createFractalNoise(seed + 5678, 4);

    let colorList: [number, number, number][];
    try {
      const parsed = JSON.parse(colorsStr) as string[];
      colorList = parsed.map(hexToRgb);
    } catch {
      colorList = [[200, 114, 58]];
    }
    if (colorList.length === 0) colorList = [[200, 114, 58]];

    // ------------------------------------------------------------------
    // First pass: build a flat painted layer into a local buffer
    // ------------------------------------------------------------------
    const imageData = ctx.getImageData(bounds.x, bounds.y, w, h);
    const data = imageData.data;

    // We paint into a scratch buffer, then composite onto data with blend smear
    const scratch = new Uint8ClampedArray(w * h * 4);
    // Initialize scratch alpha to 0 (transparent)

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const nx = w > 1 ? px / (w - 1) : 0;
        const ny = h > 1 ? py / (h - 1) : 0;
        const sample = sampleField(field, nx, ny);
        const mag = sample.magnitude;

        // Vertical Gaussian mask (maskCenterY=-1 means disabled)
        const vMask = maskCenterY >= 0
          ? Math.exp(-((ny - maskCenterY) ** 2) / (2 * maskSpread * maskSpread))
          : 1;
        if (vMask < 0.02) continue;

        // coverage: full paint at high magnitude, gaps at low (scumble)
        let coverage = mag;
        if (scumble) {
          // Dry-brush effect: noise-gapped at low magnitude
          const sn = scumbleNoise(px * sc / 14, py * sc / 14);
          coverage = mag * (sn > (1 - mag) * 0.7 ? 1 : 0.15);
        }

        const alpha = clamp(coverage * vMask * layerOpacity, 0, 1);
        if (alpha < 0.01) continue;

        // Color: interpolate palette along flow direction
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

        // Impasto: lighten along flow direction perpendicular ridge
        let cr = color[0], cg = color[1], cb = color[2];
        if (impasto) {
          // Perpendicular direction to stroke = highlight edge
          const bn = impastoNoise(px * sc / 6, py * sc / 6);
          const bevelFactor = bn * mag * 0.4;
          cr = clamp(cr + bevelFactor * 80, 0, 255);
          cg = clamp(cg + bevelFactor * 80, 0, 255);
          cb = clamp(cb + bevelFactor * 80, 0, 255);
        }

        const si = (py * w + px) * 4;
        scratch[si]     = Math.round(cr);
        scratch[si + 1] = Math.round(cg);
        scratch[si + 2] = Math.round(cb);
        scratch[si + 3] = Math.round(alpha * 255);
      }
    }

    // ------------------------------------------------------------------
    // Blend smear pass: drag paint along flow direction (blendRadius > 0)
    // ------------------------------------------------------------------
    if (blendRadius > 0) {
      // For each pixel, accumulate contributions from pixels within blendRadius
      // along the flow direction — simulates wet oil drag/blending.
      // blendRadius is specified at 800px reference — scale to actual canvas size.
      const blended = new Uint8ClampedArray(w * h * 4);
      const scaledRadius = blendRadius / sc;
      const halfR = Math.max(1, Math.round(scaledRadius / 2));

      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const nx = w > 1 ? px / (w - 1) : 0;
          const ny = h > 1 ? py / (h - 1) : 0;
          const sample = sampleField(field, nx, ny);

          let accR = 0, accG = 0, accB = 0, accA = 0, count = 0;

          // Sample upstream and downstream along flow
          for (let step = -halfR; step <= halfR; step++) {
            const sx = Math.round(px + sample.dx * step);
            const sy = Math.round(py + sample.dy * step);
            if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
            const si = (sy * w + sx) * 4;
            const sa = scratch[si + 3]!;
            if (sa === 0) continue;
            // Weight by proximity
            const w_step = 1 - Math.abs(step) / (halfR + 1);
            accR += scratch[si]! * w_step;
            accG += scratch[si + 1]! * w_step;
            accB += scratch[si + 2]! * w_step;
            accA += sa * w_step;
            count += w_step;
          }

          if (count > 0 && accA / count > 0) {
            const di = (py * w + px) * 4;
            blended[di]     = Math.round(accR / count);
            blended[di + 1] = Math.round(accG / count);
            blended[di + 2] = Math.round(accB / count);
            blended[di + 3] = Math.round(accA / count);
          }
        }
      }

      // Composite blended onto destination (normal blend: source over dest)
      for (let i = 0; i < w * h; i++) {
        const bi = i * 4;
        const a = blended[bi + 3]! / 255;
        if (a < 0.01) continue;
        // Oil paint uses normal blend: source over destination
        data[bi]     = Math.round(lerp(data[bi]!,     blended[bi]!,     a));
        data[bi + 1] = Math.round(lerp(data[bi + 1]!, blended[bi + 1]!, a));
        data[bi + 2] = Math.round(lerp(data[bi + 2]!, blended[bi + 2]!, a));
        // alpha channel stays 255 (we're painting onto an opaque canvas)
      }
    } else {
      // No smear: composite scratch directly
      for (let i = 0; i < w * h; i++) {
        const si = i * 4;
        const a = scratch[si + 3]! / 255;
        if (a < 0.01) continue;
        data[si]     = Math.round(lerp(data[si]!,     scratch[si]!,     a));
        data[si + 1] = Math.round(lerp(data[si + 1]!, scratch[si + 1]!, a));
        data[si + 2] = Math.round(lerp(data[si + 2]!, scratch[si + 2]!, a));
      }
    }

    // Suppress unused-variable lint on rand (reserved for future use)
    void rand;

    ctx.putImageData(imageData, bounds.x, bounds.y);

    if (debug) {
      renderDebugOverlay(field, ctx, bounds, { mode: debugMode, opacity: debugOpacity });
    }
  },

  validate(_properties: LayerProperties): ValidationError[] | null {
    return null;
  },
};
