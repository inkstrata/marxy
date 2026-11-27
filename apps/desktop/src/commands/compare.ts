// "Show what changed on disk" and "Show unsaved changes": a unified diff, summoned, opened as a scratch
// document holding a summary line and one `diff` fence. Not a split, not a mode, not a mark: nothing is
// drawn on the document, and the document itself is not touched (no write, no transition on its store).
//
// The "before" bytes are the ones Marxy held: `previousDisk` (what a reload replaced) or `disk` (what it last
// loaded or wrote), never a fresh read of the file. Both sides are decoded for reading only.
//
// The local versions add *Clear versions of this file* and *Clear all versions*, and the diff from a stored version to the
// buffer (`showVersionChanges`), which Versions opens when asked. Each diff is the same scratch document, and none writes
// anything.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { unifiedDiff, type UnifiedDiff } from '@marxy/core';
import { textOfFileBytes } from '../document/encoding.ts';
import { openScratch } from '../document/scratch.ts';
import { documentName, isUntitled } from '../document/untitled.ts';
import type { DocumentSnapshot } from '../document/store.ts';
import { notify } from '../notices/index.ts';
import { proposalOn } from '../proposals/state.ts';
import { splitRefusal } from '../pane/fit.ts';
import { storeFor } from '../changes/state.ts';
import { hourMinute, stageCopy } from '../versions/restore.ts';
import { versionRecorder } from '../versions/recorder.ts';
import { appHandle } from './app-handle.ts';
import type { AppContext, Command } from './registry.ts';

export const NO_DIFFERENCE = 'No difference';
export const TOO_LARGE = 'Too large to compare here';

// Decoded as the diff is for reading: a stray byte becomes U+FFFD, a BOM stays so that adding one shows.
const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });

type Eol = 'CRLF' | 'LF' | 'CR' | 'mixed' | 'none';

function eolStyle(text: string): Eol {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  const cr = (text.match(/\r(?!\n)/g) ?? []).length;
  const kinds = [crlf > 0, lf > 0, cr > 0].filter(Boolean).length;
  if (kinds === 0) return 'none';
  if (kinds > 1) return 'mixed';
  return crlf > 0 ? 'CRLF' : lf > 0 ? 'LF' : 'CR';
}

