// The kind icon set (K-18): one glyph per kind, drawn on a 16-unit grid for 14 to 16 px.
// Stroke 1.5, round caps and joins, no page outline, `currentColor` only so a theme's text roles
// colour it. Glyph geometry follows the author's prototype (mock-v2 shared/app.js, `GL`), except
// `html`, which the prototype has no kind for (see HTML_GUESS below).

import type { Kind } from '@marxy/core';

export const ICON_GRID = 16;
export const ICON_STROKE = 1.5;

/** Inner SVG markup per kind. `stroke-width` on a path overrides the group's 1.5 (a bar or a dot). */
export const KIND_GLYPHS: Readonly<Record<Kind, string>> = {
  // A paragraph with a short last line.
  article: '<path d="M2 4h12M2 8h12M2 12h7"/>',
  // A heavy heading bar over body lines.
  report: '<path d="M2 4h8" stroke-width="3"/><path d="M2 8.8h12M2 12.4h9"/>',
  // An open book.
  readme: '<path d="M8 4.2C6.6 3 4.4 2.7 2 3v8.6c2.4-.3 4.6 0 6 1.2 1.4-1.2 3.6-1.5 6-1.2V3c-2.4-.3-4.6 0-6 1.2zM8 4.2v8.6"/>',
  // A closed book with a cover (the prototype's glyph for book).
  book: '<path d="M4.5 2.5H12a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H4.5A1.5 1.5 0 0 1 3 12.5V4a1.5 1.5 0 0 1 1.5-1.5zM3 12.5A1.5 1.5 0 0 1 4.5 11H13"/>',
  // A bookmark (the prototype's glyph for docs).
  docs: '<path d="M4.5 2.5h7v11L8 10.6l-3.5 2.9z"/>',
  // </>
  code: '<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3l-2 10"/>',
  // Two speech marks.
  transcript:
    '<path d="M3.5 1.8h4A1.5 1.5 0 0 1 9 3.3v1.5a1.5 1.5 0 0 1-1.5 1.5H5.5L3.5 8V6.3A1.5 1.5 0 0 1 2 4.8V3.3a1.5 1.5 0 0 1 1.5-1.5zM8.5 8.8h4a1.5 1.5 0 0 1 1.5 1.5v1.4a1.5 1.5 0 0 1-1.5 1.5H12v1.6l-1.8-1.6H8.5A1.5 1.5 0 0 1 7 11.7v-1.4a1.5 1.5 0 0 1 1.5-1.5z"/>',
  // { }
  data: '<path d="M6 2.5c-1.6 0-2 .9-2 2v1.6c0 1-.5 1.9-1.8 1.9 1.3 0 1.8.9 1.8 1.9v1.6c0 1.1.4 2 2 2M10 2.5c1.6 0 2 .9 2 2v1.6c0 1 .5 1.9 1.8 1.9-1.3 0-1.8.9-1.8 1.9v1.6c0 1.1-.4 2-2 2"/>',
  // A pencil (the prototype's glyph for notes).
  notes: '<path d="m10.8 2.8 2.4 2.4-7.7 7.7-3 .6.6-3zM9.2 4.4l2.4 2.4"/>',
  // Dotted list lines (the prototype's glyph for a changelog).
  changelog: '<path d="M3 4h.01M3 8h.01M3 12h.01" stroke-width="2.4"/><path d="M6.5 4H13M6.5 8H14M6.5 12h4.5"/>',
  // Ticked lines.
  log: '<path d="M2 4h1.6M2 8h1.6M2 12h1.6M6 4h8M6 8h8M6 12h5.5"/>',
  // >_
  terminal: '<path d="m3 4.5 4 3.5-4 3.5M8.5 12h5"/>',
  // +/-
  diff: '<path d="M8 2.5v6M5 5.5h6M5 12.5h6"/>',
  // HTML_GUESS: not in the prototype. A window with a title rule: a rendered page, not a page outline.
  html: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6.5h12"/>',
};

/** Where each glyph came from, so the taste review sees the guesses. */
export const GLYPH_SOURCE: Readonly<Record<Kind, 'prototype' | 'guess'>> = {
  article: 'prototype', report: 'prototype', book: 'prototype', readme: 'prototype', docs: 'prototype',
  code: 'prototype', transcript: 'prototype', data: 'prototype', notes: 'prototype',
  changelog: 'prototype', log: 'prototype', terminal: 'prototype', diff: 'prototype', html: 'guess',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A common file extension to the language id `data-marxy-lang` carries (ADR-0059 item 8). */
const LANG_BY_EXT: Readonly<Record<string, string>> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  rs: 'rust', py: 'python', rb: 'ruby', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', lua: 'lua',
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', css: 'css', scss: 'scss',
  sql: 'sql', zig: 'zig', ex: 'elixir', exs: 'elixir', hs: 'haskell', dart: 'dart', r: 'r',
};

/** The language id of a code file's path, or undefined when unknown. */
export function langOfPath(path: string): string | undefined {
  const dot = path.lastIndexOf('.');
  if (dot < 0 || path.lastIndexOf('/') > dot) return undefined;
  return LANG_BY_EXT[path.slice(dot + 1).toLowerCase()];
}

/** The glyph's SVG markup for a kind. Pure. */
export function kindIconSvg(kind: Kind): string {
  return `<svg class="marxy-kind-icon" data-marxy-kind="${kind}" xmlns="${SVG_NS}" viewBox="0 0 ${ICON_GRID} ${ICON_GRID}" width="16" height="16" fill="none" stroke="currentColor" stroke-width="${ICON_STROKE}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${KIND_GLYPHS[kind]}</svg>`;
}

/** The `data-marxy-lang` value an icon carries: only `code`, and only when its language is known. */
export function iconLang(kind: Kind, lang: string | undefined): string | undefined {
  return kind === 'code' ? lang : undefined;
}

/** The icon as an element: `aria-hidden`, and for `code` with a known language, `data-marxy-lang`. */
export function kindIconElement(doc: Document, kind: Kind, lang?: string): HTMLSpanElement {
  const span = doc.createElement('span') as HTMLSpanElement;
  span.className = 'marxy-kind-glyph';
  span.setAttribute('aria-hidden', 'true');
  const language = iconLang(kind, lang);
  if (language !== undefined) span.dataset.marxyLang = language;
  // Built node by node (createElementNS), never parsed: glyphs are self-closing <path> and <rect> only.
  const svg = doc.createElementNS(SVG_NS, 'svg');
  const root = /^<svg ([^>]*)>/.exec(kindIconSvg(kind))?.[1] ?? '';
  for (const [, name, value] of root.matchAll(/([\w:-]+)="([^"]*)"/g)) svg.setAttribute(name!, value!);
  for (const [, tag, attrs] of KIND_GLYPHS[kind].matchAll(/<(path|rect) ([^>]*?)\/>/g)) {
    const node = doc.createElementNS(SVG_NS, tag!);
    for (const [, name, value] of attrs!.matchAll(/([\w:-]+)="([^"]*)"/g)) node.setAttribute(name!, value!);
    svg.appendChild(node);
  }
  span.appendChild(svg);
  return span;
}
