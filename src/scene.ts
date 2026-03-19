/**
 * painting:scene — Paint-first rendering layer type.
 *
 * Reads the composite of all layers below it (via ctx.getImageData),
 * then re-renders the entire scene as bristle dabs. The underlying
 * layers provide color/value data; this layer provides the painterly
 * rendering with unified light, atmosphere, and wet mixing.
 *
 * Usage: Stack terrain/atmosphere/water layers below, add painting:scene
 * on top. The scene layer paints everything as impressionist dabs.
 */

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
import { type RGB } from "./shared/color-mix.js";
import { type LightSource, degreesToLightAngle } from "./shared/light-source.js";
import { applyAtmosphere, atmosphereDensityScale, type AtmosphereConfig } from "./shared/atmosphere.js";
import { WetBuffer, type WetMixConfig } from "./shared/wet-buffer.js";

// ---------------------------------------------------------------------------
// Property schema
// ---------------------------------------------------------------------------

const TEXTURE_OPTIONS = [
  { value: "smooth", label: "Smooth" },
  { value: "dry", label: "Dry" },
  { value: "rough", label: "Rough" },
  { value: "stipple", label: "Stipple" },
  { value: "feathered", label: "Feathered" },
  { value: "impasto", label: "Impasto" },
];

const SCENE_PROPERTIES: LayerPropertySchema[] = [
  // Field
  { key: "field",     label: "Vector Field",  type: "string", default: "noise:0:0.1:3", group: "field" },
  { key: "fieldCols", label: "Field Columns", type: "number", default: 20, min: 4, max: 60, step: 1, group: "field" },
  { key: "fieldRows", label: "Field Rows",    type: "number", default: 20, min: 4, max: 60, step: 1, group: "field" },
  // Brush
  { key: "brushWidth",   label: "Brush Width",   type: "number", default: 16, min: 4, max: 80, step: 1, group: "brush" },
  { key: "bristleCount", label: "Bristle Count", type: "number", default: 8, min: 3, max: 30, step: 1, group: "brush" },
  { key: "dabLength",    label: "Dab Length",    type: "number", default: 14, min: 4, max: 60, step: 1, group: "brush" },
  { key: "overlapDensity", label: "Overlap Density", type: "number", default: 0.8, min: 0.2, max: 2.0, step: 0.05, group: "brush" },
  { key: "gridJitter",  label: "Grid Jitter",  type: "number", default: 0.5, min: 0, max: 1, step: 0.05, group: "brush" },
  { key: "paintLoad",   label: "Paint Load",   type: "number", default: 0.7, min: 0, max: 1, step: 0.05, group: "brush" },
  { key: "pressure",    label: "Pressure",     type: "number", default: 0.6, min: 0, max: 1, step: 0.05, group: "brush" },
  { key: "texture",     label: "Texture",      type: "select", default: "smooth", options: TEXTURE_OPTIONS, group: "brush" },
  // Color
  { key: "colorJitter",    label: "Color Jitter",    type: "number", default: 10, min: 0, max: 60, step: 2, group: "color" },
  { key: "colorVariation", label: "Color Variation",  type: "number", default: 0.3, min: 0, max: 1, step: 0.05, group: "color" },
  // Flow
  { key: "flowInfluence", label: "Flow Influence", type: "number", default: 0.8, min: 0, max: 1, step: 0.05, group: "flow" },
  { key: "angleSpread",   label: "Angle Spread",   type: "number", default: 0.15, min: 0, max: 1, step: 0.05, group: "flow" },
  // Paint
  { key: "opacity", label: "Opacity", type: "number", default: 0.6, min: 0, max: 1, step: 0.01, group: "paint" },
  { key: "seed",    label: "Seed",    type: "number", default: 0, min: 0, max: 99999, step: 1, group: "paint" },
  // Light
  { key: "lightAngle",       label: "Light Angle°",       type: "number", default: 315, min: 0, max: 360, step: 5, group: "light" },
  { key: "lightElevation",   label: "Light Elevation",    type: "number", default: 0.5, min: 0, max: 1, step: 0.05, group: "light" },
  { key: "shadowDepth",      label: "Shadow Depth",       type: "number", default: 0.3, min: 0, max: 1, step: 0.05, group: "light" },
  { key: "highlightStrength", label: "Highlight Strength", type: "number", default: 0.25, min: 0, max: 1, step: 0.05, group: "light" },
  { key: "shadowTemperature", label: "Shadow Temperature", type: "number", default: 0, min: -1, max: 1, step: 0.1, group: "light" },
  // Atmosphere
  { key: "atmosphereHorizon",  label: "Horizon Y",            type: "number", default: 0.5, min: 0, max: 1, step: 0.05, group: "atmosphere" },
  { key: "atmosphereStrength", label: "Atmosphere Strength",   type: "number", default: 0, min: 0, max: 1, step: 0.05, group: "atmosphere" },
  { key: "atmosphereTemp",     label: "Atmosphere Temperature", type: "number", default: 0.5, min: 0, max: 1, step: 0.05, group: "atmosphere" },
  { key: "atmosphereChroma",   label: "Atmosphere Chroma",    type: "number", default: 0.5, min: 0, max: 1, step: 0.05, group: "atmosphere" },
  { key: "atmosphereDensity",  label: "Atmosphere Density",   type: "number", default: 0.3, min: 0, max: 1, step: 0.05, group: "atmosphere" },
  // Wet
  { key: "wetness",     label: "Wetness",      type: "number", default: 0, min: 0, max: 1, step: 0.05, group: "wet" },
  { key: "mixStrength", label: "Mix Strength",  type: "number", default: 0.5, min: 0, max: 1, step: 0.05, group: "wet" },
];

