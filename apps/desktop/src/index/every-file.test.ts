// The index lists every file. A `.png` and an extension-less README are entries the palette finds and the Library's
// name field lists (it filters the same entries by name); content detection corrects an extension-less script's
// class; Find's paths leave the binary out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { fileTypeFor, noteContent, searchSkipReason, type ContentSignals } from '@marxy/core/src/kind/registry.ts';
import { createIndexService } from './service.ts';
import { createMemoryShell } from '../shell/memory.ts';
import { paletteResults } from '../palette/search.ts';
import { emptySession } from '../palette/session.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

test('a .png and an extension-less README are in the index, the palette and the Library; detection classes a script', async () => {
  const shell = Object.assign(
    createMemoryShell({
      '/r/.git/HEAD': enc('ref: refs/heads/main\n'),
      '/r/guide.md': enc('# Guide\n'),
      '/r/logo.png': PNG,
      '/r/README': enc('# Project\n\nWhat it does.\n'),
      '/r/bin/deploy': enc('#!/usr/bin/env python3\nprint(1)\n'),
    }),
    {
      // The shell's detect_files, as src-tauri/src/detect.rs answers for these heads.
      detected: [] as string[],
      async detectFiles(this: { detected: string[] }, paths: readonly string[]): Promise<(ContentSignals | null)[]> {
        this.detected.push(...paths);
        return paths.map((p) => (p.endsWith('/deploy') ? { class: 'text', encoding: 'utf-8', shebang: 'python3' } : { class: 'text', encoding: 'utf-8' }));
      },
    },
  );
  const index = createIndexService(shell);
  try {
    await index.ensureRoot('/r');
    await index.settled();
    const entries = index.entries();
    const byName = new Map(entries.map((e) => [basename(e.path), e]));
    assert.equal(byName.get('logo.png')?.kind, 'binary');
    assert.equal(byName.get('README')?.kind, 'text');
    assert.equal(byName.get('deploy')?.kind, 'source', 'the shebang made it code');
    assert.equal(byName.get('deploy')?.readerKind, 'code');
    // Only names that say nothing, or are shared between languages, have their heads read.
    assert.deepEqual(shell.detected, ['/r/bin/deploy']);

    const session = emptySession('/r');
    for (const [query, name] of [['logo', 'logo.png'], ['readme', 'README']] as const) {
      const hits = paletteResults(query, entries, session).map((h) => basename(h.entry.path));
      assert.ok(hits.includes(name), `palette "${query}": ${hits.join(', ')}`);
      // The Library's name field: the same entries, by name (frame/branches/library.ts).
      assert.ok(entries.some((e) => basename(e.path).toLowerCase().includes(query)), `Library "${query}"`);
    }

    // Find reads text only: the README and the script, never the PNG, which it counts as binary.
    const skipped = entries.map((e) => (e.kind === 'binary' ? 'binary' : searchSkipReason(fileTypeFor(e.path))));
    assert.deepEqual(entries.filter((_, i) => skipped[i] === null).map((e) => basename(e.path)).sort(), ['README', 'deploy', 'guide.md']);
    assert.deepEqual(skipped.filter((s) => s !== null), ['binary']);
  } finally {
    index.dropRoot('/r');
    noteContent('/r/bin/deploy', null);
  }
});
