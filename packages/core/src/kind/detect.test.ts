// detectKind against ADR-0060: one case per tier, a higher tier beating a lower, the thresholds, the
// never-a-signal rule over the corpus, and the extension-less and README rows (K-03).

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { KINDS } from '../contracts/kinds.ts';
import type { Kind } from '../contracts/kinds.ts';
import { KIND_HEAD_BYTES, KIND_PREFIX_BYTES, detectKind } from './detect.ts';
import type { DetectInput } from './detect.ts';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const kindOf = (path: string, text = '', more: Partial<DetectInput> = {}): Kind =>
  detectKind({ path, head: bytes(text), ...more }).kind;

const lines = (...l: string[]): string => `${l.join('\n')}\n`;
const WORKING = lines('# Plan', '', '## Summary', 'x', '', '## Risks', 'y');
const TRANSCRIPT = lines('# Chat', '', '## You', 'hello', '', '## Assistant', 'hi');
const LOG = lines(
  '2026-10-10T12:00:00Z INFO starting', '2026-10-10T12:00:01Z WARN slow', '2026-10-10T12:00:02Z ERROR boom', '    at main (x.js:1)',
);
const TERMINAL = lines('$ ls', 'a b', '$ pwd', '/home');
const BYLINE = { author: 'Ada', published: '2026-01-01' };

// Tier by tier: [label, path, text, front matter, expected kind, expected deciding tier]
const TIERS: Array<[string, string, string, Record<string, unknown> | undefined, Kind, number]> = [
  ['name: README.md', 'a/README.md', '', undefined, 'readme', 2],
  ['name: CONTRIBUTING.txt', 'CONTRIBUTING.txt', '', undefined, 'readme', 2],
  ['name: CHANGELOG.md', 'CHANGELOG.md', '', undefined, 'changelog', 2],
  ['name: changes.txt (case-insensitive)', 'changes.txt', '', undefined, 'changelog', 2],
  ['name: HISTORY.md', 'HISTORY.md', '', undefined, 'changelog', 2],
  ['format: .diff', 'x.diff', '', undefined, 'diff', 3],
  ['format: .patch', 'x.patch', '', undefined, 'diff', 3],
  ['format: .html', 'x.html', '', undefined, 'html', 3],
  ['format: .htm', 'x.HTM', '', undefined, 'html', 3],
  ['format: .log', 'x.log', '', undefined, 'log', 3],
  ['format: .out', 'x.out', '', undefined, 'log', 3],
  ['format: .term', 'x.term', '', undefined, 'terminal', 3],
  ['format: .session', 'x.session', '', undefined, 'terminal', 3],
  ['format: .json', 'x.json', '{}', undefined, 'data', 3],
  ['format: .jsonl', 'x.jsonl', '{"a":1}\n', undefined, 'data', 3],
  ['format: .yaml', 'x.yaml', '', undefined, 'data', 3],
  ['format: .yml', 'x.yml', '', undefined, 'data', 3],
  ['format: .toml', 'x.toml', '', undefined, 'data', 3],
  ['format: .csv', 'x.csv', '', undefined, 'data', 3],
  ['format: .tsv', 'x.tsv', '', undefined, 'data', 3],
  ['format: source language', 'src/x.rs', '', undefined, 'code', 3],
  ['format: build file', 'Makefile', 'all:\n', undefined, 'code', 3],
  ['format: dotfile', '.gitignore', 'node_modules\n', undefined, 'code', 3],
  ['format: shebang', 'bin/run', '#!/bin/sh\necho\n', undefined, 'code', 3],
  ['format: unknown extension', 'x.conf', 'a = b\n', undefined, 'code', 3],
  ['format: no extension', 'LICENSE', 'MIT License\n', undefined, 'code', 3],
  ['format: AUTHORS', 'AUTHORS', 'Ada\n', undefined, 'code', 3],
  ['shape: JSONL transcript', 'x.jsonl', '{"role":"user","content":"hi"}\n{"role":"assistant","content":"yo"}\n', undefined, 'transcript', 4],
  ['shape: JSONL type field', 'x.jsonl', '{"type":"user","message":{"role":"user"}}\n{"type":"assistant"}\n', undefined, 'transcript', 4],
  ['shape: speaker headings', 'x.md', TRANSCRIPT, undefined, 'transcript', 4],
  ['shape: log in .txt', 'x.txt', LOG, undefined, 'log', 4],
  ['shape: log, extension-less', 'build', LOG, undefined, 'log', 4],
  ['shape: terminal in .txt', 'x.txt', TERMINAL, undefined, 'terminal', 4],
  ['shape: terminal, extension-less', 'session', TERMINAL, undefined, 'terminal', 4],
  ['shape: Chapter heading with long paragraphs', 'x.md', `# Chapter One\n\n${`${'word '.repeat(130)}\n\n`.repeat(3)}`, undefined, 'book', 4],
  ['shape: chapter-numbered name', 'chapter-03.md', 'Once.\n', undefined, 'book', 4],
  ['shape: admonitions', 'x.md', lines('> [!NOTE]', '> a', '', '> [!WARNING]', '> b'), undefined, 'docs', 4],
  ['shape: docs sections', 'x.md', lines('## Parameters', 'a', '## Returns', 'b'), undefined, 'docs', 4],
  ['shape: working headings', 'x.md', WORKING, undefined, 'report', 4],
  ['byline: author and published', 'x.md', 'text\n', BYLINE, 'article', 5],
  ['byline: author and source', 'x.md', 'text\n', { author: 'Ada', source: 'https://e.org' }, 'article', 5],
  ['weak: task list', 'x.md', lines('- [ ] a', '- [x] b'), undefined, 'report', 6],
  ['weak: dated name', '2026-10-10.md', 'text\n', undefined, 'notes', 6],
  ['weak: notes folder', 'notes/x.md', 'text\n', undefined, 'notes', 6],
  ['weak: journal folder', 'a/Journal/x.md', 'text\n', undefined, 'notes', 6],
  ['default: article', 'x.md', 'text\n', undefined, 'article', 7],
  ['default: .txt', 'x.txt', 'text\n', undefined, 'article', 7],
  ['default: empty', 'x.md', '', undefined, 'article', 7],
];

