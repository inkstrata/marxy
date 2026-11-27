import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { byteOfLine, excerpt, findPattern, fuzzy, lineCount, lineHits, lineOfByte, lineQuery, linesOf, referenceQuery, resolveReference } from './refs.ts';
import { footHints, KEEP_IN, SCOPES, scopeOf } from './scopes.ts';

test('the first character picks the scope; anything else is Go', () => {
  assert.deepEqual(
    SCOPES.map((s) => s.mark),
    ['>', '@', ':', '/', '#', '=', '!', '%', '~', '&', '?'],
  );
  assert.equal(scopeOf('').scope.id, 'go');
  assert.equal(scopeOf('watcher').scope.id, 'go');
  assert.equal(scopeOf(' >x').scope.id, 'go', 'a leading space never picks one');
  assert.deepEqual([scopeOf('>save ').scope.id, scopeOf('>save ').q], ['cmd', 'save']);
  assert.deepEqual([scopeOf('#debounce').scope.id, scopeOf('#debounce').q], ['grep', 'debounce']);
  assert.deepEqual([scopeOf('/re/i').scope.id, scopeOf('/re/i').q], ['find', 're/i']);
  assert.equal(scopeOf('&').scope.label, 'Read this as');
  assert.equal(KEEP_IN.grep, 'search');
  assert.equal(KEEP_IN.outline, 'outline');
  assert.equal(KEEP_IN.cmd, undefined);
  assert.deepEqual(footHints('tx')[0], ['Enter', 'stage the change; nothing is written']);
});

test('lines and ranges; written references', () => {
  assert.deepEqual(lineQuery('120'), { from: 120, to: null });
  assert.deepEqual(lineQuery('40-52'), { from: 40, to: 52 });
  assert.deepEqual(lineQuery('40 – 52'), { from: 40, to: 52 });
  assert.deepEqual(lineQuery('52-40'), { from: 52, to: null });
  assert.equal(lineQuery('0'), null);
  assert.equal(lineQuery('x12'), null);
  assert.deepEqual(referenceQuery('docs/plan.md:12-18'), { path: 'docs/plan.md', from: 12, to: 18 });
  assert.deepEqual(referenceQuery('`src/watcher.ts:31`'), { path: 'src/watcher.ts', from: 31, to: null });
  assert.deepEqual(referenceQuery('C:/r/a.md:3'), { path: 'C:/r/a.md', from: 3, to: null });
  assert.equal(referenceQuery('plan.md'), null);
  assert.equal(referenceQuery('12'), null);
  const paths = ['/w/docs/plan.md', '/w/src/watcher.ts', '/x/src/watcher.ts'];
  assert.equal(resolveReference('/w/docs/plan.md', paths, null), '/w/docs/plan.md');
  assert.equal(resolveReference('plan.md', paths, '/w/docs/other.md'), '/w/docs/plan.md');
  assert.equal(resolveReference('docs/plan.md', paths, null), '/w/docs/plan.md');
  assert.equal(resolveReference('src/watcher.ts', paths, '/x/README.md'), '/x/src/watcher.ts');
  assert.equal(resolveReference('src/watcher.ts', paths, null), null, 'two and no open document to choose by');
  assert.equal(resolveReference('nope.md', paths, null), null);
});

test('a reference on Windows matches either slash and any case, and comes back as the index spells it', () => {
  const paths = ['C:/w/Docs/Plan.md', 'C:/w/src/watcher.ts', 'C:/x/src/watcher.ts'];
  assert.equal(resolveReference('docs\\plan.md', paths, null), 'C:/w/Docs/Plan.md');
  assert.equal(resolveReference('C:\\W\\docs\\plan.md', paths, null), 'C:/w/Docs/Plan.md');
  assert.equal(resolveReference('plan.md', paths, 'C:\\w\\docs\\other.md'), 'C:/w/Docs/Plan.md');
  assert.equal(resolveReference('src/watcher.ts', paths, 'c:\\X\\README.md'), 'C:/x/src/watcher.ts');
  // Elsewhere a backslash is a name character and case counts.
  assert.equal(resolveReference('a\\b.md', ['/w/a\\b.md', '/w/a/b.md'], null), '/w/a\\b.md');
  assert.equal(resolveReference('PLAN.md', ['/w/plan.md'], null), null);
});

test('find patterns: a regular expression between slashes, a capital makes it exact', () => {
  const lower = findPattern('debounce').re!;
  assert.ok(lower.flags.includes('i'));
  assert.ok(lower.test('DEBOUNCE'));
  const exact = findPattern('Debounce').re!;
  assert.ok(!exact.flags.includes('i'));
  assert.equal(lineHits(['debounce Debounce'], exact).length, 1);
  const re = findPattern('/de(b|c)ounce/i').re!;
  assert.ok(re.flags.includes('i') && re.flags.includes('g'));
  assert.equal(lineHits(['DEBOUNCE, decounce'], re).length, 2);
  assert.ok(findPattern('/(/').error);
  assert.equal(findPattern('').re, null);
});

test('lines of bytes: LF, CRLF and a lone CR each end one; a final break opens none', () => {
  const b = new TextEncoder().encode('one\r\ntwo\rthree\nfour\n');
  assert.equal(lineCount(b), 4);
  assert.equal(byteOfLine(b, 1), 0);
  assert.equal(byteOfLine(b, 2), 5);
  assert.equal(byteOfLine(b, 3), 9);
  assert.equal(byteOfLine(b, 4), 15);
  assert.equal(byteOfLine(b, 5), null);
  assert.equal(lineOfByte(b, 10), 3);
  assert.equal(lineCount(new Uint8Array()), 0);
  assert.deepEqual(linesOf('a\r\nb\rc\n'), ['a', 'b', 'c']);
});

test('excerpts and the fuzzy match', () => {
  assert.deepEqual(excerpt('the quick brown fox', 10, 5, 4, 4), { before: '…ick ', match: 'brown', after: ' fox' });
  const m = fuzzy('rollb', 'Rollback')!;
  assert.deepEqual(m.idx, [0, 1, 2, 3, 4]);
  assert.equal(fuzzy('zz', 'Rollback'), null);
  assert.ok(fuzzy('src wat', 'src/watcher.ts')!.score > fuzzy('swt', 'src/watcher.ts')!.score);
});
