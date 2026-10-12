// The default theme's kind profiles (K-05b; ADR-0059 item 7, ADR-0060): `article`, `readme` and `report` each
// set a face, a size, a line box and a measure through the kind scope; every other kind reads as it did. The
// sizes are multiples of the reader's own, the column holds its character count at any reader size, and the
// Source editor is not styled by a profile. The app boots on the shipped skeleton and its inline default theme
// over the memory shell, so these are the rules the app ships.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes, closeHarness } from './support/two-pane.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);
after(() => closeHarness());

async function withPage(fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
    await fn(page);
  } finally {
    await browser.close();
  }
}

const prose = '# Title\n\nA paragraph of plain prose, long enough to be a document and no more than that.\n';
const plan = '# Plan\n\n## Summary\n\nx\n\n## Risks\n\ny\n\n## Next steps\n\nz\n';
const files = {
  '/r/a.md': prose,
  '/r/README.md': prose,
  '/r/plan.md': plan,
  '/r/CHANGELOG.md': '# Changelog\n\n## 1.0.0\n\n- first\n',
  '/r/main.rs': 'fn main() {}\n',
};

/** What a pane's article is set in now: its kind, face, size, line box, column and the column in average characters. */
const metrics = (page) =>
  page.evaluate(() => {
    const article = document.getElementById('doc');
    const cs = getComputedStyle(article);
    const body = parseFloat(cs.fontSize);
    const column = parseFloat(cs.getPropertyValue('--marxy-column'));
    const avg = parseFloat(cs.getPropertyValue('--marxy-avg-char'));
    const h1 = article.querySelector('h1');
    // A custom property reads back as written; a probe element resolves it to the pixels it is used as.
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;height:var(--marxy-line-box-code);font-size:var(--marxy-size-code)';
    article.append(probe);
    const lineCode = probe.getBoundingClientRect().height;
    const code = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    return {
      kind: article.closest('section.marxy-pane').getAttribute('data-marxy-kind'),
      family: cs.fontFamily.split(',')[0].replaceAll('"', '').trim(),
      headingFamily: h1 ? getComputedStyle(h1).fontFamily.split(',')[0].replaceAll('"', '').trim() : null,
      body,
      line: parseFloat(cs.lineHeight),
      column,
      chars: column / (avg * body),
      h1: h1 ? parseFloat(getComputedStyle(h1).fontSize) : null,
      code,
      lineCode,
    };
  });

const open = async (page, path) => {
  await page.evaluate((p) => window.__marxyHandle.open(p), path);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return metrics(page);
};

/** Writes the reader's text size the way `applyReaderConfig` does (reader-config.ts `sizeProperties`). */
const readerSize = (page, px) =>
  page.evaluate(async (size) => {
    const { sizeProperties } = await import('/src/theme/reader-config.ts');
    for (const [k, v] of Object.entries(sizeProperties(size))) document.documentElement.style.setProperty(k, v);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, px);

const near = (actual, expected, why, eps = 0.6) => assert.ok(Math.abs(actual - expected) <= eps, `${why}: ${actual} is not ${expected}`);

test('each profile sets its face, size, line box and column; a kind with no profile reads as before', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/a.md'] });
    const article = await metrics(page);
    assert.equal(article.kind, 'article');
    assert.equal(article.family, 'Source Serif 4');
    assert.equal(article.headingFamily, 'Source Serif 4');
    assert.deepEqual([article.body, article.line], [20, 30], 'the article keeps 20 on 30');
    near(article.chars, 66, 'the article column, in average characters');

    const readme = await open(page, '/r/README.md');
    assert.equal(readme.kind, 'readme');
    assert.equal(readme.family, 'Inter');
    assert.equal(readme.headingFamily, 'Inter');
    assert.deepEqual([readme.body, readme.line], [16, 26], 'the README is 16 on 26');
    near(readme.chars, 80, 'the README column is 80 characters, the clamp edge, not 84');
    assert.equal(readme.h1, 31, 'headings are sized from the README body (16 x 1.25^3), not the reader 20');

    const report = await open(page, '/r/plan.md');
    assert.equal(report.kind, 'report');
    assert.equal(report.family, 'Atkinson Hyperlegible Next');
    assert.deepEqual([report.body, report.line], [17, 26], 'the report is 17 on 26');
    near(report.chars, 74, 'the report column, in average characters');

    const changelog = await open(page, '/r/CHANGELOG.md');
    assert.equal(changelog.kind, 'changelog');
    assert.equal(changelog.family, 'Literata', 'a kind with no profile keeps the text face');
    assert.deepEqual([changelog.body, changelog.line], [20, 30]);
    near(changelog.chars, 66, 'and its measure');
    near(changelog.column, 66 * 0.463 * 20, 'and its column in pixels');
  }));

