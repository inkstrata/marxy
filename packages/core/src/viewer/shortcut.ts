// A Windows shortcut (.lnk, the Shell Link format) read from its own bytes: what it points at, how it starts the target,
// and the target's size and times as the header recorded them. The bytes are untrusted, so every size and offset is
// checked against the buffer and a string is cut at `SHORTCUT_STRING_MAX`. Nothing here runs or resolves the target.
// Pure: no DOM, no I/O.

/** A shortcut is read from at most this many bytes; real ones are a few KB. */
export const SHORTCUT_READ_MAX = 1024 * 1024;
/** The most of one string that is read, in bytes of the file; the rest is dropped and the facts say so. */
export const SHORTCUT_STRING_MAX = 32 * 1024;

const HEADER_SIZE = 0x4c;
const CLSID = [0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46];
const ITEMS_MAX = 64;
const BLOCKS_MAX = 1024;

export interface ShortcutFacts {
  /** The path the shortcut points at, or null when it names none a path can say (a control panel, a printer). */
  readonly target: string | null;
  /** Where `target` came from: the link's own path, a network share, or the folders its item list names. */
  readonly targetFrom: 'local' | 'network' | 'items' | null;
  /** The relative path the shortcut also keeps, as written. */
  readonly relative: string | null;
  /** The target with its environment variables unexpanded, from the environment block. */
  readonly withVariables: string | null;
  readonly arguments: string | null;
  readonly workingDir: string | null;
  readonly description: string | null;
  readonly icon: { readonly path: string | null; readonly index: number } | null;
  /** The show command as stored: 1 normal, 3 maximised, 7 minimised. */
  readonly showCommand: number;
  readonly hotkey: string | null;
  /** Bytes, from the header: 0 when the target is a folder or the size was not written. */
  readonly targetSize: number;
  readonly targetIsFolder: boolean;
  readonly created: number | null;
  readonly accessed: number | null;
  readonly modified: number | null;
  /** A string was longer than `SHORTCUT_STRING_MAX` and was cut. */
  readonly cut: boolean;
}

export type ShortcutRead = { readonly ok: true; readonly facts: ShortcutFacts } | { readonly ok: false; readonly reason: string };

class Damaged extends Error {}
const bad = (reason: string): never => {
  throw new Damaged(reason);
};

/** Whether the head is a Shell Link header: its size, 0x4C, then the link's class id. */
export function isShellLink(head: Uint8Array): boolean {
  if (head.length < 20 || head[0] !== 0x4c || head[1] !== 0 || head[2] !== 0 || head[3] !== 0) return false;
  return CLSID.every((b, i) => head[4 + i] === b);
}

const UNSAFE = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/g;
/** A string for display: controls and the bidirectional overrides that could disguise a path become a replacement mark. */
const clean = (s: string): string => s.replace(UNSAFE, '�');

const ansiDecoder = ((): TextDecoder => {
  try {
    return new TextDecoder('windows-1252');
  } catch {
    return new TextDecoder('latin1');
  }
})();
const utf16 = new TextDecoder('utf-16le');

const GUIDS: Readonly<Record<string, string>> = { '20d04fe0-3aea-1069-a2d8-08002b30309d': 'This PC' };

// FILETIME is 100 ns ticks since 1601; 0 and values past year 9999 mean "not written".
function fileTime(lo: number, hi: number): number | null {
  if (lo === 0 && hi === 0) return null;
  const ms = (hi * 4294967296 + lo) / 10000 - 11644473600000;
  return ms > -62135596800000 && ms < 253402300800000 ? Math.round(ms) : null;
}

const VK_NAMES: Readonly<Record<number, string>> = { 0x90: 'Num Lock', 0x91: 'Scroll Lock' };

/** "Ctrl + Alt + F", or null when no key is set. */
export function hotkeyWords(code: number): string | null {
  const key = code & 0xff;
  if (key === 0) return null;
  const mods = (code >> 8) & 0xff;
  const name =
    key >= 0x30 && key <= 0x39
      ? String.fromCharCode(key)
      : key >= 0x41 && key <= 0x5a
        ? String.fromCharCode(key)
        : key >= 0x70 && key <= 0x87
          ? `F${key - 0x6f}`
          : (VK_NAMES[key] ?? `key 0x${key.toString(16).toUpperCase()}`);
  return [mods & 2 ? 'Ctrl' : '', mods & 4 ? 'Alt' : '', mods & 1 ? 'Shift' : '', name].filter(Boolean).join(' + ');
}

