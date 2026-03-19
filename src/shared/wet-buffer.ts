/**
 * Wet-on-wet paint mixing buffer.
 * Tracks paint wetness per pixel and enables new strokes to blend
 * with underlying wet paint using Oklab pigment mixing.
 *
 * Architecture:
 * - Half-resolution Float32Array for wetness tracking (memory efficient)
 * - Canvas snapshot captured once per layer render (not per stroke)
 * - mixWithUnderlying() reads snapshot pixels and blends in Oklab space
 * - muddyLimit prevents complementary mixes from going grey
 */

import { type RGB, rgbToOklab, oklabToRgb, mixPigment } from "./color-mix.js";

export interface WetMixConfig {
  /** Paint wetness 0-1. 0 = dry (no mixing), 1 = fully wet. Default 0. */
  wetness: number;
  /** How strongly new paint mixes with underlying wet paint 0-1. Default 0.5. */
  mixStrength: number;
  /** Wetness decay rate between passes 0-1. Default 0.3. */
  dryingRate: number;
  /** Minimum chroma preservation during mixing 0-1. Prevents muddy results. Default 0.7. */
  muddyLimit: number;
}

export const DEFAULT_WET_MIX: WetMixConfig = {
  wetness: 0,
  mixStrength: 0.5,
  dryingRate: 0.3,
  muddyLimit: 0.7,
};

export class WetBuffer {
  private readonly w: number;
  private readonly h: number;
  private readonly halfW: number;
  private readonly halfH: number;
  private readonly wetness: Float32Array;
  private snapshotData: Uint8ClampedArray | null = null;
  private snapshotW = 0;
  private snapshotH = 0;

  /**
   * Create a wet buffer at half resolution for efficiency.
   * A 600x600 canvas produces a 300x300 wetness grid.
   */
  constructor(width: number, height: number) {
    this.w = width;
    this.h = height;
    this.halfW = Math.ceil(width / 2);
    this.halfH = Math.ceil(height / 2);
    this.wetness = new Float32Array(this.halfW * this.halfH);
  }

  /**
   * Capture the current canvas state for wet-mix reads. Call once per layer render.
   * @param offsetX - X offset into the canvas (for modifier-path rendering)
   * @param offsetY - Y offset into the canvas (for modifier-path rendering)
   */
  snapshot(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0): void {
    const imageData = ctx.getImageData(offsetX, offsetY, this.w, this.h);
    this.snapshotData = imageData.data;
    this.snapshotW = this.w;
    this.snapshotH = this.h;

    // Pre-fill wetness grid from snapshot alpha so cross-layer wet mixing
    // works: if there are existing non-transparent pixels, mark them as wet.
    for (let hy = 0; hy < this.halfH; hy++) {
      for (let hx = 0; hx < this.halfW; hx++) {
        const sx = Math.min(hx * 2, this.w - 1);
        const sy = Math.min(hy * 2, this.h - 1);
        const alpha = this.snapshotData[(sy * this.w + sx) * 4 + 3]!;
        if (alpha > 20) {
          this.wetness[hy * this.halfW + hx] = (alpha / 255) * 0.6;
        }
      }
    }
  }

  /** Deposit wet paint at a position. */
  deposit(x: number, y: number, amount: number): void {
    const hx = Math.floor(x / 2);
    const hy = Math.floor(y / 2);
    if (hx < 0 || hx >= this.halfW || hy < 0 || hy >= this.halfH) return;
    const idx = hy * this.halfW + hx;
    this.wetness[idx] = Math.min(1, Math.max(this.wetness[idx]!, amount));
  }

  /** Sample wetness at a position. Returns 0-1. */
  sample(x: number, y: number): number {
    const hx = Math.floor(x / 2);
    const hy = Math.floor(y / 2);
    if (hx < 0 || hx >= this.halfW || hy < 0 || hy >= this.halfH) return 0;
    return this.wetness[hy * this.halfW + hx]!;
  }

  /** Decay all wetness values (simulate drying between passes). */
  decay(dryingRate: number): void {
    const factor = 1 - dryingRate;
    for (let i = 0; i < this.wetness.length; i++) {
      this.wetness[i]! *= factor;
    }
  }

  /**
   * Read the underlying canvas color at a position from the snapshot.
   * Returns null if no snapshot or position is out of bounds.
   */
  readUnderlying(x: number, y: number): RGB | null {
    if (!this.snapshotData) return null;
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || px >= this.snapshotW || py < 0 || py >= this.snapshotH) return null;
    const idx = (py * this.snapshotW + px) * 4;
    // Skip fully transparent pixels (nothing underneath)
    if (this.snapshotData[idx + 3]! < 10) return null;
    return [
      this.snapshotData[idx]!,
      this.snapshotData[idx + 1]!,
      this.snapshotData[idx + 2]!,
    ];
  }

  /**
   * Mix a new paint color with the underlying wet paint at a position.
   * Returns the blended color, or the original color if no wet paint underneath.
   */
  mixWithUnderlying(
    newColor: RGB,
    x: number, y: number,
    config: WetMixConfig,
  ): RGB {
    if (config.wetness <= 0 || config.mixStrength <= 0) return newColor;

    const underlyingWetness = this.sample(x, y);
    if (underlyingWetness < 0.05) {
      // No wet paint underneath — deposit new paint as wet
      this.deposit(x, y, config.wetness);
      return newColor;
    }

    const underlying = this.readUnderlying(x, y);
    if (!underlying) {
      this.deposit(x, y, config.wetness);
      return newColor;
    }

    // Mix ratio: how much underlying paint influences the result
    const mixRatio = underlyingWetness * config.mixStrength * 0.5;

    // Blend in Oklab with chroma preservation
    const mixed = mixPigment(newColor, underlying, mixRatio, {
      chromaPreservation: config.muddyLimit,
      darkenBias: 0.05, // lighter bias for wet mixing vs pigment mixing
    });

    // Update wetness (stays wet from mixing)
    this.deposit(x, y, Math.max(config.wetness, underlyingWetness * 0.8));

    return mixed;
  }
}
