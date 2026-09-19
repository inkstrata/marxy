// The node map and the block list (MARXY-75, docs/design/02-render.md §App-side post-passes), in a real
// WebKit page over a corpus render: every provenance-bearing element resolves to the node of its own
// range, a forged range resolves to nothing, and the blocks are innermost, in order and non-overlapping.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test as nodeTest } from 'node:test';
import { webkit } from 'playwright';

/**
 * A job without Playwright's WebKit (CI's `fast` job) skips these tests and says why, unless
 * MARXY_BROWSER_TESTS_REQUIRED=1, where a missing browser is a failure as it should be.
 */
const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);
import { parseMarkdown } from '../../../packages/core/src/parse/parse.ts';
import { renderDocumentSafeHtml } from '../../../packages/core/src/render/pipeline.ts';

const root = new URL('../../../', import.meta.url);
const post = stripTypeScriptTypes(readFileSync(new URL('apps/desktop/src/render/post.ts', root), 'utf8'))
  .replace(/^import .*$/gm, '')
  .replace(/^export /gm, '');

async function withPage(file, run) {
  const ast = parseMarkdown(readFileSync(new URL(`fixtures/corpus/${file}`, root)), { file });
  const { html } = renderDocumentSafeHtml(ast);
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
    await page.setContent(`<!doctype html><meta charset="utf-8"><article id="doc" style="max-width:68ch;margin:auto">${html}</article>`);
    await page.addScriptTag({ content: `${post}\nwindow.marxyPost = { buildNodeMap, buildBlocks, nodeFor };` });
    return await run(page, ast);
  } finally {
    await browser.close();
  }
}

test('every element with provenance resolves to the node of exactly its range', async () => {
  const result = await withPage('09-gfm-everything.md', (page, ast) =>
    page.evaluate((ast) => {
      const map = window.marxyPost.buildNodeMap(ast);
      const els = [...document.querySelectorAll('[data-marxy-s]')];
      const misses = els.filter((el) => {
        const node = window.marxyPost.nodeFor(map, el);
        return node === undefined || String(node.src.start) !== el.getAttribute('data-marxy-s') && node.type !== 'codeBlock';
      });
      return { count: els.length, misses: misses.map((el) => el.outerHTML.slice(0, 80)) };
    }, ast),
  );
  assert.ok(result.count > 50, `expected a corpus document's worth of elements; found ${result.count}`);
  assert.deepEqual(result.misses, []);
});

test('a range with no node resolves to nothing, even on a real element', async () => {
  const node = await withPage('09-gfm-everything.md', (page, ast) =>
    page.evaluate((ast) => {
      const map = window.marxyPost.buildNodeMap(ast);
      const p = document.querySelector('p[data-marxy-s]');
      p.setAttribute('data-marxy-e', '987654321');
      return window.marxyPost.nodeFor(map, p) ?? null;
    }, ast),
  );
  assert.equal(node, null);
});

test('blocks are the innermost blocks, in document order, and never overlap', async () => {
  const blocks = await withPage('09-gfm-everything.md', (page, ast) =>
    page.evaluate((ast) => {
      const article = document.getElementById('doc');
      return window.marxyPost.buildBlocks(article, window.marxyPost.buildNodeMap(ast)).map((b) => ({
        tag: b.el.tagName.toLowerCase(),
        start: b.start,
        top: b.top,
        height: b.height,
        footnote: b.el.closest('.marxy-footnotes') !== null,
        nested: b.el.querySelector('p[data-marxy-s],li[data-marxy-s],pre[data-marxy-s],table[data-marxy-s]') !== null,
      }));
    }, ast),
  );
  assert.ok(blocks.length > 20, `expected many blocks; found ${blocks.length}`);
  assert.ok(blocks.some((b) => b.tag === 'li'), 'a tight item is its own block');
  assert.ok(blocks.some((b) => b.footnote), 'the fixture has footnotes, so the exemption below is exercised');
  assert.ok(!blocks.some((b) => b.tag === 'ul' || b.tag === 'ol' || b.tag === 'blockquote'), 'containers give way to what they contain');
  for (const [i, b] of blocks.entries()) {
    assert.equal(b.nested, false, `block ${i} <${b.tag}> contains another block`);
    if (i === 0) continue;
    // Footnotes are set at the end wherever their definitions sit in the file, so only the body is in byte order.
    if (!b.footnote) assert.ok(b.start > blocks[i - 1].start, `block ${i} <${b.tag}> is out of byte order`);
    assert.ok(b.top >= blocks[i - 1].top + blocks[i - 1].height - 0.5, `block ${i} <${b.tag}> overlaps the one before it`);
  }
});
