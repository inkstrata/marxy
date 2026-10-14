// "Show what changed on disk" and "Show unsaved changes" (E-17): a unified diff, summoned, opened as a scratch
// document (E-13) holding a summary line and one `diff` fence. Not a split, not a mode, not a mark: nothing is
// drawn on the document, and the document itself is not touched (no write, no transition on its store).
//
// The "before" bytes are the ones Marxy held: `previousDisk` (what a reload replaced) or `disk` (what it last
// loaded or wrote), never a fresh read of the file. Both sides are decoded for reading only.
//
// V-06 adds the local versions' three commands (ADR-0072): *Show changes since you read* (the copy kept when the reader last
// read the file, to what is on disk now), *Clear versions of this file* and *Clear all versions*; and the diff from a stored
// version to the buffer (`showVersionChanges`), which the Versions tab opens. Each diff is the same scratch document, and
// none writes anything.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { unifiedDiff, type UnifiedDiff } from '@marxy/core';
import { openScratch } from '../document/scratch.ts';
import { documentName, isUntitled } from '../document/untitled.ts';
import type { DocumentSnapshot, DocumentStore } from '../document/store.ts';
import { notify } from '../notices/index.ts';
import { splitRefusal } from '../pane/fit.ts';
import { hourMinute } from '../versions/restore.ts';
import { versionRecorder, type SinceRead } from '../versions/recorder.ts';
import { sameBytes } from '../versions/store.ts';
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

/** The summary sentence: the counts, what they are against, and anything the reader must not take for more. */
function summary(d: UnifiedDiff, before: string, after: string, against: string): string {
  const parts: string[] = [];
  if (onlyEndings(before, after)) {
    parts.push(`Only the line endings differ (${eolStyle(before)} before, ${eolStyle(after)} after) ${against}.`);
  } else {
    parts.push(`${plural(d.added, 'line', 'lines')} added, ${d.removed} removed ${against}.`);
    if (d.eolChanged) parts.push('Some line endings differ too.');
  }
  if (!d.exact) {
    parts.push('This comparison is approximate: the files differ too much to match line by line, so some changed stretches are shown as one removal and one addition.');
  }
  return parts.join(' ');
}

/** The document the diff opens as, or the refusal to say. `text === ''` means there is nothing to show. */
export function changesDocument(
  name: string,
  before: Uint8Array,
  after: Uint8Array,
  against: string,
): { readonly kind: 'document'; readonly text: string } | { readonly kind: 'none' } | { readonly kind: 'too-large' } {
  const a = decoder.decode(before);
  const b = decoder.decode(after);
  const d = unifiedDiff(a, b, { aLabel: 'before', bLabel: 'after' });
  if (d === null) return { kind: 'too-large' };
  if (d.text === '') return { kind: 'none' };
  const fence = fenceFor(d.text);
  const diff = d.text.endsWith('\n') ? d.text : `${d.text}\n`;
  return {
    kind: 'document',
    text: `# Changes in ${escapeMarkdown(name)}\n\n${summary(d, a, b, against)}\n\n${fence}diff\n${diff}${fence}\n`,
  };
}

/** One task of the event loop, so the notice and the keystroke that follow are not behind the diff's work. */
const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type Say = AppContext['showNotice'];
const sayByNotice: Say = (text, opts) => {
  notify({ kind: opts?.kind ?? 'info', text, transient: opts?.transient, fades: opts?.fades });
};

async function show(say: Say, snap: DocumentSnapshot, before: Uint8Array, after: Uint8Array, against: string, beside: boolean): Promise<void> {
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
  await openScratch(result.text);
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

/** What *Changed since you read* compares: the copy the reader last read, to the bytes on disk now (a change held back over unsaved edits included). */
export function sinceReadOf(store: DocumentStore | null): { readonly since: SinceRead; readonly onDisk: Uint8Array } | null {
  if (!store) return null;
  const since = versionRecorder()?.since(store) ?? null;
  const onDisk = store.conflict() ?? store.snapshot().disk;
  if (since === null || onDisk === null || sameBytes(since.bytes, onDisk)) return null;
  return { since, onDisk };
}

/** "since you read it at 14.32 today", "since you saved it at …", "since it changed on disk at …". */
export function sinceWhen(since: SinceRead): string {
  const verb = since.how === 'read' ? 'you read it' : since.how === 'saved' ? 'you saved it' : 'it changed on disk';
  return `since ${verb} ${keptWhen(since.time)}`;
}

/** The summary line's words for *Changed since you read*. */
export function sinceAgainst(since: SinceRead): string {
  const what = sinceWhen(since);
  return since.savedSince ? `${what} (you saved it since, so your own changes are in it too)` : what;
}

/**
 * The diff from a kept version's bytes to the buffer as it is now (V-06): the scratch document E-17 opens, beside the document
 * when it has unsaved edits. Nothing is written, and the document's store is not touched.
 */
export function showVersionChanges(snap: DocumentSnapshot, before: Uint8Array, against: string, say: Say = sayByNotice): Promise<void> {
  return show(say, snap, before, snap.buffer.bytes, against, snap.dirty);
}

/** *Show changes since you read* for `store`: the copy the reader last read, to the bytes on disk now; beside it over unsaved edits. */
export async function showSinceRead(store: DocumentStore | null, say: Say = sayByNotice): Promise<void> {
  const found = sinceReadOf(store);
  if (!store || !found) return;
  const snap = store.snapshot();
  await show(say, snap, found.since.bytes, found.onDisk, sinceAgainst(found.since), snap.dirty);
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
        await show(ctx.showNotice, snap, snap.previousDisk, snap.disk, 'since the file last changed on disk', false);
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
        await show(ctx.showNotice, snap, snap.disk, snap.buffer.bytes, 'compared with the file on disk', true);
      },
    },
    {
      id: 'versions.since-read',
      title: 'Show changes since you read',
      group: 'document',
      when: (ctx) => sinceReadOf(ctx.document) !== null,
      run: (ctx) => showSinceRead(ctx.document, ctx.showNotice),
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
