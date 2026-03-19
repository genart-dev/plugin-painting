/**
 * Oklab-based pigment color mixing for the bristle renderer.
 * Provides perceptually uniform interpolation, shadow/highlight shifts,
 * and jitter that replaces naive RGB arithmetic.
 *
 * Adapted from plugin-shapes/src/blend/color.ts (Oklab matrices proven there).
 */

export type RGB = [number, number, number];

// ---------------------------------------------------------------------------
// sRGB ↔ linear ↔ Oklab conversion (0-255 integer RGB)
// ---------------------------------------------------------------------------

function linearize(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function delinearize(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Convert 0-255 sRGB to Oklab [L, a, b]. L ∈ [0,1], a/b ∈ [-0.4, 0.4]. */
export function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = linearize(r), lg = linearize(g), lb = linearize(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const lc = Math.cbrt(l), mc = Math.cbrt(m), sc = Math.cbrt(s);
  return [
    0.2104542553 * lc + 0.7936177850 * mc - 0.0040720468 * sc,
    1.9779984951 * lc - 2.4285922050 * mc + 0.4505937099 * sc,
    0.0259040371 * lc + 0.7827717662 * mc - 0.8086757660 * sc,
  ];
}

/** Convert Oklab [L, a, b] back to 0-255 sRGB, clamped. */
export function oklabToRgb(L: number, a: number, b: number): RGB {
  const lc = L + 0.3963377774 * a + 0.2158037573 * b;
  const mc = L - 0.1055613458 * a - 0.0638541728 * b;
  const sc = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = lc * lc * lc, m = mc * mc * mc, s = sc * sc * sc;
  const r = delinearize(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = delinearize(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = delinearize(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
  return [
    Math.round(Math.max(0, Math.min(255, r * 255))),
    Math.round(Math.max(0, Math.min(255, g * 255))),
    Math.round(Math.max(0, Math.min(255, bl * 255))),
  ];
}

// ---------------------------------------------------------------------------
// Pigment mixing
// ---------------------------------------------------------------------------

export interface MixPigmentOpts {
  /** Preserve chroma at midpoint (0 = allow full mud, 1 = no chroma loss). Default 0.7. */
  chromaPreservation?: number;
  /** Darken at 50/50 mix to simulate subtractive behavior (0-0.3). Default 0.1. */
  darkenBias?: number;
}

/**
 * Mix two colors in Oklab space with pigment-like behavior.
 * - Interpolates perceptually (blue + yellow → green, not grey)
 * - Optional darkening bias at midpoint (subtractive approximation)
 * - Optional chroma preservation to prevent muddy mixes
 */
export function mixPigment(
  colorA: RGB, colorB: RGB, ratio: number,
  opts: MixPigmentOpts = {},
): RGB {
  const chromaPres = opts.chromaPreservation ?? 0.7;
  const darkenBias = opts.darkenBias ?? 0.1;

  const labA = rgbToOklab(colorA[0], colorA[1], colorA[2]);
  const labB = rgbToOklab(colorB[0], colorB[1], colorB[2]);

  // Interpolate in Oklab
  let L = labA[0] + (labB[0] - labA[0]) * ratio;
  let a = labA[1] + (labB[1] - labA[1]) * ratio;
  let b = labA[2] + (labB[2] - labA[2]) * ratio;

  // Subtractive darkening: maximum at ratio=0.5, zero at 0 and 1
  const mixDepth = 4 * ratio * (1 - ratio); // parabola peaking at 0.5
  L -= darkenBias * mixDepth;

  // Chroma preservation: prevent muddy desaturation
  if (chromaPres > 0) {
    const chromaA = Math.sqrt(labA[1] * labA[1] + labA[2] * labA[2]);
    const chromaB = Math.sqrt(labB[1] * labB[1] + labB[2] * labB[2]);
    const expectedChroma = chromaA + (chromaB - chromaA) * ratio;
    const actualChroma = Math.sqrt(a * a + b * b);
    const minChroma = expectedChroma * chromaPres;
    if (actualChroma > 0 && actualChroma < minChroma) {
      const scale = minChroma / actualChroma;
      a *= scale;
      b *= scale;
    }
  }

  return oklabToRgb(L, a, b);
}

// ---------------------------------------------------------------------------
// Shadow / highlight shifts (Oklab-based)
// ---------------------------------------------------------------------------

/**
 * Compute shadow color by darkening in Oklab with optional temperature shift.
 * @param rgb - Base color (0-255)
 * @param depth - Shadow darkness (0-1, typically 0.2-0.4)
 * @param temperature - Cool (-1) to warm (+1) shadow shift. Default 0 (neutral).
 */
export function shiftShadow(rgb: RGB, depth: number, temperature = 0): RGB {
  const lab = rgbToOklab(rgb[0], rgb[1], rgb[2]);
  lab[0] -= depth * 0.25; // Darken L
  // Temperature: warm shifts toward +a (red), cool shifts toward -a (green-blue)
  lab[1] += temperature * 0.02;
  lab[2] -= temperature * 0.015; // Warm = less blue, cool = more blue
  return oklabToRgb(lab[0], lab[1], lab[2]);
}

/**
 * Compute highlight color by brightening in Oklab with optional temperature shift.
 * @param rgb - Base color (0-255)
 * @param strength - Highlight brightness (0-1, typically 0.15-0.3)
 * @param temperature - Cool (-1) to warm (+1) highlight. Default 0 (neutral).
 */
export function shiftHighlight(rgb: RGB, strength: number, temperature = 0): RGB {
  const lab = rgbToOklab(rgb[0], rgb[1], rgb[2]);
  lab[0] += strength * 0.2; // Brighten L
  lab[1] -= temperature * 0.01; // Subtle inverse of shadow temperature
  lab[2] += temperature * 0.01;
  return oklabToRgb(lab[0], lab[1], lab[2]);
}

// ---------------------------------------------------------------------------
// Perceptual jitter (Oklab-based)
// ---------------------------------------------------------------------------

/**
 * Apply per-bristle color jitter in Oklab space for perceptually uniform variation.
 * @param rgb - Base color (0-255)
 * @param amount - Jitter strength (same scale as old RGB jitter, 0-40)
 * @param rng - Random number generator
 */
export function jitterOklab(rgb: RGB, amount: number, rng: () => number): RGB {
  if (amount <= 0) return rgb;
  const lab = rgbToOklab(rgb[0], rgb[1], rgb[2]);
  // Scale: amount of 20 ≈ old RGB jitter of 20, but perceptually uniform
  const scale = amount / 255;
  lab[0] += (rng() - 0.5) * scale * 0.5;   // L jitter (subtle)
  lab[1] += (rng() - 0.5) * scale * 0.3;   // a jitter
  lab[2] += (rng() - 0.5) * scale * 0.3;   // b jitter
  return oklabToRgb(lab[0], lab[1], lab[2]);
}
