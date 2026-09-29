// Destination-on-summon labels: trusted DOM after sanitise, hidden at rest (MARXY-236).

import { linkDestinationLabel } from '@marxy/core/src/render/index.ts';

const DEST = 'marxy-link-dest';

/** Append a hidden destination host on each link that has one; skip links already labelled. */
export function applyLinkDestinations(root: ParentNode): void {
  const doc = root instanceof Document ? root : root.ownerDocument;
  if (doc === null) return;
  for (const a of root.querySelectorAll('a[href]')) {
    if (a.querySelector(`.${DEST}`) !== null) continue;
    const dest = linkDestinationLabel(a.getAttribute('href') ?? '');
    if (dest === null) continue;
    const el = doc.createElement('code');
    el.className = DEST;
    el.setAttribute('aria-hidden', 'true');
    el.textContent = dest;
    a.append(el);
  }
}
