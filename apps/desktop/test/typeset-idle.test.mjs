// A page whose paragraphs are all set stays as it is: at rest, and through a scroll down the whole page and
// back, the typesetter sets no paragraph again. What is counted is structural, not a time: the mutations the
// typesetter makes (its breaks, hang spans and the set class) inside the article, after every paragraph was
// set. One paragraph set again is some twenty of them, so the bound is under one. WebKit, over the shipped
// skeleton and the memory shell.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { after, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { closeHarness, harnessBase, routeSkeleton } from './support/two-pane.mjs';
import { frames, openBrowser, scrollSettled } from './support/kit.mjs';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 400_000 }, fn);
after(() => closeHarness());

/** Fewer than one paragraph's worth of the typesetter's writes. */
const MOST_WRITES = 10;

/** Prose of about `kb` KB with lists, quotes and code among it. */
function markdown(kb) {
  const words = 'the reader keeps a place on the page while paragraphs are set line by line and hyphenation balances the rag across ordinary prose'.split(' ');
  let seed = 11;
  const rnd = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  const sentence = () => {
    const w = Array.from({ length: 8 + rnd(16) }, () => words[rnd(words.length)]).join(' ');
    return `${w[0].toUpperCase()}${w.slice(1)}.`;
  };
  const out = [];
  let bytes = 0;
  for (let n = 0; bytes < kb * 1024; n++) {
    const block = n % 30 === 0 ? `## Part ${n / 30 + 1}`
      : n % 13 === 0 ? `- ${sentence()}\n- ${sentence()} ${sentence()}`
      : n % 19 === 0 ? `> ${sentence()} ${sentence()} ${sentence()}`
      : n % 23 === 0 ? '```js\nconst x = 1;\n```'
      : Array.from({ length: 3 + rnd(4) }, sentence).join(' ');
    out.push(block);
    bytes += block.length + 2;
  }
  return `${out.join('\n\n')}\n`;
}

/** In the page: counts the typesetter's writes in the article from now until `stop()`. */
const WATCH = () => {
  const doc = document.querySelector('#doc');
  const typesetting = (node) => node.nodeType === 1 && /\bmarxy-(lb|hang|hyphen)\b/.test(node.className);
  const state = { writes: 0, paragraphs: new Set() };
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      const ours = r.type === 'attributes'
        ? r.attributeName === 'class' && (el.classList.contains('marxy-set') !== (r.oldValue ?? '').split(' ').includes('marxy-set'))
        : [...r.addedNodes, ...r.removedNodes].some(typesetting) || (r.type === 'characterData' && el?.closest('.marxy-set') != null);
      if (!ours) continue;
      state.writes++;
      const p = el?.closest('p, li, dd, figcaption');
      if (p) state.paragraphs.add(p);
    }
  });
  observer.observe(doc, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  window.__typesetWrites = () => {
    observer.disconnect();
    return { writes: state.writes, paragraphs: state.paragraphs.size };
  };
};

/** Boots the app on `text` as a Markdown file and waits for its last chunk. */
async function openMarkdown(page, text) {
  const base = await harnessBase();
  await routeSkeleton(page, base);
  await page.goto(`${base}app.html`);
  await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
  return page.evaluate(async (text) => {
    const path = '/r/idle.md';
    const { createMemoryShell } = await import('/src/shell/memory.ts');
    const { startApp } = await import('/src/app.ts');
    const shell = createMemoryShell({ [path]: new TextEncoder().encode(text) });
    window.__typesetDone = false;
    const mark = shell.mark.bind(shell);
    shell.mark = async (name, t, data) => {
      if (name === 'typeset_done') window.__typesetDone = true;
      return mark(name, t, data);
    };
    const handle = await startApp(shell, { argv: [path] });
    await handle.ready;
    await handle.contentComplete();
    return { paragraphs: document.querySelectorAll('#doc p').length };
  }, text);
}

test('a page whose paragraphs are all set sets none again at rest or through a scroll down and back', async () => {
  const browser = await openBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const opened = await openMarkdown(page, markdown(120));
    await page.waitForFunction(() => window.__typesetDone, null, { timeout: 300_000, polling: 250 });
    await page.evaluate(() => document.fonts.ready);
    const set = await page.evaluate(() => document.querySelectorAll('#doc .marxy-set').length);
    assert.ok(set > 100, `${set} of ${opened.paragraphs} paragraphs set`);

    await page.evaluate(WATCH);
    // The window the typesetter is watched through is counted in painted frames, not in time.
    await frames(page, 120);
    const idle = await page.evaluate(() => window.__typesetWrites());
    assert.ok(idle.writes <= MOST_WRITES, `at rest the typesetter wrote ${idle.writes} times into ${idle.paragraphs} paragraphs`);

    await page.mouse.move(640, 450);
    await page.evaluate(WATCH);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 600) {
      await page.mouse.wheel(0, 600);
      await frames(page, 1);
    }
    for (let y = height; y > 0; y -= 1200) {
      await page.mouse.wheel(0, -1200);
      await frames(page, 1);
    }
    await scrollSettled(page);
    await frames(page, 90);
    const scrolled = await page.evaluate(() => window.__typesetWrites());
    assert.ok(scrolled.writes <= MOST_WRITES, `through the scroll the typesetter wrote ${scrolled.writes} times into ${scrolled.paragraphs} paragraphs`);
  } finally {
    await browser.close();
  }
});

// A jump lands on paragraphs the idle chunks have not reached: the observer sets what is on screen in the task the
// screen first shows them, and leaves most of its margin to the queue. A screen and a half back up at once, those
// paragraphs of the margin are on screen before the idle chunks can have set them: they are set as they arrive.
test('End on a large page still being set, then back up: the paragraphs on screen are set within two frames', async () => {
  const browser = await openBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await openMarkdown(page, markdown(1024));
    const pending = await page.evaluate(() => [...document.querySelectorAll('#doc > p')].filter((p) => !p.classList.contains('marxy-set')).length);
    assert.ok(pending > 500, `${pending} paragraphs still to set when the jump is made`);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('End');
    const r = await page.evaluate(async () => {
      const frame = () => new Promise((res) => requestAnimationFrame(res));
      const d = document.documentElement;
      // The jump has landed when the page stops moving for a frame.
      let at = -1;
      while (at !== d.scrollTop) {
        at = d.scrollTop;
        await frame();
      }
      d.scrollTop -= innerHeight * 1.5;
      await frame();
      await frame();
      const lineBox = parseFloat(getComputedStyle(document.querySelector('#doc')).lineHeight);
      const onScreen = [...document.querySelectorAll('#doc > p')].filter((p) => {
        const r = p.getBoundingClientRect();
        return r.bottom > 0 && r.top < innerHeight && r.height > lineBox * 1.5;
      });
      return { scrollTop: d.scrollTop, onScreen: onScreen.length, unset: onScreen.filter((p) => !p.classList.contains('marxy-set')).length };
    });
    assert.ok(r.scrollTop > 100_000, `the page jumped to ${r.scrollTop}`);
    assert.ok(r.onScreen > 2, `${r.onScreen} paragraphs of more than one line on screen`);
    assert.equal(r.unset, 0, `${r.unset} of the ${r.onScreen} paragraphs on screen are not set two frames after the scroll back`);
  } finally {
    await browser.close();
  }
});
