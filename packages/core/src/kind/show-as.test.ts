// *Show as* and the reader's rules against ADR-0060 item 9 (K-04): the precedence, the kinds.json envelope
// (version guard, cap that refuses and never evicts, quarantine) and what the file may hold.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KINDS } from '../contracts/kinds.ts';
import type { KindRule } from './detect.ts';
import {
  KINDS_CAP,
  KINDS_FILE_VERSION,
  clearShowAs,
  detectFileKind,
  emptyKindsEnvelope,
  folderKindGlob,
  kindPathKey,
  parseKindsFile,
  quarantinePathFor,
  serializeKindsFile,
  setShowAs,
  showAsFor,
} from './show-as.ts';
import type { KindsEnvelope } from './show-as.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const must = (r: ReturnType<typeof setShowAs>): KindsEnvelope => {
  assert.ok(r.ok, 'ok' in r && !r.ok ? r.notice : '');
  return r.envelope;
};

const JSONL = '/Users/ian/.claude/projects/x/session.jsonl';
const RULES: KindRule[] = [
  { glob: '/Users/ian/.claude/projects/**/*.jsonl', is: 'transcript', read: true },
  { glob: '/Users/ian/.claude/**', is: 'report' },
];

test('a rule beats detection', () => {
  assert.equal(detectFileKind({ path: JSONL, head: enc('{"a":1}\n') }).kind, 'data');
  assert.equal(detectFileKind({ path: JSONL, head: enc('{"a":1}\n'), rules: RULES }).kind, 'transcript');
});

test('two rules matching one path: the first in file order wins', () => {
  assert.equal(detectFileKind({ path: JSONL, head: enc(''), rules: RULES }).kind, 'transcript');
  assert.equal(detectFileKind({ path: JSONL, head: enc(''), rules: [...RULES].reverse() }).kind, 'report');
});

test('show as beats a rule; clearing it restores the rule\'s kind', () => {
  const choices = must(setShowAs(emptyKindsEnvelope(), JSONL, 'code'));
  const withChoice = detectFileKind({ path: JSONL, head: enc(''), rules: RULES, choices });
  assert.equal(withChoice.kind, 'code');
  assert.deepEqual(withChoice.reasons.find((r) => r.decisive)?.signal, 'show as');
  const cleared = clearShowAs(choices, JSONL);
  assert.equal(showAsFor(cleared, JSONL), undefined);
  assert.equal(detectFileKind({ path: JSONL, head: enc(''), rules: RULES, choices: cleared }).kind, 'transcript');
});

test('show as for one file leaves its neighbours alone', () => {
  const choices = must(setShowAs(emptyKindsEnvelope(), JSONL, 'code'));
  assert.equal(detectFileKind({ path: '/Users/ian/.claude/projects/x/other.jsonl', head: enc(''), rules: RULES, choices }).kind, 'transcript');
});

test('rules match the way P-02 compares paths: case, ., .., //, Unicode normalisation', () => {
  const rule = (glob: string): KindRule[] => [{ glob, is: 'log' }];
  const kind = (path: string, glob: string): string => detectFileKind({ path, head: enc(''), rules: rule(glob) }).kind;
  // Case: a case-insensitive volume names one folder two ways.
  assert.equal(kind('/Users/ian/notes/a.md', '/Users/ian/Notes/**'), 'log');
  assert.equal(kind('/Users/ian/Notes/A.MD', '/users/ian/notes/*.md'), 'log');
  // . / .. / // in the path being opened
  assert.equal(kind('/Users/ian//notes/./x/../a.md', '/Users/ian/notes/*.md'), 'log');
  assert.equal(kind('/Users/ian/notes/../notes/a.md', '/Users/ian/notes/*.md'), 'log');
  // A path that climbs out of the folder does not match it.
  assert.notEqual(kind('/Users/ian/notes/../other/a.md', '/Users/ian/notes/**'), 'log');
  // Unicode: composed and decomposed spellings are the same folder.
  assert.equal(kind('/n/café/a.md', '/n/café/**'), 'log');
  assert.equal(kind('/n/café/a.md', '/n/café/**'), 'log');
  // The control: nothing else matches.
  assert.notEqual(kind('/Users/ian/other/a.md', '/Users/ian/notes/**'), 'log');
});

test('reasons name the reader\'s own spelling of the rule\'s glob and of the path, not the folded one', () => {
  const r = detectFileKind({ path: '/Users/ian/Notes/README.md', head: enc(''), rules: [{ glob: '/Users/ian/Notes/**', is: 'log' }] });
  assert.equal(r.reasons.find((x) => x.signal === 'reader rule')?.at, '/Users/ian/Notes/**');
  assert.equal(r.reasons.find((x) => x.signal === 'file name')?.at, 'README.md');
});

test('detectFileKind with no rules and no choices is detectKind', () => {
  assert.equal(detectFileKind({ path: '/a/CHANGELOG.md', head: enc('') }).kind, 'changelog');
});

test('the path key is one spelling per file: ., .., //, Unicode, case', () => {
  assert.equal(kindPathKey('/A//b/./c/../D.md'), '/a/b/d.md');
  assert.equal(kindPathKey('/n/café.md'), kindPathKey('/n/CAFÉ.md'));
  assert.equal(kindPathKey('/a/../../x'), '/a/../../x'); // above the root: kept as normalised, never guessed at
  const e = must(setShowAs(emptyKindsEnvelope(), '/Users/ian/Notes/A.md', 'log'));
  assert.equal(showAsFor(e, '/users/ian//notes/./a.md'), 'log');
});

