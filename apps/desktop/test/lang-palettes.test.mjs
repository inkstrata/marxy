// Colour by language: each language in its own palette in Read and Source alike, at the contrast
// floor on its code block; the reader's `[syntax.rust]` colours over it, written by the Studio's Code tab as one line and in
// force at once in both modes; `by_language = false` back to the shared roles; the accent on a fence's word in Source; and
// the hue test's code trials. The real app over the memory shell, config.toml at `/config`. Playwright WebKit.
import { strict as assert } from 'node:assert';
import { after, test as nodeTest } from 'node:test';
import { fileText, skip, withFrame } from './support/frame.mjs';
import { closeHarness } from './support/two-pane.mjs';

const test = (name, fn) => nodeTest(name, { skip, timeout: 120_000 }, fn);
after(() => closeHarness());

const RUST = 'fn main() -> u32 {\n    let name = "tide";\n    return 42;\n}\n';
const PYTHON = 'def main():\n    name = "tide"\n    return 42\n';
const FILES = {
  '/r/a.md': `# Two languages\n\nSome words.\n\n\`\`\`rust\n${RUST}\`\`\`\n\n\`\`\`python\n${PYTHON}\`\`\`\n`,
  '/r/main.rs': RUST,
  '/r/main.py': PYTHON,
};

/** The computed colour of the leaf span reading `word` under `root`. */
const colourOf = (page, root, word) =>
  page.evaluate(
    ({ root, word }) => {
      const el = [...document.querySelectorAll(`${root} span`)].find((s) => s.textContent === word && s.children.length === 0);
      return el ? getComputedStyle(el).color : null;
    },
    { root, word },
  );

/** WCAG contrast of the leaf span reading `word` under `root` against the block's own background. */
const contrastOf = (page, root, word) =>
  page.evaluate(
    ({ root, word }) => {
      const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
      const el = [...document.querySelectorAll(`${root} span`)].find((s) => s.textContent === word && s.children.length === 0);
      let g = el;
      while (g && /rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(g).backgroundColor)) g = g.parentElement;
      const [a, b] = [lum(rgb(getComputedStyle(el).color)), lum(rgb(getComputedStyle(g).backgroundColor))];
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    },
    { root, word },
  );

const readReady = (page) =>
  page.waitForFunction(() => ['rust', 'python'].every((l) => document.querySelector(`pre[data-marxy-lang="${l}"] .marxy-tok-keyword`)), null, { timeout: 30_000 });

test('Read: Rust and Python each in their own palette, each keyword at 4.5 : 1 on its block, in Night and Paper', async () => {
  await withFrame({ files: FILES, open: ['/r/a.md'] }, async (page) => {
    await readReady(page);
    for (const variant of ['dark', 'light']) {
      await page.evaluate((v) => document.documentElement.setAttribute('data-marxy-variant', v), variant);
      await page.waitForFunction(async (v) => {
        const { langSheetText } = await import('/src/theme/lang-colour.ts');
        return document.documentElement.getAttribute('data-marxy-variant') === v && langSheetText().includes('data-marxy-lang="rust"');
      }, variant);
      const rust = await colourOf(page, 'pre[data-marxy-lang="rust"]', 'return');
      const python = await colourOf(page, 'pre[data-marxy-lang="python"]', 'return');
      assert.notEqual(rust, python, `${variant}: two palettes`);
      for (const [lang, word] of [['rust', 'return'], ['rust', '"tide"'], ['python', 'return'], ['python', 'def']]) {
        const r = await contrastOf(page, `pre[data-marxy-lang="${lang}"]`, word);
        assert.ok(r >= 4.5, `${variant}: ${lang} ${word} ${r.toFixed(2)}`);
      }
    }
  });
});

