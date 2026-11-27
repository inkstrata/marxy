// Random documents with footnotes and random edits to them: the page a splice leaves is the page a whole render makes,
// byte for byte, for every edit, from a freshly drawn page and down a chain of splices, whole or half set in the
// pending holder; and the splice is taken for most edits that leave the footnote numbers alone.
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { test as nodeTest } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import { launchWebkit } from '../../../scripts/playwright-webkit.mjs';
import { makeChain } from '../../../packages/core/src/parse/testing/footnote-chains.ts';
import { closeHarness, harnessBase } from './support/two-pane.mjs';
import { after } from 'node:test';

const skip = !existsSync(webkit.executablePath()) && process.env.MARXY_BROWSER_TESTS_REQUIRED !== '1'
  ? 'Playwright WebKit is not installed here; MARXY_BROWSER_TESTS_REQUIRED=1 makes this a failure'
  : false;
const test = (name, fn) => nodeTest(name, { skip, timeout: 300_000 }, fn);
after(() => closeHarness());
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Run in the page. `mode`: 'fresh' splices each state into the whole render of the state before; 'chain' keeps
// splicing into the page the last splice left.
async function run({ chains, core, mode, seed0 }) {
  const root = core.replaceAll('\\', '/').replace(/^(?!\/)/, '/');
  const imp = (p) => import(`/@fs${root}${p}`);
  const { renderDocumentSafeHtml } = await imp('packages/core/src/render/pipeline.ts');
  const { parseMarkdown } = await imp('packages/core/src/parse/parse.ts');
  const { DEFAULT_POLICY } = await imp('packages/core/src/sanitize/policy.ts');
  const { spliceRendered, renderRecord, parseInert } = await import('/src/render/incremental.ts');
  const mulberry32 = (a) => () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const enc = new TextEncoder();
  const out = { edits: 0, spliced: 0, notesRedrawn: 0, declined: {}, mismatches: [], byOp: {} };
  const holder = () => document.implementation.createHTMLDocument('').createElement('div');
  // Half-set page: the last top-level nodes live in the pending holder, as a progressive mount leaves them.
  const draw = (html, rnd, split) => {
    const live = parseInert(html);
    const pending = holder();
    if (split && rnd() < 0.5) {
      const keep = Math.floor(rnd() * live.childNodes.length);
      while (live.childNodes.length > keep) pending.insertBefore(live.lastChild, pending.firstChild);
    }
    return { live, pending };
  };
  for (const { texts, ops, seed } of chains) {
    const rnd = mulberry32(seed + seed0);
    const parse = (t) => parseMarkdown(enc.encode(t), { file: '/s.md' });
    let ast = parse(texts[0]);
    let render = renderDocumentSafeHtml(ast, DEFAULT_POLICY);
    let record = renderRecord(ast, render.removed, false);
    let page = draw(render.html, rnd, true);
    for (let i = 1; i < texts.length; i++) {
      const next = parse(texts[i]);
      const fresh = renderDocumentSafeHtml(next, DEFAULT_POLICY);
      out.edits++;
      const op = ops[i - 1];
      out.byOp[op] ??= { n: 0, spliced: 0 };
      out.byOp[op].n++;
      const result = spliceRendered(record, next, page, { policy: DEFAULT_POLICY });
      if (result.spliced) {
        out.spliced++;
        out.byOp[op].spliced++;
        out.notesRedrawn += result.value.notes;
        const got = page.live.innerHTML + page.pending.innerHTML;
        const want = parseInert(fresh.html).innerHTML;
        if (got !== want || JSON.stringify(result.value.removed) !== JSON.stringify(fresh.removed)) {
          let k = 0;
          while (k < got.length && got[k] === want[k]) k++;
          out.mismatches.push({ seed, step: i, op, got: got.slice(Math.max(0, k - 80), k + 120), want: want.slice(Math.max(0, k - 80), k + 120), removedSame: JSON.stringify(result.value.removed) === JSON.stringify(fresh.removed) });
          if (out.mismatches.length >= 4) return out;
        }
        record = result.value.record;
        if (mode === 'fresh') {
          record = renderRecord(next, fresh.removed, false);
          page = draw(fresh.html, rnd, true);
        }
      } else {
        out.declined[result.reason] = (out.declined[result.reason] ?? 0) + 1;
        page = draw(fresh.html, rnd, true);
        record = renderRecord(next, fresh.removed, false);
      }
    }
  }
  return out;
}

