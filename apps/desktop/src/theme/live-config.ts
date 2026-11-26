// One key of config.toml written, and the whole file applied to the page at once, as a launch would: the variant, the
// sizes, the measure, and the theme (a bundled one, or a folder started again).
import { parseConfig } from '@marxy/theme';
import type { AppHandle } from '../app-types.ts';
import { notify } from '../notices/index.ts';
import { applyAppConfig } from './app-config.ts';
import { themeMeant } from './bundled-themes.ts';
import { writeReaderKey, type ReaderKey } from './reader-config.ts';
import { applyBundledTheme } from './user-theme.ts';

export async function readConfigNow(handle: AppHandle): Promise<ReturnType<typeof parseConfig>['config'] | null> {
  const { configPaths } = handle.shell;
  if (!configPaths) return null;
  try {
    const { config } = await configPaths();
    return parseConfig(await (handle.shell.peekFile ?? handle.shell.readFile)(config)).config;
  } catch {
    return parseConfig(new Uint8Array()).config;
  }
}

/** Writes `key = tomlValue` and applies config.toml; false, after a notice, when the file could not be written. */
export async function writeAndApply(handle: AppHandle, key: ReaderKey, tomlValue: string): Promise<boolean> {
  let bytes: Uint8Array | null;
  try {
    bytes = await writeReaderKey(handle.shell, key, tomlValue);
  } catch (e) {
    notify({ kind: 'error', text: `config.toml could not be updated · ${e instanceof Error ? e.message : String(e)} · nothing was changed` });
    return false;
  }
  if (bytes === null) return false;
  const config = parseConfig(bytes).config;
  applyAppConfig(document.documentElement, config);
  if (key === 'theme') {
    const named = themeMeant(config.theme);
    if (named === null) await handle.restartTheme();
    else await applyBundledTheme(named);
  }
  await handle.relayout();
  return true;
}
