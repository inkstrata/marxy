// What a link peek reads: the file up to a few lines past the one it cites, never the whole file. The head first, then
// windows of it until those lines are in, or a bound is reached.
import type { AppShell } from '../app-types.ts';

const HEAD_BYTES = 256 * 1024;
/** readRange's own bound on Tauri (file_scheme.rs answers at most 4 MB). */
const STEP_BYTES = 4 * 1024 * 1024;
/** How far into a file a peek reads before it gives up. */
export const PEEK_MAX_BYTES = 32 * 1024 * 1024;

/**
 * The text of `path` through line `through` (1-based), or all of it when shorter; null when the line lies past
 * PEEK_MAX_BYTES. A line break is LF, CRLF or a lone CR; the larger of the LF and CR counts never runs past the real
 * count, so the read stops only once the lines are surely in.
 */
export async function textThroughLine(shell: Pick<AppShell, 'readHead' | 'readRange'>, path: string, through: number): Promise<string | null> {
  const parts: Uint8Array[] = [];
  let read = 0;
  let lf = 0;
  let cr = 0;
  let chunk = await shell.readHead(path, HEAD_BYTES);
  let asked = HEAD_BYTES;
  for (;;) {
    parts.push(chunk);
    read += chunk.length;
    for (const b of chunk) {
      if (b === 10) lf++;
      else if (b === 13) cr++;
    }
    if (Math.max(lf, cr) >= through || chunk.length < asked) break;
    if (read >= PEEK_MAX_BYTES) return null;
    asked = Math.min(STEP_BYTES, PEEK_MAX_BYTES - read);
    try {
      chunk = await shell.readRange(path, read, asked);
    } catch (e) {
      // Past the head, the file is read through `marxy-file://`, which serves only a file the reader opened or one in a
      // folder scoped for a document: a file only indexed peeks as far as its head.
      if ((e as { code?: unknown } | null)?.code === 'refused' || (e as { code?: unknown } | null)?.code === 'outside') return null;
      throw e;
    }
  }
  const all = new Uint8Array(read);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return new TextDecoder().decode(all);
}