for (const [label, path, text, frontMatter, kind, tier] of TIERS) {
  test(`tier ${tier} decides: ${label}`, () => {
    const result = detectKind({ path, head: bytes(text), frontMatter });
    assert.equal(result.kind, kind);
    const decisive = result.reasons.filter((r) => r.decisive);
    assert.equal(decisive.length, 1);
    assert.equal(decisive[0]!.tier, tier);
    assert.equal(decisive[0]!.kind, kind);
  });
}

test('tier 1: a reader rule beats every other tier; the first matching rule wins', () => {
  const rules = [{ glob: '/p/**/*.jsonl', is: 'transcript' }, { glob: '/p/**', is: 'log' }];
  assert.equal(kindOf('/p/a/b/README.md', TRANSCRIPT, { rules: [{ glob: '/p/**/README.md', is: 'terminal' }] }), 'terminal');
  assert.equal(kindOf('/p/a/s.jsonl', '{"a":1}\n', { rules }), 'transcript');
  assert.equal(kindOf('/p/a/s.md', 'text\n', { rules }), 'log');
  assert.equal(kindOf('/q/s.md', 'text\n', { rules }), 'article');
  assert.equal(kindOf('x.md', '', { rules: [{ glob: '*.md', is: 'book' }] }), 'book');
});

test('tier 1: show as beats a rule; a kind outside the set is ignored', () => {
  assert.equal(kindOf('x.md', '', { showAs: 'diff', rules: [{ glob: '**', is: 'log' }] }), 'diff');
  assert.equal(kindOf('x.md', '', { showAs: 'poem' }), 'article');
  assert.equal(kindOf('x.md', '', { rules: [{ glob: '**', is: 'poem' }] }), 'article');
});

test('a higher tier beats a lower one', () => {
  // name over shape: a README quoting a conversation stays a readme
  assert.equal(kindOf('README.md', TRANSCRIPT), 'readme');
  // format over shape: an .html or .json file with speaker headings keeps its format
  assert.equal(kindOf('x.html', TRANSCRIPT), 'html');
  assert.equal(kindOf('x.json', TRANSCRIPT), 'data');
  assert.equal(kindOf('x.rs', WORKING), 'code');
  // shape over byline: speaker headings plus a byline is still a transcript
  assert.equal(kindOf('x.md', TRANSCRIPT, { frontMatter: BYLINE }), 'transcript');
  assert.equal(kindOf('x.md', WORKING, { frontMatter: BYLINE }), 'report');
  // byline over weak shape and default
  assert.equal(kindOf('notes/x.md', lines('- [ ] a'), { frontMatter: BYLINE }), 'article');
  // weak shape over default
  assert.equal(kindOf('x.md', lines('- [ ] a')), 'report');
  // name over byline
  assert.equal(kindOf('CHANGELOG.md', 'text\n', { frontMatter: BYLINE }), 'changelog');
});

