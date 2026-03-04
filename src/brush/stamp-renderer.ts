import type { LayerBounds } from "@genart-dev/core";
import type { BrushDefinition, BrushStroke, StrokePoint } from "./types.js";
import { interpolatePath, arcLengthParameterize, taperScale } from "./path-utils.js";
import { generateRoundTip, generateTextureTip } from "./tip-generator.js";
import { evaluateDynamic } from "./dynamics.js";
import { mulberry32 } from "../shared/prng.js";
import { BRUSH_PRESETS } from "./presets.js";

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Render brush strokes onto a Canvas2D context.
 *
 * For each stroke:
 * 1. Resolve brush definition (custom or preset)
 * 2. Interpolate path via Catmull-Rom spline
 * 3. Walk arc-length at spacing intervals
 * 4. Stamp tips with dynamics, taper, and scatter
 * 5. Composite (buildup = direct draw, wash = alpha-clamped)
 */
export function renderStrokes(
  strokes: readonly BrushStroke[],
  brushes: Readonly<Record<string, BrushDefinition>>,
  ctx: CanvasRenderingContext2D,
  bounds: LayerBounds,
  seed: number,
): void {
  for (const stroke of strokes) {
    renderSingleStroke(stroke, brushes, ctx, bounds, seed);
  }
}

// ---------------------------------------------------------------------------
// Single stroke rendering
// ---------------------------------------------------------------------------

function renderSingleStroke(
  stroke: BrushStroke,
  brushes: Readonly<Record<string, BrushDefinition>>,
  ctx: CanvasRenderingContext2D,
  bounds: LayerBounds,
  globalSeed: number,
): void {
  if (stroke.points.length < 2) return;

  // Resolve brush: custom → preset → fallback to round-hard
  const brush = brushes[stroke.brushId]
    ?? BRUSH_PRESETS[stroke.brushId]
    ?? BRUSH_PRESETS["round-hard"]!;

  // Apply stroke-level overrides
  const baseSize = stroke.size ?? brush.size;
  const strokeOpacity = stroke.opacity ?? brush.opacity;
  const strokeSeed = stroke.seed ?? globalSeed;

  // Interpolate path
  const interpolated = interpolatePath(stroke.points, brush.smoothing);
  if (interpolated.length < 2) return;

  // Arc-length parameterization
  const arc = arcLengthParameterize(interpolated);
  if (arc.totalLength <= 0) return;

  // Collect stamp commands
  const stamps = computeStamps(
    arc,
    brush,
    baseSize,
    strokeOpacity,
    stroke.color,
    strokeSeed,
    interpolated,
  );

  if (stamps.length === 0) return;

  // Render stamps
  if (brush.renderMode === "wash") {
    renderWash(stamps, brush, ctx, bounds, strokeOpacity);
  } else {
    renderBuildup(stamps, brush, ctx, bounds);
  }
}

// ---------------------------------------------------------------------------
// Stamp computation
// ---------------------------------------------------------------------------

interface StampCommand {
  x: number;
  y: number;
  size: number;
  opacity: number;
  flow: number;
  color: string;
  angle: number;
}

