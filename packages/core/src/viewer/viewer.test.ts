// The floor and the image page's arithmetic, and the facts read from the demo's own
// images (fixtures/demo/images).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { firstBytes, magicOf, sizeWords, textTest } from './bytes.ts';
import { HEX_MAX_SPACE_PX, HEX_ROW_PX, byteAsText, byteValues, firstRowAt, hexGeometry, parseOffset, scrollTopFor } from './hex.ts';
import { ZOOMS, fitScale, gridShown, orientedSize, pixelsSquare, readoutShown, stepZoom } from './image.ts';
import { imageFactsFromBytes, imageFormatOf, svgFacts, svgScripts } from './image-facts.ts';

const demo = (p: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../../fixtures/demo/${p}`, import.meta.url)));
const inflate = async (u: Uint8Array): Promise<Uint8Array> => new Uint8Array(inflateSync(u));

test('sizes are said in binary units with the exact count beside', () => {
  assert.equal(sizeWords(418), '418 bytes');
  assert.equal(sizeWords(1), '1 byte');
  assert.equal(sizeWords(49_152), '48.0 KB · 49,152 bytes');
  assert.equal(sizeWords(33_057), '32.3 KB · 33,057 bytes');
  assert.equal(sizeWords(2_147_483_648), '2.0 GB · 2,147,483,648 bytes');
});

test('the head: first bytes, the text test, and the magic the app knows', () => {
  const tmk = demo('cache/index.tmk');
  assert.deepEqual(firstBytes(tmk), { hex: '54 4D 4B 31 02 00 00 00', text: 'TMK1····' });
  assert.equal(magicOf(tmk), null, 'TMK1 is no format the app knows');
  const t = textTest(tmk.subarray(0, 4096));
  assert.ok(t.nul > 0 && t.odd > 0.05, 'NUL bytes and bytes outside printable text: not text');
  assert.equal(magicOf(demo('images/tidemark-icon.png'))?.len, 8);
  assert.equal(magicOf(demo('images/IMG_0417.heic'))?.format, 'HEIC');
  assert.equal(magicOf(demo('images/IMG_0417.heic'))?.name, 'an ftyp box of brand heic');
  assert.equal(magicOf(demo('downloads/IMG_2231'))?.name, 'RIFF, then WEBP');
  const gpt = new Uint8Array(1024);
  gpt[510] = 0x55;
  gpt[511] = 0xaa;
  gpt.set(new TextEncoder().encode('EFI PART'), 512);
  assert.equal(magicOf(gpt)?.format, 'a GPT disk');
});

test('the hex view maps one scrollbar over 2 GB and reaches the last byte', () => {
  const size = 2 ** 31;
  const g = hexGeometry(size, 16);
  assert.equal(g.rows, size / 16);
  assert.ok(g.proportional);
  assert.equal(g.space, HEX_MAX_SPACE_PX);
  const view = 800;
  // At the bottom of the scroll space, the last row is on screen.
  const first = firstRowAt(g, g.space - view, view);
  assert.ok(first + Math.floor(view / HEX_ROW_PX) >= g.rows, 'the last row is in view at the end');
  // Going to a row and reading the row back lands within a row of it.
  for (const row of [0, 1000, g.rows / 2, g.rows - 1]) {
    const top = scrollTopFor(g, row, view);
    const back = firstRowAt(g, top, view);
    assert.ok(back <= row && row < back + Math.floor(view / HEX_ROW_PX), `row ${row} is on screen after going to it (first ${back})`);
  }
  // A small file scrolls row by row.
  const small = hexGeometry(49_152, 16);
  assert.equal(small.proportional, false);
  assert.equal(firstRowAt(small, 22 * 10, view), 10);
});

test('Go to reads hex and decimal, and names only bytes of the file', () => {
  assert.equal(parseOffset('0x1F00', 10_000), 0x1f00);
  assert.equal(parseOffset('1f00', 10_000), 0x1f00);
  assert.equal(parseOffset('8000', 10_000), 8000);
  assert.equal(parseOffset('8,000', 10_000), 8000);
  assert.equal(parseOffset('10000', 10_000), null);
  assert.equal(parseOffset('x', 10_000), null);
  assert.equal(parseOffset('', 10_000), null);
});

test('a byte picked reads as itself, two bytes and four', () => {
  const v = byteValues(new Uint8Array([0x21, 0x00, 0x70, 0x72]));
  assert.equal(v.value, 0x21);
  assert.equal(v.le16, 33);
  assert.equal(v.be16, 8448);
  assert.equal(v.le32, 0x72700021);
  assert.equal(byteValues(new Uint8Array([7])).le16, null);
  assert.equal(byteAsText(0x21), '“!”');
  assert.equal(byteAsText(0), 'NUL');
});

test('fit never enlarges; pixels square from 300 %, grid past 800 %, readout from 400 %', () => {
  assert.equal(fitScale(1000, 800, 32, 32), 1);
  assert.equal(fitScale(480, 320, 960, 640), 0.5);
  assert.equal(stepZoom(1, 1), 1.5);
  assert.equal(stepZoom(1, -1), 0.75);
  assert.equal(stepZoom(32, 1), 32);
  assert.equal(stepZoom(0.1, -1), 0.1);
  assert.equal(stepZoom(0.6, 1), 0.75, 'from a fit between steps, the next step up');
  assert.ok(ZOOMS.includes(16));
  assert.equal(pixelsSquare(2), false);
  assert.equal(pixelsSquare(3), true);
  assert.equal(gridShown(8), false);
  assert.equal(gridShown(12), true);
  assert.equal(readoutShown(3), false);
  assert.equal(readoutShown(4), true);
});

test('orientation: a quarter turn swaps the sides the image is drawn at, and nothing else', () => {
  assert.deepEqual(orientedSize(640, 480, 6), { w: 480, h: 640 });
  assert.deepEqual(orientedSize(640, 480, 8), { w: 480, h: 640 });
  assert.deepEqual(orientedSize(640, 480, 3), { w: 640, h: 480 });
  assert.deepEqual(orientedSize(640, 480, 1), { w: 640, h: 480 });
});

test('facts from the bytes: the demo PNG, the rotated JPEG, the animated GIF, the WebP and the SVG', async () => {
  const icon = await imageFactsFromBytes(demo('images/tidemark-icon.png'), { inflate });
  assert.equal(icon?.format, 'png');
  assert.deepEqual([icon?.width, icon?.height, icon?.bitDepth, icon?.channels, icon?.show], [32, 32, 8, 'RGBA', 'webview']);

  const chart = await imageFactsFromBytes(demo('images/tide-chart.png'), { inflate });
  assert.deepEqual([chart?.width, chart?.height, chart?.channels], [900, 560, 'RGBA']);
  assert.ok(chart?.colorProfile, 'its embedded profile is named');

  const ribs = await imageFactsFromBytes(demo('images/boat-ribs.jpg'));
  assert.deepEqual([ribs?.format, ribs?.width, ribs?.height, ribs?.orientation, ribs?.channels], ['jpeg', 640, 480, 6, 'RGB'], 'stored 640 × 480, orientation 6');

  const harbour = await imageFactsFromBytes(demo('images/harbour-at-low-water.jpg'));
  assert.equal(harbour?.exif?.camera, 'FUJIFILM X-T30 II');
  assert.equal(harbour?.exif?.exposure, '1/250 s');
  assert.equal(harbour?.exif?.aperture, 'f/5.6');
  assert.equal(harbour?.exif?.iso, 200);
  assert.equal(harbour?.exif?.focalLength, '23 mm');
  assert.match(harbour?.exif?.taken ?? '', /^2026:10:12 07:41:09$/);
  assert.ok(harbour?.location && Math.abs(harbour.location.lat - 50.10281) < 1e-4 && harbour.location.lon < 0, 'the place is read, west negative');

  const buoy = await imageFactsFromBytes(demo('images/buoy.gif'));
  assert.deepEqual([buoy?.format, buoy?.width, buoy?.height, buoy?.frames, buoy?.channels], ['gif', 96, 96, 4, 'Indexed']);

  const ferry = await imageFactsFromBytes(demo('downloads/IMG_2231'));
  assert.deepEqual([ferry?.format, ferry?.width, ferry?.height], ['webp', 640, 400], 'a WebP with no extension, read from its bytes');

  const sketch = demo('images/sketch.svg');
  assert.equal(imageFormatOf(sketch), 'svg');
  const svg = await imageFactsFromBytes(sketch);
  assert.deepEqual([svg?.format, svg?.width, svg?.height, svg?.bitDepth], ['svg', 240, 160, null]);
  assert.equal(svgScripts(new TextDecoder().decode(sketch)), 2, 'a <script> and an onload: counted, never run');
  assert.equal(svgFacts('<svg width="12px" height="7"/>')?.width, 12);

  const heic = await imageFactsFromBytes(demo('images/IMG_0417.heic'), { system: 'Windows' });
  assert.equal(heic?.format, 'heic');
  assert.equal(heic?.show, 'none');
  assert.match(heic?.why ?? '', /cannot draw HEIC: Windows has no decoder/);

  assert.equal(await imageFactsFromBytes(demo('cache/index.tmk')), null, 'not an image the reader knows');
});

const tauri = (p: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../../apps/desktop/src-tauri/${p}`, import.meta.url)));

