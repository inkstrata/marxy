// What a database's page and a workbook's page share: the Reading card with its tiers and caps, a CSV export
// read a page at a time, and a BLOB opened into memory as an archive's entry is.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { sizeWords } from '@marxy/core/src/viewer/bytes.ts';
import { appHandle } from '../commands/app-handle.ts';
import { holdEntry } from '../document/entries.ts';
import { el } from '../frame/dom.ts';
import { intend } from '../frame/intent.ts';
import type { CardDef } from '../frame/cards/types.ts';
import { whyLines, type ViewedFile } from './file.ts';
import { EXPORT_BYTES_MAX } from './exports.ts';
import type { ViewerExport } from './types.ts';

export interface Tier {
  readonly name: string;
  readonly words: string;
}

export interface Way {
  readonly words: string;
  run(): void;
}

/** The Reading card of a table page: what it is shown as and why, its tiers with this one marked, its caps, the other ways. */
export function tablesReadingCard(o: {
  file: ViewedFile;
  shownAs: () => string;
  tiers: readonly Tier[];
  at: () => number;
  caps: readonly string[];
  ways: () => readonly Way[];
}): CardDef {
  let open = false;
  return {
    id: 'reading',
    title: () => 'Reading',
    relevant: () => true,
    render(body) {
      const line = el('p', 'marxy-card-line');
      line.append('Shown as ', el('b', '', o.shownAs()));
      const from = el('p', 'marxy-card-note');
      const why = el('button', 'marxy-linkish', open ? 'hide why' : 'why?');
      why.type = 'button';
      why.setAttribute('aria-expanded', String(open));
      const list = el('ul', 'marxy-reasons');
      for (const w of whyLines(o.file, null)) list.append(el('li', '', w));
      list.hidden = !open;
      why.addEventListener('click', () => {
        open = !open;
        list.hidden = !open;
        why.textContent = open ? 'hide why' : 'why?';
        why.setAttribute('aria-expanded', String(open));
      });
      from.append(el('span', '', 'from its first bytes and its name'), ' · ', why);
      body.append(line, from, list);
      const tiers = el('ol', 'marxy-tiers');
      o.tiers.forEach((t, i) => {
        const li = el('li');
        li.toggleAttribute('data-marxy-here', i === o.at());
        li.append(el('b', '', t.name), el('span', '', t.words));
        tiers.append(li);
      });
      body.append(tiers, el('p', 'marxy-card-sub', 'Caps'));
      const caps = el('ul', 'marxy-reasons marxy-tbl-caps');
      for (const c of o.caps) caps.append(el('li', '', c));
      body.append(caps);
      for (const w of o.ways()) {
        const p = el('p', 'marxy-card-note');
        const b = el('button', 'marxy-linkish', w.words);
        b.type = 'button';
        b.addEventListener('click', () => w.run());
        p.append(b);
        body.append(p);
      }
    },
  };
}

const enc = new TextEncoder();

/** A CSV export built a page at a time, up to the read cap; the preview shows its first lines. */
export function csvExport(o: { id: string; name: string; sub: string; build: (keep: (line: string) => boolean, stopped: (why: string) => void) => Promise<void> }): ViewerExport {
  return {
    id: o.id,
    name: o.name,
    sub: o.sub,
    extension: 'csv',
    async build() {
      const parts: Uint8Array[] = [];
      let size = 0;
      let cut = false;
      let why: string | null = null;
      await o.build((line) => {
        const bytes = enc.encode(line);
        if (size + bytes.length > EXPORT_BYTES_MAX) {
          cut = true;
          return false;
        }
        parts.push(bytes);
        size += bytes.length;
        return true;
      }, (reason) => {
        why = reason;
      });
      const out = new Uint8Array(size);
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.length;
      }
      const head = new TextDecoder().decode(out.subarray(0, 4096)).split('\r\n').slice(0, 12).join('\n');
      const note = (cut ? `\n\nStopped at ${sizeWords(EXPORT_BYTES_MAX)}, Export's cap.` : '') + (why !== null ? `\n\nThe query was ${why}: the rows after it are not in this file.` : '');
      return { bytes: out, preview: `${head}${note}` };
    },
  };
}

/** Opens bytes held in memory in a new tab of the pane at `paneHost`, as an archive's entry opens: read-only, said. */
export async function openHeld(o: { paneHost: HTMLElement; source: string; name: string; index: number; bytes: Uint8Array; said: string }): Promise<void> {
  const entry = holdEntry({ archive: o.source, name: o.name, index: o.index, bytes: o.bytes, mtimeMs: null, of: 'cell', said: o.said });
  const handle = appHandle();
  const at = handle?.panes().panes.find((p) => p.host === o.paneHost);
  if (!handle || !at) return;
  intend(o.paneHost, entry.path, 'new');
  // The tab says `said` when it lands (document/open.ts): one notice for the one event.
  await handle.panes().openIn(at.slot, entry.path);
}

/** "journal.sqlite", from "…/journal.sqlite-wal". */
export const databaseOf = (path: string): string | null => {
  const m = /^(.*)-(wal|shm)$/i.exec(path);
  return m ? m[1]! : null;
};

export const nameOf = basename;
