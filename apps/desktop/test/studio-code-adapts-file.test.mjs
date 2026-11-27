// The Studio's Code, Adapts and File tabs in WebKit. The Code tab: a language puts its file on the
// canvas and its colours in the list; the File tab shows the look's file and says which and how much; each tab's
// controls change the canvas and the look in the store.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { closeHarness } from './support/two-pane.mjs';
import { skip, withFrame } from './support/frame.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const PLAN = ['# Plan', '', 'The first paragraph of the plan, long enough to wrap at least once in a column.', '', 'A second paragraph.', ''].join('\n');
const FILES = { '/r/plans/plan.md': PLAN, '/look.toml': 'on = true\nlook = "paper"\nmode = "day"\nlean = false\n' };

const open = (page, tab) => page.evaluate(async (tab) => (await import('/src/studio/studio.ts')).openStudioSurface(tab), tab);
const store = (page) => page.evaluate(async () => (await import('/src/look/store.ts')).lookState());
const settle = (page) => page.waitForTimeout(400);
const dock = (page) => page.locator('.marxy-studio-dockbody');
const tab = (page, name) => page.locator('.marxy-studio-tabs .marxy-studio-tab', { hasText: new RegExp(`^${name}$`) }).click();

/** What the canvas shows: its kind, its first code block's language, and a token it is painted with. */
const canvas = (page, token = '--marxy-pl-python-keyword') =>
  page.evaluate((token) => {
    const leaf = document.querySelector('.marxy-studio-stage .marxy-studio-leaf');
    return {
      kind: leaf?.getAttribute('data-marxy-kind') ?? null,
      lang: leaf?.querySelector('pre[data-marxy-lang]')?.getAttribute('data-marxy-lang') ?? null,
      token: leaf?.style.getPropertyValue(token) ?? '',
      tokKeyword: leaf?.style.getPropertyValue('--marxy-tok-keyword') ?? '',
    };
  }, token);

/** The Code tab's measured list: its language, its heading, the keyword sample's colour and every ratio. */
const list = (page) =>
  page.evaluate(() => {
    const box = document.querySelector('.marxy-studio-code-toks');
    const keyword = box.querySelector('.marxy-studio-code-sample');
    return {
      lang: box.getAttribute('data-marxy-lang') ?? '',
      head: box.previousElementSibling.textContent,
      keyword: getComputedStyle(keyword).color,
      ratios: [...box.querySelectorAll('.marxy-studio-code-ratio')].map((x) => Number.parseFloat(x.textContent)),
    };
  });

