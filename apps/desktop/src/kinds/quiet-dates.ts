// The quiet date (K-22): the date of a changelog's version heading, and a notes file's first line when it is only a date, set in
// the secondary colour. A date is a few characters inside a heading's text, which CSS cannot select, so the page paints them as a
// highlight (`::highlight(marxy-quiet-date)` in the theme, the mechanism Find uses): a Range over the characters that are already
// there. Nothing is wrapped, nothing is inserted and no text moves, so a copy or a selection reads the file's own words, and
// where the engine has no CSS.highlights the date simply keeps the heading's colour. Pure helpers first; the page half after.
import type { AppHandle } from '../app.ts';

/** The highlight's name; the theme styles it. */
export const QUIET_DATE = 'marxy-quiet-date';

/** A version heading opens with a version number (`[1.4.0]`, `v2.0`, `Version 3.1`), as core's `versionLabel` reads one. */
const VERSION = /^(?:\[\s*)?(?:version\s+)?v?\d+\.\d+/i;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
const BARE_DATE = /^(\s*)(\d{4}-\d{2}-\d{2})\s*$/;

/** The characters of a version heading's text that are its date (the first ISO date after the version), or null. */
export function versionDateSpan(text: string): readonly [number, number] | null {
  if (!VERSION.test(text.trim())) return null;
  const match = ISO_DATE.exec(text);
  return match === null ? null : [match.index, match.index + match[0].length];
}

/** The characters of a line that is only a date, or null. */
export function bareDateSpan(text: string): readonly [number, number] | null {
  const match = BARE_DATE.exec(text);
  return match === null ? null : [match[1]!.length, match[1]!.length + match[2]!.length];
}

/** A Range over characters `from` to `to` of `element`'s text, across its text nodes. */
function rangeOver(element: Element, from: number, to: number): Range | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let seen = 0;
  let started = false;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = node.nodeValue?.length ?? 0;
    if (!started && from < seen + length) {
      range.setStart(node, from - seen);
      started = true;
    }
    if (started && to <= seen + length) {
      range.setEnd(node, to - seen);
      return range;
    }
    seen += length;
  }
  return null;
}

/** The ranges to paint in one article of `kind`: the version dates of a changelog, the date line of a notes file. */
export function quietRanges(article: Element, kind: string): Range[] {
  const out: Range[] = [];
  if (kind === 'changelog') {
    for (const heading of article.querySelectorAll(':scope > h2, :scope > h3')) {
      const span = versionDateSpan(heading.textContent ?? '');
      const range = span === null ? null : rangeOver(heading, span[0], span[1]);
      if (range !== null) out.push(range);
    }
  } else if (kind === 'notes') {
    // Only a first line, above the first heading: a date later in the file is prose.
    for (const child of article.children) {
      if (/^H[1-6]$/.test(child.tagName)) break;
      if (child.tagName !== 'P') continue;
      const span = bareDateSpan(child.textContent ?? '');
      const range = span === null ? null : rangeOver(child, span[0], span[1]);
      if (range !== null) out.push(range);
      break;
    }
  }
  return out;
}

type Registry = { set(name: string, highlight: unknown): void; delete(name: string): void };

/** Paints the quiet dates of every pane, again whenever a page changes. Returns what takes them away. */
export function installQuietDates(handle: AppHandle): () => void {
  const css = (globalThis as { CSS?: { highlights?: Registry } }).CSS;
  const ctor = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  const main = handle.panes().panes[0]?.host.parentElement;
  if (!css?.highlights || typeof ctor !== 'function' || !main) return () => {};
  const registry = css.highlights;
  let frame = 0;
  const paint = (): void => {
    frame = 0;
    const ranges: Range[] = [];
    for (const section of main.querySelectorAll('[data-marxy-kind="changelog"], [data-marxy-kind="notes"]')) {
      const article = section.querySelector('.marxy-article');
      if (article) ranges.push(...quietRanges(article, section.getAttribute('data-marxy-kind') ?? ''));
    }
    if (ranges.length === 0) registry.delete(QUIET_DATE);
    else registry.set(QUIET_DATE, new ctor(...ranges));
  };
  const schedule = (): void => {
    if (frame === 0) frame = requestAnimationFrame(paint);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(main, { attributes: true, attributeFilter: ['data-marxy-kind'], childList: true, subtree: true });
  schedule();
  return () => {
    observer.disconnect();
    if (frame !== 0) cancelAnimationFrame(frame);
    registry.delete(QUIET_DATE);
  };
}
