// Every code block in Read and the Source editor carry `data-marxy-lang`, the registry's id, so a theme's
// `[data-marxy-lang="<id>"]` scope (theme-contract.md, "Per language") colours that language and nothing else, in both modes.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { skip, withFrame } from './support/frame.mjs';
import { closeHarness } from './support/two-pane.mjs';

const test = (name, fn) => nodeTest(name, { skip }, fn);
after(() => closeHarness());

const RED = 'rgb(255, 0, 1)';
const THEME = `[data-marxy-lang="rust"] { --marxy-tok-keyword: ${RED}; }`;
// The shared roles, so the scope is measured against one keyword colour: each language's own palette is
// lang-palettes.test.mjs's.
const CONFIG = '[syntax]\nby_language = false\n';
const RUST = 'fn main() -> u32 {\n    return 42;\n}\n';
const PYTHON = 'def main():\n    return 42\n';
const FILES = {
  '/r/a.md': `# Two languages\n\nSome words.\n\n\`\`\`rs\n${RUST}\`\`\`\n\n\`\`\`python\n${PYTHON}\`\`\`\n`,
  '/r/main.rs': RUST,
  '/r/main.py': PYTHON,
};

/** The colour of the token reading `word` under `root`, and of the page's body text. */
const colourOf = (page, root, word) =>
  page.evaluate(
    ({ root, word }) => {
      const el = [...document.querySelectorAll(`${root} span`)].find((s) => s.textContent === word && s.children.length === 0);
      return el ? getComputedStyle(el).color : null;
    },
    { root, word },
  );

test('a rust scope colours Rust keywords in Read, and not the Python fence or the prose', async () => {
  await withFrame({ files: FILES, open: ['/r/a.md'], config: CONFIG }, async (page) => {
    await page.waitForFunction(() => ['rust', 'python'].every((l) => document.querySelector(`pre[data-marxy-lang="${l}"] .marxy-tok-keyword`)), null, { timeout: 30_000 });
    const langs = await page.$$eval('article pre', (pres) => pres.map((p) => p.getAttribute('data-marxy-lang')));
    assert.deepEqual(langs, ['rust', 'python'], 'a fence carries the registry id for its word (`rs` is rust)');
    const before = { rust: await colourOf(page, 'pre[data-marxy-lang="rust"]', 'return'), python: await colourOf(page, 'pre[data-marxy-lang="python"]', 'return') };
    const prose = await page.$eval('article p', (p) => getComputedStyle(p).color);
    assert.equal(before.rust, before.python, 'one keyword colour before the scope');
    await page.addStyleTag({ content: THEME });
    assert.equal(await colourOf(page, 'pre[data-marxy-lang="rust"]', 'return'), RED);
    assert.equal(await colourOf(page, 'pre[data-marxy-lang="python"]', 'return'), before.python, 'Python keeps its keyword colour');
    assert.equal(await page.$eval('article p', (p) => getComputedStyle(p).color), prose, 'prose keeps its colour');
  });
});

test('a rust scope colours Rust keywords in Source, and not a Python file beside it', async () => {
  await withFrame({ files: FILES, open: ['/r/main.rs', '/r/main.py'], config: CONFIG }, async (page) => {
    // Code lands in Read; this is Source's colour, one press away in each pane.
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 2 && window.__marxyHandle.panes().panes.every((p) => p.path() && p.host.querySelector('pre code')));
    await page.evaluate(async () => { for (const p of window.__marxyHandle.panes().panes) await p.view.setMode('source'); });
    await page.waitForFunction(
      () => ['rust', 'python'].every((l) => [...document.querySelectorAll(`.cm-editor[data-marxy-lang="${l}"] .cm-content span`)].some((s) => s.textContent === 'return')),
      null,
      { timeout: 30_000 },
    );
    const before = await colourOf(page, '.cm-editor[data-marxy-lang="python"]', 'return');
    assert.equal(await colourOf(page, '.cm-editor[data-marxy-lang="rust"]', 'return'), before, 'one keyword colour before the scope');
    await page.addStyleTag({ content: THEME });
    assert.equal(await colourOf(page, '.cm-editor[data-marxy-lang="rust"]', 'return'), RED);
    assert.equal(await colourOf(page, '.cm-editor[data-marxy-lang="python"]', 'return'), before, 'Python keeps its keyword colour');
  });
});

const modifier = (page) => page.evaluate(() => (navigator.platform === 'MacIntel' ? 'Meta' : 'Control'));

test('in a Markdown file\'s Source each fence carries its own language: a rust scope colours the Rust fence only', async () => {
  await withFrame({ files: FILES, open: ['/r/a.md'], config: CONFIG }, async (page) => {
    await page.waitForSelector('article pre[data-marxy-lang="rust"]', { timeout: 30_000 });
    await page.click('article p');
    await page.keyboard.press(`${await modifier(page)}+KeyE`);
    await page.waitForFunction(
      () => ['rust', 'python'].every((l) => [...document.querySelectorAll(`.cm-line[data-marxy-lang="${l}"] span`)].some((s) => s.textContent === 'return')),
      null,
      { timeout: 30_000 },
    );
    const lines = await page.$$eval('.cm-line', (ls) => ls.map((l) => [l.textContent, l.getAttribute('data-marxy-lang')]));
    assert.deepEqual(
      lines.filter(([, lang]) => lang !== null),
      [['fn main() -> u32 {', 'rust'], ['    return 42;', 'rust'], ['}', 'rust'], ['def main():', 'python'], ['    return 42', 'python']],
      'the body lines of each fence, and not its fence lines or the prose',
    );
    assert.equal(await page.$eval('.cm-editor', (e) => e.getAttribute('data-marxy-lang')), 'markdown');
    const before = await colourOf(page, '.cm-line[data-marxy-lang="python"]', 'return');
    assert.equal(await colourOf(page, '.cm-line[data-marxy-lang="rust"]', 'return'), before, 'one keyword colour before the scope');
    await page.addStyleTag({ content: THEME });
    assert.equal(await colourOf(page, '.cm-line[data-marxy-lang="rust"]', 'return'), RED);
    assert.equal(await colourOf(page, '.cm-line[data-marxy-lang="python"]', 'return'), before, 'the Python fence keeps its colour');
  });
});
