// Shape as the scrollbar (proposal `minimap`): each pane's page in miniature down its right edge, in place of the
// scrollbar: headings as firm ticks, code, tables and quotes as boxes, paragraphs as faint bars, and a frame for what
// is on screen. A click or a drag goes there. Source only: Read's edge is the spine's (frame/spine.ts). Drawn
// from CodeMirror's line blocks: in Markdown a heading's line is a tick, a
// fence, a table or a quote a box, a run of other lines a bar; in any other file each run of lines is a bar. Blank
// stretches are the gaps either way.
import type { EditorView } from '@codemirror/view';
import { isMarkdownPath } from '@marxy/core/src/kind/registry.ts';
import type { AppHandle } from '../app-types.ts';
import { onProposals, proposalOn } from './state.ts';

/** Past this many blocks the strip draws every nth: a pixel cannot hold more. */
const MAX_MARKS = 1500;

type PaneLike = ReturnType<AppHandle['panes']>['panes'][number];
type Kind = 'h' | 'b' | 'p';
/** A mark in the scroller's own coordinates, before scaling. */
interface Mark {
  readonly kind: Kind;
  readonly top: number;
  readonly height: number;
}

/** The viewport's y of the top of what `s` scrolls. */
const contentTop = (s: HTMLElement): number =>
  s === document.documentElement ? -s.scrollTop : s.getBoundingClientRect().top - s.scrollTop;

interface Run {
  kind: Kind;
  readonly from: number;
  to: number;
}

