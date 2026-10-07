// Test helpers shared by operation tests. Not imported by product code.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import type { Document, Source } from '../../contracts/ast.ts';
import { parseMarkdown } from '../../parse/parse.ts';

const corpusUrl = new URL('../../../../../fixtures/corpus/', import.meta.url);

export interface CorpusDocument {
  readonly file: string;
  readonly bytes: Uint8Array;
  readonly document: Document;
}

/** Every Markdown file of the fixture corpus, parsed. */
export function corpusDocuments(): CorpusDocument[] {
  return readdirSync(corpusUrl)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((file) => {
      const bytes = new Uint8Array(readFileSync(new URL(file, corpusUrl)));
      return { file, bytes, document: parseMarkdown(bytes, { file }) };
    });
}

/**
 * Minimal-diff assertion: `before` and `after` have equal length and differ only at bytes inside
 * `spans` (byte ranges of `before`, which must not overlap).
 */
export function assertOnlySpansChanged(before: Uint8Array, after: Uint8Array, spans: readonly Source[]): void {
  assert.equal(after.length, before.length, 'the edit must not change the length');
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    assert.ok(spans.some((s) => i >= s.start && i < s.end), `byte ${i} changed outside the allowed spans`);
  }
}
