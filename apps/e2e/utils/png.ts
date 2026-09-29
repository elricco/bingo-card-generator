import zlib from "node:zlib";

export interface Pixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

const CHANNELS_BY_COLOR_TYPE: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/**
 * Minimaler PNG-Dekoder für 8-Bit, nicht-interlaced PNGs (genau das Format, das
 * Chromiums page.screenshot() liefert). Wird verwendet, um in E2E-Tests einzelne
 * Pixel (inkl. Alpha-Kanal) aus einem Screenshot-Buffer auszulesen, ohne eine
 * externe Abhängigkeit wie `pngjs` einzuführen.
 */
export function readPngPixel(buffer: Buffer, x: number, y: number): Pixel {
  if (buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new Error("Kein gültiges PNG (Signatur fehlt)");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      const interlace = data.readUInt8(12);
      if (interlace !== 0) {
        throw new Error("Interlaced PNGs werden nicht unterstützt");
      }
    } else if (type === "IDAT") {
      idatChunks.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }

    offset += 8 + length + 4; // length(4) + type(4) + data + crc(4)
  }

  if (bitDepth !== 8) {
    throw new Error(`Nicht unterstützte Bit-Tiefe: ${bitDepth}`);
  }
  const channels = CHANNELS_BY_COLOR_TYPE[colorType];
  if (!channels) {
    throw new Error(`Nicht unterstützter Farbtyp: ${colorType}`);
  }
  if (x < 0 || x >= width || y < 0 || y >= height) {
    throw new Error(`Pixel (${x}, ${y}) liegt außerhalb des Bildes (${width}x${height})`);
  }

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const bytesPerPixel = channels;
  const stride = width * bytesPerPixel;
  const out = Buffer.alloc(height * stride);

  let rawOffset = 0;
  let prevRowStart = -1;
  for (let row = 0; row < height; row++) {
    const filterType = raw[rawOffset];
    rawOffset += 1;
    const rowStart = row * stride;

    for (let i = 0; i < stride; i++) {
      const rawByte = raw[rawOffset + i];
      const a = i >= bytesPerPixel ? out[rowStart + i - bytesPerPixel] : 0;
      const b = prevRowStart >= 0 ? out[prevRowStart + i] : 0;
      const c = prevRowStart >= 0 && i >= bytesPerPixel ? out[prevRowStart + i - bytesPerPixel] : 0;

      let value: number;
      switch (filterType) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = (rawByte + a) & 0xff;
          break;
        case 2:
          value = (rawByte + b) & 0xff;
          break;
        case 3:
          value = (rawByte + Math.floor((a + b) / 2)) & 0xff;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          value = (rawByte + predictor) & 0xff;
          break;
        }
        default:
          throw new Error(`Nicht unterstützter Filtertyp: ${filterType}`);
      }
      out[rowStart + i] = value;
    }

    prevRowStart = rowStart;
    rawOffset += stride;
  }

  const pixelStart = y * stride + x * bytesPerPixel;
  switch (colorType) {
    case 6: // RGBA
      return {
        r: out[pixelStart],
        g: out[pixelStart + 1],
        b: out[pixelStart + 2],
        a: out[pixelStart + 3],
      };
    case 2: // RGB, kein Alpha-Kanal -> vollständig deckend
      return { r: out[pixelStart], g: out[pixelStart + 1], b: out[pixelStart + 2], a: 255 };
    case 4: // Graustufen + Alpha
      return { r: out[pixelStart], g: out[pixelStart], b: out[pixelStart], a: out[pixelStart + 1] };
    default: // 0: Graustufen, kein Alpha
      return { r: out[pixelStart], g: out[pixelStart], b: out[pixelStart], a: 255 };
  }
}
