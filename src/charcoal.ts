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

const CHARCOAL_PROPERTIES: LayerPropertySchema[] = [
  { key: "field",      label: "Vector Field",  type: "string",  default: "noise:0:0.1:3", group: "field" },
  { key: "fieldCols",  label: "Field Columns", type: "number",  default: 20, min: 4, max: 40, step: 1, group: "field" },
  { key: "fieldRows",  label: "Field Rows",    type: "number",  default: 20, min: 4, max: 40, step: 1, group: "field" },
  { key: "colors",     label: "Colors",        type: "string",  default: '["#2a2a2a"]', group: "paint" },
  {
    key: "paintMode", label: "Paint Mode", type: "select", default: "multiply",
    options: [
      { value: "multiply", label: "Multiply (darken)" },
      { value: "normal",   label: "Normal (opaque)" },
      { value: "screen",   label: "Screen (lighten)" },
    ],
    group: "paint",
  },
  { key: "density",    label: "Density",       type: "number",  default: 0.5, min: 0, max: 1, step: 0.01, group: "paint" },
  { key: "smear",      label: "Smear",         type: "boolean", default: false, group: "paint" },
  { key: "grain",      label: "Grain",         type: "number",  default: 0.5, min: 0, max: 1, step: 0.01, group: "paint" },
  { key: "opacity",     label: "Opacity",       type: "number",  default: 1,    min: 0,   max: 1,     step: 0.01, group: "paint" },
  { key: "seed",        label: "Seed",          type: "number",  default: 0,    min: 0,   max: 99999, step: 1,    group: "paint" },
  { key: "maskCenterY", label: "Mask Center Y", type: "number",  default: -1,   min: -1,  max: 1,     step: 0.01, group: "mask" },
  { key: "maskSpread",  label: "Mask Spread",   type: "number",  default: 0.25, min: 0.01,max: 1,     step: 0.01, group: "mask" },
  { key: "debug",        label: "Debug Field",     type: "boolean", default: false, group: "debug" },
  { key: "debugOpacity", label: "Overlay Opacity", type: "number",  default: 0.7, min: 0.1, max: 1, step: 0.05, group: "debug" },
  { key: "debugMode",    label: "Overlay Mode",    type: "select",  default: "all",
    options: [{ value: "arrows", label: "Arrows" }, { value: "heatmap", label: "Heatmap" }, { value: "contours", label: "Contours" }, { value: "all", label: "All" }],
    group: "debug" },
];