/** "a normal window", "a maximised window", "a minimised window"; any other stored value is shown as normal. */
export function showWords(cmd: number): string {
  if (cmd === 3) return 'a maximised window';
  if (cmd === 7) return 'a minimised window, not activated';
  if (cmd === 1) return 'a normal window';
  return `a normal window (stored as ${cmd}, which Windows shows as normal)`;
}

class Reader {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  cut = false;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8(at: number, what: string): number {
    if (at < 0 || at + 1 > this.bytes.length) bad(`its ${what} runs past the end of the file`);
    return this.bytes[at]!;
  }
  u16(at: number, what: string): number {
    if (at < 0 || at + 2 > this.bytes.length) bad(`its ${what} runs past the end of the file`);
    return this.view.getUint16(at, true);
  }
  u32(at: number, what: string): number {
    if (at < 0 || at + 4 > this.bytes.length) bad(`its ${what} runs past the end of the file`);
    return this.view.getUint32(at, true);
  }
  /** A NUL-terminated string at `at`, read no further than `end` and the cap. */
  nul(at: number, end: number, wide: boolean): string {
    const stop = Math.min(end, this.bytes.length);
    const unit = wide ? 2 : 1;
    let i = at;
    while (i + unit <= stop && i - at < SHORTCUT_STRING_MAX && (wide ? this.bytes[i] !== 0 || this.bytes[i + 1] !== 0 : this.bytes[i] !== 0)) i += unit;
    if (i - at >= SHORTCUT_STRING_MAX && i + unit <= stop) this.cut = true;
    return this.text(at, i - at, wide);
  }
  /** `n` bytes at `at` as a string, cut at the cap. */
  text(at: number, n: number, wide: boolean): string {
    const take = Math.max(0, Math.min(n, SHORTCUT_STRING_MAX, this.bytes.length - at));
    if (n > SHORTCUT_STRING_MAX) this.cut = true;
    const slice = this.bytes.subarray(at, at + (wide ? take - (take % 2) : take));
    return clean((wide ? utf16 : ansiDecoder).decode(slice));
  }
}

// The long name of a file or folder item: the Unicode string of its 0xBEEF0004 extension, whose place depends on the
// block's version. Null when the item has none.
function longName(r: Reader, start: number, end: number): string | null {
  for (let i = start; i + 8 <= end; i++) {
    if (r.bytes[i] !== 0x04 || r.bytes[i + 1] !== 0 || r.bytes[i + 2] !== 0xef || r.bytes[i + 3] !== 0xbe) continue;
    const block = i - 4;
    const version = r.view.getUint16(block + 2, true);
    const at = block + (version >= 9 ? 0x2e : version === 8 ? 0x2a : version === 7 ? 0x26 : 0x12);
    if (at < end) {
      const name = r.nul(at, end, true);
      if (name) return name;
    }
  }
  return null;
}

// Best effort: the names the filesystem items spell, joined as a path. A shell item that is not a drive, folder or file
// (a control panel, a printer) names nothing, and then the target is null.
function itemPath(r: Reader, start: number, end: number): string | null {
  const parts: string[] = [];
  let at = start;
  let count = 0;
  let root: string | null = null;
  while (at + 2 <= end && count++ < ITEMS_MAX) {
    const size = r.u16(at, 'list of items');
    if (size < 3 || at + size > end) break;
    const data = at + 2;
    const stop = at + size;
    const type = r.u8(data, 'list of items');
    if (type === 0x1f && stop - data >= 18) {
      const g = [...r.bytes.subarray(data + 2, data + 18)];
      const hex = (a: number[]): string => a.map((b) => b.toString(16).padStart(2, '0')).join('');
      const guid = `${hex(g.slice(0, 4).reverse())}-${hex(g.slice(4, 6).reverse())}-${hex(g.slice(6, 8).reverse())}-${hex(g.slice(8, 10))}-${hex(g.slice(10, 16))}`;
      root = GUIDS[guid] ?? null;
      if (root === null) return null;
    } else if ((type & 0x70) === 0x20) {
      const name = r.nul(data + 1, stop, false);
      if (name) parts.push(name.replace(/\\$/, ''));
    } else if ((type & 0x70) === 0x30 && stop - data > 12) {
      const name = longName(r, data + 12, stop) ?? r.nul(data + 12, stop, (type & 0x04) !== 0);
      if (name) parts.push(name);
    } else return null;
    at = stop;
  }
  if (parts.length === 0) return null;
  const first = parts[0]!;
  return parts.length === 1 && /^[A-Za-z]:$/.test(first) ? `${first}\\` : parts.join('\\');
}

