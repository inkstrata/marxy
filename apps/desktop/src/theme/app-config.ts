// The reader's config.toml and user theme for one app instance (B-15, lifted from app.ts): variant and
// size (and `typeset = false`) applied once, before anything is read onto the page (A-14), and the user theme, started at idle
// after the first document and moved when the reader adopts a theme document. Nothing at module scope:
// a second app instance in one page has its own.
import { parseConfig, type Config } from '@marxy/theme';
import type { AppShell } from '../app.ts';
import type { RenderedView } from '../view/rendered-view.ts';
import { applyWeightOffset, platformOf } from './offset.ts';
import { applyReaderConfig, readReaderConfig, takeConfigRead } from './reader-config.ts';
import { adoptThemeDirectory, maybeThemeDocumentNotice } from './theme-document.ts';
import { resolveThemeDir, startUserTheme, themeDirFromConfig, type UserThemeContext } from './user-theme.ts';

export interface AppConfig {
  /** Variant and text size from config.toml on `root`, the first time only. A failure keeps the defaults. */
  applyOnce(root: HTMLElement): Promise<void>;
  /** The user theme config.toml names, started (or started again) now. */
  startUserTheme(): Promise<void>;
  /** A theme document opened: offer to adopt its directory as the user theme. */
  offerThemeDocument(file: string): Promise<void>;
  /** The user theme's watch stops; the instance is being replaced. */
  stop(): void;
}

/**
 * config.toml on `root`: the variant and text size (A-14), and `[linux] weight_offset` in place of the
 * table's value (B-07, ADR-0010). The launch set the table's value before anything was laid out; a
 * configured one replaces it here, still before the first document is read onto the page.
 */
export function applyAppConfig(root: HTMLElement, config: Config): void {
  applyReaderConfig(root, config);
  // `typeset = false`: the existing kill switch (--marxy-typeset: none) leaves every paragraph to the engine (B-17).
  if (config.typeset === false) root.style.setProperty('--marxy-typeset', 'none');
  else root.style.removeProperty('--marxy-typeset');
  applyWeightOffset(root, platformOf(navigator.userAgent), config.linuxWeightOffset);
}

export function createAppConfig(shell: AppShell, views: () => readonly RenderedView[]): AppConfig {
  let applied = false;
  let userTheme: { stop(): void } | null = null;
  const context = (): UserThemeContext => ({ shell, views });

  /** The theme directory: from the bytes the pre-paint read already has, else from the file (A-14). */
  async function themeDir(): Promise<string | null> {
    const read = takeConfigRead();
    if (read === null) return themeDirFromConfig(shell);
    return resolveThemeDir(parseConfig(read.bytes).config.theme, read.path);
  }

  return {
    async applyOnce(root) {
      if (applied) return;
      applied = true;
      try {
        applyAppConfig(root, await readReaderConfig(shell));
      } catch {
        /* defaults stand */
      }
    },
    async startUserTheme() {
      const dir = await themeDir();
      userTheme?.stop();
      userTheme = await startUserTheme(context(), dir);
    },
    async offerThemeDocument(file) {
      await maybeThemeDocumentNotice(context(), file, async (dir) => {
        userTheme = await adoptThemeDirectory(context(), dir, userTheme);
      });
    },
    stop() {
      userTheme?.stop();
      userTheme = null;
    },
  };
}
