// D-15's equivalence oracle (04-phase-d.md, "Amended 2026-10-11"). The parse in slices and the render in slices
// are a second road to the bytes the reader sees, beside the sanitiser's one pass (ADR-0023 Amendment 1), so
// this holds them to the first, end to end the way the app uses them (the render of the sliced parse):
//   - every corpus file, at the default slice size and the smallest;
//   - documents of 256 KB and 1 MB (prose, a transcript, and each with a footnote, which the render declines);
//   - seeded fuzz documents with the hostile cases among them (raw HTML left open across blocks, footnotes,
//     link definitions, fences and front matter that never close, remote images, scripts, repeated headings);
//   - and the oracle has teeth: a slicer with the `rawTagsBalanced` guard, the footnote fall-back or the
//     truncation guard taken out fails it.
// `ORACLE_SEEDS=2000 node --test --experimental-strip-types packages/core/src/render/sliced-oracle.test.ts` runs more.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkEquivalent, type OracleVerdict, type SlicedRender } from '../parse/testing/oracle.ts';
import { generated, generatedHostile, random } from '../parse/testing/structured.ts';

const SEEDS = Math.max(200, Number(process.env.ORACLE_SEEDS ?? 300));
const SMALLEST = 1e-9;
const corpus = new URL('../../../../fixtures/corpus/', import.meta.url);
// Every text file of the corpus, whatever its extension: the parse takes any bytes.
const files = readdirSync(corpus).filter((name) => /\.(md|css|py|rs|ts)$/.test(name)).sort();
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(name, corpus)));
const text = (name: string): string => new TextDecoder().decode(read(name));
const repeated = (unit: string, bytes: number): string => {
  let out = '';
  while (out.length < bytes) out += unit;
  return out;
};

test('every corpus file: the sliced parse and render equal the whole ones, at the default size and the smallest', async () => {
  assert.ok(files.length >= 30, `${files.length} corpus files`);
  const seen = { sliced: 0, declined: 0 };
  for (const name of files) {
    for (const [sliceBytes, budgetMs] of [[undefined, undefined], [512, SMALLEST]] as const) {
      const verdict = await checkEquivalent(read(name), `${name} @${sliceBytes ?? 'default'}`, { sliceBytes, budgetMs });
      seen[verdict.render]++;
    }
  }
  assert.ok(seen.sliced > files.length, `sliced ${seen.sliced}, declined ${seen.declined}: the oracle did not run the sliced road on most of the corpus`);
});

const unit = text('01-long-technical.md');
const turn = text('18-agent-transcript.md');
const large: [string, () => string][] = [
  ['256 KB of prose', () => repeated(`${unit}\n\n`, 256 * 1024)],
  ['1 MB of prose', () => repeated(`${unit}\n\n`, 1024 * 1024)],
  ['256 KB of transcript', () => { let out = ''; for (let n = 1; out.length < 256 * 1024; n++) out += `## Turn ${n}\n\n${turn}\n`; return out; }],
  ['1 MB of transcript', () => { let out = ''; for (let n = 1; out.length < 1024 * 1024; n++) out += `## Turn ${n}\n\n${turn}\n`; return out; }],
];

for (const [name, make] of large) {
  test(`${name}: the sliced parse and render equal the whole ones`, async () => {
    const body = make();
    const plain = await checkEquivalent(body, name);
    assert.deepEqual(plain, { parse: 'slices', render: 'sliced' } satisfies OracleVerdict, `${name}: the large document was really cut`);
    // With a footnote and a link definition at the end: one parse and one render, whole, and the same bytes
    // (at 256 KB; the 1 MB case would only be the same whole parse and render twice over).
    if (body.length > 512 * 1024) return;
    const withDefinitions = await checkEquivalent(`${body}\nA note.[^n] and [a link][l].\n\n[^n]: The note.\n\n[l]: https://example.com\n`, `${name} with definitions`);
    assert.deepEqual(withDefinitions, { parse: 'whole', render: 'declined' } satisfies OracleVerdict);
  });
}

