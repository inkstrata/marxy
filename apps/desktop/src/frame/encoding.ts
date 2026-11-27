// Text in another encoding: the head's mark, the Reading card's Encoding, Transform's Read with
// encoding..., and reading the open file again when the reader chooses. Found from a BOM is a fact (Facts and the card,
// never the head); guessed is a guess (blue in the head, the card naming the byte that ruled out UTF-8); chosen is the
// reader's (said as yours, with the way back). The bytes are never changed.
import type { EncodingFound, EncodingReadings } from '@marxy/core/src/encoding/byte-map.ts';
import type { AppHandle } from '../app.ts';
import { adoptReread, chooseEncoding, encodingChoiceOf, fileOffset, heldEncoding, onEncodingChoice, readingsFor, stageReread } from '../document/encoding.ts';
import type { DocumentStore } from '../document/store.ts';
import { notify, paneOf } from '../notices/index.ts';
import { el } from './dom.ts';
import type { FramePane } from './types.ts';

const hex2 = (b: number): string => b.toString(16).toUpperCase().padStart(2, '0');
const count = (n: number): string => n.toLocaleString('en-GB');

/** What the file would be read as without the reader's choice, and how that would be known. */
function detectedOf(found: EncodingFound | null): { label: string; name: string; how: EncodingFound['how'] } {
  if (!found) return { label: 'utf-8', name: 'UTF-8', how: 'utf8' };
  if (found.how !== 'chosen') return { label: found.label, name: found.name, how: found.how };
  const label = found.detected ?? 'utf-8';
  return { label, name: NAMES[label] ?? label, how: found.detectedHow ?? 'utf8' };
}

const NAMES: Readonly<Record<string, string>> = {
  'utf-8': 'UTF-8', 'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE', 'utf-32le': 'UTF-32 LE', 'utf-32be': 'UTF-32 BE',
  'windows-1252': 'Windows-1252', 'iso-8859-1': 'ISO-8859-1', 'iso-8859-15': 'ISO-8859-15', macintosh: 'Mac Roman',
  'windows-1251': 'Windows-1251', 'koi8-r': 'KOI8-R', shift_jis: 'Shift_JIS', gb18030: 'GB18030', gbk: 'GBK', 'euc-kr': 'EUC-KR', big5: 'Big5',
};

/** The head's mark for how the file's bytes are read: a guess, or the reader's choice; null for a fact (a BOM) and for UTF-8. */
export function encodingMarkOf(path: string | null): { readonly label: string; readonly how: 'guessed' | 'your choice'; readonly mine: boolean } | null {
  const found = heldEncoding(path)?.found;
  if (!found) return null;
  if (found.how === 'chosen') return { label: found.name, how: 'your choice', mine: true };
  if (found.how === 'guess') return { label: found.name, how: 'guessed', mine: false };
  return null;
}

// ---- reading the file again --------------------------------------------------------------------------------------

const rereading = new WeakMap<DocumentStore, Promise<void>>();

/** The panes showing `path`, and its store. */
function showing(handle: AppHandle, path: string): { panes: FramePane[]; store: DocumentStore | null } {
  const panes = handle.panes().panes.filter((p) => p.path() === path) as FramePane[];
  return { panes, store: panes.map((p) => p.content.store()).find((s): s is DocumentStore => s !== null) ?? null };
}

/**
 * The open file read again under the choice made now, in every pane that shows it, each kept at the file's byte it was
 * at. Refused over unsaved changes: reading the bytes again would replace them.
 */
