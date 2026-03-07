import type {
  McpToolDefinition,
  McpToolContext,
  McpToolResult,
  JsonSchema,
  DesignLayer,
  LayerTransform,
} from "@genart-dev/core";
import { watercolorLayerType } from "./watercolor.js";
import { inkLayerType } from "./ink.js";
import { charcoalLayerType } from "./charcoal.js";
import { oilAcrylicLayerType } from "./oil-acrylic.js";
import { gouacheLayerType } from "./gouache.js";
import { pastelLayerType } from "./pastel.js";
import { strokeLayerType } from "./stroke-layer.js";
import { fillLayerType } from "./fill-layer.js";
import { parseField } from "./vector-field.js";
import type { VectorField, VectorSample } from "./vector-field.js";
import { BRUSH_PRESETS, getBrushPreset } from "./brush/presets.js";
import type { BrushDefinition, BrushStroke, StrokePoint } from "./brush/types.js";
import { FILL_PRESETS, resolveStrategy } from "./fill/presets.js";
import type { FillRegion, FillStrategy, ShadingFunction } from "./fill/types.js";

function textResult(text: string): McpToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(text: string): McpToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function generateLayerId(): string {
  return `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function fullCanvasTransform(ctx: McpToolContext): LayerTransform {
  return {
    x: 0,
    y: 0,
    width: ctx.canvasWidth,
    height: ctx.canvasHeight,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    anchorX: 0,
    anchorY: 0,
  };
}

// ---------------------------------------------------------------------------
// paint_layer — place a painting layer with an explicit or generated field
// ---------------------------------------------------------------------------

const SUPPORTED_MEDIUMS = ["watercolor", "oil", "gouache", "ink", "pastel", "charcoal"] as const;
type Medium = typeof SUPPORTED_MEDIUMS[number];

export const paintLayerTool: McpToolDefinition = {
  name: "paint_layer",
  description:
    "Add a painting layer driven by a 2D vector field. Supports watercolor, oil, gouache, ink, pastel, and charcoal media.",
  inputSchema: {
    type: "object",
    required: ["medium"],
    properties: {
      medium: {
        type: "string",
        enum: [...SUPPORTED_MEDIUMS],
        description: "Painting medium.",
      },
      field: {
        type: "string",
        description:
          'Vector field shorthand or JSON. Shorthands: "noise:seed:scale:octaves", "linear:angleDeg:magnitude", "radial:cx:cy:diverge|converge", "vortex:cx:cy:radius", "algorithm:channelName" (reads from algorithm data bridge). Defaults to "noise:0:0.1:3".',
      },
      fieldCols: {
        type: "number",
        description: "Field grid columns (default: 20).",
      },
      fieldRows: {
        type: "number",
        description: "Field grid rows (default: 20).",
      },
      colors: {
        type: "array",
        items: { type: "string" },
        description: 'Array of hex colors, e.g. ["#4a7fb5", "#7ab8d4"].',
      },
      // Watercolor-specific
      dilution: {
        type: "number",
        description: "Water dilution 0–1 (watercolor only, default: 0.5).",
      },
      granulation: {
        type: "number",
        description: "Pigment granulation 0–1 (watercolor only, default: 0.3).",
      },
      edgeStyle: {
        type: "string",
        enum: ["sharp", "soft", "diffuse", "lost"],
        description: "Edge style (watercolor only, default: soft).",
      },
      // Oil-specific
      impasto: {
        type: "boolean",
        description: "Raised paint bevel effect (oil only, default: false).",
      },
      scumble: {
        type: "boolean",
        description: "Dry-brush scumble gaps (oil only, default: false).",
      },
      blendRadius: {
        type: "number",
        description: "Wet paint drag/blend distance in pixels (oil only, default: 8).",
      },
      // Gouache-specific
      dryBrush: {
        type: "boolean",
        description: "Dry-brush texture (gouache only, default: false).",
      },
      // Ink-specific
      weight: {
        type: "number",
        description: "Stroke weight in pixels (ink only, default: 2).",
      },
      taper: {
        type: "string",
        enum: ["none", "head", "tail", "both"],
        description: "Stroke taper (ink only, default: none).",
      },
      style: {
        type: "string",
        enum: ["fluid", "scratchy", "brush"],
        description: "Ink stroke style (ink only, default: fluid).",
      },
      // Pastel-specific
      softness: {
        type: "number",
        description: "Mark softness / smear 0–1 (pastel only, default: 0.6).",
      },
      buildup: {
        type: "number",
        description: "Mark density buildup 0–1 (pastel only, default: 0.5).",
      },
      // Shared: charcoal + gouache + pastel
      grain: {
        type: "number",
        description: "Paper grain / texture intensity 0–1 (charcoal, gouache, pastel).",
      },
      density: {
        type: "number",
        description: "Mark density 0–1 (charcoal only, default: 0.5).",
      },
      smear: {
        type: "boolean",
        description: "Blend charcoal marks broadly (charcoal only, default: false).",
      },
      // Universal
      opacity: {
        type: "number",
        description: "Layer opacity 0–1 (default: 1.0).",
      },
      seed: {
        type: "number",
        description: "Random seed (default: 0).",
      },
      debug: {
        type: "boolean",
        description: "Show vector field debug overlay (default: false).",
      },
      debugMode: {
        type: "string",
        enum: ["arrows", "heatmap", "contours", "all"],
        description: 'Debug overlay mode (default: "all").',
      },
      debugOpacity: {
        type: "number",
        description: "Debug overlay opacity 0–1 (default: 0.7).",
      },
      index: {
        type: "number",
        description: "Layer stack position (default: top).",
      },
    },
  } satisfies JsonSchema,

  async handler(
    input: Record<string, unknown>,
    context: McpToolContext,
  ): Promise<McpToolResult> {
    const medium = (input.medium as string) ?? "watercolor";

    if (!(SUPPORTED_MEDIUMS as readonly string[]).includes(medium)) {
      return errorResult(
        `Medium "${medium}" is not supported. Valid options: ${SUPPORTED_MEDIUMS.join(", ")}.`,
      );
    }

    const fieldStr = (input.field as string | undefined) ?? "noise:0:0.1:3";
    const cols = Math.round((input.fieldCols as number | undefined) ?? 20);
    const rows = Math.round((input.fieldRows as number | undefined) ?? 20);

    // Algorithm fields are validated at runtime when data is available
    if (!fieldStr.startsWith("algorithm:")) {
      try {
        parseField(fieldStr, cols, rows);
      } catch {
        return errorResult(`Invalid field specification: "${fieldStr}"`);
      }
    }

    const rawColors = input.colors as string[] | undefined;
    const defaultColor =
      medium === "ink"      ? "#1a1a1a"
      : medium === "charcoal" ? "#2a2a2a"
      : medium === "oil"      ? "#c8723a"
      : medium === "gouache"  ? "#e8d5b0"
      : medium === "pastel"   ? "#d4a0c8"
      : /* watercolor */        "#4a7fb5";
    const colorsStr = rawColors ? JSON.stringify(rawColors) : `["${defaultColor}"]`;

    const baseDefaults =
      medium === "ink"      ? inkLayerType.createDefault()
      : medium === "charcoal" ? charcoalLayerType.createDefault()
      : medium === "oil"      ? oilAcrylicLayerType.createDefault()
      : medium === "gouache"  ? gouacheLayerType.createDefault()
      : medium === "pastel"   ? pastelLayerType.createDefault()
      : watercolorLayerType.createDefault();

    const properties: Record<string, unknown> = {
      ...baseDefaults,
      field: fieldStr,
      fieldCols: cols,
      fieldRows: rows,
      colors: colorsStr,
    };

    // Universal overrides
    for (const key of ["seed", "debug", "debugMode", "debugOpacity", "opacity"] as const) {
      if (input[key] !== undefined) properties[key] = input[key];
    }

    // Medium-specific overrides
    if (medium === "watercolor") {
      for (const key of ["dilution", "granulation", "edgeStyle"] as const) {
        if (input[key] !== undefined) properties[key] = input[key];
      }
    }
    if (medium === "oil") {
      for (const key of ["impasto", "scumble", "blendRadius"] as const) {
        if (input[key] !== undefined) properties[key] = input[key];
      }
    }
    if (medium === "gouache") {
      for (const key of ["dryBrush", "grain"] as const) {
        if (input[key] !== undefined) properties[key] = input[key];
      }
    }
    if (medium === "ink") {
      for (const key of ["weight", "taper", "style"] as const) {
        if (input[key] !== undefined) properties[key] = input[key];
      }
    }
    if (medium === "pastel") {
      for (const key of ["softness", "buildup", "grain"] as const) {
        if (input[key] !== undefined) properties[key] = input[key];
      }
    }
    if (medium === "charcoal") {
      for (const key of ["density", "smear", "grain"] as const) {
        if (input[key] !== undefined) properties[key] = input[key];
      }
    }

    const opacity = typeof input.opacity === "number" ? input.opacity : 1;
    const typeId = `painting:${medium as Medium}`;
    const name   = medium.charAt(0).toUpperCase() + medium.slice(1);

    // Oil and gouache use normal blend; others use multiply / soft-light
    const blendMode =
      medium === "oil" || medium === "gouache" ? "normal"
      : medium === "pastel"                    ? "soft-light"
      : "multiply";

    const layer: DesignLayer = {
      id: generateLayerId(),
      type: typeId,
      name,
      visible: true,
      locked: false,
      opacity,
      blendMode,
      transform: fullCanvasTransform(context),
      properties: properties as Record<string, string | number | boolean | null>,
    };

    const idx = typeof input.index === "number" ? input.index : undefined;
    context.layers.add(layer, idx);
    context.emitChange("layer-added");

    const debugInfo = properties.debug ? ` (debug: ${properties.debugMode ?? "all"})` : "";
    return textResult(`Added ${name} layer '${layer.id}' with field "${fieldStr}"${debugInfo}.`);
  },
};

// ---------------------------------------------------------------------------
// get_paint_field — inspect the vector field on a painting layer
// ---------------------------------------------------------------------------

export const getPaintFieldTool: McpToolDefinition = {
  name: "get_paint_field",
  description:
    "Return the VectorField JSON for a painting layer, for inspection or editing.",
  inputSchema: {
    type: "object",
    required: ["layerId"],
    properties: {
      layerId: {
        type: "string",
        description: "ID of the painting layer to inspect.",
      },
    },
  } satisfies JsonSchema,

  async handler(
    input: Record<string, unknown>,
    context: McpToolContext,
  ): Promise<McpToolResult> {
    const layerId = input.layerId as string;
    const layer = context.layers.get(layerId);
    if (!layer) {
      return errorResult(`Layer "${layerId}" not found.`);
    }
    const fieldStr = layer.properties.field as string | undefined;
    if (!fieldStr) {
      return errorResult(`Layer "${layerId}" has no vector field.`);
    }

    const cols = (layer.properties.fieldCols as number | undefined) ?? 20;
    const rows = (layer.properties.fieldRows as number | undefined) ?? 20;

    let fieldJson: string;
    if (fieldStr.startsWith("algorithm:")) {
      const channelName = fieldStr.slice("algorithm:".length);
      fieldJson = JSON.stringify({
        source: "algorithm",
        channel: channelName,
        cols,
        rows,
        note: "Data is provided at runtime by the algorithm via window.__genart_data",
      });
    } else if (fieldStr.startsWith("{")) {
      fieldJson = fieldStr;
    } else {
      const field = parseField(fieldStr, cols, rows);
      fieldJson = JSON.stringify(field);
    }

    return textResult(fieldJson);
  },
};

// ---------------------------------------------------------------------------
// update_paint_field — replace the vector field on an existing painting layer
// ---------------------------------------------------------------------------

export const updatePaintFieldTool: McpToolDefinition = {
  name: "update_paint_field",
  description:
    "Replace the vector field on an existing painting layer. Accepts shorthand strings, VectorField JSON, or \"algorithm:channelName\" to read from the algorithm data bridge.",
  inputSchema: {
    type: "object",
    required: ["layerId", "field"],
    properties: {
      layerId: {
        type: "string",
        description: "ID of the painting layer to update.",
      },
      field: {
        type: "string",
        description: "New field shorthand or VectorField JSON.",
      },
    },
  } satisfies JsonSchema,

  async handler(
    input: Record<string, unknown>,
    context: McpToolContext,
  ): Promise<McpToolResult> {
    const layerId = input.layerId as string;
    const fieldStr = input.field as string;

    const layer = context.layers.get(layerId);
    if (!layer) {
      return errorResult(`Layer "${layerId}" not found.`);
    }

    const cols = (layer.properties.fieldCols as number | undefined) ?? 20;
    const rows = (layer.properties.fieldRows as number | undefined) ?? 20;

    // Algorithm fields are validated at runtime when data is available
    if (!fieldStr.startsWith("algorithm:")) {
      try {
        parseField(fieldStr, cols, rows);
      } catch {
        return errorResult(`Invalid field specification: "${fieldStr}"`);
      }
    }

    context.layers.updateProperties(layerId, { field: fieldStr });
    context.emitChange("layer-updated");

    return textResult(`Updated field on layer "${layerId}" to "${fieldStr}".`);
  },
};

// ---------------------------------------------------------------------------
// generate_field_from_points — RBF-interpolated field from control points
// ---------------------------------------------------------------------------

interface ControlPoint {
  x: number;       // canvas pixel x
  y: number;       // canvas pixel y
  dx: number;      // normalized direction [-1, 1]
  dy: number;      // normalized direction [-1, 1]
  magnitude: number; // flow strength [0, 1]
}

/**
 * Radial Basis Function (RBF) interpolation of a scalar field.
 * Uses thin-plate spline kernel: φ(r) = r² log(r).
 * Falls back to inverse-distance weighting for robustness.
 */
function rbfInterpolate(
  points: ControlPoint[],
  nx: number,
  ny: number,
  canvasWidth: number,
  canvasHeight: number,
): VectorSample {
  if (points.length === 0) return { dx: 0, dy: 0, magnitude: 0 };

  // Inverse-distance weighting (IDW) — robust, no linear system needed
  let sumDx = 0, sumDy = 0, sumMag = 0, sumW = 0;
  const epsilon = 1e-6;

  for (const pt of points) {
    // Normalize control point coords to [0,1]
    const px = pt.x / canvasWidth;
    const py = pt.y / canvasHeight;

    const dist2 = (nx - px) ** 2 + (ny - py) ** 2;
    // Power=2 IDW gives smooth falloff
    const w = 1 / (dist2 + epsilon);

    sumDx  += pt.dx * w;
    sumDy  += pt.dy * w;
    sumMag += pt.magnitude * w;
    sumW   += w;
  }

  const invW = 1 / sumW;
  const rawDx  = sumDx  * invW;
  const rawDy  = sumDy  * invW;
  const mag    = Math.max(0, Math.min(1, sumMag * invW));

  // Normalize direction
  const len = Math.sqrt(rawDx * rawDx + rawDy * rawDy);
  const dx = len > 1e-6 ? rawDx / len : 0;
  const dy = len > 1e-6 ? rawDy / len : 0;

  return { dx, dy, magnitude: mag };
}

export const generateFieldFromPointsTool: McpToolDefinition = {
  name: "generate_field_from_points",
  description:
    "Generate a VectorField from agent-specified control points using RBF interpolation. " +
    "Each control point defines a flow direction and magnitude at a canvas position. " +
    "Returns the VectorField as a JSON string suitable for use as a painting layer's 'field' property.",
  inputSchema: {
    type: "object",
    required: ["canvasWidth", "canvasHeight", "controlPoints"],
    properties: {
      canvasWidth: {
        type: "number",
        description: "Canvas width in pixels.",
      },
      canvasHeight: {
        type: "number",
        description: "Canvas height in pixels.",
      },
      cols: {
        type: "number",
        description: "Field grid columns (default: 20).",
      },
      rows: {
        type: "number",
        description: "Field grid rows (default: 20).",
      },
      controlPoints: {
        type: "array",
        description: "Array of control points defining flow direction and magnitude.",
        items: {
          type: "object",
          required: ["x", "y", "dx", "dy", "magnitude"],
          properties: {
            x: { type: "number", description: "Pixel x position on canvas." },
            y: { type: "number", description: "Pixel y position on canvas." },
            dx: { type: "number", description: "Flow direction x component [-1, 1]." },
            dy: { type: "number", description: "Flow direction y component [-1, 1]." },
            magnitude: { type: "number", description: "Flow strength [0, 1]." },
          },
        },
        minItems: 1,
      },
    },
  } satisfies JsonSchema,

  async handler(
    input: Record<string, unknown>,
    _context: McpToolContext,
  ): Promise<McpToolResult> {
    const canvasWidth  = input.canvasWidth  as number;
    const canvasHeight = input.canvasHeight as number;
    const cols = Math.round((input.cols as number | undefined) ?? 20);
    const rows = Math.round((input.rows as number | undefined) ?? 20);

    if (canvasWidth <= 0 || canvasHeight <= 0) {
      return errorResult("canvasWidth and canvasHeight must be positive.");
    }
    if (cols < 2 || rows < 2) {
      return errorResult("cols and rows must be at least 2.");
    }

    const rawPoints = input.controlPoints as Array<Record<string, unknown>>;
    if (!Array.isArray(rawPoints) || rawPoints.length === 0) {
      return errorResult("controlPoints must be a non-empty array.");
    }

    const points: ControlPoint[] = [];
    for (let i = 0; i < rawPoints.length; i++) {
      const p = rawPoints[i]!;
      const x   = typeof p.x === "number" ? p.x : 0;
      const y   = typeof p.y === "number" ? p.y : 0;
      const dx  = typeof p.dx === "number" ? p.dx : 0;
      const dy  = typeof p.dy === "number" ? p.dy : 0;
      const mag = typeof p.magnitude === "number"
        ? Math.max(0, Math.min(1, p.magnitude))
        : 0.5;
      points.push({ x, y, dx, dy, magnitude: mag });
    }

    // Build grid by RBF-interpolating each grid cell from the control points
    const samples: VectorSample[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const nx = cols > 1 ? col / (cols - 1) : 0;
        const ny = rows > 1 ? row / (rows - 1) : 0;
        samples.push(rbfInterpolate(points, nx, ny, canvasWidth, canvasHeight));
      }
    }

    const field: VectorField = { cols, rows, samples };
    return textResult(JSON.stringify(field));
  },
};

// ---------------------------------------------------------------------------
// brush_stroke — create or append brush strokes on a painting:stroke layer
// ---------------------------------------------------------------------------

export const brushStrokeTool: McpToolDefinition = {
  name: "brush_stroke",
  description:
    "Create brush strokes on a painting:stroke layer. If layerId is provided, appends strokes to that layer; " +
    "otherwise creates a new painting:stroke layer. Supports all 11 built-in brush presets or inline custom brushes.",
  inputSchema: {
    type: "object",
    required: ["brushId", "color", "points"],
    properties: {
      layerId: {
        type: "string",
        description: "Existing painting:stroke layer ID to append to. Omit to create a new layer.",
      },
      brushId: {
        type: "string",
        description:
          'Brush preset ID (e.g. "round-hard", "ink-pen", "watercolor-round") or a custom brush ID defined on the layer.',
      },
      color: {
        type: "string",
        description: 'Stroke color as hex string, e.g. "#ff0000".',
      },
      points: {
        type: "array",
        description: "Array of stroke points [{x, y, pressure?}, ...].",
        items: {
          type: "object",
          required: ["x", "y"],
          properties: {
            x: { type: "number", description: "X position in canvas pixels." },
            y: { type: "number", description: "Y position in canvas pixels." },
            pressure: { type: "number", description: "Pen pressure 0–1 (default: 1.0)." },
          },
        },
        minItems: 2,
      },
      size: {
        type: "number",
        description: "Override brush size in pixels.",
      },
      opacity: {
        type: "number",
        description: "Override stroke opacity 0–1.",
      },
      seed: {
        type: "number",
        description: "PRNG seed for scatter/jitter.",
      },
      brush: {
        type: "object",
        description:
          "Inline custom brush definition (overrides brushId for this stroke). Must include at least 'id' and 'name'.",
      },
      index: {
        type: "number",
        description: "Layer stack position when creating a new layer (default: top).",
      },
    },
  } satisfies JsonSchema,

  async handler(
    input: Record<string, unknown>,
    context: McpToolContext,
  ): Promise<McpToolResult> {
    const brushId = input.brushId as string;
    const color = input.color as string;
    const rawPoints = input.points as Array<Record<string, unknown>>;

    if (!brushId) return errorResult("brushId is required.");
    if (!color) return errorResult("color is required.");
    if (!Array.isArray(rawPoints) || rawPoints.length < 2) {
      return errorResult("points must be an array of at least 2 points.");
    }

    // Validate color is hex-like
    if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) {
      return errorResult(`Invalid hex color: "${color}".`);
    }

    // Parse points
    const points: StrokePoint[] = rawPoints.map((p) => ({
      x: typeof p.x === "number" ? p.x : 0,
      y: typeof p.y === "number" ? p.y : 0,
      pressure: typeof p.pressure === "number" ? p.pressure : undefined,
    }));

    // Build the stroke
    const stroke: BrushStroke = {
      brushId,
      color,
      points,
      size: typeof input.size === "number" ? input.size : undefined,
      opacity: typeof input.opacity === "number" ? input.opacity : undefined,
      seed: typeof input.seed === "number" ? input.seed : undefined,
    };

    const layerId = input.layerId as string | undefined;

    if (layerId) {
      // Append to existing layer
      const layer = context.layers.get(layerId);
      if (!layer) return errorResult(`Layer "${layerId}" not found.`);
      if (layer.type !== "painting:stroke") {
        return errorResult(`Layer "${layerId}" is not a painting:stroke layer (is ${layer.type}).`);
      }

      // Parse existing strokes
      let existingStrokes: BrushStroke[] = [];
      try {
        existingStrokes = JSON.parse((layer.properties.strokes as string) ?? "[]") as BrushStroke[];
      } catch {
        existingStrokes = [];
      }

      // Handle inline brush override
      if (input.brush && typeof input.brush === "object") {
        const inlineBrush = input.brush as Record<string, unknown>;
        let existingBrushes: BrushDefinition[] = [];
        try {
          existingBrushes = JSON.parse((layer.properties.brushes as string) ?? "[]") as BrushDefinition[];
        } catch {
          existingBrushes = [];
        }

        // Add or replace the inline brush
        const idx = existingBrushes.findIndex((b) => b.id === inlineBrush.id);
        if (idx >= 0) {
          existingBrushes[idx] = inlineBrush as unknown as BrushDefinition;
        } else {
          existingBrushes.push(inlineBrush as unknown as BrushDefinition);
        }

        context.layers.updateProperties(layerId, {
          brushes: JSON.stringify(existingBrushes),
        });
      }

      existingStrokes.push(stroke);
      context.layers.updateProperties(layerId, {
        strokes: JSON.stringify(existingStrokes),
      });
      context.emitChange("layer-updated");

      return textResult(
        `Appended stroke #${existingStrokes.length} (brush: ${brushId}) to layer "${layerId}".`,
      );
    }

    // Create new layer
    const defaults = strokeLayerType.createDefault();

    // Handle inline brush
    if (input.brush && typeof input.brush === "object") {
      defaults.brushes = JSON.stringify([input.brush]);
    }

    defaults.strokes = JSON.stringify([stroke]);

    const newLayer: DesignLayer = {
      id: generateLayerId(),
      type: "painting:stroke",
      name: "Brush Stroke",
      visible: true,
      locked: false,
      opacity: typeof input.opacity === "number" ? input.opacity : 1,
      blendMode: "normal",
      transform: fullCanvasTransform(context),
      properties: defaults as Record<string, string | number | boolean | null>,
    };

    const idx = typeof input.index === "number" ? input.index : undefined;
    context.layers.add(newLayer, idx);
    context.emitChange("layer-added");

    return textResult(
      `Created painting:stroke layer "${newLayer.id}" with 1 stroke (brush: ${brushId}).`,
    );
  },
};

