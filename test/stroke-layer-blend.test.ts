import { describe, it, expect } from "vitest";
import { createCanvas } from "canvas";
import { strokeLayerType } from "../src/stroke-layer.js";
import type { LayerBounds, RenderResources } from "@genart-dev/core";

// Real node-canvas, not the mock context: the bug these guard against only
// shows in pixels. The stamp renderer set its brush's own composite op on the
// output, so a stroke layer's blend mode was silently replaced by source-over.

const W = 60;
const H = 60;
const GROUND = [200, 150, 100];
const INK = "#808080"; // 128: multiply halves the ground

const bounds: LayerBounds = { x: 0, y: 0, width: W, height: H, rotation: 0, scaleX: 1, scaleY: 1 };

/** A layer with one thick opaque horizontal bar across the middle. */
function props(): Record<string, unknown> {
  return {
    ...strokeLayerType.createDefault(),
    brushes: JSON.stringify([
      {
        id: "flat", name: "Flat", tipType: "round", hardness: 1, roundness: 1, angle: 0, size: 20, sizeMin: 1,
        opacity: 1, flow: 1, spacing: 0.05, scatter: 0, dynamics: {}, taperStart: 0, taperEnd: 0,
        scatterAlongPath: 0, grainScale: 1, grainDepth: 0, grainMode: "moving",
        blendMode: "source-over", renderMode: "buildup", smoothing: 0,
      },
    ]),
    strokes: JSON.stringify([
      { brushId: "flat", color: INK, size: 20, opacity: 1, points: [{ x: 0, y: 30, pressure: 1 }, { x: 60, y: 30, pressure: 1 }] },
    ]),
  };
}

/** Paint the ground, then composite the layer as core's compositor does. */
function paint(op: GlobalCompositeOperation, translate = 0) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = `rgb(${GROUND.join(",")})`;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalCompositeOperation = op;
  ctx.translate(translate, 0);
  strokeLayerType.render(props() as never, ctx, bounds, {} as RenderResources);
  ctx.restore();
  return (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
}

describe("strokeLayerType blend modes", () => {
  it("normal layers still paint over the ground", () => {
    const px = paint("source-over");
    // The tinted tip lands at 127, not 128
    for (const c of px(30, 30)) expect(Math.abs(c - 128)).toBeLessThanOrEqual(2);
    expect(px(30, 2)).toEqual(GROUND);
  });

  it("a multiply layer multiplies instead of painting over", () => {
    const px = paint("multiply");
    const [r, g, b] = px(30, 30);
    // 200*128/255 = 100, 150*128/255 = 75, 100*128/255 = 50
    expect(Math.abs(r! - 100)).toBeLessThanOrEqual(2);
    expect(Math.abs(g! - 75)).toBeLessThanOrEqual(2);
    expect(Math.abs(b! - 50)).toBeLessThanOrEqual(2);
    // Untouched ground stays the ground: nothing outside the bar is darkened
    expect(px(30, 2)).toEqual(GROUND);
  });

  it("the layer's transform survives isolation", () => {
    // A bar translated off to the right leaves the left edge untouched
    const px = paint("multiply", 40);
    expect(px(10, 30)).toEqual(GROUND);
    expect(Math.abs(px(50, 30)[0]! - 100)).toBeLessThanOrEqual(2);
  });

  it("restores the output context's composite op", () => {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    ctx.globalCompositeOperation = "multiply";
    strokeLayerType.render(props() as never, ctx, bounds, {} as RenderResources);
    expect(ctx.globalCompositeOperation).toBe("multiply");
  });
});
