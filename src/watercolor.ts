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

// ---------------------------------------------------------------------------
// Property schema
// ---------------------------------------------------------------------------

const WATERCOLOR_PROPERTIES: LayerPropertySchema[] = [
  // Field
  {
    key: "field",
    label: "Vector Field",
    type: "string",
    default: "noise:0:0.1:3",
    group: "field",
  },
  {
    key: "fieldCols",
    label: "Field Columns",
    type: "number",
    default: 20,
    min: 4,
    max: 40,
    step: 1,
    group: "field",
  },
  {
    key: "fieldRows",
    label: "Field Rows",
    type: "number",
    default: 20,
    min: 4,
    max: 40,
    step: 1,
    group: "field",
  },
  // Paint
  {
    key: "colors",
    label: "Colors",
    type: "string",
    default: '["#4a7fb5"]',
    group: "paint",
  },
  {
    key: "dilution",
    label: "Dilution",
    type: "number",
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.01,
    group: "paint",
  },
  {
    key: "granulation",
    label: "Granulation",
    type: "number",
    default: 0.3,
    min: 0,
    max: 1,
    step: 0.01,
    group: "paint",
  },
  {
    key: "paintMode",
    label: "Paint Mode",
    type: "select",
    default: "multiply",
    options: [
      { value: "multiply", label: "Multiply (darken)" },
      { value: "normal",   label: "Normal (opaque)" },
      { value: "screen",   label: "Screen (lighten)" },
    ],
    group: "paint",
  },
  {
    key: "edgeStyle",
    label: "Edge Style",
    type: "select",
    default: "soft",
    options: [
      { value: "sharp", label: "Sharp" },
      { value: "soft", label: "Soft" },
      { value: "diffuse", label: "Diffuse" },
      { value: "lost", label: "Lost" },
    ],
    group: "paint",
  },
  {
    key: "seed",
    label: "Seed",
    type: "number",
    default: 0,
    min: 0,
    max: 99999,
    step: 1,
    group: "paint",
  },
  // Vertical mask (for landscape band compositing)
  {
    key: "maskCenterY",
    label: "Mask Center Y",
    type: "number",
    default: -1,
    min: -1,
    max: 1,
    step: 0.01,
    group: "mask",
  },
  {
    key: "maskSpread",
    label: "Mask Spread",
    type: "number",
    default: 0.25,
    min: 0.01,
    max: 1,
    step: 0.01,
    group: "mask",
  },
  // Debug
  {
    key: "debug",
    label: "Debug Field",
    type: "boolean",
    default: false,
    group: "debug",
  },
  {
    key: "debugOpacity",
    label: "Overlay Opacity",
    type: "number",
    default: 0.7,
    min: 0.1,
    max: 1.0,
    step: 0.05,
    group: "debug",
  },
  {
    key: "debugMode",
    label: "Overlay Mode",
    type: "select",
    default: "all",
    options: [
      { value: "arrows", label: "Arrows" },
      { value: "heatmap", label: "Heatmap" },
      { value: "contours", label: "Contours" },
      { value: "all", label: "All" },
    ],
    group: "debug",
  },
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

export const watercolorLayerType: LayerTypeDefinition = {
  typeId: "painting:watercolor",
  displayName: "Watercolor",
  icon: "watercolor",
  category: "draw",
  properties: WATERCOLOR_PROPERTIES,
  propertyEditorId: "painting:watercolor-editor",

  createDefault(): LayerProperties {
    const props: LayerProperties = {};
    for (const schema of WATERCOLOR_PROPERTIES) {
      props[schema.key] = schema.default;
    }
    return props;
  },

  render(
    properties: LayerProperties,
    ctx: CanvasRenderingContext2D,
    bounds: LayerBounds,
    _resources: RenderResources,
  ): void {
    const fieldStr = (properties.field as string) ?? "noise:0:0.1:3";
    const cols = (properties.fieldCols as number) ?? 20;
    const rows = (properties.fieldRows as number) ?? 20;
    const colorsStr = (properties.colors as string) ?? '["#4a7fb5"]';
    const dilution = (properties.dilution as number) ?? 0.5;
    const debug = (properties.debug as boolean) ?? false;
    const debugOpacity = (properties.debugOpacity as number) ?? 0.7;
    const debugMode = ((properties.debugMode as string) ?? "all") as DebugMode;

    const granulation = (properties.granulation as number) ?? 0.3;
    const paintMode = (properties.paintMode as string) ?? "multiply";
    const edgeStyle = (properties.edgeStyle as string) ?? "soft";
    const seed = (properties.seed as number) ?? 0;
    const layerOpacity = (properties.opacity as number) ?? 1;
    const maskCenterY = (properties.maskCenterY as number) ?? -1;
    const maskSpread = (properties.maskSpread as number) ?? 0.25;

    const field = parseField(fieldStr, cols, rows);

    let colorList: [number, number, number][];
    try {
      const parsed = JSON.parse(colorsStr) as string[];
      colorList = parsed.map(hexToRgb);
    } catch {
      colorList = [[74, 127, 181]];
    }
    if (colorList.length === 0) colorList = [[74, 127, 181]];

    const w = Math.ceil(bounds.width);
    const h = Math.ceil(bounds.height);
    if (w <= 0 || h <= 0) return;

    // Granulation noise — fine-scale pigment settling in low-velocity zones
    const granNoise = createFractalNoise(seed, 4);
    // Edge softness noise — adds local alpha variation at edges
    const edgeNoise = createFractalNoise(seed + 7777, 3);
    // Pooling noise — low-freq variation that breaks up uniform areas
    const poolNoise = createFractalNoise(seed + 3333, 2);
    // Edge softness scale: how much local noise breaks coverage at low alpha
    const edgeSoftness = edgeStyle === "sharp" ? 0.0
      : edgeStyle === "soft" ? 0.35
      : edgeStyle === "diffuse" ? 0.65
      : /* lost */ 0.9;

    // ------------------------------------------------------------------
    // Paint pass
    // ------------------------------------------------------------------
    if (layerOpacity > 0) {
      const imageData = ctx.getImageData(bounds.x, bounds.y, w, h);
      const data = imageData.data;

      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const nx = w > 1 ? px / (w - 1) : 0;
          const ny = h > 1 ? py / (h - 1) : 0;
          const sample = sampleField(field, nx, ny);
          const mag = sample.magnitude;

          // Low magnitude = pooling = dense, dark pigment
          // High magnitude = fast flow = thin wash, low coverage
          // dilution shifts the baseline opacity up (more water = lighter everywhere)
          const baseAlpha = clamp(1 - mag * (0.5 + dilution * 0.4), 0, 1);

          // Low-freq pooling variation breaks up flat areas organically
          const pool = poolNoise(px / (w * 0.4), py / (h * 0.4));
          const pooledAlpha = baseAlpha * lerp(0.7, 1.0, pool);

          // Granulation: in low-velocity zones, pigment settles into paper tooth
          // Fine noise adds texture; strength scales with granulation param and 1-mag
          const gran = granNoise(px / 8, py / 8);
          const granStrength = granulation * (1 - mag) * 0.6;
          const grainedAlpha = pooledAlpha * (1 - granStrength * (1 - gran));

          // Edge softness: noise-based feathering that erodes paint at low coverage.
          // Threshold rises as grainedAlpha falls — so edges (sparse paint) drop out
          // more than the dense interior. edgeSoftness=0 → crisp; 1 → very feathered.
          const edge = edgeNoise(px / 18, py / 18);
          const threshold = edgeSoftness * clamp(1 - grainedAlpha * 1.8, 0, 1);
          // Vertical Gaussian mask (maskCenterY=-1 means disabled)
          const vMask = maskCenterY >= 0
            ? Math.exp(-((ny - maskCenterY) ** 2) / (2 * maskSpread * maskSpread))
            : 1;

          const finalAlpha = clamp(
            grainedAlpha * layerOpacity * vMask * (edge > threshold ? 1 : 0),
            0, 1,
          );

          if (finalAlpha < 0.005) continue;

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

          // Slight color variation from granulation noise (pigment concentration)
          const colorShift = 1 - gran * granulation * 0.15;
          const pr = clamp(color[0] * colorShift, 0, 255);
          const pg = clamp(color[1] * colorShift, 0, 255);
          const pb = clamp(color[2] * colorShift, 0, 255);

          const i = (py * w + px) * 4;
          const dr = data[i]!;
          const dg = data[i + 1]!;
          const db = data[i + 2]!;

          if (paintMode === "screen") {
            // Screen: 255 - (255-dst)*(255-src)/255
            data[i]     = Math.round(lerp(dr, 255 - ((255 - dr) * (255 - pr)) / 255, finalAlpha));
            data[i + 1] = Math.round(lerp(dg, 255 - ((255 - dg) * (255 - pg)) / 255, finalAlpha));
            data[i + 2] = Math.round(lerp(db, 255 - ((255 - db) * (255 - pb)) / 255, finalAlpha));
          } else if (paintMode === "normal") {
            // Normal: straight alpha blend toward paint color
            data[i]     = Math.round(lerp(dr, pr, finalAlpha));
            data[i + 1] = Math.round(lerp(dg, pg, finalAlpha));
            data[i + 2] = Math.round(lerp(db, pb, finalAlpha));
          } else {
            // Multiply: dst * paint / 255
            data[i]     = Math.round(lerp(dr, (dr * pr) / 255, finalAlpha));
            data[i + 1] = Math.round(lerp(dg, (dg * pg) / 255, finalAlpha));
            data[i + 2] = Math.round(lerp(db, (db * pb) / 255, finalAlpha));
          }
        }
      }

      ctx.putImageData(imageData, bounds.x, bounds.y);
    }

    // ------------------------------------------------------------------
    // Debug overlay (drawn after paint so it's always visible on top)
    // ------------------------------------------------------------------
    if (debug) {
      renderDebugOverlay(field, ctx, bounds, {
        mode: debugMode,
        opacity: debugOpacity,
      });
    }
  },

  validate(properties: LayerProperties): ValidationError[] | null {
    const errors: ValidationError[] = [];
    const dilution = properties.dilution;
    if (typeof dilution !== "number" || dilution < 0 || dilution > 1) {
      errors.push({ property: "dilution", message: "Dilution must be 0–1" });
    }
    return errors.length > 0 ? errors : null;
  },
};