test('a token is one colour in Read and Source; the reader\'s [syntax.rust] keyword wins in both, and Python keeps its own', async () => {
  const sourceReady = (page) =>
    page.waitForFunction(() => ['rust', 'python'].every((l) => [...document.querySelectorAll(`.cm-editor[data-marxy-lang="${l}"] .cm-content span`)].some((s) => s.textContent === 'return')), null, { timeout: 30_000 });
  let shipped;
  await withFrame({ files: FILES, open: ['/r/main.rs', '/r/main.py'] }, async (page) => {
    // Code lands in Read; this is Source's colour, one press away in each pane.
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 2 && window.__marxyHandle.panes().panes.every((p) => p.path() && p.host.querySelector('pre code')));
    await page.evaluate(async () => { for (const p of window.__marxyHandle.panes().panes) await p.view.setMode('source'); });
    await sourceReady(page);
    shipped = { rust: await colourOf(page, '.cm-editor[data-marxy-lang="rust"]', 'return'), python: await colourOf(page, '.cm-editor[data-marxy-lang="python"]', 'return') };
    assert.notEqual(shipped.rust, shipped.python);
  });
  await withFrame({ files: FILES, open: ['/r/a.md'] }, async (page) => {
    await readReady(page);
    assert.equal(await colourOf(page, 'pre[data-marxy-lang="rust"]', 'return'), shipped.rust, 'Rust\'s keyword is one colour in Read and Source');
    assert.equal(await colourOf(page, 'pre[data-marxy-lang="python"]', 'return'), shipped.python, 'and Python\'s');
  });
  const config = '[syntax.rust]\nkeyword = "#ff0001"\n';
  await withFrame({ files: FILES, open: ['/r/main.rs', '/r/main.py'], config }, async (page) => {
    // Code lands in Read; this is Source's colour, one press away in each pane.
    await page.waitForFunction(() => window.__marxyHandle.panes().panes.length === 2 && window.__marxyHandle.panes().panes.every((p) => p.path() && p.host.querySelector('pre code')));
    await page.evaluate(async () => { for (const p of window.__marxyHandle.panes().panes) await p.view.setMode('source'); });
    await sourceReady(page);
    assert.equal(await colourOf(page, '.cm-editor[data-marxy-lang="rust"]', 'return'), 'rgb(255, 0, 1)', 'yours in Source');
    assert.equal(await colourOf(page, '.cm-editor[data-marxy-lang="python"]', 'return'), shipped.python, 'Python keeps its own');
  });
  await withFrame({ files: FILES, open: ['/r/a.md'], config }, async (page) => {
    await readReady(page);
    assert.equal(await colourOf(page, 'pre[data-marxy-lang="rust"]', 'return'), 'rgb(255, 0, 1)', 'yours in Read');
  });
});

test('by_language = false puts every language in the shared roles', async () => {
  await withFrame({ files: FILES, open: ['/r/a.md'], config: '[syntax]\nby_language = false\n' }, async (page) => {
    await readReady(page);
    assert.equal(await colourOf(page, 'pre[data-marxy-lang="rust"]', 'return'), await colourOf(page, 'pre[data-marxy-lang="python"]', 'return'));
  });
});

test('a theme\'s own [data-marxy-lang] scope outranks the shipped palette', async () => {
  await withFrame({ files: FILES, open: ['/r/a.md'] }, async (page) => {
    await readReady(page);
    await page.addStyleTag({ content: '[data-marxy-lang="rust"] { --marxy-tok-keyword: rgb(0, 128, 1); }' });
    assert.equal(await colourOf(page, 'pre[data-marxy-lang="rust"]', 'return'), 'rgb(0, 128, 1)');
  });
});

