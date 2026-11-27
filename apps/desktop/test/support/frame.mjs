// The frame in WebKit: the whole app, booted through `bootApplication` on the shipped skeleton over the
// memory shell (two-pane.mjs), with config.toml at `/config` and frame.json under `/data`. The helpers read the frame
// as the reader sees it: the rail, the drawer and its panels, the window's tabs, and the cards the panels hold.
import { existsSync } from 'node:fs';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../../scripts/playwright-webkit.mjs';
import { bootTwoPanes } from './two-pane.mjs';

export const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;

/** frame.json's text holding `frame` (core layout/frame-storage.ts), for a test that starts from a saved frame. */
export const frameFile = (frame) => `${JSON.stringify({ version: 1, frame }, null, 2)}\n`;

/**
 * Boots the app on `files` with `open[0]` (and `open[1]` beside it), waits for the panel's cards, and runs
 * `fn(page, { mod, errors })`. `mod` is the platform's Mod key as Playwright presses it; `errors` collects page errors,
 * and any left at the end fail the test.
 */
export async function withFrame({ files, open, config, frame, viewport = { width: 1440, height: 900 }, media, sparse, launch = launchWebkit }, fn) {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport });
    if (media) await page.emulateMedia(media);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const all = { ...files };
    if (config !== undefined) all['/config'] = config;
    if (frame !== undefined) all['/data/frame.json'] = frameFile(frame);
    await bootTwoPanes(page, { files: all, open, full: true, sparse });
    // The left section draws its panel only where the drawer shows: docked, its head is there before the test begins.
    await page.waitForFunction(() => document.querySelector('.marxy-rail .marxy-l-rb') && (document.body.getAttribute('data-marxy-drawer') !== 'docked' || document.querySelector('.marxy-drawer .marxy-l-body[data-marxy-left], .marxy-drawer[data-marxy-branch]')));
    const mod = (await page.evaluate(() => navigator.platform)) === 'MacIntel' ? 'Meta' : 'Control';
    await fn(page, { mod, errors });
    if (errors.length > 0) throw new Error(`page errors: ${errors.join(' | ')}`);
  } finally {
    await browser.close();
  }
}

/**
 * The window's one row of tabs, left to right: name, active, glance, and whether it shows its pair mark.
 * `active` is the row's current tab (the one the focused pane shows), or with `slot` the tab that pane shows.
 */
export const tabsOf = (page, slot) =>
  page.evaluate(
    (slot) =>
      [...document.querySelectorAll('.marxy-tabbar .marxy-tab')].map((t) => ({
        name: t.querySelector('.marxy-tab-name').textContent,
        active: slot === undefined ? t.getAttribute('aria-selected') === 'true' : window.__marxyHandle.panes().panes[slot]?.path() === t.dataset.marxyTabPath,
        glance: t.hasAttribute('data-marxy-glance'),
        paired: t.querySelector('.marxy-tab-pair') !== null,
      })),
    slot,
  );

/** The names of the row's tabs, the current one (or the one pane `slot` shows) starred. */
export const rowOf = async (page, slot) => (await tabsOf(page, slot)).map((t) => `${t.name}${t.active ? '*' : ''}`);

/** The row's tabs as marks: `*` the current one, `+` one another pane shows. */
export const marksOf = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.marxy-tabbar .marxy-tab')].map((t) => `${t.querySelector('.marxy-tab-name').textContent}${t.getAttribute('aria-selected') === 'true' ? '*' : t.hasAttribute('data-marxy-visible') ? '+' : ''}`),
  );

/** What each pane shows now, left to right. */
export const pathsShown = (page) => page.evaluate(() => window.__marxyHandle.panes().panes.map((p) => p.path()));

/**
 * The left panel that holds a viewer's card since the panels were drawn as rows: its reading, facts and
 * metadata slot, a part picked (a byte, a cell, a glyph: `now-…`) and a comparison are Metadata's; its fourth card is
 * Outline's; a message's links are Links'. A text file's cards are gone: read the panels' rows (`panelHero`, `panelKvs`).
 */
