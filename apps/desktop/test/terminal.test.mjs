// A terminal session in Read (K-17): a `.session` opens as Read with a group for each command, the prompt dimmed
// colour, the command strong at weight 600, the output plain, half a line between groups, blank lines and ESC kept; Copy commands
// and Copy output write what the card says, a selection copies the file's bytes, a `console` fence in Markdown reads the same,
// and Source shows the file exactly. WebKit, over the shipped skeleton and the memory shell, as log.test.mjs runs.
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

const fixture = readFileSync(new URL('../../../fixtures/corpus/38-shell.session', import.meta.url), 'utf8');
const fenced = `# Notes\n\nRun it:\n\n\`\`\`console\n$ ls\na b\n$ pwd\n/r\n$ echo done\ndone\n\`\`\`\n\nThen read on.\n`;
const files = { '/r/shell.session': fixture, '/r/notes.md': fenced, '/r/plain.txt': '$ ls\na b\n$ pwd\n/r\n', '/r/a.term': '$ ls\na b\n', '/r/bare.term': 'just output\nmore output\n' };

async function withPage(fn) {
  const browser = await launchWebkit();
  try {
    await fn(await browser.newPage({ viewport: { width: 1280, height: 900 } }));
  } finally {
    await browser.close();
  }
}

const coloured = (page) =>
  page.waitForFunction(() => {
    const code = document.querySelector('#doc pre > code');
    return code !== null && code.dataset.marxyDone === 'highlight';
  }, null, { timeout: 15_000 });

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

const fixtureLines = fixture.replace(/\n$/, '').split('\n');

test('a .session opens in Read as a terminal with a group for each command, the prompt, command and output each in its own style', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/shell.session'] });
    await coloured(page);
    const seen = await page.evaluate(() => {
      const root = document.querySelector('section.marxy-pane');
      const lines = [...document.querySelectorAll('#doc pre > code > .marxy-line')];
      const probe = (prop, value) => {
        const el = document.createElement('i');
        el.style[prop] = value;
        document.querySelector('#doc').append(el);
        const out = getComputedStyle(el)[prop];
        el.remove();
        return out;
      };
      const cs = (el) => getComputedStyle(el);
      const prompt = document.querySelector('#doc .marxy-term-prompt');
      const command = document.querySelector('#doc .marxy-term-command');
      const output = lines.find((l) => l.textContent.startsWith(' M Cargo'));
      return {
        mode: window.__marxyHandle.panes().focused.view.mode,
        kind: root.getAttribute('data-marxy-kind'),
        prompts: document.querySelectorAll('#doc .marxy-term-prompt').length,
        starts: lines.flatMap((l, i) => (l.classList.contains('marxy-term-start') ? [i] : [])),
        text: lines.map((l) => { const c = l.cloneNode(true); for (const g of c.querySelectorAll('.marxy-invisible-glyph')) g.remove(); return c.textContent; }),
        promptColour: cs(prompt).color,
        faint: probe('color', 'var(--marxy-color-text-faint)'),
        bodyText: probe('color', 'var(--marxy-color-text)'),
        commandWeight: cs(command).fontWeight,
        commandColour: cs(command).color,
        strong: probe('color', 'var(--marxy-color-text-strong)'),
        outputWeight: cs(output).fontWeight,
        outputColour: cs(output).color,
        text0: cs(output).color,
        family: cs(output).fontFamily,
        size: cs(output).fontSize,
        lineBox: parseFloat(cs(output).lineHeight),
        gaps: lines.map((l) => parseFloat(cs(l).marginTop)),
        blank: lines.filter((l) => l.textContent === '').length,
        editor: document.querySelector('.cm-editor') !== null && document.querySelector('.cm-editor').getClientRects().length > 0,
      };
    });
    assert.equal(seen.mode, 'rendered');
    assert.equal(seen.kind, 'terminal');
    assert.equal(seen.prompts, 3, 'three commands, three prompts');
    assert.equal(seen.starts.length, 2, 'the half line is above the second and third, not the first');
    assert.equal(seen.promptColour, seen.faint, 'the prompt is the faint text colour');
    assert.notEqual(seen.promptColour, seen.bodyText, 'and so is dimmer than the output');
    assert.equal(seen.commandWeight, '600');
    assert.equal(seen.commandColour, seen.strong);
    assert.notEqual(seen.outputWeight, '600');
    assert.match(seen.family, /mono/i);
    assert.equal(seen.size, '15px', 'mono 15');
    assert.equal(seen.lineBox, 24, 'on 24');
    for (const [i, gap] of seen.gaps.entries()) assert.equal(gap, seen.starts.includes(i) ? 12 : 0, `line ${i}`);
    assert.equal(seen.blank, fixtureLines.filter((l) => l === '').length, 'blank lines inside output are kept');
    assert.deepEqual(seen.text, fixtureLines, 'every line is the file\'s line');
    assert.equal(seen.editor, false);
  }));

