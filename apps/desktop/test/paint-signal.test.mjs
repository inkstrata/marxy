// Named checks for MARXY-71: first_text rests on an engine paint signal, not a frame count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FRAMES_BEFORE_PAINT,
  FRAMES_ONLY_SIGNAL,
  PAINT_FALLBACK_MS,
  PAINT_SIGNAL_NAMES,
  isDocVisible,
  readPaintSignal,
  waitForEnginePaint,
} from '../src/paint-signal.mjs';
import { stripComments } from '../../../scripts/lib/repo.mjs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const desktop = join(repoRoot, 'apps', 'desktop');

const visible = () => ({ visibility: 'visible', display: 'block' });
const hidden = () => ({ visibility: 'hidden', display: 'block' });
const rafShim = (cb) => setTimeout(() => cb(Date.now()), 0);
const silentObserver = class {
  observe() {}
  disconnect() {}
};

function waitOrTimeout(promise, ms) {
  return Promise.race([
    promise.then(value => ({ ok: true, value })),
    new Promise(resolve => setTimeout(() => resolve({ ok: false }), ms)),
  ]);
}

test('FRAMES_BEFORE_PAINT is still 2, the MARXY-13 requirement this story adds to', () => {
  assert.equal(FRAMES_BEFORE_PAINT, 2);
});

test('criterion 1: readPaintSignal names an engine paint entry and ignores frames', () => {
  assert.equal(readPaintSignal({ getEntriesByType: () => [] }), null);
  assert.equal(readPaintSignal({ getEntriesByType: () => [{ name: 'first-contentful-paint', startTime: 12 }] }), 'first-contentful-paint');
  assert.equal(readPaintSignal({ getEntriesByType: () => [{ name: 'first-paint', startTime: 8 }] }), 'first-paint');
  assert.ok(PAINT_SIGNAL_NAMES.includes('first-contentful-paint'));
  assert.ok(PAINT_SIGNAL_NAMES.includes('first-paint'));
});

test('criterion 1: a blank-page paint before the render watermark is not first_text', () => {
  const perf = {
    getEntriesByType: () => [
      { name: 'first-paint', startTime: 3 },
      { name: 'first-contentful-paint', startTime: 40 },
    ],
  };
  assert.equal(readPaintSignal(perf, 20), 'first-contentful-paint');
  assert.equal(readPaintSignal(perf, 50), null);
});

test('criterion 1: waitForEnginePaint resolves only after frames and a paint entry', async () => {
  const result = await waitForEnginePaint({
    performance: { getEntriesByType: () => [{ name: 'first-contentful-paint', startTime: 1 }] },
    PerformanceObserver: silentObserver,
    requestAnimationFrame: rafShim,
    getComputedStyle: visible,
    doc: {},
    timeoutMs: 200,
  });
  assert.equal(result.signal, 'first-contentful-paint');
});

test('criterion 2: visibility hidden is not a paint, even with textContent and frames', async () => {
  assert.equal(isDocVisible({}, hidden), false);
  const raced = await waitOrTimeout(waitForEnginePaint({
    performance: { getEntriesByType: () => [{ name: 'first-contentful-paint', startTime: 1 }] },
    PerformanceObserver: silentObserver,
    requestAnimationFrame: rafShim,
    getComputedStyle: hidden,
    doc: {},
    timeoutMs: 50,
  }), 80);
  assert.equal(raced.ok, false, 'a hidden #doc must not resolve the paint wait');
});

test('criterion 3: a setTimeout rAF shim without a paint entry does not resolve', async () => {
  const raced = await waitOrTimeout(waitForEnginePaint({
    performance: { getEntriesByType: () => [] },
    PerformanceObserver: silentObserver,
    requestAnimationFrame: rafShim,
    getComputedStyle: visible,
    doc: {},
    timeoutMs: 50,
  }), 80);
  assert.equal(raced.ok, false, 'frames ticking via setTimeout must not mint first_text');
});