/** Source's runs of lines (1-based, inclusive), as Read would set them; blank lines are the gaps between. */
export function sourceRuns(lines: Iterable<string>, markdown: boolean): Run[] {
  const out: Run[] = [];
  let run: Run | null = null;
  let closer: RegExp | null = null;
  const close = (): void => {
    if (run) out.push(run);
    run = null;
  };
  let n = 0;
  for (const text of lines) {
    n++;
    if (closer) {
      run!.to = n;
      if (closer.test(text)) {
        closer = null;
        close();
      }
      continue;
    }
    if (text.trim() === '') {
      close();
      continue;
    }
    let kind: Kind = 'p';
    if (markdown) {
      const fence = /^ {0,3}(`{3,}|~{3,})/.exec(text);
      if (fence || (n === 1 && /^---\s*$/.test(text))) {
        close();
        run = { kind: 'b', from: n, to: n };
        closer = fence ? new RegExp(`^ {0,3}${fence[1]![0] === '`' ? '`' : '~'}{${fence[1]!.length},}\\s*$`) : /^(---|\.\.\.)\s*$/;
        continue;
      }
      if (/^ {0,3}#{1,3}(\s|$)/.test(text)) {
        close();
        out.push({ kind: 'h', from: n, to: n });
        continue;
      }
      if (/^ {0,3}[>|]/.test(text)) kind = 'b';
    }
    if (run && run.kind !== kind) close();
    if (run) run.to = n;
    else run = { kind, from: n, to: n };
  }
  close();
  return out;
}

function sourceMarks(cm: EditorView, s: HTMLElement, markdown: boolean): Mark[] {
  const doc = cm.state.doc;
  const runs = sourceRuns(doc.iterLines(), markdown);
  const origin = cm.documentTop - contentTop(s);
  const step = Math.max(1, Math.ceil(runs.length / MAX_MARKS));
  const out: Mark[] = [];
  for (let k = 0; k < runs.length; k += step) {
    const run = runs[k]!;
    const first = cm.lineBlockAt(doc.line(run.from).from);
    const last = run.to === run.from ? first : cm.lineBlockAt(doc.line(run.to).from);
    out.push({ kind: run.kind, top: origin + first.top, height: last.bottom - first.top });
  }
  return out;
}

function mountMinimap(pane: PaneLike): () => void {
  const view = pane.view;
  const article = view.host.article;
  const source = pane.parts.source;
  const strip = document.createElement('div');
  strip.className = 'marxy-mmap';
  strip.setAttribute('aria-hidden', 'true');
  strip.hidden = true;
  const marks = document.createElement('div');
  const frame = document.createElement('b');
  frame.className = 'marxy-mmap-view';
  strip.append(marks, frame);
  document.body.append(strip);

  // Loaded with Source's editor already, so asked for only once Source shows.
  let cmView: typeof import('@codemirror/view') | null = null;
  let asked = false;
  /** Source's editor, once it is mounted in this pane. */
  const editor = (): EditorView | null => {
    if (!cmView) {
      if (!asked) {
        asked = true;
        void import('@codemirror/view').then((m) => {
          cmView = m;
          soon();
        });
      }
      return null;
    }
    const el = source.querySelector<HTMLElement>('.cm-editor');
    return el ? cmView.EditorView.findFromDOM(el) : null;
  };
  /** What scrolls in Source: the editor's own scroller, or the mount or the window, by the page's rules. */
  const sourceScroller = (cm: EditorView): HTMLElement =>
    [cm.scrollDOM, source, view.scroller].find((el) => el.scrollHeight > el.clientHeight + 1) ?? cm.scrollDOM;

  let marked: HTMLElement | null = null;
  let listened: HTMLElement | null = null;
  let measured: HTMLElement | null = null;
  // The element whose scroll the strip shows: the view's scroller in Read, Source's in Source.
  let target: HTMLElement = view.scroller;

  function place(): void {
    const box = pane.host.getBoundingClientRect();
    const head = pane.host.querySelector<HTMLElement>(':scope > .marxy-head');
    const top = head ? head.getBoundingClientRect().bottom : box.top;
    const bottom = Math.min(window.innerHeight, box.bottom);
    Object.assign(strip.style, { top: `${top}px`, height: `${Math.max(0, bottom - top)}px`, left: `${box.right - 16}px` });
  }

  function drawView(): void {
    if (strip.hidden) return;
    const s = target;
    const scale = strip.clientHeight / Math.max(1, s.scrollHeight);
    frame.style.top = `${(s.scrollTop * scale).toFixed(1)}px`;
    frame.style.height = `${Math.max(6, s.clientHeight * scale).toFixed(1)}px`;
  }
  // A burst of scroll events draws once: one frame is asked for, however many events land before it.
  let drawing = 0;
  function drawSoon(): void {
    if (drawing !== 0) return;
    drawing = requestAnimationFrame(() => {
      drawing = 0;
      drawView();
    });
  }
  const onTargetScroll = (): void => drawSoon();

  function follow(next: HTMLElement | null, cm: EditorView | null): void {
    if (listened !== next) {
      listened?.removeEventListener('scroll', onTargetScroll);
      next?.addEventListener('scroll', onTargetScroll, { passive: true });
      listened = next;
    }
    const content = cm?.contentDOM ?? null;
    if (measured !== content) {
      if (measured) sized.unobserve(measured);
      if (content) sized.observe(content);
      measured = content;
    }
  }

  function build(): void {
    const path = pane.path();
    const cm = proposalOn('minimap') && view.mode === 'source' && path !== null ? editor() : null;
    // A page of the app's own (an image, the file card, the bytes) has no shape of lines to draw.
    const paged = view.viewer()?.owns(view.mode) ?? false;
    // Rendered is the spine's (frame/spine.ts): drawn beside it, the two were a doubled bar, side by side or overlapping.
    const on = proposalOn('minimap') && path !== null && !paged && cm !== null;
    strip.hidden = !on;
    target = cm ? sourceScroller(cm) : view.scroller;
    // Read's scroll is heard through the view; Source's from its own scroller.
    follow(cm ? target : null, cm);
    if (marked && marked !== target) marked.removeAttribute('data-marxy-mmap');
    marked = on ? target : null;
    target.toggleAttribute('data-marxy-mmap', on);
    if (!on) return;
    place();
    const scale = strip.clientHeight / Math.max(1, target.scrollHeight);
    const found = sourceMarks(cm!, target, isMarkdownPath(path!));
    marks.replaceChildren(
      ...found.map((m) => {
        const i = document.createElement('i');
        i.className = m.kind;
        i.style.top = `${(m.top * scale).toFixed(1)}px`;
        i.style.height = `${m.kind === 'h' ? 2 : Math.max(1, m.height * scale - (m.kind === 'p' ? 1 : 0)).toFixed(1)}px`;
        return i;
      }),
    );
    drawView();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  function soon(): void {
    clearTimeout(timer);
    timer = setTimeout(build, 120);
  }

  const go = (e: PointerEvent): void => {
    const s = target;
    const box = strip.getBoundingClientRect();
    const at = (e.clientY - box.top) / Math.max(1, box.height);
    s.scrollTop = at * s.scrollHeight - s.clientHeight / 2;
  };
  strip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    strip.setPointerCapture(e.pointerId);
    go(e);
    strip.onpointermove = go;
  });
  strip.addEventListener('pointerup', () => {
    strip.onpointermove = null;
  });

  const offScroll = view.onScroll(drawSoon);
  // The strip moves with its pane at once (a divider drag resizes it on every move); only the redraw of its marks waits.
  const sized = new ResizeObserver(() => {
    if (!strip.hidden) place();
    soon();
  });
  sized.observe(article);
  sized.observe(pane.host);
  const changed = new MutationObserver(soon);
  changed.observe(article, { childList: true });
  // Source's editor is mounted a moment after the mode changes.
  changed.observe(source, { childList: true });
  // The view writes its mode on its host; the first pane's is <body>.
  changed.observe(view.host.modeHost, { attributes: true, attributeFilter: ['data-marxy-mode'] });
  // Typing that leaves the editor's height alone can still make or unmake a heading.
  source.addEventListener('input', soon, true);
  window.addEventListener('resize', soon);
  const offProposals = onProposals(soon);
  // A drawer or the panel opening moves a pane without resizing it, which no ResizeObserver hears. The frame writes
  // its lengths on <body> and eases the move (frame.css, 0.28 s), so the strip is placed again each frame of it.
  let until = 0;
  let tracking = 0;
  const track = (): void => {
    tracking = 0;
    if (strip.hidden) return;
    place();
    drawView();
    if (performance.now() < until) tracking = requestAnimationFrame(track);
  };
  const moved = new MutationObserver(() => {
    until = performance.now() + 400;
    if (!strip.hidden) place();
    if (tracking === 0) tracking = requestAnimationFrame(track);
    soon();
  });
  moved.observe(document.body, { attributes: true, attributeFilter: ['style', 'data-marxy-frame', 'data-marxy-moving'] });
  soon();

  return () => {
    clearTimeout(timer);
    cancelAnimationFrame(tracking);
    cancelAnimationFrame(drawing);
    moved.disconnect();
    offScroll();
    offProposals();
    follow(null, null);
    sized.disconnect();
    changed.disconnect();
    source.removeEventListener('input', soon, true);
    window.removeEventListener('resize', soon);
    marked?.removeAttribute('data-marxy-mmap');
    strip.remove();
  };
}

export function installMinimap(handle: AppHandle): () => void {
  const panes = handle.panes();
  const off = new Map<PaneLike, () => void>();
  const attach = (pane: PaneLike | undefined): void => {
    if (pane && !off.has(pane)) off.set(pane, mountMinimap(pane));
  };
  for (const pane of panes.panes) attach(pane);
  panes.onSplit(() => {
    const second = panes.panes[1];
    // The first pane's strip follows it onto its own section by itself: the split resizes its host.
    attach(second);
    return () => {
      if (second) {
        off.get(second)?.();
        off.delete(second);
      }
    };
  });
  return () => {
    for (const stop of off.values()) stop();
    off.clear();
  };
}
