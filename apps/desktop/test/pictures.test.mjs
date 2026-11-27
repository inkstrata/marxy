// The pictures the shell decodes beyond the web's formats: the PNM family, farbfeld, DDS, a Photoshop file's own preview
// and SVGZ. The browser build draws none of them, so each is the file card naming the format, with its size and depth
// read from its bytes and the hex view beside; what is not drawn after all (a PSD saved without a preview, one with a
// resource longer than its file, a DDS cut short, a gzip bomb) says why. The desktop draws them (tauri-check.mjs).
// The samples are built by fixtures/pictures/make-pictures.mjs. Playwright WebKit.
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const pictures = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'pictures');
const FILES = {
  '/r/README.md': '# Here\n',
  ...Object.fromEntries(
    readdirSync(pictures)
      .filter((n) => !n.endsWith('.mjs'))
      .map((n) => [`/r/pics/${n}`, readFileSync(join(pictures, n))]),
  ),
};

const open = async (page, path) => {
  await page.evaluate((p) => window.__marxyHandle.open(p), path);
  await page.waitForFunction((name) => document.querySelector('.marxy-viewer-mount:not([hidden]) .marxy-fcard-name')?.textContent === name, path.slice(path.lastIndexOf('/') + 1));
};
const card = (page) => page.innerText('.marxy-viewer-mount:not([hidden]) .marxy-fcard');
const factsOf = (page, path) =>
  page.evaluate(async (p) => {
    const f = await window.__marxyHandle.shell.imageFacts(p);
    return f && [f.format, f.width, f.height, f.bitDepth, f.channels];
  }, path);

test('each format is read as an image: the card names it, its facts give size and depth, Source is its bytes', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    for (const [name, words, facts] of [
      ['tiny.pbm', 'PBM', ['pbm', 8, 4, 1, 'Gray']],
      ['tiny.pgm', 'PGM', ['pgm', 8, 4, 16, 'Gray']],
      ['tiny.ppm', 'PPM', ['ppm', 8, 4, 8, 'RGB']],
      ['tiny.pam', 'PAM', ['pam', 8, 4, 8, 'RGBA']],
      ['tiny.ff', 'farbfeld', ['farbfeld', 8, 4, 16, 'RGBA']],
      ['tiny.dds', 'DDS', ['dds', 8, 4, 8, 'RGB']],
      ['preview.psd', 'Photoshop (PSD)', ['psd', 8, 4, 8, 'RGB']],
      ['tiny.svgz', 'SVGZ', ['svgz', 120, 80, null, null]],
    ]) {
      const path = `/r/pics/${name}`;
      await open(page, path);
      assert.equal(await page.textContent('.marxy-viewer-mount:not([hidden]) .marxy-fcard-kicker'), 'An image this system cannot draw', name);
      assert.match(await card(page), new RegExp(`an image, ${words.replace(/[()]/g, '\\$&')}`), name);
      assert.match(await card(page), /This browser|this browser/, name);
      assert.deepEqual(await factsOf(page, path), facts, name);
    }
    await page.click('.marxy-rs-source');
    await page.waitForSelector('.marxy-hexpage');
    assert.match(await page.textContent('.marxy-hexbar-what'), /162 bytes/);
    // The SVGZ's script is never run: the browser build never even unpacks it into the page.
    assert.notEqual(await page.title(), 'ran');
  });
});

// A PNG's signature and header with no image data: its facts say the web view draws it, and the drawing fails.
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const n = Buffer.alloc(4);
  n.writeUInt32BE(data.length);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(body));
  return Buffer.concat([n, body, c]);
};
const ihdr = Buffer.from([0, 0, 0, 8, 0, 0, 0, 4, 8, 2, 0, 0, 0]);
const CUT = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)]);

test('an image of a format this system draws that does not draw blames the file, not the system', async () => {
  await withFrame({ files: { ...FILES, '/r/pics/cut.png': CUT }, open: ['/r/README.md'] }, async (page) => {
    await open(page, '/r/pics/cut.png');
    assert.equal(await page.textContent('.marxy-viewer-mount:not([hidden]) .marxy-fcard-kicker'), 'An image that would not draw');
    assert.match(await card(page), /This system draws PNG images, but not this one: the file may be damaged or cut short\./);
    assert.doesNotMatch(await card(page), /This system could not draw it/);
  });
});

test('a PSD saved without a preview says so and offers the bytes; damaged files say why', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await open(page, '/r/pics/bare.psd');
    assert.match(await card(page), /saved without a preview: it holds no thumbnail/);
    assert.match(await card(page), /an image, Photoshop \(PSD\)/);
    await page.click('.marxy-rs-source');
    await page.waitForSelector('.marxy-hexpage');
    assert.match(await page.textContent('.marxy-hexbar-what'), /166 bytes/);
    await page.click('.marxy-rs-read');
    for (const [name, says] of [
      ['oversized.psd', /damaged: its image resources run past the end of the file/],
      ['truncated.dds', /cut short: it holds 136 bytes of the 144 its first image needs/],
      ['bc7.dds', /compressed as BC7; Marxy draws only BC1 to BC3/],
      ['bomb.svgz', /unpacks to more than 16 MB, past the most Marxy unpacks/],
    ]) {
      await open(page, `/r/pics/${name}`);
      assert.match(await card(page), says, name);
    }
  });
});
