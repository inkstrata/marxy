// The log's two strip tools (K-08): *Filter by level* and *Jump to first error*. Both are views: they hide and move, and
// write nothing, and the filter is never remembered (it is gone with the page it was set on). The strip shows each only
// while a log is in Read, because a tool is drawn only for a registered command (workspace/strip.ts) and enabled only
// while `when` holds.
import { utf16ToByte } from '@marxy/core';
import type { AppPane } from '../pane/index.ts';
import type { Pane } from '../pane/pane-set.ts';
import { dismiss, notify } from '../notices/index.ts';
import { openVerbMenu, type MenuAnchor, type VerbMenuRow } from '../selection/verb-menu.ts';
import { countHidden, type HiddenCount, firstErrorOffset, hasLevelWords, LEVELS, levelOf, NO_LEVEL_WORDS, type Level } from '../kinds/log-filter.ts';
import { appHandle } from './app-handle.ts';
import type { AppContext, Command } from './registry.ts';

const yieldNow = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Resolves once the frame that follows has been drawn: a task queued from inside a frame's callback runs after its paint. */
const afterPaint = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/**
 * The page half and the line splitter are loaded when a log tool is first used: the splitter is `render/highlight.ts`,
 * which reaches the highlighter, and nothing on the way to first text may import that statically (MARXY-33, `gate:bundle`).
 */
const pageHalf = () => import('../kinds/log-view.ts');
const splitter = () => import('../render/highlight.ts');

/** The focused pane when it is a log in Read, with pieces on the page to filter. */
function focusedLog(): { readonly pane: Pane<AppPane> } | null {
  const pane = appHandle()?.panes().focused;
  if (!pane || pane.kind() !== 'log' || pane.view.mode !== 'rendered') return null;
  return pane.article.querySelector('pre.language-log.marxy-run') === null ? null : { pane };
}

const isLogOpen = (): boolean => focusedLog() !== null;

/** Whether the open log has any line with a level word, asked once for each state of the buffer. */
const levelWords = new WeakMap<object, boolean>();
function hasLevels(pane: Pane<AppPane>): boolean {
  const buffer = pane.view.store()?.snapshot().buffer;
  if (buffer === undefined) return false;
  let known = levelWords.get(buffer);
  if (known === undefined) {
    known = hasLevelWords(buffer.text);
    levelWords.set(buffer, known);
  }
  return known;
}

/** Filter by level is offered for a log in Read that has level words to filter by. */
const canFilter = (): boolean => {
  const found = focusedLog();
  return found !== null && hasLevels(found.pane);
};

/** Under the strip's own button when it is drawn, else the middle of the window. */
function anchorFor(): MenuAnchor {
  const button = document.querySelector('[data-tool="filter-by-level"]');
  const box = button?.getBoundingClientRect();
  if (box && box.width > 0) return { x: Math.round(box.left), y: Math.round(box.bottom), top: Math.round(box.top) };
  return { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 3) };
}

const MENU_TITLES: Readonly<Record<string, string>> = {
  all: 'All levels',
  info: 'Info and above',
  warn: 'Warn and above',
  error: 'Error only',
};

/** The change of level in hand: a later one supersedes it, and its pill goes. */
let latest = 0;

const lines = (n: number): string => `${n.toLocaleString('en-US')} ${n === 1 ? 'line' : 'lines'}`;

/**
 * Shows `level` and above in the focused log. The page is worked through a few milliseconds a frame, so a pill says how far
 * it is (Esc, or its *Show all*, stops it and shows every line), and when it is done a notice says what was hidden.
 */
