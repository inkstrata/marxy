// Writes the picture samples beside this script: one tiny file per format the shell decodes (PNM family, farbfeld, DDS,
// SVGZ, PSD), each 8 x 4 with red on the left and blue on the right where the format has colour, and the damaged ones
// the readers must refuse without a panic. Run `node fixtures/pictures/make-pictures.mjs`; the output is committed.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = fileURLToPath(new URL('.', import.meta.url));
const W = 8;
const H = 4;
const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const colour = (x) => (x < W / 2 ? RED : BLUE);

const u16be = (n) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
const u32be = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const u16le = (n) => Buffer.from([n & 0xff, (n >> 8) & 0xff]);
const u32le = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const write = (name, bytes) => writeFileSync(join(here, name), bytes);

// PNM family: a 1-bit bitmap (black left), a 16-bit grey (dark left), RGB with a comment in its header, and PAM with alpha.
const pixels = (fn) => Buffer.concat(Array.from({ length: H }, () => Buffer.concat(Array.from({ length: W }, (_, x) => fn(x)))));
write('tiny.pbm', Buffer.concat([Buffer.from(`P4\n${W} ${H}\n`), Buffer.alloc(H, 0xf0)]));
write('tiny.pgm', Buffer.concat([Buffer.from(`P5\n${W} ${H}\n65535\n`), pixels((x) => u16be(x < W / 2 ? 0x0800 : 0xf000))]));
write('tiny.ppm', Buffer.concat([Buffer.from(`P6\n# red, then blue\n${W} ${H}\n255\n`), pixels((x) => Buffer.from(colour(x)))]));
write('tiny.pam', Buffer.concat([Buffer.from(`P7\nWIDTH ${W}\nHEIGHT ${H}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`), pixels((x) => Buffer.from([...colour(x), 255]))]));

// farbfeld: 16 bits a channel, RGBA, big-endian.
write('tiny.ff', Buffer.concat([Buffer.from('farbfeld'), u32be(W), u32be(H), pixels((x) => Buffer.concat([...colour(x), 255].map((c) => u16be(c * 257))))]));

// DDS, BC1 (DXT1): two 4 x 4 blocks, both with red as colour 0 and blue as colour 1; the left block picks 0, the right 1.
const ddsHeader = (fourcc, dx10) => {
  const pf = Buffer.concat([u32le(32), u32le(0x4), Buffer.from(fourcc), Buffer.alloc(20)]);
  const header = Buffer.concat([u32le(124), u32le(0x1 | 0x2 | 0x4 | 0x1000 | 0x80000), u32le(H), u32le(W), u32le(16), u32le(0), u32le(0), Buffer.alloc(44), pf, u32le(0x1000), Buffer.alloc(16)]);
  return Buffer.concat([Buffer.from('DDS '), header, dx10 ?? Buffer.alloc(0)]);
};
const block = (index) => Buffer.concat([u16le(0xf800), u16le(0x001f), Buffer.alloc(4, index)]);
const dds = Buffer.concat([ddsHeader('DXT1'), block(0x00), block(0x55)]);
write('tiny.dds', dds);
write('truncated.dds', dds.subarray(0, 128 + 8));
// BC7 behind a DX10 header (DXGI format 98), which the decoder does not draw.
write('bc7.dds', Buffer.concat([ddsHeader('DX10', Buffer.concat([u32le(98), u32le(3), u32le(0), u32le(1), u32le(0)])), Buffer.alloc(32)]));

// SVGZ: an SVG with a script that never runs, gzipped; and a bomb that unpacks to 20 MB of spaces.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="60" height="80" fill="#f00"/><rect x="60" width="60" height="80" fill="#00f"/><script>document.title = 'ran'</script></svg>\n`;
write('tiny.svgz', gzipSync(Buffer.from(svg), { level: 9 }));
write('bomb.svgz', gzipSync(Buffer.concat([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'), Buffer.alloc(20 * 1024 * 1024, 0x20), Buffer.from('</svg>')]), { level: 9 }));

// PSD: header, colour mode data, image resources, layer and mask information, then the flattened (composite) image.
const pascalName = Buffer.from([0, 0]);
const resource = (id, data) => Buffer.concat([Buffer.from('8BIM'), u16be(id), pascalName, u32be(data.length), data, Buffer.alloc(data.length & 1)]);
// 1057, version info: its fifth byte says whether the flattened image is real (Photoshop's Maximize Compatibility).
const versionInfo = (merged) => resource(1057, Buffer.concat([u32be(1), Buffer.from([merged ? 1 : 0]), u32be(0), u32be(0), u32be(1)]));
// 1036, the thumbnail: a JPEG behind a 28-byte header.
const thumbnail = (jpeg, w, h) => {
  const rowBytes = Math.floor((w * 24 + 31) / 32) * 4;
  return resource(1036, Buffer.concat([u32be(1), u32be(w), u32be(h), u32be(rowBytes), u32be(rowBytes * h), u32be(jpeg.length), u16be(24), u16be(1), jpeg]));
};
// PackBits, one run per half row: -(n - 1) then the byte.
const rleRow = (left, right) => Buffer.from([257 - W / 2, left, 257 - W / 2, right]);
const composite = (rle) => {
  const planes = [0, 1, 2].map((c) => Array.from({ length: H }, () => [RED[c], BLUE[c]]));
  if (!rle) return Buffer.concat([u16be(0), ...planes.flatMap((rows) => rows.map(([l, r]) => Buffer.concat([Buffer.alloc(W / 2, l), Buffer.alloc(W / 2, r)])))]);
  const rows = planes.flatMap((rows) => rows.map(([l, r]) => rleRow(l, r)));
  return Buffer.concat([u16be(1), ...rows.map((r) => u16be(r.length)), ...rows]);
};
const psd = (resources, image, resourcesLength) => {
  const res = Buffer.concat(resources);
  return Buffer.concat([Buffer.from('8BPS'), u16be(1), Buffer.alloc(6), u16be(3), u32be(H), u32be(W), u16be(8), u16be(3), u32be(0), u32be(resourcesLength ?? res.length), res, u32be(0), image]);
};
const jpeg = readFileSync(join(here, '..', '..', 'apps', 'desktop', 'src-tauri', 'tests', 'fixtures', 'images', 'rotated.jpg'));
write('preview.psd', psd([versionInfo(true)], composite(true)));
write('raw.psd', psd([], composite(false)));
write('thumb.psd', psd([versionInfo(false), thumbnail(jpeg, 8, 4)], composite(false)));
write('bare.psd', psd([versionInfo(false)], composite(false)));
write('oversized.psd', psd([versionInfo(true)], composite(true), 0x7ffffff0));
