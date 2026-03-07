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
import { mulberry32 } from "./shared/prng.js";

const INK_PROPERTIES: LayerPropertySchema[] = [
  { key: "field",      label: "Vector Field",  type: "string",  default: "noise:0:0.1:3", group: "field" },
  { key: "fieldCols",  label: "Field Columns", type: "number",  default: 20, min: 4, max: 40, step: 1, group: "field" },
  { key: "fieldRows",  label: "Field Rows",    type: "number",  default: 20, min: 4, max: 40, step: 1, group: "field" },
  { key: "colors",     label: "Colors",        type: "string",  default: '["#1a1a1a"]', group: "paint" },
  { key: "weight",     label: "Stroke Weight", type: "number",  default: 2, min: 0.5, max: 50, step: 0.5, group: "paint" },
  {
    key: "paintMode", label: "Paint Mode", type: "select", default: "multiply",
    options: [
      { value: "multiply", label: "Multiply (darken)" },
      { value: "normal",   label: "Normal (opaque)" },
      { value: "screen",   label: "Screen (lighten)" },
    ],
    group: "paint",
  },
  {
    key: "taper", label: "Taper", type: "select", default: "none",
    options: [
      { value: "none",  label: "None" },
      { value: "head",  label: "Head" },
      { value: "tail",  label: "Tail" },
      { value: "both",  label: "Both" },
    ],
    group: "paint",
  },
  {
    key: "style", label: "Style", type: "select", default: "fluid",
    options: [
      { value: "fluid",    label: "Fluid" },
      { value: "scratchy", label: "Scratchy" },
      { value: "brush",    label: "Brush" },
    ],
    group: "paint",
  },
  { key: "opacity",      label: "Opacity",       type: "number", default: 1,    min: 0,   max: 1,   step: 0.01, group: "paint" },
  { key: "seed",        label: "Seed",          type: "number", default: 0,    min: 0,   max: 99999, step: 1, group: "paint" },
  { key: "maskCenterY", label: "Mask Center Y", type: "number", default: -1,   min: -1,  max: 1,   step: 0.01, group: "mask" },
  { key: "maskSpread",  label: "Mask Spread",   type: "number", default: 0.25, min: 0.01,max: 1,   step: 0.01, group: "mask" },
  { key: "debug",        label: "Debug Field",    type: "boolean", default: false, group: "debug" },
  { key: "debugOpacity", label: "Overlay Opacity",type: "number",  default: 0.7,  min: 0.1, max: 1, step: 0.05, group: "debug" },
  { key: "debugMode",    label: "Overlay Mode",   type: "select",  default: "all",
    options: [{ value: "arrows", label: "Arrows" }, { value: "heatmap", label: "Heatmap" }, { value: "contours", label: "Contours" }, { value: "all", label: "All" }],
    group: "debug" },
];

