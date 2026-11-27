// A data folder of its own for a launch of the built app (MARXY_DATA_DIR, src-tauri/src/data_dir.rs), so a check never reads
// or writes the reader's state, and its removal once the app is done with it.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A new, empty folder under the system's temporary folder. */
export const newDataFolder = (prefix) => mkdtempSync(join(tmpdir(), prefix));

/** WebView2 processes still running on a profile under `dir`: they hold its files for a moment after the app ends. */
function webviewsOn(dir) {
  if (process.platform !== 'win32') return 0;
  const filter = `Name='msedgewebview2.exe'`;
  const script = `@(Get-CimInstance Win32_Process -Filter "${filter}" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:MARXY_FOLDER) }).Count`;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', script], { env: { ...process.env, MARXY_FOLDER: dir }, encoding: 'utf8' });
    return Number(out.trim()) || 0;
  } catch {
    return 0;
  }
}

/** Resolves once no WebView2 process runs on `dir`, or `timeoutMs` has passed. */
export async function webviewsGone(dir, timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  while (webviewsOn(dir) > 0 && Date.now() < until) await wait(250);
}

/** Removes `dir` once no WebView2 process runs on it (up to `timeoutMs`); false, and a warning, when it could not be removed. */
export async function removeDataFolder(dir, timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  await webviewsGone(dir, timeoutMs);
  for (;;) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (Date.now() >= until) {
        console.warn(`could not remove the data folder ${dir}: ${error.code ?? error.message}`);
        return false;
      }
      await wait(250);
    }
  }
}
