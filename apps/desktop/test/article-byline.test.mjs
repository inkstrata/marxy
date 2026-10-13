// An article's byline and dek (K-20; the card's questions as ruled 2026-10-12). An `article` whose front matter names
// an author shows one byline line (author, date, the source's host) above the title, where the front matter is, with no
// `author:` label, and every key the bytes hold is still shown (the byline's as the byline, the rest in the head). The
// host is a link to the whole URL whose destination is summoned like every link's. One pair of outer quotes is dropped
// in the byline only, and copying the byline gives each value as the bytes hold it, less those quotes, one per line.
// The dek is a `description`, `dek` or `subtitle` row, or else an opening paragraph wholly in emphasis right after the
// title; never both. A `report` with the same front matter keeps the quiet head. Source shows the file exactly.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);
after(() => closeHarness());

const fixture = readFileSync(new URL('../../../fixtures/corpus/33-article-byline.md', import.meta.url), 'utf8');
const front = fixture.slice(0, fixture.indexOf('\n---\n') + 5);
/** The keys of the fixture's front matter, as the bytes hold them. */
const keysInBytes = front.split('\n').filter((l) => /^[a-z]+:/.test(l)).map((l) => l.slice(0, l.indexOf(':')));
const report = `${front}\n# Plan\n\n## Summary\n\nx\n\n## Risks\n\ny\n\n## Next steps\n\nz\n`;
// The mock's article: no dek key, so the opening paragraph wholly in emphasis is the dek.
const essay = '---\ntitle: The case for ragged right\nauthor: M. Ellery\npublished: 2026-09-12\nsource: https://example.org/essays/ragged-right\n---\n\n# The case for ragged right\n\n*Justified text looks orderly from across the room.*\n\nOpen almost any e-reader and the text runs flush to both margins.\n';
// The same, but its opening paragraph only begins in emphasis: not the dek.
const partly = essay.replace('*Justified text looks orderly from across the room.*', '*Justified text* looks orderly from across the room.');
// Sources the byline must not shorten (userinfo: the host shown would not be the host it goes to) or link (a control
// character: the link policy would refuse the href).
const withSource = (value) => fixture.replace('source: https://example.org/essays/leading?from=feed', `source: ${value}`);
const files = {
  '/r/leading.md': fixture, '/r/plan.md': report, '/r/ragged.md': essay, '/r/partly.md': partly,
  '/r/userinfo.md': withSource('https://good.example@evil.example/x'),
  '/r/control.md': withSource('https://example.org/a\u0001b'),
  '/r/zwsp.md': withSource('https://example.org/a\u200Bb'),
  '/r/bidi.md': withSource('https://example.org/a\u202Eb?q=\u202Ec'),
};

async function withPage(fn, width = 1470) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await fn(page);
  } finally {
    await browser.close();
  }
}

/** Opens `path` and, when it has a paragraph long enough to set, waits for the typesetter to have set it. */
const open = async (page, path) => {
  await page.evaluate((p) => window.__marxyHandle.open(p), path);
  await page.waitForFunction(() => document.querySelector('#doc > p.marxy-set') !== null, null, { timeout: 5_000 }).catch(() => {});
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};

/** The head as the reader sees it: each row's key, whether its label shows, its value's visible text and its box. */
const head = (page) =>
  page.evaluate(() => {
    const article = document.getElementById('doc');
    const dl = article.querySelector(':scope > dl:first-child');
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && getComputedStyle(el).display !== 'none';
    };
    // The visible text of an element: the text of every descendant that is displayed.
    const visibleText = (el) => {
      let out = '';
      const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE) out += node.data;
        else if (node.nodeType === Node.ELEMENT_NODE && getComputedStyle(node).display !== 'none') for (const c of node.childNodes) walk(c);
      };
      walk(el);
      return out;
    };
    const rows = [...dl.querySelectorAll(':scope > dd[data-marxy-fm-key]')].map((dd) => {
      const dt = dd.previousElementSibling;
      const r = dd.getBoundingClientRect();
      const cs = getComputedStyle(dd);
      return {
        key: dd.getAttribute('data-marxy-fm-key'),
        part: dd.getAttribute('data-marxy-fm-part'),
        label: shown(dt) ? dt.textContent : null,
        value: visibleText(dd),
        shown: shown(dd),
        top: Math.round(r.top),
        labelTop: Math.round(dt.getBoundingClientRect().top),
        size: parseFloat(cs.fontSize),
        italic: cs.fontStyle === 'italic',
      };
    });
    const body = parseFloat(getComputedStyle(article).fontSize);
    const opening = article.querySelector(':scope > h1 + p');
    return {
      kind: article.closest('section.marxy-pane').getAttribute('data-marxy-kind'),
      display: getComputedStyle(dl).display,
      above: dl.compareDocumentPosition(article.querySelector('h1')) === Node.DOCUMENT_POSITION_FOLLOWING,
      rows,
      body,
      opening: opening ? { size: parseFloat(getComputedStyle(opening).fontSize) } : null,
    };
  });

