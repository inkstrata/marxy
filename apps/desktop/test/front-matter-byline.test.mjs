// Front matter as a byline: a page starts with its title, and the front matter's author and date are one quiet line
// under it, in every kind. Every other key is off the page (the Metadata panel lists them) but still in the head, so
// Reveal draws them and x-ray and Source reach the bytes. Each byline value carries the range of the bytes it shows. A
// paragraph wholly in emphasis directly under the title and byline is an article's dek.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const fixture = readFileSync(new URL('../../../fixtures/corpus/33-article-byline.md', import.meta.url), 'utf8');
const front = fixture.slice(0, fixture.indexOf('\n---\n') + 5);
const report = `${front}\n# Plan\n\n## Summary\n\nx\n\n## Risks\n\ny\n\n## Next steps\n\nz\n`;
const essay = '---\ntitle: The case for ragged right\nauthor: M. Ellery\npublished: 2026-09-12\n---\n\n# The case for ragged right\n\n*Justified text looks orderly from across the room.*\n\nOpen almost any e-reader and the text runs flush to both margins.\n';
const partly = essay.replace('*Justified text looks orderly from across the room.*', '*Justified text* looks orderly from across the room.');
const bare = '---\ntitle: Notes\ntags: [a, b]\n---\n\n# Notes\n\nText.\n';
const headOnly = '---\ntitle: Only\nauthor: A. Writer\n---\n\n# Only\n';
const short = '---\nauthor: A. Writer\ndate: 2026-09-12\n---\n\n# Short\n\nFirst paragraph.\n\nSecond paragraph.\n';
const FILES = { '/r/leading.md': fixture, '/r/plan.md': report, '/r/ragged.md': essay, '/r/partly.md': partly, '/r/bare.md': bare, '/r/head-only.md': headOnly, '/r/short.md': short };
const A = '[data-marxy-pane="0"] .marxy-article';

/** The page's top as the reader sees it: the first drawn elements, the head's shown values and the byline's line. */
const top = (page) =>
  page.evaluate((A) => {
    const article = document.querySelector(A);
    const dl = article.querySelector(':scope > dl[data-marxy-fm-part="head"]');
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && getComputedStyle(el).display !== 'none';
    };
    const drawn = [...article.children].filter(shown).slice(0, 3).map((el) => el.localName);
    const values = dl ? [...dl.children].filter(shown).map((el) => ({ tag: el.localName, key: el.getAttribute('data-marxy-fm-key'), text: el.innerText.trim(), top: Math.round(el.getBoundingClientRect().top), s: el.getAttribute('data-marxy-s'), e: el.getAttribute('data-marxy-e') })) : [];
    const h1 = article.querySelector(':scope > h1');
    const opening = article.querySelector(':scope > dl + p, :scope > h1 + p');
    return {
      kind: article.closest('section.marxy-pane').getAttribute('data-marxy-kind'),
      drawn,
      values,
      // The values as drawn, with the separator the date's ::before draws between them.
      line: dl && shown(dl)
        ? [...dl.children].filter(shown).map((el) => `${getComputedStyle(el, '::before').content.replace(/^"(.*)"$/, '$1 ').replace(/^none$/, '')}${el.innerText.trim()}`).join(' ')
        : null,
      bylineBelowTitle: dl && h1 ? dl.getBoundingClientRect().top >= h1.getBoundingClientRect().bottom : null,
      body: parseFloat(getComputedStyle(article).fontSize),
      opening: opening ? parseFloat(getComputedStyle(opening).fontSize) : null,
    };
  }, A);

const bytes = new TextEncoder().encode(fixture);
const slice = (s, e) => new TextDecoder().decode(bytes.slice(Number(s), Number(e)));

