// Test helpers shared by operation tests. Not imported by product code. This file sits in the
// production tree, where core takes no Node built-ins (dependencies.test.ts), so the file system
// is reached through process.getBuiltinModule and failures are thrown, not asserted.
import type { Document, Source } from '../contracts/ast.ts';
import { parseMarkdown } from '../parse/parse.ts';

interface NodeFs {
  readdirSync(path: URL): string[];
  readFileSync(path: URL): Uint8Array;
}

const corpusUrl = new URL('../../../../fixtures/corpus/', import.meta.url);

export interface CorpusDocument {
  readonly file: string;
  readonly bytes: Uint8Array;
  readonly document: Document;
}

/** Every Markdown file of the fixture corpus, parsed. */
export function corpusDocuments(): CorpusDocument[] {
  const { readdirSync, readFileSync } = (process as unknown as { getBuiltinModule(id: string): NodeFs }).getBuiltinModule('node:fs');
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
  if (after.length !== before.length) throw new Error(`the edit must not change the length (${before.length} -> ${after.length})`);
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    if (!spans.some((s) => i >= s.start && i < s.end)) throw new Error(`byte ${i} changed outside the allowed spans`);
  }
}
