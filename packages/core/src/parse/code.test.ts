// A code file is one code block (V-10): no heading from a `#` comment, every byte in one block, invariants hold.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { CodeBlock, Node } from '../contracts/ast.ts';
import { CODE_CHUNK_LINES, codeLanguageOf, isCodeFile, parseCode } from './code.ts';
import { checkInvariants } from './invariants.ts';
import { outlineFrom } from '../outline/index.ts';
import { parseMarkdown } from './parse.ts';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const walk = (node: Node, into: Node[] = []): Node[] => {
  into.push(node);
  for (const child of node.children ?? []) walk(child, into);
  return into;
};

const PY = '# Inventory\n\n## section one\ndef f():\n\t# tab comment *not emphasis*\n    return 1  # _x_\n';

test('a `#` comment in a .py file is no heading, and the file is code blocks over all its bytes', () => {
  const bytes = encode(PY);
  assert.ok(walk(parseMarkdown(bytes, { file: 'x.py' })).some((n) => n.type === 'heading'), 'precondition: Markdown does read headings here');
  const doc = parseCode(bytes, { file: 'x.py', lang: 'python' });
  assert.deepEqual(doc.children.map((c) => c.type), ['codeBlock']);
  assert.ok(!walk(doc).some((n) => n.type === 'heading' || n.type === 'emphasis'));
  const block = doc.children[0] as CodeBlock;
  assert.deepEqual(block.src, { file: 'x.py', start: 0, end: bytes.length });
  assert.deepEqual(block.content, block.src);
  assert.equal(block.lang, 'python');
  assert.equal(block.value, PY.slice(0, -1));
  assert.deepEqual(checkInvariants(doc, bytes), []);
});

test('provenance is byte-exact with a BOM, CRLF, multibyte text, a blank last line and no final newline', () => {
  for (const text of ['﻿# a\r\nb\r\n', 'é\n\n', '\n', 'no end', '😀 = 1\n']) {
    const bytes = encode(text);
    const doc = parseCode(bytes, { file: 'x.py' });
    assert.deepEqual(checkInvariants(doc, bytes), [], JSON.stringify(text));
    const block = doc.children[0] as CodeBlock;
    const start = text.startsWith('﻿') ? 3 : 0;
    assert.deepEqual([block.src.start, block.src.end], [start, bytes.length]);
  }
});

test('an empty file has no block, and a file with no grammar has no lang', () => {
  assert.deepEqual(parseCode(new Uint8Array(0), { file: 'x.py' }).children, []);
  assert.equal((parseCode(encode('a\n'), { file: 'x.log' }).children[0] as CodeBlock).lang, undefined);
});

test('the file-type table decides which files are code', () => {
  assert.ok(isCodeFile('/r/inventory.py') && isCodeFile('/r/Makefile') && isCodeFile('/r/a.rs'));
  // Read by their own stories, or trust-gated: they stay as they render today.
  for (const name of ['a.html', 'a.htm', 'a.log', 'a.csv', 'a.tsv', 'a.jsonl']) assert.ok(!isCodeFile(`/r/${name}`), name);
  assert.ok(!isCodeFile('/r/a.md') && !isCodeFile('/r/a.txt') && !isCodeFile('/r/README') && !isCodeFile('/r/theme.css') && !isCodeFile('/r/unknown.xyz'));
  assert.equal(codeLanguageOf('/r/a.sh'), 'bash');
});

test('a code file has no outline (symbols are K-13)', () => {
  const bytes = encode(PY);
  assert.deepEqual(outlineFrom(parseCode(bytes, { file: 'x.py', lang: 'python' })), []);
  assert.ok(outlineFrom(parseMarkdown(bytes, { file: 'x.py' })).length > 0, 'precondition: Markdown made an outline from the comments');
});

test('a long file is pieces of at most 200 lines that tile its bytes, with no gap and no overlap', () => {
  for (const ending of ['\n', '\r\n', '\r']) {
    const lines = Array.from({ length: CODE_CHUNK_LINES * 2 + 7 }, (_, i) => `line ${i} é`);
    for (const tail of [ending, '']) {
      const text = lines.join(ending) + tail;
      const bytes = encode(text);
      const doc = parseCode(bytes, { file: 'x.py', lang: 'python' });
      const pieces = doc.children as CodeBlock[];
      assert.equal(pieces.length, 3);
      assert.ok(pieces.every((p) => p.run === true && p.lang === 'python'));
      assert.equal(pieces[0]!.src.start, 0);
      assert.equal(pieces.at(-1)!.src.end, bytes.length);
      pieces.forEach((p, i) => {
        if (i > 0) assert.equal(p.src.start, pieces[i - 1]!.src.end);
        assert.ok(p.value.split(/\r\n|\r|\n/).length <= CODE_CHUNK_LINES + 1);
      });
      assert.equal(pieces.map((p) => new TextDecoder().decode(bytes.subarray(p.src.start, p.src.end))).join(''), text);
      assert.deepEqual(checkInvariants(doc, bytes), [], JSON.stringify(ending + tail));
    }
  }
});

test('a NUL byte stays in the bytes and is the replacement character in the value, with no invariant broken (F-34.1)', () => {
  const bytes = new Uint8Array([0x61, 0x00, 0x62, 0x0a, 0x00, 0x0a]);
  const doc = parseCode(bytes, { file: 'x.py' });
  assert.deepEqual(checkInvariants(doc, bytes), []);
  const block = doc.children[0] as CodeBlock;
  assert.equal(block.value, 'a\ufffdb\n\ufffd');
  assert.deepEqual([block.src.start, block.src.end], [0, bytes.length]);
});
