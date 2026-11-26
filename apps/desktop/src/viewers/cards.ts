// The panel's cards for a viewed file: each slot takes the kind's name. Reading says how the file is
// shown and why; the fourth card is Image; the metadata slot (Front matter for Markdown) is EXIF, its location named and
// shown only when asked, for that tab only; Facts as for any file; and a byte picked in the hex view is a passing card,
// as Selection is.
import { firstBytes, hex2 } from '@marxy/core/src/viewer/bytes.ts';
import { byteAsText, byteValues } from '@marxy/core/src/viewer/hex.ts';
import { ORIENTATION_WORDS, orientedSize, percent } from '@marxy/core/src/viewer/image.ts';
import type { ImageFacts } from '@marxy/shell-api';
import { appHandle } from '../commands/app-handle.ts';
import { writeCopy } from '../commands/copy-write.ts';
import { el, factRow } from '../frame/dom.ts';
import type { CardDef } from '../frame/cards/types.ts';
import { buildAppContext } from '../selection/bind.ts';
import { dateWords, formatName, sizeLine, whyLines, type ViewedFile } from './file.ts';
import { entryWhere } from '../document/entries.ts';
import { viewerChanged } from './signal.ts';

const n2 = (n: number): string => n.toLocaleString('en-GB');

/** The Reading card: what the file is shown as, from what, why (folded), and the other way to show it. */
export function readingCard(o: {
  file: ViewedFile;
  facts: () => ImageFacts | null;
  /** "an image · JPEG", "no reading · a file card and the bytes". */
  shownAs: () => string;
  /** The other way, and its words: "Show the file card and the bytes instead". */
  other?: () => { readonly words: string; run(): void } | null;
  /** Why it is shown as it is, in place of what its head and name say. */
  reasons?: () => readonly string[];
  /** The kind's tiers, the one it is shown in marked (a specimen, its tables only, the bytes). */
  tiers?: () => { readonly items: readonly { readonly name: string; readonly words: string }[]; readonly at: number } | null;
  /** What the page caps or never does, one line each. */
  caps?: () => readonly string[];
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
      const facts = o.facts();
      // Guessed is the name's silence, whether or not the app reads facts of the kind (a PDF's come from pdf.js).
      const said = o.file.guessed
        ? el('span', 'marxy-guessed', 'guessed from its first bytes; the name did not say')
        : el('span', '', facts ? 'from its first bytes and its name' : o.file.magic ? 'from its first bytes and its name' : 'from its first bytes: no format the app reads');
      const why = el('button', 'marxy-linkish', open ? 'hide why' : 'why?');
      why.type = 'button';
      why.setAttribute('aria-expanded', String(open));
      const list = el('ul', 'marxy-reasons');
      for (const w of o.reasons?.() ?? whyLines(o.file, facts)) list.append(el('li', '', w));
      list.hidden = !open;
      why.addEventListener('click', () => {
        open = !open;
        list.hidden = !open;
        why.textContent = open ? 'hide why' : 'why?';
        why.setAttribute('aria-expanded', String(open));
      });
      from.append(said, ' · ', why);
      body.append(line, from, list);
      const tiers = o.tiers?.();
      if (tiers) {
        const ol = el('ol', 'marxy-tiers');
        tiers.items.forEach((item, i) => {
          const li = el('li');
          li.toggleAttribute('data-marxy-here', i === tiers.at);
          li.append(el('b', '', item.name), el('span', '', item.words));
          ol.append(li);
        });
        body.append(ol);
      }
      const caps = o.caps?.() ?? [];
      if (caps.length > 0) {
        const ul = el('ul', 'marxy-reasons');
        for (const c of caps) ul.append(el('li', '', c));
        body.append(el('p', 'marxy-card-sub', 'Caps'), ul);
      }
      const other = o.other?.();
      if (other) {
        const p = el('p', 'marxy-card-note');
        const b = el('button', 'marxy-linkish', other.words);
        b.type = 'button';
        b.addEventListener('click', () => other.run());
        p.append(b);
        body.append(p);
      }
    },
  };
}

/** Facts, as for any file: size, whether it is text and how it starts, its date, its path. */
export function factsCard(file: ViewedFile, hideBytes = false): CardDef {
  return {
    id: 'facts',
    title: () => 'Facts',
    relevant: () => true,
    render(body) {
      const bytes = el('span');
      if (hideBytes) bytes.append('not shown: the file holds a private key');
      else {
        const head = firstBytes(file.head, file.magic && file.magic.len > 0 ? Math.min(file.magic.len, 12) : 4);
        bytes.append('not text · starts ', el('code', 'marxy-fact-code', head.hex));
      }
      const where = entryWhere(file.path);
      body.append(factRow('size', sizeLine(file)), factRow('bytes', bytes), factRow('modified', dateWords(file.mtimeMs)), ...(file.createdMs ? [factRow('created', dateWords(file.createdMs))] : []), factRow('path', where ?? file.path, where ? 'In memory, not on disk' : file.path));
    },
  };
}

