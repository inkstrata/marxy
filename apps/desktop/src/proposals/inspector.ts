// What a character is (proposal `inspector`): hold Alt over any character to see its code point, what kind of character it
// is, its UTF-8 bytes and where it sits in the file. In Source the place is exact (line, column, byte); in Read it is found
// by matching the text around the character against the bytes of the block it was rendered from, and said as a range when
// that block holds the same run more than once. Nothing is selected or changed.
import { byteToUtf16, lineOf, utf16ToByte, type Buffer } from '@marxy/core/src/buffer/buffer.ts';
import type { AppHandle } from '../app-types.ts';
import { proposalOn } from './state.ts';

const NAMES: Readonly<Record<number, string>> = {
  0x09: 'character tabulation', 0x20: 'space', 0xa0: 'no-break space', 0xad: 'soft hyphen', 0xb7: 'middle dot', 0xd7: 'multiplication sign',
  0x2009: 'thin space', 0x200a: 'hair space', 0x200b: 'zero width space', 0x200c: 'zero width non-joiner', 0x200d: 'zero width joiner',
  0x200e: 'left-to-right mark', 0x200f: 'right-to-left mark', 0x2010: 'hyphen', 0x2011: 'non-breaking hyphen', 0x2012: 'figure dash',
  0x2013: 'en dash', 0x2014: 'em dash', 0x2018: 'left single quotation mark', 0x2019: 'right single quotation mark',
  0x201c: 'left double quotation mark', 0x201d: 'right double quotation mark', 0x2022: 'bullet', 0x2026: 'horizontal ellipsis',
  0x202f: 'narrow no-break space', 0x2060: 'word joiner', 0x2192: 'rightwards arrow', 0x2212: 'minus sign', 0x2248: 'almost equal to',
  0xfeff: 'zero width no-break space (byte order mark)', 0xfffd: 'replacement character',
};

const KINDS: readonly [RegExp, string][] = [
  [/\p{Lu}/u, 'capital letter'], [/\p{Ll}/u, 'small letter'], [/\p{L}/u, 'letter'], [/\p{Nd}/u, 'digit'], [/\p{N}/u, 'number'],
  [/\p{Mn}|\p{Me}/u, 'combining mark'], [/\p{M}/u, 'mark'], [/\p{Pd}/u, 'dash'], [/\p{Pi}|\p{Pf}/u, 'quotation mark'], [/\p{P}/u, 'punctuation'],
  [/\p{Sm}/u, 'maths symbol'], [/\p{Sc}/u, 'currency symbol'], [/\p{S}/u, 'symbol'], [/\p{Zs}/u, 'space'], [/\p{Cc}/u, 'control character'],
  [/\p{Cf}/u, 'invisible format character'], [/\p{Co}/u, 'private-use character'],
];

/** `unicode` is the character's Unicode name where the app has the table (the Tauri shell); else its kind is said. */
function describe(ch: string, unicode: string | null): { readonly cp: string; readonly name: string; readonly bytes: string } {
  const code = ch.codePointAt(0)!;
  const cp = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
  const kind = KINDS.find(([re]) => re.test(ch))?.[1] ?? 'character';
  const latin = /^[A-Za-z]$/.test(ch) ? `Latin ${kind} ${ch.toUpperCase()}` : /^[0-9]$/.test(ch) ? `digit ${ch}` : null;
  const name = NAMES[code] ?? unicode ?? latin ?? kind;
  const bytes = [...new TextEncoder().encode(ch)].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  return { cp, name, bytes };
}

const count = (n: number): string => n.toLocaleString('en-GB');

/** The text position under a point, from whichever of the two APIs the engine has. */
function pointAt(x: number, y: number): { node: Text; offset: number } | null {
  const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  const pos = d.caretPositionFromPoint?.(x, y);
  const node = pos?.offsetNode ?? document.caretRangeFromPoint?.(x, y)?.startContainer;
  const offset = pos?.offset ?? document.caretRangeFromPoint?.(x, y)?.startOffset;
  return node instanceof Text && offset !== undefined ? { node, offset } : null;
}

/** The character whose box holds the point: the caret falls between two, so the one on each side is tried. */
function charAt(x: number, y: number): { node: Text; start: number; ch: string } | null {
  const at = pointAt(x, y);
  if (!at) return null;
  const text = at.node.data;
  for (const start of [at.offset, at.offset - 1]) {
    if (start < 0 || start >= text.length) continue;
    const code = text.codePointAt(start)!;
    const len = code > 0xffff ? 2 : 1;
    const r = document.createRange();
    r.setStart(at.node, start);
    r.setEnd(at.node, start + len);
    const box = r.getBoundingClientRect();
    if (x >= box.left - 0.5 && x <= box.right + 0.5 && y >= box.top - 1 && y <= box.bottom + 1) return { node: at.node, start, ch: text.slice(start, start + len) };
  }
  return null;
}