test('the title is the first thing on the page, and the author and date are one quiet line under it', async () => {
  await withFrame({ files: FILES, open: ['/r/leading.md'] }, async (page) => {
    const t = await top(page);
    assert.deepEqual(t.drawn.slice(0, 2), ['h1', 'dl'], 'the title, then the byline');
    assert.equal(t.bylineBelowTitle, true);
    assert.equal(t.line, 'M. Ellery · 12 September 2026');
    assert.deepEqual(t.values.map((v) => v.key), ['author', 'published'], 'no key label and no other row is drawn');
    assert.equal(new Set(t.values.map((v) => v.top)).size, 1, 'one line');
    const ink = await page.evaluate((A) => {
      const dd = document.querySelector(`${A} > dl dd[data-marxy-fm-key="author"]`);
      const p = document.querySelector(`${A} > p`);
      return { by: parseFloat(getComputedStyle(dd).fontSize), text: parseFloat(getComputedStyle(p).fontSize) };
    }, A);
    assert.ok(ink.by < ink.text, `quiet: smaller than the text (${ink.by} vs ${ink.text})`);
  });
});

test('each byline value carries the range of the bytes it shows', async () => {
  await withFrame({ files: FILES, open: ['/r/leading.md'] }, async (page) => {
    const { values } = await top(page);
    assert.deepEqual(values.map((v) => slice(v.s, v.e)), ['"M. Ellery"', '2026-09-12']);
    // The text a reader points at in the byline is reached through those ranges, not the whole head's.
    const carriers = await page.evaluate((A) => {
      const out = [];
      for (const dd of document.querySelectorAll(`${A} > dl dd[data-marxy-fm-part="byline"]`)) {
        const walker = document.createTreeWalker(dd, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.data.trim()) out.push(n.parentElement.closest('[data-marxy-s]').getAttribute('data-marxy-fm-key'));
      }
      return out;
    }, A);
    assert.ok(carriers.length > 0 && carriers.every((k) => k === 'author' || k === 'published'), JSON.stringify(carriers));
  });
});

test('every kind gets the byline: a report starts with its title too', async () => {
  await withFrame({ files: FILES, open: ['/r/plan.md'] }, async (page) => {
    const t = await top(page);
    assert.equal(t.kind, 'report');
    assert.deepEqual(t.drawn.slice(0, 2), ['h1', 'dl']);
    assert.equal(t.line, 'M. Ellery · 12 September 2026');
  });
});

test('front matter with no author and no date draws nothing above or below the title', async () => {
  await withFrame({ files: FILES, open: ['/r/bare.md'] }, async (page) => {
    const t = await top(page);
    assert.deepEqual(t.drawn.slice(0, 2), ['h1', 'p']);
    assert.equal(t.line, null);
  });
});

test('x-ray of the byline shows the front matter as stored, and Reveal draws every key', async () => {
  await withFrame({ files: FILES, open: ['/r/leading.md'] }, async (page) => {
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('g');
    await page.keyboard.press('g');
    // The first part is the title; the byline is the next one.
    for (let i = 0; i < 3; i++) {
      const on = await page.evaluate((A) => document.querySelector(`${A} .marxy-cursor`)?.localName ?? '', A);
      if (on === 'dl') break;
      await page.keyboard.press('j');
    }
    assert.equal(await page.evaluate((A) => document.querySelector(`${A} .marxy-cursor`)?.localName, A), 'dl', 'the cursor reaches the byline');
    await page.keyboard.press('x');
    const lines = await page.evaluate((A) => [...document.querySelectorAll(`${A} .marxy-xray .marxy-xray-text`)].map((t) => t.textContent), A);
    assert.deepEqual(lines, fixture.split('\n').slice(0, 8), 'the whole front matter, keys, quotes and fences');
    await page.keyboard.press('x');
    await page.keyboard.press('Shift+X');
    const revealed = await page.evaluate((A) => [...document.querySelectorAll(`${A} > dl dt`)].filter((dt) => getComputedStyle(dt).display !== 'none').map((dt) => dt.textContent), A);
    assert.deepEqual(revealed, ['title', 'description', 'tags', 'author', 'published', 'source']);
  });
});