async function setLevel(level: Level): Promise<void> {
  const found = focusedLog();
  if (found === null) return;
  const { pane } = found;
  const store = pane.view.store();
  if (store === null) return;
  if (!hasLevels(pane)) {
    notify({ kind: 'info', fades: true, text: `${NO_LEVEL_WORDS} · nothing is hidden · its lines do not open with a timestamp and a level word` });
    return;
  }
  const buffer = store.snapshot().buffer;
  const article = pane.article;
  const current = (): boolean => pane.view.store() === store && article.isConnected;
  const { filterFor, filterOf, FILTERING } = await pageHalf();
  const held = filterOf(article, store);
  if (level.min === 0 && held === undefined) {
    notify({ kind: 'done', text: 'All lines shown · the file is unchanged' });
    return;
  }
  const mine = ++latest;
  const filter = held ?? filterFor(article, store, current);
  const words = (fraction: number): string =>
    `${level.min === 0 ? 'Showing all lines' : `Filtering to ${level.label}`} · ${Math.round(fraction * 100)}% · the file is unchanged · Esc stops`;
  const pill = notify({
    kind: 'info',
    text: words(0),
    actions: level.min === 0 ? [] : [{ label: 'Show all', onClick: () => void setLevel(levelOf('all')) }],
  });
  const say = (text: string): void => {
    const el = document.querySelector(`[data-notice-id="${pill}"] .marxy-notice-text`);
    if (el) el.textContent = text;
  };
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || level.min === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void setLevel(levelOf('all'));
  };
  document.addEventListener('keydown', onEscape, true);
  // The click is answered first: the menu has closed and the pill is up, and the frame that shows them is drawn before the
  // first slice of the count or of the page's work runs (K-08.1). A later choice, or the document going, ends this one.
  // The one thing the click does to the page: a piece not yet filtered is not drawn (a neutral "Filtering…" stands for it), so
  // no frame between the click and the work shows a line the level hides. A class on the article; no piece is read or touched.
  if (level.min !== 0) article.classList.add(FILTERING);
  const waiting = afterPaint();
  let begun!: () => void;
  filter.hold(new Promise<void>((resolve) => (begun = resolve)));
  let counting: Promise<HiddenCount | null> | null = null;
  const leave = (): void => {
    stop();
    document.removeEventListener('keydown', onEscape, true);
    dismiss(pill);
  };
  const stop = filter.subscribe((state) => {
    if (mine !== latest || !current()) {
      leave();
      return;
    }
    if (!state.done) {
      say(words(state.fraction));
      return;
    }
    leave();
    void (async () => {
      if (counting === null) {
        notify({ kind: 'done', text: 'All lines shown · the file is unchanged' });
        return;
      }
      // The file may have changed on disk while the pieces were worked through: the notice counts the file as it is now.
      const now = store.snapshot().buffer;
      const counted = now === buffer ? await counting : await countHidden(now.text, level.min, yieldNow, { aborted: () => !current() || mine !== latest });
      if (counted === null || mine !== latest) return;
      if (counted.hidden === 0) {
        notify({ kind: 'info', fades: true, text: `Nothing in this log is below ${level.label} · every line is shown · the file is unchanged` });
        return;
      }
      notify({
        kind: 'done',
        text: `${level.label} and above · ${lines(counted.hidden)} of ${counted.total.toLocaleString('en-US')} hidden · the file is unchanged`,
        actions: [{ label: 'Show all', onClick: () => void setLevel(levelOf('all')) }],
      });
    })();
  });
  await waiting;
  if (mine !== latest || !current()) {
    leave();
    begun();
    return;
  }
  if (level.min !== 0) counting = countHidden(buffer.text, level.min, yieldNow, { aborted: () => !current() || mine !== latest });
  filter.setLevel(level);
  begun();
}

/** The line holding the first ERROR or worse, brought to the middle of the pane. */
async function jumpToFirstError(ctx: AppContext): Promise<void> {
  const found = focusedLog();
  if (found === null) return;
  const { pane } = found;
  const store = pane.view.store();
  if (store === null) return;
  const buffer = store.snapshot().buffer;
  if (!hasLevels(pane)) {
    ctx.showNotice(`${NO_LEVEL_WORDS} · nothing moved · its lines do not open with a timestamp and a level word`, { kind: 'info', fades: true });
    return;
  }
  const at = firstErrorOffset(buffer.text);
  if (at < 0) {
    ctx.showNotice('No ERROR line in this log · nothing moved · Filter by level to Warn reads the warnings', { kind: 'info', fades: true });
    return;
  }
  const byte = utf16ToByte(buffer, at);
  pane.view.mountThrough(byte);
  const { filterOf, linesOf, piecesOf } = await pageHalf();
  const piece = piecesOf(pane.article).find((code) => Number(code.dataset.marxyS) <= byte && byte < Number(code.dataset.marxyE));
  if (!piece) {
    ctx.showNotice('Could not reach the first error · nothing moved · try again once the file has finished opening', { kind: 'refused' });
    return;
  }
  // The filter, if one is on, has this piece's lines laid out before the line is looked for.
  await filterOf(pane.article, store)?.settled();
  if (piece.dataset.marxyDone === undefined) (await splitter()).applyLinesToCode(piece);
  // Which line of the piece the byte is on: the file's own line endings, a CRLF counting once.
  const bytes = buffer.bytes;
  let index = 0;
  for (let i = Number(piece.dataset.marxyS); i < byte; i++) {
    if (bytes[i] === 0x0a || (bytes[i] === 0x0d && bytes[i + 1] !== 0x0a)) index++;
  }
  const line = linesOf(piece)[index];
  if (!line) return;
  // Pieces far from the screen are laid out only when near it (content-visibility), so the page's heights change as the
  // scroll arrives: the line is brought to the middle again until it stays there.
  const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const view = window.innerHeight;
  for (let tries = 0; tries < 8; tries++) {
    line.scrollIntoView({ block: 'center' });
    await nextFrame();
    const box = line.getBoundingClientRect();
    if (Math.abs((box.top + box.bottom) / 2 - view / 2) < view / 4) break;
  }
  line.tabIndex = -1;
  line.focus({ preventScroll: true });
}

export function logCommands(): readonly Command[] {
  return [
    {
      id: 'log.filter-level',
      title: 'Filter by level',
      group: 'view',
      when: canFilter,
      unavailable: () => (isLogOpen() ? NO_LEVEL_WORDS : null),
      async run(ctx) {
        const found = focusedLog();
        const store = found?.pane.view.store();
        const { filterOf } = await pageHalf();
        const now = found && store ? (filterOf(found.pane.article, store)?.level ?? levelOf('all')) : levelOf('all');
        const rows: VerbMenuRow[] = LEVELS.map((level) => ({
          command: null,
          key: `log.level.${level.id}`,
          title: MENU_TITLES[level.id]!,
          ...(level.id === now.id ? { detail: 'now' } : {}),
          run: () => setLevel(level),
        }));
        openVerbMenu(anchorFor(), ctx, { registered: [], allActions: () => {}, rows, label: 'Filter by level' });
      },
    },
    {
      id: 'log.first-error',
      title: 'Jump to first error',
      group: 'view',
      when: isLogOpen,
      run: jumpToFirstError,
    },
  ];
}
