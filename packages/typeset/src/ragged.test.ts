// The ragged-right breaker, pure: the cases a reader would notice.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Measured } from './items.ts';
import { badness, breakRagged } from './ragged.ts';

/** Words of the given widths separated by 5 px spaces, at 17 px type. */
const para = (...widths: number[]): Measured[] =>
  widths.flatMap((width, i): Measured[] => (i === 0 ? [{ kind: 'piece', width }] : [{ kind: 'space', width: 5, fontSize: 17 }, { kind: 'piece', width }]));

test('a paragraph that fits is one line', () => {
  assert.deepEqual(breakRagged(para(10, 10, 10), 100, 17).after, []);
});

test('no line is set wider than the measure', () => {
  const tokens = para(...Array.from({ length: 60 }, (_, i) => 20 + ((i * 37) % 50)));
  const { after, overfull } = breakRagged(tokens, 300, 17);
  assert.equal(overfull, false);
  let start = 0;
  for (const end of [...after, tokens.length]) {
    let width = 0;
    for (let i = start; i < end; i++) width += tokens[i]!.kind === 'dash' ? 0 : (tokens[i] as { width: number }).width;
    assert.ok(width <= 300, `line of ${width}`);
    start = end + 1;
  }
});

/** Line widths for a set of breaks. */
function lines(tokens: readonly Measured[], after: readonly number[]): number[] {
  const widths: number[] = [];
  let start = 0;
  for (const end of [...after, tokens.length]) {
    let w = 0;
    for (let i = start; i < end; i++) { const t = tokens[i]!; if (t.kind !== 'dash') w += t.width; }
    widths.push(w);
    start = end + 1;
  }
  return widths;
}

/** First-fit, the engine's own wrapping: the bar the breaker has to clear. */
function firstFit(tokens: readonly Measured[], measure: number): number[] {
  const after: number[] = [];
  let width = 0;
  let lastSpace = -1;
  let widthAtSpace = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === 'space') { lastSpace = i; widthAtSpace = width; width += t.width; continue; }
    if (t.kind === 'piece') {
      if (width + t.width > measure && lastSpace !== -1 && (after.length === 0 || lastSpace > after[after.length - 1]!)) {
        after.push(lastSpace);
        width = width - widthAtSpace - (tokens[lastSpace] as { width: number }).width;
      }
      width += t.width;
    }
  }
  return after;
}

/** The objective: squared (line penalty + badness) over every line but the last, at 2 em of stretch. */
const demerits = (widths: readonly number[], measure: number): number =>
  widths.slice(0, -1).reduce((sum, w) => sum + (10 + badness(measure - w, 34)) ** 2, 0);

test('never worse than first-fit on its own objective, and better on some paragraphs', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  let better = 0;
  for (let n = 0; n < 200; n++) {
    const tokens = para(...Array.from({ length: 40 + Math.floor(random() * 60) }, () => 15 + random() * 90));
    const kp = demerits(lines(tokens, breakRagged(tokens, 400, 17).after), 400);
    const ff = demerits(lines(tokens, firstFit(tokens, 400)), 400);
    assert.ok(kp <= ff + 1e-6, `paragraph ${n}: ${kp} > first-fit ${ff}`);
    if (kp < ff - 1e-6) better++;
  }
  assert.ok(better > 50, `better on only ${better} of 200`);
});

test('a word wider than the measure is set alone and flagged', () => {
  assert.equal(breakRagged(para(20, 500, 20), 100, 17).overfull, true);
});

test('badness is TeX’s: 100 at the full stretch, capped at 10000', () => {
  assert.equal(badness(34, 34), 100);
  assert.equal(badness(0, 34), 0);
  assert.equal(badness(1000, 34), 10000);
});
