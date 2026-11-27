// What the index decides reader kinds from: the `[[kind]]` rules of config.toml and the Show as choices of
// kinds.json, read as Open reads them (document/open.ts `readKindInputs`).
import type { ReaderKinds } from '@marxy/core/src/index-model/entry.ts';
import { parseConfig } from '@marxy/theme';
import type { AppShell } from '../app.ts';
import { readKindsFile } from '../theme/app-config.ts';
import { inferHomeFromConfig } from '../theme/user-theme.ts';

/** The reader's kind rules and choices; either missing, unreadable or unparsable is as if empty. Never rejects. */
export async function readReaderKinds(shell: Pick<AppShell, 'readFile' | 'configPaths'>): Promise<ReaderKinds> {
  if (!shell.configPaths) return {};
  try {
    const { config, data } = await shell.configPaths();
    const [rules, choices] = await Promise.all([
      config === ''
        ? []
        : shell.readFile(config).then(
            (bytes) => parseConfig(bytes, { home: inferHomeFromConfig(config) }).config.kindRules,
            () => [],
          ),
      readKindsFile(shell, data),
    ]);
    return { rules, choices };
  } catch {
    return {};
  }
}
