// "Show what changed on disk" and "Show unsaved changes" (E-17): a unified diff, summoned, opened as a scratch
// document (E-13) holding a summary line and one `diff` fence. Not a split, not a mode, not a mark: nothing is
// drawn on the document, and the document itself is not touched (no write, no transition on its store).
//
// The "before" bytes are the ones Marxy held: `previousDisk` (what a reload replaced) or `disk` (what it last
// loaded or wrote), never a fresh read of the file. Both sides are decoded for reading only.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { unifiedDiff, type UnifiedDiff } from '@marxy/core';
import { openScratch } from '../document/scratch.ts';
import { documentName, isUntitled } from '../document/untitled.ts';
import type { DocumentSnapshot } from '../document/store.ts';
import { splitRefusal } from '../pane/fit.ts';
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

async function show(ctx: AppContext, snap: DocumentSnapshot, before: Uint8Array, after: Uint8Array, against: string, beside: boolean): Promise<void> {
  await yieldToUi();
  const name = isUntitled(snap.path) ? documentName(snap.path) : basename(snap.path);
  const result = changesDocument(name, before, after, against);
  if (result.kind === 'too-large') return ctx.showNotice(TOO_LARGE, { transient: true });
  if (result.kind === 'none') return ctx.showNotice(NO_DIFFERENCE, { transient: true });
  if (beside) {
    // Over unsaved edits the diff must not replace the document (the reader would be asked to save or
    // discard just to look): it opens beside it, as the second pane the window can hold, or says why not.
    const panes = appHandle()?.panes();
    if (panes && panes.panes.length === 1) {
      const refusal = splitRefusal(panes);
      if (refusal !== null) return ctx.showNotice(refusal);
      const path = panes.focused.path();
      if (path === null) return;
      await panes.openIn('other', path, { at: panes.focused.view.position().byteOffset });
      // Focus stays on the document: the diff is looked at, not worked in.
    }
  }
  await openScratch(result.text);
}

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
        await show(ctx, snap, snap.previousDisk, snap.disk, 'since the file last changed on disk', false);
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
        await show(ctx, snap, snap.disk, snap.buffer.bytes, 'compared with the file on disk', true);
      },
    },
  ];
}
