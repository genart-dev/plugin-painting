import type {
  LayerTypeDefinition,
  LayerPropertySchema,
  LayerProperties,
  LayerBounds,
  RenderResources,
  ValidationError,
} from "@genart-dev/core";
import { parseField, sampleField } from "./vector-field.js";
import { mulberry32 } from "./shared/prng.js";

const MARK_FIELD_PROPERTIES: LayerPropertySchema[] = [
  { key: "field",      label: "Vector Field",      type: "string",  default: "noise:0:0.1:3", group: "field" },
  { key: "fieldCols",  label: "Field Columns",     type: "number",  default: 30, min: 4, max: 80, step: 1, group: "field" },
  { key: "fieldRows",  label: "Field Rows",        type: "number",  default: 30, min: 4, max: 80, step: 1, group: "field" },
  { key: "seed",       label: "Seed",              type: "number",  default: 42, min: 0, max: 99999, step: 1, group: "generation" },
  { key: "density",    label: "Mark Density",      type: "number",  default: 800, min: 50, max: 5000, step: 50, group: "generation" },
  { key: "markLength", label: "Mark Length",        type: "number",  default: 15, min: 3, max: 60, step: 1, group: "mark" },
  { key: "markLengthVariation", label: "Length Variation", type: "number", default: 0.3, min: 0, max: 1, step: 0.05, group: "mark" },
  { key: "markWeight", label: "Mark Weight",        type: "number",  default: 1.2, min: 0.3, max: 8, step: 0.1, group: "mark" },
  { key: "markWeightVariation", label: "Weight Variation", type: "number", default: 0.2, min: 0, max: 1, step: 0.05, group: "mark" },
  { key: "color",      label: "Color",             type: "color",   default: "#2a2a2a", group: "style" },
  { key: "colorVariation", label: "Color Variation", type: "number", default: 0.1, min: 0, max: 1, step: 0.05, group: "style" },
  { key: "opacity",    label: "Opacity",           type: "number",  default: 0.7, min: 0, max: 1, step: 0.01, group: "style" },
  {
    key: "paintMode", label: "Paint Mode", type: "select", default: "multiply",
    options: [
      { value: "multiply", label: "Multiply (darken)" },
      { value: "normal",   label: "Normal (opaque)" },
      { value: "screen",   label: "Screen (lighten)" },
    ],
    group: "style",
  },
  { key: "depthScale",       label: "Depth Scale",        type: "boolean", default: false, group: "depth" },
  { key: "horizonY",         label: "Horizon Y",          type: "number",  default: 0.3, min: 0, max: 1, step: 0.01, group: "depth" },
  { key: "depthDensityRange", label: "Depth Density Range", type: "string", default: "[1, 2.5]", group: "depth" },
  { key: "depthWeightRange",  label: "Depth Weight Range",  type: "string", default: "[0.6, 1.8]", group: "depth" },
  { key: "maskCenterY", label: "Mask Center Y", type: "number", default: -1,   min: -1, max: 1,    step: 0.01, group: "mask" },
  { key: "maskSpread",  label: "Mask Spread",   type: "number", default: 0.25, min: 0.01, max: 1, step: 0.01, group: "mask" },
];

// ---------------------------------------------------------------------------
// HSL jitter helper
// ---------------------------------------------------------------------------

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgba(h: number, s: number, l: number, a: number): string {
  h = ((h % 1) + 1) % 1;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}

// ---------------------------------------------------------------------------
// Layer type definition
// ---------------------------------------------------------------------------