test('the Studio\'s Code tab: By language writes one line to config.toml and the colour is in force at once in Read; Back to its own takes it out', async () => {
  const before = '# Mine.\nsize = 20\n';
  await withFrame({ files: FILES, open: ['/r/a.md'], config: before }, async (page, { mod }) => {
    await readReady(page);
    // The rail's Look is the Studio; the colours of your own are its Code tab's.
    await page.keyboard.press(`${mod}+Alt+KeyT`);
    await page.waitForSelector('dialog.marxy-studio[open]');
    await page.locator('.marxy-studio-tab', { hasText: 'Code' }).click();
    await page.click('.marxy-studio [data-marxy-lang-row="rust"]');
    await page.waitForSelector('[data-marxy-lang-role="rust:keyword"] input[type="color"]');
    await page.$eval('[data-marxy-lang-role="rust:keyword"] input[type="color"]', (i) => {
      i.value = '#00ff01';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(async (was) => new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/config')) !== was, before);
    assert.equal(await fileText(page, '/config'), `${before}\n[syntax.rust]\nkeyword = "#00ff01"\n`);
    await page.waitForFunction(() => {
      const el = [...document.querySelectorAll('pre[data-marxy-lang="rust"] span')].find((s) => s.textContent === 'return');
      return el && getComputedStyle(el).color === 'rgb(0, 255, 1)';
    });
    await page.click('text=Back to Rust’s own');
    await page.waitForFunction(async () => !new TextDecoder().decode(await window.__marxyHandle.shell.readFile('/config')).includes('keyword'));
    assert.notEqual(await colourOf(page, 'pre[data-marxy-lang="rust"]', 'return'), 'rgb(0, 255, 1)');
  });
});

test('the accent: a fence\'s word in Source takes its language\'s colour, at 3 : 1 on its ground; off, it does not', async () => {
  for (const accent of [true, false]) {
    await withFrame({ files: FILES, open: ['/r/a.md'], config: accent ? '' : '[syntax]\naccent = false\n' }, async (page, { mod }) => {
      await page.waitForSelector('article pre[data-marxy-lang="rust"]', { timeout: 30_000 });
      await page.click('article p');
      await page.keyboard.press(`${mod}+KeyE`);
      await page.waitForSelector('.marxy-fence-lang[data-marxy-lang="rust"]', { timeout: 30_000 });
      const got = await page.evaluate(() => {
        const name = document.querySelector('.marxy-fence-lang[data-marxy-lang="rust"]');
        const leaf = [...name.querySelectorAll('*')].pop() ?? name;
        return { colour: getComputedStyle(leaf).color, accent: getComputedStyle(name).getPropertyValue('--marxy-lang').trim(), text: name.textContent };
      });
      assert.equal(got.text, 'rust');
      if (accent) {
        assert.ok(got.accent, 'an accent is set');
        const probe = await page.evaluate((a) => {
          const s = document.createElement('span');
          s.style.color = a;
          document.body.append(s);
          const c = getComputedStyle(s).color;
          s.remove();
          return c;
        }, got.accent);
        assert.equal(got.colour, probe, 'the word is in the accent');
        const r = await contrastOf(page, '.cm-content', 'rust');
        assert.ok(r >= 3, `accent ${r.toFixed(2)}`);
      } else {
        assert.equal(got.accent, '', 'no accent with accent = false');
      }
    });
  }
});

test('the hue test runs code trials beside the log and patch ones and reports each kind', async () => {
  await withFrame({ files: FILES, open: ['/r/a.md'] }, async (page) => {
    await page.evaluate(async () => (await import('/src/frame/hue-test.ts')).openHueTest());
    await page.click('.marxy-apppage [data-marxy-primary]');
    const kinds = [];
    for (let k = 0; k < 18; k++) {
      await page.waitForSelector('.marxy-hue-trial');
      const t = await page.evaluate(() => {
        const block = document.querySelector('.marxy-hue-trial');
        return { what: block.className.match(/marxy-hue-(log|patch|code)/)[1], lang: block.dataset.marxyLang ?? null, cond: block.dataset.marxyCond };
      });
      kinds.push(t);
      // Answer by the row's text, as a reader would.
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.marxy-hue-row')];
        const task = document.querySelector('.marxy-huetest-head').textContent;
        const hit = task.includes('ERROR')
          ? rows.find((r) => r.dataset.marxyKind === 'error')
          : task.includes('cookie')
            ? rows.find((r) => r.textContent.includes('cookieTTL'))
            : task.includes('string')
              ? rows.find((r) => r.querySelector('.marxy-tok-string'))
              : rows.find((r) => r.querySelector('.marxy-tok-function'));
        hit.click();
      });
    }
    assert.equal(kinds.filter((t) => t.what === 'code').length, 6);
    assert.ok(kinds.filter((t) => t.what === 'code').every((t) => ['rust', 'python', 'go', 'typescript'].includes(t.lang)));
    assert.equal(kinds.filter((t) => t.what === 'code' && t.cond === 'hue').length, 3);
    await page.waitForSelector('.marxy-huetest-by');
    const by = await page.$$eval('.marxy-huetest-by tr[data-marxy-what]', (rs) => rs.map((r) => r.dataset.marxyWhat));
    assert.deepEqual(by, ['log', 'patch', 'code']);
  });
});