function read(bytes: Uint8Array): ShortcutFacts {
  if (bytes.length < HEADER_SIZE) bad('it is shorter than the 76 bytes of a shortcut header');
  if (!isShellLink(bytes)) bad('its header is not a Shell Link header');
  const r = new Reader(bytes);
  const flags = r.u32(20, 'header');
  const attrs = r.u32(24, 'header');
  const created = fileTime(r.u32(28, 'header'), r.u32(32, 'header'));
  const accessed = fileTime(r.u32(36, 'header'), r.u32(40, 'header'));
  const modified = fileTime(r.u32(44, 'header'), r.u32(48, 'header'));
  const targetSize = r.u32(52, 'header');
  const iconIndex = r.view.getInt32(56, true);
  const showCommand = r.u32(60, 'header');
  const hotkey = hotkeyWords(r.u16(64, 'header'));
  let at = HEADER_SIZE;

  let fromItems: string | null = null;
  if (flags & 0x1) {
    const size = r.u16(at, 'list of items');
    if (at + 2 + size > bytes.length) bad('its list of items runs past the end of the file');
    fromItems = itemPath(r, at + 2, at + 2 + size);
    at += 2 + size;
  }

  let local: string | null = null;
  let network: string | null = null;
  if (flags & 0x2) {
    const start = at;
    const size = r.u32(start, 'link info');
    if (size < 0x1c || start + size > bytes.length) bad('its link info runs past the end of the file');
    const end = start + size;
    const headerSize = r.u32(start + 4, 'link info');
    const infoFlags = r.u32(start + 8, 'link info');
    const off = (rel: number): number => {
      const v = r.u32(start + rel, 'link info');
      return v > 0 && v < size ? start + v : 0;
    };
    const wide = headerSize >= 0x24;
    const localAt = infoFlags & 1 ? off(16) : 0;
    const localWide = wide && infoFlags & 1 ? off(28) : 0;
    const suffixAt = off(24);
    const suffixWide = wide ? off(32) : 0;
    const suffix = suffixWide ? r.nul(suffixWide, end, true) : suffixAt ? r.nul(suffixAt, end, false) : '';
    if (localAt || localWide) {
      const base = localWide ? r.nul(localWide, end, true) : r.nul(localAt, end, false);
      local = base + suffix;
    } else if (infoFlags & 2) {
      const cnr = off(20);
      if (cnr) {
        const cnrSize = r.u32(cnr, 'link info');
        const cnrEnd = Math.min(end, cnr + Math.max(cnrSize, 0));
        const netName = r.u32(cnr + 8, 'link info');
        const netWide = netName > 0x14 ? r.u32(cnr + 20, 'link info') : 0;
        const name = netWide > 0 && netWide < cnrSize ? r.nul(cnr + netWide, cnrEnd, true) : netName > 0 && netName < cnrSize ? r.nul(cnr + netName, cnrEnd, false) : '';
        if (name) network = suffix ? `${name.replace(/\\$/, '')}\\${suffix}` : name;
      }
    }
    at = end;
  }

  const unicode = (flags & 0x80) !== 0;
  const string = (bit: number, what: string): string | null => {
    if (!(flags & bit)) return null;
    const count = r.u16(at, what);
    const n = count * (unicode ? 2 : 1);
    if (at + 2 + n > bytes.length) bad(`its ${what} runs past the end of the file`);
    const s = r.text(at + 2, n, unicode);
    at += 2 + n;
    return s;
  };
  const description = string(0x4, 'description');
  const relative = string(0x8, 'relative path');
  const workingDir = string(0x10, 'working folder');
  const args = string(0x20, 'arguments');
  const iconPath = string(0x40, 'icon location');

  let withVariables: string | null = null;
  for (let n = 0; n < BLOCKS_MAX && at + 4 <= bytes.length; n++) {
    const size = r.u32(at, 'extra data');
    if (size < 4) break;
    if (at + size > bytes.length) break;
    if (size >= 8 && r.u32(at + 4, 'extra data') === 0xa0000001 && size >= 0x314) {
      const wideName = r.nul(at + 268, at + 268 + 520, true);
      withVariables = wideName || r.nul(at + 8, at + 8 + 260, false) || null;
    }
    at += size;
  }

  const target = local ?? network ?? fromItems;
  return {
    target: target || null,
    targetFrom: local ? 'local' : network ? 'network' : fromItems ? 'items' : null,
    relative: relative || null,
    withVariables,
    arguments: args || null,
    workingDir: workingDir || null,
    description: description || null,
    icon: iconPath || iconIndex !== 0 ? { path: iconPath || null, index: iconIndex } : null,
    showCommand,
    hotkey,
    targetSize,
    targetIsFolder: (attrs & 0x10) !== 0,
    created,
    accessed,
    modified,
    cut: r.cut,
  };
}

