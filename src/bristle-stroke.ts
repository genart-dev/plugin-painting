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
import {
  hexToRgb,
  traceBrushPath,
  renderBristleStroke,
  defaultBristleConfig,
  type BristleConfig,
} from "./shared/bristle.js";

// ---------------------------------------------------------------------------
// Property schema
// ---------------------------------------------------------------------------

const TAPER_OPTIONS = [
  { value: "pointed", label: "Pointed" },
  { value: "blunt",   label: "Blunt" },
  { value: "chisel",  label: "Chisel" },
];

const TEXTURE_OPTIONS = [
  { value: "smooth",   label: "Smooth" },
  { value: "dry",      label: "Dry Brush" },
  { value: "rough",    label: "Rough" },
  { value: "stipple",  label: "Stipple" },
  { value: "feathered",label: "Feathered" },
  { value: "impasto",  label: "Impasto" },
];

const COLOR_MODE_OPTIONS = [
  { value: "single",       label: "Single" },
  { value: "lateral",      label: "Lateral" },
  { value: "along",        label: "Along" },
  { value: "loaded",       label: "Loaded" },
  { value: "random",       label: "Random" },
  { value: "split",        label: "Split" },
  { value: "streaked",     label: "Streaked" },
  { value: "rainbow",      label: "Rainbow" },
  { value: "complementary",label: "Complementary" },
  { value: "analogous",    label: "Analogous" },
  { value: "temperature",  label: "Temperature" },
  { value: "loaded-knife", label: "Loaded Knife" },
];