test('criterion 4: MARK first_text stays two fields and measure-startup still parses it', () => {
  const measure = readFileSync(join(repoRoot, 'scripts', 'measure-startup.mjs'), 'utf8');
  const parser = /const m = \/\^MARK \(\\S\+\) \(\\S\+\)\/\.exec\(line\)/;
  assert.match(measure, parser, 'measure-startup.mjs parser changed; this story must not require that');

  const line = 'MARK first_text 1710000000123';
  const m = /^MARK (\S+) (\S+)/.exec(line);
  assert.ok(m);
  assert.equal(m[1], 'first_text');
  assert.equal(Number(m[2]), 1710000000123);

  // Read through stripComments (scripts/lib/repo.mjs) so a comment reciting these strings —
  // rather than the live code — cannot satisfy this pin (MARXY-95 review, criterion 8).
  const app = stripComments(readFileSync(join(desktop, 'src', 'startup', 'measure.ts'), 'utf8'));
  assert.match(app, /await shell\.mark\('first_text', paintedAt\);/);
  assert.doesNotMatch(app, /mark\('first_text',\s*paintedAt,/);

  const rust = readFileSync(join(desktop, 'src-tauri', 'src', 'main.rs'), 'utf8');
  assert.match(rust, /writeln!\(out, "MARK \{\} \{\}", name, ms\)/);
});

test('criterion 5: paint-signal contract and the MARXY-72 frames verdict stay wired', () => {
  const measureSrc = stripComments(readFileSync(join(desktop, 'src', 'startup', 'measure.ts'), 'utf8'));
  assert.match(measureSrc, /waitForEnginePaint/);
  assert.match(measureSrc, /signal=\$\{signal\}/);
  assert.match(measureSrc, /frames=\$\{frames\}/);

  // B-08: the measurement lives in startup/measure.ts, not in app.ts.
  const appSrc = stripComments(readFileSync(join(desktop, 'src', 'app.ts'), 'utf8'));
  for (const gone of ['framesObserved', 'observing', 'observeFrame', 'settleReady', 'inHarness']) {
    assert.doesNotMatch(appSrc, new RegExp(`\\b${gone}\\b`), `app.ts must not hold ${gone}`);
    assert.match(measureSrc, new RegExp(`\\b${gone}\\b`), `measure.ts must hold ${gone}`);
  }
  assert.doesNotMatch(appSrc, /function renderEvidence|waitForEnginePaint|isDocVisible/);
  assert.match(measureSrc, /renderEvidence/);

  const smoke = readFileSync(join(desktop, 'scripts', 'smoke-cli-open.mjs'), 'utf8');
  assert.match(smoke, /waitForEnginePaint/);
  assert.match(smoke, /signal=/);
  assert.match(smoke, /paintedFramesOk/);
  assert.match(smoke, /paintVerdict/);

  const verdict = readFileSync(join(desktop, 'scripts', 'smoke-verdict.mjs'), 'utf8');
  assert.match(verdict, /export function paintedFramesOk\(frames\)/);
  assert.match(verdict, /frames >= MIN_FRAMES_AFTER_RENDER/);
  assert.match(verdict, /export function paintVerdict\(/);
  assert.match(verdict, /if \(!paintedFramesOk\(frames\)\)/);
});

test('F-31 paint path: an engine paint entry resolves with its own name, never frames-only', async () => {
  const result = await waitForEnginePaint({
    performance: { getEntriesByType: () => [{ name: 'first-paint', startTime: 1 }] },
    PerformanceObserver: silentObserver,
    requestAnimationFrame: rafShim,
    getComputedStyle: visible,
    doc: {},
    fallbackMs: 10_000,
    timeoutMs: 500,
  });
  assert.equal(result.signal, 'first-paint');
  assert.notEqual(result.signal, FRAMES_ONLY_SIGNAL);
});

test('F-31 fallback path: frames but no paint entry resolve as frames-only instead of hanging', async () => {
  assert.equal(PAINT_FALLBACK_MS, 2000, 'about 2 s, below the shell deadline of 2.5 s');
  const raced = await waitOrTimeout(waitForEnginePaint({
    performance: { getEntriesByType: () => [] },
    PerformanceObserver: silentObserver,
    requestAnimationFrame: rafShim,
    getComputedStyle: visible,
    doc: {},
    fallbackMs: 30,
    timeoutMs: 500,
  }), 400);
  assert.equal(raced.ok, true, 'the wait must end once the fallback is due');
  assert.equal(raced.value.signal, FRAMES_ONLY_SIGNAL);
  assert.equal(FRAMES_ONLY_SIGNAL, 'frames-only');
});

test('F-31 fallback path: a late paint entry inside the window still wins, and the fallback needs two frames', async () => {
  let entries = [];
  setTimeout(() => { entries = [{ name: 'first-contentful-paint', startTime: 1 }]; }, 10);
  const late = await waitForEnginePaint({
    performance: { getEntriesByType: () => entries },
    PerformanceObserver: silentObserver,
    requestAnimationFrame: rafShim,
    getComputedStyle: visible,
    doc: {},
    fallbackMs: 200,
    timeoutMs: 500,
  });
  assert.equal(late.signal, 'first-contentful-paint');

  // No frames at all (a display asleep): the fallback must not mint a result out of nothing.
  const raced = await waitOrTimeout(waitForEnginePaint({
    performance: { getEntriesByType: () => [] },
    PerformanceObserver: silentObserver,
    requestAnimationFrame: () => 0,
    getComputedStyle: visible,
    doc: {},
    fallbackMs: 20,
    timeoutMs: 100,
  }), 150);
  assert.equal(raced.ok, false, 'no frames, no result');
});

test('F-31 fallback path: a hidden #doc never falls back to a result', async () => {
  const raced = await waitOrTimeout(waitForEnginePaint({
    performance: { getEntriesByType: () => [] },
    PerformanceObserver: silentObserver,
    requestAnimationFrame: rafShim,
    getComputedStyle: hidden,
    doc: {},
    fallbackMs: 20,
    timeoutMs: 100,
  }), 150);
  assert.equal(raced.ok, false);
});

test('F-31 marker: a frames-only boot says so on MARK painted and prints no first_text', () => {
  const measureSrc = stripComments(readFileSync(join(desktop, 'src', 'startup', 'measure.ts'), 'utf8'));
  assert.match(measureSrc, /signal === FRAMES_ONLY_SIGNAL\) return 'frames_only';/);
  const painted = measureSrc.indexOf("shell.mark('painted'");
  const guard = measureSrc.indexOf("signal === FRAMES_ONLY_SIGNAL");
  const firstText = measureSrc.indexOf("shell.mark('first_text'");
  assert.ok(painted > 0 && painted < guard && guard < firstText, 'the frames-only return sits between painted and first_text');
});