const onlyEndings = (a: string, b: string): boolean => a.replace(/\r\n?/g, '\n') === b.replace(/\r\n?/g, '\n');
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** One backtick longer than the longest run of backticks inside `text` (three at least). */
export function fenceFor(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

const escapeMarkdown = (name: string): string => name.replace(/[\\`*_[\]<>#]/g, '\\$&');

/**
 * The page's sentence: what was compared with what (`against`: "the copy from … (the − lines) against
 * the file as it is now (the + lines)"), the counts, anything the reader must not take for more, and that it is not kept.
 */
function summary(d: UnifiedDiff, before: string, after: string, against: string): string {
  const parts = [`The comparison you asked for: ${against}.`];
  if (onlyEndings(before, after)) {
    parts.push(`Only the line endings differ (${eolStyle(before)} before, ${eolStyle(after)} after).`);
  } else {
    parts.push(`${plural(d.added, 'line', 'lines')} added, ${d.removed} removed.`);
    if (d.eolChanged) parts.push('Some line endings differ too.');
  }
  if (!d.exact) {
    parts.push('This comparison is approximate: the files differ too much to match line by line, so some changed stretches are shown as one removal and one addition.');
  }
  parts.push('It is made now and not kept.');
  return parts.join(' ');
}

/** The document the diff opens as, or the refusal to say. `text === ''` means there is nothing to show. */
export function changesDocument(
  name: string,
  before: Uint8Array,
  after: Uint8Array,
  against: string,
  labels: { readonly a?: string; readonly b?: string } = {},
): { readonly kind: 'document'; readonly text: string } | { readonly kind: 'none' } | { readonly kind: 'too-large' } {
  const a = decoder.decode(before);
  const b = decoder.decode(after);
  const d = unifiedDiff(a, b, { aLabel: labels.a ?? 'before', bLabel: labels.b ?? 'after' });
  if (d === null) return { kind: 'too-large' };
  if (d.text === '') return { kind: 'none' };
  const fence = fenceFor(d.text);
  const diff = d.text.endsWith('\n') ? d.text : `${d.text}\n`;
  return {
    kind: 'document',
    text: `# ${escapeMarkdown(name)}\n\n${summary(d, a, b, against)}\n\n${fence}diff\n${diff}${fence}\n`,
  };
}

// ---- the page's card ---------------------------------------------------------------------------------------------

/** One side as the Comparison card says it: "the copy", "8 Oct 2026, 09.14 · 846 bytes, 33 lines". */
export interface ComparisonSide {
  readonly label: string;
  readonly detail: string;
}

/** What a comparison offers from its card; `run` is given the button, to anchor a menu that asks first. */
export interface ComparisonAction {
  readonly title: string;
  readonly run: (button: HTMLElement) => void;
}

/** A comparison the reader asked for, by the path of the page it opened as (the Comparison card). */
export interface Comparison {
  readonly before: ComparisonSide;
  readonly after: ComparisonSide;
  readonly actions: readonly ComparisonAction[];
}

// A handful of small records a session; a page's path is never used twice in a window, so none is replaced.
const comparisons = new Map<string, Comparison>();

export const comparisonOf = (path: string): Comparison | null => comparisons.get(path) ?? null;

/** "846 bytes, 33 lines": a side's size as the card says it. */
function sizeWords(bytes: Uint8Array): string {
  let lines = 0;
  for (let i = bytes.indexOf(0x0a); i !== -1; i = bytes.indexOf(0x0a, i + 1)) lines++;
  if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) lines++;
  return `${bytes.length.toLocaleString('en-US')} ${bytes.length === 1 ? 'byte' : 'bytes'}, ${plural(lines, 'line', 'lines')}`;
}

const side = (label: string, when: string, bytes: Uint8Array): ComparisonSide => ({ label, detail: `${when} · ${sizeWords(bytes)}` });

