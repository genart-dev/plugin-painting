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
import { renderStrokes } from "./brush/stamp-renderer.js";
import { BRUSH_PRESETS } from "./brush/presets.js";
import { preloadTextureTip } from "./brush/tip-generator.js";
import type { BrushDefinition, BrushStroke } from "./brush/types.js";
import { parsePathSource, convertPathsToStrokes } from "./path-source.js";
import { parseDepthMapping, applyDepthMapping } from "./depth-mapping.js";

// ---------------------------------------------------------------------------
// Property schema
// ---------------------------------------------------------------------------

const STROKE_PROPERTIES: LayerPropertySchema[] = [
  // Brushes & strokes (JSON-encoded)
  {
    key: "brushes",
    label: "Custom Brushes",
    type: "string",
    default: "[]",
    group: "stroke",
  },
  {
    key: "strokes",
    label: "Strokes",
    type: "string",
    default: "[]",
    group: "stroke",
  },
  // Algorithm path source (ADR 072)
  {
    key: "pathSource",
    label: "Path Source",
    type: "string",
    default: "",
    group: "stroke",
  },
  {
    key: "pathBrushId",
    label: "Path Brush",
    type: "string",
    default: "flat",
    group: "stroke",
  },
  {
    key: "pathColor",
    label: "Path Color",
    type: "color",
    default: "#000000",
    group: "stroke",
  },
  {
    key: "depthMapping",
    label: "Depth Mapping",
    type: "string",
    default: "",
    group: "stroke",
  },
  // Optional vector field (for hybrid flow influence)
  {
    key: "field",
    label: "Vector Field",
    type: "string",
    default: "",
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
  // Shared
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
  {
    key: "opacity",
    label: "Opacity",
    type: "number",
    default: 1,
    min: 0,
    max: 1,
    step: 0.01,
    group: "paint",
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
// Layer type definition
// ---------------------------------------------------------------------------

export const strokeLayerType: LayerTypeDefinition = {
  typeId: "painting:stroke",
  displayName: "Brush Stroke",
  icon: "brush",
  category: "draw",
  properties: STROKE_PROPERTIES,
  propertyEditorId: "painting:stroke-editor",

  createDefault(): LayerProperties {
    const props: LayerProperties = {};
    for (const schema of STROKE_PROPERTIES) {
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
    const brushesStr = (properties.brushes as string) ?? "[]";
    const strokesStr = (properties.strokes as string) ?? "[]";
    const pathSourceStr = (properties.pathSource as string) ?? "";
    const pathBrushId = (properties.pathBrushId as string) ?? "flat";
    const pathColor = (properties.pathColor as string) ?? "#000000";
    const depthMappingStr = (properties.depthMapping as string) ?? "";
    const fieldStr = (properties.field as string) ?? "";
    const cols = (properties.fieldCols as number) ?? 20;
    const rows = (properties.fieldRows as number) ?? 20;
    const seed = (properties.seed as number) ?? 0;
    const layerOpacity = (properties.opacity as number) ?? 1;
    const debug = (properties.debug as boolean) ?? false;
    const debugOpacity = (properties.debugOpacity as number) ?? 0.7;
    const debugMode = ((properties.debugMode as string) ?? "all") as DebugMode;

    const w = Math.ceil(bounds.width);
    const h = Math.ceil(bounds.height);
    if (w <= 0 || h <= 0) return;

    // Parse custom brushes and merge with presets
    let customBrushes: BrushDefinition[] = [];
    try {
      customBrushes = JSON.parse(brushesStr) as BrushDefinition[];
    } catch {
      customBrushes = [];
    }

    const brushMap: Record<string, BrushDefinition> = { ...BRUSH_PRESETS };
    for (const b of customBrushes) {
      if (b.id) brushMap[b.id] = b;
    }

    // Parse strokes — from JSON property or algorithm path source (ADR 072)
    let strokes: BrushStroke[] = [];

    if (pathSourceStr) {
      // ADR 072: Convert algorithm stroke paths to brush strokes
      const algorithmPaths = parsePathSource(pathSourceStr);
      if (algorithmPaths.length > 0) {
        const depthMap = parseDepthMapping(depthMappingStr);
        if (depthMap) {
          strokes = applyDepthMapping(algorithmPaths, depthMap, pathBrushId, pathColor, seed);
        } else {
          strokes = convertPathsToStrokes(algorithmPaths, {
            brushId: pathBrushId,
            color: pathColor,
            size: undefined,
            seed,
          });
        }
      }
    } else {
      try {
        strokes = JSON.parse(strokesStr) as BrushStroke[];
      } catch {
        strokes = [];
      }
    }

    if (strokes.length === 0) return;

    // Preload texture tips for any texture brushes (must happen before render)
    const allBrushes = [...Object.values(brushMap), ...customBrushes];
    for (const b of allBrushes) {
      if (b.tipType === "texture" && b.tipTexture) {
        preloadTextureTip(b.tipTexture);
      }
    }

    // Also check presets referenced by strokes that might have texture tips
    for (const stroke of strokes) {
      const brush = brushMap[stroke.brushId];
      if (brush?.tipType === "texture" && brush.tipTexture) {
        preloadTextureTip(brush.tipTexture);
      }
    }

    // Render strokes
    ctx.save();
    ctx.globalAlpha = layerOpacity;
    renderStrokes(strokes, brushMap, ctx, bounds, seed);
    ctx.restore();

    // Optional field-based hybrid influence: if a field is specified,
    // modulate the rendered strokes by sampling field magnitude as an
    // alpha mask. This lets vector fields subtly influence brush output.
    if (fieldStr) {
      try {
        const field = parseField(fieldStr, cols, rows);
        const imageData = ctx.getImageData(bounds.x, bounds.y, w, h);
        const data = imageData.data;

        for (let py = 0; py < h; py++) {
          for (let px = 0; px < w; px++) {
            const nx = w > 1 ? px / (w - 1) : 0;
            const ny = h > 1 ? py / (h - 1) : 0;
            const sample = sampleField(field, nx, ny);
            const i = (py * w + px) * 4;
            // Modulate alpha by field magnitude (higher magnitude = more visible)
            data[i + 3] = Math.round(data[i + 3]! * sample.magnitude);
          }
        }

        ctx.putImageData(imageData, bounds.x, bounds.y);

        // Debug overlay for the field
        if (debug) {
          renderDebugOverlay(field, ctx, bounds, {
            mode: debugMode,
            opacity: debugOpacity,
          });
        }
      } catch {
        // Invalid field string — skip field influence
      }
    }
  },

  validate(properties: LayerProperties): ValidationError[] | null {
    const errors: ValidationError[] = [];

    // Validate brushes JSON
    const brushesStr = properties.brushes;
    if (typeof brushesStr === "string" && brushesStr !== "") {
      try {
        const parsed = JSON.parse(brushesStr);
        if (!Array.isArray(parsed)) {
          errors.push({ property: "brushes", message: "Brushes must be a JSON array" });
        }
      } catch {
        errors.push({ property: "brushes", message: "Brushes must be valid JSON" });
      }
    }

    // Validate depthMapping JSON
    const depthMappingVal = properties.depthMapping;
    if (typeof depthMappingVal === "string" && depthMappingVal !== "") {
      try {
        const parsed = JSON.parse(depthMappingVal);
        if (typeof parsed !== "object" || parsed === null) {
          errors.push({ property: "depthMapping", message: "Depth mapping must be a JSON object" });
        } else if (typeof parsed.maxDepth !== "number") {
          errors.push({ property: "depthMapping", message: "Depth mapping must have a numeric maxDepth" });
        }
      } catch {
        errors.push({ property: "depthMapping", message: "Depth mapping must be valid JSON" });
      }
    }

    // Validate strokes JSON
    const strokesStr = properties.strokes;
    if (typeof strokesStr === "string" && strokesStr !== "") {
      try {
        const parsed = JSON.parse(strokesStr);
        if (!Array.isArray(parsed)) {
          errors.push({ property: "strokes", message: "Strokes must be a JSON array" });
        }
      } catch {
        errors.push({ property: "strokes", message: "Strokes must be valid JSON" });
      }
    }

    return errors.length > 0 ? errors : null;
  },
};
