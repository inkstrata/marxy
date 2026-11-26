// Find over a page a viewer draws as text of its own (the office page, the book page): matches marked with the find
// highlights, one of them current and brought to a third of the way down the page's scroller.
import { FIND_CURRENT_HIGHLIGHT, FIND_HIGHLIGHT } from '../find/view.ts';
import { findAll as findSpans } from '../find/text-index.ts';
import { placeRange, walkText } from '../find/walk.ts';
import type { ViewerFind } from './types.ts';

type Registry = { set(name: string, h: unknown): void; delete(name: string): boolean };

/** Find over `page()`'s body, scrolled by its root; null while no page is drawn. */
export function pageFind(page: () => { readonly root: HTMLElement; readonly body: HTMLElement } | null): ViewerFind {
  let found: Range[] = [];
  let current = -1;
  const registry = (): Registry | null => (globalThis as { CSS?: { highlights?: Registry } }).CSS?.highlights ?? null;
  function paint(): void {
    const reg = registry();
    const Ctor = (globalThis as { Highlight?: new (...r: Range[]) => { priority: number } }).Highlight;
    if (!reg || !Ctor) return;
    if (found.length === 0) {
      reg.delete(FIND_HIGHLIGHT);
      reg.delete(FIND_CURRENT_HIGHLIGHT);
      return;
    }
    reg.set(FIND_HIGHLIGHT, new Ctor(...found.filter((_, i) => i !== current)));
    const cur = new Ctor(...(current >= 0 && found[current] ? [found[current]!] : []));
    cur.priority = 1;
    reg.set(FIND_CURRENT_HIGHLIGHT, cur);
  }
  return {
    async run(re, progress) {
      found = [];
      current = -1;
      const p = page();
      if (re && p) {
        const walked = walkText(p.body);
        for (const span of findSpans(walked.index, re)) {
          const r = document.createRange();
          if (placeRange(r, walked, span)) found.push(r);
        }
      }
      paint();
      progress(found.length);
      return found.length;
    },
    first() {
      const p = page();
      if (!p) return -1;
      const top = p.root.getBoundingClientRect().top;
      const at = found.findIndex((r) => r.getBoundingClientRect().bottom > top);
      return at < 0 ? (found.length > 0 ? 0 : -1) : at;
    },
    show(i) {
      const p = page();
      if (!p || !found[i]) return;
      current = i;
      paint();
      const box = found[i]!.getBoundingClientRect();
      const view = p.root.getBoundingClientRect();
      p.root.scrollTop += box.top - (view.top + p.root.clientHeight / 3);
    },
    clear() {
      found = [];
      current = -1;
      paint();
    },
  };
}
