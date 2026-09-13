import { describe, it, expect } from "vitest";
import { createCanvas } from "canvas";
import { washLayerType, renderWashPixels } from "../src/wash.js";
import type { LayerBounds, RenderResources } from "@genart-dev/core";

// Real node-canvas: a wash is judged by its pixels.

const W = 120;
const H = 120;
const bounds: LayerBounds = { x: 0, y: 0, width: W, height: H, rotation: 0, scaleX: 1, scaleY: 1 };
const SQUARE = [{ x: 20, y: 20 }, { x: 100, y: 20 }, { x: 100, y: 100 }, { x: 20, y: 100 }];

function props(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...washLayerType.createDefault(),
    region: JSON.stringify({ type: "polygon", points: SQUARE }),
    color: "#000000",
    density: 0.4,
    pool: 0,
    ragged: 0,
    mottle: 0,
    granulation: 0,
    ...overrides,
  };
}

/** Alpha (0-1) of the wash at canvas pixel (x, y). */
function alphaAt(p: Record<string, unknown>) {
  const out = renderWashPixels(p as never, bounds)!;
  return (x: number, y: number) => {
    const px = x - out.x;
    const py = y - out.y;
    if (px < 0 || py < 0 || px >= out.width || py >= out.height) return 0;
    return out.data[(py * out.width + px) * 4 + 3]! / 255;
  };
}

describe("washLayerType", () => {
  it("floods the region at its density and leaves outside bare", () => {
    const a = alphaAt(props());
    expect(Math.abs(a(60, 60) - 0.4)).toBeLessThan(0.01);
    expect(a(10, 60)).toBe(0);
    expect(a(60, 110)).toBe(0);
  });

  it("pools pigment along the edge, darker than the body", () => {
    const a = alphaAt(props({ pool: 0.6, poolWidth: 4 }));
    expect(a(21, 60)).toBeGreaterThan(a(60, 60) + 0.2);
    // Far inside, the pool has decayed to the body tone
    expect(Math.abs(a(60, 60) - 0.4)).toBeLessThan(0.02);
  });

  it("edge weights of 0 remove the pool along those edges", () => {
    // Vertices 0-1 are the top edge, 3-0 the left: weight 0 on vertices 0 and 1
    // leaves the top edge unpooled, while the bottom (2-3) keeps its pool.
    const a = alphaAt(props({ pool: 0.6, poolWidth: 4, edgeWeights: JSON.stringify([0, 0, 1, 1]) }));
    expect(Math.abs(a(60, 22) - 0.4)).toBeLessThan(0.02);
    expect(a(60, 98)).toBeGreaterThan(0.6);
  });

  it("a gradient ramps the body tone across the region", () => {
    const a = alphaAt(props({ gradient: JSON.stringify({ angle: 0, from: 0.5, to: 1.5 }) }));
    expect(a(95, 60)).toBeGreaterThan(a(25, 60) + 0.25);
  });

  it("has no row or column structure: adjacent rows differ no more than adjacent columns", () => {
    // The stroke-built rock showed scanlines. A mottled, granulated wash must
    // vary as much across as down.
    const a = alphaAt(props({ pool: 0.4, mottle: 0.4, mottleScale: 20, granulation: 0.3, ragged: 3 }));
    let rows = 0;
    let cols = 0;
    for (let y = 35; y < 85; y++) {
      for (let x = 35; x < 85; x++) {
        rows += Math.abs(a(x, y + 1) - a(x, y));
        cols += Math.abs(a(x + 1, y) - a(x, y));
      }
    }
    expect(rows / cols).toBeGreaterThan(0.8);
    expect(rows / cols).toBeLessThan(1.25);
  });

  it("stretched mottle streaks along its angle", () => {
    // Vertical streaks: the wash changes far less down a column than across a row
    const a = alphaAt(props({ mottle: 0.8, mottleScale: 6, mottleAngle: 90, mottleStretch: 5 }));
    let down = 0;
    let across = 0;
    for (let y = 30; y < 90; y++) {
      for (let x = 30; x < 90; x++) {
        down += Math.abs(a(x, y + 1) - a(x, y));
        across += Math.abs(a(x + 1, y) - a(x, y));
      }
    }
    expect(down * 2.5).toBeLessThan(across);
  });

  it("draws over what is already on the canvas instead of replacing it", () => {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    ctx.fillStyle = "rgb(200,100,50)";
    ctx.fillRect(0, 0, W, H);
    washLayerType.render(props({ density: 0.5, color: "#ffffff" }) as never, ctx, bounds, {} as RenderResources);
    const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 4));
    // Inside the region the ground shows through a half-strength white wash
    const inside = at(60, 60);
    expect(inside[3]).toBe(255);
    expect(Math.abs(inside[0]! - 228)).toBeLessThanOrEqual(2);
    // Next to the region, but inside the wash's pixel box, the ground is untouched
    expect(at(60, 19)).toEqual([200, 100, 50, 255]);
  });

  it("rejects malformed JSON", () => {
    expect(washLayerType.validate({ ...props(), region: "{nope" } as never)).not.toBeNull();
    expect(washLayerType.validate(props() as never)).toBeNull();
  });
});
