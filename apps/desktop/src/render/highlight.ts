// Post-pass 5: Shiki tokens → trusted DOM spans (docs/design/02-render.md D-A11, MARXY-164).
import { highlight, type HighlightToken } from '@marxy/core/src/highlight/index.ts';

const LANGUAGE_PREFIX = 'language-';

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
    for (const tok of lines[li]!) {
      if (!tok.scope) {
        frag.append(document.createTextNode(tok.text));
        continue;
      }
      const span = document.createElement('span');
      span.className = `marxy-tok-${tok.scope}`;
      span.textContent = tok.text;
      frag.append(span);
    }
  }
  return frag;
}

/** Highlight one fenced block; unknown language or prior pass → false and DOM unchanged. */
export async function applyHighlightToCode(code: HTMLElement): Promise<boolean> {
  if (code.dataset.marxyDone === 'highlight') return false;
  const lang = languageFromCode(code);
  if (!lang) return false;
  const lines = await highlight(code.textContent ?? '', lang);
  if (!lines) return false;
  code.replaceChildren(spansFromTokens(lines));
  code.dataset.marxyDone = 'highlight';
  return true;
}

function fencedCodeBlocks(article: HTMLElement): HTMLElement[] {
  return [...article.querySelectorAll<HTMLElement>('pre > code[class^="language-"]')];
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
