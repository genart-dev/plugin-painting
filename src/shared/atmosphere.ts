/**
 * Atmospheric perspective for bristle rendering.
 * Modifies color and mark density based on vertical depth position.
 * Techniques derived from Snižina (value compression) and Ledina (temperature shift).
 */

import { type RGB, rgbToOklab, oklabToRgb } from "./color-mix.js";

export interface AtmosphereConfig {
  /** Normalized Y position of the horizon (0 = top, 1 = bottom). Default 0.5. */
  horizonY: number;
  /** Value range compression toward horizon (0 = none, 1 = full). Default 0. */
  valueCompression: number;
  /** Warm foreground → cool background temperature shift (0 = none, 1 = full). Default 0. */
  temperatureShift: number;
  /** Chroma/saturation reduction toward horizon (0 = none, 1 = full desaturation). Default 0. */
  chromaFalloff: number;
  /** Mark density reduction toward horizon (0 = none, 1 = full reduction). Default 0. */
  densityFalloff: number;
}

export const DEFAULT_ATMOSPHERE: AtmosphereConfig = {
  horizonY: 0.5,
  valueCompression: 0,
  temperatureShift: 0,
  chromaFalloff: 0,
  densityFalloff: 0,
};

/**
 * Compute depth factor (0 = foreground, 1 = at horizon) from normalized Y position.
 * Elements beyond the horizon stay at 1.
 */
function depthFactor(normalizedY: number, horizonY: number): number {
  if (horizonY <= 0) return 1;
  if (normalizedY >= horizonY) return 1;
  return normalizedY / horizonY;
}

/**
 * Apply atmospheric perspective to a color based on vertical position.
 * Returns modified RGB. All transformations happen in Oklab space.
 *
 * @param rgb - Base color (0-255)
 * @param normalizedY - Vertical position 0 (top) to 1 (bottom)
 * @param config - Atmosphere configuration
 */
export function applyAtmosphere(
  rgb: RGB,
  normalizedY: number,
  config: AtmosphereConfig,
): RGB {
  const { horizonY, valueCompression, temperatureShift, chromaFalloff } = config;

  // No effect if all params are zero
  if (valueCompression === 0 && temperatureShift === 0 && chromaFalloff === 0) return rgb;

  const depth = depthFactor(normalizedY, horizonY);
  const lab = rgbToOklab(rgb[0], rgb[1], rgb[2]);

  // Value compression: compress L toward 0.5 as depth increases
  if (valueCompression > 0) {
    const compressionAmount = depth * valueCompression;
    const midL = 0.55; // slightly above neutral to keep backgrounds luminous
    lab[0] = lab[0] + (midL - lab[0]) * compressionAmount * 0.6;
  }

  // Temperature shift: foreground warm (a+), background cool (a-)
  if (temperatureShift > 0) {
    const warmCool = (1 - depth * 2) * temperatureShift; // +1 near, -1 far
    lab[1] += warmCool * 0.03; // a axis: positive = warm/red
    lab[2] -= depth * temperatureShift * 0.02; // b axis: reduce yellow toward horizon
  }

  // Chroma falloff: reduce saturation toward horizon
  if (chromaFalloff > 0) {
    const chroma = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
    if (chroma > 0) {
      const reduction = 1 - depth * chromaFalloff * 0.7;
      const scale = Math.max(0.1, reduction);
      lab[1] *= scale;
      lab[2] *= scale;
    }
  }

  return oklabToRgb(lab[0], lab[1], lab[2]);
}

/**
 * Compute mark density multiplier based on depth.
 * Returns 0-1 where 1 = full density (foreground) and lower values = fewer marks.
 *
 * @param normalizedY - Vertical position 0 (top) to 1 (bottom)
 * @param config - Atmosphere configuration
 */
export function atmosphereDensityScale(
  normalizedY: number,
  config: AtmosphereConfig,
): number {
  if (config.densityFalloff <= 0) return 1;
  const depth = depthFactor(normalizedY, config.horizonY);
  return Math.max(0.15, 1 - depth * config.densityFalloff * 0.7);
}