test('show as takes only a kind', () => {
  const r = setShowAs(emptyKindsEnvelope(), '/a.md', 'ai' as never);
  assert.equal(r.ok, false);
});

test('at the cap a new choice is refused with a notice naming the cap, and no earlier choice is lost', () => {
  let e = emptyKindsEnvelope();
  const kinds: Record<string, (typeof KINDS)[number]> = {};
  for (let i = 0; i < KINDS_CAP; i++) kinds[`/f${i}.md`] = 'log';
  e = { ...e, kinds };
  const before = { ...e.kinds };
  const refused = setShowAs(e, '/one-more.md', 'diff');
  assert.equal(refused.ok, false);
  assert.match(!refused.ok ? refused.notice : '', new RegExp(String(KINDS_CAP)));
  assert.deepEqual(e.kinds, before, 'the envelope is untouched');
  assert.equal(Object.keys(e.kinds).length, KINDS_CAP);
  // Changing a file already kept is allowed at the cap: it grows nothing.
  const changed = must(setShowAs(e, '/f0.md', 'diff'));
  assert.equal(Object.keys(changed.kinds).length, KINDS_CAP);
  assert.equal(changed.kinds['/f0.md'], 'diff');
  // Clearing one makes room for a new one.
  assert.ok(setShowAs(clearShowAs(e, '/f1.md'), '/one-more.md', 'diff').ok);
  // The file read back from bytes obeys the same cap and still holds every entry.
  const reread = parseKindsFile(serializeKindsFile(e));
  assert.equal(reread.kind, 'ok');
  assert.equal(Object.keys(reread.envelope.kinds).length, KINDS_CAP);
});

test('a corrupt kinds.json is quarantined (bytes kept) and the envelope starts empty', () => {
  for (const bad of [enc('{not json'), new Uint8Array([0xff, 0xfe, 0x00]), enc('[]'), enc('null'), enc('{"kinds":{}}'), enc('{"version":1,"kinds":[]}'), enc('{"version":"1"}')]) {
    const r = parseKindsFile(bad);
    assert.equal(r.kind, 'quarantined', dec(bad));
    assert.deepEqual(r.envelope, emptyKindsEnvelope());
    if (r.kind === 'quarantined') assert.deepEqual([...r.quarantineBytes], [...bad]);
  }
  assert.match(quarantinePathFor('/data/kinds.json', 123), /\.bad-123$/);
});

test('a newer version is read, flagged read-only, and a kind outside the set is ignored and listed', () => {
  const r = parseKindsFile(enc(JSON.stringify({ version: 2, kinds: { '/a.md': 'log', '/b.md': 'verse', '/c.md': 3 } })));
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.equal(r.newerVersion, true);
  assert.deepEqual(r.envelope.kinds, { '/a.md': 'log' });
  assert.deepEqual((r as { ignored?: string[] }).ignored, ['verse', '3']);
  const current = parseKindsFile(enc(JSON.stringify({ version: KINDS_FILE_VERSION, kinds: {} })));
  assert.equal(current.kind === 'ok' && current.newerVersion, false);
  assert.equal(parseKindsFile(enc('{"version":1}')).kind, 'ok');
});

test('kinds.json holds a kind and nothing else: version and path -> kind, no value, no tool name', () => {
  let e = emptyKindsEnvelope();
  e = must(setShowAs(e, '/Users/ian/.claude/projects/a.jsonl', 'transcript'));
  e = must(setShowAs(e, '/Users/ian/Notes/b.md', 'notes'));
  const text = dec(serializeKindsFile(e));
  const parsed = JSON.parse(text) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed).sort(), ['kinds', 'version']);
  const values = Object.values(parsed.kinds as Record<string, unknown>);
  for (const v of values) assert.ok((KINDS as readonly string[]).includes(v as string), String(v));
  assert.deepEqual(Object.keys(parsed.kinds as object), ['/users/ian/.claude/projects/a.jsonl', '/users/ian/notes/b.md']);
  assert.ok(text.endsWith('\n'));
  // Round trip.
  const back = parseKindsFile(serializeKindsFile(e));
  assert.deepEqual(back.envelope, e);
  // Foreign top-level and per-entry fields in a file are not carried into the next write.
  const foreign = parseKindsFile(enc(JSON.stringify({ version: 1, model: 'x', kinds: { '/a.md': 'log' }, extra: { author: 'Ada' } })));
  assert.deepEqual(Object.keys(JSON.parse(dec(serializeKindsFile(foreign.envelope)))).sort(), ['kinds', 'version']);
});

test('folderKindGlob writes the folder\'s tree with the home folder as ~', () => {
  assert.equal(folderKindGlob('/Users/ian/.claude/projects', '/Users/ian'), '~/.claude/projects/**');
  assert.equal(folderKindGlob('/Users/ian', '/Users/ian'), '~/**');
  assert.equal(folderKindGlob('/Users/iana/x/', '/Users/ian'), '/Users/iana/x/**');
  assert.equal(folderKindGlob('/srv/logs', '/'), '/srv/logs/**');
  assert.equal(folderKindGlob('/', '/Users/ian'), '/**');
});