// ---------------------------------------------------------------------------
// Layer type definition
// ---------------------------------------------------------------------------

export const sceneLayerType: LayerTypeDefinition = {
  typeId: "painting:scene",
  displayName: "Paint Scene",
  icon: "paint-scene",
  category: "draw",
  propertyEditorId: "painting:scene-editor",

  properties: SCENE_PROPERTIES,

  render(
    properties: LayerProperties,
    ctx: CanvasRenderingContext2D,
    bounds: LayerBounds,
    _resources: RenderResources,
  ): void {
    const fieldStr      = (properties.field as string)        ?? "noise:0:0.1:3";
    const cols          = (properties.fieldCols as number)    ?? 20;
    const rows          = (properties.fieldRows as number)    ?? 20;
    const brushWidth    = (properties.brushWidth as number)   ?? 16;
    const bristleCount  = (properties.bristleCount as number) ?? 8;
    const dabLength     = (properties.dabLength as number)    ?? 14;
    const overlapDensity = (properties.overlapDensity as number) ?? 0.8;
    const gridJitter    = (properties.gridJitter as number)   ?? 0.5;
    const paintLoad     = (properties.paintLoad as number)    ?? 0.7;
    const pressure      = (properties.pressure as number)     ?? 0.6;
    const texture       = (properties.texture as string)      ?? "smooth";
    const colorJitter   = (properties.colorJitter as number)  ?? 10;
    const colorVariation = (properties.colorVariation as number) ?? 0.3;
    const flowInfluence = (properties.flowInfluence as number) ?? 0.8;
    const angleSpread   = (properties.angleSpread as number)  ?? 0.15;
    const opacity       = (properties.opacity as number)      ?? 0.6;
    const seed          = (properties.seed as number)         ?? 0;

    // Light
    const light: LightSource = {
      angle: degreesToLightAngle((properties.lightAngle as number) ?? 315),
      elevation: (properties.lightElevation as number) ?? 0.5,
      shadowDepth: (properties.shadowDepth as number) ?? 0.3,
      highlightStrength: (properties.highlightStrength as number) ?? 0.25,
      shadowTemperature: (properties.shadowTemperature as number) ?? 0,
    };

    // Atmosphere
    const atmoStrength = (properties.atmosphereStrength as number) ?? 0;
    const useAtmosphere = atmoStrength > 0;
    const atmosphere: AtmosphereConfig = {
      horizonY: (properties.atmosphereHorizon as number) ?? 0.5,
      valueCompression: atmoStrength,
      temperatureShift: ((properties.atmosphereTemp as number) ?? 0.5) * atmoStrength,
      chromaFalloff: ((properties.atmosphereChroma as number) ?? 0.5) * atmoStrength,
      densityFalloff: ((properties.atmosphereDensity as number) ?? 0.3) * atmoStrength,
    };

    // Wet mixing
    const wetnessProp = (properties.wetness as number) ?? 0;
    const useWet = wetnessProp > 0;
    const wetConfig: WetMixConfig = {
      wetness: wetnessProp,
      mixStrength: (properties.mixStrength as number) ?? 0.5,
      dryingRate: 0.3,
      muddyLimit: 0.7,
    };

    const w = Math.ceil(bounds.width);
    const h = Math.ceil(bounds.height);
    if (w <= 0 || h <= 0) return;

    // *** PAINT-FIRST: Read underlying layers as color data ***
    const sourceData = ctx.getImageData(0, 0, w, h).data;

    const field = parseField(fieldStr, cols, rows);
    const rng = mulberry32(seed);

    // Wet buffer from underlying canvas
    let wetBuffer: WetBuffer | null = null;
    if (useWet) {
      wetBuffer = new WetBuffer(w, h);
      wetBuffer.snapshot(ctx);
    }

    // Grid layout
    const spacing = brushWidth / Math.max(0.05, overlapDensity);
    const gCols = Math.ceil(w / spacing) + 1;
    const gRows = Math.ceil(h / spacing) + 1;

    ctx.save();

    for (let gr = 0; gr < gRows; gr++) {
      for (let gc = 0; gc < gCols; gc++) {
        const jx = (rng() - 0.5) * gridJitter * spacing;
        const jy = (rng() - 0.5) * gridJitter * spacing;
        const cx = (gc + 0.5) * spacing + jx;
        const cy = (gr + 0.5) * spacing + jy;

        if (cx < -brushWidth || cx > w + brushWidth || cy < -brushWidth || cy > h + brushWidth) continue;

        const nx = Math.max(0, Math.min(1, cx / w));
        const ny = Math.max(0, Math.min(1, cy / h));

        // Sample underlying pixel color
        const px = Math.min(w - 1, Math.max(0, Math.floor(cx)));
        const py = Math.min(h - 1, Math.max(0, Math.floor(cy)));
        const idx = (py * w + px) * 4;
        const srcR = sourceData[idx]!;
        const srcG = sourceData[idx + 1]!;
        const srcB = sourceData[idx + 2]!;
        const srcA = sourceData[idx + 3]!;

        // Skip fully transparent areas (no underlying content)
        if (srcA < 10) continue;

        // Build dab color from underlying + variation
        let dabColor: RGB = [srcR, srcG, srcB];

        // Apply atmosphere
        if (useAtmosphere) {
          const densityScale = atmosphereDensityScale(ny, atmosphere);
          if (densityScale < 1 && rng() > densityScale) continue;
          dabColor = applyAtmosphere(dabColor, ny, atmosphere);
        }

        // Apply wet mixing
        if (wetBuffer) {
          dabColor = wetBuffer.mixWithUnderlying(dabColor, cx, cy, wetConfig);
        }

        // Color variation: create a 2-color palette around the sampled color
        const varR = Math.round((rng() - 0.5) * colorVariation * 60);
        const varG = Math.round((rng() - 0.5) * colorVariation * 50);
        const varB = Math.round((rng() - 0.5) * colorVariation * 40);
        const secondColor: RGB = [
          Math.max(0, Math.min(255, dabColor[0] + varR)),
          Math.max(0, Math.min(255, dabColor[1] + varG)),
          Math.max(0, Math.min(255, dabColor[2] + varB)),
        ];

        const sample = sampleField(field, nx, ny);
        const flowAng = Math.atan2(sample.dy, sample.dx);
        const spreadAng = (rng() - 0.5) * 2 * angleSpread * Math.PI;
        const angle = lerp(spreadAng, flowAng, flowInfluence);

        const cfg = defaultBristleConfig({
          width: brushWidth,
          bristleCount,
          alpha: opacity,
          pressure,
          paintLoad,
          taper: 0, // pointed
          texture: texture as BristleConfig["texture"],
          colorMode: "lateral",
          palette: [dabColor, secondColor],
          colorJitter,
          light,
        });

        const path = traceDabPath(cx, cy, angle, dabLength);
        renderBristleStroke(ctx, path, cfg, rng);
      }
    }

    ctx.restore();
  },

  createDefault(): LayerProperties {
    const defaults: Record<string, unknown> = {};
    for (const prop of SCENE_PROPERTIES) {
      defaults[prop.key] = prop.default;
    }
    return defaults as LayerProperties;
  },

  validate(properties: LayerProperties): ValidationError[] | null {
    return null;
  },
};
