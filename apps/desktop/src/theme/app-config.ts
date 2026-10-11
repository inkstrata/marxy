// The reader's config.toml and user theme for one app instance (B-15, lifted from app.ts): variant and
// size (and `typeset = false`) applied once, before anything is read onto the page (A-14), and the user theme, started at idle
// after the first document and moved when the reader adopts a theme document. Nothing at module scope:
// a second app instance in one page has its own.
import type { KindRule } from '@marxy/core';
import { joinPath } from '@marxy/core/src/index-model/paths.ts';
import { emptyKindsEnvelope, parseKindsFile, type KindsEnvelope } from '@marxy/core/src/kind/show-as.ts';
import { parseConfig, type Config } from '@marxy/theme';
import { notify } from '../notices/index.ts';
import type { AppShell } from '../app.ts';
import type { RenderedView } from '../view/rendered-view.ts';
import { applyWeightOffset, platformOf } from './offset.ts';
import { applyReaderConfig, peekConfigRead, readReaderConfig, takeConfigNotices, takeConfigRead } from './reader-config.ts';
import { adoptThemeDirectory, maybeThemeDocumentNotice } from './theme-document.ts';
import { inferHomeFromConfig, resolveThemeDir, startUserTheme, themeDirFromConfig, type UserThemeContext } from './user-theme.ts';

/** What the launch's kind decision has from the pre-paint config read (K-05a.1). */
export interface LaunchKindInputs {
  /** The `[[kind]]` rules of the config.toml the pre-paint read saw; none when it saw none. */
  readonly rules: readonly KindRule[];
  /** kinds.json if its read has finished, else null: the caller decides without it and uses `later` once first text is out. */
  readonly choices: KindsEnvelope | null;
  /** kinds.json, whenever its read finishes. Never rejects; as if empty when missing, unreadable or unparsable. */
  readonly later: Promise<KindsEnvelope>;
}

/** The reader's *show as* choices from `<data>/kinds.json`; missing, unreadable or unparsable is as if empty. Never rejects. */
export function readKindsFile(shell: Pick<AppShell, 'readFile'>, data: string): Promise<KindsEnvelope> {
  if (data === '') return Promise.resolve(emptyKindsEnvelope());
  return shell.readFile(joinPath(data, 'kinds.json')).then(
    (bytes) => parseKindsFile(bytes).envelope,
    () => emptyKindsEnvelope(),
  );
}

export interface AppConfig {
  /**
   * Variant and text size from config.toml on `root`, the first time only. A failure keeps the defaults. With
   * `kinds`, the first time also starts the read of kinds.json beside it, for a launch that has a document to
   * decide the kind of (see `launchKindInputs`); a launch with none reads nothing but config.toml.
   */
  applyOnce(root: HTMLElement, opts?: { readonly kinds?: boolean }): Promise<void>;
  /**
   * What the launch document's kind is decided from, once `applyOnce` has finished: the rules from the config
   * bytes it already read and kinds.json, whose read began when the shell gave the data directory, beside the
   * document's own read. No read of config.toml and no further question to the shell (K-05a.1).
   */
  launchKindInputs(): LaunchKindInputs;
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
  let rules: readonly KindRule[] = [];
  let choices: KindsEnvelope | null = null;
  let later: Promise<KindsEnvelope> = Promise.resolve(emptyKindsEnvelope());
  let userTheme: { stop(): void } | null = null;
  const context = (): UserThemeContext => ({ shell, views });

  /** The theme directory: from the bytes the pre-paint read already has, else from the file (A-14). */
  async function themeDir(): Promise<string | null> {
    const read = takeConfigRead();
    if (read === null) return themeDirFromConfig(shell);
    return resolveThemeDir(parseConfig(read.bytes).config.theme, read.path);
  }

  return {
    async applyOnce(root, opts) {
      if (applied) return;
      applied = true;
      try {
        applyAppConfig(
          root,
          await readReaderConfig(shell, (paths) => {
            if (opts?.kinds) later = readKindsFile(shell, paths.data).then((read) => (choices = read));
          }),
        );
        const read = peekConfigRead();
        if (read !== null) rules = parseConfig(read.bytes, { home: inferHomeFromConfig(read.path) }).config.kindRules;
      } catch {
        /* defaults stand */
      }
    },
    launchKindInputs: () => ({ rules, choices, later }),
    async startUserTheme() {
      for (const text of takeConfigNotices()) notify({ kind: 'info', text });
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