async function reread(handle: AppHandle, path: string): Promise<void> {
  const { panes, store } = showing(handle, path);
  if (!store || panes.length === 0) return;
  const before = heldEncoding(path)?.found ?? null;
  const want = encodingChoiceOf(path) ?? detectedOf(before).label;
  const now = before?.label ?? 'utf-8';
  if (want === now && (before?.how === 'chosen') === (encodingChoiceOf(path) !== null)) return;
  const going = rereading.get(store);
  if (going) return going;
  const run = panes[0]!.view.serially(async () => {
    const snap = store.snapshot();
    if (snap.dirty || panes.some((p) => p.view.sourceHasUnfoldedEdits())) {
      notify({ kind: 'refused', text: 'Save or undo your changes first: reading the file another way reads its bytes again.' }, { pane: paneOf(panes[0]!.article) });
      return;
    }
    const raw = heldEncoding(path)?.raw ?? snap.disk;
    if (!raw) return;
    const places = panes.map((p) => {
      const place = p.view.position();
      return { view: p.view, place, at: fileOffset(path, snap.buffer.bytes, place.byteOffset) };
    });
    const next = await stageReread(handle.shell, path, raw);
    for (const { view, place, at } of places) view.expectReloadAt({ ...place, byteOffset: next.toBuffer(at) });
    try {
      await store.reload(next.text);
    } finally {
      for (const { view } of places) view.expectReloadAt(null);
    }
    adoptReread(path);
    for (const { view } of places) await view.settled();
  });
  rereading.set(store, run.finally(() => rereading.delete(store)));
  return run;
}

/** A pane follows the reader's encoding choices for the file it shows (and one read back from readings.json at launch). */
export function followEncodingChoices(pane: FramePane, handle: () => AppHandle | null): () => void {
  return onEncodingChoice((path) => {
    const h = handle();
    if (h && pane.path() === path) void reread(h, path);
  });
}

/** Read with encoding...: `label` from now on, or back to how the bytes say (null, or the label they say). */
export function readWithEncoding(path: string, label: string | null): void {
  const found = heldEncoding(path)?.found ?? null;
  const detected = detectedOf(found);
  const mine = label !== null && label !== detected.label ? label : null;
  if (mine === encodingChoiceOf(path)) return;
  chooseEncoding(path, mine);
  notify({
    kind: 'info',
    transient: true,
    text: mine ? `Read as ${NAMES[mine] ?? mine}. Kept in readings.json; the bytes are unchanged.` : `Back to ${detected.name}, as ${detected.how === 'bom' ? 'its BOM says' : detected.how === 'guess' ? 'the app guessed' : 'its bytes say'}.`,
  });
}

// ---- words -------------------------------------------------------------------------------------------------------

const BOM_WHY: Readonly<Record<string, string>> = {
  'utf-8': 'It starts EF BB BF, UTF-8’s byte-order mark.',
  'utf-16le': 'It starts FF FE, the byte-order mark of UTF-16, little-endian: two bytes to a character, the low byte first. Notepad and PowerShell 5 write it.',
  'utf-16be': 'It starts FE FF, the byte-order mark of UTF-16, big-endian: two bytes to a character, the high byte first.',
  'utf-32le': 'It starts FF FE 00 00, the byte-order mark of UTF-32, little-endian: four bytes to a character.',
  'utf-32be': 'It starts 00 00 FE FF, the byte-order mark of UTF-32, big-endian: four bytes to a character.',
};

const LIKELIEST: Readonly<Record<string, string>> = {
  'windows-1252': 'the likeliest for text written on Windows in English and western European languages',
  'windows-1251': 'the likeliest for Russian and other Cyrillic text written on Windows',
  'koi8-r': 'the likeliest for Russian text from older Unix mail and news',
  shift_jis: 'the likeliest for Japanese text written on Windows',
  'euc-jp': 'the likeliest for Japanese text from older Unix systems',
  gbk: 'the likeliest for simplified Chinese text',
  gb18030: 'the likeliest for simplified Chinese text',
  big5: 'the likeliest for traditional Chinese text',
  'euc-kr': 'the likeliest for Korean text',
};

