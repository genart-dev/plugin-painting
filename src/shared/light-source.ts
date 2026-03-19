/**
 * Directional light source for bristle rendering.
 * Drives shadow/highlight offset direction, distance, color temperature,
 * and impasto thickness amplification.
 */

import { type RGB, shiftShadow, shiftHighlight } from "./color-mix.js";
import type { Vec2 } from "./bristle.js";

export interface LightSource {
  /** Light direction in radians. 0 = from right, PI/2 = from below. Default ~5.5 (upper-left, 315°). */
  angle: number;
  /** Light elevation 0-1. 0 = raking (long shadows), 1 = overhead (no shadows). Default 0.5. */
  elevation: number;
  /** Shadow darkness 0-1. Default 0.3. */
  shadowDepth: number;
  /** Highlight/specular intensity 0-1. Default 0.25. */
  highlightStrength: number;
  /** Shadow temperature: -1 (cool/blue) to +1 (warm/orange). Default 0 (neutral). */
  shadowTemperature: number;
}

export const DEFAULT_LIGHT: LightSource = {
  angle: (315 * Math.PI) / 180, // upper-left
  elevation: 0.5,
  shadowDepth: 0.3,
  highlightStrength: 0.25,
  shadowTemperature: 0,
};

/**
 * Compute shadow offset vector from light source.
 * Shadow falls opposite to light direction. Distance scales with elevation
 * and bristle width. Impasto strokes get amplified shadows.
 */
export function computeShadowOffset(
  light: LightSource,
  bristleWidth: number,
  isImpasto = false,
): Vec2 {
  const distance = (1 - light.elevation) * bristleWidth * 0.15;
  const impastoMul = isImpasto ? 2.5 : 1;
  const shadowAngle = light.angle + Math.PI; // opposite of light direction
  return {
    x: Math.cos(shadowAngle) * distance * impastoMul,
    y: Math.sin(shadowAngle) * distance * impastoMul,
  };
}

/**
 * Compute highlight offset vector from light source.
 * Highlight appears on the light-facing side, closer than shadow.
 */
export function computeHighlightOffset(
  light: LightSource,
  bristleWidth: number,
  isImpasto = false,
): Vec2 {
  const distance = (1 - light.elevation) * bristleWidth * 0.06;
  const impastoMul = isImpasto ? 1.8 : 1;
  return {
    x: Math.cos(light.angle) * distance * impastoMul,
    y: Math.sin(light.angle) * distance * impastoMul,
  };
}

/**
 * Compute shadow color using Oklab shift with light source parameters.
 * Impasto strokes get deeper shadows (thicker paint catches more shadow).
 */
export function computeShadowColor(
  rgb: RGB,
  light: LightSource,
  isImpasto = false,
): RGB {
  const depth = light.shadowDepth * (isImpasto ? 1.4 : 1);
  return shiftShadow(rgb, depth, light.shadowTemperature);
}

/**
 * Compute highlight color using Oklab shift with light source parameters.
 * Impasto strokes get stronger highlights (thick paint catches specular light).
 */
export function computeHighlightColor(
  rgb: RGB,
  light: LightSource,
  isImpasto = false,
): RGB {
  const strength = light.highlightStrength * (isImpasto ? 1.5 : 1);
  return shiftHighlight(rgb, strength, -light.shadowTemperature);
}

/** Convert degrees (0-360) to LightSource angle in radians. */
export function degreesToLightAngle(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