test('inside a tier the strongest wins, and a tie goes to the earlier kind in KINDS', () => {
  const six = lines('## You', 'a', '## Assistant', 'b', '## You', 'c', '## Assistant', 'd', '## You', 'e', '## Assistant', 'f');
  assert.equal(kindOf('x.md', `${six}${WORKING}`), 'transcript'); // 6 speaker headings against 2 working headings
  const tie = lines('## You', 'a', '## Assistant', 'b', '## Summary', 'c', '## Risks', 'd'); // 2 against 2
  assert.ok(KINDS.indexOf('report') < KINDS.indexOf('transcript'));
  assert.equal(kindOf('x.md', tie), 'report');
  assert.equal(kindOf('x.md', lines('- [ ] a'), { rules: [] }), 'report'); // report before notes on a tie
  assert.equal(kindOf('notes/2026-10-10.md', lines('- [ ] a')), 'report');
});

test('thresholds: several is more than one', () => {
  assert.equal(kindOf('x.md', lines('## Summary', 'a')), 'article');
  assert.equal(kindOf('x.md', lines('## Summary', 'a', '## Summary', 'b')), 'article'); // two of one name is one heading
  assert.equal(kindOf('x.md', lines('## Summary', 'a', '## Next steps', 'b')), 'report');
  assert.equal(kindOf('x.md', lines('## Returns', 'a')), 'article');
  assert.equal(kindOf('x.md', lines('> [!NOTE]', '> a')), 'article');
  assert.equal(kindOf('x.md', lines('## Returns', 'a', '> [!NOTE]', '> a')), 'docs');
  assert.equal(kindOf('x.md', lines('## You', 'a')), 'article');
  assert.equal(kindOf('x.md', lines('## You', 'a', '## You', 'b')), 'article'); // one role
  assert.equal(kindOf('x.md', lines('# Chapter 1', 'short')), 'article');
  assert.equal(kindOf('x.txt', lines('2026-10-10T12:00:00Z INFO a', '2026-10-10T12:00:01Z INFO b')), 'article');
  assert.equal(kindOf('x.txt', lines('$ ls', '$ pwd', '$ cd')), 'article'); // prompts with no output
  assert.equal(kindOf('x.txt', lines('$ ls', 'a')), 'article');
});

test('speaker headings: a product or model name is not a speaker', () => {
  assert.equal(kindOf('x.md', lines('## Claude', 'a', '## ChatGPT', 'b', '## Cursor', 'c', '## GPT-5', 'd')), 'article');
  assert.equal(kindOf('x.md', lines('## You', 'a', '## Claude', 'b')), 'article');
  assert.equal(kindOf('x.md', lines('## You', 'a', '## Assistant', 'b')), 'transcript');
});

test('shape counts only prose, never lines inside a code fence', () => {
  const fenced = lines('# Notes', '', '```', '## You', '## Assistant', '$ ls', 'a', '$ pwd', 'b', '```');
  assert.equal(kindOf('x.md', fenced), 'article');
});

test('JSONL: role objects are a transcript, other lines are data', () => {
  assert.equal(kindOf('x.jsonl', '{"model":"m","content":"x"}\n{"model":"m"}\n'), 'data'); // never from model
  assert.equal(kindOf('x.jsonl', '{"id":1}\n{"id":2}\n'), 'data');
  assert.equal(kindOf('x.jsonl', '[1,2]\n[3]\n'), 'data');
  assert.equal(kindOf('x.jsonl', 'not json\n'), 'data');
  assert.equal(kindOf('x.jsonl', '{"role":"user"}\n{"role":"assistant"}\n{"role":"user"'), 'transcript'); // cut-off last line
  assert.equal(kindOf('x.jsonl', '{"role":"user"}\nnope\nnope\nnope\n'), 'data'); // under 80% objects
  assert.equal(kindOf('x.json', '{"role":"user"}\n{"role":"assistant"}\n'), 'data'); // only .jsonl is refined
});

