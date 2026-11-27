// Audio and video: the webview's own player, never started on its own; the facts
// from the container's header in the Media and Tags cards; a WAV's waveform drawn from its samples, a click on it moving
// the player there; a codec the webview cannot play as a facts-only card with the way out, and "Facts only · cannot play
// here" in grey in the head as a tier. The recordings are the demo's (fixtures/demo/media, constructed
// samples); their facts are the native readers' (the memory shell answers for the demo's own). WebKit.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { cardText, cardsOf, showCardPanel, skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const demo = join(fileURLToPath(new URL('../../../', import.meta.url)), 'fixtures', 'demo', 'media');
const media = (name) => readFileSync(join(demo, name));
const xiph = (name) => readFileSync(join(demo, '..', '..', 'media', name));
const FILES = {
  '/r/README.md': '# Here\n',
  '/r/media/bell-buoy.wav': media('bell-buoy.wav'),
  '/r/media/ferry-leaving.mp4': media('ferry-leaving.mp4'),
  '/r/media/interview-prores.mov': media('interview-prores.mov'),
  // Constructed by fixtures/media/make-xiph.py; their facts are the native readers' too.
  '/r/media/chime.flac': xiph('chime.flac'),
  '/r/media/chime.opus': xiph('chime.opus'),
  '/r/media/harbor-bell.aiff': media('harbor-bell.aiff'),
  '/r/media/harbor-bell.mka': media('harbor-bell.mka'),
  // An ASF header's GUID and nothing the app reads: no facts, so only the extension says what it is.
  '/r/media/old-song.wma': new Uint8Array([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0, 0xaa, 0, 0x62, 0xce, 0x6c, ...new Array(120).fill(7)]),
  // An ftyp box and nothing a player can read after it: a player asked says it may, then fails.
  '/r/media/cut.mp4': new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31, ...new Array(400).fill(9)]),
};

/**
 * Opens `path` with the player's errors hidden: Playwright's WebKit on Windows says it can play WAV and H.264 and then
 * fails every source, having no media backend, so it stands in for a webview that plays by never reporting the error.
 */
async function openPlayable(page, path) {
  await page.evaluate(() => Object.defineProperty(HTMLMediaElement.prototype, 'error', { configurable: true, get: () => null }));
  await page.evaluate((p) => window.__marxyHandle.open(p), path);
}

const factsOf = async (page, id) => {
  await showCardPanel(page, id);
  return page.evaluate((id) => Object.fromEntries([...document.querySelectorAll(`.marxy-drawer [data-marxy-card="${id}"] .marxy-fact`)].map((e) => [e.children[0].textContent, e.children[1].textContent])), id);
};
const headSay = (page) =>
  page.evaluate(() => {
    const g = document.querySelector('[data-marxy-head="0"] .marxy-guess');
    return g && !g.hidden ? { text: g.textContent, tier: g.hasAttribute('data-marxy-tier') } : null;
  });

