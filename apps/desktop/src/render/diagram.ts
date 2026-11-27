// Diagrams: a `mermaid` fence read as a diagram is drawn as static SVG in ink, by the reader's own
// renderer (vendor/md-mermaid.js: flowcharts and sequence diagrams, no library, nothing fetched), loaded only when a page
// has one. The drawing goes inside the fence's own `pre`, its code kept there hidden: the block is still the part's bytes
// to the block list, a click and a copy, and Its source shows the code again. A diagram the renderer cannot draw stays
// code, with one line saying why.
import { DIAGRAM_ID_MARK, peekDiagram, rememberDiagram } from './block-cache.ts';

const DONE = 'data-marxy-diagram';

let measurer: CanvasRenderingContext2D | null | undefined;
// Each drawing's ids its own: two panes on one file draw the same block twice, and an arrowhead must find its own marker.
let drawings = 0;

/** Text widths in the face the diagram is set in, so its boxes fit their words; the renderer guesses without one. */
function measureIn(face: string): ((text: string, px: number, weight?: string | number) => number) | undefined {
  measurer ??= document.createElement('canvas').getContext('2d');
  const ctx = measurer;
  if (!ctx) return undefined;
  return (text, px, weight) => {
    ctx.font = `${weight === 'bold' || Number(weight) >= 600 ? 600 : 400} ${px}px ${face}`;
    return ctx.measureText(text).width;
  };
}

function sourceButton(pre: HTMLElement): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'marxy-diagram-source';
  b.textContent = 'Its source';
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => {
    const showing = pre.toggleAttribute('data-marxy-diagram-source');
    b.setAttribute('aria-pressed', String(showing));
    b.textContent = showing ? 'The diagram' : 'Its source';
  });
  return b;
}

/** Draws every diagram part under `article` not yet drawn; `regrid` is called once when any was. */
export async function applyDiagrams(article: HTMLElement, regrid: () => void): Promise<void> {
  const pres = [...article.querySelectorAll<HTMLElement>(`pre[data-marxy-part="diagram"]:not([${DONE}])`)];
  if (pres.length === 0) return;
  const { render } = await import('./vendor/md-mermaid.js');
  const face = getComputedStyle(document.documentElement).getPropertyValue('--marxy-face-chrome').trim() || 'sans-serif';
  const measure = measureIn(face);
  for (const pre of pres) {
    if (!pre.isConnected || pre.hasAttribute(DONE)) continue;
    const code = pre.querySelector('code');
    const text = code?.textContent ?? '';
    const id = `mm${++drawings}-`;
    // A drawing is kept under a stand-in id prefix and given its own on use. A text holding the stand-in is never kept.
    const keepable = !text.includes(DIAGRAM_ID_MARK);
    const known = keepable ? peekDiagram(face, text) : undefined;
    let out: { ok: boolean; svg: string | null; width: number; title: string; note: string };
    if (known) out = { ok: true, ...known, svg: known.svg.replaceAll(DIAGRAM_ID_MARK, id) };
    else {
      out = render(text, { measure, fontPx: 14, idPrefix: keepable ? DIAGRAM_ID_MARK : id });
      if (keepable && out.ok && out.svg) {
        rememberDiagram(face, text, { svg: out.svg, width: out.width, title: out.title, note: out.note });
        out = { ...out, svg: out.svg.replaceAll(DIAGRAM_ID_MARK, id) };
      }
    }
    if (out.ok && out.svg) {
      pre.setAttribute(DONE, 'drawn');
      const figure = document.createElement('span');
      figure.className = 'marxy-diagram';
      figure.setAttribute('contenteditable', 'false');
      figure.style.setProperty('--marxy-dw', `${out.width}px`);
      // Its own scroller, so the fade at the edge covers the drawing and not the caption beside it.
      const scroller = document.createElement('span');
      scroller.className = 'marxy-diagram-scroll';
      // Made by the renderer from the fence's text, every piece of it escaped (md-mermaid.js `esc`).
      scroller.innerHTML = out.svg;
      figure.append(scroller);
      const caption = document.createElement('span');
      caption.className = 'marxy-diagram-title';
      caption.append(out.title);
      if (out.note) caption.append(` · ${out.note}`);
      caption.append(sourceButton(pre));
      figure.append(caption);
      pre.append(figure);
      const said = pre.previousElementSibling;
      if (said?.classList.contains('marxy-diagram-caption')) said.setAttribute(DONE, 'drawn');
    } else {
      pre.setAttribute(DONE, 'refused');
      const note = document.createElement('span');
      note.className = 'marxy-diagram-note';
      note.textContent = out.note || 'The diagram could not be drawn.';
      pre.prepend(note);
    }
  }
  regrid();
}
