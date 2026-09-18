// Node `DirectoryReader` for tests. Lives in a `.test.ts` so production stays browser-safe.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DirectoryReader, RootProbe, WalkEntry } from './index.ts';

/** Real-filesystem reader used by the walk and root tests. */
export function nodeReader(): DirectoryReader & RootProbe {
  return {
    readDir(absPath: string): WalkEntry[] {
      const out: WalkEntry[] = [];
      for (const entry of readdirSync(absPath, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const path = join(absPath, entry.name);
        const st = statSync(path);
        out.push({
          name: entry.name,
          path,
          isDir: entry.isDirectory(),
          mtimeMs: st.mtimeMs,
          size: st.size,
        });
      }
      return out;
    },
    readText(absPath: string): string | undefined {
      try {
        return readFileSync(absPath, 'utf8');
      } catch {
        return undefined;
      }
    },
    hasGit(dir: string): boolean {
      return existsSync(join(dir, '.git'));
    },
    isDirectory(path: string): boolean {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    },
  };
}

test('the node reader lists a directory without following a symlink', () => {
  const reader = nodeReader();
  const here = reader.readDir(new URL('.', import.meta.url).pathname);
  assert.ok(here.some((entry) => entry.name === 'index.ts'));
});