/** "8 Oct 2026, 09.14": when a copy was kept, as the card says it. */
function dateWords(time: number): string {
  const d = new Date(time);
  return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })} ${d.getFullYear()}, ${hourMinute(time)}`;
}

/** Opens a comparison's page and remembers what its card says; the label is the page's tab. */
async function openComparison(text: string, name: string, comparison: Comparison, beside: boolean): Promise<void> {
  await openScratch(text, { label: `Compare · ${name}`, beside, onPath: (path) => comparisons.set(path, comparison) });
}

/** The bytes Marxy holds for `path` when a pane has it open (unsaved edits included), else the file's. */
async function bytesOf(path: string): Promise<Uint8Array> {
  const handle = appHandle();
  if (!handle) throw new Error('the app is not ready');
  const open = handle.panes().panes.find((p) => p.path() === path)?.content.store();
  return open ? open.snapshot().buffer.bytes : (handle.shell.peekFile ?? handle.shell.readFile).call(handle.shell, path);
}

/**
 * Compare two files (a proposal): the patch from `from` to `to`, as a new document beside the one in front. Asked for,
 * never offered; nothing is written and neither file is touched.
 */
export async function compareTwoFiles(from: string, to: string, say: Say = sayByNotice): Promise<void> {
  const handle = appHandle();
  if (!handle) return;
  let before: Uint8Array;
  let after: Uint8Array;
  try {
    // The other file is one the reader chose to read beside this one.
    await handle.shell.markOpened?.(from).catch(() => undefined);
    [before, after] = await Promise.all([bytesOf(from), bytesOf(to)]);
  } catch (e) {
    return say(`Could not read both files · ${e instanceof Error ? e.message : String(e)}`, { kind: 'refused' });
  }
  const a = basename(from);
  const b = basename(to);
  await yieldToUi();
  const result = changesDocument(b, before, after, `${a} (the − lines) against ${b} (the + lines), each as it is now`, { a: from, b: to });
  if (result.kind === 'too-large') return say(TOO_LARGE, { kind: 'refused' });
  if (result.kind === 'none') return say(`${a} and ${b} hold the same bytes`, { kind: 'done' });
  const panes = handle.panes();
  if (panes.panes.length === 1) {
    const refusal = splitRefusal(panes);
    if (refusal !== null) return say(refusal, { kind: 'refused' });
  }
  await openComparison(result.text, b, {
    before: side(a, 'as it is now', before),
    after: side(b, 'as it is now', after),
    actions: [{ title: `Open ${a}`, run: () => void handle.open(from) }],
  }, true);
}

/** One task of the event loop, so the notice and the keystroke that follow are not behind the diff's work. */
const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type Say = AppContext['showNotice'];
const sayByNotice: Say = (text, opts) => {
  notify({ kind: opts?.kind ?? 'info', text, transient: opts?.transient, fades: opts?.fades });
};

async function show(
  say: Say,
  snap: DocumentSnapshot,
  before: Uint8Array,
  after: Uint8Array,
  against: string,
  beside: boolean,
  card: Comparison,
): Promise<void> {
  await yieldToUi();
  const name = isUntitled(snap.path) ? documentName(snap.path) : basename(snap.path);
  const result = changesDocument(name, before, after, against);
  if (result.kind === 'too-large') return say(TOO_LARGE, { kind: 'refused' });
  if (result.kind === 'none') return say(NO_DIFFERENCE, { kind: 'done' });
  if (beside) {
    // Over unsaved edits the diff must not replace the document (the reader would be asked to save or
    // discard just to look): it opens beside it, as the second pane the window can hold, or says why not.
    const panes = appHandle()?.panes();
    if (panes && panes.panes.length === 1) {
      const refusal = splitRefusal(panes);
      if (refusal !== null) return say(refusal, { kind: 'refused' });
      const path = panes.focused.path();
      if (path === null) return;
      await panes.openIn('other', path, { at: panes.focused.view.position().byteOffset });
      // Focus stays on the document: the diff is looked at, not worked in.
    }
  }
  await openComparison(result.text, name, card, false);
}

/** The local day of `time` in words, beside its hour: "today", "yesterday", or "on 12 Oct". */
function dayWords(time: number, now: number): string {
  const day = (t: number): string => new Date(t).toDateString();
  if (day(time) === day(now)) return 'today';
  if (day(time) === day(now - 24 * 60 * 60 * 1000)) return 'yesterday';
  const d = new Date(time);
  return `on ${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
}

/** "at 14.32 today", "at 09.10 on 12 Oct": when a version was kept, as the summary line says it. */
export function keptWhen(time: number, now: number = Date.now()): string {
  return `at ${hourMinute(time)} ${dayWords(time, now)}`;
}

/**
 * The diff from the copy kept at `time` (the file's bytes, as versions hold them) to the buffer as it is now: the scratch
 * document it opens, beside the document when it has unsaved edits. The copy is read as the open file is, so a file in
 * another encoding is compared text with text. Nothing is written, and the document's store is not touched. Its card opens
 * the copy and stages it over the file, as Versions does.
 */
export async function showVersionChanges(snap: DocumentSnapshot, copy: Uint8Array, time: number, say: Say = sayByNotice): Promise<void> {
  const path = snap.path;
  const shell = appHandle()?.shell ?? {};
  const before = await textOfFileBytes(shell, path, copy);
  const label = `${basename(path)}, the copy of ${hourMinute(time)}`;
  return show(say, snap, before, snap.buffer.bytes, `the copy from ${dateWords(time)} (the − lines) against the file as it is now (the + lines)`, snap.dirty, {
    before: side('the copy', dateWords(time), before),
    after: side('the file', 'as it is now', snap.buffer.bytes),
    actions: [
      { title: 'Open the copy', run: () => void appHandle()?.panes().openScratch(before, { label }) },
      {
        title: 'Restore the copy',
        run: () => {
          const store = storeFor(path);
          if (store) void stageCopy(store, copy, time, shell);
          else notify({ kind: 'refused', text: `${basename(path)} is no longer open · open it to restore the copy over it` });
        },
      },
    ],
  });
}