// ---------------------------------------------------------------------------
// list_brushes — list all available brushes (presets + custom on a layer)
// ---------------------------------------------------------------------------

export const listBrushesTool: McpToolDefinition = {
  name: "list_brushes",
  description:
    "List all available brush presets and any custom brushes defined on a specific painting:stroke layer.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      layerId: {
        type: "string",
        description: "Optional painting:stroke layer ID to include its custom brushes.",
      },
    },
  } satisfies JsonSchema,

  async handler(
    input: Record<string, unknown>,
    context: McpToolContext,
  ): Promise<McpToolResult> {
    const result: Array<{ id: string; name: string; tipType: string; source: "preset" | "custom" }> = [];

    // Add all presets
    for (const [id, brush] of Object.entries(BRUSH_PRESETS)) {
      result.push({ id, name: brush.name, tipType: brush.tipType, source: "preset" });
    }

    // Add custom brushes from layer if specified
    const layerId = input.layerId as string | undefined;
    if (layerId) {
      const layer = context.layers.get(layerId);
      if (!layer) return errorResult(`Layer "${layerId}" not found.`);
      if (layer.type !== "painting:stroke") {
        return errorResult(`Layer "${layerId}" is not a painting:stroke layer.`);
      }

      try {
        const customBrushes = JSON.parse(
          (layer.properties.brushes as string) ?? "[]",
        ) as BrushDefinition[];
        for (const b of customBrushes) {
          result.push({ id: b.id, name: b.name, tipType: b.tipType ?? "round", source: "custom" });
        }
      } catch {
        // Ignore invalid JSON
      }
    }

    return textResult(JSON.stringify(result, null, 2));
  },
};

