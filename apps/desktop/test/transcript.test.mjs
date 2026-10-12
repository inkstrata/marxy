// A Markdown transcript (K-11; ADR-0060, Reader Artifacts 10-spec "Speaker labels"): each speaker heading is an
// outdented small-capitals label left of its turn, the text column keeps its own left edge, exchanges are 30 px
// apart and paragraphs within a turn 15. The labels are still headings with their own text. The app boots on the
// shipped skeleton and its inline default theme over the memory shell, so these are the rules the app ships.
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

const chat = readFileSync(new URL('../../../fixtures/corpus/34-chat-transcript.md', import.meta.url), 'utf8');
const prose = '# Title\n\nA paragraph of plain prose, long enough to be a document and no more than that.\n\n## You\n\nA second paragraph under a heading that is only a heading in an article.\n';
const files = { '/r/chat.md': chat, '/r/essay.md': prose };

async function withPage(width, fn) {
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await fn(page);
  } finally {
    await browser.close();
  }
}

const open = async (page, path) => {
  await page.evaluate((p) => window.__marxyHandle.open(p), path);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};

/** The geometry of a pane's article: the speaker labels, their first paragraph, the article's content edge, the gaps. */
const geometry = (page) =>
  page.evaluate(() => {
    const article = document.getElementById('doc');
    const box = (el) => el.getBoundingClientRect();
    const cs = getComputedStyle(article);
    const contentLeft = box(article).left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
    const labels = [...article.querySelectorAll('[data-marxy-speaker]')];
    const first = labels[0];
    const text = first.nextElementSibling;
    const labelCs = getComputedStyle(first);
    // The vertical gaps: the last block of a turn to the next label, and paragraph to paragraph in the first turn.
    const second = text.nextElementSibling;
    const next = labels[1];
    return {
      kind: article.closest('section.marxy-pane').getAttribute('data-marxy-kind'),
      tags: labels.map((l) => l.tagName),
      texts: labels.map((l) => l.textContent),
      roles: labels.map((l) => l.getAttribute('data-marxy-speaker')),
      labelLeft: box(first).left,
      labelRight: box(first).right,
      labelTop: box(first).top,
      textLeft: box(text).left,
      textTop: box(text).top,
      contentLeft,
      textWidth: box(text).width,
      paragraphGap: box(second).top - box(text).bottom,
      exchangeGap: box(next).top - box(next.previousElementSibling).bottom,
      caps: labelCs.fontVariantCaps,
      color: labelCs.color,
      bodyColor: getComputedStyle(text).color,
      labelWeights: labels.map((l) => getComputedStyle(l).fontWeight),
    };
  });

test('a transcript hangs each speaker label left of its turn, and the text column keeps its own left edge', () =>
  withPage(1470, async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/chat.md'] });
    const g = await geometry(page);
    assert.equal(g.kind, 'transcript');
    assert.ok(g.labelLeft < g.textLeft - 40, `the label (${g.labelLeft}) sits left of the text (${g.textLeft})`);
    assert.ok(g.labelRight <= g.textLeft, `and does not reach it (${g.labelRight})`);
    assert.ok(Math.abs(g.textLeft - g.contentLeft) < 0.5, `the text starts at the article's own content edge (${g.textLeft} vs ${g.contentLeft}), as an article's paragraph does`);
    assert.ok(Math.abs(g.labelTop - g.textTop) < 1, 'the label is on the first line of its turn');
    assert.equal(g.caps, 'all-small-caps');
    assert.equal(g.color, g.bodyColor, 'colour never carries the speaker');
  }));

test('the labels are still headings with their own text, and exchanges and paragraphs are spaced 30 and 15', () =>
  withPage(1470, async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/chat.md'] });
    const g = await geometry(page);
    assert.deepEqual(g.tags.slice(0, 4), ['H2', 'H2', 'H3', 'H3']);
    assert.deepEqual(g.texts.slice(0, 3), ['You', 'Assistant', 'Tool · bash']);
    assert.deepEqual(g.roles.slice(0, 3), ['you', 'assistant', 'tool']);
    assert.equal(g.paragraphGap, 15, 'paragraphs within a turn');
    assert.equal(g.exchangeGap, 30, 'turns');
    assert.ok(Number(g.labelWeights[0]) > Number(g.labelWeights[1]), `your label is heavier (${g.labelWeights.slice(0, 2)})`);
  }));

test('a narrow pane stands the label above its turn; an article with a heading called You is untouched', () =>
  withPage(560, async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/chat.md'] });
    const g = await geometry(page);
    assert.ok(Math.abs(g.labelLeft - g.textLeft) < 0.5, 'the label shares the text edge');
    assert.ok(g.labelTop < g.textTop, 'and stands above it');
    await open(page, '/r/essay.md');
    const a = await page.evaluate(() => {
      const article = document.getElementById('doc');
      const h = article.querySelector('h2');
      return { kind: article.closest('section.marxy-pane').getAttribute('data-marxy-kind'), speaker: h.getAttribute('data-marxy-speaker'), caps: getComputedStyle(h).fontVariantCaps };
    });
    assert.deepEqual(a, { kind: 'article', speaker: 'you', caps: 'normal' }, 'the attribute is everywhere; only the transcript profile styles it');
  }));
