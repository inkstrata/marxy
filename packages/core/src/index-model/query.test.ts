// The query language: one case per row of the syntax table, the combinators, the
// flagged terms, the authorship exclusion, range bookkeeping and totality over random input.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, type FieldTerm, type Term } from './index.ts';
import { QUERY_KEYS } from './query.ts';

const only = (input: string): Term => {
  const q = parseQuery(input);
  assert.equal(q.groups.length, 1, input);
  assert.equal(q.groups[0]!.length, 1, input);
  return q.groups[0]![0]!;
};
const field = (input: string): FieldTerm => {
  const t = only(input);
  assert.equal(t.kind, 'field', input);
  return t as FieldTerm;
};

const DAY = 86_400_000;
const HOUR = 3_600_000;

test('syntax table: kind', () => {
  assert.deepEqual(field('kind:report').values, ['report']);
  assert.deepEqual(field('kind:trans').values, ['trans']);
  assert.deepEqual(field('kind:report,transcript').values, ['report', 'transcript']);
});

test('syntax table: is, every status', () => {
  for (const v of ['unread', 'read', 'changed', 'pinned', 'dup', 'broken', 'archived', 'recent', 'error', 'captured']) {
    assert.deepEqual(field(`is:${v}`).values, [v]);
  }
  assert.equal(only('is:foo').kind, 'unknown', 'an unknown value of a known key is kept as text');
  assert.equal((only('is:foo') as { text: string }).text, 'is:foo');
  assert.equal(only('has:foo').kind, 'unknown');
  assert.equal(only('is:unread,foo').kind, 'unknown');
});

test('syntax table: has, and has:tasks still parses', () => {
  for (const v of ['code', 'paths', 'links', 'tasks']) assert.deepEqual(field(`has:${v}`).values, [v]);
});

test('syntax table: modified', () => {
  assert.deepEqual(field('modified:today').values, ['today']);
  assert.deepEqual(field('modified:yesterday').values, ['yesterday']);
  const cases: [string, string, number][] = [
    ['modified:<2h', '<', 2 * HOUR], ['modified:<7d', '<', 7 * DAY], ['modified:<4w', '<', 28 * DAY],
    ['modified:>30d', '>', 30 * DAY], ['modified:<3mo', '<', 90 * DAY], ['modified:<15min', '<', 15 * 60_000],
    ['modified:<15m', '<', 15 * 60_000], ['modified:>1y', '>', 365 * DAY],
  ];
  for (const [text, op, amount] of cases) {
    const t = field(text);
    assert.equal(t.op, op, text);
    assert.equal(t.amount, amount, text);
  }
  assert.equal(only('modified:7').kind, 'incomplete', 'an age needs a unit');
});

test('syntax table: words, tasks and size', () => {
  assert.deepEqual([field('words:>1000').op, field('words:>1000').amount], ['>', 1000]);
  assert.deepEqual([field('words:<300').op, field('words:<300').amount], ['<', 300]);
  assert.deepEqual([field('words:>=2k').op, field('words:>=2k').amount], ['>=', 2000]);
  assert.deepEqual([field('tasks:>0').op, field('tasks:>0').amount], ['>', 0]);
  assert.deepEqual([field('tasks:>5').op, field('tasks:>5').amount], ['>', 5]);
  assert.deepEqual([field('tasks:0').op, field('tasks:0').amount], ['=', 0]);
  assert.equal(field('size:>1mb').amount, 1_048_576);
  assert.equal(field('size:<10kb').amount, 10 * 1024);
  assert.equal(field('size:<10KB').amount, 10 * 1024);
  assert.equal(field('words:>=2k').values[0], '>=2k', 'the written text is kept');
});

test('counts are decimal, sizes are binary', () => {
  assert.equal(field('words:>2k').amount, 2000);
  assert.equal(field('tasks:>1k').amount, 1000);
  assert.equal(field('size:>1kb').amount, 1024);
  assert.equal(field('size:>1mb').amount, 1_048_576);
  assert.equal(field('size:>1.5k').amount, 1536);
});

test('syntax table: path and in', () => {
  assert.deepEqual(field('path:plans/').values, ['plans/']);
  assert.deepEqual(field('path:handoffs').values, ['handoffs']);
  assert.deepEqual(field('in:plans').values, ['plans']);
  assert.deepEqual(field('in:notes').values, ['notes']);
  assert.deepEqual(field('in:"my notes"').values, ['my notes']);
});

test('syntax table: phrase, exclusion, OR', () => {
  assert.deepEqual(only('"pg_upgrade --link"'), { kind: 'phrase', text: 'pg_upgrade --link', negated: false, range: [0, 19] });
  assert.equal(field('-kind:code').negated, true);
  assert.equal(field('-is:archived').negated, true);
  const q = parseQuery('is:unread OR is:changed');
  assert.equal(q.groups.length, 2);
  assert.deepEqual((q.groups[1]![0] as FieldTerm).values, ['changed']);
});