function computeStamps(
  arc: ReturnType<typeof arcLengthParameterize>,
  brush: BrushDefinition,
  baseSize: number,
  strokeOpacity: number,
  color: string,
  seed: number,
  interpolated: readonly StrokePoint[],
): StampCommand[] {
  const rng = mulberry32(seed);
  const stamps: StampCommand[] = [];

  // Walk the path at spacing intervals
  let distance = 0;

  while (distance <= arc.totalLength) {
    const sample = arc.sampleAt(distance);
    const pressure = sample.pressure ?? 1;

    // Evaluate dynamics
    const dynSize = evaluateDynamic(pressure, brush.dynamics.size, baseSize);
    const effSize = Math.max(
      1,
      dynSize * taperScale(distance, arc.totalLength, brush.taperStart, brush.taperEnd),
    );
    const dynOpacity = evaluateDynamic(pressure, brush.dynamics.opacity, strokeOpacity);
    const dynFlow = evaluateDynamic(pressure, brush.dynamics.flow, brush.flow);
    const dynScatter = evaluateDynamic(pressure, brush.dynamics.scatter, brush.scatter);

    // Compute scatter offset
    let stampX = sample.x;
    let stampY = sample.y;

    if (dynScatter > 0 || brush.scatterAlongPath > 0) {
      // Approximate tangent from nearby samples
      const tangent = computeTangent(arc, distance);

      // Perpendicular scatter
      if (dynScatter > 0) {
        const perpOffset = (rng() - 0.5) * 2 * dynScatter * effSize;
        stampX += -tangent.dy * perpOffset;
        stampY += tangent.dx * perpOffset;
      }

      // Along-path scatter
      if (brush.scatterAlongPath > 0) {
        const alongOffset = (rng() - 0.5) * 2 * brush.scatterAlongPath * effSize;
        stampX += tangent.dx * alongOffset;
        stampY += tangent.dy * alongOffset;
      }
    }

    stamps.push({
      x: stampX,
      y: stampY,
      size: effSize,
      opacity: dynOpacity,
      flow: dynFlow,
      color,
      angle: brush.angle,
    });

    // Advance by spacing * current effective size
    const step = Math.max(1, brush.spacing * effSize);
    distance += step;
  }

  return stamps;
}

function computeTangent(
  arc: ReturnType<typeof arcLengthParameterize>,
  distance: number,
): { dx: number; dy: number } {
  const epsilon = 0.5;
  const a = arc.sampleAt(Math.max(0, distance - epsilon));
  const b = arc.sampleAt(distance + epsilon);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-8) return { dx: 1, dy: 0 };
  return { dx: dx / len, dy: dy / len };
}

// ---------------------------------------------------------------------------
// Tip dispatcher
// ---------------------------------------------------------------------------

/**
 * Get the appropriate tip ImageData for a brush at a given size/angle.
 * Dispatches between round and texture tip generators.
 */
function getTip(brush: BrushDefinition, size: number, angle: number): ImageData {
  if (brush.tipType === "texture" && brush.tipTexture) {
    return generateTextureTip(brush.tipTexture, size, brush.roundness, angle);
  }
  return generateRoundTip(size, brush.hardness ?? 1, brush.roundness, angle);
}

// ---------------------------------------------------------------------------
// Buildup mode: stamp directly to context
// ---------------------------------------------------------------------------

