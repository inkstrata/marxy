// Code, formulas and diagrams drawn once are drawn the same way at once the next time the same text is rendered.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { createServer } from './support/shared-vite.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 90_000 }, fn);

const root = fileURLToPath(new URL('..', import.meta.url));
let serverPromise;
async function base() {
  serverPromise ??= (async () => {
    const server = await createServer({ root, configFile: `${root}/vite.config.ts`, logLevel: 'silent', server: { port: 0, strictPort: false, host: '127.0.0.1' } });
    await server.listen();
    return server;
  })();
  const server = await serverPromise;
  return `http://127.0.0.1:${server.config.server.port}/`;
}
after(async () => (await serverPromise)?.close());

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: 960, height: 900 } });
  await page.goto(`${await base()}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  return page;
}

test('a second render of twenty code blocks posts nothing to the worker, writes each block once, and matches the first', async () => {
  const browser = await launchWebkit();
  try {
    const page = await openPage(browser);
    const r = await page.evaluate(async () => {
      const { applyAllHighlights } = await import('/src/render/highlight.ts');
      const posts = [];
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (m, ...rest) {
        if (m && typeof m.id === 'number' && typeof m.code === 'string') posts.push(m.id);
        return post.call(this, m, ...rest);
      };
      const article = () => {
        const a = document.createElement('article');
        for (let i = 0; i < 20; i++) {
          const pre = document.createElement('pre');
          const code = document.createElement('code');
          code.className = 'language-ts';
          code.textContent = `const value${i} = "text ${i}";\nfunction f${i}(a: number) { return a + ${i}; }\n`;
          pre.append(code);
          a.append(pre);
        }
        document.body.append(a);
        return a;
      };
      const first = article();
      await applyAllHighlights(first);
      const afterFirst = posts.length;
      const second = article();
      let writes = 0;
      const seen = new Set();
      const observer = new MutationObserver((records) => {
        for (const rec of records) if (rec.type === 'childList' && rec.target.localName === 'code') { writes++; seen.add(rec.target); }
      });
      observer.observe(second, { childList: true, subtree: true });
      await applyAllHighlights(second);
      await Promise.resolve();
      observer.disconnect();
      // Colour is the theme's: a changed token variable reaches a block that came from the cache.
      document.documentElement.style.setProperty('--marxy-tok-keyword', 'rgb(255, 0, 0)');
      const keyword = second.querySelector('.marxy-tok-keyword');
      const recoloured = keyword ? getComputedStyle(keyword).color : null;
      document.documentElement.style.removeProperty('--marxy-tok-keyword');
      return {
        afterFirst,
        secondPosts: posts.length - afterFirst,
        writes,
        blocks: seen.size,
        same: first.outerHTML === second.outerHTML,
        coloured: second.querySelectorAll('.marxy-tok-keyword').length > 0,
        recoloured,
      };
    });
    assert.equal(r.afterFirst, 20);
    assert.equal(r.secondPosts, 0);
    assert.equal(r.writes, 20, 'each block is written once');
    assert.equal(r.blocks, 20);
    assert.ok(r.same, 'the cached page equals the uncached one');
    assert.ok(r.coloured);
    assert.equal(r.recoloured, 'rgb(255, 0, 0)');
  } finally {
    await browser.close();
  }
});

test('a formula set before is set from its kept markup, equal to what KaTeX made', async () => {
  const browser = await launchWebkit();
  try {
    const page = await openPage(browser);
    const r = await page.evaluate(async () => {
      const { applyMath } = await import('/src/render/math.ts');
      const { peekFormula, rememberFormula } = await import('/src/render/block-cache.ts');
      const article = () => {
        const a = document.createElement('article');
        const pre = document.createElement('pre');
        pre.className = 'marxy-math-block';
        const block = document.createElement('code');
        block.textContent = '\\frac{a}{b}';
        pre.append(block);
        const p = document.createElement('p');
        const inline = document.createElement('code');
        inline.className = 'marxy-math';
        inline.textContent = 'x^2';
        p.append(inline);
        a.append(pre, p);
        document.body.append(a);
        return a;
      };
      const first = article();
      await applyMath(first);
      const kept = peekFormula(true, '\\frac{a}{b}');
      const second = article();
      await applyMath(second);
      const same = first.outerHTML === second.outerHTML;
      // A marker planted under the key shows the second pass reads the store and does not call KaTeX.
      rememberFormula(false, 'x^2', '<span id="from-store">x</span>');
      const third = article();
      await applyMath(third);
      return { kept: typeof kept, same, planted: Boolean(third.querySelector('#from-store')), block: third.querySelector('pre .katex') !== null };
    });
    assert.equal(r.kept, 'string');
    assert.ok(r.same);
    assert.ok(r.planted);
    assert.ok(r.block);
  } finally {
    await browser.close();
  }
});

test('a diagram drawn before is drawn from its kept svg, with ids of its own', async () => {
  const browser = await launchWebkit();
  try {
    const page = await openPage(browser);
    const r = await page.evaluate(async () => {
      const { applyDiagrams } = await import('/src/render/diagram.ts');
      const { rememberDiagram } = await import('/src/render/block-cache.ts');
      const article = () => {
        const a = document.createElement('article');
        const pre = document.createElement('pre');
        pre.setAttribute('data-marxy-part', 'diagram');
        const code = document.createElement('code');
        code.textContent = 'flowchart LR\n  A --> B\n  B --> C';
        pre.append(code);
        a.append(pre);
        document.body.append(a);
        return a;
      };
      const ids = (a) => [...a.querySelectorAll('[id]')].map((e) => e.id);
      const first = article();
      await applyDiagrams(first, () => {});
      const second = article();
      await applyDiagrams(second, () => {});
      const a = ids(first);
      const b = ids(second);
      // A drawing planted under the key shows the third pass reads the store and does not draw.
      const face = getComputedStyle(document.documentElement).getPropertyValue('--marxy-face-chrome').trim() || 'sans-serif';
      const text = ['flowchart LR', '  A --> B', '  B --> C'].join('\n');
      rememberDiagram(face, text, { svg: '<svg><g id="mmcached0-planted"></g></svg>', width: 10, title: 'planted', note: '' });
      const third = article();
      await applyDiagrams(third, () => {});
      const planted = ids(third);
      return { planted, a, b, drawn: second.querySelectorAll('svg').length, disjoint: a.every((x) => !b.includes(x)) };
    });
    assert.equal(r.planted.length, 1);
    assert.match(r.planted[0], /^mm\d+-planted$/);
    assert.equal(r.drawn, 1);
    assert.ok(r.a.length > 0);
    assert.equal(r.b.length, r.a.length);
    assert.ok(r.disjoint, 'two drawings of one text never share an id');
  } finally {
    await browser.close();
  }
});

test('Source colours a fence too long for the shared store once, and does not ask for it again', async () => {
  const browser = await launchWebkit();
  try {
    const page = await openPage(browser);
    const r = await page.evaluate(async () => {
      // The editor's modules as the app's own code imports them, so the view and the plugin share one CodeMirror.
      const text = await (await fetch('/src/source/colour.ts')).text();
      const viewUrl = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]).find((u) => u.includes('codemirror_view'));
      const { EditorView } = await import(viewUrl);
      const { markdown } = await import(viewUrl.replace('codemirror_view', 'codemirror_lang-markdown'));
      const { fenceColour } = await import('/src/source/colour.ts');
      const line = 'const a = 1;';
      const body = Array.from({ length: Math.ceil(200_000 / (line.length + 1)) }, () => line).join('\n');
      let asked = 0;
      const tokens = async (code) => {
        asked++;
        return code.split('\n').map((t) => [{ text: 'const', scope: 'keyword' }, { text: t.slice(5) }]);
      };
      const host = document.createElement('div');
      host.style.height = '400px';
      document.body.append(host);
      const view = new EditorView({ parent: host, doc: `\`\`\`ts\n${body}\n\`\`\`\n`, extensions: [markdown(), fenceColour(tokens)] });
      for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 10));
      const coloured = view.contentDOM.querySelectorAll('.marxy-tok-keyword').length;
      view.destroy();
      host.remove();
      return { asked, coloured };
    });
    assert.equal(r.asked, 1, 'asked once');
    assert.ok(r.coloured > 0, 'and coloured');
  } finally {
    await browser.close();
  }
});