const setRange = (page, locator, value) =>
  locator.evaluate((input, v) => {
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);

test('the Code tab puts a language on the canvas and its colours, measured, in the list', async () => {
  await withFrame({ files: FILES, open: ['/r/plans/plan.md'] }, async (page, { errors }) => {
    await open(page, 'code');
    await settle(page);
    const first = await canvas(page);
    assert.equal(first.kind, 'code', 'opening on Code puts the code specimen on the canvas');

    const pick = async (name) => {
      await dock(page).locator('.marxy-studio-code-langs button', { hasText: new RegExp(`^${name}$`) }).click();
      await page.waitForTimeout(350);
    };
    await pick('Rust');
    const r = await list(page);
    const rc = await canvas(page);
    await pick('Python');
    const p = await list(page);
    const pc = await canvas(page);
    assert.equal(r.lang, 'rust', 'the list is in Rust');
    assert.match(r.head, /in Rust/, 'and says so');
    assert.equal(rc.lang, 'rust', 'the canvas shows the Rust file');
    assert.equal(p.lang, 'python', 'then Python');
    assert.match(p.head, /in Python/);
    assert.equal(pc.lang, 'python', 'the canvas shows the Python file');
    assert.notEqual(r.keyword, p.keyword, 'the keyword sample changed colour');
    assert.ok(r.ratios.length >= 8 && r.ratios.every((x) => x >= 4.5), `every measured token is at least 4.5 : 1: ${r.ratios}`);
    assert.ok(p.ratios.every((x) => x >= 4.5), `and in Python: ${p.ratios}`);

    await dock(page).getByRole('radio', { name: 'One set for all' }).click();
    await page.waitForTimeout(400);
    const one = await list(page);
    assert.equal(one.lang, '', 'one set for all: the list is in the shared colours');
    assert.match(one.head, /^Each token, measured$/, 'and its heading says so');
    await page.waitForTimeout(300);
    assert.equal((await store(page)).tweaks.paper?.perLanguage, false, 'the look in the store has one set for all');

    await tab(page, 'Tone');
    await settle(page);
    assert.equal((await canvas(page)).kind, 'article', 'leaving the Code tab puts the prose back');
    assert.deepEqual(errors, []);
  });
});

test('the colour dial at ink only puts every language on the shared ink, on the canvas and in the store', async () => {
  await withFrame({ files: FILES, open: ['/r/plans/plan.md'] }, async (page, { errors }) => {
    await open(page, 'code');
    await settle(page);
    const before = await canvas(page);
    assert.notEqual(before.token, before.tokKeyword, 'at its own half, Python has a keyword of its own');
    await setRange(page, dock(page).locator('.marxy-studio-range').first(), 0);
    await settle(page);
    const after0 = await canvas(page);
    assert.equal(after0.token, after0.tokKeyword, 'at ink only, --marxy-pl-python-keyword is --marxy-tok-keyword');
    assert.equal(await dock(page).locator('.marxy-studio-dial-v').first().textContent(), 'ink only');
    assert.equal((await store(page)).tweaks.paper?.code, 0, 'the store has it');
    await dock(page).locator('.marxy-studio-range').first().dblclick();
    await settle(page);
    assert.equal((await store(page)).tweaks.paper?.code, undefined, 'a double-click returns to the look’s own');
    assert.deepEqual(errors, []);
  });
});

test('Adapts: a rule switched changes the store; a rule built lands in userRules with its sentence and can be removed; night is decided', async () => {
  await withFrame({ files: FILES, open: ['/r/plans/plan.md'] }, async (page, { errors }) => {
    await open(page, 'adapts');
    await settle(page);
    const wide = dock(page).getByRole('switch', { name: 'On a very wide pane, let the type grow a little' });
    assert.equal(await wide.getAttribute('aria-checked'), 'false');
    await wide.click();
    await settle(page);
    assert.equal((await store(page)).rules.wide, true, 'the wide rule is on in the store');

    await dock(page).getByRole('textbox', { name: 'Folder' }).fill('notes');
    await dock(page).getByRole('combobox', { name: 'Look' }).selectOption('slate');
    await dock(page).getByRole('button', { name: 'Add the rule' }).click();
    await settle(page);
    let s = await store(page);
    const mine = s.userRules.find((r) => r.label === 'Files in notes/ use Slate');
    assert.ok(mine, `the rule is in userRules: ${s.userRules.map((r) => r.label)}`);
    assert.deepEqual(mine.when, { path: 'notes/' });
    assert.deepEqual(mine.set, { look: 'slate' });
    assert.equal(mine.on, true);
    assert.equal(await dock(page).getByRole('switch', { name: 'Files in notes/ use Slate' }).count(), 1, 'and listed with its switch');

    await dock(page).getByRole('combobox', { name: 'When' }).selectOption('night');
    await dock(page).getByRole('combobox', { name: 'Use' }).selectOption('size');
    await dock(page).getByRole('spinbutton', { name: 'Size' }).fill('22');
    await dock(page).getByRole('button', { name: 'Add the rule' }).click();
    await settle(page);
    s = await store(page);
    const night = s.userRules.find((r) => r.label === 'At night, size 22');
    assert.ok(night, `the night rule: ${s.userRules.map((r) => r.label)}`);
    assert.deepEqual(night.when, { scheme: 'night' });
    assert.deepEqual(night.set, { size: 22 });

    await dock(page).getByRole('combobox', { name: 'When' }).selectOption('kind');
    await dock(page).getByRole('combobox', { name: 'Kind of text' }).selectOption('diff');
    await dock(page).getByRole('combobox', { name: 'Use' }).selectOption('measure');
    await dock(page).getByRole('spinbutton', { name: 'Measure' }).fill('72');
    await dock(page).getByRole('button', { name: 'Add the rule' }).click();
    await settle(page);
    s = await store(page);
    const patches = s.userRules.find((r) => r.label === 'For patches, measure 72');
    assert.deepEqual(patches?.when, { kinds: ['diff'] });

    await dock(page).getByRole('button', { name: 'Remove the rule: Files in notes/ use Slate' }).click();
    await settle(page);
    s = await store(page);
    assert.equal(s.userRules.some((r) => r.label === 'Files in notes/ use Slate'), false, 'removed from userRules');
    assert.equal(await dock(page).getByRole('switch', { name: 'Files in notes/ use Slate' }).count(), 0, 'and from the list');

    await dock(page).getByRole('radio', { name: 'Clock' }).click();
    await settle(page);
    assert.equal((await store(page)).mode, 'clock');
    assert.match(await dock(page).locator('.marxy-studio-adapts-note').textContent(), /19:00/);
    assert.deepEqual(errors, []);
  });
});

test('the File tab shows the look as its file, says which and how much, and follows a change', async () => {
  await withFrame({ files: FILES, open: ['/r/plans/plan.md'] }, async (page, { errors }) => {
    await open(page, 'file');
    await settle(page);
    const text = () => dock(page).locator('.marxy-studio-file-text').textContent();
    const a = await text();
    assert.match(a, /code_colour = 0\.5\s+# how much/);
    assert.match(a, /per_language = true\s+# which: Rust, Python, Go, TypeScript, JavaScript, SQL, Shell, CSS/);
    assert.match(await dock(page).locator('.marxy-studio-file-where').textContent(), /look\.toml/);
    await page.evaluate(async () => {
      const { lookState, setLookState } = await import('/src/look/store.ts');
      const s = lookState();
      setLookState({ ...s, tweaks: { ...s.tweaks, paper: { ...(s.tweaks.paper ?? {}), code: 0.8 } } });
    });
    await settle(page);
    const b = await text();
    assert.match(b, /code_colour = 0\.8/, 'the file follows the change');
    assert.notEqual(a, b);
    await dock(page).getByRole('button', { name: 'Copy' }).click();
    await page.waitForFunction(() => /Copied Paper as a file/.test(document.querySelector('.marxy-studio-say')?.textContent ?? ''));
    assert.deepEqual(errors, []);
  });
});
