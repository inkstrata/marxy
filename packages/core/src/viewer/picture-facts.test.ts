import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { imageFactsFromBytes } from './image-facts.ts';
import { PSD_NO_PREVIEW, SVGZ_TOO_LARGE } from './picture-facts.ts';

// The samples are built by fixtures/pictures/make-pictures.mjs; the Rust facts read the same files (src-tauri facts/tests.rs).
const sample = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../../fixtures/pictures/${name}`, import.meta.url)));
const gunzip = async (packed: Uint8Array, cap: number): Promise<Uint8Array | null> => {
  try {
    return new Uint8Array(gunzipSync(packed, { maxOutputLength: cap + 1 }));
  } catch (e) {
    // Past the cap: as the shell's reader, one byte more than the cap says there is more.
    return (e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' ? new Uint8Array(cap + 1) : null;
  }
};
const facts = (name: string) => imageFactsFromBytes(sample(name), { extension: name.slice(name.lastIndexOf('.') + 1), gunzip });

test('the PNM family, farbfeld, DDS and PSD give their size, depth and channels', async () => {
  for (const [name, format, depth, channels] of [
    ['tiny.pbm', 'pbm', 1, 'Gray'],
    ['tiny.pgm', 'pgm', 16, 'Gray'],
    ['tiny.ppm', 'ppm', 8, 'RGB'],
    ['tiny.pam', 'pam', 8, 'RGBA'],
    ['tiny.ff', 'farbfeld', 16, 'RGBA'],
    ['tiny.dds', 'dds', 8, 'RGB'],
    ['preview.psd', 'psd', 8, 'RGB'],
    ['thumb.psd', 'psd', 8, 'RGB'],
  ] as const) {
    const f = await facts(name);
    assert.deepEqual([f?.format, f?.width, f?.height, f?.bitDepth, f?.channels], [format, 8, 4, depth, channels], name);
    // No browser draws these: the card says so.
    assert.equal(f?.show, 'none', name);
    assert.match(f?.why ?? '', new RegExp(`cannot draw ${format.toUpperCase()}`), name);
  }
});

test('an SVGZ is sized from the SVG it unpacks to', async () => {
  const f = await facts('tiny.svgz');
  assert.deepEqual([f?.format, f?.width, f?.height], ['svgz', 120, 80]);
  assert.equal((await imageFactsFromBytes(sample('tiny.svgz'), { extension: 'gz', gunzip })), null, 'a lone gzip is no picture');
});

test('what is not drawn after all says why, as the Rust facts do', async () => {
  for (const [name, says] of [
    ['bare.psd', PSD_NO_PREVIEW],
    ['oversized.psd', 'This Photoshop file is damaged: its image resources run past the end of the file.'],
    ['truncated.dds', 'This DDS is cut short: it holds 136 bytes of the 144 its first image needs.'],
    ['bc7.dds', 'This DDS is compressed as BC7; Marxy draws only BC1 to BC3 (DXT1, DXT3, DXT5).'],
    ['bomb.svgz', SVGZ_TOO_LARGE],
  ] as const) {
    const f = await facts(name);
    assert.equal(f?.show, 'none', name);
    assert.equal(f?.why, says, name);
  }
});

test('every cut of a DDS and a PSD reads without a throw', async () => {
  for (const name of ['tiny.dds', 'preview.psd', 'thumb.psd', 'oversized.psd', 'tiny.pam']) {
    const bytes = sample(name);
    for (let n = 0; n <= bytes.length; n++) await imageFactsFromBytes(bytes.subarray(0, n));
  }
});

test('a text file that only starts with P and a digit is no PNM', async () => {
  assert.equal(await imageFactsFromBytes(new TextEncoder().encode('P1 is the first point.\n')), null);
});

test('a DDS header the decoder refuses is refused here too, a caps-only DXT1 among them', async () => {
  const patched = (at: number, v: number): Uint8Array => {
    const b = sample('tiny.dds').slice();
    new DataView(b.buffer).setUint32(at, v, true);
    return b;
  };
  for (const [bytes, says] of [
    [patched(8, 0x1), /lack the caps, height, width or pixel format/],
    [patched(8, 0x1007 | 0x40), /name ones it does not know/],
    [patched(76, 24), /pixel format block says 24 bytes/],
  ] as const) {
    const f = await imageFactsFromBytes(bytes);
    assert.equal(f?.show, 'none');
    assert.match(f?.why ?? '', says);
  }
});

test('a PSD drawn from its thumbnail is sized as the desktop draws it, and says so', async () => {
  const sized = (w: number, h: number): Uint8Array => {
    const b = sample('thumb.psd').slice();
    const v = new DataView(b.buffer);
    v.setUint32(14, h);
    v.setUint32(18, w);
    return b;
  };
  for (const [w, h, shown, says] of [
    [16, 8, [16, 8], /enlarged to the file's size/],
    [12_000, 9_000, [8, 4], /at its own 8 by 4: the file is 12000 by 9000/],
    [24, 4, [8, 4], /at its own 8 by 4/],
  ] as const) {
    const f = await imageFactsFromBytes(sized(w, h));
    assert.deepEqual([f?.width, f?.height], shown, `${w}x${h}`);
    assert.match(f?.note ?? '', says);
  }
  assert.equal((await facts('preview.psd'))?.note, undefined);
});
