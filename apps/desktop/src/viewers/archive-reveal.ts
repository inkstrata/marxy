// Reveal and x-ray on an archive's page. Reveal (`Shift X`) puts
// back what Read leaves out: a strip under the plan draws the file as stored from its first byte to its last, the list
// gains packed size, method and offset, and the preview's head gains the entry's stored record. X-ray (`x`) on an entry
// shows its header as stored, drawn in the preview (the list's rows are a window, so a box after a row would not stay).
// The few bytes this needs are read with `readRange` from the archive on disk: its tail for the end record, the central
// directory for each entry's method, and an entry's local header when it is the cursor's. Nothing is unpacked for it.
import { basename } from '@marxy/core/src/index-model/paths.ts';
import { archiveSums, shortSize, type ArchiveLede } from '@marxy/core/src/viewer/archive.ts';
import {
  archiveStrip,
  flagWords,
  gatherStrip,
  localHeaderOf,
  methodByListing,
  methodName,
  modeOctal,
  modeWords,
  streamFrame,
  stripHolds,
  stripLayout,
  SEVEN_Z_START,
  TAR_BLOCK,
  zipEndIn,
  zipMethods,
  type LocalHeader,
  type StripSegment,
} from '@marxy/core/src/viewer/archive-strip.ts';
import type { ArchiveEntry, ArchiveListing } from '@marxy/shell-api';
import type { AppShell } from '../app-types.ts';
import { isArchiveEntry } from '../document/entries.ts';
import { el, factRow } from '../frame/dom.ts';
import { setMarked } from '../frame/model/metadata-marks.ts';
import type { CardDef } from '../frame/cards/types.ts';
import { bytesBox, textBox } from '../parts/xray-box.ts';

const n2 = (n: number): string => n.toLocaleString('en-GB');

/** A segment is drawn at least this wide; runs too small for it are gathered. */
const SEG_FLOOR = 3;
/** A segment this wide carries its entry's name. */
const SEG_NAMED = 64;
/** A zip's end record and its comment lie in its last bytes. */
const TAIL = 65_557;
/** The central directory is read for its methods up to this size, the most one `readRange` gives in either shell; past it, the listing's guess stands. */
const DIRECTORY_CAP = 4 * 1024 * 1024;

// Reveal kept for the archive while the app runs, as its floor and folds are (memory only).
const revealed = new Set<string>();

export interface RevealHooks {
  readonly shell: AppShell;
  readonly path: string;
  readonly listing: ArchiveListing;
  readonly lede: ArchiveLede;
  /** The file's first bytes: a gzip header's length is read from them. */
  readonly head: Uint8Array;
  /** Reveal went on or off: the page is drawn again. */
  changed(): void;
  /** What Reveal reads came: the rows and the head are drawn again, in place. */
  refresh(): void;
  /** The cursor put on entry `index`. */
  goTo(index: number): void;
  /** Where an entry's x-ray box is drawn: the preview, under its head. */
  xrayAfter(): HTMLElement | null;
}

export interface ArchiveReveal {
  /** `PaneViewer.reveal`. */
  readonly switch: { on(): boolean; set(on: boolean): void };
  /** The page's class while Reveal is on, so the list's grid takes its three columns. */
  readonly pageClass: string;
  /** The strip and its sentence, for under the plan; null while Reveal is off. */
  strip(): HTMLElement | null;
  /** The cursor's entry lit in the strip; its x-ray box goes when it moves off. */
  lit(index: number | null): void;
  /** The three column heads, while Reveal is on. */
  cols(): HTMLElement[];
  /** A row's three cells, while Reveal is on. */
  cells(e: ArchiveEntry | null): HTMLElement[];
  /** The entry's stored record, for the preview's head; null while Reveal is off. */
  record(e: ArchiveEntry): HTMLElement | null;
  /** `x` on an entry: its header as stored, in the preview. */
  xray(e: ArchiveEntry): () => Promise<null>;
  /** Metadata's "The file": the viewer's own facts, then the archive's. */
  fileCard(base: CardDef): CardDef;
  destroy(): void;
}

