// Registry-level checks (E-01). Later stories that register operations extend these by registering, not by
// editing this file: no list of ids is kept here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OPERATIONS } from './index.ts';

test('registry: every operation id is unique and kebab-case', () => {
  const seen = new Set<string>();
  for (const op of OPERATIONS) {
    assert.match(op.id, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, `${op.id} is not kebab-case`);
    assert.ok(!seen.has(op.id), `${op.id} is registered twice`);
    seen.add(op.id);
  }
});

test('registry: every operation has a title and at least one appliesTo', () => {
  for (const op of OPERATIONS) {
    assert.ok(op.title.trim().length > 0, `${op.id} has no title`);
    assert.ok(op.appliesTo.length > 0, `${op.id} has an empty appliesTo`);
  }
});

// E-11: stripping markdown is a copy form. A splice that strips would touch bytes nobody asked about.
import type { Document, Inline, Node } from '../contracts/ast.ts';
import type { Operation } from '../contracts/operation.ts';
import { createBuffer, textOf } from '../buffer/buffer.ts';
import { parseMarkdown } from '../parse/parse.ts';
import { corpusDocuments } from './testing/corpus.ts';
import { canFail } from './testing/test-kit.ts';
import { MUTATING_OPERATIONS } from './index.ts';

const STRIPPING_ID = /strip|plain|unformat|remove-markup/;

function assertNoStrippingIds(ops: readonly Operation[]): void {
  for (const op of ops) {
    if (op.id.startsWith('copy-')) continue;
    assert.ok(!STRIPPING_ID.test(op.id), `${op.id}: stripping is a copy form (E-11); a splice would touch bytes nobody asked about`);
  }
}

const MARKUP = new Set(['emphasis', 'strong', 'strikethrough', 'code', 'link', 'image', 'footnoteReference', 'mathInline']);

function markupCount(node: Node | Inline): number {
  let n = MARKUP.has(node.type) ? 1 : 0;
  for (const child of (node as { children?: readonly Node[] }).children ?? []) n += markupCount(child);
  return n;
}

function everyNode(root: Node, out: Node[] = []): Node[] {
  out.push(root);
  for (const child of root.children ?? []) everyNode(child, out);
  return out;
}

/** A mutating operation may not leave fewer inline markup nodes (emphasis, strong, strike, code, link, image, footnote ref, math) in the document than it found. */
function assertNoMarkdownStripped(ops: readonly Operation[]): number {
  let checked = 0;
  for (const { file, bytes, document } of corpusDocuments()) {
    const buffer = createBuffer(file, bytes);
    const before = markupCount(document);
    const perOp = new Map<string, number>();
    for (const node of everyNode(document)) {
      const range = node.src;
      const input = { document, node: node.type === 'document' ? undefined : node, range, text: textOf(buffer, range) };
      for (const op of ops) {
        if (!op.canApply(input)) continue;
        // Each application re-parses the document, so cap the sweep per operation and file.
        const seen = perOp.get(op.id) ?? 0;
        if (seen >= 12) continue;
        const { replacement } = op.run(input);
        if (replacement === input.text) continue;
        perOp.set(op.id, seen + 1);
        const next = new TextDecoder().decode(bytes.subarray(0, range.start)) + replacement + new TextDecoder().decode(bytes.subarray(range.end));
        const after: Document = parseMarkdown(next, { file });
        assert.ok(
          markupCount(after) >= before,
          `${op.id} at ${node.type}@${range.start} in ${file} strips markdown (${before} to ${markupCount(after)} markup nodes); stripping is a copy form (E-11)`,
        );
        checked++;
      }
    }
  }
  return checked;
}

test('E-11: no non-copy operation id says strip, plain, unformat or remove-markup', () => {
  assertNoStrippingIds(OPERATIONS);
});

test('E-11: no mutating operation strips markdown outside its target, over the corpus', () => {
  assert.ok(assertNoMarkdownStripped(MUTATING_OPERATIONS) > 0, 'the guard must exercise at least one mutation');
});

test('E-11: the guards fail on a deliberate strip-markdown splice', () => {
  const bad: Operation = {
    id: 'strip-markdown',
    title: 'Strip markdown',
    appliesTo: ['block'],
    canApply: (input) => input.node?.type === 'paragraph',
    run: (input) => ({ replacement: input.text.replace(/[*_`~]|\[([^\]]*)\]\([^)]*\)/g, '$1') }),
  };
  canFail(() => assertNoStrippingIds([...OPERATIONS, bad]));
  canFail(() => assertNoMarkdownStripped([...MUTATING_OPERATIONS, { ...bad, id: 'tidy-text' }]));
});
