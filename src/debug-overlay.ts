import type { LayerBounds } from "@genart-dev/core";
import { type VectorField, divergenceAt, curlAt } from "./vector-field.js";

export type DebugMode = "arrows" | "heatmap" | "contours" | "all";

export interface DebugOverlayOptions {
  mode: DebugMode;
  opacity: number; // [0, 1] overall overlay opacity
}

// ---------------------------------------------------------------------------
// Cool-warm colormap: deep blue (0) → white (0.5) → deep red (1)
// ---------------------------------------------------------------------------

function magnitudeColor(t: number): [number, number, number] {
  // Clamp
  t = Math.max(0, Math.min(1, t));
  if (t < 0.5) {
    // blue (#2166ac) → white
    const s = t * 2;
    return [
      Math.round(33 + (255 - 33) * s),
      Math.round(102 + (255 - 102) * s),
      Math.round(172 + (255 - 172) * s),
    ];
  } else {
    // white → red (#d6604d)
    const s = (t - 0.5) * 2;
    return [
      Math.round(255 + (214 - 255) * s),
      Math.round(255 + (96 - 255) * s),
      Math.round(255 + (77 - 255) * s),
    ];
  }
}

// ---------------------------------------------------------------------------
// Arrow glyph
// ---------------------------------------------------------------------------

function drawArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  magnitude: number,
  cellW: number,
  cellH: number,
  alpha: number,
): void {
  const maxLen = Math.min(cellW, cellH) * 0.45;
  const len = magnitude * maxLen;
  if (len < 1) {
    // Zero magnitude: draw a small dot
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fill();
    return;
  }

  const ex = cx + dx * len;
  const ey = cy + dy * len;

  // Arrow head
  const headLen = Math.min(6, len * 0.35);
  const headAngle = Math.PI / 6;
  const angle = Math.atan2(dy, dx);
  const hx1 = ex - headLen * Math.cos(angle - headAngle);
  const hy1 = ey - headLen * Math.sin(angle - headAngle);
  const hx2 = ex - headLen * Math.cos(angle + headAngle);
  const hy2 = ey - headLen * Math.sin(angle + headAngle);

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(ex, ey);
  ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(hx1, hy1);
  ctx.lineTo(hx2, hy2);
  ctx.closePath();
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Colorbar legend
// ---------------------------------------------------------------------------

function drawColorbar(
  ctx: CanvasRenderingContext2D,
  bounds: LayerBounds,
  alpha: number,
): void {
  const barW = 10;
  const barH = 80;
  const margin = 8;
  const bx = bounds.x + bounds.width - barW - margin;
  const by = bounds.y + bounds.height - barH - margin;

  // Gradient fill
  const gradient = ctx.createLinearGradient(bx, by + barH, bx, by);
  gradient.addColorStop(0, `rgba(33,102,172,${alpha})`);
  gradient.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
  gradient.addColorStop(1, `rgba(214,96,77,${alpha})`);

  ctx.fillStyle = gradient;
  ctx.fillRect(bx, by, barW, barH);

  // Border
  ctx.strokeStyle = `rgba(0,0,0,${alpha * 0.5})`;
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, barW, barH);

  // Labels
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.font = "10px monospace";
  ctx.textAlign = "right";
  ctx.fillText("1.0", bx - 2, by + 4);
  ctx.fillText("0.5", bx - 2, by + barH / 2 + 4);
  ctx.fillText("0.0", bx - 2, by + barH + 4);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render the vector field debug overlay onto `ctx` within `bounds`.
 * Call this AFTER painting if `debug === true`.
 */
export function renderDebugOverlay(
  field: VectorField,
  ctx: CanvasRenderingContext2D,
  bounds: LayerBounds,
  options: DebugOverlayOptions,
): void {
  const { cols, rows, samples } = field;
  const { mode, opacity } = options;

  const cellW = bounds.width / cols;
  const cellH = bounds.height / rows;

  const drawHeatmap = mode === "heatmap" || mode === "all";
  const drawArrows = mode === "arrows" || mode === "all";
  const drawContours = mode === "contours" || mode === "all";

  ctx.save();

  // ------------------------------------------------------------------
  // 1. Heatmap — semi-transparent magnitude color per cell
  // ------------------------------------------------------------------
  if (drawHeatmap) {
    const heatAlpha = opacity * 0.5;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const sample = samples[row * cols + col]!;
        const [r, g, b] = magnitudeColor(sample.magnitude);
        ctx.fillStyle = `rgba(${r},${g},${b},${heatAlpha})`;
        ctx.fillRect(
          bounds.x + col * cellW,
          bounds.y + row * cellH,
          cellW,
          cellH,
        );
      }
    }
    drawColorbar(ctx, bounds, opacity);
  }

  // ------------------------------------------------------------------
  // 2. Contours — divergence and curl isolines
  // ------------------------------------------------------------------
  if (drawContours) {
    const DIVERGE_THRESHOLD = 0.1;
    const CURL_THRESHOLD = 0.15;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const div = divergenceAt(field, col, row);
        const curl = curlAt(field, col, row);
        const cx = bounds.x + (col + 0.5) * cellW;
        const cy = bounds.y + (row + 0.5) * cellH;

        if (div > DIVERGE_THRESHOLD) {
          // Bloom zone — warm orange dashed rectangle
          ctx.save();
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = `rgba(255,140,0,${opacity})`;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(
            bounds.x + col * cellW + 1,
            bounds.y + row * cellH + 1,
            cellW - 2,
            cellH - 2,
          );
          ctx.restore();
        } else if (div < -DIVERGE_THRESHOLD) {
          // Pooling zone — cool blue dashed rectangle
          ctx.save();
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = `rgba(33,102,172,${opacity})`;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(
            bounds.x + col * cellW + 1,
            bounds.y + row * cellH + 1,
            cellW - 2,
            cellH - 2,
          );
          ctx.restore();
        }

        if (Math.abs(curl) > CURL_THRESHOLD) {
          // Vorticity marker — purple circle
          const r = Math.min(cellW, cellH) * 0.25;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(160,32,240,${opacity})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // 3. Arrows — wind-barb style quiver at each cell center
  // ------------------------------------------------------------------
  if (drawArrows) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const sample = samples[row * cols + col]!;
        const cx = bounds.x + (col + 0.5) * cellW;
        const cy = bounds.y + (row + 0.5) * cellH;
        drawArrow(
          ctx,
          cx,
          cy,
          sample.dx,
          sample.dy,
          sample.magnitude,
          cellW,
          cellH,
          opacity,
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // 4. Faint grid lines
  // ------------------------------------------------------------------
  if (drawArrows || drawHeatmap) {
    ctx.strokeStyle = `rgba(255,255,255,${opacity * 0.15})`;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([]);
    for (let col = 0; col <= cols; col++) {
      ctx.beginPath();
      ctx.moveTo(bounds.x + col * cellW, bounds.y);
      ctx.lineTo(bounds.x + col * cellW, bounds.y + bounds.height);
      ctx.stroke();
    }
    for (let row = 0; row <= rows; row++) {
      ctx.beginPath();
      ctx.moveTo(bounds.x, bounds.y + row * cellH);
      ctx.lineTo(bounds.x + bounds.width, bounds.y + row * cellH);
      ctx.stroke();
    }
  }

  ctx.restore();
}
