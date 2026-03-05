/**
 * Brush tip generator.
 *
 * Creates grayscale ImageData for round and texture brush tips with
 * configurable hardness falloff, roundness squash, and rotation.
 */

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface TipCacheEntry {
  readonly data: ImageData;
}

const tipCache = new Map<string, TipCacheEntry>();
const MAX_CACHE_SIZE = 128;

/** Pre-decoded raw texture data keyed by base64 string (or its hash). */
const textureRawCache = new Map<string, ImageData>();

function cacheKey(
  size: number,
  hardness: number,
  roundness: number,
  angle: number,
): string {
  // Quantize to reduce cache misses
  const s = Math.round(size);
  const h = Math.round(hardness * 100);
  const r = Math.round(roundness * 100);
  const a = Math.round(angle) % 360;
  return `${s}:${h}:${r}:${a}`;
}

function textureCacheKey(
  base64Hash: string,
  size: number,
  roundness: number,
  angle: number,
): string {
  const s = Math.round(size);
  const r = Math.round(roundness * 100);
  const a = Math.round(angle) % 360;
  return `tex:${base64Hash}:${s}:${r}:${a}`;
}

/** Simple hash of a string (for cache keys). */
function hashString(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

// ---------------------------------------------------------------------------
// Tip generation
// ---------------------------------------------------------------------------

/**
 * Generate a round brush tip as grayscale ImageData.
 *
 * - `hardness = 1.0` → binary circle (alpha 255 inside, 0 outside)
 * - `hardness = 0.0` → smooth Gaussian falloff from center
 * - `roundness < 1.0` → squashes the circle into an ellipse
 * - `angle` → rotates the ellipse (degrees)
 *
 * The alpha channel encodes tip opacity; RGB are set to 255 (white).
 *
 * @param size - Tip diameter in pixels (minimum 1).
 * @param hardness - Edge hardness 0–1.
 * @param roundness - Ellipse ratio 0.01–1.0.
 * @param angle - Rotation in degrees.
 * @returns ImageData of `size × size` pixels.
 */
export function generateRoundTip(
  size: number,
  hardness: number,
  roundness: number,
  angle: number,
): ImageData {
  const s = Math.max(1, Math.round(size));
  const key = cacheKey(s, hardness, roundness, angle);

  const cached = tipCache.get(key);
  if (cached) return cached.data;

  const imageData = new ImageData(s, s);
  const data = imageData.data;

  const cx = (s - 1) / 2;
  const cy = (s - 1) / 2;
  const radius = s / 2;

  // Pre-compute rotation (negative angle to match clockwise convention)
  const rad = (-angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Roundness: scale along the minor axis (perpendicular to angle direction)
  const invRoundness = 1 / Math.max(0.01, roundness);

  for (let py = 0; py < s; py++) {
    for (let px = 0; px < s; px++) {
      // Offset from center
      const dx = px - cx;
      const dy = py - cy;

      // Rotate into the brush's local coordinate frame
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;

      // Apply roundness squash to the y-axis in local space
      const dist = Math.sqrt(rx * rx + (ry * invRoundness) * (ry * invRoundness));

      // Normalized distance (0 = center, 1 = edge)
      const nd = dist / radius;

      // Anti-alias band width in pixels
      const aaBand = 1.5;
      const edgeDist = (1 - nd) * radius; // px from edge (negative = outside)

      let alpha: number;
      if (nd > 1) {
        // Outside radius — AA falloff over 1.5px
        const overshoot = -edgeDist;
        alpha = overshoot < aaBand ? Math.round((1 - overshoot / aaBand) * 255) : 0;
      } else if (hardness >= 1) {
        // Hard edge with sub-pixel AA at boundary
        alpha = edgeDist >= aaBand ? 255 : Math.round((edgeDist / aaBand) * 255);
      } else {
        // Smooth falloff: blend between Gaussian (hardness=0) and hard (hardness=1)
        const gaussian = Math.exp(-nd * nd * 4.5);
        const hard = edgeDist >= aaBand ? 1 : edgeDist / aaBand;
        alpha = Math.round(lerp(gaussian, hard, hardness) * 255);
      }

      const i = (py * s + px) * 4;
      data[i] = 255;     // R
      data[i + 1] = 255; // G
      data[i + 2] = 255; // B
      data[i + 3] = alpha;
    }
  }

  // Evict oldest if cache is full
  if (tipCache.size >= MAX_CACHE_SIZE) {
    const firstKey = tipCache.keys().next().value as string;
    tipCache.delete(firstKey);
  }

  tipCache.set(key, { data: imageData });
  return imageData;
}

/** Clear the tip cache (useful for testing or memory management). */
export function clearTipCache(): void {
  tipCache.clear();
  textureRawCache.clear();
}

// ---------------------------------------------------------------------------
// Texture tip generation
// ---------------------------------------------------------------------------

/**
 * Synchronously decode a base64 PNG/grayscale image into raw ImageData.
 * This is the "preload" step — call it before rendering so that
 * `generateTextureTip` can read from cache.
 *
 * Decoding is synchronous: the base64 is parsed into raw pixel bytes
 * without relying on browser `<img>` or node-canvas `loadImage()`.
 * Only uncompressed data-URI PNGs with IHDR+IDAT+IEND are supported
 * via a minimal inline decoder. For maximum compatibility, callers
 * should supply small (32×32 or 64×64) embedded textures.
 *
 * @param base64 - Base64-encoded PNG image (with or without data URI prefix).
 * @returns The decoded ImageData, or null if decoding fails.
 */
export function preloadTextureTip(base64: string): ImageData | null {
  const hash = hashString(base64);
  const cached = textureRawCache.get(hash);
  if (cached) return cached;

  const raw = decodeBase64Png(base64);
  if (!raw) return null;

  textureRawCache.set(hash, raw);
  return raw;
}

/**
 * Check if a texture tip has been preloaded and is ready for use.
 */
export function isTextureTipCached(base64: string): boolean {
  return textureRawCache.has(hashString(base64));
}

/**
 * Generate a texture brush tip as grayscale ImageData.
 *
 * The source texture's luminance is used as the alpha mask.
 * The texture is scaled to `size × size`, then roundness squash
 * and rotation are applied (same transforms as `generateRoundTip`).
 *
 * The texture must have been preloaded via `preloadTextureTip()`.
 * If not cached, returns a fallback round tip.
 *
 * @param tipTexture - Base64-encoded texture (must be preloaded).
 * @param size - Target tip diameter in pixels.
 * @param roundness - Ellipse ratio 0.01–1.0.
 * @param angle - Rotation in degrees.
 * @returns ImageData of `size × size` pixels.
 */
export function generateTextureTip(
  tipTexture: string,
  size: number,
  roundness: number,
  angle: number,
): ImageData {
  const s = Math.max(1, Math.round(size));
  const hash = hashString(tipTexture);
  const key = textureCacheKey(hash, s, roundness, angle);

  const cached = tipCache.get(key);
  if (cached) return cached.data;

  // Look up the pre-decoded raw texture
  const raw = textureRawCache.get(hash);
  if (!raw) {
    // Not preloaded — fall back to round tip
    return generateRoundTip(s, 0.5, roundness, angle);
  }

  const imageData = new ImageData(s, s);
  const data = imageData.data;

  const cx = (s - 1) / 2;
  const cy = (s - 1) / 2;
  const radius = s / 2;

  // Pre-compute rotation
  const rad = (-angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const invRoundness = 1 / Math.max(0.01, roundness);

  const srcW = raw.width;
  const srcH = raw.height;
  const src = raw.data;

  for (let py = 0; py < s; py++) {
    for (let px = 0; px < s; px++) {
      const dx = px - cx;
      const dy = py - cy;

      // Rotate + squash (same as round tip)
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      const dist = Math.sqrt(rx * rx + (ry * invRoundness) * (ry * invRoundness));
      const nd = dist / radius;

      if (nd > 1) {
        // Outside the tip circle — transparent
        const i = (py * s + px) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = 0;
        continue;
      }

      // Map current pixel to source texture coordinates using nearest-neighbor
      // Map the local-space position to texture UV
      const u = (rx / radius + 1) / 2; // 0–1
      const v = ((ry * invRoundness) / radius + 1) / 2; // 0–1

      const srcX = Math.min(srcW - 1, Math.max(0, Math.round(u * (srcW - 1))));
      const srcY = Math.min(srcH - 1, Math.max(0, Math.round(v * (srcH - 1))));
      const srcI = (srcY * srcW + srcX) * 4;

      // Use luminance as alpha (grayscale texture: white = opaque, black = transparent)
      const r = src[srcI]!;
      const g = src[srcI + 1]!;
      const b = src[srcI + 2]!;
      const srcAlpha = src[srcI + 3]!;
      const luminance = (r * 0.299 + g * 0.587 + b * 0.114);
      const alpha = Math.round((luminance / 255) * (srcAlpha / 255) * 255);

      const i = (py * s + px) * 4;
      data[i] = 255;     // R
      data[i + 1] = 255; // G
      data[i + 2] = 255; // B
      data[i + 3] = alpha;
    }
  }

  // Cache the result
  if (tipCache.size >= MAX_CACHE_SIZE) {
    const firstKey = tipCache.keys().next().value as string;
    tipCache.delete(firstKey);
  }
  tipCache.set(key, { data: imageData });

  return imageData;
}

// ---------------------------------------------------------------------------
// Minimal PNG decoder (for small embedded base64 textures)
// ---------------------------------------------------------------------------

/**
 * Decode a base64-encoded PNG into ImageData.
 * Supports 8-bit RGBA and grayscale PNGs with a single unfiltered IDAT chunk.
 * For small embedded textures (32×32, 64×64), this is sufficient.
 * Returns null if the image can't be decoded.
 */
function decodeBase64Png(base64: string): ImageData | null {
  try {
    // Strip data URI prefix if present
    const raw = base64.replace(/^data:image\/\w+;base64,/, "");
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    // Verify PNG signature
    if (
      bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e ||
      bytes[3] !== 0x47 || bytes[4] !== 0x0d || bytes[5] !== 0x0a ||
      bytes[6] !== 0x1a || bytes[7] !== 0x0a
    ) {
      return null;
    }

    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const idatChunks: Uint8Array[] = [];

    // Parse chunks
    let offset = 8;
    while (offset < bytes.length) {
      const length = readUint32(bytes, offset);
      const type = String.fromCharCode(
        bytes[offset + 4]!, bytes[offset + 5]!,
        bytes[offset + 6]!, bytes[offset + 7]!,
      );

      if (type === "IHDR") {
        width = readUint32(bytes, offset + 8);
        height = readUint32(bytes, offset + 12);
        bitDepth = bytes[offset + 16]!;
        colorType = bytes[offset + 17]!;
      } else if (type === "IDAT") {
        idatChunks.push(bytes.slice(offset + 8, offset + 8 + length));
      } else if (type === "IEND") {
        break;
      }

      offset += 12 + length; // 4 length + 4 type + data + 4 CRC
    }

    if (width === 0 || height === 0 || idatChunks.length === 0) return null;
    if (bitDepth !== 8) return null; // Only support 8-bit

    // Concatenate IDAT chunks
    const totalLen = idatChunks.reduce((sum, c) => sum + c.length, 0);
    const compressed = new Uint8Array(totalLen);
    let pos = 0;
    for (const chunk of idatChunks) {
      compressed.set(chunk, pos);
      pos += chunk.length;
    }

    // Decompress (zlib deflate)
    const decompressed = inflateSync(compressed);
    if (!decompressed) return null;

    // Determine bytes per pixel
    let bpp: number;
    if (colorType === 0) bpp = 1;       // Grayscale
    else if (colorType === 2) bpp = 3;   // RGB
    else if (colorType === 4) bpp = 2;   // Grayscale + Alpha
    else if (colorType === 6) bpp = 4;   // RGBA
    else return null;

    // Reconstruct scanlines (apply PNG filters)
    const imageData = new ImageData(width, height);
    const out = imageData.data;
    const stride = width * bpp;

    let srcOff = 0;
    let prevRow: Uint8Array | null = null;

    for (let y = 0; y < height; y++) {
      const filterType = decompressed[srcOff++]!;
      const row = decompressed.slice(srcOff, srcOff + stride);
      srcOff += stride;

      // Apply PNG filter
      unfilterRow(row, prevRow, filterType, bpp);

      // Convert to RGBA
      for (let x = 0; x < width; x++) {
        const di = (y * width + x) * 4;
        if (colorType === 0) {
          // Grayscale
          const v = row[x]!;
          out[di] = v;
          out[di + 1] = v;
          out[di + 2] = v;
          out[di + 3] = 255;
        } else if (colorType === 2) {
          // RGB
          out[di] = row[x * 3]!;
          out[di + 1] = row[x * 3 + 1]!;
          out[di + 2] = row[x * 3 + 2]!;
          out[di + 3] = 255;
        } else if (colorType === 4) {
          // Grayscale + Alpha
          const v = row[x * 2]!;
          out[di] = v;
          out[di + 1] = v;
          out[di + 2] = v;
          out[di + 3] = row[x * 2 + 1]!;
        } else if (colorType === 6) {
          // RGBA
          out[di] = row[x * 4]!;
          out[di + 1] = row[x * 4 + 1]!;
          out[di + 2] = row[x * 4 + 2]!;
          out[di + 3] = row[x * 4 + 3]!;
        }
      }

      prevRow = row;
    }

    return imageData;
  } catch {
    return null;
  }
}

function readUint32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset]! << 24) |
      (data[offset + 1]! << 16) |
      (data[offset + 2]! << 8) |
      data[offset + 3]!) >>> 0
  );
}