for (const mode of ['fresh', 'chain']) {
  test(`random footnoted documents and edits (${mode}): the spliced page is the whole render`, async () => {
    const chains = Array.from({ length: Number(process.env.FN_SEEDS ?? 120) }, (_, i) => ({ ...makeChain(i + 1, 8), seed: i + 1 }));
    const browser = await launchWebkit();
    try {
      const page = await browser.newPage();
      await page.goto(`${await harnessBase()}app.html`);
      await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
      const result = await page.evaluate(run, { chains, core: repoRoot, mode, seed0: 99 });
      console.log(mode, JSON.stringify({ edits: result.edits, spliced: result.spliced, notesRedrawn: result.notesRedrawn, declined: result.declined, byOp: result.byOp }));
      assert.deepEqual(result.mismatches, [], `the spliced page differs from the whole render: ${JSON.stringify(result.mismatches).slice(0, 1800)}`);
      assert.ok(result.spliced > result.edits * 0.3, `spliced ${result.spliced} of ${result.edits}`);
    } finally {
      await browser.close();
    }
  });
}

// A note the cut takes in unchanged holds a heading: a heading of the same name added or removed above it renumbers its
// id, which the random documents rarely give.
test('a note kept in the cut takes the id its heading has now', async () => {
  const filler = Array.from({ length: 8 }, (_, i) => `Filler paragraph ${i}.`).join('\n\n');
  const note = '[^a]: The note.\n\n    # Foo\n\n    More of the note.\n';
  const without = `${filler}\n\nRef[^a].\n\n${note}\nAfter.\n\n${filler}\n`;
  const withHeading = `${filler}\n\nRef[^a].\n\n# Foo\n\n${note}\nAfter.\n\n${filler}\n`;
  const browser = await launchWebkit();
  try {
    const page = await browser.newPage();
    await page.goto(`${await harnessBase()}app.html`);
    await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
    const result = await page.evaluate(async ({ pairs, core }) => {
      const root = core.replaceAll('\\', '/').replace(/^(?!\/)/, '/');
      const imp = (p) => import(`/@fs${root}${p}`);
      const { renderDocumentSafeHtml } = await imp('packages/core/src/render/pipeline.ts');
      const { parseMarkdown } = await imp('packages/core/src/parse/parse.ts');
      const { DEFAULT_POLICY } = await imp('packages/core/src/sanitize/policy.ts');
      const { spliceRendered, renderRecord, parseInert } = await import('/src/render/incremental.ts');
      const parse = (t) => parseMarkdown(new TextEncoder().encode(t), { file: '/s.md' });
      return pairs.map(([a, b]) => {
        const old = parse(a);
        const whole = renderDocumentSafeHtml(old, DEFAULT_POLICY);
        const target = { live: parseInert(whole.html), pending: null };
        const next = parse(b);
        const spliced = spliceRendered(renderRecord(old, whole.removed, false), next, target, { policy: DEFAULT_POLICY }).spliced;
        const want = parseInert(renderDocumentSafeHtml(next, DEFAULT_POLICY).html).innerHTML;
        return { spliced, ids: [...target.live.querySelectorAll('h1')].map((h) => h.id), same: target.live.innerHTML === want };
      });
    }, { pairs: [[withHeading, without], [without, withHeading]], core: repoRoot });
    assert.deepEqual(result, [
      { spliced: true, ids: ['foo'], same: true },
      { spliced: true, ids: ['foo', 'foo-1'], same: true },
    ]);
  } finally {
    await browser.close();
  }
});
