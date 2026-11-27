// The page as Export writes it: the reading on the pane, or a part of it, sanitised as a copy
// is, with folded sections left folded or opened and the reader's notes set in the margin; the colours worn or plain; and
// PDF as the system's print of the pane with those same choices. Nothing here writes a file.
import { htmlFromRange } from '../selection/copy-html.ts';
import { textFromRange } from '../selection/copy-text.ts';
import { PAPER, type ExportColourSet } from './build.ts';

export type Folds = 'shown' | 'open';

export interface PartOptions {
  /** The bytes of the part; null for the whole page. */
  readonly range: { readonly start: number; readonly end: number } | null;
  readonly folds: Folds;
  /** The notes to set beside the blocks they are on; null for none. */
  readonly notes: readonly { readonly l0: number; readonly text: string; readonly address?: string }[] | null;
  /** The 0-based line a byte of the buffer is on. */
  lineOf(byte: number): number;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const span = (el: Element): [number, number] => [Number(el.getAttribute('data-marxy-s')), Number(el.getAttribute('data-marxy-e'))];
/** Folded out, or outside the one part shown alone: not on the page as it is shown. */
const hiddenOnPage = (el: Element): boolean => el.closest('.marxy-fold-out, .marxy-focus-out') !== null;

/** The article's blocks that are no other block's part, in order. */
export function topBlocks(article: HTMLElement): HTMLElement[] {
  return [...article.querySelectorAll<HTMLElement>('[data-marxy-s][data-marxy-e]')].filter((el) => {
    const up = el.parentElement?.closest('[data-marxy-s]');
    return !up || !article.contains(up);
  });
}

/** The innermost blocks of `el` that lie inside `[start, end)`, first and last, for a part inside a larger block. */
function innerRun(el: HTMLElement, start: number, end: number): [Element, Element] | null {
  const inside = [...el.querySelectorAll('[data-marxy-s][data-marxy-e]')].filter((c) => {
    const [s, e] = span(c);
    return s >= start && e <= end;
  });
  const outer = inside.filter((c) => !inside.some((d) => d !== c && d.contains(c)));
  return outer.length ? [outer[0]!, outer.at(-1)!] : null;
}

/** The page's markup for the whole or a part, sanitised; folded sections as shown or open; notes as asides after their block. */
export function partHtml(article: HTMLElement, o: PartOptions): string {
  const out: string[] = [];
  let folded = 0;
  const say = (): void => {
    if (folded) out.push(`<p><em>Folded: ${plural(folded, 'part', 'parts')} not shown.</em></p>`);
    folded = 0;
  };
  // A note by address is on the line its address opens with (`:12#col`), else on no line: those go at the page's end.
  const notes = (o.notes ?? []).map((n) => ({ text: n.text, address: n.address, l0: n.address === undefined ? n.l0 : Number(/^:(\d+)/.exec(n.address)?.[1] ?? 0) - 1 }));
  for (const el of topBlocks(article)) {
    const [s, e] = span(el);
    if (o.range && (e <= o.range.start || s >= o.range.end)) continue;
    if (o.folds === 'shown' && hiddenOnPage(el)) {
      folded++;
      continue;
    }
    say();
    const r = document.createRange();
    if (o.range && (s < o.range.start || e > o.range.end)) {
      const run = innerRun(el, o.range.start, o.range.end);
      if (!run) continue;
      r.setStartBefore(run[0]);
      r.setEndAfter(run[1]);
    } else r.selectNode(el);
    out.push(htmlFromRange(r));
    const first = o.lineOf(Math.max(s, o.range?.start ?? s));
    const last = o.lineOf(Math.max(first, Math.min(e, o.range?.end ?? e) - 1));
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i]!;
      if (n.l0 < first || n.l0 > last) continue;
      out.push(`<aside>${esc(n.text)}</aside>`);
      notes.splice(i--, 1);
    }
  }
  say();
  if (!o.range) for (const n of notes) if (n.l0 < 0) out.push(`<aside><code>${esc(n.address ?? '')}</code> ${esc(n.text)}</aside>`);
  return out.join('\n');
}

/** The page's words, as a copy of them reads: the whole page or the blocks of a part, folds open. */
export function partText(article: HTMLElement, range: { readonly start: number; readonly end: number } | null): string {
  const tops = topBlocks(article).filter((el) => {
    const [s, e] = span(el);
    return !range || (e > range.start && s < range.end);
  });
  if (tops.length === 0) return '';
  const r = document.createRange();
  if (range && tops.length === 1) {
    const run = innerRun(tops[0]!, range.start, range.end);
    if (run) {
      r.setStartBefore(run[0]);
      r.setEndAfter(run[1]);
    } else r.selectNode(tops[0]!);
  } else {
    r.setStartBefore(tops[0]!);
    r.setEndAfter(tops.at(-1)!);
  }
  const text = textFromRange(r);
  return text.endsWith('\n') ? text : `${text}\n`;
}

/** The colours the page wears now, from the theme's tokens. */
export function lookColours(article: HTMLElement): ExportColourSet {
  const root = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => root.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--marxy-color-bg', PAPER.bg),
    text: v('--marxy-color-text', PAPER.text),
    strong: v('--marxy-color-text-strong', PAPER.strong),
    secondary: v('--marxy-color-text-secondary', PAPER.secondary),
    rule: v('--marxy-color-rule', PAPER.rule),
    codeBg: v('--marxy-color-code-bg', PAPER.codeBg),
    face: getComputedStyle(article).fontFamily || PAPER.face,
  };
}

export interface PrintChoices {
  readonly colours: 'paper' | 'look';
  readonly paper: 'A4' | 'Letter';
  readonly folds: Folds;
  readonly notes: boolean;
  readonly range: { readonly start: number; readonly end: number } | null;
}

/** The pane in front through the system's print, the frame left out, with the choices of Export's Set as. */
export function printPane(pane: { readonly host: HTMLElement; readonly article: HTMLElement }, c: PrintChoices): void {
  const root = document.documentElement;
  root.dataset.marxyPrint = c.colours;
  pane.host.setAttribute('data-marxy-print-pane', '');
  const rules = [`@page { size: ${c.paper === 'Letter' ? 'letter' : 'A4'}; margin: 18mm; }`];
  const scope = ':root[data-marxy-print] .marxy-pane[data-marxy-print-pane]';
  if (c.folds === 'open') rules.push(`@media print { ${scope} :is(.marxy-fold-out, .marxy-focus-out) { display: revert !important; } }`);
  if (!c.notes) rules.push(`@media print { ${scope} .marxy-mnote { display: none !important; } }`);
  if (c.range) {
    const out = topBlocks(pane.article).filter((el) => {
      const [s, e] = span(el);
      return e <= c.range!.start || s >= c.range!.end;
    });
    if (out.length) rules.push(`@media print { ${out.map((el) => `${scope} [data-marxy-s="${span(el)[0]}"][data-marxy-e="${span(el)[1]}"]`).join(', ')} { display: none !important; } }`);
  }
  // A sheet made in script, not a <style>: the window's CSP admits no inline style element.
  let sheet: CSSStyleSheet | null = null;
  try {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(rules.join('\n'));
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    sheet = null;
  }
  const done = (): void => {
    delete root.dataset.marxyPrint;
    pane.host.removeAttribute('data-marxy-print-pane');
    if (sheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  // An engine that prints synchronously has already fired afterprint, or never will.
  setTimeout(done, 1000);
}