function unfilterRow(
  row: Uint8Array,
  prev: Uint8Array | null,
  filterType: number,
  bpp: number,
): void {
  const len = row.length;
  switch (filterType) {
    case 0: // None
      break;
    case 1: // Sub
      for (let i = bpp; i < len; i++) {
        row[i] = (row[i]! + row[i - bpp]!) & 0xff;
      }
      break;
    case 2: // Up
      if (prev) {
        for (let i = 0; i < len; i++) {
          row[i] = (row[i]! + prev[i]!) & 0xff;
        }
      }
      break;
    case 3: // Average
      for (let i = 0; i < len; i++) {
        const a = i >= bpp ? row[i - bpp]! : 0;
        const b = prev ? prev[i]! : 0;
        row[i] = (row[i]! + Math.floor((a + b) / 2)) & 0xff;
      }
      break;
    case 4: // Paeth
      for (let i = 0; i < len; i++) {
        const a = i >= bpp ? row[i - bpp]! : 0;
        const b = prev ? prev[i]! : 0;
        const c = prev && i >= bpp ? prev[i - bpp]! : 0;
        row[i] = (row[i]! + paethPredictor(a, b, c)) & 0xff;
      }
      break;
  }
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Minimal synchronous inflate (zlib decompress).
 * Handles the zlib wrapper (2-byte header) + raw deflate.
 * Supports uncompressed (type 0), fixed Huffman (type 1), and
 * dynamic Huffman (type 2) blocks.
 */
function inflateSync(data: Uint8Array): Uint8Array | null {
  // Try Node.js zlib first (handles all compression variants)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-eval
    const zlib = (0, eval)('require')("zlib") as { inflateSync: (buf: Uint8Array) => Uint8Array };
    const result = zlib.inflateSync(data);
    return new Uint8Array(result);
  } catch {
    // Fall through to manual implementation (for browser)
  }

  try {
    // Skip zlib header (2 bytes: CMF + FLG)
    let pos = 2;
    const output: number[] = [];

    // Bit reader state
    let bitBuf = 0;
    let bitCount = 0;

    function readBits(n: number): number {
      while (bitCount < n) {
        if (pos >= data.length) return 0;
        bitBuf |= data[pos++]! << bitCount;
        bitCount += 8;
      }
      const val = bitBuf & ((1 << n) - 1);
      bitBuf >>= n;
      bitCount -= n;
      return val;
    }

    function readByte(): number {
      // Align to byte boundary
      bitBuf = 0;
      bitCount = 0;
      return data[pos++]!;
    }

    // Fixed Huffman tables
    const FIXED_LIT = buildFixedLitTable();
    const FIXED_DIST = buildFixedDistTable();

    let bfinal = 0;
    while (!bfinal) {
      bfinal = readBits(1);
      const btype = readBits(2);

      if (btype === 0) {
        // Uncompressed block
        const lo = readByte();
        const hi = readByte();
        const len = lo | (hi << 8);
        readByte(); // nlen lo
        readByte(); // nlen hi
        for (let i = 0; i < len; i++) {
          output.push(data[pos++]!);
        }
      } else if (btype === 1) {
        // Fixed Huffman
        decodeBlock(readBits, FIXED_LIT, FIXED_DIST, output);
      } else if (btype === 2) {
        // Dynamic Huffman
        const { litTable, distTable } = decodeDynamicTables(readBits);
        decodeBlock(readBits, litTable, distTable, output);
      } else {
        return null; // Invalid block type
      }
    }

    return new Uint8Array(output);
  } catch {
    return null;
  }
}