test('an article shows one byline line, no author label, and every key the bytes hold', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/leading.md'] });
    await open(page, '/r/leading.md');
    const h = await head(page);
    assert.equal(h.kind, 'article');
    assert.ok(h.above, 'the head sits above the title, where the bytes put it');
    const byline = h.rows.filter((r) => r.part === 'byline');
    assert.deepEqual(byline.map((r) => r.key), ['author', 'published', 'source'], 'the byline rows, first, in the bytes\' order');
    assert.deepEqual(byline.map((r) => r.value), ['M. Ellery', '2026-09-12', 'example.org'], 'values, one pair of quotes dropped, the host');
    assert.equal(new Set(byline.map((r) => r.top)).size, 1, 'one byline line');
    for (const r of byline) assert.equal(r.label, null, `no "${r.key}:" label`);
    const rest = h.rows.filter((r) => r.part !== 'byline');
    assert.ok(rest.every((r) => r.top > byline[0].top), 'the head rows sit beneath the byline');
    assert.deepEqual(rest.filter((r) => r.part === null).map((r) => r.label), ['title', 'tags'], 'the head keeps every other row, labelled');
    for (const r of rest.filter((x) => x.part === null)) assert.ok(Math.abs(r.labelTop - r.top) < 4, `"${r.key}" and its value share a line`);
    const shownKeys = h.rows.filter((r) => r.shown).map((r) => r.key);
    assert.equal(shownKeys.length, keysInBytes.length, 'as many keys shown as the bytes hold');
    assert.deepEqual([...shownKeys].sort(), [...keysInBytes].sort());
  }));

test('the byline stays one line at the gate\'s 960 px, after the typesetter has run', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/leading.md'] });
    await open(page, '/r/leading.md');
    const set = await page.evaluate(() => document.querySelectorAll('#doc > p.marxy-set').length);
    assert.ok(set > 0, 'the typesetter has set the text');
    const h = await head(page);
    const byline = h.rows.filter((r) => r.part === 'byline');
    assert.deepEqual(byline.map((r) => r.value), ['M. Ellery', '2026-09-12', 'example.org']);
    assert.equal(new Set(byline.map((r) => r.top)).size, 1, 'one byline line');
    const lines = await page.evaluate(() => [...document.querySelectorAll('#doc > dl > dd[data-marxy-fm-part="byline"]')].map((d) => Math.round(d.getBoundingClientRect().height)));
    assert.ok(lines.every((n) => n === lines[0]), `each value on one line: ${lines}`);
  }, 960));

test('the byline\'s host is a link to the whole URL, its destination summoned like every link\'s', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/leading.md'] });
    await open(page, '/r/leading.md');
    const a = page.locator('#doc > dl dd[data-marxy-fm-key="source"] a');
    assert.equal(await a.getAttribute('href'), 'https://example.org/essays/leading?from=feed');
    const dest = page.locator('#doc > dl dd[data-marxy-fm-key="source"] a .marxy-link-dest');
    await dest.waitFor({ state: 'attached' });
    assert.equal(await dest.isVisible(), false, 'hidden at rest');
    await a.hover();
    assert.equal(await dest.isVisible(), true, 'shown on hover');
    assert.equal(await dest.textContent(), 'example.org');
    assert.notEqual(await a.evaluate((el) => getComputedStyle(el).color), await page.locator('#doc > dl dd[data-marxy-fm-key="published"]').evaluate((el) => getComputedStyle(el).color), 'drawn as a link');
  }));

