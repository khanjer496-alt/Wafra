/**
 * Re-encode an 8-bit PNG as 8-bit RGB with NO alpha channel.
 *
 * App Store Connect rejects screenshots that "include alpha channels or
 * transparencies" (Apple, Screenshot specifications). Chromium — and therefore
 * every Playwright `page.screenshot()` — always writes colour type 6, RGBA,
 * even when every pixel is fully opaque. The pixels are fine; the IHDR byte is
 * the thing that gets the upload bounced, and no amount of re-shooting fixes
 * it. So the buffer is decoded and written back out as colour type 2.
 *
 * This is hand-rolled on top of node:zlib on purpose. The only PNG codec in
 * this tree (`pngjs`) is not a declared dependency — it arrives four levels
 * down under `@expo/image-utils -> parse-png`, so a routine dependency bump
 * can delete it, and the failure would land on whoever is next trying to ship
 * a build. A store submission should not rest on a transitive.
 *
 * Scope is deliberately narrow: 8-bit, non-interlaced, colour type 2 or 6.
 * That is what Chromium emits. Anything else throws rather than guesses.
 */
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Paeth predictor, straight from the PNG spec. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** @returns {{ width: number, height: number, channels: number, pixels: Buffer }} */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');

  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];

  for (let off = 8; off + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const interlace = data[12];
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
      if (interlace !== 0) throw new Error('interlaced PNG not supported');
      if (colorType === 6) channels = 4;
      else if (colorType === 2) channels = 3;
      else throw new Error(`unsupported colour type ${colorType}`);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (!width || !height) throw new Error('PNG has no IHDR');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error('PNG image data is short');

  // Unfilter in place into a contiguous pixel buffer.
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = (y * (stride + 1)) + 1;
    const dst = y * stride;
    const up = dst - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const a = x >= channels ? pixels[dst + x - channels] : 0;
      const b = y > 0 ? pixels[up + x] : 0;
      const c = y > 0 && x >= channels ? pixels[up + x - channels] : 0;
      let out;
      switch (filter) {
        case 0: out = v; break;
        case 1: out = v + a; break;
        case 2: out = v + b; break;
        case 3: out = v + ((a + b) >> 1); break;
        case 4: out = v + paeth(a, b, c); break;
        default: throw new Error(`unknown row filter ${filter} on row ${y}`);
      }
      pixels[dst + x] = out & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * Encode RGB pixels as a colour-type-2 PNG.
 *
 * Rows are filtered adaptively by the spec's own minimum-sum-of-absolute-
 * differences heuristic. Filter 0 everywhere would be a third of the code and
 * roughly four times the file; these are 1320x2868 images and the store
 * listing carries a set of them.
 */
export function encodeRgbPng(width, height, rgb) {
  const stride = width * 3;
  const filtered = Buffer.alloc((stride + 1) * height);
  const candidate = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const dst = y * (stride + 1);
    const row = y * stride;
    const up = row - stride;
    let bestType = 0;
    let bestScore = Infinity;
    let best = null;

    for (const type of [0, 1, 2, 4]) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const v = rgb[row + x];
        const a = x >= 3 ? rgb[row + x - 3] : 0;
        const b = y > 0 ? rgb[up + x] : 0;
        const c = y > 0 && x >= 3 ? rgb[up + x - 3] : 0;
        let f;
        switch (type) {
          case 0: f = v; break;
          case 1: f = v - a; break;
          case 2: f = v - b; break;
          default: f = v - paeth(a, b, c); break;
        }
        f &= 0xff;
        candidate[x] = f;
        score += f < 128 ? f : 256 - f;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = type;
        best = Buffer.from(candidate);
      }
    }
    filtered[dst] = bestType;
    best.copy(filtered, dst + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour, no alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(filtered, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Drop the alpha channel from a PNG buffer.
 *
 * Composites over `background` rather than merely discarding A, so a partly
 * transparent pixel darkens toward the page colour instead of revealing
 * whatever RGB happened to sit under a zero alpha. Playwright screenshots are
 * opaque in practice, which makes this a no-op — but a silent no-op is the
 * right shape for a safety net.
 */
export function stripAlpha(buf, background = [255, 255, 255]) {
  const { width, height, channels, pixels } = decodePng(buf);
  if (channels === 3) return encodeRgbPng(width, height, pixels);

  const rgb = Buffer.alloc(width * height * 3);
  const [br, bg, bb] = background;
  for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3) {
    const a = pixels[i + 3];
    if (a === 255) {
      rgb[j] = pixels[i];
      rgb[j + 1] = pixels[i + 1];
      rgb[j + 2] = pixels[i + 2];
    } else {
      rgb[j] = Math.round((pixels[i] * a + br * (255 - a)) / 255);
      rgb[j + 1] = Math.round((pixels[i + 1] * a + bg * (255 - a)) / 255);
      rgb[j + 2] = Math.round((pixels[i + 2] * a + bb * (255 - a)) / 255);
    }
  }
  return encodeRgbPng(width, height, rgb);
}

/** Read width/height/colour type straight out of IHDR, for verification. */
export function readPngHeader(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24],
    colorType: buf[25],
  };
}