// Length and distance base/extra tables for deflate
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
  35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
  3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
  257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
  7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];

interface HuffmanTable {
  counts: number[];
  symbols: number[];
  maxBits: number;
}

function buildHuffmanTable(codeLengths: number[], maxCode: number): HuffmanTable {
  const maxBits = Math.max(...codeLengths.slice(0, maxCode), 1);
  const counts = new Array(maxBits + 1).fill(0) as number[];
  const nextCode = new Array(maxBits + 1).fill(0) as number[];
  const symbols = new Array(1 << maxBits).fill(0) as number[];

  for (let i = 0; i < maxCode; i++) {
    if (codeLengths[i]!) counts[codeLengths[i]!]!++;
  }

  let code = 0;
  for (let bits = 1; bits <= maxBits; bits++) {
    code = (code + counts[bits - 1]!) << 1;
    nextCode[bits] = code;
  }

  // Fill lookup table
  for (let i = 0; i < (1 << maxBits); i++) symbols[i] = -1;

  for (let i = 0; i < maxCode; i++) {
    const len = codeLengths[i]!;
    if (len === 0) continue;
    const c = nextCode[len]!;
    nextCode[len] = c + 1;

    // Reverse bits for table lookup
    let rev = 0;
    let tmp = c;
    for (let b = 0; b < len; b++) {
      rev = (rev << 1) | (tmp & 1);
      tmp >>= 1;
    }

    // Fill all entries that share this prefix
    const step = 1 << len;
    for (let j = rev; j < (1 << maxBits); j += step) {
      symbols[j] = i | (len << 16);
    }
  }

  return { counts, symbols, maxBits };
}