// ---------------------------------------------------------------------------
// create_brush — add a custom BrushDefinition to a layer
// ---------------------------------------------------------------------------

export const createBrushTool: McpToolDefinition = {
  name: "create_brush",
  description:
    "Add a custom brush definition to a painting:stroke layer's brushes array. " +
    "The brush can then be referenced by its id in brush_stroke calls.",
  inputSchema: {
    type: "object",
    required: ["layerId", "brush"],
    properties: {
      layerId: {
        type: "string",
        description: "ID of the painting:stroke layer.",
      },
      brush: {
        type: "object",
        description:
          "BrushDefinition object. Required fields: id, name. " +
          "Optional: tipType, tipTexture, hardness, roundness, angle, size, sizeMin, opacity, flow, " +
          "spacing, scatter, scatterAlongPath, dynamics, taperStart, taperEnd, " +
          "grainScale, grainDepth, grainMode, blendMode, renderMode, smoothing. " +
          "For texture tips, set tipType to 'texture' and provide tipTexture as a base64-encoded PNG.",
        required: ["id", "name"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          tipType: { type: "string", enum: ["round", "texture"] },
          tipTexture: { type: "string", description: "Base64-encoded PNG texture for tipType 'texture'." },
          hardness: { type: "number" },
          roundness: { type: "number" },
          angle: { type: "number" },
          size: { type: "number" },
          sizeMin: { type: "number" },
          opacity: { type: "number" },
          flow: { type: "number" },
          spacing: { type: "number" },
          scatter: { type: "number" },
          scatterAlongPath: { type: "number" },
          dynamics: { type: "object" },
          taperStart: { type: "number" },
          taperEnd: { type: "number" },
          grainScale: { type: "number" },
          grainDepth: { type: "number" },
          grainMode: { type: "string", enum: ["moving", "static"] },
          blendMode: { type: "string" },
          renderMode: { type: "string", enum: ["wash", "buildup"] },
          smoothing: { type: "number" },
        },
      },
    },
  } satisfies JsonSchema,

  async handler(
    input: Record<string, unknown>,
    context: McpToolContext,
  ): Promise<McpToolResult> {
    const layerId = input.layerId as string;
    const brushInput = input.brush as Record<string, unknown>;

    if (!layerId) return errorResult("layerId is required.");
    if (!brushInput || !brushInput.id || !brushInput.name) {
      return errorResult("brush must have 'id' and 'name' fields.");
    }

    const layer = context.layers.get(layerId);
    if (!layer) return errorResult(`Layer "${layerId}" not found.`);
    if (layer.type !== "painting:stroke") {
      return errorResult(`Layer "${layerId}" is not a painting:stroke layer.`);
    }

    // Check for conflict with presets
    if (getBrushPreset(brushInput.id as string)) {
      return errorResult(
        `Brush id "${brushInput.id}" conflicts with a built-in preset. Choose a different id.`,
      );
    }

    // Parse existing custom brushes
    let brushes: BrushDefinition[] = [];
    try {
      brushes = JSON.parse((layer.properties.brushes as string) ?? "[]") as BrushDefinition[];
    } catch {
      brushes = [];
    }

    // Build brush with defaults from round-hard preset
    const base = BRUSH_PRESETS["round-hard"]!;
    const newBrush: BrushDefinition = {
      ...base,
      ...brushInput,
      id: brushInput.id as string,
      name: brushInput.name as string,
    } as BrushDefinition;

    // Replace if already exists, otherwise append
    const existingIdx = brushes.findIndex((b) => b.id === newBrush.id);
    if (existingIdx >= 0) {
      brushes[existingIdx] = newBrush;
    } else {
      brushes.push(newBrush);
    }

    context.layers.updateProperties(layerId, {
      brushes: JSON.stringify(brushes),
    });
    context.emitChange("layer-updated");

    return textResult(
      `${existingIdx >= 0 ? "Updated" : "Added"} custom brush "${newBrush.id}" on layer "${layerId}" (${brushes.length} custom brush${brushes.length === 1 ? "" : "es"} total).`,
    );
  },
};