test('copying the byline gives each value as the bytes hold it, less one pair of outer quotes, one per line', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/leading.md'] });
    await open(page, '/r/leading.md');
    const copyByline = async () => {
      await page.evaluate(() => {
        const dds = [...document.querySelectorAll('#doc > dl > dd[data-marxy-fm-key]')];
        const author = dds.find((d) => d.getAttribute('data-marxy-fm-key') === 'author');
        const source = dds.find((d) => d.getAttribute('data-marxy-fm-key') === 'source');
        const range = document.createRange();
        range.setStartBefore(author.previousElementSibling);
        range.setEnd(source, source.childNodes.length);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      });
      const key = await page.evaluate(() => (navigator.platform === 'MacIntel' ? 'Meta' : 'Control'));
      const before = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length);
      await page.keyboard.press(`${key}+KeyC`);
      await page.waitForFunction((n) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length > n, before);
      return page.evaluate(() => {
        const call = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
        return new TextDecoder().decode(call.args[0].find((r) => r.type === 'public.utf8-plain-text').bytes);
      });
    };
    assert.equal(await copyByline(), 'M. Ellery\n2026-09-12\nhttps://example.org/essays/leading?from=feed');
    // A report's head copies as it always has: each key, then its value verbatim, quotes and all.
    await open(page, '/r/plan.md');
    assert.equal(
      await copyByline(),
      'author\n"M. Ellery"\npublished\n2026-09-12\nsource\nhttps://example.org/essays/leading?from=feed',
    );
  }));

test('a report with the same front matter keeps the quiet head', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/plan.md'] });
    await open(page, '/r/plan.md');
    const h = await head(page);
    assert.equal(h.kind, 'report');
    assert.equal(h.display, 'grid', 'two columns, as before');
    assert.deepEqual(h.rows.map((r) => r.key), keysInBytes, 'every row where the bytes put it');
    const visualOrder = [...h.rows].sort((a, b) => a.top - b.top).map((r) => r.key);
    assert.deepEqual(visualOrder, keysInBytes, 'and shown in that order');
    assert.equal(await page.locator('#doc > dl a').count(), 0, 'no link in the head: the source is its plain value');
    for (const r of h.rows) assert.equal(r.label, r.key, `the "${r.key}" label shows`);
    const author = h.rows.find((r) => r.key === 'author');
    assert.equal(author.value, '"M. Ellery"', 'the value verbatim, quotes and all');
    assert.equal(h.rows.find((r) => r.key === 'source').value, 'https://example.org/essays/leading?from=feed', 'the whole URL');
    assert.equal(new Set(h.rows.map((r) => r.top)).size, h.rows.length, 'one row a line');
    assert.ok(h.rows.every((r) => !r.italic && r.size < h.body), 'no dek: every value at the head\'s caption size');
  }));

test('the dek: a description key, larger and quieter, and then the opening italic paragraph is not one', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/leading.md'] });
    await open(page, '/r/leading.md');
    const h = await head(page);
    const dek = h.rows.find((r) => r.part === 'dek');
    assert.equal(dek.key, 'description');
    assert.equal(dek.label, null, 'no "description:" label');
    assert.ok(dek.italic && dek.size > h.body * 1.15, `the dek is larger than the text (${dek.size} vs ${h.body})`);
    assert.equal(h.opening.size, h.body, 'never both: the key wins over the italic paragraph');
  }));

test('the dek: an opening paragraph wholly in emphasis after the title, when there is no dek key', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/ragged.md'] });
    await open(page, '/r/ragged.md');
    const h = await head(page);
    assert.equal(h.kind, 'article');
    assert.ok(h.opening.size > h.body * 1.15, `the italic paragraph is the dek (${h.opening.size} vs ${h.body})`);
    await open(page, '/r/partly.md');
    const p = await head(page);
    assert.equal(p.opening.size, p.body, 'a paragraph only partly in emphasis is not');
  }));

test('Source shows the article\'s file exactly', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/leading.md'] });
    await open(page, '/r/leading.md');
    await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const handle = window.__marxyHandle;
      await handle.commands().find((c) => c.id === 'view.mode-source').run(buildAppContext(handle));
    });
    await page.waitForSelector('.cm-content', { timeout: 10_000 });
    const lines = await page.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map((l) => l.textContent));
    assert.deepEqual(lines.slice(0, 9), fixture.split('\n').slice(0, 9), 'the front matter, quotes and keys, as the bytes hold it');
  }));