test('ESC is shown as a picture and never run: a colour code in output stays text and colours nothing', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/shell.session'] });
    await coloured(page);
    const seen = await page.evaluate(() => {
      const marks = [...document.querySelectorAll('#doc .marxy-invisible-esc')];
      const line = marks[0].closest('.marxy-line');
      const probe = document.createElement('i');
      probe.style.color = 'var(--marxy-color-text)';
      document.querySelector('#doc').append(probe);
      const text = getComputedStyle(probe).color;
      probe.remove();
      return {
        count: marks.length,
        label: marks[0].querySelector('.marxy-invisible-glyph').textContent,
        rest: line.textContent.includes('[1;34mold'),
        lineColour: getComputedStyle(line).color,
        text,
      };
    });
    assert.equal(seen.count, 2);
    assert.equal(seen.label, '␛');
    assert.ok(seen.rest, 'the rest of the sequence is text');
    assert.equal(seen.lineColour, seen.text, 'the line is not coloured by what it says');
  }));

test('Copy commands writes the three commands with no prompt, one multi-line command whole; Copy output writes the output lines as the file has them', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/shell.session'] });
    await coloured(page);
    await run(page, 'terminal.copy-commands');
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    assert.equal(await copied(page), ['git status --short', 'cargo test --lib \\', '  -- --test-threads=1', 'ls --color=always logs'].join('\n'));
    const before = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length);
    await run(page, 'terminal.copy-output');
    await page.waitForFunction((n) => window.__marxyHandle.shell.calls.filter((c) => c.method === 'clipboardWriteItem').length > n, before);
    const output = (await copied(page)).split('\n');
    const expected = fixtureLines.filter((l) => !/^ian@eris .* % /.test(l) && l !== '  -- --test-threads=1');
    assert.deepEqual(output, expected);
    assert.ok(output.includes(''), 'a blank line inside output stays');
    assert.ok(output.at(-1).includes('\u001b[1;34mold\u001b[0m'), 'ESC bytes and all');
    assert.ok(!output.some((l) => l.includes('git status')), 'no command in the output');
  }));

test('a copy of the whole page is the file\'s bytes, ESC and all', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/shell.session'] });
    await coloured(page);
    const key = await page.evaluate(() => (navigator.platform === 'MacIntel' ? 'Meta' : 'Control'));
    await page.locator('#doc pre').first().click();
    await page.keyboard.press(`${key}+KeyA`);
    await page.keyboard.press(`${key}+KeyC`);
    await page.waitForFunction(() => window.__marxyHandle.shell.calls.some((c) => c.method === 'clipboardWriteItem'));
    assert.ok((await copied(page)) === fixture, 'the clipboard holds the file');
  }));