test('ADR-0060 item 3: extension-less and README rows', () => {
  assert.equal(kindOf('LICENSE', 'MIT\n'), 'code');
  assert.equal(kindOf('LICENSE', TRANSCRIPT), 'code'); // shape alone never moves an extension-less file to a Markdown kind
  assert.equal(kindOf('LICENSE', WORKING), 'code');
  assert.equal(kindOf('x.unknownext', TRANSCRIPT), 'code');
  assert.equal(kindOf('README', 'hello\n'), 'readme');
  assert.equal(kindOf('readme', 'hello\n'), 'readme');
  assert.equal(kindOf('CHANGELOG', 'hello\n'), 'changelog');
  assert.equal(kindOf('CHANGES', 'hello\n'), 'changelog');
  assert.equal(kindOf('HISTORY', 'hello\n'), 'changelog');
  assert.equal(kindOf('CONTRIBUTING', 'hello\n'), 'readme');
  assert.equal(kindOf('README.rst', 'hello\n'), 'code');
  assert.equal(kindOf('README.org', 'hello\n'), 'code');
  assert.equal(kindOf('README.html', '<h1>x</h1>'), 'html');
  assert.equal(kindOf('README.txt', 'hello\n'), 'readme');
  assert.equal(kindOf('README.md', 'hello\n'), 'readme');
  assert.equal(kindOf('README.markdown', 'hello\n'), 'readme');
  assert.equal(kindOf('docs/README', 'hello\n'), 'readme');
  assert.equal(kindOf('CHANGELOG.rst', 'hello\n'), 'code');
});

test('the extension-less file outside the text family can be a log or a terminal session', () => {
  assert.equal(kindOf('output', LOG), 'log');
  assert.equal(kindOf('output', TERMINAL), 'terminal');
  assert.equal(kindOf('output', 'plain\n'), 'code');
  assert.equal(kindOf('x.conf', LOG), 'code'); // a named unknown extension stays code
});

test('each reason names its tier, signal, kind and where it was seen', () => {
  const { kind, reasons } = detectKind({ path: 'README.md', head: bytes(TRANSCRIPT) });
  assert.equal(kind, 'readme');
  assert.deepEqual(reasons.map((r) => [r.tier, r.kind, r.decisive]), [[2, 'readme', true], [4, 'transcript', false], [7, 'article', false]]);
  assert.equal(reasons[0]!.at, 'README.md');
  assert.equal(reasons[1]!.at, 'line 3');
  const rule = detectKind({ path: '/a/b.md', head: bytes(''), rules: [{ glob: '/a/*.md', is: 'book' }] });
  assert.deepEqual(rule.reasons[0], { tier: 1, signal: 'reader rule', kind: 'book', at: '/a/*.md', decisive: true });
});

test('the prefix is measured from the end of the front matter', () => {
  const long = `---\n${'title: x\n'.repeat(3000)}---\n`; // far longer than the body prefix
  assert.ok(long.length > KIND_PREFIX_BYTES);
  assert.equal(kindOf('x.md', long + WORKING), 'report');
  assert.equal(kindOf('x.md', long + WORKING.replace('# Plan', '# Plan\n')), 'report');
  // a signal beyond the prefix is not read
  assert.equal(kindOf('x.md', `${'text\n'.repeat(KIND_PREFIX_BYTES)}${WORKING}`), 'article');
  assert.ok(KIND_HEAD_BYTES > KIND_PREFIX_BYTES);
  // front matter with CRLF and a BOM
  assert.equal(kindOf('x.md', `﻿---\r\nauthor: Ada\r\npublished: 2026\r\n---\r\ntext\r\n`), 'article');
  assert.equal(kindOf('x.md', `﻿---\r\ntitle: A\r\n---\r\n${WORKING}`), 'report');
});

