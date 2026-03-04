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

const GOUACHE_PROPERTIES: LayerPropertySchema[] = [
  { key: "field",     label: "Vector Field",  type: "string",  default: "noise:0:0.1:3", group: "field" },
  { key: "fieldCols", label: "Field Columns", type: "number",  default: 20, min: 4, max: 40, step: 1, group: "field" },
  { key: "fieldRows", label: "Field Rows",    type: "number",  default: 20, min: 4, max: 40, step: 1, group: "field" },
  { key: "colors",    label: "Colors",        type: "string",  default: '["#e8d5b0"]', group: "paint" },
  { key: "dryBrush",  label: "Dry Brush",     type: "boolean", default: false, group: "paint" },
  {
    key: "grain", label: "Grain", type: "number",
    default: 0.3, min: 0, max: 1, step: 0.01, group: "paint",
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

export const gouacheLayerType: LayerTypeDefinition = {
  typeId: "painting:gouache",
  displayName: "Gouache",
  icon: "gouache",
  category: "draw",
  properties: GOUACHE_PROPERTIES,
  propertyEditorId: "painting:gouache-editor",

  createDefault(): LayerProperties {
    const props: LayerProperties = {};
    for (const schema of GOUACHE_PROPERTIES) props[schema.key] = schema.default;
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
    const colorsStr   = (properties.colors as string)    ?? '["#e8d5b0"]';
    const dryBrush    = (properties.dryBrush as boolean) ?? false;
    const grain       = (properties.grain as number)     ?? 0.3;
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

    // Normalize noise sampling to be canvas-size-independent (800px reference)
    const sc = 800 / w;

    const field = parseField(fieldStr, cols, rows);
    const rand  = mulberry32(seed);

    // Grain noise: used for dry-brush texture and directional grain
    const grainNoise = createFractalNoise(seed + 2468, 4);
    // Dry-brush gap noise: coarse coverage gaps
    const dryNoise   = createFractalNoise(seed + 3691, 2);

    let colorList: [number, number, number][];
    try {
      const parsed = JSON.parse(colorsStr) as string[];
      colorList = parsed.map(hexToRgb);
    } catch {
      colorList = [[232, 213, 176]];
    }
    if (colorList.length === 0) colorList = [[232, 213, 176]];

    const imageData = ctx.getImageData(bounds.x, bounds.y, w, h);
    const data = imageData.data;

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const nx = w > 1 ? px / (w - 1) : 0;
        const ny = h > 1 ? py / (h - 1) : 0;
        const sample = sampleField(field, nx, ny);
        const mag = sample.magnitude;

        // Vertical mask (maskCenterY=-1 means disabled)
        const vMask = maskCenterY >= 0
          ? Math.exp(-((ny - maskCenterY) ** 2) / (2 * maskSpread * maskSpread))
          : 1;
        if (vMask < 0.02) continue;

        // Gouache: flat opaque coverage. magnitude masks where paint lands.
        // Low magnitude = paint thins out (still flat, just less coverage).
        let coverage: number;
        if (dryBrush) {
          // Dry-brush: coarse gaps opening up at all magnitudes, more at low mag
          const dn = dryNoise(px * sc / 20, py * sc / 20);
          const gn = grainNoise(px * sc / 5, py * sc / 5);
          const gapThreshold = (1 - mag) * 0.5 + grain * gn * 0.3;
          coverage = dn > gapThreshold ? mag : 0;
        } else {
          // Normal gouache: solid with grain texture
          const gn = grainNoise(px * sc / 8, py * sc / 8);
          const grainMask = 1 - grain * (1 - gn) * 0.4;
          coverage = mag * grainMask;
        }

        const alpha = clamp(coverage * vMask * layerOpacity, 0, 1);
        if (alpha < 0.01) continue;

        // Color: flat fill, palette mapped along flow direction (dx)
        // Gouache ignores dy — flat coverage, not directional
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

        // Directional grain: if grain > 0, modulate slightly along field direction
        let cr = color[0], cg = color[1], cbv = color[2];
        if (grain > 0) {
          // Sample grain along field direction for oriented fiber effect
          const angle = Math.atan2(sample.dy, sample.dx);
          const grainStep = 3 / sc;
          const gShift = grainNoise(
            (px + Math.cos(angle) * grainStep) * sc / 8,
            (py + Math.sin(angle) * grainStep) * sc / 8,
          );
          const grainShift = (gShift - 0.5) * grain * 15;
          cr  = clamp(cr  + grainShift, 0, 255);
          cg  = clamp(cg  + grainShift, 0, 255);
          cbv = clamp(cbv + grainShift, 0, 255);
        }

        const i = (py * w + px) * 4;
        const dr = data[i]!;
        const dg = data[i + 1]!;
        const db = data[i + 2]!;

        // Normal blend: source over destination
        data[i]     = Math.round(lerp(dr, cr,  alpha));
        data[i + 1] = Math.round(lerp(dg, cg,  alpha));
        data[i + 2] = Math.round(lerp(db, cbv, alpha));
        // alpha channel stays 255
      }
    }

    // Suppress unused rand (reserved for future variation)
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
