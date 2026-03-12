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

const FLOW_LINES_PROPERTIES: LayerPropertySchema[] = [
  { key: "field",      label: "Vector Field",      type: "string",  default: "noise:0:0.08:4", group: "field" },
  { key: "fieldCols",  label: "Field Columns",     type: "number",  default: 40, min: 4, max: 80, step: 1, group: "field" },
  { key: "fieldRows",  label: "Field Rows",        type: "number",  default: 40, min: 4, max: 80, step: 1, group: "field" },
  { key: "minMagnitude", label: "Min Magnitude",   type: "number",  default: 0.1, min: 0, max: 0.5, step: 0.05, group: "field" },
  { key: "seed",       label: "Seed",              type: "number",  default: 42, min: 0, max: 99999, step: 1, group: "generation" },
  { key: "lineCount",  label: "Line Count",        type: "number",  default: 2000, min: 100, max: 10000, step: 100, group: "generation" },
  {
    key: "seedDistribution", label: "Seed Distribution", type: "select", default: "grid-jittered",
    options: [
      { value: "uniform",       label: "Uniform Random" },
      { value: "grid-jittered", label: "Grid + Jitter" },
      { value: "poisson",       label: "Poisson (blue noise)" },
    ],
    group: "generation",
  },
  { key: "lineLength", label: "Line Length",        type: "number",  default: 120, min: 20, max: 500, step: 10, group: "line" },
  { key: "stepSize",   label: "Step Size",          type: "number",  default: 3, min: 1, max: 10, step: 0.5, group: "line" },
  { key: "lineWeight", label: "Line Weight",        type: "number",  default: 0.8, min: 0.2, max: 5, step: 0.1, group: "line" },
  { key: "lineWeightVariation", label: "Weight Variation", type: "number", default: 0.15, min: 0, max: 1, step: 0.05, group: "line" },
  {
    key: "taper", label: "Taper", type: "select", default: "tail",
    options: [
      { value: "none", label: "None" },
      { value: "head", label: "Head" },
      { value: "tail", label: "Tail" },
      { value: "both", label: "Both" },
    ],
    group: "line",
  },
  { key: "color",      label: "Color",             type: "color",   default: "#1a1a1a", group: "style" },
  { key: "colorVariation", label: "Color Variation", type: "number", default: 0.05, min: 0, max: 1, step: 0.01, group: "style" },
  { key: "opacity",    label: "Opacity",           type: "number",  default: 0.6, min: 0, max: 1, step: 0.01, group: "style" },
  {
    key: "paintMode", label: "Paint Mode", type: "select", default: "multiply",
    options: [
      { value: "multiply", label: "Multiply (darken)" },
      { value: "normal",   label: "Normal (opaque)" },
      { value: "screen",   label: "Screen (lighten)" },
    ],
    group: "style",
  },
  { key: "depthScale",        label: "Depth Scale",         type: "boolean", default: true, group: "depth" },
  { key: "horizonY",          label: "Horizon Y",           type: "number",  default: 0.3, min: 0, max: 1, step: 0.01, group: "depth" },
  { key: "depthWeightRange",  label: "Depth Weight Range",  type: "string",  default: "[0.3, 1.8]", group: "depth" },
  { key: "depthOpacityRange", label: "Depth Opacity Range", type: "string",  default: "[0.3, 1.0]", group: "depth" },
  { key: "maskCenterY", label: "Mask Center Y", type: "number", default: -1,   min: -1, max: 1,    step: 0.01, group: "mask" },
  { key: "maskSpread",  label: "Mask Spread",   type: "number", default: 0.25, min: 0.01, max: 1, step: 0.01, group: "mask" },
];

// ---------------------------------------------------------------------------
// HSL jitter helper
// ---------------------------------------------------------------------------

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgba(h: number, s: number, l: number, a: number): string {
  h = ((h % 1) + 1) % 1;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
}

// ---------------------------------------------------------------------------
// Seed point generation
// ---------------------------------------------------------------------------