test('a WAV is the webview’s player, never started on its own, under a waveform drawn from its samples', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await openPlayable(page, '/r/media/bell-buoy.wav');
    await page.waitForSelector('[data-marxy-viewer="media"] audio.marxy-media-player');
    assert.equal(await page.textContent('.marxy-media-line'), 'WAV · PCM, 16-bit, mono, 22,050 Hz · 5.0 s');
    const player = () => page.$eval('audio.marxy-media-player', (a) => ({ autoplay: a.autoplay, paused: a.paused, controls: a.controls, preload: a.preload, at: a.currentTime }));
    assert.deepEqual(await player(), { autoplay: false, paused: true, controls: true, preload: 'metadata', at: 0 });
    // The waveform, read from the samples: three strikes of a bell, so ink at a third and two thirds across.
    await page.waitForSelector('.marxy-media-wave canvas');
    await page.waitForFunction(() => {
      const c = document.querySelector('.marxy-media-wave canvas');
      if (!c || c.width < 10) return false;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let ink = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
      return ink > c.width;
    });
    const columns = await page.evaluate(() => {
      const c = document.querySelector('.marxy-media-wave canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const tall = (x) => {
        let n = 0;
        for (let y = 0; y < c.height; y++) if (d[(y * c.width + x) * 4 + 3] > 0) n++;
        return n / c.height;
      };
      return [0.02, 0.05, 0.38, 0.45, 0.85].map((f) => tall(Math.floor(c.width * f)));
    });
    assert.ok(columns[0] < 0.1, `quiet before the first strike: ${columns}`);
    assert.ok(columns[1] > 0.4 && columns[3] > 0.4, `loud at the strikes: ${columns}`);
    assert.ok(columns[2] < columns[3], `the ring dies before the next strike: ${columns}`);
    assert.match(await page.textContent('.marxy-account-body'), /It never starts on its own, and where you stopped is not kept\.The waveform is read straight from the samples, which a WAV keeps as they are\./);
    // Still nothing plays: the page never starts the player.
    await page.waitForTimeout(400);
    assert.equal((await player()).paused, true);
    // A click on the waveform moves the player there.
    const box = await page.$eval('.marxy-media-wave', (w) => {
      const r = w.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    await page.mouse.click(box.x + box.w * 0.5, box.y + box.h / 2);
    const head = await page.$eval('.marxy-media-head', (h) => parseFloat(h.style.left));
    assert.ok(head > 40 && head < 60, `the line follows the player: ${head}%`);
    await page.$eval('audio.marxy-media-player', (a) => a.pause());
    // Metadata: Reading with its tiers, Tags from the file's own chunks, Facts; Outline: Media.
    assert.deepEqual((await cardsOf(page)).map((c) => c.title), ['Reading', 'Facts', 'Tags', 'Media']);
    const reading = await cardText(page, 'reading');
    assert.match(reading, /Shown as WAV audio/);
    assert.match(reading, /never starts on its own/);
    assert.equal(await page.textContent('.marxy-drawer .marxy-tiers li[data-marxy-here] b'), 'A player');
    const m = await factsOf(page, 'contents');
    assert.equal(m.container, 'RIFF WAVE');
    assert.equal(m.length, '5.0 s, from the data size and byte rate');
    assert.equal(m.audio, 'PCM · mono · 22,050 Hz · 16-bit');
    assert.equal(m['data rate'], '353 kbit/s over the whole file');
    assert.equal(m.plays, 'in the webview');
    const tags = await factsOf(page, 'frontmatter');
    assert.deepEqual(tags, { title: 'Bell buoy, outer channel INAM', artist: 'Reader lab (constructed) IART', made: '2026-10-12 ICRD', software: 'make-mail-media.py ISFT' });
    assert.equal(await headSay(page), null);
    const exports = await page.evaluate(() => window.__marxyHandle.panes().focused.content.viewer().exports('rendered').map((e) => e.name));
    assert.deepEqual(exports, ['The file, as it is']);
    // Source is the bytes: the hex view from RIFF, and the player gone from the page.
    await page.click('.marxy-rs-source');
    await page.waitForFunction(() => document.querySelector('.marxy-hexrow .marxy-hex-b i')?.textContent === '52');
    assert.equal(await page.$('audio.marxy-media-player'), null);
  });
});

test('an MP4 says its codecs, size and an average rate for a recording, and plays where the webview has the codec', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await openPlayable(page, '/r/media/ferry-leaving.mp4');
    await page.waitForSelector('[data-marxy-viewer="media"] .marxy-media-line');
    assert.equal(await page.textContent('.marxy-media-line'), 'MP4 · H.264 (AVC), 640 × 360, about 18 frames a second · AAC (mp4a), stereo, 48,000 Hz · 4.2 s');
    const m = await factsOf(page, 'contents');
    assert.equal(m.container, 'ISO base media (MP4), fragmented · brand isom');
    assert.equal(m.length, '4.2 s, from the movie header');
    assert.equal(m.video, 'H.264 (AVC) (“AVC1 Coding”) · 640 × 360 · 76 frames, about 18.3 a second: a recording, with no fixed rate');
    assert.equal(m.audio, 'AAC (mp4a) · stereo · 48,000 Hz');
    assert.equal(m.boxes, 'ftyp moov moof mdat moof mdat mfra · the index first, so it starts at once');
    // This WebKit may or may not have H.264: either way the page says which, plainly.
    const can = await page.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.42C01F, mp4a.40.2"') !== '');
    if (can) {
      await page.waitForSelector('video.marxy-media-player');
      assert.deepEqual(await page.$eval('video.marxy-media-player', (v) => [v.autoplay, v.paused, v.controls]), [false, true, true]);
      assert.equal(await page.$('.marxy-media-wave'), null, 'a video has no waveform');
    } else {
      await page.waitForSelector('.marxy-media-noplay');
      assert.equal(m.plays, 'not here: no decoder for it');
    }
  });
});

