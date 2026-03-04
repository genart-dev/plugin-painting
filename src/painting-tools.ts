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
import { parseField } from "./vector-field.js";
import type { VectorField, VectorSample } from "./vector-field.js";

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
          'Vector field shorthand or JSON. Shorthands: "noise:seed:scale:octaves", "linear:angleDeg:magnitude", "radial:cx:cy:diverge|converge", "vortex:cx:cy:radius". Defaults to "noise:0:0.1:3".',
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

    try {
      parseField(fieldStr, cols, rows);
    } catch {
      return errorResult(`Invalid field specification: "${fieldStr}"`);
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
    if (fieldStr.startsWith("{")) {
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
    "Replace the vector field on an existing painting layer. Accepts shorthand strings or VectorField JSON.",
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

    try {
      parseField(fieldStr, cols, rows);
    } catch {
      return errorResult(`Invalid field specification: "${fieldStr}"`);
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
// Exports
// ---------------------------------------------------------------------------

export const paintingMcpTools: McpToolDefinition[] = [
  paintLayerTool,
  getPaintFieldTool,
  updatePaintFieldTool,
  generateFieldFromPointsTool,
];