test('the profiles hold in Paper as in Night', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/README.md'] });
    await page.evaluate(() => document.documentElement.setAttribute('data-marxy-variant', 'light'));
    const readme = await metrics(page);
    assert.deepEqual([readme.family, readme.body, readme.line], ['Inter', 16, 26]);
    const report = await open(page, '/r/plan.md');
    assert.deepEqual([report.family, report.body, report.line], ['Atkinson Hyperlegible Next', 17, 26]);
  }));

test('a profile is a multiple of the reader size: at two reader sizes the sizes follow and every line box is whole and even', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/README.md'] });
    for (const size of [16, 24]) {
      await readerSize(page, size);
      for (const [path, ratio, face] of [['/r/README.md', 0.8, 'Inter'], ['/r/plan.md', 0.85, 'Atkinson Hyperlegible Next']]) {
        const m = await open(page, path);
        assert.equal(m.family, face);
        near(m.body, ratio * size, `${path} body at reader size ${size}`);
        assert.ok(Number.isInteger(m.line) && m.line % 2 === 0, `${path} line box ${m.line} is a whole even pixel at reader size ${size}`);
        assert.ok(Number.isInteger(m.lineCode) && m.lineCode % 2 === 0, `${path} code line box ${m.lineCode} is a whole even pixel`);
        near(m.chars, path.endsWith('README.md') ? 80 : 74, `${path} holds its characters at reader size ${size}`);
      }
    }
  }));

test('one [data-marxy-kind="report"] measure of 120 is clamped to 80 characters at the body size, and the count holds at two reader sizes (the em of the repeated measure)', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/plan.md'] });
    await page.addStyleTag({ content: '[data-marxy-kind="report"] { --marxy-measure-chars: 120; }' });
    const seen = [];
    for (const size of [18, 26]) {
      await readerSize(page, size);
      const m = await metrics(page);
      near(m.chars, 80, `the column in average characters at reader size ${size}`, 0.3);
      seen.push(m.chars);
    }
    near(seen[0], seen[1], 'the width in characters at the two sizes', 0.01);
    // 120 is held by the clamp's own ceiling, which is written in em; a measure inside the clamp is the one that
    // proves the repeated declaration's em is the pane's body size.
    await page.addStyleTag({ content: '[data-marxy-kind="report"] { --marxy-measure-chars: 60; }' });
    for (const size of [18, 26]) {
      await readerSize(page, size);
      near((await metrics(page)).chars, 60, `a 60-character measure at reader size ${size}`, 0.3);
    }
  }));

test('a profile does not restyle Source: the editor mount takes the reader sizes back', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/README.md'] });
    const sizes = await page.evaluate(() => {
      const mount = document.querySelector('section.marxy-pane .marxy-source-mount');
      const root = getComputedStyle(document.documentElement);
      const here = getComputedStyle(mount);
      const names = ['--marxy-size-body', '--marxy-size-code', '--marxy-size-caption', '--marxy-line-box', '--marxy-line-box-code'];
      return { names, mount: names.map((n) => here.getPropertyValue(n).trim()), root: names.map((n) => root.getPropertyValue(n).trim()) };
    });
    assert.deepEqual(sizes.mount, sizes.root, `Source reads ${sizes.names.join(', ')} as the root does`);
  }));