export const inkLayerType: LayerTypeDefinition = {
  typeId: "painting:ink",
  displayName: "Ink",
  icon: "ink",
  category: "draw",
  properties: INK_PROPERTIES,
  propertyEditorId: "painting:ink-editor",

  createDefault(): LayerProperties {
    const props: LayerProperties = {};
    for (const schema of INK_PROPERTIES) props[schema.key] = schema.default;
    return props;
  },

  render(
    properties: LayerProperties,
    ctx: CanvasRenderingContext2D,
    bounds: LayerBounds,
    _resources: RenderResources,
  ): void {
    const fieldStr    = (properties.field as string)   ?? "noise:0:0.1:3";
    const cols        = (properties.fieldCols as number) ?? 20;
    const rows        = (properties.fieldRows as number) ?? 20;
    const colorsStr   = (properties.colors as string)  ?? '["#1a1a1a"]';
    const weight      = (properties.weight as number)  ?? 2;
    const paintMode   = (properties.paintMode as string) ?? "multiply";
    const taper       = (properties.taper as string)   ?? "none";
    const style       = (properties.style as string)   ?? "fluid";
    const layerOpacity= (properties.opacity as number) ?? 1;
    const seed        = (properties.seed as number)    ?? 0;
    const debug       = (properties.debug as boolean)  ?? false;
    const debugOpacity= (properties.debugOpacity as number) ?? 0.7;
    const debugMode   = ((properties.debugMode as string) ?? "all") as DebugMode;
    const maskCenterY = (properties.maskCenterY as number) ?? -1;
    const maskSpread  = (properties.maskSpread as number) ?? 0.25;

    const w = Math.ceil(bounds.width);
    const h = Math.ceil(bounds.height);
    if (w <= 0 || h <= 0) return;

    const field = parseField(fieldStr, cols, rows);
    const rand  = mulberry32(seed);

    let colorList: string[];
    try {
      colorList = JSON.parse(colorsStr) as string[];
    } catch { colorList = []; }
    if (colorList.length === 0) colorList = ["#1a1a1a"];

    // Integrate streamlines: seed points on a grid, follow field vectors
    const streamSpacing = Math.max(4, Math.round(Math.min(w, h) / 40));
    const stepLen       = streamSpacing * 0.6;
    const maxSteps      = Math.round(Math.min(w, h) / stepLen * 0.4);

    // For normal/screen paint modes, use canvas composite operations directly
    ctx.save();
    ctx.lineCap  = "round";
    ctx.lineJoin = "round";

    if (paintMode === "screen") {
      ctx.globalCompositeOperation = "screen";
    } else if (paintMode === "normal") {
      ctx.globalCompositeOperation = "source-over";
    } else {
      ctx.globalCompositeOperation = "multiply";
    }

    const scratchyGap = style === "scratchy" ? 0.35 : 0;
    let streamIndex = 0;

    for (let gy = streamSpacing / 2; gy < h; gy += streamSpacing) {
      // Vertical mask: skip seed rows outside the Gaussian zone
      const ny_seed = h > 1 ? gy / (h - 1) : 0;
      const vMask = maskCenterY >= 0
        ? Math.exp(-((ny_seed - maskCenterY) ** 2) / (2 * maskSpread * maskSpread))
        : 1;
      if (vMask < 0.05) continue;

      for (let gx = streamSpacing / 2; gx < w; gx += streamSpacing) {
        // Skip some seeds for scratchy style
        if (style === "scratchy" && rand() < 0.4) continue;

        const points: [number, number][] = [];
        let cx = bounds.x + gx;
        let cy = bounds.y + gy;

        for (let s = 0; s < maxSteps; s++) {
          const nx = (cx - bounds.x) / w;
          const ny = (cy - bounds.y) / h;
          if (nx < 0 || nx > 1 || ny < 0 || ny > 1) break;

          const sample = sampleField(field, nx, ny);
          points.push([cx, cy]);

          // Stop at low-magnitude zones (brush lift at divergence)
          if (sample.magnitude < 0.15) break;

          cx += sample.dx * stepLen;
          cy += sample.dy * stepLen;
        }

        if (points.length < 2) continue;

        // Pick a base color for this streamline — cycle through palette
        const baseColorIdx = streamIndex % colorList.length;
        streamIndex++;

        // Draw stroke with optional taper, interpolating color along streamline
        ctx.beginPath();
        ctx.moveTo(points[0]![0], points[0]![1]);

        for (let p = 1; p < points.length; p++) {
          // Skip segments for scratchy style
          if (scratchyGap > 0 && rand() < scratchyGap) {
            ctx.moveTo(points[p]![0], points[p]![1]);
            continue;
          }

          let w_local = weight;
          const t = p / (points.length - 1);

          if (taper === "head" || taper === "both") {
            w_local *= Math.min(1, t * 4);
          }
          if (taper === "tail" || taper === "both") {
            w_local *= Math.min(1, (1 - t) * 4);
          }
          // Brush style: slight width variation
          if (style === "brush") {
            w_local *= 0.7 + rand() * 0.6;
          }

          // Interpolate color along streamline when multiple colors
          let strokeColor: string;
          if (colorList.length === 1) {
            strokeColor = colorList[0]!;
          } else {
            // Blend from base color toward next color along the stroke
            const ct = t * (colorList.length - 1);
            const ci = Math.floor(ct + baseColorIdx) % colorList.length;
            strokeColor = colorList[ci]!;
          }

          ctx.strokeStyle = strokeColor;
          ctx.globalAlpha = layerOpacity * vMask;
          ctx.lineWidth = Math.max(0.3, w_local);
          ctx.lineTo(points[p]![0], points[p]![1]);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(points[p]![0], points[p]![1]);
        }
      }
    }

    ctx.restore();

    if (debug) {
      renderDebugOverlay(field, ctx, bounds, { mode: debugMode, opacity: debugOpacity });
    }
  },

  validate(_properties: LayerProperties): ValidationError[] | null {
    return null;
  },
};