test('Source shows the front matter exactly', async () => {
  await withFrame({ files: FILES, open: ['/r/leading.md'] }, async (page) => {
    await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const handle = window.__marxyHandle;
      await handle.commands().find((c) => c.id === 'view.mode-source').run(buildAppContext(handle));
    });
    await page.waitForSelector('.cm-content', { timeout: 10_000 });
    const lines = await page.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map((l) => l.textContent));
    assert.deepEqual(lines.slice(0, 9), fixture.split('\n').slice(0, 9));
  });
});

test('find reads the byline as drawn and none of the keys it does not draw', async () => {
  await withFrame({ files: FILES, open: ['/r/leading.md'] }, async (page) => {
    const text = await page.evaluate(async (A) => {
      const { collectText } = await import('/src/find/walk.ts');
      return collectText(document.querySelector(A)).pieces.join('');
    }, A);
    for (const shown of ['M. Ellery', '12 September 2026', 'Leading, measured']) assert.ok(text.includes(shown), `"${shown}" is found`);
    for (const hidden of ['author', 'published', 'Why the space', 'typography', 'example.org', '"M. Ellery"']) assert.ok(!text.includes(hidden), `"${hidden}" is not drawn, so not found`);
  });
});

test('the dek: a paragraph wholly in emphasis under the title and byline, and only that', async () => {
  await withFrame({ files: FILES, open: ['/r/ragged.md'] }, async (page) => {
    const t = await top(page);
    assert.equal(t.kind, 'article');
    assert.ok(t.opening > t.body * 1.15, `the italic paragraph is the dek (${t.opening} vs ${t.body})`);
    await page.evaluate(() => window.__marxyHandle.open('/r/partly.md'));
    await page.waitForFunction((A) => document.querySelector(`${A} > h1`)?.textContent === 'The case for ragged right' && document.querySelector(`${A} > dl + p`)?.textContent.startsWith('Justified'), A);
    const p = await top(page);
    assert.equal(p.opening, p.body, 'a paragraph only partly in emphasis is not');
  });
});