/** Why the file is read as it is, a sentence a line. */
export function encodingWhy(found: EncodingFound): string[] {
  if (found.how === 'bom') return [BOM_WHY[found.label] ?? 'Its byte-order mark says so.'];
  if (found.how === 'chosen') {
    const d = detectedOf(found);
    return [`You chose it in Read with encoding…; without the choice it would be read as ${d.name}${d.how === 'guess' ? ', guessed' : d.how === 'bom' ? ', from its BOM' : ''}.`, 'The choice is kept in readings.json. The bytes are unchanged.'];
  }
  const lines: string[] = [];
  const d = found.deciding;
  if (d) lines.push(`It is not UTF-8: the byte ${hex2(d.byte)} at offset ${count(d.offset)} (line ${count(d.line)}, column ${count(d.column)}) cannot start a UTF-8 character, and no BOM says otherwise.`);
  const e = found.evidence;
  if (e && e.shown.length > 0) {
    const shown = e.shown.slice(0, 8).map(([b, ch]) => `${hex2(b)} ${ch}`).join(', ');
    const c1 = e.c1 > 0 && found.label === 'windows-1252' ? `, ${count(e.c1)} of them in 80 to 9F, where Windows-1252 keeps its quotes and dashes and ISO-8859-1 has only controls` : '';
    lines.push(`Its ${count(e.high)} ${e.high === 1 ? 'byte' : 'bytes'} above 7F ${e.high === 1 ? 'is' : 'are'} ${count(e.distinct)} different ${e.distinct === 1 ? 'value' : 'values'}${e.allLetters ? `, every one a letter or a mark in ${found.name}` : ''}${c1}: ${shown}${e.shown.length > 8 || e.distinct > 8 ? '…' : ''}.`);
  } else if (e) {
    lines.push(`Its ${count(e.high)} bytes above 7F read as ${found.name} with ${found.unreadable === 0 ? 'none it cannot read' : `${count(found.unreadable)} it cannot read`}.`);
  }
  lines.push(`So it is read as ${found.name}${LIKELIEST[found.label] ? `, ${LIKELIEST[found.label]}` : ''}. Read with encoding… tries others.`);
  return lines;
}

/** Facts' bytes line for a file held here: "UTF-16 LE · CRLF · a BOM". */
export function encodingFactWords(found: EncodingFound, eol: string): string {
  return [found.name, eol, found.bom > 0 ? 'a BOM' : 'no BOM'].join(' · ');
}

// ---- the Reading card ----------------------------------------------------------------------------------------------

/** Read with encoding... opened from the card: Transform draws its list open for this file. */
let openFor: string | null = null;
export const encodingListOpenFor = (path: string): boolean => openFor === path;

/** The Reading card's Encoding: how the file's bytes are read, why, and the ways to read them otherwise. */
export function renderEncodingBlock(body: HTMLElement, path: string, handle: AppHandle): void {
  const found = heldEncoding(path)?.found;
  if (!found) return;
  const box = el('div', 'marxy-encoding');
  box.append(el('p', 'marxy-card-line marxy-encoding-title', 'Encoding'));
  const line = el('p', 'marxy-card-note');
  line.append(el('span', 'marxy-encoding-name', found.name), ' · ');
  const how = found.how === 'chosen' ? 'your choice' : found.how === 'bom' ? 'found: its byte-order mark' : 'guessed: no BOM, and not UTF-8';
  line.append(el('span', found.how === 'guess' ? 'marxy-guessed' : '', how));
  const why = el('button', 'marxy-linkish', 'why?');
  why.type = 'button';
  why.setAttribute('aria-expanded', 'false');
  const list = el('ul', 'marxy-reasons');
  list.hidden = true;
  for (const w of encodingWhy(found)) list.append(el('li', '', w));
  why.addEventListener('click', () => {
    list.hidden = !list.hidden;
    why.setAttribute('aria-expanded', String(!list.hidden));
    why.textContent = list.hidden ? 'why?' : 'hide why';
  });
  line.append(' · ', why);
  box.append(line, list);
  const ways = el('p', 'marxy-card-note');
  const open = el('button', 'marxy-linkish', 'Read with encoding…');
  open.type = 'button';
  open.addEventListener('click', () => {
    openFor = path;
    handle.frame().left.show('transforms');
    requestAnimationFrame(() => document.querySelector('.marxy-encodings')?.scrollIntoView({ block: 'nearest' }));
  });
  ways.append(open);
  if (found.how === 'chosen') {
    const back = el('button', 'marxy-linkish', `Back to ${detectedOf(found).name}`);
    back.type = 'button';
    back.addEventListener('click', () => readWithEncoding(path, null));
    ways.append(' · ', back);
  }
  box.append(ways);
  body.append(box);
}