function renderBuildup(
  stamps: readonly StampCommand[],
  brush: BrushDefinition,
  ctx: CanvasRenderingContext2D,
  bounds: LayerBounds,
): void {
  ctx.save();
  ctx.globalCompositeOperation = brush.blendMode;

  for (const stamp of stamps) {
    const tipSize = Math.max(1, Math.round(stamp.size));
    const tip = getTip(brush, tipSize, stamp.angle);

    ctx.globalAlpha = stamp.flow * stamp.opacity;

    // Draw tip centered at stamp position
    const sx = Math.round(stamp.x - tipSize / 2 + bounds.x);
    const sy = Math.round(stamp.y - tipSize / 2 + bounds.y);

    drawTintedTip(ctx, tip, sx, sy, stamp.color);
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Wash mode: render to offscreen, clamp alpha, composite
// ---------------------------------------------------------------------------

function renderWash(
  stamps: readonly StampCommand[],
  brush: BrushDefinition,
  ctx: CanvasRenderingContext2D,
  bounds: LayerBounds,
  maxOpacity: number,
): void {
  const w = Math.ceil(bounds.width);
  const h = Math.ceil(bounds.height);
  if (w <= 0 || h <= 0) return;

  // Create offscreen canvas compatible with the main context's canvas module
  const offscreen = createOffscreenCanvas(w, h, ctx);
  if (!offscreen) return;

  const offCtx = offscreen.getContext("2d");
  if (!offCtx) return;

  offCtx.globalCompositeOperation = "source-over";

  // Stamp onto offscreen canvas (without bounds offset — local coordinates)
  for (const stamp of stamps) {
    const tipSize = Math.max(1, Math.round(stamp.size));
    const tip = getTip(brush, tipSize, stamp.angle);

    offCtx.globalAlpha = stamp.flow;

    const sx = Math.round(stamp.x - tipSize / 2);
    const sy = Math.round(stamp.y - tipSize / 2);

    drawTintedTip(offCtx, tip, sx, sy, stamp.color);
  }

  // Clamp alpha to maxOpacity
  const imageData = offCtx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const maxAlpha = Math.round(maxOpacity * 255);

  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! > maxAlpha) {
      data[i] = maxAlpha;
    }
  }

  offCtx.putImageData(imageData, 0, 0);

  // Composite to main context
  ctx.save();
  ctx.globalCompositeOperation = brush.blendMode;
  ctx.globalAlpha = 1;
  ctx.drawImage(offscreen as unknown as CanvasImageSource, bounds.x, bounds.y);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Draw a tip ImageData tinted with a color.
 * The tip's alpha channel is used as a mask; RGB are replaced with the tint color.
 *
 * Uses a temporary canvas + drawImage for proper compositing.
 * (putImageData replaces pixels directly and ignores globalAlpha/blendMode,
 * which would erase the background underneath transparent tip pixels.)
 */
function drawTintedTip(
  ctx: CanvasRenderingContext2D,
  tip: ImageData,
  x: number,
  y: number,
  color: string,
): void {
  const [r, g, b] = hexToRgb(color);

  // Create a small temporary canvas for the tinted tip
  const tmpCanvas = createOffscreenCanvas(tip.width, tip.height, ctx);
  if (!tmpCanvas) return;

  const tmpCtx = tmpCanvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (!tmpCtx) return;

  // Build tinted ImageData: tip's alpha as mask, color as RGB
  const tinted = tmpCtx.createImageData(tip.width, tip.height);
  const src = tip.data;
  const dst = tinted.data;

  for (let i = 0; i < src.length; i += 4) {
    dst[i] = r;
    dst[i + 1] = g;
    dst[i + 2] = b;
    dst[i + 3] = src[i + 3]!;
  }

  // Put onto temp canvas (putImageData is fine here — temp canvas is blank)
  tmpCtx.putImageData(tinted, 0, 0);

  // Draw temp canvas onto target using proper compositing (respects globalAlpha + blendMode)
  ctx.drawImage(tmpCanvas as unknown as CanvasImageSource, x, y);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const n = parseInt(clean, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Create an offscreen canvas. Tries to use a compatible canvas from the same
 * module as the reference context (avoids dual node-canvas native module issues).
 * Falls back to OffscreenCanvas, node-canvas require, or document.createElement.
 */
function createOffscreenCanvas(
  width: number,
  height: number,
  referenceCtx?: CanvasRenderingContext2D,
): OffscreenCanvas | HTMLCanvasElement | null {
  // If we have a reference context, try to create a canvas from the same module
  // (avoids node-canvas dual-module issues where different Canvas instances are incompatible)
  if (referenceCtx) {
    try {
      const refCanvas = referenceCtx.canvas;
      if (refCanvas && typeof refCanvas.constructor === "function") {
        const compat = new (refCanvas.constructor as new (w: number, h: number) => HTMLCanvasElement)(width, height);
        if (compat && typeof compat.getContext === "function") return compat;
      }
    } catch {
      // noop — fall through to other methods
    }
  }

  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }

  // Node.js fallback: try node-canvas
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createCanvas } = require("canvas") as { createCanvas: (w: number, h: number) => HTMLCanvasElement };
    return createCanvas(width, height);
  } catch {
    // noop
  }

  // Browser fallback
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  return null;
}
