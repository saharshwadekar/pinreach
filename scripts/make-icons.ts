// Draws the PinReach icon (white map pin on a blue rounded square) as PNGs.
// Run: bun run icons   → src/icons/icon{16,32,48,128}.png
import { deflateSync } from "node:zlib";
import { mkdir } from "node:fs/promises";

const BG = [37, 99, 235]; // #2563eb
const FG = [255, 255, 255];

/** Coverage of the shapes at a point in unit space (0..1). */
function shade(x: number, y: number): { bg: boolean; pin: boolean } {
  // Rounded square background.
  const r = 0.22;
  const qx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0);
  const qy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
  const bg = Math.hypot(qx, qy) <= r;

  // Map pin: a circle head plus a cone down to the tip, with a hole in the head.
  const cx = 0.5, cy = 0.42, head = 0.24, tipY = 0.85, hole = 0.095;
  const d = Math.hypot(x - cx, y - cy);
  const inCone = y >= cy && y <= tipY && Math.abs(x - cx) <= head * (1 - (y - cy) / (tipY - cy)) * 1.05;
  const pin = (d <= head || inCone) && d > hole;
  return { bg, pin };
}

function render(size: number): Uint8Array {
  const SS = 4; // 4×4 supersampling for smooth edges
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // PNG filter: none
    for (let px = 0; px < size; px++) {
      let a = 0, fg = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const s = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          if (s.bg) a++;
          if (s.bg && s.pin) fg++;
        }
      const n = SS * SS;
      const t = a ? fg / a : 0;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(BG[c]! * (1 - t) + FG[c]! * t);
      raw[o + 3] = Math.round((a / n) * 255);
    }
  }
  return raw;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function png(size: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, size);
  v.setUint32(4, size);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(render(size), { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ];
  return Buffer.concat(parts);
}

const dir = new URL("../src/icons/", import.meta.url);
await mkdir(dir, { recursive: true });
for (const size of [16, 32, 48, 128]) await Bun.write(new URL(`icon${size}.png`, dir), png(size));
console.log("Wrote src/icons/icon{16,32,48,128}.png");
