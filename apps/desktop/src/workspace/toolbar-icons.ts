// The toolbar's glyphs (U-03; ADR-0065, Q17): inline SVG, drawn for this file on the kind icons' 16-unit grid
// (kind-icons/icons.ts): stroke 1.5, round caps and joins, `currentColor` only so a theme's text roles colour them.
// Licence: original artwork, covered by the project's MIT licence; no icon set is bundled or fetched. The mock's
// Lucide (ISC) names are a guide to what each glyph shows, not a source of paths.

export type ToolbarGlyph =
  | 'sidebar' | 'inspector' | 'back' | 'forward' | 'new' | 'read' | 'split' | 'source'
  | 'copy' | 'chevron' | 'export' | 'transform' | 'find';

/** Inner SVG markup per glyph: `path`, `rect` and `circle` only, no colour attribute. */
export const TOOLBAR_GLYPHS: Readonly<Record<ToolbarGlyph, string>> = {
  sidebar: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M6 3v10"/>',
  inspector: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M10 3v10"/>',
  back: '<path d="M10 3.5 5.5 8l4.5 4.5"/>',
  forward: '<path d="M6 3.5 10.5 8 6 12.5"/>',
  new: '<path d="M8 3v10M3 8h10"/>',
  read: '<path d="M8 4.2C6.6 3 4.4 2.7 2 3v8.6c2.4-.3 4.6 0 6 1.2 1.4-1.2 3.6-1.5 6-1.2V3c-2.4-.3-4.6 0-6 1.2zM8 4.2v8.6"/>',
  split: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M8 3v10"/>',
  source: '<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3l-2 10"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>',
  chevron: '<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>',
  export: '<path d="M8 10V2.5M5 5.2 8 2.5l3 2.7M3 9v3.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9"/>',
  transform: '<path d="m3 13 6-6M11 2.5v3M9.5 4h3M13 8.5v2M12 9.5h2"/>',
  find: '<circle cx="7" cy="7" r="4.5"/><path d="m10.4 10.4 3.1 3.1"/>',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The glyph as an element: `aria-hidden`, built node by node (never parsed), `currentColor` only. */
export function toolbarIconElement(doc: Document, glyph: ToolbarGlyph): HTMLSpanElement {
  const span = doc.createElement('span');
  span.className = 'marxy-toolbar-glyph';
  span.setAttribute('aria-hidden', 'true');
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const [, tag, attrs] of TOOLBAR_GLYPHS[glyph].matchAll(/<(path|rect|circle) ([^>]*?)\/>/g)) {
    const node = doc.createElementNS(SVG_NS, tag!);
    for (const [, name, value] of attrs!.matchAll(/([\w:-]+)="([^"]*)"/g)) node.setAttribute(name!, value!);
    svg.appendChild(node);
  }
  span.appendChild(svg);
  return span;
}
