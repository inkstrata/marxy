// The Line's own rows and previews: what a scope gives the view to paint. A row is a title (with
// the letters the query matched), a quiet detail, and a key, or an excerpt with its match marked; choosing it runs it.
// Text goes into the page as text nodes only.
import type { PanelId } from '../left/types.ts';
import type { PreviewData } from '../render/palette-preview.ts';

export interface RunHow {
  /** Mod+Enter (or a Mod click): beside, in the other pane. */
  readonly beside: boolean;
  /** Alt+Enter: the scope's second choice (find's lens). */
  readonly alt: boolean;
}

export interface LineRow {
  /** Stable while the query and the page stay: a row painted again is found by it. */
  readonly key: string;
  readonly group: string;
  readonly title: string;
  /** Indices into `title` the query matched. */
  readonly marks?: readonly number[];
  readonly detail?: string;
  /** A line cut around a match, drawn in the mono face in place of the title. */
  readonly ex?: { readonly before: string; readonly match: string; readonly after: string };
  /** The key spec that runs it elsewhere (`Mod+S`, `x`). */
  readonly key2?: string;
  /** Why it cannot run now: the row is dimmed and choosing it says so. */
  readonly why?: string;
  /** Runs it. `true` keeps the Line open (a row that sets the query). */
  run(how: RunHow): boolean | void | Promise<boolean | void>;
  /** Its preview, after the pause. */
  preview?(): Promise<PreviewData | LinePreview | null>;
  /** Tab keeps it in this panel with this argument. */
  readonly keep?: { readonly panel: PanelId; readonly arg: unknown };
}

/** Lines shown in the preview column: numbered, some lit (the lines a row stands for, a patch's changed lines). */
export interface LinePreview {
  readonly type: 'lines';
  readonly head: string;
  readonly lines: readonly { readonly no: string; readonly text: string; readonly at?: boolean; readonly sign?: '+' | '-' }[];
  readonly note?: string;
}

export function isLinePreview(data: unknown): data is LinePreview {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'lines';
}

export function drawLinePreview(host: HTMLElement, data: LinePreview): void {
  const doc = host.ownerDocument;
  const head = doc.createElement('div');
  head.className = 'marxy-line-prev-head';
  head.textContent = data.head;
  const body = doc.createElement('div');
  body.className = 'marxy-line-prev';
  for (const line of data.lines) {
    const row = doc.createElement('div');
    row.className = 'marxy-line-prev-row';
    if (line.at) row.dataset.marxyAt = '';
    if (line.sign) row.dataset.marxySign = line.sign;
    if (line.no !== '') {
      const no = doc.createElement('span');
      no.className = 'marxy-line-prev-no';
      no.textContent = line.no;
      row.append(no);
    }
    row.append(line.text === '' ? ' ' : line.text);
    body.append(row);
  }
  host.replaceChildren(head, body);
  if (data.note) {
    const note = doc.createElement('p');
    note.className = 'marxy-palette-prev-note';
    note.textContent = data.note;
    host.append(note);
  }
}

/** Lines `from`..`to` (0-based, inclusive) lit, with a few before and after, as the preview shows a place. */
export function around(lines: readonly string[], from: number, to: number | null, n = 26): LinePreview['lines'] {
  const a = Math.max(0, from - 3);
  const last = to ?? from;
  return lines.slice(a, a + n).map((text, i) => ({ no: String(a + i + 1), text, at: a + i >= from && a + i <= last }));
}
