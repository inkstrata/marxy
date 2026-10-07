// Slash-break suite the typeset `test/**/*.test.mjs` glob actually runs (MARXY-239).
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test as nodeTest } from 'node:test';
import { webkit } from 'playwright';
import { insertSlashBreaks } from '../src/slash-break.ts';
import { renderCorpus, startHarness } from './harness.mjs';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');

function codePiece(data) {
  const node = {
    data,
    parentElement: { closest: (sel) => (sel.includes('code') ? {} : null) },
  };
  return { kind: 'piece', text: data, segments: [{ node, start: 0, end: data.length }] };
}

nodeTest('insertSlashBreaks adds dash opportunities only after slashes in code', () => {
  const tokens = insertSlashBreaks([codePiece('/usr/local/file-name.ts')]);
  const dashes = tokens.filter((t) => t.kind === 'dash');
  assert.equal(dashes.length, 3);
  assert.ok(tokens.some((t) => t.kind === 'piece' && t.text === 'file-name.ts'));
  assert.ok(!tokens.some((t) => t.kind === 'dash' && t.node.data[t.offset - 1] === '-'));
  for (const token of tokens) {
    if (token.kind !== 'piece') continue;
    assert.equal(token.segments.length, 1);
    assert.equal(token.text, token.segments[0].node.data.slice(token.segments[0].start, token.segments[0].end));
  }
});

nodeTest('a path that fits never gains slash breaks', () => {
  assert.equal(insertSlashBreaks([codePiece('short')]).length, 1);
});

nodeTest('slash breaks are a third pass after an overfull first choose', () => {
  const src = readFileSync(join(pkg, 'src/index.ts'), 'utf8');
  const first = src.indexOf('let broken = choose(');
  const gate = src.indexOf('if (broken === null)');
  const retry = src.indexOf('tokens = insertSlashBreaks');
  assert.ok(first !== -1 && gate !== -1 && retry !== -1);
  assert.ok(first < gate && gate < retry);
});

const skip =
  !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
    ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
    : false;
const test = (name, fn) => nodeTest(name, { skip }, fn);

let harness;
before(async () => {
  if (!skip) harness = await startHarness();
});
after(async () => {
  await harness?.close();
});

const attach = (page) =>
  page.evaluate(async () => {
    window.controller = window.typeset.attach(document.getElementById('doc'), {
      lineBox: window.lineBox,
      glueStretchEm: 0.6,
      hyphenate: false,
      lastLineMinWidth: 0.33,
      hanging: 'none',
      scheduler: window.immediateScheduler(),
    });
    await window.controller.done;
    return JSON.parse(JSON.stringify(window.controller.stats));
  });

test('a path wider than the measure breaks after a slash, never at a hyphen', async () => {
  const path = '/usr/local/lib/very/long/path/to/pkg/file-name.ts';
  const html = `<p data-marxy-s="0">See <code>${path}</code> in the log.</p>`;
  const page = await harness.open(html, { extraCss: '.marxy-article { max-width: 32ch !important; }' });
  const stats = await attach(page);
  const seen = await page.evaluate(() => {
    const code = document.querySelector('code');
    const marks = [...(code?.querySelectorAll('.marxy-lb') ?? [])];
    return {
      set: Boolean(code?.closest('.marxy-set')),
      before: marks.map((mark) => mark.previousSibling?.textContent?.slice(-1) ?? ''),
      text: code?.textContent ?? '',
    };
  });
  await page.close();
  assert.equal(seen.text, path);
  assert.ok(seen.set, `expected a set paragraph; stats ${JSON.stringify(stats)}`);
  assert.ok(seen.before.length > 0, 'a path wider than the measure must break');
  assert.ok(
    seen.before.every((ch) => ch === '/'),
    `breaks must sit after a slash, got ${JSON.stringify(seen.before)}`,
  );
});

test('a path that fits the measure never breaks', async () => {
  const html = '<p data-marxy-s="0">See <code>/usr/bin</code> here.</p>';
  const page = await harness.open(html);
  await attach(page);
  const breaks = await page.evaluate(() => document.querySelector('code')?.querySelectorAll('.marxy-lb').length ?? -1);
  await page.close();
  assert.equal(breaks, 0);
});

test('corpus overfull fallbacks do not rise on the rag fixtures', async () => {
  let overfull = 0;
  for (const file of ['01-long-technical.md', '18-agent-transcript.md']) {
    const page = await harness.open(renderCorpus(file));
    const stats = await attach(page);
    overfull += stats.reasons?.overfull ?? 0;
    await page.close();
  }
  assert.equal(overfull, 0, `overfull fallbacks ${overfull}; the measured count on these fixtures is 0`);
});
