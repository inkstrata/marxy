// F-96 (earlier tuned in B-25.1): the diagram caption is marked by a class the renderer writes, and no rule
// selects a paragraph by the block after it. `p:has(+ pre…)` restyled every paragraph of a long run in time that
// grew with the square of their number (13 s for 27,000 in WebKit). This test reads base.css; it asserts no timing.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../src/base.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every innermost rule as `{ selectors, body }`, at-rule preludes left out. */
function rules(source) {
  const out = [];
  const stack = [];
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '{') {
      stack.push({ prelude: source.slice(start, i).trim(), open: i + 1 });
      start = i + 1;
    } else if (source[i] === '}') {
      const frame = stack.pop();
      const body = source.slice(frame.open, i);
      if (!frame.prelude.startsWith('@') && !body.includes('{')) out.push({ selectors: splitTop(frame.prelude, ','), body });
      start = i + 1;
    }
  }
  return out;
}

/** Split on `separator` outside parentheses. */
function splitTop(text, separator) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === separator && depth === 0) {
      parts.push(text.slice(from, i).trim());
      from = i + 1;
    }
  }
  parts.push(text.slice(from).trim());
  return parts;
}

// F-96: the caption is marked by a class the renderer writes, not found by what follows it. A `p:has(+ pre …)`
// restyled every paragraph of a long run in time that grew with the square of their number (13 s for 27,000).
test('no rule selects a paragraph by the block after it, and the caption rule is a class (F-96)', () => {
  assert.doesNotMatch(css, /\bp\s*:has\(\s*\+\s*pre/, 'a p:has(+ pre …) rule is back in base.css');
  const rule = rules(css).find((r) => r.selectors.includes('.marxy-article > p.marxy-diagram-caption'));
  assert.ok(rule, 'no .marxy-article > p.marxy-diagram-caption rule');
  assert.match(rule.body, /font-size:\s*var\(--marxy-size-caption\)/);
});
