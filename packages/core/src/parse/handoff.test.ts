// A parse handed across a thread boundary is the parse made here. Every Markdown file of the fixtures, and the shapes
// whose notes matter (definitions, nesting too deep, a BOM, CRLF), is parsed, cut into pieces, copied as postMessage
// copies (structuredClone) and put back together; the result must equal `parseMarkdown` of the same bytes in its tree,
// its line starts, its notes, its rendered and sanitised HTML (so every `data-marxy-s` / `data-marxy-e`), and in what a
// reparse after an edit makes of it.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Block, Document } from '../contracts/ast.ts';
import { renderDocumentSafeHtml } from '../render/pipeline.ts';
import { lineStartAt } from '../sourcemap/line-starts.ts';
import { definitionIndex, holdsDefinitions, nestedTooDeepText, type ParseNotes } from './from-mdast.ts';
import { documentFromHandoff, type DocumentHead, handoffPieces } from './handoff.ts';
import { parseMarkdown } from './parse.ts';
import { reparseMarkdown } from './reparse.ts';

const fixtures = fileURLToPath(new URL('../../../../fixtures/', import.meta.url));
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

function markdownUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...markdownUnder(path)); // scale: the fixture folders, a few dozen files
    else if (/\.(md|markdown)$/i.test(name)) out.push(path);
  }
  return out;
}

/** The parse of `bytes` as a worker sends it, each piece copied as postMessage copies it, put back together here. */
function handedOver(bytes: Uint8Array, file: string, pieceBytes?: number): { document: Document; pieces: number } {
  let head: DocumentHead | undefined;
  let notes: ParseNotes | undefined;
  const blocks: Block[] = [];
  let pieces = 0;
  for (const sent of handoffPieces(parseMarkdown(bytes, { file }), pieceBytes)) {
    const piece = structuredClone(sent);
    pieces++;
    if ('head' in piece) head = piece.head;
    else if ('blocks' in piece) for (const block of piece.blocks) blocks.push(block);
    else notes = piece.notes;
  }
  return { document: documentFromHandoff(head!, blocks, notes!, bytes), pieces };
}

function assertSame(bytes: Uint8Array, where: string, pieceBytes?: number): number {
  const file = '/h.md';
  const here = parseMarkdown(bytes, { file });
  const { document: there, pieces } = handedOver(bytes, file, pieceBytes);
  assert.equal(JSON.stringify(there), JSON.stringify(here), `${where}: the tree`);
  assert.equal(holdsDefinitions(there), holdsDefinitions(here), `${where}: holds a definition`);
  assert.deepEqual(definitionIndex(there), definitionIndex(here), `${where}: the definitions index`);
  assert.equal(nestedTooDeepText(there), nestedTooDeepText(here), `${where}: nested too deep`);
  for (let at = 0; at <= bytes.length; at += Math.max(1, Math.floor(bytes.length / 200))) {
    assert.equal(lineStartAt(there, at), lineStartAt(here, at), `${where}: line start at byte ${at}`);
  }
  assert.equal(renderDocumentSafeHtml(there).html, renderDocumentSafeHtml(here).html, `${where}: the page`);
  // An edit in the middle reparses the region with the file's definitions known, from the notes the copy was given.
  const mid = bytes.indexOf(0x0a, bytes.length >> 1);
  if (mid > 0) {
    const after = new Uint8Array(bytes.length + 2);
    after.set(bytes.subarray(0, mid));
    after.set(encode('x\n'), mid);
    after.set(bytes.subarray(mid), mid + 2);
    assert.equal(JSON.stringify(reparseMarkdown(there, bytes, after, { file })), JSON.stringify(reparseMarkdown(here, bytes, after, { file })), `${where}: a reparse after an edit`);
  }
  return pieces;
}

test('every Markdown fixture handed over is the parse made here, and draws the same page', () => {
  const files = markdownUnder(fixtures);
  assert.ok(files.length > 40, `${files.length} fixtures`);
  for (const path of files) assertSame(new Uint8Array(readFileSync(path)), path.slice(fixtures.length), 2048);
});

test('definitions, nesting too deep, a BOM and CRLF keep their notes across', () => {
  const prose = Array.from({ length: 300 }, (_, i) => `Paragraph ${i} cites [a source][r${i}] and a note.[^n${i}]`).join('\n\n');
  const defs = Array.from({ length: 300 }, (_, i) => `[r${i}]: https://example.org/${i}\n[^n${i}]: Note ${i}.`).join('\n');
  const references = encode(`# References\n\n${prose}\n\n${defs}\n`);
  assert.ok(assertSame(references, 'references', 1024) > 10, 'cut into many pieces');
  assert.equal(holdsDefinitions(handedOver(references, '/h.md').document), true);
  assertSame(encode(`${'> '.repeat(80)}deep\n\nafter\n`), 'nested too deep');
  assertSame(encode(`﻿# Title\r\n\r\nA [link][a].\r\n\r\n[a]: /x\r\n`), 'BOM and CRLF');
  assertSame(encode(''), 'empty');
});

test('pieces are cut at top-level blocks, about a piece of source each, a large block alone', () => {
  const big = `${'word '.repeat(4000)}\n\n`;
  const text = `${Array.from({ length: 50 }, (_, i) => `Short ${i}.\n\n`).join('')}${big}${Array.from({ length: 50 }, (_, i) => `More ${i}.\n\n`).join('')}`;
  const sizes: number[] = [];
  for (const piece of handoffPieces(parseMarkdown(encode(text)), 256)) if ('blocks' in piece) sizes.push(piece.blocks.length);
  assert.equal(sizes.reduce((a, b) => a + b, 0), 101);
  assert.ok(sizes.includes(1), 'the large paragraph went alone');
  assert.ok(sizes.length >= 5 && sizes.length <= 8, `${sizes.length} pieces`);
});
