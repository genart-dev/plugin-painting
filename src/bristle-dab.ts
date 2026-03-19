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
  lerp,
  traceDabPath,
  renderBristleStroke,
  defaultBristleConfig,
  type BristleConfig,
} from "./shared/bristle.js";
import { degreesToLightAngle, type LightSource } from "./shared/light-source.js";
import { applyAtmosphere, atmosphereDensityScale, type AtmosphereConfig } from "./shared/atmosphere.js";

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

const BRISTLE_DAB_PROPERTIES: LayerPropertySchema[] = [
  { key: "field",          label: "Vector Field",    type: "string", default: "noise:0:0.1:3", group: "field" },
  { key: "fieldCols",      label: "Field Columns",   type: "number", default: 20, min: 4, max: 60, step: 1, group: "field" },
  { key: "fieldRows",      label: "Field Rows",      type: "number", default: 20, min: 4, max: 60, step: 1, group: "field" },
  { key: "colors",         label: "Colors",          type: "string", default: '["#3a2a1a","#6b4c2a"]', group: "brush" },
  { key: "brushWidth",     label: "Brush Width",     type: "number", default: 24, min: 4, max: 120, step: 1, group: "brush" },
  { key: "bristleCount",   label: "Bristle Count",   type: "number", default: 12, min: 4, max: 40,  step: 1, group: "brush" },
  { key: "dabLength",      label: "Dab Length",      type: "number", default: 20, min: 4, max: 100, step: 1, group: "brush" },
  { key: "overlapDensity", label: "Overlap Density", type: "number", default: 0.6, min: 0.1, max: 2.0, step: 0.05, group: "brush" },
  { key: "gridJitter",     label: "Grid Jitter",     type: "number", default: 0.5, min: 0, max: 1, step: 0.05, group: "brush" },
  { key: "paintLoad",      label: "Paint Load",      type: "number", default: 0.7, min: 0, max: 1, step: 0.05, group: "brush" },
  { key: "pressure",       label: "Pressure",        type: "number", default: 0.65, min: 0, max: 1, step: 0.05, group: "brush" },
  { key: "taper",          label: "Taper",           type: "select", default: "pointed", options: TAPER_OPTIONS, group: "brush" },
  { key: "texture",        label: "Texture",         type: "select", default: "smooth",  options: TEXTURE_OPTIONS, group: "brush" },
  { key: "colorMode",      label: "Color Mode",      type: "select", default: "single",  options: COLOR_MODE_OPTIONS, group: "color" },
  { key: "colorJitter",    label: "Color Jitter",    type: "number", default: 15, min: 0, max: 100, step: 5, group: "color" },
  { key: "angleOffset",    label: "Angle Offset°",   type: "number", default: 0, min: -180, max: 180, step: 5, group: "flow" },
  { key: "angleSpread",    label: "Angle Spread",    type: "number", default: 0.1, min: 0, max: 1, step: 0.05, group: "flow" },
  { key: "flowInfluence",  label: "Flow Influence",  type: "number", default: 1.0, min: 0, max: 1, step: 0.05, group: "flow" },
  {
    key: "paintMode", label: "Paint Mode", type: "select", default: "normal",
    options: [
      { value: "multiply", label: "Multiply (darken)" },
      { value: "normal",   label: "Normal (opaque)" },
      { value: "screen",   label: "Screen (lighten)" },
    ],
    group: "paint",
  },
  { key: "opacity", label: "Opacity", type: "number", default: 0.65, min: 0, max: 1, step: 0.01, group: "paint" },
  { key: "seed",    label: "Seed",    type: "number", default: 0, min: 0, max: 99999, step: 1, group: "paint" },
  { key: "lightAngle",    label: "Light Angle°",     type: "number", default: 315, min: 0, max: 360, step: 5, group: "light" },
  { key: "lightElevation",label: "Light Elevation",   type: "number", default: 0.5, min: 0, max: 1, step: 0.05, group: "light" },
  { key: "shadowDepth",   label: "Shadow Depth",      type: "number", default: 0.3, min: 0, max: 1, step: 0.05, group: "light" },
  { key: "highlightStrength", label: "Highlight Strength", type: "number", default: 0.25, min: 0, max: 1, step: 0.05, group: "light" },
  { key: "shadowTemperature", label: "Shadow Temperature", type: "number", default: 0, min: -1, max: 1, step: 0.1, group: "light" },
  { key: "atmosphereHorizon",  label: "Horizon Y",           type: "number", default: 0.5, min: 0, max: 1, step: 0.05, group: "atmosphere" },
  { key: "atmosphereStrength", label: "Atmosphere Strength",  type: "number", default: 0, min: 0, max: 1, step: 0.05, group: "atmosphere" },
  { key: "atmosphereTemp",     label: "Atmosphere Temperature", type: "number", default: 0.5, min: 0, max: 1, step: 0.05, group: "atmosphere" },
  { key: "atmosphereChroma",   label: "Atmosphere Chroma",    type: "number", default: 0.5, min: 0, max: 1, step: 0.05, group: "atmosphere" },
  { key: "atmosphereDensity",  label: "Atmosphere Density",   type: "number", default: 0.3, min: 0, max: 1, step: 0.05, group: "atmosphere" },
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

export const bristleDabLayerType: LayerTypeDefinition = {
  typeId: "painting:bristle-dab",
  displayName: "Bristle Dab",
  icon: "bristle-dab",
  category: "draw",
  properties: BRISTLE_DAB_PROPERTIES,
  propertyEditorId: "painting:bristle-dab-editor",

  createDefault(): LayerProperties {
    const props: LayerProperties = {};
    for (const schema of BRISTLE_DAB_PROPERTIES) props[schema.key] = schema.default;
    return props;
  },

  render(
    properties: LayerProperties,
    ctx: CanvasRenderingContext2D,
    bounds: LayerBounds,
    _resources: RenderResources,
  ): void {
    const fieldStr       = (properties.field as string)          ?? "noise:0:0.1:3";
    const cols           = (properties.fieldCols as number)      ?? 20;
    const rows           = (properties.fieldRows as number)      ?? 20;
    const colorsStr      = (properties.colors as string)         ?? '["#3a2a1a"]';
    const brushWidth     = (properties.brushWidth as number)     ?? 24;
    const bristleCount   = (properties.bristleCount as number)   ?? 12;
    const dabLength      = (properties.dabLength as number)      ?? 20;
    const overlapDensity = (properties.overlapDensity as number) ?? 0.6;
    const gridJitter     = (properties.gridJitter as number)     ?? 0.5;
    const paintLoad      = (properties.paintLoad as number)      ?? 0.7;
    const pressure       = (properties.pressure as number)       ?? 0.65;
    const taperStr       = (properties.taper as string)          ?? "pointed";
    const texture        = (properties.texture as string)        ?? "smooth";
    const colorMode      = (properties.colorMode as string)      ?? "single";
    const colorJitter    = (properties.colorJitter as number)    ?? 15;
    const angleOffset    = (properties.angleOffset as number)    ?? 0;
    const angleSpread    = (properties.angleSpread as number)    ?? 0.1;
    const flowInfluence  = (properties.flowInfluence as number)  ?? 1.0;
    const paintMode      = (properties.paintMode as string)      ?? "normal";
    const opacity        = (properties.opacity as number)        ?? 0.65;
    const seed           = (properties.seed as number)           ?? 0;
    const lightAngleDeg  = (properties.lightAngle as number)     ?? 315;
    const lightElevation = (properties.lightElevation as number) ?? 0.5;
    const shadowDepth    = (properties.shadowDepth as number)    ?? 0.3;
    const highlightStr   = (properties.highlightStrength as number) ?? 0.25;
    const shadowTemp     = (properties.shadowTemperature as number) ?? 0;

    const light: LightSource = {
      angle: degreesToLightAngle(lightAngleDeg),
      elevation: lightElevation,
      shadowDepth,
      highlightStrength: highlightStr,
      shadowTemperature: shadowTemp,
    };

    const atmoStrength  = (properties.atmosphereStrength as number) ?? 0;
    const atmoHorizon   = (properties.atmosphereHorizon as number)  ?? 0.5;
    const atmoTemp      = (properties.atmosphereTemp as number)     ?? 0.5;
    const atmoChroma    = (properties.atmosphereChroma as number)   ?? 0.5;
    const atmoDensity   = (properties.atmosphereDensity as number)  ?? 0.3;
    const useAtmosphere = atmoStrength > 0;

    const atmosphere: AtmosphereConfig = {
      horizonY: atmoHorizon,
      valueCompression: atmoStrength,
      temperatureShift: atmoTemp * atmoStrength,
      chromaFalloff: atmoChroma * atmoStrength,
      densityFalloff: atmoDensity * atmoStrength,
    };

    const w = Math.ceil(bounds.width);
    const h = Math.ceil(bounds.height);
    if (w <= 0 || h <= 0) return;

    const field = parseField(fieldStr, cols, rows);
    const rng   = mulberry32(seed);

    // Parse colors
    let rawColors: string[] = [];
    try { rawColors = JSON.parse(colorsStr) as string[]; } catch { /* fallback below */ }
    const palette = (rawColors.length > 0 ? rawColors : ["#3a2a1a"]).map(hexToRgb);

    // Grid layout: spacing = brushWidth / overlapDensity
    const spacing = brushWidth / Math.max(0.05, overlapDensity);
    const gCols   = Math.ceil(w / spacing) + 1;
    const gRows   = Math.ceil(h / spacing) + 1;

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
      light,
    });

    const artistAngRad = angleOffset * Math.PI / 180;

    for (let gr = 0; gr < gRows; gr++) {
      for (let gc = 0; gc < gCols; gc++) {
        const jx = (rng() - 0.5) * gridJitter * spacing;
        const jy = (rng() - 0.5) * gridJitter * spacing;
        const cx = (gc + 0.5) * spacing + jx;
        const cy = (gr + 0.5) * spacing + jy;

        if (cx < -brushWidth || cx > w + brushWidth || cy < -brushWidth || cy > h + brushWidth) continue;

        const nx = Math.max(0, Math.min(1, cx / w));
        const ny = Math.max(0, Math.min(1, cy / h));
        const sample = sampleField(field, nx, ny);
        const flowAng   = Math.atan2(sample.dy, sample.dx);
        const spreadAng = (rng() - 0.5) * 2 * angleSpread * Math.PI;
        const angle     = lerp(artistAngRad + spreadAng, flowAng, flowInfluence);

        // Atmospheric perspective: skip dabs for density falloff, modify palette colors
        if (useAtmosphere) {
          const densityScale = atmosphereDensityScale(ny, atmosphere);
          if (densityScale < 1 && rng() > densityScale) continue;
          const atmoPalette = palette.map(c => applyAtmosphere(c, ny, atmosphere));
          const atmoCfg = { ...cfg, palette: atmoPalette };
          const path = traceDabPath(cx, cy, angle, dabLength);
          renderBristleStroke(ctx, path, atmoCfg, rng);
        } else {
          const path = traceDabPath(cx, cy, angle, dabLength);
          renderBristleStroke(ctx, path, cfg, rng);
        }
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
