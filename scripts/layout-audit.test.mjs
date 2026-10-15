// X-32: the layout audit's argument handling, its report, and its detectors on small pages (WebKit, no Vite, no app).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { webkit } from 'playwright';
import { ALLOW, auditInPage, fold, markdown, parseArgs } from './layout-audit.mjs';
import { launchWebkit } from './playwright-webkit.mjs';

// The fast job has no WebKit; browser tests skip there unless they are required (as in probe-layout.test.mjs).
const skip =
  !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
    ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
    : false;

test('arguments: the full matrix is the default, --quick is one variant at two widths and one height', () => {
  const full = parseArgs([]);
  assert.deepEqual(full.widths, [800, 1000, 1400, 1920]);
  assert.deepEqual(full.heights, [600, 900]);
  assert.deepEqual(full.themes, ['night', 'paper']);
  const quick = parseArgs(['--quick', '--only', 'Palette,menu-kind-chip']);
  assert.deepEqual([quick.themes, quick.widths, quick.heights, quick.only], [['night'], [800, 1920], [600], ['Palette', 'menu-kind-chip']]);
  assert.throws(() => parseArgs(['--theme', 'sepia']), /unknown theme/);
  assert.throws(() => parseArgs(['--widths', '0']), /bad size/);
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
});

test('the report folds cells into one row per defect and counts boarded ones apart', () => {
  const f = { kind: 'clipped', sel: 'a > b', text: 'hello', rect: [0, 0, 1, 1] };
  const cell = (size, findings) => ({ size, findings, texts: 10, suppressed: {} });
  const folded = fold([
    { surface: 's1', group: 'Menus', theme: 'night', errors: [], cells: [cell([800, 600], [f]), cell([1400, 900], [f])] },
    { surface: 's1', group: 'Menus', theme: 'paper', errors: [], cells: [cell([800, 600], [f, { ...f, kind: 'spills', known: 'F-98' }])], skipped: undefined },
  ]);
  assert.equal(folded.list.length, 2);
  const row = folded.list.find((r) => r.kind === 'clipped');
  assert.deepEqual([row.at, row.themes], [['800x600', '1400x900'], ['night', 'paper']]);
  assert.deepEqual(folded.counts, { Menus: 1 });
  const md = markdown(folded, { cells: 3, seconds: 1, surfaces: 1 });
  assert.match(md, /^# Layout audit: 1 defects, 1 already boarded/);
  assert.match(md, /## Already boarded[\s\S]*F-98/);
});

/** Audits `html` in a 800x600 window and returns the findings as `kind:text` strings. */
async function audit(browser, html, allow = []) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  try {
    await page.setContent(`<!doctype html><html><body style="margin:0;font:16px/20px sans-serif">${html}</body></html>`);
    const { findings } = await page.evaluate(auditInPage, { allow });
    return findings.map((f) => `${f.kind}:${f.text.split(' ')[0]}`).sort();
  } finally {
    await page.close();
  }
}

test('the detectors flag what floats and leave what is by design', { skip }, async () => {
  const browser = await launchWebkit();
  try {
    // Flagged
    assert.deepEqual(await audit(browser, '<div style="width:60px;overflow:hidden;white-space:nowrap">Cutmidglyph wide text</div>'), ['clipped:Cutmidglyph']);
    assert.deepEqual(await audit(browser, '<div style="width:60px;white-space:nowrap">Spillsoutofitsbox</div>'), ['spills:Spillsoutofitsbox']);
    assert.deepEqual(await audit(browser, '<div style="width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Truncated without a reveal</div>'), ['truncated:Truncated']);
    assert.deepEqual(await audit(browser, '<div style="position:fixed;left:790px;top:10px">Offscreen</div>'), ['outside:Offscreen']);
    assert.deepEqual(await audit(browser, '<div style="position:absolute;left:10px;top:10px">First</div><div style="position:absolute;left:12px;top:12px">Second</div>'), ['overlap:First']);
    assert.deepEqual(await audit(browser, '<div style="position:absolute;left:10px;top:10px">Under</div><div style="position:absolute;left:0;top:0;width:200px;height:60px;background:rgba(0,0,0,.4)"></div>'), ['covered:Under']);
    // By design
    assert.deepEqual(await audit(browser, '<div style="width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="Full name">Truncated with a reveal</div>'), [], 'an ellipsis with a title');
    assert.deepEqual(await audit(browser, '<div style="width:60px;overflow:auto;white-space:nowrap">Scrolled to read, not cut</div>'), [], 'a scroller');
    assert.deepEqual(await audit(browser, '<div style="height:40px;overflow:auto"><p style="margin:0 0 800px">Seen</p><p>Scrolled away</p></div>'), [], 'text a scroller has scrolled out of view');
    assert.deepEqual(await audit(browser, '<span style="position:absolute;width:1px;height:1px;overflow:visible;clip-path:inset(50%);white-space:nowrap">Visually hidden label</span>'), [], 'visually hidden text');
    assert.deepEqual(await audit(browser, '<div style="padding-left:30px;text-indent:-30px">Hanging indent that wraps onto a second line when it is long enough to need one, as a list does.</div>'), [], 'a hanging indent');
    // Opaque over text is a menu over the page: pruned by the allowlist, counted not hidden
    const over = '<div style="position:absolute;left:10px;top:10px">Under</div><div class="menu" style="position:absolute;left:0;top:0;width:200px;height:60px;background:#000"></div>';
    assert.deepEqual(await audit(browser, over), ['covered:Under']);
    assert.deepEqual(await audit(browser, over, [{ kind: 'covered', cover: '.menu', why: 'test' }]), []);
  } finally {
    await browser.close();
  }
});

test('the allowlist says why for every entry', () => {
  assert.ok(ALLOW.length > 0);
  for (const a of ALLOW) assert.ok(a.kind && a.why && (a.within || a.cover), JSON.stringify(a));
});