export const markFieldLayerType: LayerTypeDefinition = {
  typeId: "painting:mark-field",
  displayName: "Mark Field",
  icon: "mark-field",
  category: "draw",
  properties: MARK_FIELD_PROPERTIES,
  propertyEditorId: "painting:mark-field-editor",

  createDefault(): LayerProperties {
    const props: LayerProperties = {};
    for (const schema of MARK_FIELD_PROPERTIES) props[schema.key] = schema.default;
    return props;
  },

  render(
    properties: LayerProperties,
    ctx: CanvasRenderingContext2D,
    bounds: LayerBounds,
    _resources: RenderResources,
  ): void {
    const fieldStr          = (properties.field as string)   ?? "noise:0:0.1:3";
    const cols              = (properties.fieldCols as number) ?? 30;
    const rows              = (properties.fieldRows as number) ?? 30;
    const seed              = (properties.seed as number)    ?? 42;
    const density           = (properties.density as number) ?? 800;
    const markLength        = (properties.markLength as number) ?? 15;
    const markLengthVar     = (properties.markLengthVariation as number) ?? 0.3;
    const markWeight        = (properties.markWeight as number) ?? 1.2;
    const markWeightVar     = (properties.markWeightVariation as number) ?? 0.2;
    const color             = (properties.color as string)   ?? "#2a2a2a";
    const colorVariation    = (properties.colorVariation as number) ?? 0.1;
    const opacity           = (properties.opacity as number) ?? 0.7;
    const paintMode         = (properties.paintMode as string) ?? "multiply";
    const depthScale        = (properties.depthScale as boolean) ?? false;
    const horizonY          = (properties.horizonY as number) ?? 0.3;
    const depthDensityStr   = (properties.depthDensityRange as string) ?? "[1, 2.5]";
    const depthWeightStr    = (properties.depthWeightRange as string) ?? "[0.6, 1.8]";
    const maskCenterY       = (properties.maskCenterY as number) ?? -1;
    const maskSpread        = (properties.maskSpread as number) ?? 0.25;

    const w = Math.ceil(bounds.width);
    const h = Math.ceil(bounds.height);
    if (w <= 0 || h <= 0) return;

    const field = parseField(fieldStr, cols, rows);
    const rand  = mulberry32(seed);

    // Parse depth ranges
    let depthDensityRange: [number, number] = [1, 2.5];
    let depthWeightRange: [number, number] = [0.6, 1.8];
    try { depthDensityRange = JSON.parse(depthDensityStr) as [number, number]; } catch {}
    try { depthWeightRange = JSON.parse(depthWeightStr) as [number, number]; } catch {}

    // Parse base color to HSL for jitter
    const [baseH, baseS, baseL] = hexToHsl(color);

    ctx.save();
    ctx.lineCap = "round";

    if (paintMode === "screen") {
      ctx.globalCompositeOperation = "screen";
    } else if (paintMode === "normal") {
      ctx.globalCompositeOperation = "source-over";
    } else {
      ctx.globalCompositeOperation = "multiply";
    }

    for (let i = 0; i < density; i++) {
      const px = rand() * w;
      const py = rand() * h;
      const nx = px / w;
      const ny = py / h;

      const sample = sampleField(field, nx, ny);
      if (sample.magnitude < 0.1) continue;

      // Compute mark length with variation and magnitude
      const lenJitter = 1 + markLengthVar * (rand() - 0.5) * 2;
      const len = markLength * lenJitter * sample.magnitude;

      // Compute mark weight with variation
      const weightJitter = 1 + markWeightVar * (rand() - 0.5) * 2;
      let mw = markWeight * weightJitter;

      // Depth scaling
      let densityMult = 1;
      if (depthScale) {
        const depthT = Math.max(0, Math.min(1, (ny - horizonY) / (1 - horizonY)));
        densityMult = depthDensityRange[0] + (depthDensityRange[1] - depthDensityRange[0]) * depthT;
        const weightMult = depthWeightRange[0] + (depthWeightRange[1] - depthWeightRange[0]) * depthT;
        mw *= weightMult;
      }

      // For depth density: skip marks probabilistically when density multiplier < 1
      // or accept extra marks when > 1 (handled by the uniform distribution)
      if (depthScale && rand() > densityMult / depthDensityRange[1]) continue;

      // Vertical mask
      let maskAlpha = 1;
      if (maskCenterY >= 0) {
        maskAlpha = Math.exp(-((ny - maskCenterY) ** 2) / (2 * maskSpread * maskSpread));
        if (maskAlpha < 0.05) continue;
      }

      // Color with HSL jitter
      const jH = baseH + colorVariation * (rand() - 0.5) * 0.2;
      const jS = baseS + colorVariation * (rand() - 0.5) * 0.3;
      const jL = baseL + colorVariation * (rand() - 0.5) * 0.2;
      const markAlpha = opacity * maskAlpha;

      const cx = bounds.x + px;
      const cy = bounds.y + py;
      const halfLen = len / 2;

      ctx.beginPath();
      ctx.moveTo(cx - sample.dx * halfLen, cy - sample.dy * halfLen);
      ctx.lineTo(cx + sample.dx * halfLen, cy + sample.dy * halfLen);
      ctx.strokeStyle = hslToRgba(jH, jS, jL, markAlpha);
      ctx.lineWidth = Math.max(0.3, mw);
      ctx.stroke();
    }

    ctx.restore();
  },

  validate(_properties: LayerProperties): ValidationError[] | null {
    return null;
  },
};