function generateSeedPoints(
  distribution: string,
  count: number,
  w: number,
  h: number,
  rand: () => number,
): [number, number][] {
  const points: [number, number][] = [];

  if (distribution === "grid-jittered") {
    // Regular grid with jitter — approximate count via grid sizing
    const aspect = w / h;
    const gridRows = Math.max(1, Math.round(Math.sqrt(count / aspect)));
    const gridCols = Math.max(1, Math.round(count / gridRows));
    const cellW = w / gridCols;
    const cellH = h / gridRows;

    for (let gy = 0; gy < gridRows; gy++) {
      for (let gx = 0; gx < gridCols; gx++) {
        const px = (gx + 0.5) * cellW + (rand() - 0.5) * cellW;
        const py = (gy + 0.5) * cellH + (rand() - 0.5) * cellH;
        points.push([px, py]);
      }
    }
  } else if (distribution === "poisson") {
    // Simplified Poisson / blue noise via grid-based exclusion
    const radius = Math.sqrt((w * h) / (count * Math.PI));
    const cellSize = radius / Math.SQRT2;
    const gridW = Math.ceil(w / cellSize);
    const gridH = Math.ceil(h / cellSize);
    const occupied = new Set<number>();

    let attempts = 0;
    const maxAttempts = count * 30;

    while (points.length < count && attempts < maxAttempts) {
      attempts++;
      const px = rand() * w;
      const py = rand() * h;
      const gi = Math.floor(px / cellSize);
      const gj = Math.floor(py / cellSize);
      const key = gj * gridW + gi;

      // Check 3x3 neighborhood
      let tooClose = false;
      for (let dy = -1; dy <= 1 && !tooClose; dy++) {
        for (let dx = -1; dx <= 1 && !tooClose; dx++) {
          const ni = gi + dx;
          const nj = gj + dy;
          if (ni >= 0 && ni < gridW && nj >= 0 && nj < gridH) {
            if (occupied.has(nj * gridW + ni)) tooClose = true;
          }
        }
      }

      if (!tooClose) {
        occupied.add(key);
        points.push([px, py]);
      }
    }
  } else {
    // Uniform random
    for (let i = 0; i < count; i++) {
      points.push([rand() * w, rand() * h]);
    }
  }

  return points;
}

// ---------------------------------------------------------------------------
// Layer type definition
// ---------------------------------------------------------------------------