// ---------------------------------------------------------------------------
// erase_strokes — remove strokes by index range from a layer
// ---------------------------------------------------------------------------

export const eraseStrokesTool: McpToolDefinition = {
  name: "erase_strokes",
  description:
    "Remove strokes from a painting:stroke layer by index range. " +
    "Indices are 0-based. If 'end' is omitted, removes only the stroke at 'start'.",
  inputSchema: {
    type: "object",
    required: ["layerId", "start"],
    properties: {
      layerId: {
        type: "string",
        description: "ID of the painting:stroke layer.",
      },
      start: {
        type: "number",
        description: "Start index (inclusive, 0-based).",
      },
      end: {
        type: "number",
        description: "End index (inclusive, 0-based). Omit to remove only 'start'.",
      },
    },
  } satisfies JsonSchema,

  async handler(
    input: Record<string, unknown>,
    context: McpToolContext,
  ): Promise<McpToolResult> {
    const layerId = input.layerId as string;
    const start = input.start as number;
    const end = typeof input.end === "number" ? input.end : start;

    if (!layerId) return errorResult("layerId is required.");
    if (typeof start !== "number" || start < 0) {
      return errorResult("start must be a non-negative number.");
    }
    if (end < start) {
      return errorResult("end must be >= start.");
    }

    const layer = context.layers.get(layerId);
    if (!layer) return errorResult(`Layer "${layerId}" not found.`);
    if (layer.type !== "painting:stroke") {
      return errorResult(`Layer "${layerId}" is not a painting:stroke layer.`);
    }

    let strokes: BrushStroke[] = [];
    try {
      strokes = JSON.parse((layer.properties.strokes as string) ?? "[]") as BrushStroke[];
    } catch {
      return errorResult("Could not parse existing strokes.");
    }

    if (start >= strokes.length) {
      return errorResult(
        `Start index ${start} is out of range (${strokes.length} strokes).`,
      );
    }

    const clampedEnd = Math.min(end, strokes.length - 1);
    const removeCount = clampedEnd - start + 1;
    strokes.splice(start, removeCount);

    context.layers.updateProperties(layerId, {
      strokes: JSON.stringify(strokes),
    });
    context.emitChange("layer-updated");

    return textResult(
      `Removed ${removeCount} stroke${removeCount === 1 ? "" : "s"} (indices ${start}–${clampedEnd}) from layer "${layerId}". ${strokes.length} stroke${strokes.length === 1 ? "" : "s"} remaining.`,
    );
  },
};