export const CARD_HOME = { reading: 'metadata', notes: 'metadata', frontmatter: 'metadata', facts: 'metadata', contents: 'outline', section: 'outline', links: 'links', 'now-comparison': 'metadata' };
export const cardHome = (id) => CARD_HOME[id] ?? 'metadata';

/** Shows panel `id` in the drawer without taking the keys, and waits until its body is drawn. */
export async function showPanel(page, id) {
  await page.evaluate((id) => window.__marxyHandle.frame().left.show(id, undefined, false), id);
  await page.waitForFunction((id) => {
    const body = document.querySelector(`.marxy-drawer .marxy-l-body[data-marxy-left="${id}"]`);
    // A card panel says "Reading…" for a moment while the file's cards are made; it is not yet drawn.
    return !!body?.querySelector(':is(.marxy-l-cards, .marxy-l-empty, .marxy-l-row, .marxy-l-gh, .marxy-l-host, .marxy-l-sec)') && !/^Reading/.test(body.querySelector('.marxy-l-empty')?.textContent ?? '');
  }, id);
}

/** Shows the panel that holds card `id`; the card is then under `.marxy-drawer [data-marxy-card="<id>"]`. */
export const showCardPanel = (page, id) => showPanel(page, cardHome(id));

const readCards = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.marxy-drawer .marxy-l-cards > .marxy-card')].map((c) => ({
      id: c.dataset.marxyCard,
      title: c.querySelector('.marxy-card-head span').textContent,
      detail: c.querySelector('.marxy-card-head small')?.textContent ?? '',
    })),
  );

/**
 * The cards, as the panels now hold them: Metadata's top to bottom, then Outline's, then Links' (or only `panel`'s). It
 * shows each panel in turn and leaves the last one shown.
 */
export async function cardsOf(page, panel) {
  const out = [];
  for (const id of panel ? [panel] : ['metadata', 'outline', 'links']) {
    await showPanel(page, id);
    out.push(...(await readCards(page)));
  }
  return out;
}

/** The card with `id`'s body text (its panel shown), or null when the panel does not hold it. */
export async function cardText(page, id) {
  await showCardPanel(page, id);
  return page.evaluate((id) => document.querySelector(`.marxy-drawer [data-marxy-card="${id}"] .marxy-card-body`)?.innerText ?? null, id);
}

/** Metadata's hero: the reading in large type, the sentence under it, the guessed parts of it, and whether it is quiet (no reading). */
export async function panelHero(page) {
  await showPanel(page, 'metadata');
  return page.evaluate(() => {
    const h = document.querySelector('.marxy-drawer .marxy-l-hero');
    return h && { big: h.querySelector('.marxy-l-k1').textContent, small: h.querySelector('.marxy-l-k2').textContent, guessed: [...h.querySelectorAll('.marxy-l-k2 .marxy-l-g')].map((x) => x.textContent), none: h.classList.contains('marxy-l-none') };
  });
}

/** Panel `id`'s sections, top to bottom: each title, and its note. */
export async function panelSecs(page, id) {
  await showPanel(page, id);
  return page.evaluate(() => [...document.querySelectorAll('.marxy-drawer .marxy-l-body .marxy-l-sec')].map((s) => [s.querySelector('span').textContent, s.querySelector('em')?.textContent ?? '']));
}

/** Panel `id`'s key and value rows (The file, Written in it…), as an object by key; a repeated key keeps its first value. */
export async function panelKvs(page, id) {
  await showPanel(page, id);
  return page.evaluate(() => {
    const out = {};
    for (const kv of document.querySelectorAll('.marxy-drawer .marxy-l-body .marxy-l-kv')) {
      const k = kv.children[0].textContent;
      if (k && !(k in out)) out[k] = kv.children[1].textContent;
    }
    return out;
  });
}

