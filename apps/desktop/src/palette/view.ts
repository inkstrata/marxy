// Summoned palette DOM. Never a tab bar; chrome is hidden until asked (ADR-0011).

import type { IndexHit } from '@marxy/core';

/** Minimal element the palette mounts into. Compatible with a real Element or the test document. */
export interface PaletteNode {
  readonly tagName: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  appendChild(child: PaletteNode): PaletteNode;
  removeChild(child: PaletteNode): PaletteNode;
  querySelector(selectors: string): PaletteNode | null;
  querySelectorAll(selectors: string): readonly PaletteNode[];
  readonly childNodes: readonly PaletteNode[];
}

export interface PaletteDocument {
  createElement(tagName: string): PaletteNode;
}

export interface PaletteViewState {
  readonly open: boolean;
  readonly query: string;
  readonly hits: readonly IndexHit[];
  readonly selected: number;
}

const TAB_BAR_SELECTORS = [
  '[role="tablist"]',
  '[role="tab"]',
  '[data-tab-bar]',
  '.tab-bar',
  '#tab-bar',
];

/** True when a tree contains no tab-bar chrome. The acceptance criterion is this check. */
export function hasTabBar(root: PaletteNode): boolean {
  for (const selector of TAB_BAR_SELECTORS) {
    if (root.querySelector(selector) !== null) return true;
  }
  return false;
}

/** Build a document the palette can mount into without a browser. */
export function createPaletteDocument(): PaletteDocument {
  return {
    createElement(tagName: string) {
      return new MiniNode(tagName);
    },
  };
}

export interface PaletteView {
  readonly root: PaletteNode;
  update(state: PaletteViewState): void;
  destroy(): void;
}

/** Mount a summoned dialog. Dismissed = hidden; nothing here is a tab strip. */
export function mountPalette(
  host: PaletteNode,
  doc: PaletteDocument,
  state: PaletteViewState,
): PaletteView {
  const root = doc.createElement('div');
  root.setAttribute('data-marxy-palette', '');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Palette');
  host.appendChild(root);

  const paint = (next: PaletteViewState) => {
    while (root.childNodes.length > 0) root.removeChild(root.childNodes[0]!);
    if (!next.open) {
      root.setAttribute('hidden', '');
      return;
    }
    root.removeAttribute('hidden');
    const input = doc.createElement('input');
    input.setAttribute('data-marxy-palette-query', '');
    input.setAttribute('aria-label', 'Search titles, headings and paths');
    input.setAttribute('value', next.query);
    root.appendChild(input);
    const list = doc.createElement('ol');
    list.setAttribute('data-marxy-palette-results', '');
    list.setAttribute('role', 'listbox');
    root.appendChild(list);
    for (let i = 0; i < next.hits.length; i++) {
      const hit = next.hits[i]!;
      const item = doc.createElement('li');
      item.setAttribute('role', 'option');
      item.setAttribute('data-path', hit.entry.path);
      if (hit.heading !== undefined) {
        const heading = hit.entry.headings[hit.heading];
        if (heading !== undefined) {
          item.setAttribute('data-heading-offset', String(heading.byteOffset));
        }
      }
      if (i === next.selected) item.setAttribute('aria-selected', 'true');
      const label = doc.createElement('span');
      label.setAttribute('data-title', '');
      setText(label, hit.entry.title);
      item.appendChild(label);
      if (hit.heading !== undefined) {
        const heading = hit.entry.headings[hit.heading];
        if (heading !== undefined) {
          const mark = doc.createElement('span');
          mark.setAttribute('data-heading', '');
          setText(mark, heading.text);
          item.appendChild(mark);
        }
      }
      list.appendChild(item);
    }
  };

  paint(state);
  return {
    root,
    update: paint,
    destroy() {
      host.removeChild(root);
    },
  };
}

function setText(node: PaletteNode, text: string): void {
  node.setAttribute('data-text', text);
}

class MiniNode implements PaletteNode {
  readonly tagName: string;
  readonly childNodes: PaletteNode[] = [];
  private readonly attrs = new Map<string, string>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name.toLowerCase()) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name.toLowerCase(), value);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name.toLowerCase());
  }

  appendChild(child: PaletteNode): PaletteNode {
    this.childNodes.push(child);
    return child;
  }

  removeChild(child: PaletteNode): PaletteNode {
    const at = this.childNodes.indexOf(child);
    if (at === -1) throw new Error('not a child');
    this.childNodes.splice(at, 1);
    return child;
  }

  querySelector(selectors: string): PaletteNode | null {
    return this.querySelectorAll(selectors)[0] ?? null;
  }

  querySelectorAll(selectors: string): readonly PaletteNode[] {
    const out: PaletteNode[] = [];
    const parts = splitSelectors(selectors);
    walk(this, (node) => {
      for (const part of parts) {
        if (matches(node, part)) {
          out.push(node);
          break;
        }
      }
    });
    return out;
  }
}

function walk(node: PaletteNode, visit: (node: PaletteNode) => void): void {
  for (const child of node.childNodes) {
    visit(child);
    walk(child, visit);
  }
}

function splitSelectors(selectors: string): string[] {
  return selectors.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
}

function matches(node: PaletteNode, selector: string): boolean {
  let rest = selector;
  const tag = /^([a-zA-Z][\w-]*)/.exec(rest);
  if (tag) {
    if (node.tagName !== tag[1]!.toUpperCase()) return false;
    rest = rest.slice(tag[1]!.length);
  }
  const id = /^#([a-zA-Z][\w-]*)/.exec(rest);
  if (id) {
    if (node.getAttribute('id') !== id[1]) return false;
    rest = rest.slice(id[0].length);
  }
  while (rest.length > 0) {
    const cls = /^\.([a-zA-Z][\w-]*)/.exec(rest);
    if (cls) {
      const names = (node.getAttribute('class') ?? '').split(/\s+/);
      if (!names.includes(cls[1]!)) return false;
      rest = rest.slice(cls[0].length);
      continue;
    }
    const attr = /^\[([a-zA-Z_][\w-]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/.exec(rest);
    if (!attr) return false;
    const value = node.getAttribute(attr[1]!);
    const expected = attr[2] ?? attr[3] ?? attr[4];
    if (expected === undefined) {
      if (value === null) return false;
    } else if (value !== expected) {
      return false;
    }
    rest = rest.slice(attr[0].length);
  }
  return true;
}
