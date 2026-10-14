// Docs, notes and changelogs in their own settings (K-22): Copy release notes writes the bytes of the newest version's
// section and is not drawn for a file with no version heading; On this page and Versions open the inspector's Outline tab;
// a version's date and a notes file's date line are painted quiet without a character of the page changing; a docs page's
// signature block and admonitions are set apart, and ordinary Markdown is not touched. WebKit, over the shipped skeleton
// and the memory shell, as terminal.test.mjs runs.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const fixture = readFileSync(new URL('../../../fixtures/corpus/39-changelog.md', import.meta.url), 'utf8');
const docsPage = [
  '---', 'title: Index::watch', 'date: 2026-05-11', '---', '',
  '# Index::watch', '', 'Watch one or more folders.', '',
  '```rust', 'pub fn watch(&self) -> Result<WatchHandle, WatchError>', '```', '',
  '## Parameters', '', '| Name | Type |', '|---|---|', '| `roots` | `&[PathBuf]` |', '',
  '## Returns', '', 'A `WatchHandle`.', '',
  '> [!NOTE]', '> Events are coalesced per file.', '',
  '> **Careful** plain quote that starts with bold.', '',
  '> [!CAUTION]', '> On macOS this can be late.', '',
].join('\n');
const ordinary = '# Title\n\nA paragraph.\n\n```rust\nfn main() {}\n```\n\n> [!NOTE]\n> A note in an ordinary article.\n\n> **Careful** plain quote that starts with bold.\n';
const files = {
  '/r/CHANGELOG.md': fixture,
  '/r/CHANGES.md': '# Changes\n\n## Unreleased\n\n- soon\n\n## Older\n\n- b\n',
  '/r/docs/watch.md': docsPage,
  '/r/essay.md': ordinary,
  '/r/notes/2026-10-08.md': '2026-10-08\n\n# Thursday\n\n- one\n\nOn 2026-10-09 we met.\n',
  '/r/notes/with-front.md': '---\ndate: 2026-10-08\n---\n\n# Thursday\n\n- one\n',
};

async function withPage(fn, open = ['/r/CHANGELOG.md']) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await bootTwoPanes(page, { files, open });
    await fn(page);
  } finally {
    await browser.close();
  }
}

const openFile = async (page, path) => {
  await page.evaluate((p) => window.__marxyHandle.open(p), path);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 80)))));
};
const copied = (page) =>
  page.evaluate(() => {
    const call = window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').at(-1);
    return call ? new TextDecoder().decode(call.args[0].find((r) => r.type === 'public.utf8-plain-text').bytes) : null;
  });
const run = (page, id) =>
  page.evaluate(async (command) => {
    const { buildAppContext } = await import('/src/selection/bind.ts');
    const handle = window.__marxyHandle;
    await handle.commands().find((c) => c.id === command).run(buildAppContext(handle));
  }, id);
const available = (page, id) =>
  page.evaluate((command) => {
    const c = window.__marxyHandle.commands().find((x) => x.id === command);
    return c !== undefined && (c.when === undefined || c.when());
  }, id);
const stripTools = (page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-marxy-workspace-region="strip"] button')].map((b) => b.textContent.trim()));
const quietDates = (page) =>
  page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const highlight = CSS.highlights.get('marxy-quiet-date');
    return highlight === undefined ? [] : [...highlight].map((range) => range.toString());
  });

