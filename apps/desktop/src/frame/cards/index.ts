// The panel's cards. Each reads the focused pane's store as it stands; none parses a store that has not been parsed,
// and none says anything about what changed.
import type { Buffer } from '@marxy/core';
import { readingOf, TREE_MAX_VALUES, treeTierList, type Reading } from '@marxy/core/src/reading/index.ts';
import { entryWhere, heldEntry, isArchiveEntry } from '../../document/entries.ts';
import { isUntitled } from '../../document/untitled.ts';
import { encodingFact, formatCount } from '../../source/frame-facts.ts';
import { modifiedWords, sizeFact } from '../model/metadata.ts';
import { currentRow, outlineModelFor, type OutlineRow } from '../model/outline.ts';
import { countWords, countsAsMarkdown } from '../model/facts.ts';
import { el, factRow, plural } from '../dom.ts';
import type { CardContext, CardDef } from './types.ts';
import { tierList, tierWhyWords } from '@marxy/core/src/highlight/tier.ts';
import { longestLineOf, setColourAnyway, tierOf } from '../../render/colour-tier.ts';
import { heldEncoding } from '../../document/encoding.ts';
import { encodingFactWords } from '../encoding.ts';

const storeOf = (ctx: CardContext) => ctx.pane.content.store();

/** The reading Read sets the focused file as, the same one the view drew (readingOf is memoised on the bytes). */
function readingNow(ctx: CardContext): Reading | null {
  const store = storeOf(ctx);
  return store ? readingOf(ctx.path, store.snapshot().buffer.bytes, ctx.pane.kind()) : null;
}

/** Every rAF at most: a card that follows the scroll redraws once a frame. */
function onScrollFrame(ctx: CardContext, cb: () => void): () => void {
  let queued = false;
  const off = ctx.pane.view.onScroll(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      cb();
    });
  });
  return off;
}

/**
 * How much of a code file is coloured (the Reading card): the full page says so in a line; a lower tier
 * says why, lists the three tiers with this one marked, and offers colour anyway, a screen at a time, or back.
 */
export function renderTier(body: HTMLElement, ctx: CardContext): void {
  const store = storeOf(ctx);
  if (!store) return;
  const set = readingNow(ctx);
  if (set?.tree) return renderTreeTier(body, set);
  const bytes = store.snapshot().buffer.bytes;
  const tier = tierOf(ctx.path, bytes);
  if (!tier) return;
  const box = el('div', 'marxy-tier');
  if (tier.tier === 'full') {
    box.append(el('p', 'marxy-card-note', `Coloured in full: ${tierWhyWords(tier, bytes.length)}.`));
    body.append(box);
    return;
  }
  const line = el('p', 'marxy-card-line');
  line.append('Shown as ', el('b', '', tier.anyway ? 'plain text, coloured as you scroll' : 'plain text'));
  box.append(line, el('p', 'marxy-card-note', tierWhyWords(tier, bytes.length, tier.why === 'line' ? longestLineOf(bytes) : undefined)));
  const { items, at } = tierList(tier);
  const list = el('ol', 'marxy-tiers');
  items.forEach((item, i) => {
    const li = el('li');
    li.toggleAttribute('data-marxy-here', i === at);
    li.append(el('b', '', item.name), el('span', '', item.words));
    list.append(li);
  });
  box.append(list);
  const toggle = el('button', 'marxy-linkish', tier.anyway ? 'Back to plain text' : 'Colour it anyway, a screen at a time as you scroll');
  toggle.type = 'button';
  toggle.addEventListener('click', () => setColourAnyway(ctx.path, !tier.anyway));
  box.append(toggle, el('p', 'marxy-card-foot', 'The file is the same in every tier. A choice is kept in readings.json, never in the file.'));
  body.append(box);
}

/**
 * How much of a data tree is drawn (the Reading card): a tree drawn whole says so in a line; one drawn in part
 * lists the four tiers with its own marked, and how many values there are in all.
 */
function renderTreeTier(body: HTMLElement, set: Reading): void {
  const { total, capped } = set.tree!;
  const box = el('div', 'marxy-tier');
  if (!capped) {
    box.append(el('p', 'marxy-card-note', `Drawn whole: ${plural(total, 'value')}, within the ${TREE_MAX_VALUES.toLocaleString('en-GB')} a tree is drawn to.`));
    body.append(box);
    return;
  }
  const list = el('ol', 'marxy-tiers');
  treeTierList(set.format).forEach((item, i) => {
    const li = el('li');
    li.toggleAttribute('data-marxy-here', i === 1);
    li.append(el('b', '', item.name), el('span', '', item.words));
    list.append(li);
  });
  box.append(list, el('p', 'marxy-card-note', `${plural(total, 'value')} in all. Draw from here starts the tree at any part; Source has every line.`));
  body.append(box);
}