const BRISTLE_STROKE_PROPERTIES: LayerPropertySchema[] = [
  { key: "field",         label: "Vector Field",   type: "string", default: "noise:0:0.08:4", group: "field" },
  { key: "fieldCols",     label: "Field Columns",  type: "number", default: 30, min: 4, max: 80, step: 1, group: "field" },
  { key: "fieldRows",     label: "Field Rows",     type: "number", default: 30, min: 4, max: 80, step: 1, group: "field" },
  { key: "colors",        label: "Colors",         type: "string", default: '["#2a1a0a","#5c3a1a"]', group: "brush" },
  { key: "brushWidth",    label: "Brush Width",    type: "number", default: 20, min: 4, max: 100, step: 1, group: "brush" },
  { key: "bristleCount",  label: "Bristle Count",  type: "number", default: 10, min: 4, max: 40,  step: 1, group: "brush" },
  { key: "strokeSteps",   label: "Stroke Steps",   type: "number", default: 40, min: 10, max: 200, step: 5, group: "brush" },
  { key: "strokeCount",   label: "Stroke Count",   type: "number", default: 300, min: 20, max: 2000, step: 20, group: "brush" },
  { key: "paintLoad",     label: "Paint Load",     type: "number", default: 0.7, min: 0, max: 1, step: 0.05, group: "brush" },
  { key: "pressure",      label: "Pressure",       type: "number", default: 0.65, min: 0, max: 1, step: 0.05, group: "brush" },
  { key: "taper",         label: "Taper",          type: "select", default: "pointed", options: TAPER_OPTIONS, group: "brush" },
  { key: "texture",       label: "Texture",        type: "select", default: "smooth",  options: TEXTURE_OPTIONS, group: "brush" },
  { key: "colorMode",     label: "Color Mode",     type: "select", default: "single",  options: COLOR_MODE_OPTIONS, group: "color" },
  { key: "colorJitter",   label: "Color Jitter",   type: "number", default: 15, min: 0, max: 100, step: 5, group: "color" },
  { key: "angleOffset",   label: "Angle Offset°",  type: "number", default: 0, min: -180, max: 180, step: 5, group: "flow" },
  { key: "angleSpread",   label: "Angle Spread",   type: "number", default: 0.15, min: 0, max: 1, step: 0.05, group: "flow" },
  { key: "flowInfluence", label: "Flow Influence", type: "number", default: 1.0, min: 0, max: 1, step: 0.05, group: "flow" },
  {
    key: "paintMode", label: "Paint Mode", type: "select", default: "normal",
    options: [
      { value: "multiply", label: "Multiply (darken)" },
      { value: "normal",   label: "Normal (opaque)" },
      { value: "screen",   label: "Screen (lighten)" },
    ],
    group: "paint",
  },
  { key: "opacity", label: "Opacity", type: "number", default: 0.5, min: 0, max: 1, step: 0.01, group: "paint" },
  { key: "seed",    label: "Seed",    type: "number", default: 0, min: 0, max: 99999, step: 1, group: "paint" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function taperIndex(t: string): number {
  if (t === "blunt")  return 1;
  if (t === "chisel") return 2;
  return 0;
}

// ---------------------------------------------------------------------------
// Layer type definition
// ---------------------------------------------------------------------------

export const bristleStrokeLayerType: LayerTypeDefinition = {
  typeId: "painting:bristle-stroke",
  displayName: "Bristle Stroke",
  icon: "bristle-stroke",
  category: "paint",
  properties: BRISTLE_STROKE_PROPERTIES,
  propertyEditorId: "painting:bristle-stroke-editor",

  createDefault(): LayerProperties {
    const props: LayerProperties = {};
    for (const schema of BRISTLE_STROKE_PROPERTIES) props[schema.key] = schema.default;
    return props;
  },

  render(
    properties: LayerProperties,
    ctx: CanvasRenderingContext2D,
    bounds: LayerBounds,
    _resources: RenderResources,
  ): void {
    const fieldStr      = (properties.field as string)          ?? "noise:0:0.08:4";
    const cols          = (properties.fieldCols as number)      ?? 30;
    const rows          = (properties.fieldRows as number)      ?? 30;
    const colorsStr     = (properties.colors as string)         ?? '["#2a1a0a"]';
    const brushWidth    = (properties.brushWidth as number)     ?? 20;
    const bristleCount  = (properties.bristleCount as number)   ?? 10;
    const strokeSteps   = (properties.strokeSteps as number)    ?? 40;
    const strokeCount   = (properties.strokeCount as number)    ?? 300;
    const paintLoad     = (properties.paintLoad as number)      ?? 0.7;
    const pressure      = (properties.pressure as number)       ?? 0.65;
    const taperStr      = (properties.taper as string)          ?? "pointed";
    const texture       = (properties.texture as string)        ?? "smooth";
    const colorMode     = (properties.colorMode as string)      ?? "single";
    const colorJitter   = (properties.colorJitter as number)    ?? 15;
    const angleOffset   = (properties.angleOffset as number)    ?? 0;
    const angleSpread   = (properties.angleSpread as number)    ?? 0.15;
    const flowInfluence = (properties.flowInfluence as number)  ?? 1.0;
    const paintMode     = (properties.paintMode as string)      ?? "normal";
    const opacity       = (properties.opacity as number)        ?? 0.5;
    const seed          = (properties.seed as number)           ?? 0;

    const w = Math.ceil(bounds.width);
    const h = Math.ceil(bounds.height);
    if (w <= 0 || h <= 0) return;

    const field = parseField(fieldStr, cols, rows);
    const rng   = mulberry32(seed);

    // Parse colors
    let rawColors: string[] = [];
    try { rawColors = JSON.parse(colorsStr) as string[]; } catch { /* fallback below */ }
    const palette = (rawColors.length > 0 ? rawColors : ["#2a1a0a"]).map(hexToRgb);

    // Flow function for traceBrushPath
    const flowFn = (x: number, y: number): [number, number] => {
      const s = sampleField(field, Math.max(0, Math.min(1, x / w)), Math.max(0, Math.min(1, y / h)));
      return [s.dx, s.dy];
    };

    // Seed strokes on sparse grid approximating strokeCount
    const strokeSpacing = Math.sqrt((w * h) / Math.max(1, strokeCount));
    const sgCols = Math.ceil(w / strokeSpacing) + 1;
    const sgRows = Math.ceil(h / strokeSpacing) + 1;

    ctx.save();
    if (paintMode === "screen") {
      ctx.globalCompositeOperation = "screen";
    } else if (paintMode === "normal") {
      ctx.globalCompositeOperation = "source-over";
    } else {
      ctx.globalCompositeOperation = "multiply";
    }

    const cfg = defaultBristleConfig({
      width: brushWidth,
      bristleCount,
      alpha: opacity,
      pressure,
      paintLoad,
      taper: taperIndex(taperStr),
      texture: texture as BristleConfig["texture"],
      colorMode: colorMode as BristleConfig["colorMode"],
      palette,
      colorJitter,
    });

    for (let sgr = 0; sgr < sgRows; sgr++) {
      for (let sgc = 0; sgc < sgCols; sgc++) {
        const sx = (sgc + 0.5) * strokeSpacing + (rng() - 0.5) * strokeSpacing * 0.5;
        const sy = (sgr + 0.5) * strokeSpacing + (rng() - 0.5) * strokeSpacing * 0.5;
        const path = traceBrushPath(flowFn, sx, sy, strokeSteps, 2.5, angleOffset, angleSpread, flowInfluence, rng);
        renderBristleStroke(ctx, path, cfg, rng);
      }
    }

    ctx.restore();
  },

  validate(properties: LayerProperties): ValidationError[] | null {
    const errors: ValidationError[] = [];
    const colorsStr = (properties.colors as string) ?? "";
    try {
      const parsed = JSON.parse(colorsStr);
      if (!Array.isArray(parsed)) {
        errors.push({ property: "colors", message: "colors must be a JSON array of hex strings" });
      }
    } catch {
      errors.push({ property: "colors", message: "colors must be valid JSON" });
    }
    return errors.length > 0 ? errors : null;
  },
};