function decodeSymbol(readBits: (n: number) => number, table: HuffmanTable): number {
  const bits = readBits(table.maxBits);
  const entry = table.symbols[bits & ((1 << table.maxBits) - 1)]!;
  if (entry === -1) return -1;
  const symbol = entry & 0xffff;
  const len = entry >> 16;
  // "unread" the excess bits
  // We read maxBits but only needed `len` bits, so we need to put back maxBits - len
  // Since our readBits consumes bits, we need a different approach
  // Actually, we need to handle this differently — let me use a proper decode loop
  return symbol | (len << 16);
}

function buildFixedLitTable(): HuffmanTable {
  const lengths = new Array(288).fill(0) as number[];
  for (let i = 0; i <= 143; i++) lengths[i] = 8;
  for (let i = 144; i <= 255; i++) lengths[i] = 9;
  for (let i = 256; i <= 279; i++) lengths[i] = 7;
  for (let i = 280; i <= 287; i++) lengths[i] = 8;
  return buildHuffmanTable(lengths, 288);
}

function buildFixedDistTable(): HuffmanTable {
  const lengths = new Array(32).fill(5) as number[];
  return buildHuffmanTable(lengths, 32);
}

function decodeBlock(
  readBits: (n: number) => number,
  litTable: HuffmanTable,
  distTable: HuffmanTable,
  output: number[],
): void {
  while (true) {
    const litEntry = slowDecode(readBits, litTable);
    if (litEntry < 0) break;

    if (litEntry < 256) {
      output.push(litEntry);
    } else if (litEntry === 256) {
      break; // End of block
    } else {
      // Length-distance pair
      const lenIdx = litEntry - 257;
      const length = LENGTH_BASE[lenIdx]! + readBits(LENGTH_EXTRA[lenIdx]!);

      const distEntry = slowDecode(readBits, distTable);
      const distance = DIST_BASE[distEntry]! + readBits(DIST_EXTRA[distEntry]!);

      // Copy from output buffer
      const start = output.length - distance;
      for (let i = 0; i < length; i++) {
        output.push(output[start + i]!);
      }
    }
  }
}