export const charcoalLayerType: LayerTypeDefinition = {
  typeId: "painting:charcoal",
  displayName: "Charcoal",
  icon: "charcoal",
  category: "draw",
  properties: CHARCOAL_PROPERTIES,
  propertyEditorId: "painting:charcoal-editor",

  createDefault(): LayerProperties {
    const props: LayerProperties = {};
    for (const schema of CHARCOAL_PROPERTIES) props[schema.key] = schema.default;
    return props;
  },

  render(
    properties: LayerProperties,
    ctx: CanvasRenderingContext2D,
    bounds: LayerBounds,
    _resources: RenderResources,
  ): void {
    const fieldStr    = (properties.field as string)    ?? "noise:0:0.1:3";
    const cols        = (properties.fieldCols as number) ?? 20;
    const rows        = (properties.fieldRows as number) ?? 20;
    const colorsStr   = (properties.colors as string)   ?? '["#2a2a2a"]';
    const paintMode   = (properties.paintMode as string) ?? "multiply";
    const density     = (properties.density as number)  ?? 0.5;
    const smear       = (properties.smear as boolean)   ?? false;
    const grain       = (properties.grain as number)    ?? 0.5;
    const layerOpacity= (properties.opacity as number)  ?? 1;
    const seed        = (properties.seed as number)     ?? 0;
    const maskCenterY = (properties.maskCenterY as number) ?? -1;
    const maskSpread  = (properties.maskSpread as number)  ?? 0.25;
    const debug       = (properties.debug as boolean)   ?? false;
    const debugOpacity= (properties.debugOpacity as number) ?? 0.7;
    const debugMode   = ((properties.debugMode as string) ?? "all") as DebugMode;

    const w = Math.ceil(bounds.width);
    const h = Math.ceil(bounds.height);
    if (w <= 0 || h <= 0) return;

    const field     = parseField(fieldStr, cols, rows);
    const rand      = mulberry32(seed);
    const grainNoise= createFractalNoise(seed + 500, 3);

    let colorList: [number, number, number][];
    try {
      const parsed = JSON.parse(colorsStr) as string[];
      colorList = parsed.map(hexToRgb);
    } catch { colorList = []; }
    if (colorList.length === 0) colorList = [[42, 42, 42]];

    const imageData = ctx.getImageData(bounds.x, bounds.y, w, h);
    const data      = imageData.data;

    const strokeLen = smear ? 8 : 4;

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const nx = w > 1 ? px / (w - 1) : 0;
        const ny = h > 1 ? py / (h - 1) : 0;
        const sample = sampleField(field, nx, ny);

        const vMask = maskCenterY >= 0
          ? Math.exp(-((ny - maskCenterY) ** 2) / (2 * maskSpread * maskSpread))
          : 1;
        if (vMask < 0.02) continue;

        const g       = grainNoise(px / 12, py / 12);
        const coverage= density * sample.magnitude * vMask * lerp(0.3, 1.0, g);

        if (rand() > coverage) continue;

        // Pick color from palette based on flow direction
        const dirT = clamp((sample.dx + 1) * 0.5, 0, 1) * (colorList.length - 1);
        const ci = Math.floor(dirT);
        const tf = dirT - ci;
        const ca = colorList[Math.min(ci, colorList.length - 1)]!;
        const cb_ = colorList[Math.min(ci + 1, colorList.length - 1)]!;
        const cr = lerp(ca[0], cb_[0], tf);
        const cg_ = lerp(ca[1], cb_[1], tf);
        const cb2 = lerp(ca[2], cb_[2], tf);

        const len   = strokeLen * (0.5 + rand() * 0.5);
        const angle = Math.atan2(sample.dy, sample.dx);
        const alpha = layerOpacity * vMask * lerp(0.15, 0.55, rand()) * sample.magnitude;

        for (let s = 0; s <= len; s++) {
          const t  = s / len;
          const sx = Math.round(px + Math.cos(angle) * s);
          const sy = Math.round(py + Math.sin(angle) * s);
          if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;

          const tapFactor = smear ? 1.0 : 1 - Math.abs(t * 2 - 1) * 0.5;
          const a = alpha * tapFactor;

          const i  = (sy * w + sx) * 4;
          const dr = data[i]!;
          const dg = data[i + 1]!;
          const db = data[i + 2]!;

          if (paintMode === "screen") {
            // Screen: 255 - (255-dst)*(255-src)/255
            data[i]     = Math.round(lerp(dr, 255 - ((255 - dr) * (255 - cr)) / 255, a));
            data[i + 1] = Math.round(lerp(dg, 255 - ((255 - dg) * (255 - cg_)) / 255, a));
            data[i + 2] = Math.round(lerp(db, 255 - ((255 - db) * (255 - cb2)) / 255, a));
          } else if (paintMode === "normal") {
            data[i]     = Math.round(lerp(dr, cr, a));
            data[i + 1] = Math.round(lerp(dg, cg_, a));
            data[i + 2] = Math.round(lerp(db, cb2, a));
          } else {
            // Multiply
            data[i]     = Math.round(lerp(dr, (dr * cr) / 255, a));
            data[i + 1] = Math.round(lerp(dg, (dg * cg_) / 255, a));
            data[i + 2] = Math.round(lerp(db, (db * cb2) / 255, a));
          }
        }
      }
    }

    // grain texture
    if (grain > 0) {
      const gc = colorList[0]!;
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const g2 = grainNoise(px / 3.5, py / 3.5);
          if (g2 > 0.6 && rand() < grain * 0.08) {
            const i = (py * w + px) * 4;
            const dr = data[i]!;
            const dg = data[i + 1]!;
            const db = data[i + 2]!;
            const a  = layerOpacity * 0.12;
            if (paintMode === "screen") {
              data[i]     = Math.round(lerp(dr, 255 - ((255 - dr) * (255 - gc[0])) / 255, a));
              data[i + 1] = Math.round(lerp(dg, 255 - ((255 - dg) * (255 - gc[1])) / 255, a));
              data[i + 2] = Math.round(lerp(db, 255 - ((255 - db) * (255 - gc[2])) / 255, a));
            } else if (paintMode === "normal") {
              data[i]     = Math.round(lerp(dr, gc[0], a));
              data[i + 1] = Math.round(lerp(dg, gc[1], a));
              data[i + 2] = Math.round(lerp(db, gc[2], a));
            } else {
              data[i]     = Math.round(lerp(dr, (dr * gc[0]) / 255, a));
              data[i + 1] = Math.round(lerp(dg, (dg * gc[1]) / 255, a));
              data[i + 2] = Math.round(lerp(db, (db * gc[2]) / 255, a));
            }
          }
        }
      }
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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const n = parseInt(clean, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