test('HEIF and AVIF give the primary item size from ispe, cropped by clap; a truncated one gives none', async () => {
  const avif = await imageFactsFromBytes(tauri('tests/fixtures/images/tiny.avif'));
  assert.deepEqual([avif?.format, avif?.width, avif?.height, avif?.show], ['avif', 6, 4, 'webview']);
  const heic = tauri('src/decode/probe.heic');
  const f = await imageFactsFromBytes(heic, { system: 'this browser', windows: true });
  assert.deepEqual([f?.format, f?.width, f?.height, f?.bitDepth, f?.channels, f?.orientation], ['heic', 64, 32, 8, 'RGB', 1]);
  assert.equal(f?.show, 'none');
  assert.match(f?.why ?? '', /HEIF Image Extension and the HEVC Video Extension from the Microsoft Store/);
  const elsewhere = await imageFactsFromBytes(heic, { system: 'this browser' });
  assert.match(elsewhere?.why ?? '', /this browser has no decoder/);
  for (const cut of [12, 40, 200, 300]) {
    const partial = await imageFactsFromBytes(heic.subarray(0, cut));
    assert.deepEqual([partial?.format, partial?.width, partial?.height], ['heic', 0, 0], `cut at ${cut}`);
  }
});

test('malformed images are partial or null, never a throw', async () => {
  for (const cut of [1, 8, 12, 24, 40, 100]) {
    for (const p of ['images/tidemark-icon.png', 'images/boat-ribs.jpg', 'images/buoy.gif', 'images/ferry.webp']) {
      const bytes = demo(p).subarray(0, cut);
      await imageFactsFromBytes(bytes);
    }
  }
  const junk = new Uint8Array(4096).map((_, i) => (i * 7919) & 255);
  junk.set([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff], 0);
  await imageFactsFromBytes(junk);
});