export const flowLinesLayerType: LayerTypeDefinition = {
  typeId: "painting:flow-lines",
  displayName: "Flow Lines",
  icon: "flow-lines",
  category: "draw",
  properties: FLOW_LINES_PROPERTIES,
  propertyEditorId: "painting:flow-lines-editor",

  createDefault(): LayerProperties {
    const props: LayerProperties = {};
    for (const schema of FLOW_LINES_PROPERTIES) props[schema.key] = schema.default;
    return props;
  },

  render(
    properties: LayerProperties,
    ctx: CanvasRenderingContext2D,
    bounds: LayerBounds,
    _resources: RenderResources,
  ): void {
    const fieldStr          = (properties.field as string)   ?? "noise:0:0.08:4";
    const cols              = (properties.fieldCols as number) ?? 40;
    const rows              = (properties.fieldRows as number) ?? 40;
    const minMagnitude      = (properties.minMagnitude as number) ?? 0.1;
    const seed              = (properties.seed as number)    ?? 42;
    const lineCount         = (properties.lineCount as number) ?? 2000;
    const seedDistribution  = (properties.seedDistribution as string) ?? "grid-jittered";
    const lineLength        = (properties.lineLength as number) ?? 120;
    const stepSize          = (properties.stepSize as number) ?? 3;
    const lineWeight        = (properties.lineWeight as number) ?? 0.8;
    const lineWeightVar     = (properties.lineWeightVariation as number) ?? 0.15;
    const taper             = (properties.taper as string)   ?? "tail";
    const color             = (properties.color as string)   ?? "#1a1a1a";
    const colorVariation    = (properties.colorVariation as number) ?? 0.05;
    const opacity           = (properties.opacity as number) ?? 0.6;
    const paintMode         = (properties.paintMode as string) ?? "multiply";
    const depthScale        = (properties.depthScale as boolean) ?? true;
    const horizonY          = (properties.horizonY as number) ?? 0.3;
    const depthWeightStr    = (properties.depthWeightRange as string) ?? "[0.3, 1.8]";
    const depthOpacityStr   = (properties.depthOpacityRange as string) ?? "[0.3, 1.0]";
    const maskCenterY       = (properties.maskCenterY as number) ?? -1;
    const maskSpread        = (properties.maskSpread as number) ?? 0.25;

    const w = Math.ceil(bounds.width);
    const h = Math.ceil(bounds.height);
    if (w <= 0 || h <= 0) return;

    const field = parseField(fieldStr, cols, rows);
    const rand  = mulberry32(seed);

    // Parse depth ranges
    let depthWeightRange: [number, number] = [0.3, 1.8];
    let depthOpacityRange: [number, number] = [0.3, 1.0];
    try { depthWeightRange = JSON.parse(depthWeightStr) as [number, number]; } catch {}
    try { depthOpacityRange = JSON.parse(depthOpacityStr) as [number, number]; } catch {}

    // Parse base color to HSL for jitter
    const [baseH, baseS, baseL] = hexToHsl(color);

    // Generate seed points
    const seedPoints = generateSeedPoints(seedDistribution, lineCount, w, h, rand);

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

    for (const [spx, spy] of seedPoints) {
      // Trace streamline via Euler integration
      const points: [number, number][] = [];
      let cx = spx;
      let cy = spy;

      for (let s = 0; s < lineLength; s++) {
        const nx = cx / w;
        const ny = cy / h;
        if (nx < 0 || nx > 1 || ny < 0 || ny > 1) break;

        const sample = sampleField(field, nx, ny);
        if (sample.magnitude < minMagnitude) break;

        points.push([bounds.x + cx, bounds.y + cy]);

        cx += sample.dx * stepSize;
        cy += sample.dy * stepSize;
      }

      if (points.length < 3) continue;

      // Per-line weight variation
      const weightJitter = 1 + lineWeightVar * (rand() - 0.5) * 2;
      const baseWeight = lineWeight * weightJitter;

      // Per-line color jitter
      const jH = baseH + colorVariation * (rand() - 0.5) * 0.2;
      const jS = baseS + colorVariation * (rand() - 0.5) * 0.3;
      const jL = baseL + colorVariation * (rand() - 0.5) * 0.2;

      // Draw each streamline segment-by-segment for taper support
      for (let p = 1; p < points.length; p++) {
        const t = p / (points.length - 1);

        // Compute taper factor
        let taperFactor = 1;
        if (taper === "head" || taper === "both") {
          taperFactor *= Math.min(1, t * 4);
        }
        if (taper === "tail" || taper === "both") {
          taperFactor *= Math.min(1, (1 - t) * 4);
        }

        // Midpoint of this segment for depth calculation
        const midX = (points[p - 1]![0] + points[p]![0]) / 2;
        const midY = (points[p - 1]![1] + points[p]![1]) / 2;
        const ny = (midY - bounds.y) / h;

        let segWeight = baseWeight * taperFactor;
        let segOpacity = opacity;

        // Depth scaling
        if (depthScale) {
          const depthT = Math.max(0, Math.min(1, (ny - horizonY) / (1 - horizonY)));
          const weightMult = depthWeightRange[0] + (depthWeightRange[1] - depthWeightRange[0]) * depthT;
          const opacityMult = depthOpacityRange[0] + (depthOpacityRange[1] - depthOpacityRange[0]) * depthT;
          segWeight *= weightMult;
          segOpacity *= opacityMult;
        }

        // Vertical mask
        if (maskCenterY >= 0) {
          const maskAlpha = Math.exp(-((ny - maskCenterY) ** 2) / (2 * maskSpread * maskSpread));
          if (maskAlpha < 0.05) continue;
          segOpacity *= maskAlpha;
        }

        ctx.beginPath();
        ctx.moveTo(points[p - 1]![0], points[p - 1]![1]);
        ctx.lineTo(points[p]![0], points[p]![1]);
        ctx.strokeStyle = hslToRgba(jH, jS, jL, segOpacity);
        ctx.lineWidth = Math.max(0.2, segWeight);
        ctx.stroke();
      }
    }

    ctx.restore();
  },

  validate(_properties: LayerProperties): ValidationError[] | null {
    return null;
  },
};