test('seeded fuzz documents with the hostile cases among them: the sliced roads equal the whole ones', async () => {
  const seen = { sliced: 0, declined: 0, cut: 0, whole: 0 };
  for (let seed = 1; seed <= SEEDS; seed++) {
    // The hostile generator, and the plain one the parse's own tests use (its cut points are the other half of the fuzz).
    for (const make of [generatedHostile, generated]) {
      const next = random(seed);
      const verdict = await checkEquivalent(make(next), `${make.name} seed ${seed}`, {
        sliceBytes: 1 + Math.floor(next() * 200),
        budgetMs: SMALLEST,
      });
      seen[verdict.render]++;
      seen[verdict.parse === 'slices' ? 'cut' : 'whole']++;
    }
  }
  // Not a vacuous pass: both roads were taken, in both ways, by a good share of the seeds.
  assert.ok(seen.sliced >= SEEDS / 10, `${JSON.stringify(seen)}: too few documents rendered in slices`);
  assert.ok(seen.declined >= SEEDS / 10, `${JSON.stringify(seen)}: too few documents declined`);
  assert.ok(seen.cut >= SEEDS / 10, `${JSON.stringify(seen)}: too few documents parsed in slices`);
  assert.ok(seen.whole >= SEEDS / 10, `${JSON.stringify(seen)}: too few documents parsed whole`);
});

/** The written-out hostile documents, as [label, text]. */
function writtenOut(): [string, string][] {
  const pad = Array.from({ length: 40 }, (_, n) => `paragraph ${n}\n`).join('\n');
  const bigPad = Array.from({ length: 100 }, (_, n) => `paragraph ${n}\n`).join('\n');
  const cases: Record<string, string> = {
    'an element left open by the first block': `<b>open\n\n${pad}\n\nand never closed\n`,
    'an element closed by a later block': `<b>open\n\n${pad}\n\nclosed</b> here\n`,
    'a paragraph that opens a second paragraph and leaves the first open': `a <p> b\n\n${bigPad}\n`,
    'a heading that opens a second heading': `# h <h1> x\n\n${bigPad}\n`,
    'a closer with no opener': `${pad}\n\n</b>\n\n${pad}\n`,
    'script inline, open': `${pad}\n\ntext <script>x\n\n${pad}\n\n</script> after\n`,
    'svg open across blocks': `${pad}\n\nan <svg> open\n\n${pad}\n\n</svg>\n`,
    'a footnote': `${pad}\n\nref[^a]\n\n${pad}\n\n[^a]: note\n`,
    'a link definition': `${pad}\n\nsee [ref]\n\n${pad}\n\n[ref]: http://example.com\n`,
    'an unclosed fence': `${pad}\n\n\`\`\`js\nnever closed\n\n${pad}\n`,
    'an unclosed fence in a list': `- a\n\n  \`\`\`\n  open\n\n${pad}\n`,
    'front matter that never closes': `---\na: 1\n\n${pad}\n`,
    'remote images in several blocks': `![a](https://example.com/a.png)\n\n${pad}\n\n![b](https://example.org/b.png)\n\n<img src="https://example.net/c.png">\n`,
    'scripts and handlers in several blocks': `<script>alert(1)</script>\n\n${pad}\n\n<img src=x onerror=y>\n\n[x](javascript:alert(1))\n\n<iframe src=x></iframe>\n`,
    'a loose list whose items a slice must not part': `${pad}\n\n${Array.from({ length: 60 }, (_, n) => `- item ${n}`).join('\n\n')}\n\n${pad}\n`,
    'a fence with blank lines inside': `${pad}\n\n\`\`\`\n${Array.from({ length: 40 }, (_, n) => `line ${n}`).join('\n\n')}\n\`\`\`\n\n${pad}\n`,
    'indented code before a list marker': `    indented\n\n- x\n\n${pad}\n`,
    'a list item continued after a blank line': `- a\n\n  b\n\n  c\n\n${pad}\n`,
    'front matter closed after a blank line': `---\na: 1\n\nb: 2\n---\n\n${pad}\n`,
    'plus front matter that never closes': `+++\na = 1\n\nb = 2\n\n${pad}\n`,
    'front matter that never closes, with a rule far below': `---\ntitle: x\n\n${pad}\n\n---\n\n${pad}\n`,
    'front matter that never closes, nothing below': `---\ntitle: x\n\n${pad}\n`,
    'a loose list whose next item is far below': `- a\n\n${pad}\n\n- b\n`,
    'a list interrupted and taken up again': `- a\n- b\n\nc\n\n- d\n\n${pad}\n\n- e\n`,
    'a rule that looks like front matter': `---\n\n${pad}\n\n---\n\n${pad}\n`,
    'repeated headings far apart': `# Same\n\n${pad}\n\n# Same\n\n${pad}\n\n## Same\n\n${pad}\n\n# Same\n`,
  };
  return Object.entries(cases);
}

