/**
 * Core types for the brush stroke system.
 *
 * A BrushDefinition describes how a brush behaves (tip shape, dynamics,
 * spacing, compositing). A BrushStroke is a concrete path to stamp along
 * using a specific brush.
 */

/** A single point on a stroke path. */
export interface StrokePoint {
  readonly x: number;
  readonly y: number;
  /** Pen pressure 0–1, defaults to 1.0 if omitted. */
  readonly pressure?: number;
}

/**
 * Dynamics mapping: how pen pressure modulates a brush property.
 * - `undefined` → no modulation (use base value)
 * - `true` → linear: `baseValue * pressure`
 * - `[min, max]` → range: `baseValue * lerp(min, max, pressure)`
 */
export type DynamicMapping = boolean | [min: number, max: number] | undefined;

/** Complete brush definition — tip shape, spacing, dynamics, compositing. */
export interface BrushDefinition {
  readonly id: string;
  readonly name: string;

  // Tip shape
  readonly tipType: "round" | "texture";
  /** Hardness falloff for round tips. 1.0 = hard edge, 0.0 = Gaussian. */
  readonly hardness?: number;
  /** Base64-encoded tip texture (for tipType "texture"). */
  readonly tipTexture?: string;
  /** Ellipse squash ratio. 1.0 = circle, 0.2 = flat. */
  readonly roundness: number;
  /** Tip rotation in degrees. */
  readonly angle: number;

  // Size & opacity
  /** Base stamp size in pixels. */
  readonly size: number;
  /** Minimum size as a fraction of base size (0–1). */
  readonly sizeMin: number;
  /** Layer opacity 0–1. */
  readonly opacity: number;
  /** Stamp flow (per-stamp opacity) 0–1. */
  readonly flow: number;

  // Spacing & scatter
  /** Spacing as fraction of current stamp diameter (0.01–1.0). */
  readonly spacing: number;
  /** Perpendicular scatter amount (0–2). */
  readonly scatter: number;
  /** Along-path scatter amount (0–2). */
  readonly scatterAlongPath: number;

  // Pressure dynamics
  readonly dynamics: {
    readonly size?: DynamicMapping;
    readonly opacity?: DynamicMapping;
    readonly flow?: DynamicMapping;
    readonly scatter?: DynamicMapping;
  };

  // Taper
  /** Start taper length in pixels. */
  readonly taperStart: number;
  /** End taper length in pixels. */
  readonly taperEnd: number;

  // Grain texture
  /** Base64-encoded grain texture. */
  readonly grainTexture?: string;
  /** Grain texture scale multiplier. */
  readonly grainScale: number;
  /** Grain depth (strength of modulation) 0–1. */
  readonly grainDepth: number;
  /** Grain mode: "moving" follows the stamp, "static" is fixed to canvas. */
  readonly grainMode: "moving" | "static";

  // Compositing
  /** Canvas2D globalCompositeOperation. */
  readonly blendMode: GlobalCompositeOperation;
  /** "buildup" stamps directly; "wash" clamps alpha to opacity. */
  readonly renderMode: "wash" | "buildup";
  /** Path smoothing 0–1 (0 = raw points, 1 = full Catmull-Rom). */
  readonly smoothing: number;
}

/** A concrete stroke: a path + brush reference + color. */
export interface BrushStroke {
  /** Brush preset ID or custom brush ID. */
  readonly brushId: string;
  /** Stroke color as hex string. */
  readonly color: string;
  /** Override layer opacity for this stroke. */
  readonly opacity?: number;
  /** Override brush size for this stroke. */
  readonly size?: number;
  /** The path points. */
  readonly points: StrokePoint[];
  /** PRNG seed for scatter/jitter. */
  readonly seed?: number;
}
