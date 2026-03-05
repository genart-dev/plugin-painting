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
import type { FillRegion, FillStrategy, ShadingFunction, ShadingAffect, GeneratedPath } from "./fill/types.js";
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

interface PathCacheEntry {
  key: string;
  paths: GeneratedPath[];
}

// Per-layer cache: property hash → generated paths.
const _pathCache = new Map<string, PathCacheEntry>();

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
// Native Canvas2D path rendering (anti-aliased lines for geometric fills)
// ---------------------------------------------------------------------------

/**
 * Returns true if the brush is simple enough for native Canvas2D line rendering.
 * Simple = round tip, high hardness, near-circular, no scatter/grain/texture.
 */
function isSimpleBrush(brush: BrushDefinition): boolean {
  if (brush.tipType === "texture") return false;
  if (brush.scatter > 0.01 || brush.scatterAlongPath > 0.01) return false;
  if (brush.grainTexture) return false;
  if (brush.roundness < 0.8) return false;
  return true;
}

/**
 * Render generated paths using native Canvas2D stroke() for anti-aliased output.
 * Used for geometric fills (hatch, crosshatch, contour, stipple) with simple brushes.
 */
function renderNativePaths(
  paths: GeneratedPath[],
  brush: BrushDefinition,
  color: string,
  size: number,
  ctx: CanvasRenderingContext2D,
): void {
  // Generated paths use absolute canvas coordinates.
  // Native rendering draws directly to the main ctx (not offscreen), so no offset needed.
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const gp of paths) {
    const effectiveSize = size * gp.sizeScale;
    const effectiveOpacity = gp.opacityScale * brush.opacity * brush.flow;

    if (gp.points.length === 2) {
      const p0 = gp.points[0]!;
      const p1 = gp.points[1]!;
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;

      // Single-point stipple dot: distance < 1px
      if (dx * dx + dy * dy < 1) {
        ctx.globalAlpha = effectiveOpacity;
        ctx.beginPath();
        ctx.arc(p0.x, p0.y, effectiveSize / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
    }

    // Multi-point path: use native stroke
    ctx.globalAlpha = effectiveOpacity;
    ctx.lineWidth = effectiveSize;
    ctx.beginPath();
    const first = gp.points[0]!;
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < gp.points.length; i++) {
      const pt = gp.points[i]!;
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
  }
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

    // Resolve effective brush for rendering mode decision
    const effectiveBrushId = customBrush?.id ?? brushId;
    const effectiveBrush = brushMap[effectiveBrushId] ?? brushMap["ink-pen"]!;
    const useNative = isSimpleBrush(effectiveBrush);

    // Preload texture tips (only needed for stamp pipeline)
    if (!useNative) {
      for (const b of Object.values(brushMap)) {
        if (b.tipType === "texture" && b.tipTexture) {
          preloadTextureTip(b.tipTexture);
        }
      }
    }

    // Generate paths (cached)
    const cacheKey = makeCacheKey(properties, bounds);
    let generatedPaths: GeneratedPath[];

    const cachedPaths = _pathCache.get(cacheKey);
    if (cachedPaths) {
      generatedPaths = cachedPaths.paths;
    } else {
      generatedPaths = generateFillPaths(strategy, region, shading, shadingAffects, bounds, seed);

      if (_pathCache.size > 50) {
        const firstKey = _pathCache.keys().next().value;
        if (firstKey !== undefined) _pathCache.delete(firstKey);
      }
      _pathCache.set(cacheKey, { key: cacheKey, paths: generatedPaths });
    }

    if (generatedPaths.length === 0) return;

    // Render with clipping
    ctx.save();
    ctx.globalAlpha = layerOpacity;
    applyRegionClip(region, bounds, ctx);

    if (useNative) {
      // Native Canvas2D paths — anti-aliased lines/arcs (absolute coordinates)
      renderNativePaths(generatedPaths, effectiveBrush, color, sizeOverride, ctx);
    } else {
      // Stamp pipeline — needed for texture tips, scatter, grain, etc.
      const ox = bounds.x;
      const oy = bounds.y;
      const strokes: BrushStroke[] = generatedPaths.map((gp, i) => ({
        brushId: effectiveBrushId,
        color,
        points: gp.points.map((pt) => ({ x: pt.x - ox, y: pt.y - oy })),
        size: sizeOverride * gp.sizeScale,
        opacity: gp.opacityScale,
        seed: seed + i,
      }));
      renderStrokes(strokes, brushMap, ctx, bounds, seed);
    }

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
