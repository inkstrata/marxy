// The library's shape and the fidelity property over every entry (J-03; ADR-0004, ADR-0065 item 4).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseMarkdown } from '../parse/parse.ts';
import { corpusDocuments } from '../operations/testing/corpus.ts';
import {
  assertLineSeparatorsPreserved, canFail, cr, crlf, mixedAllEndings, mixedEndings, nestedCodeDocuments, stackedMarkerDocuments, withBom,
} from '../operations/testing/test-kit.ts';
import { CATALOGUE, DEFINITION_IDS, NOT_YET, TRANSFORMS, runTransform, transformById } from './registry.ts';
import ids from './ids.json' with { type: 'json' };
import { nodesOf } from './prose.ts';

const MOCK = new URL('../../../../docs/plan/direction-2026-10/mock-v2/06-clipboard.md', import.meta.url);

test('the catalogue is the mockup\'s table: 50 ids and names, in order, each once', () => {
  const table = readFileSync(MOCK, 'utf8')
    .split('\n')
    .filter((l) => /^\| (Clean|Convert|Lines|Case|Extract) \| `/.test(l))
    .map((l) => l.split('|').map((c) => c.trim()))
    .map((c) => ({ id: c[2]!.replaceAll('`', ''), name: c[3]!, group: c[1]! }));
  assert.equal(table.length, 50);
  assert.deepEqual(ids, table);
  assert.equal(new Set(ids.map((e) => e.id)).size, 50, 'an id appears twice');
  assert.deepEqual(CATALOGUE, ids);
});

test('every catalogue id is implemented or listed "not yet" with a reason, never both, and nothing else is registered', () => {
  const implemented = new Set(TRANSFORMS.map((t) => t.id));
  for (const { id } of CATALOGUE) {
    const notYet = Object.hasOwn(NOT_YET, id);
    assert.ok(implemented.has(id) !== notYet, `${id}: must be exactly one of implemented and not-yet`);
    if (notYet) assert.ok(NOT_YET[id]!.trim().length > 12, `${id}: the reason is missing`);
  }
  for (const id of Object.keys(NOT_YET)) assert.ok(CATALOGUE.some((e) => e.id === id), `${id} is in NOT_YET but not in the catalogue`);
  for (const id of DEFINITION_IDS) assert.ok(CATALOGUE.some((e) => e.id === id), `${id} is defined but not in the catalogue`);
  assert.equal(new Set(DEFINITION_IDS).size, DEFINITION_IDS.length, 'a definition is registered twice');
});

test('a transform has an id, a name and a group, and an unknown id leaves the text alone', () => {
  for (const t of TRANSFORMS) {
    assert.match(t.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(t.name.length > 0 && t.group.length > 0);
    assert.equal(transformById(t.id), t);
  }
  assert.equal(runTransform('no-such-id', 'x\n'), 'x\n');
  assert.equal(runTransform('wrap-eighty', 'x\n'), 'x\n', 'an id the catalogue lacks leaves the text alone');
});

// -------------------------------------------------------------------------------------------------
// The fidelity property: the same sweep for every entry.

const lf = (s: string): string => s.replace(/\r\n|\r/g, '\n');

const EXTRA = [
  '', '\n', 'one line, no break', '# T\n\ntext **b** [1] "q" 🚀\n\n- a\n- b\n\n---\n\n```\n# code\n```\n',
  '---\ntitle: x\n---\n\n# H\n\n> quote\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n{"a": [1, 2]}\n',
  'é ü 日本語\n\n\n\nlast\n\n',
];

function inputs(): { name: string; text: string }[] {
  return [
    ...corpusDocuments().map(({ file, bytes }) => ({ name: file, text: lf(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes).replace(/^﻿/, '')) })),
    ...EXTRA.map((text, i) => ({ name: `extra ${i}`, text })),
    ...stackedMarkerDocuments().map((text, i) => ({ name: `stacked markers ${i}`, text })),
  ];
}

for (const t of TRANSFORMS) {
  test(`${t.id}: deterministic; keeps LF, CRLF, CR, a mixed file and a BOM`, () => {
    for (const { name, text } of inputs()) {
      const at = `${t.id} on ${name}`;
      const base = t.fn(text);
      assert.equal(t.fn(text), base, `${at}: not deterministic`);
      if (t.kind === 'literal') continue; // the output quotes the line endings: json-string.test covers it
      // With no line break in the input there is no ending to follow: a new break is LF.
      if (/\n/.test(text)) assert.equal(t.fn(crlf(text)), crlf(base), `${at}: CRLF input must give CRLF output`);
      if (/\n/.test(text)) assert.equal(t.fn(cr(text)), cr(base), `${at}: CR input must give CR output`);
      for (const seed of [1]) {
        for (const mixed of [mixedEndings(text, seed), mixedAllEndings(text, seed)]) {
          const out = t.fn(mixed);
          assertLineSeparatorsPreserved(mixed, out, `${at}: mixed input`);
          // (A lone CR followed by an LF reads as one CRLF, so the mixed text's own LF form is what decides a no-op.)
          if (t.fn(lf(mixed)) === lf(mixed)) assert.equal(out, mixed, `${at}: a no-op must return the bytes as they were`);
        }
      }
      const bommed = t.fn(withBom(text));
      if (t.kind === 'edit') assert.equal(bommed, withBom(base), `${at}: a BOM must stay`);
      else assert.ok(bommed === base || (base === text && bommed === withBom(text)), `${at}: a BOM is not content`);
    }
  });

  if (t.idempotent) {
    test(`${t.id}: idempotent`, () => {
      for (const { name, text } of inputs()) {
        const once = t.fn(text);
        assert.equal(t.fn(once), once, `${t.id} on ${name}`);
      }
    });
  }
}

// Code blocks, math blocks and front matter: the bytes a prose transform must hand back as it was.
function protectedTexts(text: string): string[] {
  const doc = parseMarkdown(new TextEncoder().encode(text), { file: 'x' });
  return nodesOf(text, doc, ['codeBlock', 'mathBlock', 'frontmatter']).map(({ span }) => text.slice(span.start, span.end));
}

function assertProtectedKept(id: string, fn: (s: string) => string): void {
  let checked = 0;
  for (const { name, text } of inputs()) {
    const out = fn(text);
    for (const block of protectedTexts(text)) {
      checked++;
      assert.ok(out.includes(block), `${id} on ${name}: a code block or front matter changed:\n${block.slice(0, 120)}`);
    }
  }
  assert.ok(checked > 20, 'the corpus must hold enough blocks to mean something');
}

for (const t of TRANSFORMS.filter((x) => x.outsideCode)) {
  test(`${t.id}: code blocks, math blocks and front matter come back byte for byte`, () => assertProtectedKept(t.id, t.fn));
}

// Per-line endings (commitment 3): in a file that mixes endings, a transform that keeps the line count keeps line i's own
// ending on line i, and one that only moves or drops lines (Lines group) never writes a line with an ending it did not have.
test('mixed endings: every transform keeps each line\'s own ending', () => {
  const endingsOf = (s: string): string[] => s.match(/\r\n|\r|\n/g) ?? [];
  const text = '# Title\n\nA **b** line\nsecond line\n\n- x\n- y\n\n## Sub\n\nlast?\n';
  const mixed = mixedEndings(text, 7).replace(/\n\n/, '\r\n\r');
  for (const t of TRANSFORMS.filter((x) => x.kind === 'edit' && x.group !== 'Lines')) {
    const out = t.fn(mixed);
    const before = endingsOf(mixed);
    const after = endingsOf(out);
    if (after.length === before.length) assert.deepEqual(after, before, `${t.id}: a line's ending changed`);
    else for (const e of new Set(after)) assert.ok(before.includes(e), `${t.id}: wrote an ending the input lacks`);
  }
  for (const id of ['sort', 'sort-unique', 'dedupe', 'reverse']) {
    const lines = new Set(mixed.match(/[^\r\n]*(?:\r\n|\r|\n)/g));
    for (const l of transformById(id)!.fn(mixed).match(/[^\r\n]*(?:\r\n|\r|\n)/g) ?? []) assert.ok(lines.has(l), `${id}: ${JSON.stringify(l)}`);
  }
});

// F-51: a block nested in a list or quote starts after its container's indent; the whole line, from its line start,
// is the code's, so a prose transform that strips or rewrites the bytes before the block is a failure.
function codeBlockRuns(text: string): string[][] {
  const doc = parseMarkdown(new TextEncoder().encode(text), { file: 'x' });
  return nodesOf(text, doc, ['codeBlock']).map(({ span }) => {
    const from = text.lastIndexOf('\n', span.start - 1) + 1;
    return text.slice(from, span.end).split('\n');
  });
}

function assertCodeLinesKept(id: string, fn: (s: string) => string): void {
  let checked = 0;
  for (const text of nestedCodeDocuments()) {
    const out = fn(text).split('\n');
    // Each block's lines come out as one contiguous run, and the blocks keep their order.
    let from = 0;
    for (const block of codeBlockRuns(text)) {
      checked += block.length;
      let at = -1;
      for (let i = from; i + block.length <= out.length && at < 0; i++) if (block.every((l, k) => out[i + k] === l)) at = i;
      assert.ok(at >= 0, `${id}: a code block changed or moved: ${JSON.stringify(block)} in ${JSON.stringify(text)}`);
      from = at + block.length;
    }
  }
  assert.ok(checked > 20);
}

for (const t of TRANSFORMS.filter((x) => x.outsideCode)) {
  test(`${t.id}: code nested in a list or quote keeps its lines from their line start (F-51)`, () => {
    assertCodeLinesKept(t.id, t.fn);
    assertCodeLinesKept(`${t.id} (CRLF)`, (s) => t.fn(crlf(s)).replace(/\r\n/g, '\n'));
  });
}

test('the nested-code property can fail', () => {
  canFail(() => assertCodeLinesKept('trim', (s) => s.replace(/[ \t]+$/gm, '')));
  canFail(() => assertCodeLinesKept('unindent', (s) => s.replace(/^ +/gm, '')));
});

test('the protected-bytes property can fail', () => {
  canFail(() => assertProtectedKept('upper', (s) => s.toUpperCase()));
  canFail(() => assertProtectedKept('trim', (s) => s.replace(/[ \t]+$/gm, '')));
});

test('the line-separator property can fail', () => {
  canFail(() => assertLineSeparatorsPreserved('a\r\nb\r\n', 'a\nb\n'));
});

test('a transform given a fenced block alone returns the fence\'s bytes unchanged', () => {
  const fence = '~~~md\n# Title\n**bold** 🚀 [1]\n\n\n\n* x\n~~~\n';
  for (const t of TRANSFORMS.filter((x) => x.outsideCode)) {
    assert.equal(t.fn(fence), fence, t.id);
    assert.equal(t.fn(crlf(fence)), crlf(fence), `${t.id} (CRLF)`);
  }
});