/** Opens `path` with the webview's `canPlayType` answering `answer` to everything, and the types it was asked kept on `window.__asked`. */
async function openAnswering(page, path, answer) {
  await page.evaluate((a) => {
    window.__asked = [];
    HTMLMediaElement.prototype.canPlayType = (t) => {
      window.__asked.push(t);
      return a;
    };
  }, answer);
  if (answer === '') await page.evaluate((p) => window.__marxyHandle.open(p), path);
  else await openPlayable(page, path);
}

test('one file follows what the webview says it can play: no gives the card, maybe gives the player', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await openAnswering(page, '/r/media/chime.opus', '');
    await page.waitForSelector('[data-marxy-viewer="media"] .marxy-media-noplay');
    assert.equal(await page.$('audio'), null, 'no dead player');
    assert.equal(await page.textContent('.marxy-media-title'), 'This system cannot play Opus in an .opus');
  });
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await openAnswering(page, '/r/media/chime.opus', 'maybe');
    await page.waitForSelector('audio.marxy-media-player');
    assert.equal(await page.$('.marxy-media-noplay'), null);
  });
});

test('an AIFF and an MKA open as media with their facts, and are asked about as what they are', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await openAnswering(page, '/r/media/harbor-bell.aiff', 'maybe');
    await page.waitForSelector('audio.marxy-media-player');
    assert.equal(await page.textContent('.marxy-media-line'), 'AIFF · PCM, 16-bit, mono, 8,000 Hz · 0.5 s');
    const m = await factsOf(page, 'contents');
    assert.equal(m.container, 'AIFF, read from its COMM chunk');
    assert.equal(m.length, '0.5 s, from its frame count');
    assert.equal(m.audio, 'PCM · mono · 8,000 Hz · 16-bit');
    assert.deepEqual(await factsOf(page, 'frontmatter'), { title: 'Harbour bell NAME', artist: 'Marxy fixtures AUTH' });
    assert.ok((await page.evaluate(() => window.__asked)).includes('audio/aiff'));
  });
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await openAnswering(page, '/r/media/harbor-bell.mka', '');
    await page.waitForSelector('[data-marxy-viewer="media"] .marxy-media-noplay');
    assert.equal(await page.textContent('.marxy-media-line'), 'Matroska · Opus, mono, 48,000 Hz · 0.5 s');
    assert.equal(await page.textContent('.marxy-media-title'), 'This system cannot play Opus in an .mka');
    assert.deepEqual(await page.evaluate(() => window.__asked), ['audio/webm; codecs="opus"']);
    assert.equal((await factsOf(page, 'contents')).length, "0.5 s, from the segment's Info");
  });
});

test('a WMA with no facts is the card when the webview says no, and the player when it says maybe', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await openAnswering(page, '/r/media/old-song.wma', '');
    await page.waitForSelector('[data-marxy-viewer="media"] .marxy-media-noplay');
    assert.equal(await page.$('audio'), null);
    assert.equal(await page.textContent('.marxy-media-title'), 'This system cannot play this WMA file');
  });
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await openAnswering(page, '/r/media/old-song.wma', 'maybe');
    await page.waitForSelector('audio.marxy-media-player');
    assert.equal(await page.$('.marxy-media-noplay'), null);
  });
});

test('a player that fails on the source turns the page to the facts-only card, with what the player said', async () => {
  await withFrame({ files: FILES, open: ['/r/media/cut.mp4'] }, async (page) => {
    await page.waitForSelector('[data-marxy-viewer="media"] .marxy-media-noplay');
    assert.equal(await page.textContent('.marxy-media-title'), 'This system cannot play this MP4 file');
    assert.match(await page.textContent('.marxy-media-said'), /^Its container is not one the app reads, and this system has no decoder for it\. The player said: .+\.$/);
    await page.waitForFunction(() => document.querySelector('[data-marxy-head="0"] .marxy-guess')?.textContent === 'Facts only · cannot play here');
    assert.match(await cardText(page, 'contents'), /Its container is not one the app reads/);
  });
});

