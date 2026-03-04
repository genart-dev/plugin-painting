import type {
  LayerTypeDefinition,
  LayerPropertySchema,
  LayerProperties,
  LayerBounds,
  RenderResources,
  ValidationError,
} from "@genart-dev/core";
import { BRUSH_PRESETS } from "./brush/presets.js";
import { preloadTextureTip } from "./brush/tip-generator.js";
import { renderStrokes } from "./brush/stamp-renderer.js";
import type { BrushDefinition, BrushStroke } from "./brush/types.js";
import type { FillRegion, FillStrategy, ShadingFunction, ShadingAffect } from "./fill/types.js";
import { generateFillPaths } from "./fill/generators.js";
import { applyRegionClip } from "./fill/region-utils.js";

// ---------------------------------------------------------------------------
// Property schema
// ---------------------------------------------------------------------------

const FILL_PROPERTIES: LayerPropertySchema[] = [
  {
    key: "brushId",
    label: "Brush",
    type: "string",
    default: "ink-pen",
    group: "fill",
  },
  {
    key: "brush",
    label: "Custom Brush (JSON)",
    type: "string",
    default: "",
    group: "fill",
  },
  {
    key: "color",
    label: "Color",
    type: "color",
    default: "#000000",
    group: "fill",
  },
  {
    key: "size",
    label: "Brush Size",
    type: "number",
    default: 4,
    min: 1,
    max: 100,
    step: 0.5,
    group: "fill",
  },
  {
    key: "region",
    label: "Region (JSON)",
    type: "string",
    default: '{"type":"bounds"}',
    group: "fill",
  },
  {
    key: "strategy",
    label: "Strategy (JSON)",
    type: "string",
    default: '{"type":"hatch","angle":45,"spacing":8}',
    group: "fill",
  },
  {
    key: "shading",
    label: "Shading (JSON)",
    type: "string",
    default: '{"type":"uniform"}',
    group: "fill",
  },
  {
    key: "shadingAffects",
    label: "Shading Affects",
    type: "string",
    default: '["density"]',
    group: "fill",
  },
  {
    key: "seed",
    label: "Seed",
    type: "number",
    default: 42,
    min: 0,
    max: 99999,
    step: 1,
    group: "fill",
  },
  {
    key: "opacity",
    label: "Opacity",
    type: "number",
    default: 1,
    min: 0,
    max: 1,
    step: 0.01,
    group: "fill",
  },
];

// ---------------------------------------------------------------------------
// Simple cache keyed by stringified properties
// ---------------------------------------------------------------------------

interface CacheEntry {
  key: string;
  strokes: BrushStroke[];
}

// Per-layer cache: layerId → last cached result
// Note: We use WeakMap-style via a plain Map since we have no layer object reference here.
// The key is a full property hash string.
const _renderCache = new Map<string, CacheEntry>();

function makeCacheKey(properties: LayerProperties, bounds: LayerBounds): string {
  return JSON.stringify([
    properties.brushId,
    properties.brush,
    properties.color,
    properties.size,
    properties.region,
    properties.strategy,
    properties.shading,
    properties.shadingAffects,
    properties.seed,
    bounds.x, bounds.y, bounds.width, bounds.height,
    properties.opacity,
  ]);
}

// ---------------------------------------------------------------------------
// Layer type definition
// ---------------------------------------------------------------------------