/** Bit-by-bit Huffman decode (slower but correct). */
function slowDecode(readBits: (n: number) => number, table: HuffmanTable): number {
  // Read one bit at a time and check against code lengths
  let code = 0;
  for (let bits = 1; bits <= table.maxBits; bits++) {
    code = (code << 1) | readBits(1);
    // Check if any symbol has this code at this length
    const entry = table.symbols[reverseBits(code, bits) & ((1 << table.maxBits) - 1)];
    if (entry !== undefined && entry !== -1) {
      const sym = entry & 0xffff;
      const len = entry >> 16;
      if (len === bits) return sym;
    }
  }
  return -1;
}

function reverseBits(val: number, bits: number): number {
  let rev = 0;
  for (let i = 0; i < bits; i++) {
    rev = (rev << 1) | (val & 1);
    val >>= 1;
  }
  return rev;
}

const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function decodeDynamicTables(readBits: (n: number) => number): {
  litTable: HuffmanTable;
  distTable: HuffmanTable;
} {
  const hlit = readBits(5) + 257;
  const hdist = readBits(5) + 1;
  const hclen = readBits(4) + 4;

  // Read code length code lengths
  const clLengths = new Array(19).fill(0) as number[];
  for (let i = 0; i < hclen; i++) {
    clLengths[CL_ORDER[i]!] = readBits(3);
  }

  const clTable = buildHuffmanTable(clLengths, 19);

  // Read literal/length + distance code lengths
  const totalCodes = hlit + hdist;
  const codeLengths = new Array(totalCodes).fill(0) as number[];
  let i = 0;

  while (i < totalCodes) {
    const sym = slowDecode(readBits, clTable);
    if (sym < 0) break;

    if (sym < 16) {
      codeLengths[i++] = sym;
    } else if (sym === 16) {
      const repeat = readBits(2) + 3;
      const prev = i > 0 ? codeLengths[i - 1]! : 0;
      for (let j = 0; j < repeat && i < totalCodes; j++) {
        codeLengths[i++] = prev;
      }
    } else if (sym === 17) {
      const repeat = readBits(3) + 3;
      for (let j = 0; j < repeat && i < totalCodes; j++) {
        codeLengths[i++] = 0;
      }
    } else if (sym === 18) {
      const repeat = readBits(7) + 11;
      for (let j = 0; j < repeat && i < totalCodes; j++) {
        codeLengths[i++] = 0;
      }
    }
  }

  return {
    litTable: buildHuffmanTable(codeLengths.slice(0, hlit), hlit),
    distTable: buildHuffmanTable(codeLengths.slice(hlit), hdist),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
