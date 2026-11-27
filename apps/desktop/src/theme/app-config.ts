// The reader's config.toml and user theme for one app instance (lifted from app.ts): variant and
// size (and `typeset = false`) applied once, before anything is read onto the page, and the user theme, started at idle
// after the first document and moved when the reader adopts a theme document. Nothing at module scope:
// a second app instance in one page has its own.
import type { KindRule } from '@marxy/core';
import { joinPath } from '@marxy/core/src/index-model/paths.ts';
import { emptyKindsEnvelope, parseKindsFile, type KindsEnvelope } from '@marxy/core/src/kind/show-as.ts';
import { parseConfig, type Config } from '@marxy/theme';
import { reportConfigWarnings } from '../notices/config-copy.ts';
import { notify } from '../notices/index.ts';
import type { AppShell } from '../app.ts';
import type { RenderedView } from '../view/rendered-view.ts';
import { applySyntaxConfig } from './lang-colour.ts';
import { applyWeightOffset, platformOf } from './offset.ts';
import { applyReaderConfig, peekConfigRead, readReaderConfig, takeConfigNotices, takeConfigRead } from './reader-config.ts';
import { adoptThemeDirectory, maybeThemeDocumentNotice } from './theme-document.ts';
import { DEFAULT_THEME, themeMeant } from './bundled-themes.ts';
import { applyBundledTheme, currentThemeName, inferHomeFromConfig, resolveThemeChoice, startUserTheme, type ThemeChoice, type UserThemeContext } from './user-theme.ts';
import { setProposals } from '../proposals/state.ts';
import { setVerbsOn } from '../selection/verbs-on.ts';
import { setReviewChanges } from '../changes/review.ts';

/** What the launch's kind decision has from the pre-paint config read. */
/** The kind rules and choices the launch already read, for the index: its first walk reads neither file again. */
export const launchReaderKinds = (config: Pick<AppConfig, 'launchKindInputs'>) => async (): Promise<{ rules: readonly KindRule[]; choices: KindsEnvelope }> => {
  const launch = config.launchKindInputs();
  return { rules: launch.rules, choices: launch.choices ?? (await launch.later) };
};

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
   * Variant and text size from config.toml on `root`, read the first time only; every call settles when it is applied.
   * A failure keeps the defaults. With `kinds`, it also starts the read of kinds.json once the data directory is
   * known, for a launch that has a document to decide the kind of (see `launchKindInputs`); a launch with none reads
   * nothing but config.toml.
   */
  applyOnce(root: HTMLElement, opts?: { readonly kinds?: boolean }): Promise<void>;
  /**
   * What the launch document's kind is decided from, once `applyOnce` has finished: the rules from the config
   * bytes it already read and kinds.json, whose read began when the shell gave the data directory, beside the
   * document's own read. No read of config.toml and no further question to the shell.
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
 * config.toml on `root`: the variant and text size, and `[linux] weight_offset` in place of the
 * table's value. The launch set the table's value before anything was laid out; a
 * configured one replaces it here, still before the first document is read onto the page.
 */
export function applyAppConfig(root: HTMLElement, config: Config): void {
  applyReaderConfig(root, config);
  // `typeset = false`: the existing kill switch (--marxy-typeset: none) leaves every paragraph to the engine.
  if (config.typeset === false) root.style.setProperty('--marxy-typeset', 'none');
  else root.style.removeProperty('--marxy-typeset');
  applyWeightOffset(root, platformOf(navigator.userAgent), config.linuxWeightOffset);
  setProposals(config.proposals, root);
  setVerbsOn(config.verbs);
  setReviewChanges(config.reviewChanges);
  applySyntaxConfig(config.syntax, root.ownerDocument);
}

export function createAppConfig(shell: AppShell, views: () => readonly RenderedView[]): AppConfig {
  let applying: Promise<void> | null = null;
  let rules: readonly KindRule[] = [];
  let choices: KindsEnvelope | null = null;
  let later: Promise<KindsEnvelope> = Promise.resolve(emptyKindsEnvelope());
  // kinds.json is read once it is asked for and the shell has said where the data directory is, whichever is last.
  let dataDir: string | null = null;
  let kindsWanted = false;
  let kindsStarted = false;
  const startKinds = (): void => {
    if (kindsStarted || !kindsWanted || dataDir === null) return;
    kindsStarted = true;
    later = readKindsFile(shell, dataDir).then((read) => (choices = read));
  };
  let userTheme: { stop(): void } | null = null;
  let held: readonly string[] = [];
  const context = (): UserThemeContext => ({ shell, views });

  /** What `theme` names: from the bytes the pre-paint read already has, else from the file. */
  async function themeChoice(): Promise<ThemeChoice | null> {
    const read = takeConfigRead();
    if (read !== null) return resolveThemeChoice(shell, parseConfig(read.bytes).config.theme, read.path);
    if (shell.configPaths === undefined) return null;
    // No answer is no theme, not a failed open.
    try {
      const { config } = await shell.configPaths();
      const { config: parsed } = parseConfig(await shell.readFile(config));
      return resolveThemeChoice(shell, parsed.theme, config);
    } catch {
      return null;
    }
  }

  return {
    applyOnce(root, opts) {
      if (opts?.kinds) {
        kindsWanted = true;
        startKinds();
      }
      applying ??= (async () => {
        try {
          const config = await readReaderConfig(shell, (paths) => {
            dataDir = paths.data;
            startKinds();
          });
          applyAppConfig(root, config);
          // a bundled theme is applied with the variant, before the frame is drawn and the first document is read
          // onto the page, so the chrome and the first text are in Dusk and Night never shows. A folder of the same name
          // beside config.toml is looked for after.
          const bundled = themeMeant(config.theme);
          if (bundled !== null) {
            await applyBundledTheme(bundled, root.ownerDocument);
            void shell.mark('bundled_theme', Date.now(), `name=${bundled}`);
          }
          const read = peekConfigRead();
          if (read !== null) {
            const parsed = parseConfig(read.bytes, { home: inferHomeFromConfig(read.path) });
            rules = parsed.config.kindRules;
            // Held with the other config notices: opening a document clears notices, so they show with the theme start.
            held = parsed.warnings;
          }
        } catch {
          /* defaults stand */
        }
      })();
      return applying;
    },
    launchKindInputs: () => ({ rules, choices, later }),
    async startUserTheme() {
      for (const text of takeConfigNotices()) notify({ kind: 'refused', text });
      reportConfigWarnings(held);
      // No config.toml to read (or no answer) names nothing: the default theme.
      const choice: ThemeChoice = (await themeChoice()) ?? { kind: 'bundled', name: DEFAULT_THEME };
      userTheme?.stop();
      userTheme = null;
      if (choice?.kind === 'bundled') {
        // Already applied before first text; apply it here only when the pre-paint read did not (no pre-paint config).
        if (currentThemeName() !== choice.name) {
          await applyBundledTheme(choice.name);
          for (const view of views()) await view.relayoutForTheme();
        }
        return;
      }
      if (choice?.shadows) {
        notify({ kind: 'info', text: `Using the theme folder ${choice.shadows} beside config.toml, not the bundled ${choice.shadows} theme.` });
      }
      userTheme = await startUserTheme(context(), choice?.dir ?? null);
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