const plural2 = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function compareCommands(): readonly Command[] {
  return [
    {
      id: 'compare.since-reload',
      title: 'Show what changed on disk',
      group: 'document',
      when: (ctx) => (ctx.document?.snapshot().previousDisk ?? null) !== null,
      async run(ctx) {
        const snap = ctx.document?.snapshot();
        if (!snap?.previousDisk || !snap.disk) return;
        await show(ctx.showNotice, snap, snap.previousDisk, snap.disk, 'the file before it last changed on disk (the − lines) against the file on disk now (the + lines)', false, {
          before: side('before', 'as Marxy had it', snap.previousDisk),
          after: side('on disk', 'as it is now', snap.disk),
          actions: [],
        });
      },
    },
    {
      id: 'compare.unsaved',
      title: 'Show unsaved changes',
      group: 'document',
      when: (ctx) => ctx.document?.snapshot().dirty === true,
      async run(ctx) {
        const snap = ctx.document?.snapshot();
        if (!snap?.dirty || !snap.disk) return;
        await show(ctx.showNotice, snap, snap.disk, snap.buffer.bytes, 'the file on disk (the − lines) against your unsaved edits (the + lines)', true, {
          before: side('on disk', 'as last saved or loaded', snap.disk),
          after: side('your edits', 'not saved', snap.buffer.bytes),
          actions: [],
        });
      },
    },
    {
      id: 'compare.files',
      title: 'Compare with the file beside',
      group: 'document',
      when: () => {
        const panes = appHandle()?.panes();
        return proposalOn('compare_files') && panes !== undefined && panes.panes.length > 1 && panes.panes.every((p) => p.path() !== null);
      },
      async run(ctx) {
        const panes = appHandle()?.panes();
        const here = panes?.focused.path();
        const there = panes?.panes.find((p) => p !== panes.focused)?.path();
        if (here && there) await compareTwoFiles(there, here, ctx.showNotice);
      },
    },
    {
      id: 'versions.clear-file',
      title: 'Clear versions of this file',
      group: 'document',
      when: (ctx) => versionRecorder() !== null && ctx.document !== null && !isUntitled(ctx.document.snapshot().path),
      async run(ctx) {
        const recorder = versionRecorder();
        const path = ctx.document?.snapshot().path;
        if (!recorder || !path || isUntitled(path)) return;
        const result = await recorder.clear(path);
        const name = basename(path);
        if (result.error !== undefined) {
          return ctx.showNotice(`The versions of ${name} could not all be cleared · ${String((result.error as { message?: unknown })?.message ?? result.error)}`, { kind: 'refused' });
        }
        ctx.showNotice(result.cleared === 0 ? `No versions of ${name} are kept` : `Cleared ${plural2(result.cleared, 'version', 'versions')} of ${name}`, { kind: 'done' });
      },
    },
    {
      id: 'versions.clear-all',
      title: 'Clear all versions',
      group: 'document',
      when: () => versionRecorder() !== null,
      async run(ctx) {
        const recorder = versionRecorder();
        if (!recorder) return;
        const result = await recorder.clearAll();
        if (result.errors.length > 0) {
          const first = result.errors[0] as { message?: unknown } | undefined;
          return ctx.showNotice(`Some versions could not be cleared · ${String(first?.message ?? first)}`, { kind: 'refused' });
        }
        ctx.showNotice(result.files === 0 ? 'No versions are kept' : `Cleared ${plural2(result.cleared, 'version', 'versions')} of ${plural2(result.files, 'file', 'files')}`, { kind: 'done' });
      },
    },
  ];
}
