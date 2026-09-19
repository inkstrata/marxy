// Browser entry that boots startApp against createMemoryShell (MARXY-95).
import { startApp, type AppHandle } from '../app.ts';
import { createMemoryShell } from '../shell/memory.ts';

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function start(files: Record<string, string>, argv: string[]): Promise<AppHandle> {
  const bytes: Record<string, Uint8Array> = {};
  for (const [path, b64] of Object.entries(files)) bytes[path] = decodeBase64(b64);
  const shell = createMemoryShell(bytes);
  return startApp(shell, { argv });
}

declare global {
  interface Window {
    marxyApp: { start: typeof start };
  }
}

window.marxyApp = { start };
