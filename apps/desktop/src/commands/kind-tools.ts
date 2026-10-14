// The tool commands of the kinds from K-17 on (terminal, changelog, docs): a kind's tools that read the open file and hand something to the pasteboard
// or move the view, one list here rather than a file for each kind (log.ts and data.ts keep theirs). Every tool is a view:
// it writes nothing to the file, and Copy is the only action.
import { newestRelease, type Release } from '@marxy/core/src/operations/release-notes.ts';
import { parseMarkdown, textOf, type Buffer } from '@marxy/core';
import { selectInspectorTab } from '../workspace/inspector.ts';
import { copyCommands, copyOutput, terminalGroups, textLines } from '@marxy/core/src/highlight/terminal-lines.ts';
import type { AppPane } from '../pane/index.ts';
import type { Pane } from '../pane/pane-set.ts';
import { appHandle } from './app-handle.ts';
import { writeCopy } from './copy-write.ts';
import type { AppContext, Command } from './registry.ts';

/** The focused pane when it is a terminal session; its text is the file's. */
function focusedTerminal(): { readonly pane: Pane<AppPane>; readonly text: string } | null {
  const pane = appHandle()?.panes().focused;
  if (!pane || pane.kind() !== 'terminal') return null;
  const buffer = pane.view.store()?.snapshot().buffer;
  return buffer === undefined ? null : { pane, text: buffer.text };
}

/** Whether the open terminal has a command to group: a text the kind chip calls Terminal may have none. */
const hasGroups = (text: string): boolean => terminalGroups(textLines(text)).groups.length > 0;

const NO_COMMANDS = 'No prompt line with a command in this file';

/** The tools are offered for a terminal with at least one command. */
const canCopy = (): boolean => {
  const found = focusedTerminal();
  return found !== null && hasGroups(found.text);
};

/** Off, with its reason, for a terminal with no command (as the log's tools are for a log with no levels). */
const whyNot = (): string | null => (focusedTerminal() !== null && !canCopy() ? NO_COMMANDS : null);

const count = (n: number, one: string, many: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

async function copyOf(ctx: AppContext, pick: (text: string) => string, what: string): Promise<void> {
  const found = focusedTerminal();
  if (found === null) return;
  const text = pick(found.text);
  if (text === '') {
    ctx.showNotice(`No ${what} in this session · nothing was copied · the file is unchanged`, { kind: 'info', fades: true });
    return;
  }
  const lines = text.split('\n').length;
  await writeCopy(ctx, { text }, `Copied ${count(lines, 'line', 'lines')} of ${what}`);
}

/** The focused pane when it is a changelog, with its buffer. */
function focusedChangelog(): { readonly buffer: Buffer } | null {
  const pane = appHandle()?.panes().focused;
  if (!pane || pane.kind() !== 'changelog') return null;
  const buffer = pane.view.store()?.snapshot().buffer;
  return buffer === undefined ? null : { buffer };
}

const releases = new WeakMap<Buffer, Release | null>();
/** The newest release of a buffer, read once per version of the file. */
function releaseOf(buffer: Buffer): Release | null {
  let found = releases.get(buffer);
  if (found === undefined) {
    found = newestRelease(parseMarkdown(buffer.bytes, { file: buffer.path }));
    releases.set(buffer, found);
  }
  return found;
}

const NO_VERSION = 'No version heading in this file';
const hasRelease = (): boolean => {
  const found = focusedChangelog();
  return found !== null && releaseOf(found.buffer) !== null;
};

/**
 * Copy release notes: the newest version's section, the file's own bytes from its heading to the line before the next
 * version heading. A derived copy: it takes one section, so the notice says which and how much, and the file is unchanged.
 */
async function copyReleaseNotes(ctx: AppContext): Promise<void> {
  const found = focusedChangelog();
  const release = found === null ? null : releaseOf(found.buffer);
  if (found === null || release === null) return;
  const text = textOf(found.buffer, release.range);
  const lines = text.replace(/(?:\r\n|\r|\n)$/, '').split(/\r\n|\r|\n/).length;
  await writeCopy(ctx, { text }, `Copied the notes for ${release.label}, ${count(lines, 'line', 'lines')}, the newest version`);
}

/** Whether the inspector can be docked now: unfolded and not shut by a narrow window over Source or Split. */
const inspectorReachable = (): boolean => {
  const w = appHandle()?.workspace();
  return w?.hasFill('inspector') === true && !w.inspectorHidden();
};

export function kindToolCommands(): readonly Command[] {
  return [
    {
      id: 'inspector.show-outline',
      title: 'Show the page\'s headings in the inspector',
      group: 'view',
      when: () => inspectorReachable() && appHandle()?.openDocument() != null,
      run: async (ctx) => {
        ctx.closePalette();
        selectInspectorTab('outline');
      },
    },
    {
      id: 'changelog.copy-release-notes',
      title: 'Copy release notes',
      group: 'view',
      when: hasRelease,
      unavailable: () => (focusedChangelog() !== null && !hasRelease() ? NO_VERSION : null),
      run: (ctx) => copyReleaseNotes(ctx),
    },
    {
      id: 'terminal.copy-commands',
      title: 'Copy commands',
      group: 'view',
      when: canCopy,
      unavailable: whyNot,
      run: (ctx) => copyOf(ctx, copyCommands, 'commands'),
    },
    {
      id: 'terminal.copy-output',
      title: 'Copy output',
      group: 'view',
      when: canCopy,
      unavailable: whyNot,
      run: (ctx) => copyOf(ctx, copyOutput, 'output'),
    },
  ];
}