/** Panel `id`'s rows the cursor rests on: key, name, quiet words and count. */
export async function panelRows(page, id) {
  await showPanel(page, id);
  return page.evaluate(() =>
    [...document.querySelectorAll('.marxy-drawer .marxy-l-body .marxy-l-prow')].map((r) => ({
      k: r.dataset.marxyLeftRow ?? '',
      name: (r.querySelector('.marxy-l-nm, .marxy-l-tx') ?? r).textContent.trim(),
      as: r.querySelector('.marxy-l-as')?.textContent ?? '',
      n: r.querySelector('.marxy-l-n')?.textContent ?? '',
    })),
  );
}

/** What the Reading card said of a text file that the hero and ladder do not (colour and tree tiers, the encoding), in Metadata. */
export async function howText(page) {
  await showPanel(page, 'metadata');
  return page.evaluate(() => document.querySelector('.marxy-drawer .marxy-l-how')?.innerText ?? null);
}

/** Panel `id`'s body as the reader reads it. */
export async function panelText(page, id) {
  await showPanel(page, id);
  return page.evaluate(() => document.querySelector('.marxy-drawer .marxy-l-body').innerText);
}

/** The frame as <body> says it is laid out: the left section's mode, the panel or branch the drawer shows, the rail's pressed button. */
export const frameNow = (page) =>
  page.evaluate(() => ({
    frame: document.body.getAttribute('data-marxy-frame'),
    drawer: document.body.getAttribute('data-marxy-drawer'),
    left: document.body.getAttribute('data-marxy-left'),
    panel: document.querySelector('.marxy-drawer')?.dataset.marxyLeft ?? null,
    branch: document.querySelector('.marxy-drawer')?.dataset.marxyBranch ?? null,
    pressed: [...document.querySelectorAll('.marxy-rail .marxy-l-rb[aria-pressed="true"]')].map((b) => b.dataset.marxyLeft),
  }));

const PANELS = ['places', 'metadata', 'outline', 'links', 'search', 'transforms', 'export', 'versions'];

/**
 * Waits until the drawer shows `id`: one of the eight panels, or `look`, `settings` or `clip` (the branches it
 * still hosts); null waits for the drawer to be shut.
 */
export const drawerShows = (page, id) =>
  page.waitForFunction(
    ({ id, panels }) => {
      const drawer = document.querySelector('.marxy-drawer');
      const shut = document.body.getAttribute('data-marxy-drawer') === 'closed' && document.body.getAttribute('data-marxy-peek') === null;
      if (id === null) return shut;
      if (shut || !drawer) return false;
      return panels.includes(id) ? drawer.dataset.marxyLeft === id && drawer.dataset.marxyBranch === undefined : drawer.dataset.marxyBranch === id;
    },
    { id, panels: PANELS },
  );


/** A file in the memory shell, as text. */
export const fileText = (page, path) => page.evaluate(async (p) => new TextDecoder().decode(await window.__marxyHandle.shell.readFile(p)), path);

/** frame.json's `frame`, once the store has written what it holds (it writes a moment after each change). */
export const savedFrame = (page) =>
  page.evaluate(async () => {
    await window.__marxyHandle.frame().store.flush();
    return JSON.parse(new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/data/frame.json'))).frame;
  });

/**
 * Drags the tab at `index` in the window's row and drops it at `to`: `{ tab }` drops on the row's tab `tab` (at its left
 * edge), `{ slot }` on that pane's page. Playwright's mouse drag starts no HTML5 drag in WebKit, so the drag's events are
 * dispatched with a real DataTransfer; the row's own listeners do the rest.
 */
export const dragTab = (page, index, to) =>
  page.evaluate(
    ({ index, to }) => {
      const dt = new DataTransfer();
      const source = document.querySelectorAll('.marxy-tabbar .marxy-tab')[index];
      const target = to.tab !== undefined
        ? document.querySelectorAll('.marxy-tabbar .marxy-tab')[to.tab]
        : document.querySelector(`[data-marxy-pane="${to.slot}"] .marxy-article`);
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const box = target.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: box.left + 3, clientY: box.top + 6 };
      target.dispatchEvent(new DragEvent('dragover', at));
      target.dispatchEvent(new DragEvent('drop', at));
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    },
    { index, to },
  );