test('plain words, and a lone dash is a word', () => {
  const q = parseQuery('pg upgrade - plan');
  assert.deepEqual(q.groups[0]!.map((t) => (t.kind === 'word' ? t.text : '?')), ['pg', 'upgrade', '-', 'plan']);
  assert.equal((only('-draft') as { negated: boolean }).negated, true);
});

test('OR splits groups: a b OR c is (a AND b) OR c; stray ORs leave no empty group', () => {
  const q = parseQuery('a b OR c');
  assert.deepEqual(q.groups.map((g) => g.length), [2, 1]);
  assert.deepEqual(parseQuery('OR a OR OR b OR').groups.map((g) => g.length), [1, 1]);
  assert.deepEqual(parseQuery('or a').groups[0]!.length, 2, 'lower case or is a word');
  assert.deepEqual(parseQuery('').groups, []);
});

test('an unknown key is an unknown term with its text, a missing value is incomplete', () => {
  const u = only('colour:red');
  assert.equal(u.kind, 'unknown');
  assert.equal((u as { text: string }).text, 'colour:red');
  assert.equal(only('-colour:red').kind, 'unknown');
  assert.equal((only('-colour:red') as { text: string }).text, '-colour:red');
  assert.equal(only('words:>').kind, 'incomplete');
  assert.equal(only('kind:').kind, 'incomplete');
  assert.equal(only('words:abc').kind, 'incomplete');
  assert.equal(only('words:>1,<5').kind, 'incomplete');
  assert.equal(only('in:"open').kind, 'incomplete');
});

test('an unclosed quote runs to the end as an incomplete phrase', () => {
  const t = only('"pg_upg') as { kind: string; text: string; incomplete?: true; range: readonly number[] };
  assert.deepEqual([t.kind, t.text, t.incomplete, [...t.range]], ['phrase', 'pg_upg', true, [0, 7]]);
  assert.equal(only('""').kind, 'incomplete');
});

for (const name of ['model', 'session', 'tag', 'is:ai', 'is:live']) {
  test(`${name} is not a key: it parses as unknown`, () => {
    const input = name.includes(':') ? name : `${name}:x`;
    assert.equal(only(input).kind, 'unknown', input);
    assert.ok(!(QUERY_KEYS as readonly string[]).includes(name));
  });
}

function checkRanges(input: string): void {
  const q = parseQuery(input);
  let end = 0;
  for (const g of q.groups) {
    for (const t of g) {
      const [s, e] = t.range;
      assert.ok(s >= end && e > s && e <= input.length, `order/bounds in ${JSON.stringify(input)}`);
      end = e;
      const slice = input.slice(s, e);
      const runsToEnd = e === input.length && slice.includes('"'); // an open quote keeps its trailing text
      assert.ok(!/^\s/.test(slice) && (runsToEnd || !/\s$/.test(slice)), 'no edge whitespace');
      if (t.kind === 'word') assert.equal(slice, (t.negated ? '-' : '') + t.text);
      else if (t.kind === 'phrase') assert.equal(slice, `${t.negated ? '-' : ''}"${t.text}${t.incomplete ? '' : '"'}`);
      else if (t.kind === 'unknown' || t.kind === 'incomplete') assert.equal(slice, t.text);
      else assert.ok(slice.replace(/^-/, '').toLowerCase().startsWith(`${(t as FieldTerm).key}:`));
    }
  }
}

test('ranges slice the input to exactly the token', () => {
  checkRanges('-kind:code "a b" words:>2k OR foo is:x -"q');
});

test('random input: never throws, ranges in order, non-overlapping and inside the input', () => {
  let seed = 12345;
  const rand = (n: number): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const pieces = ['"', '-', ':', ',', ' ', ' ', '\n', 'OR', 'is', 'kind', 'words', 'size', 'in', 'a', 'z9', '>', '<', '>=', '2k', '1mb',
    '7d', '3mo', 'é', '日本', '😀', '\ud800', '\udc00', 'unread', 'model', ' ', '​'];
  for (let k = 0; k < 10_000; k++) {
    let s = '';
    for (let j = rand(14); j >= 0; j--) s += pieces[rand(pieces.length)];
    checkRanges(s);
  }
});

test('a 100 KB input parses in linear time (recorded, not asserted)', () => {
  const unit = 'kind:report,transcript -is:archived "pg upgrade" words:>2k plain OR ';
  const input = unit.repeat(Math.ceil(100_000 / unit.length));
  const t0 = performance.now();
  const q = parseQuery(input);
  const ms = performance.now() - t0;
  console.log(`# parseQuery ${input.length} chars, ${q.groups.length} groups: ${ms.toFixed(1)} ms`);
  const bad = '"'.repeat(1) + 'x'.repeat(100_000);
  const t1 = performance.now();
  parseQuery(bad);
  console.log(`# parseQuery unclosed quote, 100 KB: ${(performance.now() - t1).toFixed(1)} ms`);
});
