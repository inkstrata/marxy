// Post-pass 5: Shiki tokens → trusted DOM spans (docs/design/02-render.md D-A11, MARXY-164). Every
// source line of every code block, highlighted or not, becomes one `.marxy-line` span so a line that
// wraps can mark its continuation rows (base.css, ADR-0033). The text nodes, and so `textContent`,
// copy and find, are unchanged: the newlines stay between the spans.
import { highlight, type HighlightToken } from '@marxy/core/src/highlight/index.ts';

const LANGUAGE_PREFIX = 'language-';
const LINE = 'marxy-line';
/** Matches base.css `tab-size`: a tab in the leading whitespace advances to the next multiple of 4. */
const TAB = 4;

/** Columns of leading whitespace, so a wrapped line continues past its own indentation. */
function indentColumns(text: string): number {
  let col = 0;
  for (const ch of text) {
    if (ch === ' ') col++;
    else if (ch === '\t') col += TAB - (col % TAB);
    else break;
  }
  return col;
}

function languageFromCode(code: HTMLElement): string | null {
  for (const cls of code.classList) {
    if (cls.startsWith(LANGUAGE_PREFIX)) return cls.slice(LANGUAGE_PREFIX.length);
  }
  return null;
}

/** Build trusted DOM from token lines; callers attach with `replaceChildren`, never `innerHTML`. */
export function spansFromTokens(lines: readonly (readonly HighlightToken[])[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (let li = 0; li < lines.length; li++) {
    if (li > 0) frag.append(document.createTextNode('\n'));
    // An empty last line is the fence's closing newline, not a row: a span there would add one.
    if (li === lines.length - 1 && lines[li]!.length === 0) break;
    const line = document.createElement('span');
    line.className = LINE;
    const indent = indentColumns(lines[li]!.map((t) => t.text).join(''));
    if (indent > 0) line.style.setProperty('--marxy-indent', `${indent}ch`);
    for (const tok of lines[li]!) {
      if (!tok.scope) {
        line.append(document.createTextNode(tok.text));
        continue;
      }
      const span = document.createElement('span');
      span.className = `marxy-tok-${tok.scope}`;
      span.textContent = tok.text;
      line.append(span);
    }
    frag.append(line);
  }
  return frag;
}

/** Plain code: the same one span per source line, no colour. */
export function applyLinesToCode(code: HTMLElement): boolean {
  if (code.dataset.marxyDone !== undefined) return false;
  const lines = (code.textContent ?? '').split('\n');
  code.replaceChildren(spansFromTokens(lines.map((t) => (t === '' ? [] : [{ text: t }]))));
  code.dataset.marxyDone = 'lines';
  return true;
}

type Lines = HighlightToken[][] | null;

/** The highlight worker, started on first use; null when a worker cannot run here (then the page highlights). */
let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<number, { code: string; lang: string; resolve: (lines: Lines) => void }>();

function startWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    const w = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; lines: Lines }>) => {
      const job = pending.get(e.data.id);
      pending.delete(e.data.id);
      job?.resolve(e.data.lines);
    };
    // A worker that cannot load (a CSP, an engine without module workers) is given up on once, and
    // every job it held is tokenised on the page instead: slower, never lost.
    w.onerror = () => {
      worker = null;
      w.terminate();
      const jobs = [...pending.values()];
      pending.clear();
      for (const job of jobs) void highlight(job.code, job.lang).then(job.resolve, () => job.resolve(null));
    };
    return w;
  } catch {
    return null;
  }
}

/** Token lines for one block, from the worker when there is one. */
function tokenize(code: string, lang: string): Promise<Lines> {
  if (worker === undefined) worker = startWorker();
  const w = worker;
  if (w === null) return highlight(code, lang);
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, { code, lang, resolve });
    w.postMessage({ id, code, lang });
  });
}

/** Highlight one block; with no known language it gets plain line spans and returns false (no colour is guessed). */
export async function applyHighlightToCode(code: HTMLElement): Promise<boolean> {
  if (code.dataset.marxyDone === 'highlight') return false;
  const lang = languageFromCode(code);
  if (!lang) return (applyLinesToCode(code), false);
  // Plain lines first, so a long wrapped line is marked even while its colour is on the way.
  applyLinesToCode(code);
  const lines = await tokenize(code.textContent ?? '', lang);
  if (!lines) return false;
  code.replaceChildren(spansFromTokens(lines));
  code.dataset.marxyDone = 'highlight';
  return true;
}

/** Every code block but math, fenced or indented, with or without a language. */
function fencedCodeBlocks(article: HTMLElement): HTMLElement[] {
  return [...article.querySelectorAll<HTMLElement>('pre:not(.marxy-math-block) > code')];
}

/** Highlight every fenced block (tests and environments without IntersectionObserver). */
export async function applyAllHighlights(article: HTMLElement): Promise<void> {
  for (const code of fencedCodeBlocks(article)) await applyHighlightToCode(code);
}

/**
 * Lazy highlighting in visibility order. Skips blocks already marked `data-marxy-done=highlight`.
 * Does not block startup — schedule from idle after first text (MARXY-164).
 */
export function startCodeHighlight(article: HTMLElement): void {
  const blocks = fencedCodeBlocks(article);
  if (blocks.length === 0) return;

  if (typeof IntersectionObserver === 'undefined') {
    void applyAllHighlights(article);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const code = entry.target as HTMLElement;
        observer.unobserve(code);
        void applyHighlightToCode(code);
      }
    },
    { root: null, rootMargin: '200% 0px' },
  );
  for (const code of blocks) observer.observe(code);
}
