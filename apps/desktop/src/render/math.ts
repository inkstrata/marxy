// KaTeX on first use (docs/design/02-render.md post-pass 6, MARXY-28): dynamic import, bundled OFL fonts, grid snap after render.
/// <reference types="vite/client" />
import { snapToGrid } from '@marxy/typeset';

let cssInjected = false;

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
  const style = document.createElement('style');
  style.id = 'marxy-katex';
  style.textContent = `${out}\ncode.marxy-math .katex{font-size:1em;line-height:inherit;vertical-align:-0.085em;}`;
  document.head.append(style);
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
  const blocks = [...article.querySelectorAll<HTMLElement>('pre.marxy-math-block')];
  const inlines = [...article.querySelectorAll<HTMLElement>('code.marxy-math')];
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
    katex.render(src, target, { throwOnError: false, output: 'html', displayMode: true });
    pre.dataset.marxyDone = 'math';
  }
  for (const el of inlines) {
    const src = el.textContent ?? '';
    katex.render(src, el, { throwOnError: false, output: 'html', displayMode: false });
    el.dataset.marxyDone = 'math';
  }

  if (lineBox > 0) snapToGrid(article, lineBox);
}
