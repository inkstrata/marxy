// The archive page's filter: its grammar, and each term against an entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterMatches, parseArchiveFilter, type ArchiveFilter, type FilterSubject } from './archive-filter.ts';

const parse = (q: string): ArchiveFilter => {
  const f = parseArchiveFilter(q);
  if ('error' in f) throw new Error(f.error);
  return f;
};
const entry = (path: string, size: number | null = 10, packed: number | null = null): FilterSubject => ({ path, size, packed });
const picture = { label: 'an image', group: 'Pictures' };
const code = { label: 'Rust', group: 'Code' };

test('bare words and name: match the entry’s own name, any case, every word', () => {
  const f = parse('Tide TABLE');
  assert.deepEqual(f.terms, [{ by: 'name', word: 'tide' }, { by: 'name', word: 'table' }]);
  assert.equal(filterMatches(f, entry('survey/tide-table.txt'), code), true);
  assert.equal(filterMatches(f, entry('survey/tide-chart.txt'), code), false, 'all words must match');
  assert.equal(filterMatches(parse('survey'), entry('survey/tide-table.txt'), code), false, 'the folders above are not its name');
  const rs = parse('name:.rs');
  assert.equal(filterMatches(rs, entry('x/src/indexer.rs'), code), true);
  assert.equal(filterMatches(rs, entry('x/src/publish.sh'), code), false);
  assert.deepEqual(parse('name:"tide table"').terms, [{ by: 'name', word: 'tide table' }]);
  assert.equal(parse('  name:.rs  ').text, 'name:.rs');
});

test('reading: matches what the entry reads as, by its words or its group', () => {
  assert.equal(filterMatches(parse('reading:picture'), entry('a/boat.jpg'), picture), true, 'the group, Pictures');
  assert.equal(filterMatches(parse('reading:image'), entry('a/boat.jpg'), picture), true, 'the words, an image');
  assert.equal(filterMatches(parse('reading:picture'), entry('a/main.rs'), code), false);
  assert.equal(filterMatches(parse('Reading:RUST'), entry('a/main.rs'), code), true);
});

test('size and packed compare bytes, 1024-based, with b, kb, mb and gb', () => {
  assert.deepEqual(parse('size>100kb').terms, [{ by: 'size', op: '>', bytes: 102_400 }]);
  assert.deepEqual(parse('size<=1.5MB').terms, [{ by: 'size', op: '<=', bytes: 1_572_864 }]);
  assert.deepEqual(parse('packed>=2gb size<10b').terms, [
    { by: 'packed', op: '>=', bytes: 2 * 1024 ** 3 },
    { by: 'size', op: '<', bytes: 10 },
  ]);
  assert.deepEqual(parse('size>512').terms, [{ by: 'size', op: '>', bytes: 512 }], 'no unit is bytes');
  const big = parse('size>100kb');
  assert.equal(filterMatches(big, entry('a', 102_401), code), true);
  assert.equal(filterMatches(big, entry('a', 102_400), code), false, 'greater, not equal');
  assert.equal(filterMatches(parse('size>=100kb'), entry('a', 102_400), code), true);
  assert.equal(filterMatches(big, entry('a', null), code), false, 'a size not said holds to no size term');
  assert.equal(filterMatches(parse('packed<1kb'), entry('a', 5000, 900), code), true);
  assert.equal(filterMatches(parse('packed<1kb'), entry('a', 500, null), code), false, 'a tar keeps no packed size');
});

test('terms are ANDed across kinds', () => {
  const f = parse('reading:picture size>1mb');
  assert.equal(filterMatches(f, entry('p/big.jpg', 2 * 1024 * 1024), picture), true);
  assert.equal(filterMatches(f, entry('p/small.jpg', 1024), picture), false);
  assert.equal(filterMatches(f, entry('p/big.rs', 2 * 1024 * 1024), code), false);
});

test('an unreadable term is said, and nothing is filtered by it', () => {
  const said = (q: string): string => {
    const f = parseArchiveFilter(q);
    assert.ok('error' in f, `${q} should not read`);
    return f.error;
  };
  assert.match(said('size>big'), /“size>big” is not a size: write size>100kb/);
  assert.match(said('size>10tb'), /is not a size/);
  assert.match(said('size:10kb'), /needs a comparison/);
  assert.match(said('colour:red'), /“colour:” is not a filter/);
  assert.match(said('name:'), /has nothing after it/);
  assert.match(said('reading:picture size>'), /is not a size/, 'one bad term spoils the query');
  assert.match(said('   '), /^Filter by words in the name/);
});
