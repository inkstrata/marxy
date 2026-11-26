// A kind's sections of parts, drawn as kinds-media.css draws them: a font's tables, a
// recording's tracks, tags and boxes, a picture's chunks. Each row is a part the cursor rests on.
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import { el } from '../frame/dom.ts';
import css from './kind-sections.css?inline';

/** A section: its heading, the words beside it, and, for a file's parts, the heads of its columns. */
export function kindSection(title: string, sub: string, columns?: readonly [string, string, string]): HTMLElement {
  adoptRuntimeSheet(document, 'marxy-kind-sections-style', css);
  const box = el('section', 'marxy-ksec');
  const head = el('h3', 'marxy-ksec-h', title);
  if (sub) head.append(el('span', '', sub));
  box.append(head);
  if (columns) {
    const cols = el('div', 'marxy-ksec-row marxy-ksec-cols');
    cols.setAttribute('data-marxy-ksec', 'parts');
    cols.append(el('span', '', columns[0]), el('span', '', columns[1]), el('span', '', columns[2]), el('span'));
    box.append(cols);
  }
  return box;
}

/** A row of facts (`key`, `value`), or of a file's parts when it has an offset and a size. */
export function kindRow(key: string, value: string, part?: { readonly at: string; readonly size: string }): HTMLElement {
  const row = el('div', 'marxy-ksec-row');
  row.append(el('span', 'marxy-ksec-k', key));
  if (part) {
    row.setAttribute('data-marxy-ksec', 'parts');
    row.append(el('span', 'marxy-ksec-o', part.at), el('span', 'marxy-ksec-n', part.size));
  }
  row.append(el('span', 'marxy-ksec-v', value));
  return row;
}