export function archiveReveal(h: RevealHooks): ArchiveReveal {
  const { shell, path, listing } = h;
  const zip = listing.format === 'zip';
  const sevenZ = listing.format === '7z';
  const compressed = /^tar\.|^(gz|bz2|xz|zst)$/.test(listing.format);
  const inMemory = isArchiveEntry(path);
  let alive = true;

  // ---- what is read from the file ---------------------------------------------------------------------------------

  let end: { at: number; size: number } | null = null;
  let methods: number[] | null = null;
  let reading: Promise<void> | null = null;
  const locals = new Map<number, LocalHeader | null>();
  const localsAsked = new Set<number>();

  /** A zip's end record and its directory's methods, read once, when Reveal or Metadata first asks. */
  function stored(): void {
    if (reading || !zip) return;
    reading = (async () => {
      const tailAt = Math.max(0, listing.size - TAIL);
      const tail = await shell.readRange(path, tailAt, listing.size - tailAt).catch(() => null);
      if (tail) end = zipEndIn(tail, tailAt);
      const dir = listing.directory;
      if (dir && dir.size <= DIRECTORY_CAP) {
        const cd = await shell.readRange(path, dir.at, dir.size).catch(() => null);
        if (cd) methods = zipMethods(cd);
      }
    })().finally(() => {
      if (!alive) return;
      if (revealed.has(path)) drawStrip();
      h.refresh();
    });
  }

  function localOf(e: ArchiveEntry): LocalHeader | null | undefined {
    if (!zip || e.offset === null) return null;
    if (locals.has(e.index)) return locals.get(e.index);
    if (!localsAsked.has(e.index)) {
      localsAsked.add(e.index);
      void shell
        .readRange(path, e.offset, 30)
        .then((b) => localHeaderOf(b))
        .catch(() => null)
        .then((lh) => {
          locals.set(e.index, lh);
          if (alive && revealed.has(path)) h.refresh();
        });
    }
    return undefined;
  }

  const methodOf = (e: ArchiveEntry): string | null => {
    if (!zip) return null;
    const m = methods?.[e.index];
    return m !== undefined ? methodName(m) : methodByListing(e);
  };

  // ---- the strip --------------------------------------------------------------------------------------------------

  let wrapEl: HTMLElement | null = null;
  let stripEl: HTMLElement | null = null;
  let capEl: HTMLElement | null = null;
  let segs: StripSegment[] = [];
  let segEls: HTMLElement[] = [];
  let litIndex: number | null = null;
  let observer: ResizeObserver | null = null;
  let lastW = -1;
  const order = new Map(listing.entries.map((e, i) => [e.index, i]));

  function segWords(s: StripSegment): string {
    const span = `bytes ${n2(s.from)} to ${n2(s.to - 1)}`;
    const e = s.index !== undefined ? listing.entries[order.get(s.index) ?? -1] : undefined;
    switch (s.kind) {
      case 'entry':
        return `${e?.path ?? 'an entry'}: its header, ${n2(s.header ?? 0)} bytes, then its data, ${n2(s.to - s.from - (s.header ?? 0))} bytes · ${span}`;
      case 'entries':
        return `${n2(s.count ?? 0)} entries, each too small to draw apart · ${span}`;
      case 'before':
        return `${n2(s.to - s.from)} bytes before the first entry, which no entry claims · ${span}`;
      case 'directory':
        return sevenZ ? `The header: the list of entries, ${n2(s.to - s.from)} bytes · ${span}` : `The central directory, ${n2(s.to - s.from)} bytes · ${span}`;
      case 'zip64':
        return `The zip64 end record and its locator · ${span}`;
      case 'end':
        return `The end record${listing.comment ? ' and its comment' : ''} · ${span}`;
      case 'tar-end':
        return `The end blocks: two of zeros, then padding to the record size · ${span}`;
      case 'stream-head':
        return sevenZ ? `The signature header: where the list of entries lies · ${span}` : `The ${streamName()} header · ${span}`;
      case 'stream':
        return sevenZ ? `The packed blocks, each holding one entry or many · ${span}` : `The packed stream · ${span}`;
      case 'stream-tail':
        return `The ${streamName()} trailer · ${span}`;
      case 'stray':
        return `${n2(s.to - s.from)} bytes no part of the archive claims · ${span}`;
    }
  }

  const streamName = (): string => ({ gz: 'gzip', bz2: 'bzip2', xz: 'xz', zst: 'Zstandard' })[listing.format.replace(/^tar\./, '')] ?? listing.format;

  function sentence(): string {
    const last = n2(Math.max(0, listing.size - 1));
    const stray = segs.filter((s) => s.kind === 'stray' || s.kind === 'before').reduce((n, s) => n + s.to - s.from, 0);
    const strayWords = stray > 0 ? ` ${n2(stray)} of them ${stray === 1 ? 'belongs' : 'belong'} to no entry and ${stray === 1 ? 'is' : 'are'} in the warning colour.` : '';
    if (zip) {
      const dir = listing.directory;
      const dirWords = dir ? `the directory (${n2(dir.size)} bytes at ${n2(dir.at)})` : 'the directory';
      return `The file as stored, byte 0 to ${last}, left to right: each entry’s header and packed data in the order they were written, then ${dirWords} and the end record. Every byte of the file is in the strip.${strayWords}`;
    }
    if (sevenZ) {
      const dir = listing.directory;
      const dirWords = dir ? `the header that lists them (${n2(dir.size)} bytes at ${n2(dir.at)})` : 'the header that lists them';
      return `The file as stored, byte 0 to ${last}, left to right: the ${SEVEN_Z_START}-byte signature header, the packed blocks (a solid block packs many entries into one stream, so an entry has no bytes of its own to point at), then ${dirWords}. Every byte of the file is in the strip.${strayWords}`;
    }
    if (listing.format === 'tar') {
      const tail = segs.at(-1);
      const endWords = tail?.kind === 'tar-end' ? ` (${n2(tail.to - tail.from)} bytes)` : '';
      return `The file as stored, byte 0 to ${last}, left to right: each entry’s ${TAR_BLOCK}-byte header and its data in blocks of ${TAR_BLOCK}, in the order they were written, then the end blocks${endWords}. Every byte of the file is in the strip.${strayWords}`;
    }
    if (!compressed) {
      return `The file as stored, byte 0 to ${last}, drawn as one span: the strip places entries only in zip, tar and 7z archives.`;
    }
    const f = streamFrame(listing.format, h.head);
    const frame = [f.head > 0 ? `its ${n2(f.head)}-byte header` : '', 'the packed stream', f.tail > 0 ? `its ${n2(f.tail)}-byte trailer` : ''].filter(Boolean).join(', ');
    const inside = listing.format.startsWith('tar.')
      ? ` Inside it, blocks of ${TAR_BLOCK} bytes: each entry’s header and its data, so the list’s offsets are in the unpacked stream${listing.unpacked !== null ? ` of ${n2(listing.unpacked)} bytes` : ''}.`
      : ' Inside it, the one file.';
    return `The file as stored: one ${streamName()} stream, byte 0 to ${last}: ${frame}.${inside}`;
  }

  function drawStrip(): void {
    if (!stripEl || !capEl) return;
    const width = stripEl.clientWidth;
    lastW = width;
    const all = archiveStrip(listing, { end, head: h.head });
    segs = width > 0 ? gatherStrip(all, Math.max(16, Math.floor(width / SEG_FLOOR))) : all;
    const boxes = stripLayout(segs, width, SEG_FLOOR);
    segEls = segs.map((s, i) => {
      const seg = el('div', 'marxy-arch-seg');
      seg.setAttribute('data-marxy-seg', s.kind);
      seg.setAttribute('data-marxy-strip-from', String(s.from));
      seg.setAttribute('data-marxy-strip-to', String(s.to));
      const b = boxes[i]!;
      seg.style.left = `${b.x}px`;
      seg.style.width = `${b.w}px`;
      seg.title = segWords(s);
      if (s.kind === 'entry' && s.header && s.to > s.from) {
        const head = el('i', 'marxy-arch-seg-head');
        head.style.width = `${Math.max(1, (s.header / (s.to - s.from)) * b.w)}px`;
        seg.append(head);
      }
      const e = s.kind === 'entry' && s.index !== undefined ? listing.entries[order.get(s.index) ?? -1] : undefined;
      if (e && b.w >= SEG_NAMED) {
        const name = el('span', 'marxy-arch-seg-name');
        setMarked(name, basename(e.path.replace(/\/$/, '')));
        seg.append(name);
      }
      if (s.index !== undefined) {
        const to = s.index;
        seg.addEventListener('click', (ev) => {
          ev.stopPropagation();
          h.goTo(to);
        });
      }
      return seg;
    });
    stripEl.replaceChildren(...segEls);
    capEl.textContent = sentence();
    paintLit();
  }

  function paintLit(): void {
    segEls.forEach((s, i) => s.classList.toggle('marxy-arch-seg-on', litIndex !== null && stripHolds(segs[i]!, litIndex, order)));
  }

  // ---- x-ray ------------------------------------------------------------------------------------------------------

  let xrayShown: { index: number; box: HTMLElement } | null = null;

  function dropXray(): void {
    xrayShown?.box.remove();
    xrayShown = null;
  }

  async function xrayBox(e: ArchiveEntry): Promise<HTMLElement> {
    const name = basename(e.path.replace(/\/$/, ''));
    if (inMemory) return textBox(`As stored · ${name}`, [`This archive is held in memory, inside another: its entries have no place on disk to read a header from. Open the outer archive to x-ray ${name}.`]);
    if (sevenZ) return textBox(`As stored · ${name}`, ['A 7z keeps no header for one entry: every entry is described in the one header at the end of the file, and its bytes lie inside a packed block.']);
    if (e.offset === null) return textBox(`As stored · ${name}`, ['The archive does not say where this entry’s header lies.']);
    if (compressed) {
      return textBox(`As stored · ${name}`, [
        `Its ${TAR_BLOCK}-byte header is at byte ${n2(e.offset)} of the unpacked stream, inside the ${streamName()} stream: it has no bytes of its own in the file to show.`,
        'Source (\\) shows the packed bytes.',
      ]);
    }
    if (zip) {
      const first = await shell.readRange(path, e.offset, 30);
      const lh = localHeaderOf(first);
      if (!lh) return bytesBox(`As stored · ${name} · not a local header at byte ${n2(e.offset)}`, first, e.offset);
      locals.set(e.index, lh);
      const bytes = await shell.readRange(path, e.offset, lh.length);
      return bytesBox(`As stored · the local header of ${name} · bytes ${n2(e.offset)}–${n2(e.offset + lh.length - 1)}`, bytes, e.offset);
    }
    const bytes = await shell.readRange(path, e.offset, TAR_BLOCK);
    return bytesBox(`As stored · the header of ${name} · bytes ${n2(e.offset)}–${n2(e.offset + TAR_BLOCK - 1)}`, bytes, e.offset);
  }

  // ---- the stored record ------------------------------------------------------------------------------------------

  function record(e: ArchiveEntry): HTMLElement | null {
    if (!revealed.has(path)) return null;
    const rec = el('div', 'marxy-arch-rec');
    const add = (k: string, v: string): void => {
      rec.append(el('span', 'marxy-arch-rec-k', k), el('span', 'marxy-arch-rec-v', v));
    };
    const unpackedStream = compressed && listing.format.startsWith('tar.') ? ' of the unpacked stream' : '';
    if (e.offset !== null) add('Header', `at byte ${n2(e.offset)}${unpackedStream}`);
    const lh = localOf(e);
    const dataLength = zip ? e.packed : e.kind === 'file' ? e.size : 0;
    const dataAt = e.offset === null ? null : zip ? (lh ? e.offset + lh.length : null) : e.offset + TAR_BLOCK;
    if (dataAt !== null && dataLength !== null) add('Data', dataLength > 0 ? `bytes ${n2(dataAt)} to ${n2(dataAt + dataLength - 1)}${unpackedStream}` : `none, at byte ${n2(dataAt)}`);
    else if (zip && lh === undefined) add('Data', '…');
    if (zip) {
      const m = methods?.[e.index] ?? lh?.method;
      add('Method', m !== undefined ? `${m}, ${methodName(m)}` : (methodOf(e) ?? 'not said'));
      if (e.packed !== null) add('Packed', `${n2(e.packed)} bytes`);
    } else if (sevenZ && e.packed !== null) add('Packed', `${n2(e.packed)} bytes, a block of its own`);
    if (e.crc !== null) add('Checksum', e.crc.toString(16).padStart(8, '0'));
    if (e.flags !== null) {
      const words = flagWords(e.flags);
      add('Flags', `0x${e.flags.toString(16).padStart(4, '0')}${words.length > 0 ? `, ${words.join(', ')}` : ''}`);
    }
    if (e.host !== null) add('Written on', e.host);
    if (e.mode !== null) add('Mode', `${modeWords(e.mode)} · ${modeOctal(e.mode)}`);
    if (e.comment !== null) add('Comment', e.comment);
    return rec;
  }

  // ---- Metadata's "The file" ----------------------------------------------------------------------------------------

  function counted(values: readonly (string | null)[]): string | null {
    const by = new Map<string, number>();
    for (const v of values) if (v !== null) by.set(v, (by.get(v) ?? 0) + 1);
    if (by.size === 0) return null;
    if (by.size === 1) return [...by.keys()][0]!;
    return [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v, n]) => `${v} ${n2(n)}`).join(' · ');
  }

  const DAYS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayOf = (t: string): string | null => {
    const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(t);
    return m ? `${Number(m[3])} ${DAYS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : null;
  };

  function fileRows(body: HTMLElement): void {
    const s = archiveSums(listing);
    const files = listing.entries.filter((e) => e.kind === 'file');
    body.append(factRow('form', h.lede.form));
    if (!(s.unknownSize && s.unpacked === 0)) body.append(factRow('unpacked', shortSize(s.unpacked)));
    if (s.unpacked > 0) {
      const pct = (listing.size / s.unpacked) * 100;
      body.append(factRow('packs', `to ${pct < 1 ? 'under 1' : Math.round(pct)}% of its unpacked size`));
    }
    const lede = h.lede;
    const root = lede.shape ? `${lede.shape.by}: ${lede.shape.what}` : lede.wrap ? `one folder, ${lede.wrap}, holds everything` : `${n2(files.length)} ${files.length === 1 ? 'file' : 'files'}${lede.folders > 0 ? ` and ${n2(lede.folders)} ${lede.folders === 1 ? 'folder' : 'folders'}` : ''}`;
    body.append(factRow('at its root', root));
    if (zip) {
      stored();
      const m = counted(files.map(methodOf));
      if (m) body.append(factRow('methods', m));
    } else if (listing.format === 'tar') body.append(factRow('methods', 'none: a tar keeps each entry as it is'));
    else if (sevenZ) {
      const m = counted(files.map((e) => e.method));
      if (m) body.append(factRow('not read', m));
    } else body.append(factRow('methods', `${streamName()}, over the whole file`));
    const hosts = counted(listing.entries.map((e) => e.host));
    if (hosts) body.append(factRow('written on', hosts));
    const days = listing.entries.map((e) => (e.mtime ? e.mtime.slice(0, 10) : null)).filter((d): d is string => d !== null).sort();
    if (days.length > 0) {
      const a = dayOf(days[0]!);
      const b = dayOf(days.at(-1)!);
      if (a && b) body.append(factRow('dates', a === b ? a : `${a} to ${b}`));
    }
  }

  return {
    switch: {
      on: () => revealed.has(path),
      set(on) {
        if (on === revealed.has(path)) return;
        if (on) revealed.add(path);
        else revealed.delete(path);
        if (on) stored();
        else dropXray();
        h.changed();
      },
    },
    pageClass: 'marxy-arch-revealed',
    strip() {
      observer?.disconnect();
      observer = null;
      stripEl = capEl = wrapEl = null;
      if (!revealed.has(path)) return null;
      stored();
      wrapEl = el('div', 'marxy-arch-stripbox');
      stripEl = el('div', 'marxy-arch-strip');
      stripEl.setAttribute('aria-label', `${basename(path)} as stored, byte by byte`);
      capEl = el('p', 'marxy-arch-stripcap');
      wrapEl.append(stripEl, capEl);
      const strip = stripEl;
      observer = new ResizeObserver(() => {
        if (strip.clientWidth !== lastW) drawStrip();
      });
      observer.observe(strip);
      lastW = -1;
      return wrapEl;
    },
    lit(index) {
      if (xrayShown && xrayShown.index !== index) dropXray();
      if (index === litIndex) return;
      litIndex = index;
      paintLit();
    },
    cols() {
      if (!revealed.has(path)) return [];
      return [el('span', 'marxy-arch-rv', 'Packed'), el('span', 'marxy-arch-rv', 'By'), el('span', 'marxy-arch-rv', 'At byte')];
    },
    cells(e) {
      if (!revealed.has(path)) return [];
      const cell = (text: string): HTMLElement => {
        const c = el('span', 'marxy-arch-rv', text);
        c.setAttribute('role', 'gridcell');
        return c;
      };
      const file = e?.kind === 'file';
      return [cell(file && e.packed !== null ? n2(e.packed) : ''), cell((file && methodOf(e)) || ''), cell(e?.offset != null ? n2(e.offset) : '')];
    },
    record,
    xray: (e) => async () => {
      if (xrayShown?.index === e.index) {
        dropXray();
        return null;
      }
      const box = await xrayBox(e).catch((err: unknown) => textBox(`As stored · ${basename(e.path)}`, [err instanceof Error ? err.message : String(err)]));
      const at = h.xrayAfter();
      dropXray();
      if (!alive || !at) return null;
      box.classList.add('marxy-xray-current');
      at.after(box);
      xrayShown = { index: e.index, box };
      box.scrollIntoView({ block: 'nearest' });
      return null;
    },
    fileCard: (base) => ({
      ...base,
      render(body, ctx) {
        const stop = base.render(body, ctx);
        fileRows(body);
        return stop;
      },
    }),
    destroy() {
      alive = false;
      observer?.disconnect();
      observer = null;
      dropXray();
    },
  };
}