const outlineRows = (ctx: CardContext): readonly OutlineRow[] => {
  const store = storeOf(ctx);
  if (!store || !store.parsed()) return [];
  const snap = store.snapshot();
  return outlineModelFor(snap.ast, snap.buffer).rows;
};

// ---- facts ---------------------------------------------------------------------------------------------------------

const lineStarts = new WeakMap<Buffer, Int32Array>();
function startsOf(buffer: Buffer): Int32Array {
  let starts = lineStarts.get(buffer);
  if (!starts) {
    const list = [0];
    const bytes = buffer.bytes;
    for (let i = bytes.indexOf(0x0a); i !== -1; i = bytes.indexOf(0x0a, i + 1)) if (i + 1 < bytes.length) list.push(i + 1);
    starts = Int32Array.from(list);
    lineStarts.set(buffer, starts);
  }
  return starts;
}

function lineAt(starts: Int32Array, byte: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= byte) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

const EOL_WORDS: Readonly<Record<string, string>> = { lf: 'LF', crlf: 'CRLF', cr: 'CR', mixed: 'mixed line endings', none: 'one line' };

const facts: CardDef = {
  id: 'facts',
  title: () => 'Facts',
  relevant: () => true,
  render(body, ctx) {
    const store = storeOf(ctx);
    if (!store) return;
    const buffer = store.snapshot().buffer;
    const starts = startsOf(buffer);
    // Line and section on rows of their own, each held to one line, so scrolling never changes the card's height.
    const lineRow = factRow('line', '');
    const sectionRow = factRow('section', '');
    const lineV = lineRow.querySelector<HTMLElement>('.marxy-fact-v')!;
    const sectionV = sectionRow.querySelector<HTMLElement>('.marxy-fact-v')!;
    sectionV.classList.add('marxy-fact-one');
    const sectionOf = (byte: number): string => {
      const rows = outlineRows(ctx).filter((r) => r.kind === 'heading');
      const row = rows[currentRow(rows, byte)];
      return row && row.kind === 'heading' ? row.text : '';
    };
    const paint = (): void => {
      const byte = ctx.pane.view.position().byteOffset;
      lineV.textContent = `${formatCount(lineAt(starts, byte))} of ${formatCount(starts.length)}`;
      const section = sectionOf(byte);
      sectionV.textContent = section || '—';
      sectionV.title = section;
    };
    paint();
    const words = countWords(buffer.text, { markdown: countsAsMarkdown(ctx.path) });
    // Text in another encoding says its encoding and its BOM, and its size as it is on disk.
    const decoded = heldEncoding(ctx.path)?.found ?? null;
    const bytesNote: string[] = decoded ? [encodingFactWords(decoded, EOL_WORDS[buffer.eol] ?? buffer.eol)] : [encodingFact(buffer).label, EOL_WORDS[buffer.eol] ?? buffer.eol];
    if (!decoded && !buffer.bom) bytesNote.push('no BOM');
    const lastByte = buffer.bytes[buffer.bytes.length - 1];
    const noFinal = buffer.bytes.length > 0 && lastByte !== 0x0a && lastByte !== 0x0d;
    const bytesValue = el('span', '', bytesNote.join(' · '));
    if (noFinal) bytesValue.append(' · ', el('span', 'marxy-guessed', 'no newline at the end'));
    // An empty file has no line to be on, no words and no line endings: it is said to be empty.
    if (buffer.bytes.length === 0) body.append(factRow('size', `empty · ${sizeFact(0)}`));
    else body.append(lineRow, sectionRow, factRow('size', `${plural(words, 'word')} · ${decoded ? `${sizeFact(decoded.fileBytes)} on disk` : sizeFact(buffer.bytes.length)}`), factRow('bytes', bytesValue));
    const modified = factRow('modified', '…');
    if (!isUntitled(ctx.path)) body.append(modified);
    // An archive's entry is in memory: its place is the archive and its name inside it, and its date the archive's.
    const entry = isArchiveEntry(ctx.path) ? heldEntry(ctx.path) : null;
    body.append(factRow('path', isUntitled(ctx.path) ? 'not saved yet' : (entryWhere(ctx.path) ?? ctx.path), entry ? 'In memory, not on disk' : ctx.path));
    let gone = false;
    if (entry) modified.querySelector('.marxy-fact-v')!.textContent = entry.mtimeMs ? modifiedWords(entry.mtimeMs) : 'not said';
    else if (!isUntitled(ctx.path)) {
      void ctx.handle.shell
        .stat(ctx.path)
        .then((stat) => {
          if (gone) return;
          const v = modified.querySelector('.marxy-fact-v');
          if (v) v.textContent = stat?.mtimeMs ? modifiedWords(stat.mtimeMs) : 'unknown';
        })
        .catch(() => modified.remove());
    }
    const off = onScrollFrame(ctx, paint);
    return () => {
      gone = true;
      off();
    };
  },
};

/** A text file's Facts, hosted in Metadata where a viewer brings none of its own. */
export const textFactsCard: CardDef = facts;
