// Browser entry that boots startApp against createMemoryShell (MARXY-95).
import { startApp, type AppHandle } from '../app.ts';
import { createMemoryShell } from '../shell/memory.ts';

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * `pieces` (slug → markdown) stands in for the bundled Commonplace on a launch with no document
 * (MARXY-257); `{}` is a build with none.
 */
async function start(
  files: Record<string, string>,
  argv: string[],
  pieces?: Record<string, string>,
): Promise<AppHandle> {
  const bytes: Record<string, Uint8Array> = {};
  for (const [path, b64] of Object.entries(files)) bytes[path] = decodeBase64(b64);
  const shell = createMemoryShell(bytes);
  const sources = pieces
    ? Object.entries(pieces).map(([name, text]) => ({ name, load: async () => text }))
    : undefined;
  return startApp(shell, { argv, pieces: sources });
}

declare global {
  interface Window {
    marxyApp: { start: typeof start };
  }
}

window.marxyApp = { start };