test('byline: read from the head when no parsed front matter is given; presence only', () => {
  const fm = (block: string): string => `---\n${block}\n---\ntext\n`;
  const notes = (text: string): Kind => kindOf('notes/x.md', text);
  assert.equal(notes(fm('author: Ada\npublished: 2026-01-01')), 'article');
  assert.equal(notes(fm('author: Ada\nsource: https://e.org')), 'article');
  assert.equal(notes(fm('author: Ada')), 'notes'); // no published or source
  assert.equal(notes(fm('published: 2026-01-01')), 'notes'); // no author
  assert.equal(notes(fm('author:\npublished: 2026-01-01')), 'notes'); // empty author counts as absent
  assert.equal(notes(fm('author: ~\npublished: 2026-01-01')), 'notes');
  assert.equal(notes(fm('author:\n  - Ada\npublished: 2026-01-01')), 'article');
  assert.equal(kindOf('notes/x.md', 'x\n', { frontMatter: { author: '', published: 'x' } }), 'notes');
  assert.equal(kindOf('notes/x.md', 'x\n', { frontMatter: { author: null, published: 'x' } }), 'notes');
  assert.equal(kindOf('notes/x.md', 'x\n', { frontMatter: { author: 'an agent', published: 'x' } }), 'article'); // value is never read
});

// ---- never from who wrote it, over the corpus ----

const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);
const files = readdirSync(corpus).sort();
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(name, corpus)));
const detect = (path: string, head: Uint8Array, frontMatter?: Record<string, unknown>): Kind =>
  detectKind({ path, head: head.subarray(0, KIND_HEAD_BYTES), frontMatter }).kind;

/** Parse a corpus file's top-level front matter into a key and value map, and write a map back. */
function split(head: Uint8Array): { map: Record<string, string>; body: string } {
  const text = new TextDecoder().decode(head);
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n/.exec(text);
  if (!m) return { map: {}, body: text };
  const map: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (kv) map[kv[1]!] = kv[2]!;
  }
  return { map, body: text.slice(m[0].length) };
}
const join = (map: Record<string, string>, body: string): Uint8Array =>
  bytes(`---\n${Object.entries(map).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n${body}`);

const BYLINE_KEYS = new Set(['author', 'published', 'source']);

test('corpus: front matter keys and values other than the byline never change the kind', () => {
  assert.ok(files.length > 20);
  let withFrontMatter = 0;
  for (const name of files) {
    if (!/\.(md|txt)$/.test(name)) continue;
    const head = read(name);
    const { map, body } = split(head);
    if (Object.keys(map).length > 0) withFrontMatter++;
    const base = detect(name, join(map, body));
    const check = (label: string, changed: Record<string, string>): void => {
      assert.equal(detect(name, join(changed, body)), base, `${name}: ${label}`);
      assert.equal(detect(name, bytes(body), changed), base, `${name}: ${label} (parsed)`);
    };
    for (const key of Object.keys(map)) {
      if (BYLINE_KEYS.has(key)) continue;
      const without = { ...map };
      delete without[key];
      check(`remove ${key}`, without);
      check(`change ${key}`, { ...map, [key]: 'something else entirely' });
    }
    // keys that name a tool, a model, a session or who wrote it: added, never read
    check('add model', { ...map, model: 'claude-opus' });
    check('add generated_by', { ...map, generated_by: 'an agent' });
    check('add session', { ...map, session: 'abc123' });
    check('add tool', { ...map, tool: 'cursor', agent: 'codex', created_by: 'a person' });
    // the byline keys' values change nothing, only their presence
    for (const key of ['author', 'published', 'source']) {
      if (map[key] !== undefined) check(`change ${key} value`, { ...map, [key]: 'Another Person' });
    }
  }
  assert.ok(withFrontMatter >= 2, 'the corpus has front matter files');
});

test('corpus: moving a file under .claude/, .cursor/ or .codex/ never changes its kind', () => {
  for (const name of files) {
    const head = read(name);
    const base = detect(name, head);
    for (const dir of ['.claude/', '.cursor/rules/', '.codex/', '/Users/a/.claude/projects/x/', '.claude/notes-agent/']) {
      assert.equal(detect(`${dir}${name}`, head), base, `${dir}${name}`);
    }
  }
});

test('corpus: every kind is one of the fourteen and every file has a decisive reason', () => {
  for (const name of files) {
    const { kind, reasons } = detectKind({ path: name, head: read(name).subarray(0, KIND_HEAD_BYTES) });
    assert.ok((KINDS as readonly string[]).includes(kind), name);
    assert.equal(reasons.filter((r) => r.decisive).length, 1, name);
  }
});
