/**
 * Shared bristle stroke rendering utilities.
 * TypeScript port of the bristle-stroke-renderer + brush-stroke-paths components.
 */

export interface Vec2 { x: number; y: number }

export interface BristleConfig {
  width: number;
  bristleCount: number;
  alpha: number;
  pressure: number;
  paintLoad: number;
  taper: number; // 0=pointed, 1=blunt, 2=chisel
  texture: "smooth" | "dry" | "rough" | "stipple" | "feathered" | "impasto";
  colorMode: "single" | "lateral" | "along" | "loaded" | "random" | "split" |
             "streaked" | "rainbow" | "complementary" | "analogous" | "temperature" | "loaded-knife";
  palette: [number, number, number][];
  mixAmount: number;
  colorJitter: number;
  shadowAlpha: number;
  shadowWidthScale: number;
  highlightAlpha: number;
  highlightWidthScale: number;
  highlightBlend: string;
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const n = parseInt(clean, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function gaussianOffset(rng: () => number, sigma = 0.33): number {
  const u1 = rng() || 0.001;
  const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng()) * sigma;
  return g < -1 ? -1 : g > 1 ? 1 : g;
}

export function taperProfile(t: number, style: number): number {
  if (style === 1) return smoothstep(0, 0.05, t) * smoothstep(1, 0.95, t); // blunt
  if (style === 2) return smoothstep(0, 0.08, t) * smoothstep(1, 0.92, t); // chisel
  return smoothstep(0, 0.2, t) * smoothstep(1, 0.7, t);                    // pointed
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function computePerpendiculars(path: Vec2[]): Vec2[] {
  const perps: Vec2[] = new Array(path.length);
  for (let i = 0; i < path.length; i++) {
    const ni = i < path.length - 1 ? i + 1 : i;
    const pi = i > 0 ? i - 1 : i;
    const dx = path[ni]!.x - path[pi]!.x;
    const dy = path[ni]!.y - path[pi]!.y;
    const rl = Math.sqrt(dx * dx + dy * dy) || 1;
    perps[i] = { x: -dy / rl, y: dx / rl };
  }
  return perps;
}

export function traceDabPath(
  x: number, y: number, angle: number, length: number, stepSize = 4,
): Vec2[] {
  const steps = Math.max(4, Math.ceil(length / stepSize));
  const actualStep = length / steps;
  const path: Vec2[] = [{ x, y }];
  let cx = x, cy = y;
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  for (let s = 1; s <= steps; s++) {
    cx += cosA * actualStep;
    cy += sinA * actualStep;
    path.push({ x: cx, y: cy });
  }
  return path;
}

export function traceBrushPath(
  flowFn: (x: number, y: number) => [number, number],
  x: number, y: number,
  steps: number, stepSize = 2.5,
  angleOffset = 0, angleSpread = 0, flowInfluence = 1,
  rng?: () => number,
): Vec2[] {
  const degToRad = Math.PI / 180;
  const artistAng = angleOffset * degToRad;
  const spread = rng ? (rng() - 0.5) * 2 * angleSpread * Math.PI : 0;
  const path: Vec2[] = [{ x, y }];
  let cx = x, cy = y;
  for (let s = 0; s < steps; s++) {
    const fl = flowFn(cx, cy);
    const flowAng = Math.atan2(fl[1], fl[0]);
    const ang = lerp(artistAng + spread, flowAng, flowInfluence);
    cx += Math.cos(ang) * stepSize;
    cy += Math.sin(ang) * stepSize;
    path.push({ x: cx, y: cy });
  }
  return path;
}

// ---------------------------------------------------------------------------
// Core bristle renderer
// ---------------------------------------------------------------------------

/** Mulberry32 PRNG seeded inline for per-bristle wobble. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

export function renderBristleStroke(
  ctx: CanvasRenderingContext2D,
  path: Vec2[],
  cfg: BristleConfig,
  rng: () => number,
): void {
  const {
    width: brushW, bristleCount: bristleN, alpha, pressure: pressAmt,
    paintLoad: load, taper: taperStyle, texture,
    colorMode, palette, mixAmount, colorJitter: colorJit,
    shadowAlpha: shAlphaScale, shadowWidthScale: shWidthScale,
    highlightAlpha: hiAlphaScale, highlightWidthScale: hiWidthScale,
    highlightBlend: hiBlend,
  } = cfg;

  // Texture params
  let bristleSkipChance = 0, bristleWidthJitter = 0, bristleGapProb = 0, extraWobble = 0;
  if (texture === "dry") { bristleSkipChance = 0.3; bristleWidthJitter = 0.6; bristleGapProb = 0.2; }
  else if (texture === "rough") { extraWobble = 0.5; bristleWidthJitter = 0.4; }
  else if (texture === "stipple") { bristleGapProb = 0.3; bristleWidthJitter = 0.4; bristleSkipChance = 0.1; }
  else if (texture === "feathered") { bristleSkipChance = 0.15; extraWobble = 0.3; }
  else if (texture === "impasto") { bristleWidthJitter = -0.3; extraWobble = 0.1; }

  const perps = computePerpendiculars(path);
  ctx.lineCap = (taperStyle === 1) ? "butt" : "round";
  ctx.lineJoin = "round";

  const strokeSteps = path.length - 1;
  const effectiveSteps = Math.max(4, Math.floor(strokeSteps * lerp(0.4, 1.0, load)));
  const useChunks = texture !== "smooth";
  const TAPER_PASSES = strokeSteps < 20 ? 3 : 4;

  const shOx = -1, shOy = -1;
  const hiOx = 0.4, hiOy = 0.4;

  for (let bi = 0; bi < bristleN; bi++) {
    if (rng() < bristleSkipChance) continue;

    const lateralBase = gaussianOffset(rng);
    const lateralT = (lateralBase + 1) * 0.5;

    // Color selection
    let rgb: [number, number, number] = [128, 128, 128];
    if (palette.length === 0) {
      rgb = [128, 128, 128];
    } else if (colorMode === "single" || palette.length === 1) {
      rgb = [...palette[0]!] as [number, number, number];
    } else if (colorMode === "split") {
      rgb = [...palette[lateralT < 0.5 ? 0 : 1]!] as [number, number, number];
    } else if (colorMode === "streaked") {
      const si = bi % 3 === 0 ? 0 : Math.min(1, palette.length - 1);
      const sm = bi % 3 === 2 ? 0.5 : (bi % 3 === 0 ? 0 : 1);
      rgb = [
        Math.round(lerp(palette[0]![0], palette[Math.min(1, palette.length - 1)]![0], sm)),
        Math.round(lerp(palette[0]![1], palette[Math.min(1, palette.length - 1)]![1], sm)),
        Math.round(lerp(palette[0]![2], palette[Math.min(1, palette.length - 1)]![2], sm)),
      ];
      void si; // streaked uses sm directly
    } else if (colorMode === "rainbow" || colorMode === "analogous") {
      const cIdx = lateralT * (palette.length - 1);
      const ci0 = Math.floor(cIdx), ci1 = Math.min(ci0 + 1, palette.length - 1);
      const ct = cIdx - ci0;
      rgb = [
        Math.round(lerp(palette[ci0]![0], palette[ci1]![0], ct)),
        Math.round(lerp(palette[ci0]![1], palette[ci1]![1], ct)),
        Math.round(lerp(palette[ci0]![2], palette[ci1]![2], ct)),
      ];
    } else if (colorMode === "complementary") {
      const st = smoothstep(0.35, 0.65, lateralT);
      rgb = [
        Math.round(lerp(palette[0]![0], palette[1]![0], st)),
        Math.round(lerp(palette[0]![1], palette[1]![1], st)),
        Math.round(lerp(palette[0]![2], palette[1]![2], st)),
      ];
    } else if (colorMode === "loaded-knife") {
      const bw = 1 / palette.length;
      const bIdx = Math.min(Math.floor(lateralT / bw), palette.length - 1);
      const bPos = (lateralT % bw) / bw;
      const nb = Math.min(bIdx + 1, palette.length - 1);
      const sm = smoothstep(0.7, 1.0, bPos) * mixAmount;
      rgb = [
        Math.round(lerp(palette[bIdx]![0], palette[nb]![0], sm)),
        Math.round(lerp(palette[bIdx]![1], palette[nb]![1], sm)),
        Math.round(lerp(palette[bIdx]![2], palette[nb]![2], sm)),
      ];
    } else if (colorMode === "temperature") {
      const bIdx = Math.min(Math.floor(lateralT * (palette.length - 1)), palette.length - 1);
      rgb = [...palette[bIdx]!] as [number, number, number];
    } else {
      // lateral, random, along, loaded — resolved below via mixAmount blending
      rgb = [...palette[bi % palette.length]!] as [number, number, number];
    }

    // MixAmount blending for 2-colour modes
    if (
      (colorMode === "lateral" || colorMode === "random" || colorMode === "loaded" || colorMode === "along")
      && palette.length >= 2
    ) {
      let mixT = lateralT;
      if (colorMode === "random") mixT = rng();
      mixT = lerp(mixT, 0.5, 1 - mixAmount);
      rgb = [
        Math.round(lerp(palette[0]![0], palette[1]![0], mixT)),
        Math.round(lerp(palette[0]![1], palette[1]![1], mixT)),
        Math.round(lerp(palette[0]![2], palette[1]![2], mixT)),
      ];
    }

    // Per-bristle jitter
    if (colorJit > 0) {
      rgb[0] = clamp(rgb[0] + Math.round((rng() - 0.5) * colorJit * 2), 0, 255);
      rgb[1] = clamp(rgb[1] + Math.round((rng() - 0.5) * colorJit * 2), 0, 255);
      rgb[2] = clamp(rgb[2] + Math.round((rng() - 0.5) * colorJit * 2), 0, 255);
    }

    const wobbleRng = mulberry32(Math.floor(rng() * 10000));
    const shR = Math.max(0, rgb[0] - 50);
    const shG = Math.max(0, rgb[1] - 45);
    const shB = Math.max(0, rgb[2] - 35);
    const hiR = Math.min(255, rgb[0] + 40);
    const hiG = Math.min(255, rgb[1] + 35);
    const hiB = Math.min(255, rgb[2] + 20);

    // Build bristle waypoints
    const bp: Vec2[] = new Array(path.length);
    for (let pi = 0; pi < path.length; pi++) {
      const t = pi / (path.length - 1);
      const tap = taperProfile(t, taperStyle);
      const press = tap * lerp(1 - pressAmt * 0.6, 1, tap);
      const halfW = brushW * 0.5 * press;
      const wobble = (wobbleRng() - 0.5) * (0.15 + extraWobble);
      const lateral = (lateralBase + wobble) * halfW;
      bp[pi] = {
        x: path[pi]!.x + perps[pi]!.x * lateral,
        y: path[pi]!.y + perps[pi]!.y * lateral,
      };
    }

    let bwBase = brushW / bristleN * lerp(0.9, 2.5, (1 - Math.abs(lateralBase)) ** 2);
    if (bristleWidthJitter !== 0) {
      bwBase = Math.max(0.5, bwBase * (1 - bristleWidthJitter * (rng() - 0.5) * 2));
    }

    const shOff = bwBase * 0.7;

    function smoothPath(startI: number, endI: number, ox: number, oy: number): void {
      ctx.moveTo(bp[startI]!.x + ox, bp[startI]!.y + oy);
      for (let si = startI + 1; si < endI; si++) {
        if (si + 1 < path.length) {
          const mx = (bp[si]!.x + bp[si + 1]!.x) * 0.5 + ox;
          const my = (bp[si]!.y + bp[si + 1]!.y) * 0.5 + oy;
          ctx.quadraticCurveTo(bp[si]!.x + ox, bp[si]!.y + oy, mx, my);
        } else {
          ctx.lineTo(bp[si]!.x + ox, bp[si]!.y + oy);
        }
      }
      if (endI < path.length) ctx.lineTo(bp[endI]!.x + ox, bp[endI]!.y + oy);
    }

    if (useChunks) {
      const CHUNKS = 20;
      const chunkSize = Math.max(2, Math.ceil(effectiveSteps / CHUNKS));
      for (let ci = 0; ci < CHUNKS; ci++) {
        const sp = ci * chunkSize;
        const ep = Math.min(sp + chunkSize + 1, effectiveSteps);
        if (sp >= effectiveSteps || ep - sp < 2) break;
        if (rng() < bristleGapProb) continue;

        const chunkT = (sp + ep) * 0.5 / effectiveSteps;
        const taperMul = lerp(1.0, 1.0 - pressAmt * 0.7, chunkT * chunkT);
        const bw = bwBase * taperMul;
        const loadMul = Math.max(0.2, 1 - chunkT * chunkT * lerp(1.5, 0.15, load));
        const chunkAlpha = alpha * loadMul;
        if (chunkAlpha < 0.005) break;

        const sa = chunkAlpha * shAlphaScale;
        if (sa > 0.003) {
          ctx.lineWidth = bw * shWidthScale;
          ctx.beginPath();
          smoothPath(sp, ep, shOx * shOff, shOy * shOff);
          ctx.strokeStyle = `rgba(${shR},${shG},${shB},${sa.toFixed(3)})`;
          ctx.stroke();
        }
        ctx.lineWidth = bw;
        ctx.beginPath();
        smoothPath(sp, ep, 0, 0);
        ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${chunkAlpha.toFixed(3)})`;
        ctx.stroke();
      }
    } else {
      // Continuous multi-pass taper
      for (let tp = TAPER_PASSES - 1; tp >= 0; tp--) {
        const passT = tp / (TAPER_PASSES - 1);
        const passEnd = Math.max(3, Math.floor(lerp(effectiveSteps, effectiveSteps * 0.2, passT)));
        if (passEnd < 3) continue;

        const midT = (passEnd * 0.5) / effectiveSteps;
        const taperMul = lerp(1.0, 1.0 - pressAmt * 0.7, passT * passT);
        const bw = bwBase * taperMul;
        const loadMul = Math.max(0.2, 1 - midT * midT * lerp(1.5, 0.15, load));
        const passAlpha = alpha * loadMul * lerp(0.65, 0.3, passT);
        if (passAlpha < 0.003) continue;

        let cR = rgb[0], cG = rgb[1], cB = rgb[2];
        let csR = shR, csG = shG, csB = shB;
        let chR = hiR, chG = hiG, chB = hiB;

        if (colorMode === "along" && palette.length >= 2) {
          const am = lerp(lerp(lateralT, 1 - lateralT, midT), 0.5, 1 - mixAmount);
          cR = clamp(Math.round(lerp(palette[0]![0], palette[1]![0], am)), 0, 255);
          cG = clamp(Math.round(lerp(palette[0]![1], palette[1]![1], am)), 0, 255);
          cB = clamp(Math.round(lerp(palette[0]![2], palette[1]![2], am)), 0, 255);
          csR = Math.max(0, cR - 50); csG = Math.max(0, cG - 45); csB = Math.max(0, cB - 35);
          chR = Math.min(255, cR + 40); chG = Math.min(255, cG + 35); chB = Math.min(255, cB + 20);
        } else if (colorMode === "loaded" && palette.length >= 2) {
          const lm = midT * mixAmount;
          cR = clamp(Math.round(lerp(palette[0]![0], palette[1]![0], lm)), 0, 255);
          cG = clamp(Math.round(lerp(palette[0]![1], palette[1]![1], lm)), 0, 255);
          cB = clamp(Math.round(lerp(palette[0]![2], palette[1]![2], lm)), 0, 255);
          csR = Math.max(0, cR - 50); csG = Math.max(0, cG - 45); csB = Math.max(0, cB - 35);
          chR = Math.min(255, cR + 40); chG = Math.min(255, cG + 35); chB = Math.min(255, cB + 20);
        } else if (colorMode === "temperature" && palette.length >= 2) {
          const ti0 = Math.floor(midT * (palette.length - 1));
          const ti1 = Math.min(ti0 + 1, palette.length - 1);
          const tt = midT * (palette.length - 1) - ti0;
          cR = Math.round(lerp(palette[ti0]![0], palette[ti1]![0], tt));
          cG = Math.round(lerp(palette[ti0]![1], palette[ti1]![1], tt));
          cB = Math.round(lerp(palette[ti0]![2], palette[ti1]![2], tt));
          csR = Math.max(0, cR - 50); csG = Math.max(0, cG - 45); csB = Math.max(0, cB - 35);
          chR = Math.min(255, cR + 40); chG = Math.min(255, cG + 35); chB = Math.min(255, cB + 20);
        }

        const sa = passAlpha * shAlphaScale;
        if (sa > 0.003) {
          ctx.lineWidth = bw * shWidthScale;
          ctx.beginPath();
          smoothPath(0, passEnd, shOx * shOff, shOy * shOff);
          ctx.strokeStyle = `rgba(${csR},${csG},${csB},${sa.toFixed(3)})`;
          ctx.stroke();
        }

        ctx.lineWidth = bw;
        ctx.beginPath();
        smoothPath(0, passEnd, 0, 0);
        ctx.strokeStyle = `rgba(${cR},${cG},${cB},${passAlpha.toFixed(3)})`;
        ctx.stroke();

        const ha = passAlpha * hiAlphaScale;
        if (ha > 0.002) {
          ctx.save();
          ctx.globalCompositeOperation = hiBlend as GlobalCompositeOperation;
          ctx.lineWidth = bw * hiWidthScale;
          ctx.beginPath();
          smoothPath(0, passEnd, hiOx * shOff, hiOy * shOff);
          ctx.strokeStyle = `rgba(${chR},${chG},${chB},${ha.toFixed(3)})`;
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }
}

export function defaultBristleConfig(overrides: Partial<BristleConfig> = {}): BristleConfig {
  return {
    width: 30,
    bristleCount: 10,
    alpha: 0.5,
    pressure: 0.65,
    paintLoad: 0.7,
    taper: 0,
    texture: "smooth",
    colorMode: "single",
    palette: [[80, 80, 80]],
    mixAmount: 0.6,
    colorJitter: 20,
    shadowAlpha: 0.2,
    shadowWidthScale: 1.3,
    highlightAlpha: 0.08,
    highlightWidthScale: 0.5,
    highlightBlend: "lighter",
    ...overrides,
  };
}