test('a source whose host shown would not be its real host is shown whole, still a link to where it goes', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/userinfo.md'] });
    await open(page, '/r/userinfo.md');
    const h = await head(page);
    const source = h.rows.find((r) => r.key === 'source');
    assert.equal(source.value, 'https://good.example@evil.example/x', 'the whole URL as written');
    const a = page.locator('#doc > dl dd[data-marxy-fm-key="source"] a');
    await a.hover();
    assert.equal(await page.locator('#doc > dl dd[data-marxy-fm-key="source"] a .marxy-link-dest').textContent(), 'evil.example', 'the real host on summon');
  }));

test('a source holding a control character is no link and is shown whole, as written', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/control.md'] });
    await open(page, '/r/control.md');
    assert.equal(await page.locator('#doc > dl a').count(), 0, 'no link: the link policy would refuse its target');
    const text = await page.locator('#doc > dl dd[data-marxy-fm-key="source"]').evaluate((el) => el.textContent);
    assert.ok(text.startsWith('https://example.org/a') && text.endsWith('b'), `nothing of the value is hidden: ${JSON.stringify(text)}`);
    const hidden = await page.locator('#doc > dl dd[data-marxy-fm-key="source"] [data-marxy-fm-part]').count();
    assert.equal(hidden, 0, 'no part of it is marked to hide');
  }));

test('the link follows the pane\'s kind: another kind undoes it, article makes it again', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/leading.md'] });
    await open(page, '/r/leading.md');
    const links = () => page.locator('#doc > dl a').count();
    assert.equal(await links(), 1);
    const setKind = (k) => page.evaluate(async (kind) => {
      const { setPaneKind } = await import('/src/pane/dom.ts');
      setPaneKind(document.getElementById('doc').closest('section.marxy-pane'), kind);
    }, k);
    await setKind('report');
    assert.equal(await links(), 0, 'a report\'s head has its plain value');
    assert.equal(await page.locator('#doc > dl dd[data-marxy-fm-key="source"]').evaluate((el) => el.textContent), 'https://example.org/essays/leading?from=feed');
    await setKind('article');
    assert.equal(await links(), 1);
    assert.equal(await page.locator('#doc > dl a .marxy-link-dest').count(), 1, 'labelled once');
  }));

test('Rendered find reads what the byline draws: no clipped key, no hidden scheme or path', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/leading.md'] });
    await open(page, '/r/leading.md');
    const read = () => page.evaluate(async () => {
      const { collectText } = await import('/src/find/walk.ts');
      return collectText(document.getElementById('doc')).pieces.join('');
    });
    const article = await read();
    for (const hidden of ['author', 'published', 'https://', '/essays/leading']) {
      assert.ok(!article.includes(hidden), `"${hidden}" is not drawn, so not found`);
    }
    for (const shown of ['M. Ellery', '2026-09-12', 'example.org', 'title', 'tags']) assert.ok(article.includes(shown), `"${shown}" is found`);
    await open(page, '/r/plan.md');
    const report = await read();
    for (const shown of ['author', 'https://example.org/essays/leading']) assert.ok(report.includes(shown), `a report finds "${shown}"`);
  }));

for (const [name, url] of [['zwsp', 'https://example.org/a\u200Bb'], ['bidi', 'https://example.org/a\u202Eb?q=\u202Ec']]) {
  test(`a source with an invisible character (${name}) links to the URL as written, never with the marker's label in it`, () =>
    withPage(async (page) => {
      await bootTwoPanes(page, { files, open: [`/r/${name}.md`] });
      await open(page, `/r/${name}.md`);
      const a = page.locator('#doc > dl dd[data-marxy-fm-key="source"] a');
      await page.locator('#doc > dl dd[data-marxy-fm-key="source"] .marxy-invisible-glyph').first().waitFor({ state: 'attached' });
      assert.equal(await a.getAttribute('href'), url, 'the target is the URL as written');
      // Made again after the markers are in (a kind decided again), the target is the same.
      await page.evaluate(async () => {
        const { setPaneKind } = await import('/src/pane/dom.ts');
        const host = document.getElementById('doc').closest('section.marxy-pane');
        setPaneKind(host, 'report');
        setPaneKind(host, 'article');
      });
      assert.equal(await a.getAttribute('href'), url);
    }));
}
