// KaTeX on first use (docs/design/02-render.md post-pass 6, MARXY-28): dynamic import, bundled OFL fonts, grid snap after render.
/// <reference types="vite/client" />
import { adoptRuntimeSheet } from '@marxy/theme/src/loader.ts';
import { snapToGrid } from '@marxy/typeset';

let cssInjected = false;

/**
 * Inline math sits 0.085em below the text baseline by a relative offset, not `vertical-align`: a
 * shifted inline box grew the line box by the shift (48.98 px for a 48 px list item, MARXY-28's
 * 1.53 px) and pushed every later block off the baseline grid (B-02.2). Painting only,
 * so the line box stays a whole number of grid units; the grid is handbook ch.4 (04-spacing-layout).
 */
export const INLINE_MATH_RULE = 'code.marxy-math .katex{font-size:1em;line-height:inherit;vertical-align:baseline;position:relative;top:0.085em;}';

/** Resolve KaTeX font files to hashed URLs and rewrite the stylesheet once. */
async function injectKatexCss(): Promise<void> {
  if (cssInjected) return;
  cssInjected = true;
  const [{ default: css }, fonts] = await Promise.all([
    import('katex/dist/katex.min.css?raw'),
    import.meta.glob('../../node_modules/katex/dist/fonts/*.{woff2,woff,ttf}', {
      query: '?url',
      import: 'default',
    }),
  ]);
  let out = css as string;
  for (const [path, load] of Object.entries(fonts)) {
    const name = path.split('/').pop()!;
    const url = await load();
    out = out.replaceAll(`url(fonts/${name})`, `url(${url as string})`);
  }
  adoptRuntimeSheet(
    document,
    'marxy-katex',
    `${out}\n${INLINE_MATH_RULE}`,
  );
}

/**
 * KaTeX options for both modes. The limits keep a hostile formula from making a page millions of
 * pixels wide (`\rule{100000em}{1em}`); `strict: 'ignore'` keeps non-ASCII text quiet in the console.
 */
export function katexOptions(displayMode: boolean): {
  throwOnError: false;
  output: 'html';
  displayMode: boolean;
  maxSize: number;
  maxExpand: number;
  strict: 'ignore';
} {
  return { throwOnError: false, output: 'html', displayMode, maxSize: 20, maxExpand: 1000, strict: 'ignore' };
}

function sourceLineCount(text: string): number {
  if (text.length === 0) return 1;
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return Math.max(1, lines.length);
}

/**
 * When the article has math placeholders, load KaTeX once, render every block and inline span, and
 * snap block heights back onto the grid. Skips entirely when there is no math — no chunk fetch.
 */
export async function applyMath(article: HTMLElement): Promise<void> {
  // Formulas already set stay as they are: a reload that kept blocks (B-24) runs this again over a page
  // whose old blocks hold KaTeX's output, whose text is no longer the formula.
  const blocks = [...article.querySelectorAll<HTMLElement>('pre.marxy-math-block:not([data-marxy-done="math"])')];
  const inlines = [...article.querySelectorAll<HTMLElement>('code.marxy-math:not([data-marxy-done="math"])')];
  if (blocks.length === 0 && inlines.length === 0) return;

  const lineBox = parseFloat(getComputedStyle(article).lineHeight);
  for (const pre of blocks) {
    const src = pre.querySelector('code')?.textContent ?? pre.textContent ?? '';
    pre.style.minHeight = `${sourceLineCount(src) * lineBox}px`;
  }

  const { default: katex } = await import('katex');
  await injectKatexCss();

  for (const pre of blocks) {
    const target = pre.querySelector('code') ?? pre;
    const src = (target.textContent ?? '').replace(/\n$/, '');
    katex.render(src, target, katexOptions(true));
    pre.dataset.marxyDone = 'math';
  }
  for (const el of inlines) {
    const src = el.textContent ?? '';
    katex.render(src, el, katexOptions(false));
    el.dataset.marxyDone = 'math';
  }

  if (lineBox > 0) snapToGrid(article, lineBox);
}