// ---------------------------------------------------------------------------
// fill_region — create a painting:fill layer
// ---------------------------------------------------------------------------

export const fillRegionTool: McpToolDefinition = {
  name: "fill_region",
  description:
    "Create a painting:fill layer that procedurally generates marks (hatch, crosshatch, stipple, scumble, or contour) within a bounded region, with optional spatial shading. " +
    "Use preset names as shorthand: hatch-light, hatch-medium, hatch-dense, crosshatch-light, crosshatch-dense, stipple-light, stipple-dense, scumble, contour.",
  inputSchema: {
    type: "object",
    required: ["strategy"],
    properties: {
      layerId: {
        type: "string",
        description: "Update an existing painting:fill layer. If omitted, creates a new one.",
      },
      layerName: {
        type: "string",
        description: "Name for the new layer (default: 'Fill').",
      },
      brushId: {
        type: "string",
        description: 'Brush preset ID (default: "ink-pen").',
      },
      brush: {
        type: "object",
        description: "Inline custom BrushDefinition (overrides brushId). Must include 'id' and 'name'.",
      },
      color: {
        type: "string",
        description: 'Stroke color as hex (default: "#000000").',
      },
      size: {
        type: "number",
        description: "Brush size override in pixels (default: 4).",
      },
      region: {
        type: "object",
        description:
          'Region to fill. Types: {"type":"bounds"} (default, fills layer bounds), ' +
          '{"type":"rect","x":N,"y":N,"width":N,"height":N}, ' +
          '{"type":"ellipse","cx":N,"cy":N,"rx":N,"ry":N}, ' +
          '{"type":"polygon","points":[{"x":N,"y":N},...]}.',
      },
      strategy: {
        description:
          "Fill strategy object or preset name. " +
          "Preset names: hatch-light, hatch-medium, hatch-dense, crosshatch-light, crosshatch-dense, stipple-light, stipple-dense, scumble, contour. " +
          'Objects: {"type":"hatch","angle":45,"spacing":8}, ' +
          '{"type":"crosshatch","angles":[45,135],"spacing":8,"passDecay":0.7}, ' +
          '{"type":"stipple","density":40,"distribution":"poisson"}, ' +
          '{"type":"scumble","density":15,"strokeLength":20,"curvature":0.5}, ' +
          '{"type":"contour","spacing":8,"smoothing":0.3}.',
      },
      shading: {
        type: "object",
        description:
          'Shading function (default: {"type":"uniform"}). ' +
          'Types: {"type":"linear","angle":0,"range":[0.2,1.0]}, ' +
          '{"type":"radial","cx":0.5,"cy":0.5,"range":[0.0,1.0]}, ' +
          '{"type":"noise","seed":0,"scale":1,"range":[0.3,1.0]}. ' +
          "cx/cy are normalised [0,1] in region space.",
      },
      shadingAffects: {
        type: "array",
        items: { type: "string", enum: ["density", "weight", "opacity"] },
        description: 'Which properties shading modulates (default: ["density"]).',
      },
      opacity: {
        type: "number",
        description: "Layer opacity 0–1 (default: 1.0).",
      },
      seed: {
        type: "number",
        description: "PRNG seed for deterministic generation (default: 42).",
      },
      x: { type: "number", description: "Layer x position on canvas." },
      y: { type: "number", description: "Layer y position on canvas." },
      width: { type: "number", description: "Layer width on canvas." },
      height: { type: "number", description: "Layer height on canvas." },
      index: {
        type: "number",
        description: "Layer stack position (default: top).",
      },
    },
  } satisfies JsonSchema,

  async handler(
    input: Record<string, unknown>,
    context: McpToolContext,
  ): Promise<McpToolResult> {
    // Resolve strategy (preset name or object)
    const rawStrategy = input.strategy as FillStrategy | string | undefined;
    if (!rawStrategy) return errorResult("strategy is required.");

    const resolved = resolveStrategy(rawStrategy);
    if (!resolved) {
      const presetNames = Object.keys(FILL_PRESETS).join(", ");
      return errorResult(
        `Unknown fill preset "${rawStrategy as string}". Valid presets: ${presetNames}.`,
      );
    }

    const strategyJson = JSON.stringify(resolved.strategy);

    const layerId = input.layerId as string | undefined;

    if (layerId) {
      // Update existing layer
      const layer = context.layers.get(layerId);
      if (!layer) return errorResult(`Layer "${layerId}" not found.`);
      if (layer.type !== "painting:fill") {
        return errorResult(`Layer "${layerId}" is not a painting:fill layer (is ${layer.type}).`);
      }

      const updates: Record<string, unknown> = { strategy: strategyJson };
      if (input.brushId !== undefined) updates.brushId = input.brushId;
      if (input.brush !== undefined) updates.brush = JSON.stringify(input.brush);
      if (input.color !== undefined) updates.color = input.color;
      if (input.size !== undefined) updates.size = input.size;
      if (input.region !== undefined) updates.region = JSON.stringify(input.region);
      if (input.shading !== undefined) updates.shading = JSON.stringify(input.shading);
      if (input.shadingAffects !== undefined) updates.shadingAffects = JSON.stringify(input.shadingAffects);
      if (input.opacity !== undefined) updates.opacity = input.opacity;
      if (input.seed !== undefined) updates.seed = input.seed;

      context.layers.updateProperties(layerId, updates as Record<string, string | number | boolean | null>);
      context.emitChange("layer-updated");

      return textResult(`Updated painting:fill layer "${layerId}".`);
    }

    // Create new layer
    const defaults = fillLayerType.createDefault();

    // Apply resolved preset defaults first
    if (resolved.brushId) defaults.brushId = resolved.brushId;
    if (resolved.size !== undefined) defaults.size = resolved.size;

    defaults.strategy = strategyJson;

    // Apply explicit overrides
    if (input.brushId !== undefined) defaults.brushId = input.brushId as string;
    if (input.brush !== undefined) defaults.brush = JSON.stringify(input.brush);
    if (input.color !== undefined) defaults.color = input.color as string;
    if (input.size !== undefined) defaults.size = input.size as number;
    if (input.region !== undefined) defaults.region = JSON.stringify(input.region);
    if (input.shading !== undefined) defaults.shading = JSON.stringify(input.shading);
    if (input.shadingAffects !== undefined) defaults.shadingAffects = JSON.stringify(input.shadingAffects);
    if (input.seed !== undefined) defaults.seed = input.seed as number;

    const opacity = typeof input.opacity === "number" ? input.opacity : 1;

    const transform: LayerTransform =
      typeof input.x === "number" || typeof input.width === "number"
        ? {
            x: (input.x as number | undefined) ?? 0,
            y: (input.y as number | undefined) ?? 0,
            width: (input.width as number | undefined) ?? context.canvasWidth,
            height: (input.height as number | undefined) ?? context.canvasHeight,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            anchorX: 0,
            anchorY: 0,
          }
        : fullCanvasTransform(context);

    const newLayer: DesignLayer = {
      id: generateLayerId(),
      type: "painting:fill",
      name: (input.layerName as string | undefined) ?? "Fill",
      visible: true,
      locked: false,
      opacity,
      blendMode: "normal",
      transform,
      properties: defaults as Record<string, string | number | boolean | null>,
    };

    const idx = typeof input.index === "number" ? input.index : undefined;
    context.layers.add(newLayer, idx);
    context.emitChange("layer-added");

    const strategyType = resolved.strategy.type;
    return textResult(
      `Created painting:fill layer "${newLayer.id}" (strategy: ${strategyType}).`,
    );
  },
};

