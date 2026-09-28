// Trusted-DOM markers for invisible characters after sanitise and after highlight (MARXY-236).

import {
  invisibleHexLabel,
  invisibleSegments,
  type InvisibleContext,
} from '@marxy/core/src/render/index.ts';

const GLYPH = 'marxy-invisible-glyph';
const MARKER = 'marxy-invisible';

function contextForText(node: Text): InvisibleContext {
  const el = node.parentElement?.closest('[data-marxy-s]');
  const start = el === null || el === undefined ? 1 : Number(el.getAttribute('data-marxy-s'));
  const inCode = node.parentElement?.closest('pre, code, kbd, samp') !== null;
  return { inCode, sourceStart: Number.isFinite(start) ? start : 1 };
}

function markerNode(doc: Document, cp: number, bidi: boolean): HTMLElement {
  const wrap = doc.createElement('code');
  wrap.className = MARKER;
  const glyph = doc.createElement('code');
  glyph.className = GLYPH;
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = invisibleHexLabel(cp);
  const byte = doc.createElement('code');
  byte.className = bidi ? 'marxy-invisible-byte marxy-invisible-bidi' : 'marxy-invisible-byte';
  byte.setAttribute('aria-hidden', 'true');
  byte.textContent = String.fromCodePoint(cp);
  wrap.append(glyph, byte);
  return wrap;
}

function tagRunNode(doc: Document, count: number, payload: string, decoded: string): HTMLElement {
  const wrap = doc.createElement('code');
  wrap.className = 'marxy-invisible marxy-invisible-tag';
  wrap.title = decoded.length > 0 ? decoded : 'tag characters';
  const glyph = doc.createElement('code');
  glyph.className = GLYPH;
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = `tag ×${count}`;
  const byte = doc.createElement('code');
  byte.className = 'marxy-invisible-byte';
  byte.setAttribute('aria-hidden', 'true');
  byte.textContent = payload;
  wrap.append(glyph, byte);
  return wrap;
}

function replaceTextWithMarkers(text: Text): void {
  const ctx = contextForText(text);
  const value = text.data;
  const segs = invisibleSegments(value, ctx);
  if (segs.length === 1 && segs[0]!.kind === 'text') return;
  const doc = text.ownerDocument;
  const frag = doc.createDocumentFragment();
  for (const seg of segs) {
    if (seg.kind === 'text') {
      if (seg.value !== '') frag.append(doc.createTextNode(seg.value));
      continue;
    }
    if (seg.kind === 'tag-run') {
      frag.append(tagRunNode(doc, seg.count, seg.payload, seg.decoded));
      continue;
    }
    frag.append(markerNode(doc, seg.cp, seg.bidi));
  }
  text.replaceWith(frag);
}

/** Source bytes of a code element, omitting display-only glyph labels. */
export function sourceTextFromCode(code: HTMLElement): string {
  if (code.querySelector(`.${GLYPH}`) === null) return code.textContent ?? '';
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node instanceof Element && node.classList.contains(GLYPH)) return;
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '');
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(code);
  return parts.join('');
}

/** Wrap flagged characters in `root` with isolate markers. Safe to run more than once. */
export function applyInvisibleMarkers(root: ParentNode): void {
  const doc = root instanceof Document ? root : root.ownerDocument;
  if (doc === null) return;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current: Node | null = walker.nextNode();
  while (current !== null) {
    const parent = current.parentElement;
    if (parent !== null && parent.closest(`.${MARKER}, .marxy-link-dest, .marxy-link-host-label`) === null) {
      nodes.push(current as Text);
    }
    current = walker.nextNode();
  }
  for (const text of nodes) replaceTextWithMarkers(text);
}