test('an edit anywhere keeps the title first and the byline under it, its ranges moved with the bytes', async () => {
  await withFrame({ files: FILES, open: ['/r/leading.md'] }, async (page) => {
    for (const next of [
      fixture.replace('# Leading, measured', '# Leading, measured again'),
      fixture.replace('author: "M. Ellery"', 'author: "M. Ellery and R. Calloway"'),
      fixture.replace('# Leading, measured\n', '# Leading, measured\n\nA new first paragraph.\n'),
      `${fixture}\nA closing line, far from the head.\n`,
    ]) {
      const reloaded = await page.evaluate(async (text) => {
        const h = window.__marxyHandle;
        const count = () => h.shell.calls.filter((c) => c.method === 'mark' && c.args[0] === 'live_reload').length;
        const before = count();
        await h.shell.writeFileAtomic('/r/leading.md', new TextEncoder().encode(text));
        h.shell.emit([{ kind: 'modified', path: '/r/leading.md' }]);
        for (let i = 0; i < 500 && count() === before; i++) await new Promise((r) => setTimeout(r, 10));
        return count() > before;
      }, next);
      assert.equal(reloaded, true);
      await page.waitForFunction(
        ({ A, title }) => document.querySelector(`${A} > h1`)?.textContent === title,
        { A, title: /^# (.*)$/m.exec(next)[1] },
      );
      await page.waitForTimeout(300);
      const t = await top(page);
      const at = new TextEncoder().encode(next);
      assert.deepEqual(t.drawn.slice(0, 2), ['h1', 'dl']);
      assert.equal(await page.evaluate((A) => document.querySelectorAll(`${A} > dl, ${A} > h1`).length, A), 2, 'one title and one head');
      assert.deepEqual(t.values.map((v) => new TextDecoder().decode(at.slice(Number(v.s), Number(v.e)))), [/author: (.*)/.exec(next)[1], '2026-09-12']);
    }
  });
});

test('j and k walk the page as it is drawn: the title, the byline, then the text', async () => {
  await withFrame({ files: FILES, open: ['/r/leading.md'] }, async (page) => {
    const on = () => page.evaluate((A) => document.querySelector(`${A} .marxy-cursor`)?.localName ?? null, A);
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('g');
    await page.keyboard.press('g');
    assert.equal(await on(), 'h1', 'the first part is the title');
    await page.keyboard.press('j');
    assert.equal(await on(), 'dl', 'then the byline');
    await page.keyboard.press('j');
    assert.equal(await on(), 'p', 'then the first paragraph');
    await page.keyboard.press('k');
    assert.equal(await on(), 'dl', 'k from the paragraph is the byline');
    await page.keyboard.press('k');
    assert.equal(await on(), 'h1', 'k from the byline is the title');
    await page.keyboard.press('k');
    assert.equal(await on(), 'h1', 'and the title is the top');
  });
});

// A reload's shortcut (render/incremental.ts) beside the title and its front matter, which are drawn in the other order:
// the page it leaves must be the page a whole render gives, byte for byte, or the shortcut must decline.
test('an edit at the title or the front matter leaves the page a whole render would', async () => {
  await withFrame({ files: FILES, open: ['/r/leading.md'] }, async (page) => {
    const core = fileURLToPath(new URL('../../../', import.meta.url));
    const body = '# Leading, measured\n\nA paragraph.\n\nAnother paragraph.\n';
    const front = '---\ntitle: Leading\nauthor: "M. Ellery"\ndate: 2026-09-12\n---\n\n';
    const cases = [
      ['the title deleted', front + body, front + body.replace('# Leading, measured\n\n', '')],
      ['the front matter deleted', front + body, body],
      ['front matter added above a title', body, front + body],
      ['the title retitled', front + body, front + body.replace('measured', 'remeasured')],
      ['a paragraph after them edited', front + body, front + body.replace('Another', 'One more')],
    ];
    const out = await page.evaluate(async ({ core, cases }) => {
      const root = core.replaceAll('\\', '/').replace(/^(?!\/)/, '/');
      const imp = (p) => import(`/@fs${root}${p}`);
      const { parseMarkdown } = await imp('packages/core/src/parse/parse.ts');
      const { reparseMarkdown } = await imp('packages/core/src/parse/reparse.ts');
      const { renderDocumentSafeHtml } = await imp('packages/core/src/render/pipeline.ts');
      const { DEFAULT_POLICY } = await imp('packages/core/src/sanitize/policy.ts');
      const { spliceRendered, renderRecord, parseInert } = await import('/src/render/incremental.ts');
      const enc = new TextEncoder();
      const results = [];
      for (const [name, before, after] of cases) {
        for (const reparsed of [false, true]) {
          const ast = parseMarkdown(enc.encode(before), { file: '/d/t.md' });
          const render = renderDocumentSafeHtml(ast, DEFAULT_POLICY);
          const record = renderRecord(ast, render.removed, false);
          const live = parseInert(render.html);
          const pending = document.implementation.createHTMLDocument('').createElement('div');
          const next = reparsed ? reparseMarkdown(ast, enc.encode(before), enc.encode(after), { file: '/d/t.md' }) : parseMarkdown(enc.encode(after), { file: '/d/t.md' });
          const result = spliceRendered(record, next, { live, pending }, { policy: DEFAULT_POLICY });
          const whole = parseInert(renderDocumentSafeHtml(next, DEFAULT_POLICY).html).innerHTML;
          results.push({ name, reparsed, spliced: result.spliced, same: !result.spliced || live.innerHTML + pending.innerHTML === whole });
        }
      }
      return results;
    }, { core, cases });
    for (const r of out) assert.equal(r.same, true, `${r.name}${r.reparsed ? ' (reparsed)' : ''}: the spliced page is not the whole render`);
    assert.ok(out.some((r) => r.name === 'a paragraph after them edited' && r.spliced), 'an edit away from the head still takes the shortcut');
    assert.ok(out.filter((r) => r.name !== 'a paragraph after them edited').every((r) => !r.spliced), 'an edit beside the head renders whole');
  });
});

/** The part the cursor is on, by its element. */
const cursorOn = (page) => page.evaluate((A) => [...document.querySelectorAll(`${A} .marxy-cursor, ${A} .marxy-selected`)].map((e) => e.localName), A);
/** What `c` puts on the pasteboard now, as text. */
const copied = async (page) => {
  const before = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length);
  await page.keyboard.press('c');
  await page.waitForFunction((n) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length > n, before);
  return page.evaluate(() => {
    const call = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
    return new TextDecoder().decode(call.args[0].find((r) => r.type === 'public.utf8-plain-text').bytes);
  });
};
const textNow = (page) => page.evaluate(() => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes));