/** What `bytes` say a shortcut is, or why they are not one. Never throws. */
export function readShortcut(bytes: Uint8Array): ShortcutRead {
  try {
    return { ok: true, facts: read(bytes) };
  } catch (e) {
    return { ok: false, reason: e instanceof Damaged ? `The shortcut is damaged: ${e.message}.` : 'The shortcut is damaged: its bytes do not follow the Shell Link format.' };
  }
}

export interface ShortcutRow {
  readonly label: string;
  readonly value: string;
  /** A quieter line under the value. */
  readonly note?: string;
  /** Times are milliseconds; the card words them. */
  readonly time?: number;
  readonly size?: number;
}

/** The rows the card shows, in order; a fact the file does not hold has no row. */
export function shortcutRows(f: ShortcutFacts): ShortcutRow[] {
  const rows: ShortcutRow[] = [];
  const from = f.targetFrom === 'local' ? "from the link's own path" : f.targetFrom === 'network' ? 'on a network share' : f.targetFrom === 'items' ? 'from the folders it names (best effort)' : undefined;
  if (f.target) rows.push({ label: 'points at', value: f.target, note: from });
  else if (f.withVariables) rows.push({ label: 'points at', value: f.withVariables, note: 'a path with variables, not expanded here' });
  else if (f.relative) rows.push({ label: 'points at', value: f.relative, note: 'relative to the shortcut' });
  else rows.push({ label: 'points at', value: 'nothing a path can name', note: 'a special folder, a device or an app' });
  if (f.withVariables && f.target && f.withVariables !== f.target) rows.push({ label: 'variables', value: f.withVariables });
  if (f.arguments) rows.push({ label: 'arguments', value: f.arguments });
  if (f.workingDir) rows.push({ label: 'start in', value: f.workingDir });
  if (f.description) rows.push({ label: 'description', value: f.description });
  if (f.icon) rows.push({ label: 'icon', value: f.icon.path ? `${f.icon.path}${f.icon.index !== 0 ? `, number ${f.icon.index}` : ''}` : `number ${f.icon.index}` });
  rows.push({ label: 'opens as', value: showWords(f.showCommand) });
  if (f.hotkey) rows.push({ label: 'hotkey', value: f.hotkey });
  if (f.targetIsFolder) rows.push({ label: 'target size', value: 'a folder' });
  else if (f.targetSize > 0) rows.push({ label: 'target size', value: '', size: f.targetSize });
  if (f.created !== null) rows.push({ label: 'target made', value: '', time: f.created });
  if (f.modified !== null) rows.push({ label: 'target edited', value: '', time: f.modified });
  if (f.accessed !== null) rows.push({ label: 'target opened', value: '', time: f.accessed });
  if (f.cut) rows.push({ label: 'cut', value: `a string longer than ${SHORTCUT_STRING_MAX / 1024} KB was cut short` });
  return rows;
}