test('a codec the webview cannot play is a facts-only card with the way out, said in grey in the head as a tier', async () => {
  await withFrame({ files: FILES, open: ['/r/media/interview-prores.mov'] }, async (page) => {
    await page.waitForSelector('[data-marxy-viewer="media"] .marxy-media-noplay');
    assert.equal(await page.$('video'), null, 'no player for a codec the webview has not');
    assert.equal(await page.textContent('.marxy-media-line'), 'QuickTime · Apple ProRes 422 HQ, 1920 × 1080, 25 frames a second · PCM, little-endian, 16-bit, stereo, 48,000 Hz · 12.0 s');
    assert.equal(await page.textContent('.marxy-media-kicker'), 'Facts only');
    assert.equal(await page.textContent('.marxy-media-title'), 'This system cannot play Apple ProRes 422 HQ video in a .mov');
    assert.match(await page.textContent('.marxy-media-said'), /^The facts here are read from the file's own boxes: Apple ProRes 422 HQ at 1920 × 1080, 25 frames a second, with PCM, little-endian sound, 12\.0 s long\. ProRes is an editing format;/);
    assert.deepEqual(await page.$$eval('.marxy-media-acts button', (bs) => bs.map((b) => b.textContent)), ['Open in default app', 'Show in folder', 'Try to play it anyway']);
    assert.equal(await page.textContent('.marxy-media-foot'), 'Nothing was decoded. On macOS the system’s player draws ProRes, and this page would be a player there. Source has the bytes.');
    await page.waitForFunction(() => document.querySelector('[data-marxy-head="0"] .marxy-guess')?.textContent === 'Facts only · cannot play here');
    assert.deepEqual(await headSay(page), { text: 'Facts only · cannot play here', tier: true });
    await showCardPanel(page, 'reading');
    assert.equal(await page.textContent('.marxy-drawer .marxy-tiers li[data-marxy-here] b'), 'Facts only');
    const m = await factsOf(page, 'contents');
    assert.equal(m.container, 'QuickTime (moov, mdat) · brand qt');
    assert.equal(m.video, 'Apple ProRes 422 HQ · 1920 × 1080 · 25 frames a second');
    assert.equal(m.audio, 'PCM, little-endian · stereo · 48,000 Hz · 16-bit');
    assert.equal(m.plays, 'not here: no decoder for it');
    assert.deepEqual(await factsOf(page, 'frontmatter'), { title: 'Interview on the quay ©nam' });
    assert.match(await cardText(page, 'reading'), /Shown as QuickTime video/);
    // This build hands nothing to another program, and says so.
    await page.click('.marxy-media-acts button:text-is("Open in default app")');
    await page.waitForFunction(() => [...document.querySelectorAll('.marxy-notice-text')].some((n) => /cannot hand a file to another program/.test(n.textContent)));
  });
});

test('an Ogg and a FLAC say their codec, channels, rate and length in the Media card, and their comments in Tags', async () => {
  await withFrame({ files: FILES, open: ['/r/README.md'] }, async (page) => {
    await openPlayable(page, '/r/media/chime.flac');
    await page.waitForSelector('[data-marxy-viewer="media"] .marxy-media-line');
    assert.equal(await page.textContent('.marxy-media-line'), 'FLAC · FLAC, 16-bit, mono, 8,000 Hz · 0.5 s');
    const f = await factsOf(page, 'contents');
    assert.equal(f.container, 'FLAC, read from its metadata blocks');
    assert.equal(f.length, "0.5 s, from STREAMINFO's sample count");
    assert.equal(f.audio, 'FLAC · mono · 8,000 Hz · 16-bit');
    assert.deepEqual(await factsOf(page, 'frontmatter'), {
      title: 'Chime TITLE',
      artist: 'Reader Lab ARTIST',
      made: '2026-11-09 DATE',
      comment: 'A tone, constructed COMMENT',
      software: 'make-xiph.py (constructed) vendor',
    });
    await openPlayable(page, '/r/media/chime.opus');
    await page.waitForFunction(() => document.querySelector('[data-marxy-viewer="media"] .marxy-media-line')?.textContent.startsWith('Ogg'));
    assert.equal(await page.textContent('.marxy-media-line'), 'Ogg · Opus, mono, 48,000 Hz · 0.5 s');
    const o = await factsOf(page, 'contents');
    assert.equal(o.container, 'Ogg, read from its first and last pages');
    assert.equal(o.length, "0.5 s, from its last page's granule position");
    assert.equal((await factsOf(page, 'frontmatter')).title, 'Chime TITLE');
  });
});
