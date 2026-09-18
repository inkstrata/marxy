// What the sanitiser costs, asserted, because reading is primary and this runs before a reader sees
// anything (AGENTS.md's budgets; ADR-0013 makes them hard failures).
//
// The regression this exists to prevent was real and was not caught by anything: finding the end of
// a removed raw-text element with `input.toLowerCase()` made removal quadratic in the number of
// removed elements, and a 1.3 MiB document went from 2.5 ms to 305 ms — 122× — while every test and
// every gate stayed green. `gate:perf` measures the packaged app's cold start, not this function.
//
// Two assertions, because either alone can be fooled. The ceiling is generous enough for a slow CI
// runner and still catches a regression of that size by more than an order of magnitude; the ratio
// catches a quadratic that a fast machine would sail under the ceiling with, since doubling the
// work twice must not quadruple the time. When `fixtures/perf-budgets.json` settles — MARXY-59 is
// reshaping it in PR #15 and owns that file — the two numbers below belong there with the others.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { sanitizeHtml } from './sanitize-html.ts';

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

test('a large hostile document is sanitised well inside the viewport budget', () => {
  const html = document(6400);
  assert.ok(html.length > 500 * 1024, 'the budget should be measured on a document worth measuring');
  const ms = fastest(html);
  assert.ok(ms < 150, `sanitising ${(html.length / 1024).toFixed(0)} KiB of removed raw text took ${ms.toFixed(1)} ms, and the whole viewport budget is 100 ms`);
});

test('removal stays linear in the number of removed raw-text elements', () => {
  const small = fastest(document(1600));
  const large = fastest(document(6400));
  // Four times the work, so four times the time; the quadratic version was sixteen and then some.
  assert.ok(large < small * 8, `1600 blocks took ${small.toFixed(1)} ms and 6400 took ${large.toFixed(1)} ms, which is ${(large / small).toFixed(1)}× for 4× the document`);
});
