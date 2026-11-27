// The frame's glyphs: 16-unit strokes, drawn in currentColor.
const PATHS = {
  library: '<path d="M2 4.5c0-.8.7-1.5 1.5-1.5h3l1.5 1.5h4.5c.8 0 1.5.7 1.5 1.5v5.5c0 .8-.7 1.5-1.5 1.5h-9c-.8 0-1.5-.7-1.5-1.5z"/>',
  find: '<circle cx="7" cy="7" r="4.25"/><path d="m10.25 10.25 3.25 3.25"/>',
  clip: '<circle cx="4" cy="4.5" r="2"/><circle cx="4" cy="11.5" r="2"/><path d="M5.6 5.7 13.5 12.5M5.6 10.3 13.5 3.5"/>',
  transform: '<path d="M2.5 5.5h10l-2.5-2.5M13.5 10.5h-10l2.5 2.5"/>',
  look: '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11a5.5 5.5 0 0 0 0-11z" fill="currentColor"/>',
  versions: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>',
  settings: '<path d="M3 4.5h6M12 4.5h1M3 11.5h1M7 11.5h6"/><circle cx="10.5" cy="4.5" r="1.5"/><circle cx="5.5" cy="11.5" r="1.5"/>',
  // The right panel, mirroring `fold`: the head's door and the panel's own hide button, at the same spot.
  panel: '<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2"/><path d="M10.5 2.75v10.5"/>',
  split: '<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2"/><path d="M8 2.75v10.5"/>',
  back: '<path d="M10 3.5 5.5 8 10 12.5"/>',
  forward: '<path d="M6 3.5 10.5 8 6 12.5"/>',
  chevron: '<path class="marxy-chev" d="M6 4 10 8 6 12"/>',
  down: '<path d="M4.5 6.5 8 10l3.5-3.5"/>',
  doc: '<path d="M4 1.75h5l3 3v9.5H4z"/><path d="M9 1.75v3h3"/>',
  close: '<path d="m4 4 8 8M12 4l-8 8"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  minus: '<path d="M3.5 8h9"/>',
  toend: '<path d="M4 4l4 4 4-4M4 9l4 4 4-4"/>',
  copy: '<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M11 5V3.5c0-.8-.7-1.5-1.5-1.5h-6C2.7 2 2 2.7 2 3.5v6c0 .8.7 1.5 1.5 1.5H5"/>',
  pin: '<path d="M8 10.5V14M5 2.5h6l-1 3.5 2 2.5H4l2-2.5z"/>',
  fold: '<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2"/><path d="M5.5 2.75v10.5"/>',
  page: '<path d="M4 1.75h8v12.5H4z"/><path d="M6 5h4M6 7.5h4M6 10h2.5"/>',
  out: '<path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M11.5 9.5v4h-9v-9h4"/>',
  more: '<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>',
} as const;

/** The left section's rail, on the 18-unit grid. */
const RAIL = {
  places: '<path d="M2.5 5h4.2l1.5 1.6h7.3v7.9h-13z"/>',
  metadata: '<circle cx="9" cy="9" r="6.3"/><path d="M9 8.3v4.2M9 5.6v.3"/>',
  outline: '<path d="M3 4h12M6 7.3h9M6 10.7h9M3 14h12"/>',
  links: '<path d="M7.6 10.4a3 3 0 0 0 4.3 0l2.2-2.2a3 3 0 0 0-4.3-4.3l-.9.9M10.4 7.6a3 3 0 0 0-4.3 0L3.9 9.8a3 3 0 0 0 4.3 4.3l.9-.9"/>',
  search: '<circle cx="8" cy="8" r="4.6"/><path d="M11.5 11.5l4 4"/>',
  transforms: '<path d="M3 6.3h11l-2.4-2.4M15 11.7H4l2.4 2.4"/>',
  export: '<path d="M9 11.2V3M6 5.9l3-3 3 3M3.5 9.6v5h11v-5"/>',
  versions: '<path d="M3.3 9.2a5.8 5.8 0 1 0 1.8-4.4M3.2 3.2v2.7h2.7M9 6.2v3.1l2.2 1.4"/>',
  look: '<text x="9" y="13.2" text-anchor="middle" font-size="11" font-weight="700" stroke="none" fill="currentColor" font-family="Georgia,serif">Aa</text>',
  // A gear of six teeth: eight close up at 18 px under a 1.4 stroke. A ring of rays read as brightness beside Look.
  settings:
    '<path d="M7.51 3.81 7.75 1.91A7.2 7.2 0 0 1 10.25 1.91L10.49 3.81A5.4 5.4 0 0 1 12.75 5.12L14.52 4.37A7.2 7.2 0 0 1 15.77 6.54L14.24 7.69A5.4 5.4 0 0 1 14.24 10.31L15.77 11.46A7.2 7.2 0 0 1 14.52 13.63L12.75 12.88A5.4 5.4 0 0 1 10.49 14.19L10.25 16.09A7.2 7.2 0 0 1 7.75 16.09L7.51 14.19A5.4 5.4 0 0 1 5.25 12.88L3.48 13.63A7.2 7.2 0 0 1 2.23 11.46L3.76 10.31A5.4 5.4 0 0 1 3.76 7.69L2.23 6.54A7.2 7.2 0 0 1 3.48 4.37L5.25 5.12A5.4 5.4 0 0 1 7.51 3.81z"/><circle cx="9" cy="9" r="2.3"/>',
} as const;

export type RailIconName = keyof typeof RAIL;

export function railIcon(name: RailIconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 18 18');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('marxy-icon');
  svg.innerHTML = RAIL[name];
  return svg;
}

export type IconName = keyof typeof PATHS;

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('marxy-icon');
  svg.innerHTML = PATHS[name];
  return svg;
}
