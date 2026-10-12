// The log's two strip tools (K-08): *Filter by level* and *Jump to first error*. Both are views: they hide and move, and
// write nothing, and the filter is never remembered (it is gone with the page it was set on). The strip shows each only
// while a log is in Read, because a tool is drawn only for a registered command (workspace/strip.ts) and enabled only
// while `when` holds.
import { utf16ToByte } from '@marxy/core';
import type { AppPane } from '../pane/index.ts';
import type { Pane } from '../pane/pane-set.ts';
import { notify } from '../notices/index.ts';
import { openVerbMenu, type MenuAnchor, type VerbMenuRow } from '../selection/verb-menu.ts';
import { countHidden, firstErrorOffset, LEVELS, levelOf, type Level } from '../kinds/log-filter.ts';
import { appHandle } from './app-handle.ts';
import type { AppContext, Command } from './registry.ts';

const yieldNow = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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

/** Shows `level` and above in the focused log, and says what that hid. */
async function setLevel(level: Level): Promise<void> {
  const found = focusedLog();
  if (found === null) return;
  const { pane } = found;
  const store = pane.view.store();
  if (store === null) return;
  const buffer = store.snapshot().buffer;
  const article = pane.article;
  const current = (): boolean => pane.view.store() === store && article.isConnected;
  const { filterFor, filterOf } = await pageHalf();
  if (level.min === 0) {
    filterOf(article, store)?.setLevel(level);
    notify({ kind: 'done', text: 'All lines shown · the file is unchanged' });
    return;
  }
  const filter = filterFor(article, store, current, () => void pane.view.relayout());
  filter.setLevel(level);
  const counted = await countHidden(buffer.text, level.min, yieldNow, { aborted: () => !current() });
  if (counted === null) return;
  const lines = (n: number): string => `${n.toLocaleString('en-US')} ${n === 1 ? 'line' : 'lines'}`;
  if (counted.hidden === 0) {
    notify({ kind: 'info', fades: true, text: `Nothing in this log is below ${level.label} · every line is shown · the file is unchanged` });
    return;
  }
  notify({
    kind: 'done',
    text: `${level.label} and above · ${lines(counted.hidden)} of ${counted.total.toLocaleString('en-US')} hidden · the file is unchanged`,
    actions: [{ label: 'Show all', onClick: () => void setLevel(levelOf('all')) }],
  });
}

/** The line holding the first ERROR or worse, brought to the middle of the pane. */
async function jumpToFirstError(ctx: AppContext): Promise<void> {
  const found = focusedLog();
  if (found === null) return;
  const { pane } = found;
  const store = pane.view.store();
  if (store === null) return;
  const buffer = store.snapshot().buffer;
  const at = firstErrorOffset(buffer.text);
  if (at < 0) {
    ctx.showNotice('No ERROR line in this log · nothing moved · Filter by level to Warn reads the warnings', { kind: 'info', fades: true });
    return;
  }
  const byte = utf16ToByte(buffer, at);
  pane.view.mountThrough(byte);
  const { filterOf, piecesOf } = await pageHalf();
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
  const line = [...piece.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains('marxy-line'))[index];
  if (!line) return;
  line.scrollIntoView({ block: 'center' });
  line.tabIndex = -1;
  line.focus({ preventScroll: true });
}

export function logCommands(): readonly Command[] {
  return [
    {
      id: 'log.filter-level',
      title: 'Filter by level',
      group: 'view',
      when: isLogOpen,
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