// ---------------------------------------------------------------------------
// update_fill — modify individual properties on an existing fill layer
// ---------------------------------------------------------------------------

export const updateFillTool: McpToolDefinition = {
  name: "update_fill",
  description:
    "Modify individual properties on an existing painting:fill layer without replacing everything. " +
    "Partial strategy updates are merged with the existing strategy.",
  inputSchema: {
    type: "object",
    required: ["layerId"],
    properties: {
      layerId: {
        type: "string",
        description: "ID of the painting:fill layer to update.",
      },
      strategy: {
        type: "object",
        description: "Partial strategy object — merged with the existing strategy.",
      },
      shading: {
        type: "object",
        description: "New shading function (replaces existing).",
      },
      shadingAffects: {
        type: "array",
        items: { type: "string", enum: ["density", "weight", "opacity"] },
        description: "New shadingAffects array (replaces existing).",
      },
      color: {
        type: "string",
        description: "New stroke color.",
      },
      size: {
        type: "number",
        description: "New brush size in pixels.",
      },
      brushId: {
        type: "string",
        description: "New brush preset ID.",
      },
      seed: {
        type: "number",
        description: "New PRNG seed.",
      },
    },
  } satisfies JsonSchema,

  async handler(
    input: Record<string, unknown>,
    context: McpToolContext,
  ): Promise<McpToolResult> {
    const layerId = input.layerId as string;
    if (!layerId) return errorResult("layerId is required.");

    const layer = context.layers.get(layerId);
    if (!layer) return errorResult(`Layer "${layerId}" not found.`);
    if (layer.type !== "painting:fill") {
      return errorResult(`Layer "${layerId}" is not a painting:fill layer (is ${layer.type}).`);
    }

    const updates: Record<string, unknown> = {};

    // Partial strategy merge
    if (input.strategy !== undefined && typeof input.strategy === "object") {
      let existing: Record<string, unknown> = {};
      try {
        existing = JSON.parse((layer.properties.strategy as string) ?? "{}") as Record<string, unknown>;
      } catch { /* keep empty */ }
      const merged = { ...existing, ...(input.strategy as Record<string, unknown>) };
      updates.strategy = JSON.stringify(merged);
    }

    if (input.shading !== undefined) updates.shading = JSON.stringify(input.shading);
    if (input.shadingAffects !== undefined) updates.shadingAffects = JSON.stringify(input.shadingAffects);
    if (input.color !== undefined) updates.color = input.color;
    if (input.size !== undefined) updates.size = input.size;
    if (input.brushId !== undefined) updates.brushId = input.brushId;
    if (input.seed !== undefined) updates.seed = input.seed;

    if (Object.keys(updates).length === 0) {
      return textResult("No changes specified.");
    }

    context.layers.updateProperties(layerId, updates as Record<string, string | number | boolean | null>);
    context.emitChange("layer-updated");

    const changed = Object.keys(updates).join(", ");
    return textResult(`Updated painting:fill layer "${layerId}": ${changed}.`);
  },
};

// ---------------------------------------------------------------------------
// list_fill_presets — list available fill presets
// ---------------------------------------------------------------------------

export const listFillPresetsTool: McpToolDefinition = {
  name: "list_fill_presets",
  description: "List all built-in fill presets with their strategy parameters.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {},
  } satisfies JsonSchema,

  async handler(
    _input: Record<string, unknown>,
    _context: McpToolContext,
  ): Promise<McpToolResult> {
    const result = Object.entries(FILL_PRESETS).map(([name, preset]) => ({
      name,
      strategy: preset.strategy,
      brushId: preset.brushId,
      size: preset.size,
    }));
    return textResult(JSON.stringify(result, null, 2));
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const paintingMcpTools: McpToolDefinition[] = [
  paintLayerTool,
  getPaintFieldTool,
  updatePaintFieldTool,
  generateFieldFromPointsTool,
  brushStrokeTool,
  listBrushesTool,
  createBrushTool,
  eraseStrokesTool,
  fillRegionTool,
  updateFillTool,
  listFillPresetsTool,
];
