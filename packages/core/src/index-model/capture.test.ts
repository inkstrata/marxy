// [[capture]] rules: parse, refusals, and the Privacy line (P-02, ADR-0063).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CAPTURE_PRIVACY_LINE, MAX_CAPTURES, capturePrivacyLines, parseCaptures } from './capture.ts';
import { parseCollection } from './collection.ts';

const home = '/Users/ian';
const own = ['/Users/ian/Library/Application Support/Marxy', '/Users/ian/.config/marxy'];

function run(toml: string, denyGlobs: readonly string[] = []) {
  const text = toml + (denyGlobs.length ? `\n[deny]\nglobs = ${JSON.stringify(denyGlobs)}\n` : '');
  return { res: parseCollection(new TextEncoder().encode(text), { home, ownFolders: own }) };
}

function refused(toml: string, needle: RegExp, denyGlobs: readonly string[] = []) {
  const r = run(toml, denyGlobs).res;
  assert.deepEqual(r.collection.captures, [], toml);
  assert.equal(r.warnings.length, 1, r.warnings.join(' | '));
  assert.match(r.warnings[0]!, /^capture 1 /);
  assert.match(r.warnings[0]!, needle);
}

test('two valid rules parse in order with the right fromBase', () => {
  const r = run(
    '[[capture]]\nfrom = "~/.claude/projects/**/*.jsonl"\nto = "~/Notes/sessions"\n[[capture]]\nfrom = "/data/plans/*.md"\nto = "/notes/plans"\n',
  ).res;
  assert.deepEqual(r.collection.captures, [
    { from: '/Users/ian/.claude/projects/**/*.jsonl', to: '/Users/ian/Notes/sessions', fromBase: '/Users/ian/.claude/projects' },
    { from: '/data/plans/*.md', to: '/notes/plans', fromBase: '/data/plans' },
  ]);
  assert.deepEqual([r.warnings, r.unknownKeys], [[], []]);
});

test('a literal file path takes its folder as fromBase', () => {
  const r = run('[[capture]]\nfrom = "/data/log.txt"\nto = "/notes"\n').res;
  assert.equal(r.collection.captures[0]!.fromBase, '/data');
});

test('refuses a missing from', () => refused('[[capture]]\nto = "/n"\n', /no from/));
test('refuses a non-string from', () => refused('[[capture]]\nfrom = 3\nto = "/n"\n', /no from/));
test('refuses a missing to', () => refused('[[capture]]\nfrom = "/a/*.md"\n', /no to/));
test('refuses a non-string to', () => refused('[[capture]]\nfrom = "/a/*.md"\nto = true\n', /no to/));
test('refuses a relative from', () => refused('[[capture]]\nfrom = "a/*.md"\nto = "/n"\n', /from is not an absolute/));
test('refuses a relative to', () => refused('[[capture]]\nfrom = "/a/*.md"\nto = "notes"\n', /to is not an absolute/));
test('refuses a from with no fixed folder', () => {
  refused('[[capture]]\nfrom = "/**/*.md"\nto = "/n"\n', /no fixed folder/);
  refused('[[capture]]\nfrom = "**/*.md"\nto = "/n"\n', /not an absolute|no fixed folder/);
});
test('refuses a to that is the root or the home folder', () => {
  refused('[[capture]]\nfrom = "/a/*.md"\nto = "/"\n', /root or the home/);
  refused('[[capture]]\nfrom = "/a/*.md"\nto = "~"\n', /root or the home/);
});
test('refuses a loop: to inside fromBase, or fromBase inside to', () => {
  refused('[[capture]]\nfrom = "/a/**/*.md"\nto = "/a/copies"\n', /loop/);
  refused('[[capture]]\nfrom = "/a/b/*.md"\nto = "/a"\n', /loop/);
  refused('[[capture]]\nfrom = "/a/*.md"\nto = "/a"\n', /loop/);
});
test("refuses a to inside Marxy's own folders", () => {
  refused('[[capture]]\nfrom = "/a/*.md"\nto = "~/.config/marxy/captured"\n', /own settings/);
  refused('[[capture]]\nfrom = "/a/*.md"\nto = "~/Library/Application Support/Marxy"\n', /own settings/);
});
test('refuses a to that matches a deny glob', () => {
  refused('[[capture]]\nfrom = "/a/*.md"\nto = "/n/drafts/x"\n', /deny glob/, ['**/drafts/**']);
});

test('unknown keys are reported and a non-list capture is ignored', () => {
  const r = run('[[capture]]\nfrom = "/a/*.md"\nto = "/n"\nmode = "move"\n').res;
  assert.equal(r.collection.captures.length, 1);
  assert.deepEqual(r.unknownKeys, ['capture.mode']);
  const bad = run('capture = "x"\n').res;
  assert.deepEqual(bad.collection.captures, []);
  assert.match(bad.warnings[0]!, /list of \[\[capture\]\]/);
});