test('hostile documents written out: each is equal on both roads', async () => {
  for (const [name, source] of writtenOut()) {
    await checkEquivalent(source, name, { sliceBytes: 64, budgetMs: SMALLEST });
    await checkEquivalent(source, `${name} (default sizes)`);
  }
});

// The oracle must fail on a slicer that has lost a guard. Each mutant is the real `pipeline.ts` with one guard
// removed, written beside it, imported, and removed again; a mutation that changes nothing in the source (the
// guard was moved or renamed) fails here too, so these cannot go quietly vacuous. The truncation guard behind
// them is a second belt: every element the sanitiser takes to a later end tag is a tag `rawTagsBalanced` refuses
// first, so a slicer without it alone gives the same bytes (checked by hand over these seeds) and is not a mutant
// the oracle can tell apart.
const mutants: Record<string, [from: string, to: string]> = {
  'the rawTagsBalanced guard dropped': ['if (!run.every(rawTagsBalanced)) return null;', ''],
  'the footnote fall-back dropped': ["if (blocks.some((block) => block.type === 'footnoteDefinition')) return null;", ''],
};

for (const [name, [from, to]] of Object.entries(mutants)) {
  test(`the oracle fails a slicer with ${name}`, async () => {
    const source = readFileSync(new URL('./pipeline.ts', import.meta.url), 'utf8');
    assert.ok(source.includes(from), `pipeline.ts no longer holds the line this mutant removes: ${from}`);
    const file = new URL(`./pipeline.mutant-${process.pid}-${Math.abs(hash(name))}.ts`, import.meta.url);
    writeFileSync(file, source.replace(from, to));
    try {
      const mutant = (await import(file.href)) as { renderDocumentSafeHtmlInSlices: SlicedRender };
      const failures: string[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        const next = random(seed);
        try {
          await checkEquivalent(generatedHostile(next), `hostile seed ${seed}`, { render: mutant.renderDocumentSafeHtmlInSlices, sliceBytes: 1 + Math.floor(next() * 200), budgetMs: SMALLEST });
        } catch {
          failures.push(`seed ${seed}`);
          break;
        }
      }
      assert.ok(failures.length > 0, `the oracle passed all ${SEEDS} seeds against a slicer with ${name}`);
    } finally {
      rmSync(file, { force: true });
    }
  });
}

// The same for the parse (parse/chunked.ts): the guards that make a cut safe, each removed in turn. The check
// on the last slice for front matter that never closes only moves a document that was never cut from `slices`
// to `whole` in the stats (one slice is the whole parse), so it changes no byte; `chunked.test.ts` holds it.
const parseMutants: Record<string, [from: string, to: string]> = {
  'the fresh-line proof dropped': ['&& fresh(bytes, prior, at)', ''],
  'the front matter opened check dropped': ["const opened = !frontmatter || restart > 0 || region.blocks[0]?.type === 'frontmatter';", 'const opened = true;'],
};

for (const [name, [from, to]] of Object.entries(parseMutants)) {
  test(`the oracle fails a parse in slices with ${name}`, async () => {
    const source = readFileSync(new URL('../parse/chunked.ts', import.meta.url), 'utf8');
    assert.ok(source.includes(from), `chunked.ts no longer holds the line this mutant removes: ${from}`);
    const file = new URL(`../parse/chunked.mutant-${process.pid}-${Math.abs(hash(name))}.ts`, import.meta.url);
    writeFileSync(file, source.replace(from, to));
    try {
      const mutant = (await import(file.href)) as { parseMarkdownChunked: typeof import('../parse/chunked.ts').parseMarkdownChunked };
      let failed = false;
      for (const [label, document] of writtenOut()) {
        for (const sliceBytes of [16, 64]) {
          try {
            await checkEquivalent(document, `${label} @${sliceBytes}`, { parse: mutant.parseMarkdownChunked, sliceBytes });
          } catch {
            failed = true;
          }
        }
      }
      for (let seed = 1; !failed && seed <= SEEDS; seed++) {
        for (const make of [generated, generatedHostile]) {
          const next = random(seed);
          try {
            await checkEquivalent(make(next), `${make.name} seed ${seed}`, { parse: mutant.parseMarkdownChunked, sliceBytes: 1 + Math.floor(next() * 200), budgetMs: SMALLEST });
          } catch {
            failed = true;
          }
        }
      }
      assert.ok(failed, `the oracle passed every document against a parse in slices with ${name}`);
    } finally {
      rmSync(file, { force: true });
    }
  });
}

function hash(value: string): number {
  let h = 0;
  for (const c of value) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return h;
}