test('a console fence in Markdown groups the same way, in the same styles, and Markdown keeps its own kind and tools', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/notes.md'] });
    await page.waitForFunction(() => document.querySelector('#doc pre > code')?.dataset.marxyDone === 'highlight', null, { timeout: 15_000 });
    const seen = await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const handle = window.__marxyHandle;
      const ctx = buildAppContext(handle);
      const lines = [...document.querySelectorAll('#doc pre > code > .marxy-line')];
      return {
        prompts: document.querySelectorAll('#doc .marxy-term-prompt').length,
        commands: [...document.querySelectorAll('#doc .marxy-term-command')].map((c) => c.textContent),
        starts: lines.flatMap((l, i) => (l.classList.contains('marxy-term-start') ? [i] : [])),
        weight: getComputedStyle(document.querySelector('#doc .marxy-term-command')).fontWeight,
        kind: document.querySelector('section.marxy-pane').getAttribute('data-marxy-kind'),
        offered: handle.commands().find((c) => c.id === 'terminal.copy-commands').when(ctx),
      };
    });
    assert.equal(seen.prompts, 3);
    assert.deepEqual(seen.commands, ['ls', 'pwd', 'echo done']);
    assert.deepEqual(seen.starts, [2, 4]);
    assert.equal(seen.weight, '600');
    assert.notEqual(seen.kind, 'terminal');
    assert.equal(seen.offered, false, 'the strip is the terminal kind\'s');
  }));

test('Source shows the file exactly, and nothing was written: the bytes are the file\'s', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/shell.session'] });
    await coloured(page);
    await run(page, 'view.mode-source');
    await page.waitForSelector('.cm-content', { timeout: 10_000 });
    const inEditor = await page.evaluate(() => document.querySelector('.cm-content').innerText);
    assert.equal(inEditor.replace(/\u241b/g, '\u001b').replace(/\n+$/, ''), fixture.replace(/\n+$/, ''), 'Source shows the file exactly');
    const bytes = await page.evaluate(() => [...window.__marxyHandle.panes().focused.view.store().snapshot().buffer.bytes]);
    assert.deepEqual(Buffer.from(bytes), Buffer.from(fixture), 'the buffer is the file\'s bytes');
    const writes = await page.evaluate(() => window.__marxyHandle.shell.calls.filter((c) => /write|save/i.test(c.method) && !/clipboard/i.test(c.method)).map((c) => `${c.method} ${String(c.args[0])}`).filter((w) => w.includes('/r/')));
    assert.deepEqual(writes, [], 'no write reached the file');
  }));

test('the two tools are offered for a terminal, a .term as well, and not for a .txt that merely looks like a session', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/plain.txt'] });
    const offered = () =>
      page.evaluate(async () => {
        const { buildAppContext } = await import('/src/selection/bind.ts');
        const handle = window.__marxyHandle;
        const ctx = buildAppContext(handle);
        return {
          kind: document.querySelector('section.marxy-pane').getAttribute('data-marxy-kind'),
          tools: ['terminal.copy-commands', 'terminal.copy-output'].map((id) => handle.commands().find((c) => c.id === id).when(ctx)),
          grouped: document.querySelectorAll('#doc .marxy-term-prompt').length,
        };
      });
    const txt = await offered();
    assert.equal(txt.grouped, 0, 'a .txt is not read as a terminal by detection (question 2)');
    await page.evaluate((p) => window.__marxyHandle.open(p), '/r/a.term');
    await page.waitForFunction(() => document.querySelector('section.marxy-pane').getAttribute('data-marxy-kind') === 'terminal');
    const term = await offered();
    assert.deepEqual(term.tools, [true, true]);
    assert.equal(term.kind, 'terminal');
  }));

test('a terminal with no command to group has the two tools off, with the reason', () =>
  withPage(async (page) => {
    await bootTwoPanes(page, { files, open: ['/r/bare.term'] });
    const seen = await page.evaluate(async () => {
      const { buildAppContext } = await import('/src/selection/bind.ts');
      const handle = window.__marxyHandle;
      const ctx = buildAppContext(handle);
      return ['terminal.copy-commands', 'terminal.copy-output'].map((id) => {
        const c = handle.commands().find((x) => x.id === id);
        return { when: c.when(ctx), why: c.unavailable?.(ctx) ?? null };
      });
    });
    for (const t of seen) {
      assert.equal(t.when, false);
      assert.match(t.why, /No prompt line with a command/);
    }
  }));