const CHANNEL_WORDS: Readonly<Record<string, string>> = {
  RGB: '3 channels',
  RGBA: '4 channels with alpha',
  Gray: '1 channel, grey',
  GrayA: '2 channels, grey with alpha',
  Indexed: 'a palette',
  CMYK: '4 channels, CMYK, shown as RGB',
  Lab: '3 channels, Lab',
};

const isVector = (facts: ImageFacts | null): boolean => facts?.format === 'svg' || facts?.format === 'svgz';

/** Whether pixels may be transparent: a channel of alpha, a palette (which may hold a clear colour), or a drawing. */
export const mayBeClear = (facts: ImageFacts | null): boolean => facts === null || isVector(facts) || /A$|Indexed/.test(facts.channels ?? '');

/** The Image card: the picture's own facts, read from its bytes. */
export function imageCard(o: { facts: () => ImageFacts | null; natural: () => { w: number; h: number } | null; shown: () => { z: number; fit: boolean } | null; scripts: () => number | null }): CardDef {
  const size = (): { w: number; h: number } | null => {
    const f = o.facts();
    if (f && f.width > 0) return orientedSize(f.width, f.height, f.orientation);
    return o.natural();
  };
  return {
    id: 'contents',
    title: () => 'Image',
    detail: () => {
      const s = size();
      return s ? `${n2(s.w)} × ${n2(s.h)}` : '';
    },
    relevant: () => true,
    render(body) {
      const f = o.facts();
      const s = size();
      const vector = isVector(f);
      const sizeValue = el('span', '', s ? `${n2(s.w)} × ${n2(s.h)} ${vector ? 'units, from its own size' : 'pixels'}` : 'as the webview draws it');
      if (f && f.orientation >= 2) {
        sizeValue.append(el('br'), el('span', 'marxy-fact-quiet', `stored ${n2(f.width)} × ${n2(f.height)}, ${ORIENTATION_WORDS[f.orientation]} by its EXIF`));
      }
      body.append(factRow('size', sizeValue));
      const shown = o.shown();
      const shownRow = factRow('shown at', shown ? `${percent(shown.z)}${shown.fit ? ', to fit' : ''}` : 'to fit');
      shownRow.querySelector('.marxy-fact-v')?.setAttribute('data-marxy-shown', '');
      body.append(shownRow);
      if (!f) {
        body.append(el('p', 'marxy-card-note', 'Its format, depth and colour profile are read by the shell, which has not said them here.'));
        return;
      }
      body.append(factRow('format', vector ? `${formatName(f.format)}, a drawing: sharp at any size` : formatName(f.format)));
      const depth = vector
        ? 'not pixels'
        : f.channels === 'Indexed'
          ? `${f.bitDepth ?? 8}-bit indexed, a palette`
          : [f.bitDepth ? `${f.bitDepth} bits a channel` : null, f.channels ? CHANNEL_WORDS[f.channels] ?? f.channels : null].filter(Boolean).join(' · ') || 'not said';
      body.append(factRow('depth', depth));
      body.append(factRow('colour', f.colorProfile ?? (vector ? 'sRGB, as the web assumes' : 'no profile: read as sRGB')));
      body.append(factRow('transparent', /A$/.test(f.channels ?? '') ? 'yes, shown over checks' : f.channels === 'Indexed' ? 'a palette may hold a clear colour: shown over checks' : vector ? 'where it draws nothing: shown over checks' : 'no'));
      if (f.frames > 1) body.append(factRow('frames', `${n2(f.frames)}, animated`));
      if (f.note) body.append(el('p', 'marxy-card-note', f.note));
      const scripts = o.scripts();
      if (vector && scripts !== null) body.append(factRow('scripts', scripts > 0 ? `${scripts} in the file, never run: it is drawn as an image` : 'none'));
    },
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Oct 2026, 07:41:09, by the camera's clock (no zone)" from EXIF's "2026:10:12 07:41:09" (or an ISO date). */
export function takenWords(taken: string): string {
  const m = /^(\d{4})[:-](\d\d)[:-](\d\d)[ T](\d\d:\d\d(?::\d\d)?)/.exec(taken.trim());
  if (!m) return taken;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}, ${m[4]}, by the camera's clock (no zone)`;
}

const unit = (v: string | undefined, re: RegExp, add: (s: string) => string): string | undefined => (v === undefined ? undefined : re.test(v.trim()) ? add(v.trim()) : v);

/** "50.10281° N, 5.54969° W". */
export const placeWords = (loc: { lat: number; lon: number }): string =>
  `${Math.abs(loc.lat).toFixed(5)}° ${loc.lat < 0 ? 'S' : 'N'}, ${Math.abs(loc.lon).toFixed(5)}° ${loc.lon < 0 ? 'W' : 'E'}`;

/** The EXIF card: the camera's own notes; a location named, and shown only on request, for this tab only. */
export function exifCard(o: { facts: () => ImageFacts | null; revealed: () => boolean; reveal: (on: boolean) => void }): CardDef {
  return {
    id: 'frontmatter',
    title: () => 'EXIF',
    detail: () => 'the camera’s own notes',
    relevant: () => {
      const f = o.facts();
      return !!f && (f.exif !== null || f.location !== null || f.orientation > 1);
    },
    render(body) {
      const f = o.facts();
      if (!f || (!f.exif && !f.location && f.orientation <= 1)) {
        body.append(el('p', 'marxy-card-note', 'The file carries no camera notes.'));
        return;
      }
      const x = f.exif ?? {};
      const exposure = [unit(x.exposure, /^\d+(\/\d+)?$/, (s) => `${s} s`), unit(x.aperture, /^[\d.]+$/, (s) => `f/${s}`), x.iso ? `ISO ${x.iso}` : undefined].filter(Boolean).join(' · ');
      const rows: [string, string | undefined][] = [
        ['camera', x.camera],
        ['lens', x.lens],
        ['exposure', exposure || undefined],
        ['focal length', unit(x.focalLength, /^[\d.]+$/, (s) => `${s} mm`)],
        ['taken', x.taken ? takenWords(x.taken) : undefined],
        ['orientation', f.orientation > 1 ? `${ORIENTATION_WORDS[f.orientation]}: shown upright` : undefined],
        ['software', x.software],
      ];
      for (const [k, v] of rows) if (v) body.append(factRow(k, v));
      if (!f.location) return;
      const value = el('span', 'marxy-exif-place');
      if (!o.revealed()) {
        const show = el('button', 'marxy-linkish', 'Show where it was taken');
        show.type = 'button';
        show.addEventListener('click', () => o.reveal(true));
        value.append(el('span', 'marxy-fact-quiet', 'In the file, not shown. '), show);
      } else {
        const where = placeWords(f.location);
        const hide = el('button', 'marxy-linkish', 'Hide it');
        hide.type = 'button';
        hide.addEventListener('click', () => o.reveal(false));
        const copy = el('button', 'marxy-linkish', 'Copy');
        copy.type = 'button';
        copy.addEventListener('click', () => {
          const handle = appHandle();
          if (handle) void writeCopy(buildAppContext(handle), { text: where }, 'Copied where it was taken. Nothing else was kept');
        });
        value.append(el('span', 'marxy-exif-where', where), el('br'), hide, ' · ', copy, el('span', 'marxy-fact-quiet marxy-exif-note', 'Shown in this tab until you hide it or close the tab. Not kept, and no map is fetched.'));
      }
      body.append(factRow('location', value));
    },
  };
}

/** This byte: the passing card while a byte is picked in the hex view. */
export function byteCard(o: { file: ViewedFile; selected: () => number | null; bytesAt: (offset: number, n: number) => Uint8Array | null }): CardDef {
  return {
    id: 'selection',
    title: () => 'This byte',
    detail: () => {
      const i = o.selected();
      return i === null ? '' : `offset ${n2(i)}`;
    },
    relevant: () => o.selected() !== null,
    render(body) {
      const i = o.selected();
      if (i === null) return;
      const bytes = o.bytesAt(i, 4);
      body.append(factRow('offset', `0x${i.toString(16).toUpperCase()} · ${n2(i)}`));
      if (!bytes) {
        body.append(el('p', 'marxy-card-note', 'Reading it…'));
        return;
      }
      const v = byteValues(bytes);
      body.append(factRow('value', `${hex2(v.value)} · ${v.value} · ${v.value.toString(2).padStart(8, '0')}`), factRow('as text', byteAsText(v.value)));
      if (v.le16 !== null && v.be16 !== null) body.append(factRow('2 bytes', `${n2(v.le16)} little-endian · ${n2(v.be16)} big`));
      if (v.le32 !== null) body.append(factRow('4 bytes', `${n2(v.le32)} little-endian`));
      if (o.file.magic && i < o.file.magic.len) body.append(factRow('part of', o.file.magic.name));
      body.append(el('p', 'marxy-card-note marxy-card-foot', 'Arrows move it. Nothing here can change a byte.'));
    },
  };
}

/** Redraws the panel and the head after a viewer's own change. */
export const changed = viewerChanged;