export const fillLayerType: LayerTypeDefinition = {
  typeId: "painting:fill",
  displayName: "Fill",
  icon: "bucket",
  category: "draw",
  properties: FILL_PROPERTIES,
  propertyEditorId: "painting:fill-editor",

  createDefault(): LayerProperties {
    const props: LayerProperties = {};
    for (const schema of FILL_PROPERTIES) {
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
    const w = Math.ceil(bounds.width);
    const h = Math.ceil(bounds.height);
    if (w <= 0 || h <= 0) return;

    // Parse properties
    let region: FillRegion = { type: "bounds" };
    try {
      region = JSON.parse((properties.region as string) ?? '{"type":"bounds"}') as FillRegion;
    } catch { /* use bounds */ }

    let strategy: FillStrategy = { type: "hatch", angle: 45, spacing: 8 };
    try {
      strategy = JSON.parse((properties.strategy as string) ?? "") as FillStrategy;
    } catch { /* use default */ }

    let shading: ShadingFunction = { type: "uniform" };
    try {
      shading = JSON.parse((properties.shading as string) ?? '{"type":"uniform"}') as ShadingFunction;
    } catch { /* use uniform */ }

    let shadingAffects: ShadingAffect[] = ["density"];
    try {
      shadingAffects = JSON.parse((properties.shadingAffects as string) ?? '["density"]') as ShadingAffect[];
    } catch { /* use density */ }

    const color = (properties.color as string) ?? "#000000";
    const sizeOverride = (properties.size as number) ?? 4;
    const seed = (properties.seed as number) ?? 42;
    const layerOpacity = (properties.opacity as number) ?? 1;
    const brushId = (properties.brushId as string) ?? "ink-pen";

    // Resolve brush
    let customBrush: BrushDefinition | null = null;
    if (properties.brush && typeof properties.brush === "string" && properties.brush.trim().startsWith("{")) {
      try {
        customBrush = JSON.parse(properties.brush as string) as BrushDefinition;
      } catch { /* ignore */ }
    }

    const brushMap: Record<string, BrushDefinition> = { ...BRUSH_PRESETS };
    if (customBrush?.id) {
      brushMap[customBrush.id] = customBrush;
    }

    // Preload texture tips
    for (const b of Object.values(brushMap)) {
      if (b.tipType === "texture" && b.tipTexture) {
        preloadTextureTip(b.tipTexture);
      }
    }

    // Check cache
    const cacheKey = makeCacheKey(properties, bounds);
    let strokes: BrushStroke[];

    const cached = _renderCache.get(cacheKey);
    if (cached) {
      strokes = cached.strokes;
    } else {
      // Generate paths
      const generatedPaths = generateFillPaths(strategy, region, shading, shadingAffects, bounds, seed);

      // Convert GeneratedPath → BrushStroke
      // Generated paths are in absolute canvas coordinates; the stamp renderer adds
      // bounds.x/bounds.y, so we convert to layer-local coordinates by subtracting.
      const effectiveBrushId = customBrush?.id ?? brushId;
      const ox = bounds.x;
      const oy = bounds.y;

      strokes = generatedPaths.map((gp, i) => ({
        brushId: effectiveBrushId,
        color,
        points: gp.points.map((pt) => ({ x: pt.x - ox, y: pt.y - oy })),
        size: sizeOverride * gp.sizeScale,
        opacity: gp.opacityScale,
        seed: seed + i,
      }));

      // Cache result (bounded to avoid unbounded growth)
      if (_renderCache.size > 50) {
        const firstKey = _renderCache.keys().next().value;
        if (firstKey !== undefined) _renderCache.delete(firstKey);
      }
      _renderCache.set(cacheKey, { key: cacheKey, strokes });
    }

    if (strokes.length === 0) return;

    // Render with clipping
    ctx.save();
    ctx.globalAlpha = layerOpacity;

    // Apply region clip so strokes don't bleed outside
    applyRegionClip(region, bounds, ctx);

    renderStrokes(strokes, brushMap, ctx, bounds, seed);

    ctx.restore();
  },

  validate(properties: LayerProperties): ValidationError[] | null {
    const errors: ValidationError[] = [];

    for (const key of ["region", "strategy", "shading", "shadingAffects"] as const) {
      const val = properties[key];
      if (typeof val === "string" && val.trim() !== "") {
        try {
          JSON.parse(val);
        } catch {
          errors.push({ property: key, message: `${key} must be valid JSON` });
        }
      }
    }

    return errors.length > 0 ? errors : null;
  },
};