/** Where a character of the rendered page is in the bytes: exact when the run before it is found once in its block. */
function placeInRead(buffer: Buffer, node: Text, start: number, ch: string): string {
  const carrier = node.parentElement?.closest<HTMLElement>('[data-marxy-s]');
  const s = Number(carrier?.getAttribute('data-marxy-s'));
  const e = Number(carrier?.getAttribute('data-marxy-e'));
  if (!carrier || !Number.isFinite(s) || !Number.isFinite(e)) return 'not from the file’s bytes';
  const from = byteToUtf16(buffer, s);
  const source = buffer.text.slice(from, byteToUtf16(buffer, e));
  const before = document.createRange();
  before.setStart(carrier, 0);
  before.setEnd(node, start);
  const lead = before.toString();
  for (let k = Math.min(16, lead.length); k >= 0; k--) {
    const needle = lead.slice(lead.length - k) + ch;
    const first = source.indexOf(needle);
    if (first < 0) continue;
    if (source.indexOf(needle, first + 1) >= 0) break;
    const byte = utf16ToByte(buffer, from + first + k);
    return `byte ${count(byte)} · line ${count(lineOf(buffer, byte))}`;
  }
  return `in bytes ${count(s)}–${count(e)} · line ${count(lineOf(buffer, s))}`;
}

export function installInspector(handle: AppHandle): () => void {
  let tip: HTMLElement | null = null;
  let last: { x: number; y: number } | null = null;
  // The pointer passes the same characters again and again while Alt is held: each name is asked for once.
  const names = new Map<number, Promise<string | null>>();
  const unicodeName = (code: number): Promise<string | null> => {
    let named = names.get(code);
    if (!named) names.set(code, (named = handle.shell.charName?.(code).catch(() => null) ?? Promise.resolve(null)));
    return named;
  };

  // Each show and hide is a turn; a show that comes back from its awaits after a later turn is dropped, so a name the
  // shell answers late never puts a stale tip up, nor one after Alt is let go.
  let turn = 0;
  const hide = (): void => {
    turn++;
    tip?.remove();
    tip = null;
  };

  async function show(x: number, y: number): Promise<void> {
    const mine = ++turn;
    const target = document.elementFromPoint(x, y);
    const pane = target ? handle.panes().panes.find((p) => p.host.contains(target)) : undefined;
    const buffer = pane?.content.store()?.snapshot().buffer;
    if (!pane || !buffer) return hide();
    let ch: string;
    let place: string;
    if (pane.view.mode === 'source') {
      const { activeSourceEditor } = await import('../source/editor.ts');
      if (mine !== turn) return;
      const view = activeSourceEditor(pane.parts.source)?.view;
      const pos = view?.posAtCoords({ x, y });
      if (!view || pos === null || pos === undefined || pos >= view.state.doc.length) return hide();
      const text = view.state.doc.sliceString(pos, pos + 2);
      ch = String.fromCodePoint(text.codePointAt(0)!);
      const line = view.state.doc.lineAt(pos);
      const { cmPosToUtf16 } = await import('../source/cm-position.ts');
      place = `line ${count(line.number)}, column ${count(pos - line.from + 1)} · byte ${count(utf16ToByte(buffer, cmPosToUtf16(buffer, view.state, pos)))}`;
    } else {
      const found = charAt(x, y);
      if (!found || !pane.view.host.article.contains(found.node)) return hide();
      ch = found.ch;
      place = placeInRead(buffer, found.node, found.start, found.ch);
    }
    const unicode = await unicodeName(ch.codePointAt(0)!);
    if (mine !== turn) return;
    const info = describe(ch, unicode);
    tip ??= document.createElement('div');
    tip.className = 'marxy-charinfo';
    tip.setAttribute('role', 'status');
    const glyph = document.createElement('b');
    glyph.className = 'marxy-charinfo-glyph';
    glyph.textContent = /\s|\p{Cf}|\p{Cc}/u.test(ch) ? '·' : ch;
    const lines = [`${info.cp} · ${info.name}`, `UTF-8 ${info.bytes}`, place].map((t) => {
      const p = document.createElement('span');
      p.textContent = t;
      return p;
    });
    tip.replaceChildren(glyph, ...lines);
    tip.style.left = `${Math.min(x + 14, window.innerWidth - 280)}px`;
    tip.style.top = `${Math.min(y + 18, window.innerHeight - 90)}px`;
    if (!tip.isConnected) document.body.append(tip);
  }

  const onMove = (e: PointerEvent): void => {
    last = { x: e.clientX, y: e.clientY };
    if (e.altKey && proposalOn('inspector')) void show(e.clientX, e.clientY);
    else if (tip) hide();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Alt') return;
    if (e.type === 'keyup') return hide();
    if (!proposalOn('inspector') || !last) return;
    // Alt alone would move focus to the window menu on some systems: here it is the inspector's.
    e.preventDefault();
    void show(last.x, last.y);
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', hide);
  return () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKey);
    window.removeEventListener('blur', hide);
    hide();
  };
}