// ---- Transform: Read with encoding... ------------------------------------------------------------------------------

const readingsCache = new WeakMap<Uint8Array, Promise<EncodingReadings | null>>();

/** Transform's Read with encoding...: each encoding's reading of the same few bytes, the guess in blue; a press reads the file so. */
export function encodingSection(handle: AppHandle, path: string, redraw: () => void): HTMLElement {
  const h = heldEncoding(path);
  const found = h?.found ?? null;
  const store = handle.panes().panes.find((p) => p.path() === path)?.content.store() ?? null;
  const raw = h?.raw ?? store?.snapshot().disk ?? null;
  const root = el('section', 'marxy-dsec marxy-encodings');
  const head = el('div', 'marxy-dlab');
  const note = found?.how === 'chosen' ? 'your choice' : found?.how === 'bom' ? 'found: its BOM' : found?.how === 'guess' ? 'guessed' : 'UTF-8';
  head.append(el('span', '', 'Read with encoding…'), el('small', found?.how === 'guess' ? 'marxy-guessed' : '', note));
  root.append(head);
  const open = openFor === path || found?.how === 'guess' || found?.how === 'chosen';
  if (!open || !raw) {
    const show = el('button', 'marxy-btn', 'Show each encoding’s reading');
    show.type = 'button';
    show.disabled = !raw;
    show.addEventListener('click', () => {
      openFor = path;
      redraw();
    });
    const row = el('div', 'marxy-brow');
    row.append(show);
    root.append(row);
    return root;
  }
  const list = el('div', 'marxy-enc-ways');
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', 'Read this file with encoding');
  list.append(el('p', 'marxy-dnote', 'Reading the bytes each way…'));
  root.append(list);
  root.append(el('p', 'marxy-dnote', 'Each is the same line of bytes, read another way: the line where they differ. The bytes are never changed; the choice is kept in readings.json.'));
  let made = readingsCache.get(raw);
  if (!made) {
    made = readingsFor(handle.shell, path, raw).catch(() => null);
    readingsCache.set(raw, made);
  }
  const now = found?.label ?? 'utf-8';
  const guess = found?.how === 'guess' ? found.label : null;
  void made.then((readings) => {
    list.replaceChildren();
    if (!readings) {
      list.append(el('p', 'marxy-dnote', 'This shell cannot read the bytes another way.'));
      return;
    }
    for (const r of readings.rows) {
      const b = el('button', 'marxy-enc-way');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(r.label === now));
      b.value = r.label;
      const name = el('span', 'marxy-enc-name');
      name.append(el('span', r.label === guess ? 'marxy-guessed' : '', r.name));
      const sub = r.unreadable > 0 ? `${count(r.unreadable)} ${r.unreadable === 1 ? 'byte' : 'bytes'} it cannot read` : r.controls > 0 ? `${count(r.controls)} control ${r.controls === 1 ? 'character' : 'characters'}` : r.label === guess ? 'the guess' : '';
      if (sub) name.append(el('small', '', sub));
      const sample = el('span', 'marxy-enc-sample', r.sample.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '·').slice(0, 64) || ' ');
      sample.dir = 'auto';
      b.append(name, sample);
      b.addEventListener('click', () => readWithEncoding(path, r.label));
      list.append(b);
    }
    if (readings.counted < (found?.fileBytes ?? raw.length)) list.append(el('p', 'marxy-dnote', `Bytes it cannot read are counted in the first ${count(readings.counted)} bytes.`));
  });
  return root;
}