test('a run from the byline into the text takes the title with it, and exactly the bytes it draws', async () => {
  await withFrame({ files: FILES, open: ['/r/short.md'] }, async (page) => {
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('g');
    await page.keyboard.press('g');
    await page.keyboard.press('j');
    assert.deepEqual(await cursorOn(page), ['dl'], 'on the byline');
    await page.keyboard.press('Shift+J');
    const run = await page.evaluate(() => window.__marxyHandle.selection.state().selection);
    assert.equal(run.kind, 'blocks');
    assert.deepEqual([run.range.start, run.range.end], [0, short.indexOf('First paragraph.') + 'First paragraph.'.length], 'the front matter, the title and the paragraph');
    assert.deepEqual(await page.evaluate(() => window.__marxyHandle.selection.state().selection.els.map((e) => e.localName)), ['h1', 'dl', 'p'], 'and the run draws all three');
    assert.equal(await copied(page), short.slice(0, short.indexOf('\n\nSecond')), 'the bytes the run draws, and no more');
    await page.keyboard.press('d');
    await page.waitForFunction((t) => new TextDecoder().decode(window.__marxyHandle.document().snapshot().buffer.bytes) !== t, short);
    assert.equal(await textNow(page), 'Second paragraph.\n', 'removed: the front matter, the title and the paragraph, nothing else');
  });
});

test('a run built upward from the text into the byline holds the same blocks', async () => {
  await withFrame({ files: FILES, open: ['/r/short.md'] }, async (page) => {
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('g');
    await page.keyboard.press('g');
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    assert.deepEqual(await cursorOn(page), ['p'], 'on the first paragraph');
    await page.keyboard.press('Shift+K');
    const run = await page.evaluate(() => window.__marxyHandle.selection.state().selection);
    assert.equal(run.kind, 'blocks');
    assert.deepEqual([run.range.start, run.range.end], [0, short.indexOf('First paragraph.') + 'First paragraph.'.length]);
    assert.deepEqual(await page.evaluate(() => window.__marxyHandle.selection.state().selection.els.map((e) => e.localName)), ['h1', 'dl', 'p']);
    assert.equal(await copied(page), short.slice(0, short.indexOf('\n\nSecond')));
    // The title alone with its byline is the same unit.
    await page.keyboard.press('Escape');
    await page.keyboard.press('g');
    await page.keyboard.press('g');
    await page.keyboard.press('Shift+J');
    const head = await page.evaluate(() => window.__marxyHandle.selection.state().selection);
    assert.deepEqual([head.range.start, head.range.end], [0, short.indexOf('# Short') + '# Short'.length]);
  });
});

test('G lands on the last part drawn: the byline, on a page of only a title and its front matter', async () => {
  await withFrame({ files: FILES, open: ['/r/head-only.md'] }, async (page) => {
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('j');
    await page.keyboard.press('Shift+G');
    assert.deepEqual(await cursorOn(page), ['dl']);
    await page.keyboard.press('g');
    await page.keyboard.press('g');
    assert.deepEqual(await cursorOn(page), ['h1']);
  });
});
