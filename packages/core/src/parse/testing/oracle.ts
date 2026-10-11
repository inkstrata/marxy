// The equivalence oracle of D-15 (04-phase-d.md, "Amended 2026-10-11"): the parse in slices and the render in
// slices are a second road to the bytes a reader sees, beside the sanitiser's one pass (ADR-0023 Amendment 1).
// This answers, for one document, whether the two roads agree: the AST node for node and range for range, the
// html byte for byte, the removals in order and the blocked images; or the slicer declined (the parse as one
// piece, the render as null) and the caller does it whole, which is the same bytes by construction.

import assert from 'node:assert/strict';
import type { Document } from '../../contracts/ast.ts';
import { renderDocumentSafeHtml, renderDocumentSafeHtmlInSlices, type SlicedRenderResult } from '../../render/pipeline.ts';
import { lineStartAt } from '../../sourcemap/line-starts.ts';
import { lastChunkedParse, parseMarkdownChunked } from '../chunked.ts';
import { parseMarkdown } from '../parse.ts';

export type SlicedRender = (document: Document, options: { yieldNow: () => Promise<void>; budgetMs?: number }) => Promise<SlicedRenderResult | null>;

export interface OracleOptions {
  /** The slicer under test; the real one by default, a mutant of it in the test that proves the oracle fails on one. */
  readonly render?: SlicedRender;
  /** The parse in slices under test; the real one by default, a mutant of it in the tests that prove the oracle fails on one. */
  readonly parse?: typeof parseMarkdownChunked;
  /** A fixed parse slice size, in bytes (many slices of a small file); unset, the parse sizes its own. */
  readonly sliceBytes?: number;
  /** The render's slice budget in milliseconds; a budget no slice can meet makes each slice the smallest. Unset, the default. */
  readonly budgetMs?: number;
  readonly yieldNow?: () => Promise<void>;
}

export interface OracleVerdict {
  readonly parse: 'slices' | 'whole';
  readonly render: 'sliced' | 'declined';
}

const FILE = '/oracle.md';
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const firstDifference = (a: string, b: string): number => {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i;
};

/** Throws, naming `where`, when the sliced roads and the whole roads give different bytes. */
export async function checkEquivalent(input: string | Uint8Array, where: string, options: OracleOptions = {}): Promise<OracleVerdict> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const render = options.render ?? renderDocumentSafeHtmlInSlices;
  const yieldNow = options.yieldNow ?? settle;

  const whole = parseMarkdown(bytes, { file: FILE });
  const slicedParse = await (options.parse ?? parseMarkdownChunked)(bytes, { file: FILE, yieldNow, sliceBytes: options.sliceBytes });
  const parse = lastChunkedParse().kind;
  const wholeJson = JSON.stringify(whole);
  const slicedJson = JSON.stringify(slicedParse);
  if (wholeJson !== slicedJson) {
    const i = firstDifference(slicedJson, wholeJson);
    assert.fail(`${where}: the parse in slices (${parse}) differs from the whole parse at JSON index ${i}:\n  slices ${slicedJson.slice(Math.max(0, i - 100), i + 100)}\n  whole  ${wholeJson.slice(Math.max(0, i - 100), i + 100)}`);
  }
  for (let at = 0; at <= bytes.length; at += Math.max(1, Math.floor(bytes.length / 100))) {
    assert.equal(lineStartAt(slicedParse, at), lineStartAt(whole, at), `${where}: line start at byte ${at}`);
  }

  // The render of the sliced parse (what the app does) against the render of the whole parse.
  const expected = renderDocumentSafeHtml(whole);
  const got = await render(slicedParse, { yieldNow, budgetMs: options.budgetMs });
  if (got === null) return { parse, render: 'declined' };
  if (got.html !== expected.html) {
    const i = firstDifference(got.html, expected.html);
    assert.fail(`${where}: the html in slices differs from the whole render at ${i}:\n  slices ${got.html.slice(Math.max(0, i - 100), i + 100)}\n  whole  ${expected.html.slice(Math.max(0, i - 100), i + 100)}`);
  }
  assert.deepEqual(got.removed, expected.removed, `${where}: the removals, in order`);
  assert.deepEqual(got.blockedImages, expected.blockedImages, `${where}: the blocked images`);
  assert.equal(got.pieces.join('\n'), expected.html, `${where}: the pieces joined are the html`);
  return { parse, render: 'sliced' };
}
