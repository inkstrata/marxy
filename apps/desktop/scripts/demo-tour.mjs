// The demo build, end to end: `pnpm build:demo`, `pnpm preview:demo`, then `node scripts/demo-tour.mjs [url] [shots-dir]`.
// Each step prints PASS or FAIL with what it checked, and any page error is listed at the end; the exit code is the number
// of failures. Chromium by default; MARXY_TOUR_CHANNEL=msedge (or chrome) drives an installed browser instead.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:4173/';
const dir = process.argv[3] ?? join(tmpdir(), 'marxy-demo-tour');
mkdirSync(dir, { recursive: true });
const S = join(dir, 'tour');
// Playwright's own Chromium when it is installed, else a Chromium the system has.
async function launch() {
  const channels = process.env.MARXY_TOUR_CHANNEL ? [process.env.MARXY_TOUR_CHANNEL] : [undefined, 'msedge', 'chrome'];
  let last;
  for (const channel of channels) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (error) {
      last = error;
    }
  }
  throw last;
}
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/New_York' });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`[console] ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
const wait = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);
const results = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` · ${detail}` : ''}`); };
const open = async (path) => {
  await ev((p) => window.marxy.handle.open(`/demo/${p}`), path);
  await wait(900);
};

// The left section's drawer shows one panel; a card is read after its panel is shown. Clicking the shown panel's icon shuts
// the drawer, so the icon is clicked only when the drawer is not already showing that panel.
const showLeft = async (id) => {
  const name = id[0].toUpperCase() + id.slice(1);
  const shown = await ev((id) => document.body.getAttribute('data-marxy-drawer') !== 'closed' && document.querySelector('.marxy-drawer')?.dataset.marxyLeft === id, id);
  if (!shown) await page.click(`.marxy-rail .marxy-l-rb[aria-label="${name}"]`);
  await page.waitForFunction((id) => document.querySelector('.marxy-drawer')?.dataset.marxyLeft === id && !!document.querySelector('.marxy-drawer .marxy-l-body'), id, { timeout: 8000 }).catch(() => {});
};
const cardTitles = async (...panels) => {
  const out = [];
  for (const id of panels) {
    await showLeft(id);
    out.push(...(await ev(() => [...document.querySelectorAll('.marxy-drawer .marxy-card-head span')].map((s) => s.textContent))));
  }
  return out;
};

await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => window.marxy?.handle, null, { timeout: 15000 });
await wait(1000);

check('frame: rail, head, drawer', await ev(() => !!document.querySelector('.marxy-rail .marxy-l-rb') && !!document.querySelector('.marxy-head') && !!document.querySelector('.marxy-drawer')));
check('page: the plan is set with its heading', await ev(() => document.querySelector('.marxy-article h1')?.textContent.includes('Postgres 14')));
check('panel: Outline card', (await cardTitles('outline')).includes('Outline'));
await page.screenshot({ path: `${S}-1-plan.png` });

for (const [file, id] of [['data/release.json', 'tree'], ['data/ci.yaml', 'tree'], ['tidemark/tidemark.toml', 'tree'], ['tidemark/docs/releases.xml', 'tree'], ['data/index-runs.jsonl', 'records'], ['data/p95-latency.csv', 'table'], ['reading/tide-table.txt', 'verse'], ['tidemark/NOTES', 'prose']]) {
  await open(file);
  check(`reading: ${file} as ${id}`, await ev((want) => document.querySelector('.marxy-article [data-marxy-reading]')?.getAttribute('data-marxy-reading') === want, id));
}
await open('data/p95-latency.csv');
await page.click('th[data-marxy-sort="3"]');
await wait(200);
check('table: a column name sorts the rows', await ev(() => document.querySelector('th[aria-sort]')?.getAttribute('aria-sort') === 'descending' && /Sorted by/.test(document.querySelector('[data-marxy-sort-note]').textContent)));
await page.screenshot({ path: `${S}-2-csv.png` });

await open('handoffs/auth-refactor-handoff.md');
check('parts: a fence that opens with a prompt reads as a session', await ev(() => document.querySelector('.marxy-article pre[data-marxy-part="session"]')?.querySelectorAll('.marxy-term-prompt').length === 2));
await showLeft('metadata');
check('parts: the Reading card names the parts by line', await ev(() => document.querySelector('.marxy-drawer [data-marxy-card="reading"] .marxy-card-line')?.textContent === 'Read as prose + session' && /Lines 20 to 27\s*session · guessed/.test(document.querySelector('.marxy-parts')?.textContent ?? '')));
// In view first: the menu closes on a scroll, and a click that scrolls to its target would close it as it opens.
await ev(() => document.querySelector('.marxy-article pre[data-marxy-part="session"]')?.scrollIntoView({ block: 'center' }));
await wait(300);
await page.click('.marxy-article pre[data-marxy-part="session"]', { button: 'right' });
await wait(300);
check('parts: the block menu offers Read this part another way', await ev(() => /Read this part another way\s*terminal session/.test(document.querySelector('.marxy-verb-menu-item[data-row-key="view.read-part"]')?.textContent ?? '')));
await page.screenshot({ path: `${S}-2-parts-menu.png` });
await page.click('.marxy-verb-menu-item[data-row-key="view.read-part"]');
await wait(200);
await page.click('.marxy-verb-menu-item[data-row-key="part.read-as.written"]');
await wait(700);
check('parts: read as written, the part is set again without prompts', await ev(() => { const pre = document.querySelector('.marxy-article pre[data-marxy-part]'); return pre?.dataset.marxyPart === 'written' && pre.querySelectorAll('.marxy-term-prompt').length === 0 && /as written · yours/.test(document.querySelector('.marxy-parts')?.textContent ?? ''); }));
await open('handoffs/release-0.5-handoff.md');
check('parts: a JSON fence reads as a data tree, at the file’s bytes', await ev(async () => {
  const part = document.querySelector('.marxy-article .marxy-part[data-marxy-part="data"]');
  const row = part?.querySelector('[data-marxy-reading="tree"] [data-marxy-s]');
  if (!row) return false;
  const bytes = await window.marxy.shell.readFile('/demo/handoffs/release-0.5-handoff.md');
  return new TextDecoder().decode(bytes.subarray(Number(row.getAttribute('data-marxy-s')), Number(row.getAttribute('data-marxy-e')))) === '"tidemark"';
}));
check('parts: the Reading card says prose + data + session', await ev(() => document.querySelector('.marxy-drawer [data-marxy-card="reading"] .marxy-card-line')?.textContent === 'Read as prose + data + session'));
await ev(() => document.querySelector('.marxy-article .marxy-part')?.scrollIntoView({ block: 'start' }));
await wait(200);
await page.screenshot({ path: `${S}-2-parts-data.png` });

await open('patches/pg16-plan-tldr.diff');
await wait(800);
check('diff: changed words are marked', await ev(() => document.querySelectorAll('.marxy-diff-add-word').length > 0 && document.querySelectorAll('.marxy-diff-del-word').length > 0));

await open('logs/build-2026-10-14.log');
check('log: Levels card', (await cardTitles('outline')).includes('Levels'));
const zone = await page.$('button[role="radio"]:has-text("in your zone")');
if (zone) await zone.click();
await wait(400);
check('log: times in your zone', await ev(() => document.querySelector('.marxy-log-time')?.dataset.marxyShown === '12:02:11.402'));
await page.screenshot({ path: `${S}-3-log.png` });
check('log: the page has its heading, the pauses and the escape code drawn as the warning tone, its account in the fold', await ev(() =>
  document.querySelector('.marxy-log-day')?.dataset.marxyDay === 'Wednesday, 14 October 2026'
  && [...document.querySelectorAll('.marxy-line[data-marxy-gap]')].map((l) => l.dataset.marxyGap).join() === '+36 s,+15 s,+6 s,+6 s'
  && document.querySelector('.marxy-ansi-warn')?.textContent === 'indexer'
  && /^The file colours text/.test(document.querySelector('.marxy-log-account .marxy-account-body p')?.textContent ?? '')));
await page.keyboard.press('Control+Shift+P');
await wait(300);
await page.keyboard.type('Filter by level');
await wait(300);
await page.keyboard.press('Enter');
await wait(400);
await page.click('[data-row-key="log.level.warn"]');
await wait(800);
check('log: Filter by level to Warn shows WARN and ERROR, and a line of words for each run it hides', await ev(() => {
  const shown = [...document.querySelectorAll('.marxy-article .marxy-line[data-marxy-rank]')].filter((l) => l.getClientRects().length > 0);
  return shown.map((l) => l.dataset.marxyRank).join() === '2,3' && document.querySelectorAll('.marxy-log-hidden-run').length === 3;
}));
await page.screenshot({ path: `${S}-3-log-warn.png` });

// An image is a page, a file with no reading a card with its bytes beside it.
await open('images/harbour-at-low-water.jpg');
await page.waitForFunction(() => (document.querySelector('.marxy-imgpic')?.naturalWidth ?? 0) > 0, null, { timeout: 10000 }).catch(() => {});
const imageCards = await cardTitles('metadata', 'outline', 'links');
check('image: a photo to fit, its folder in a strip, Image and EXIF in the panel', (await ev(() => document.querySelector('.marxy-imgbar-pos')?.textContent === '4 of 8 in images/' && document.querySelectorAll('.marxy-imgstrip .marxy-imgthumb').length === 8)) && imageCards.includes('Image') && imageCards.includes('EXIF'), imageCards.join(', '));
await page.screenshot({ path: `${S}-5-image.png` });
await page.click('.marxy-imgstage');
await page.keyboard.press('ArrowRight');
await wait(900);
check('image: → steps to the next image in the tab, and a HEIC falls to the card that says why', await ev(() => document.querySelector('.marxy-drawer .marxy-l-subject')?.textContent === 'IMG_0417.heic' && document.querySelector('.marxy-fcard-kicker')?.textContent === 'An image this system cannot draw'));
await open('downloads/IMG_2231');
check('image: a WebP with no extension is read from its bytes, and the head says it guessed', await ev(() => document.querySelector('.marxy-guess')?.textContent === 'image · guessed' && !!document.querySelector('.marxy-imgpage')));
await open('lab/disk-2026-10.img');
await page.click('.marxy-hexbar-end');
await wait(600);
check('floor: a 2 GB disk image is a card, and its bytes reach the last one', await ev(() => [...document.querySelectorAll('.marxy-hexrow .marxy-hex-o')].some((e) => e.textContent === '7FFFFFF0') && document.querySelector('.marxy-hexrow i[data-marxy-on]')?.textContent === '00' && /2,147,483,648 bytes/.test(document.querySelector('.marxy-fcard')?.textContent ?? '')));
await page.screenshot({ path: `${S}-5-disk.png` });

await open('plans/pg16-upgrade-plan.md');
await ev(() => document.activeElement?.blur());
const y0 = await ev(() => document.documentElement.scrollTop);
await page.keyboard.press('Space');
await wait(200);
check('Turn the page: Space moves a screen less two lines', (await ev(() => document.documentElement.scrollTop)) > y0 && (await ev(() => document.querySelectorAll('.marxy-carry').length)) === 1);
check('Shape as the scrollbar: drawn', await ev(() => { const m = document.querySelector('.marxy-mmap'); return !!m && !m.hidden && m.querySelectorAll('i').length > 5; }));
await ev(() => window.scrollTo(0, 0));
await wait(200);
check('Notes where you read: with room, the note sits in the margin beside its line', await ev(() => {
  const note = document.querySelector('.marxy-article > .marxy-note-margin');
  const ref = document.querySelector('sup.marxy-footnote-ref');
  return !!note && !!ref && Math.abs(note.getBoundingClientRect().top - ref.getBoundingClientRect().top) < 40;
}));
await page.setViewportSize({ width: 1000, height: 900 });
await wait(400);
await page.click('sup.marxy-footnote-ref a');
await wait(300);
check('Notes where you read: without room, the note opens under its line', await ev(() => !!document.querySelector('.marxy-note-here') && !document.querySelector('.marxy-note-margin')));
await page.setViewportSize({ width: 1440, height: 900 });
await wait(300);

await page.keyboard.press('Control+,');
await wait(600);
check('Settings: twelve proposals', (await ev(() => document.querySelectorAll('[data-marxy-setting^="proposals."]').length)) === 12);
await page.click('[data-marxy-control="proposals.glance"]');
await wait(700);
check('Settings: a switch writes config.toml', /proposals = \{ glance = true \}/.test(await ev(async () => new TextDecoder().decode(await window.marxy.shell.readFile((await window.marxy.shell.configPaths()).config)))));
await page.screenshot({ path: `${S}-4-settings.png` });

await ev(async () => {
  const h = window.marxy.handle;
  const cmd = h.commands().find((c) => c.id === 'document.export');
  // Export's command reads nothing from its context.
  await cmd.run({});
});
await wait(600);
check('Export: the panel opens with a web page chosen', await ev(() => !!document.querySelector('.marxy-drawer [data-marxy-left-row="a:html"] .marxy-l-rd.marxy-l-on')));
await page.keyboard.press('Escape');

console.log(results.join('\n'));
console.log(problems.length ? problems.join('\n') : 'no page errors');
console.log(`shots in ${dir}`);
await browser.close();
process.exit(results.filter((r) => r.startsWith('FAIL')).length + problems.length);