test('rules beyond the cap of 32 warn and are dropped', () => {
  let toml = '';
  for (let i = 0; i < MAX_CAPTURES + 1; i++) toml += `[[capture]]\nfrom = "/a${i}/*.md"\nto = "/n${i}"\n`;
  const r = run(toml).res;
  assert.equal(r.collection.captures.length, MAX_CAPTURES);
  assert.match(r.warnings[0]!, /more than 32/);
});

test('parseCaptures with nothing declared yields nothing', () => {
  const r = parseCaptures(undefined, { home, ownFolders: [], denyGlobs: [], resolvePath: () => null });
  assert.deepEqual(r, { captures: [], warnings: [], unknownKeys: [] });
});

test('CAPTURE_PRIVACY_LINE equals the sentence in ADR-0063', () => {
  const adr = readFileSync(new URL('../../../../docs/adr/0063-capture-rules.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.ok(adr.includes(`"${CAPTURE_PRIVACY_LINE}"`), 'ADR-0063 item 6 no longer holds the constant');
});

test('capturePrivacyLines fills each rule in', () => {
  const lines = capturePrivacyLines([{ from: '/a/*.md', to: '/n', fromBase: '/a' }]);
  assert.deepEqual(lines, ['Marxy copies files matching your capture rules from `/a/*.md` to `/n` on this disk, while it is running.']);
});

const rule = (from: string, to: string) => `[[capture]]\nfrom = '${from}'\nto = '${to}'\n`;

test('dot segments, empty segments and case or Unicode form cannot slip past a check', () => {
  const table: [string, string, string, RegExp][] = [
    ['dot-dot loop', '~/Notes/*.md', '~/Notes/../Notes/cp', /loop/],
    ['dot loop', '~/Notes/*.md', '~/Notes/./cp', /loop/],
    ['empty-segment loop', '~/Notes/*.md', '~/Notes//cp', /loop/],
    ['climbing loop', '~/a/**', '~/a/b/../../a/c', /loop/],
    ['dots in from', '~/Notes/x/../**/*.md', '~/Notes/cp', /loop/],
    ['escape into own folder', '~/a/*.md', '~/.config/marxy/../marxy/x', /own settings/],
    ['double leading slash', '~/a/*.md', '//Users/ian/.config/marxy/x', /own settings/],
    ['above the root', '~/a/*.md', '/..', /climbs above/],
    ['up to the root', '~/a/*.md', '~/../..', /root or the home/],
    ['windows dots', 'C:\\a\\*.md', 'C:\\x\\..\\a\\cp', /loop/],
    ['macOS case', '~/notes/*.md', '~/Notes/cp', /loop.*case/],
    ['unicode form', '/n/Caf\u00e9/*.md', '/n/Cafe\u0301/cp', /loop/],
    ['own folder case', '~/a/*.md', '~/.config/Marxy/x', /own settings.*case/],
    ['windows case', 'C:\\Notes\\*.md', 'c:\\notes\\cp', /loop/],
    ['ancestor of own', '~/a/*.md', '~/.config', /holds/],
    ['ancestor of own, app support', '~/a/*.md', '~/Library/Application Support', /holds/],
    ['network share', '~/a/*.md', '\\\\host\\share\\x', /not an absolute/],
    ['dots after a glob', '~/a/*/../b/*.md', '~/n', /climbs above its root or follows a glob/],
  ];
  for (const [name, from, to, needle] of table) {
    const r = run(rule(from, to)).res;
    assert.deepEqual(r.collection.captures, [], name);
    assert.equal(r.warnings.length, 1, `${name}: ${r.warnings.join(' | ')}`);
    assert.match(r.warnings[0]!, needle, name);
  }
});

test('a deny glob is matched against the path as written and the folded path', () => {
  refused(rule('/a/*.md', '/n/Drafts/x'), /deny glob/, ['**/drafts/**']);
});

test('clean dot segments resolve and the resolved form is stored', () => {
  const r = run(rule('~/a/b/../c/*.md', '~/Notes/./cp//x')).res;
  assert.deepEqual(r.collection.captures, [
    { from: '/Users/ian/a/c/*.md', to: '/Users/ian/Notes/cp/x', fromBase: '/Users/ian/a/c' },
  ]);
  assert.deepEqual(r.warnings, []);
});

test('own folders given in ~ form are expanded and resolved', () => {
  const r = parseCollection(new TextEncoder().encode(rule('/a/*.md', '~/.config/marxy/x')), {
    home,
    ownFolders: ['~/.config/./marxy'],
  });
  assert.deepEqual(r.collection.captures, []);
  assert.match(r.warnings[0]!, /own settings/);
});
