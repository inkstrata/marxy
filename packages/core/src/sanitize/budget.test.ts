// What the sanitiser costs, measured because reading is primary and this runs before a reader sees
// anything. The cost is printed; the *shape* of the cost is asserted.
//
// The regression this exists to prevent was real and was not caught by anything: finding the end of
// a removed raw-text element with `input.toLowerCase()` made removal quadratic in the number of
// removed elements, and a 1.3 MiB document went from 2.5 ms to 305 ms — 122× — while every test and
// every gate stayed green. The start-up measurement times the packaged app, not this function.
//
// The ratio is the assertion, and it is the only one. An absolute ceiling here — the
// old `ms < 150` — could not tell a regression from a slow runner: both look like one wall-clock
// number being larger than another, and a shared CI runner produces that on its own. The ratio
// compares two timings taken on the same machine moments apart, so machine speed cancels and what
// is left is the shape of the algorithm: doubling the work twice must not quadruple the time. That
// is what the 122× quadratic regression did, and what a ceiling that no runner trips would miss.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SANITIZE_MAX_OPEN, sanitizeHtml } from './sanitize-html.ts';

/** Removed raw-text elements are the expensive shape: each one has to be scanned to its end. */
function document(blocks: number): string {
  return '<style>.a { color: red; background: url(x.png); padding: 1px }</style><p>text</p>'.repeat(blocks);
}

function fastest(html: string, runs = 5): number {
  let best = Infinity;
  for (let run = 0; run < runs; run += 1) {
    const start = performance.now();
    sanitizeHtml(html);
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

test('a large hostile document is sanitised, and what it cost is recorded', () => {
  const html = document(6400);
  assert.ok(html.length > 500 * 1024, 'the budget should be measured on a document worth measuring');
  const ms = fastest(html);
  // Printed, never asserted: speed numbers are kept out of pass/fail, and the linearity test
  // below is what actually catches the regression this file exists for.
  console.log(`sanitise: ${(html.length / 1024).toFixed(0)} KiB of removed raw text in ${ms.toFixed(1)} ms`);
});

test('removal stays linear in the number of removed raw-text elements', () => {
  // Four times the work, so four times the time; the quadratic version was eight times and more.
  // Measured twice before failing: both numbers are minima, so noise can only inflate them, and a
  // machine that stalls inside the larger run is the one way this reads high without a regression.
  const ratio = () => {
    const small = fastest(document(1600));
    const large = fastest(document(6400));
    return { small, large, factor: large / small };
  };
  let measured = ratio();
  if (measured.factor >= 8) measured = ratio();
  assert.ok(measured.factor < 8, `1600 blocks took ${measured.small.toFixed(1)} ms and 6400 took ${measured.large.toFixed(1)} ms, which is ${measured.factor.toFixed(1)}× for 4× the document`);
});

test('a million removed elements keep a bounded list of records, and the rest are counted', () => {
  const n = 1_000_000;
  const result = sanitizeHtml(`<p>a</p>${'<x></x>'.repeat(n)}<script>`);
  assert.equal(result.html, '<p>a</p>');
  assert.ok(result.removed.length <= 100_001, `${result.removed.length} records kept`);
  assert.equal(result.removed.length + result.unlisted, n + 2);
  // What a notice is made from is kept past the cap: the document lost its tail.
  assert.equal(result.removed.at(-1)?.what, 'truncation');
  assert.equal(sanitizeHtml('<x></x><p onclick="a">t</p>').unlisted, 0);
});

test('the open-element stack is bounded, and what is past it keeps its text', () => {
  const n = 200_000;
  const { html, removed } = sanitizeHtml(`${'<b>'.repeat(n)}deep${'</b>'.repeat(n)}after`);
  const opened = html.split('<b>').length - 1;
  assert.ok(opened <= 65_536, `${opened} elements held open`);
  assert.equal(html, `${'<b>'.repeat(opened)}deep${'</b>'.repeat(opened)}after`);
  assert.ok(removed.some((r) => r.what === 'structure' && r.name === 'b'));
});

/** Every close tag closes the element open at the top, and nothing is left open. */
function assertBalanced(html: string): void {
  const open: string[] = [];
  for (const m of html.matchAll(/<(\/?)([a-z][^\s/>]*)[^>]*>/g)) {
    if (m[1] === '/') assert.equal(open.pop(), m[2]);
    else open.push(m[2]!);
  }
  assert.equal(open.length, 0);
}

test('a close tag past the open-element cap ends the element dropped there, not one written below it', () => {
  const m = SANITIZE_MAX_OPEN;
  const inner = (text: string): string => `${'<i>'.repeat(m - 1)}${text}${'</i>'.repeat(m - 1)}`;
  const html = sanitizeHtml(`<b>${inner('<b>x</b>y')}</b>z`).html;
  assert.equal(html, `<b>${inner('xy')}</b>z`);
  // A second close ends the written element, as it would with no cap; the stray closes after it are dropped.
  const extra = sanitizeHtml(`<b>${inner('<b>x</b></b>y')}</b>z`).html;
  assert.equal(extra, `<b>${inner('x')}</b>yz`);
  assertBalanced(extra);
  assertBalanced(html);
});

test('opens dropped at the cap end with the element they sat in, so a later element closes where it says', () => {
  const m = SANITIZE_MAX_OPEN;
  const html = sanitizeHtml(`${'<i>'.repeat(m)}<b>x${'</i>'.repeat(m)}<b>y</b>z`).html;
  assert.equal(html, `${'<i>'.repeat(m)}x${'</i>'.repeat(m)}<b>y</b>z`);
  assertBalanced(html);
});