test('Copy release notes writes exactly the bytes of the newest version, from its heading to the line before the next version heading', () =>
  withPage(async (page) => {
    await run(page, 'changelog.copy-release-notes');
    const text = await copied(page);
    const from = fixture.indexOf('## [0.9.2]');
    const to = fixture.indexOf('## [0.9.0]');
    assert.ok(from > 0 && to > from);
    assert.equal(text, fixture.slice(from, to), 'the first version after Unreleased, byte for byte, its fenced look-alike heading inside it');
    assert.ok(text.includes('## [9.9.9]'), 'a heading-looking line in a fence is part of the section, not the end of it');
    const notice = await page.evaluate(() => document.querySelector('[data-marxy-notice], .marxy-notice')?.textContent ?? '');
    assert.match(notice, /Copied the notes for 0\.9\.2/);
    assert.equal(await page.evaluate(async () => new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/r/CHANGELOG.md'))), fixture, 'the file is unchanged');
  }));

test('a changelog with no version heading does not offer Copy release notes: the strip keeps the tool off, with its reason, as a log\'s are', () =>
  withPage(async (page) => {
    assert.equal(await available(page, 'changelog.copy-release-notes'), true);
    await page.evaluate(() => window.__marxyHandle.workspace().unfold());
    assert.deepEqual(await stripTools(page), ['Versions', 'Copy release notes', 'Changes']);
    await openFile(page, '/r/CHANGES.md');
    assert.equal(await page.evaluate(() => window.__marxyHandle.panes().focused.host.getAttribute('data-marxy-kind')), 'changelog');
    assert.equal(await available(page, 'changelog.copy-release-notes'), false);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
    const button = await page.evaluate(() => {
      const b = document.querySelector('[data-marxy-workspace-region="strip"] button[data-tool="copy-release-notes"]');
      return b && { off: b.getAttribute('aria-disabled'), title: b.title };
    });
    assert.deepEqual(button, { off: 'true', title: 'Copy release notes: No version heading in this file' });
    await run(page, 'changelog.copy-release-notes').catch(() => {});
    assert.equal(await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length), 0, 'nothing was copied');
  }));

test('On this page and Versions open the inspector on its Outline tab', () =>
  withPage(async (page) => {
    await page.evaluate(() => window.__marxyHandle.workspace().unfold());
    assert.ok((await stripTools(page)).includes('Versions'));
    await page.click('[data-marxy-workspace-region="strip"] button:has-text("Versions")');
    await page.waitForSelector('.marxy-inspector [role="tab"][aria-selected="true"]');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-inspector [role="tab"][aria-selected="true"]').textContent.trim()), 'Outline');
    await openFile(page, '/r/docs/watch.md');
    assert.deepEqual(await stripTools(page), ['On this page']);
    await page.evaluate(() => window.__marxyHandle.workspace().setPanel('inspector', false));
    await page.click('[data-marxy-workspace-region="strip"] button:has-text("On this page")');
    await page.waitForSelector('.marxy-inspector [role="tab"][aria-selected="true"]');
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-inspector [role="tab"][aria-selected="true"]').textContent.trim()), 'Outline');
  }), ['/r/CHANGELOG.md']);

test('a version heading\'s date, and a notes file\'s date line, are painted quiet over the characters already there', () =>
  withPage(async (page) => {
    const before = await page.evaluate(() => document.querySelector('.marxy-article').innerHTML);
    assert.deepEqual(await quietDates(page), ['2026-10-04', '2026-09-20', '2026-08-30']);
    assert.equal(await page.evaluate(() => document.querySelector('.marxy-article').innerHTML), before, 'no element was wrapped or added');
    const color = await page.evaluate(() => {
      const h2 = document.querySelector('.marxy-article > h2');
      const probe = document.createElement('i');
      probe.style.color = 'var(--marxy-color-text-secondary)';
      document.body.append(probe);
      const secondary = getComputedStyle(probe).color;
      probe.remove();
      return { secondary, heading: getComputedStyle(h2).color };
    });
    assert.notEqual(color.secondary, color.heading, 'the date has a colour of its own to take');
    await openFile(page, '/r/notes/2026-10-08.md');
    assert.deepEqual(await quietDates(page), ['2026-10-08'], 'only the first line; a date inside a sentence is prose');
    await openFile(page, '/r/essay.md');
    assert.deepEqual(await quietDates(page), [], 'an article has none');
  }));

test('a notes file\'s front-matter date row is in the secondary colour', () =>
  withPage(async (page) => {
    await openFile(page, '/r/notes/with-front.md');
    const colours = await page.evaluate(() => {
      const dd = document.querySelector('.marxy-article > dl:first-child > dd[data-marxy-fm-key="date"]');
      const probe = document.createElement('i');
      probe.style.color = 'var(--marxy-color-text-secondary)';
      document.body.append(probe);
      const secondary = getComputedStyle(probe).color;
      probe.remove();
      return { dd: dd && getComputedStyle(dd).color, secondary };
    });
    assert.equal(colours.dd, colours.secondary);
  }));

test('a docs page sets its signature block and admonitions apart; the same Markdown in an article is untouched', () =>
  withPage(async (page) => {
    await openFile(page, '/r/docs/watch.md');
    const look = (page_) => page_.evaluate(() => {
      const article = document.querySelector('.marxy-article');
      const pre = article.querySelector('pre');
      const quotes = [...article.querySelectorAll(':scope > blockquote')].map((q) => ({ bg: getComputedStyle(q).backgroundColor, text: q.textContent.trim().slice(0, 12) }));
      return { kind: article.closest('section').getAttribute('data-marxy-kind'), signature: getComputedStyle(pre).borderInlineStartWidth, quotes };
    });
    const docs = await look(page);
    assert.equal(docs.kind, 'docs');
    assert.equal(docs.signature, '3px', 'the signature block after the title has the accent\'s edge');
    assert.equal(docs.quotes.length, 3);
    const clear = 'rgba(0, 0, 0, 0)';
    assert.ok(docs.quotes.every((q) => q.bg !== clear), 'each alert and the bold-led quote sit on the code ground in a docs page');
    await openFile(page, '/r/essay.md');
    const essay = await look(page);
    assert.equal(essay.signature, '0px');
    assert.ok(essay.quotes.every((q) => q.bg === clear), 'in an article, quotes and alerts are as before');
  }));

test('a changelog\'s headings keep their words: the dates are restyled, not removed', () =>
  withPage(async (page) => {
    const headings = await page.evaluate(() => [...document.querySelectorAll('.marxy-article > h2')].map((h) => h.textContent));
    // The fixture's fenced `## [9.9.9]` line is code, not a heading.
    const written = fixture.split('\n').filter((l) => l.startsWith('## ') && !l.includes('9.9.9'));
    assert.equal(headings[0], 'Unreleased');
    assert.ok(headings[1].endsWith(' - 2026-10-04'), 'the date is still in the heading, only restyled');
    assert.equal(headings.length, written.length);
  }));
