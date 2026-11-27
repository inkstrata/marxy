// check-scale finds the shapes that grow faster than the file or fail on a big one, lets a `scale:` comment
// bound one, and fails only when a file's count grows.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { countHits, grown, hitsIn } from './check-scale.mjs';

const rules = (text) => hitsIn(text).filter((h) => !h.bounded).map((h) => h.rule);

test('an array spread into a call that can overflow the stack is found; a literal array is not', () => {
  assert.deepEqual(rules('out.push(...items);'), ['spread-call']);
  assert.deepEqual(rules('host.append(...nodes);'), ['spread-call']);
  assert.deepEqual(rules('const m = Math.max(...widths);'), ['spread-call']);
  assert.deepEqual(rules('const s = String.fromCharCode(...codes);'), ['spread-call']);
  assert.deepEqual(rules('out.push(...[a, b]);'), []);
  assert.deepEqual(rules('const all = [...a, ...b]; f(...args);'), []);
});

test('a layout read, a DOM query or a queue operation counts only inside a loop or an iteration callback', () => {
  assert.deepEqual(rules('const r = el.getBoundingClientRect(); const h = el.offsetHeight;'), []);
  assert.deepEqual(rules('for (const el of blocks) { tops.push(el.getBoundingClientRect().top); }'), ['layout-in-loop']);
  assert.deepEqual(rules('blocks.forEach((el) => { h += el.offsetHeight; });'), ['layout-in-loop']);
  assert.deepEqual(rules('while (i < n) { article.querySelectorAll("p"); i++; }'), ['query-in-loop']);
  assert.deepEqual(rules('items.map((x) => x.closest("li"));'), []);
  assert.deepEqual(rules('while (queue.length) { next(queue.shift()); }'), ['queue-in-loop']);
  assert.deepEqual(rules('for (const x of xs) { list.sort(cmp); }'), ['queue-in-loop']);
});

test('a function defined inside a loop is its own scope, unless it is the loop body of an iteration method', () => {
  assert.deepEqual(rules('for (const b of bs) { b.onclick = () => b.getBoundingClientRect(); }'), []);
  assert.deepEqual(rules('rows.filter((r) => r.querySelector(".x"));'), ['query-in-loop']);
});

test('writing a layout property is not a read', () => {
  assert.deepEqual(rules('for (const el of els) { el.scrollTop = 0; }'), []);
});

test('a split into every line is found; a split with a limit is not', () => {
  assert.deepEqual(rules("const lines = text.split('\\n');"), ['line-split']);
  assert.deepEqual(rules('const lines = text.split(/\\r?\\n/);'), ['line-split']);
  assert.deepEqual(rules("const first = text.split('\\n', 1)[0];"), []);
  assert.deepEqual(rules("const parts = path.split('/');"), []);
});

test('a pattern built at run time is found; one fixed when written is not', () => {
  assert.deepEqual(rules('const re = new RegExp(query, "gi");'), ['dynamic-regexp']);
  assert.deepEqual(rules('const re = new RegExp(`^${typed}$`);'), ['dynamic-regexp']);
  assert.deepEqual(rules('const re = new RegExp("a+b", "g");'), []);
  assert.deepEqual(rules('const re = new RegExp(BREAK.source, "g");'), []);
  assert.deepEqual(rules('const re = new RegExp(`\\\\S{${RUN_CHARS + 1},}`, "gu");'), []);
  const inFile = (text, name) => hitsIn(text, name).filter((h) => !h.bounded).map((h) => h.rule);
  assert.deepEqual(inFile('const re = new RegExp(query, "gi");', 'src/line/find.worker.ts'), []);
  assert.deepEqual(inFile('const re = new RegExp(query, "gi");', 'src/line/find.ts'), ['dynamic-regexp']);
});

test('a scale: comment on the line or just above bounds a hit', () => {
  assert.deepEqual(rules('out.push(...row); // scale: one row, at most 100 cells'), []);
  assert.deepEqual(rules('// scale: one heading\nconst words = heading.split("\\n");'), []);
  assert.deepEqual(rules('// a comment that says nothing about size\nconst words = heading.split("\\n");'), ['line-split']);
  assert.deepEqual(rules('rows\n  .filter(Boolean)\n  .push(...cells); // scale: one row, at most 100 cells'), []);
});

test('counts go by file and rule, and only growth fails', () => {
  const counts = countHits([
    { path: 'apps/desktop/src/a.ts', text: 'x.push(...a);\ny.push(...b);' },
    { path: 'apps/desktop/src/b.ts', text: 'x.push(...a); // scale: bounded by the screen' },
  ]);
  assert.deepEqual(counts, { 'apps/desktop/src/a.ts': { 'spread-call': 2 } });
  assert.deepEqual(grown(counts, { 'apps/desktop/src/a.ts': { 'spread-call': 2 } }), []);
  assert.deepEqual(grown(counts, { 'apps/desktop/src/a.ts': { 'spread-call': 3 } }), []);
  assert.deepEqual(grown(counts, { 'apps/desktop/src/a.ts': { 'spread-call': 1 } }), [{ path: 'apps/desktop/src/a.ts', rule: 'spread-call', count: 2, recorded: 1 }]);
  assert.deepEqual(grown({ 'apps/desktop/src/new.ts': { 'line-split': 1 } }, {}), [{ path: 'apps/desktop/src/new.ts', rule: 'line-split', count: 1, recorded: 0 }]);
});
