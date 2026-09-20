// MARXY-23 step 8: rag on the rendered page, the engine's own wrapping against the typesetter, over the
// corpus in Playwright WebKit with the default theme and the bundled faces at 17 px on a 68 ch measure.
// Same metric definitions as the MARXY-19 model (scripts/rag-model.mjs), read from real line boxes.
//
//   node packages/typeset/scripts/measure-rendered.mjs            prints the table
//   node packages/typeset/scripts/measure-rendered.mjs --write    writes it into RESEARCH.md
//   node packages/typeset/scripts/measure-rendered.mjs --json     one object per document

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { ragMetrics } from './rag-model.mjs';
import { readLines, renderCorpus, startHarness } from '../test/harness.mjs';

const corpus = new URL('../../../fixtures/corpus/', import.meta.url);
const research = new URL('../RESEARCH.md', import.meta.url);
const files = readdirSync(corpus).filter((f) => f.endsWith('.md')).sort();
const OPTS = { shortLineFraction: 0.1, badnessStretchEm: 2 };
const HYPHENATE = process.env.HYPHENATE === '1' || process.argv.includes('--hyphenate');
const ENGINE = { name: process.env.ENGINE ?? 'ragged', stretch: Number(process.env.STRETCH ?? 2), hyphenate: HYPHENATE };
const STRETCHES = [ENGINE.stretch];
/** The alternatives the decision was made between, each pooled over the same paragraphs. */
const ALTERNATIVES = [
  { label: 'engine wrapping (WebKit, `text-wrap: auto`)', css: '' },
  { label: 'WebKit `text-wrap: pretty`', css: '.marxy-article :is(p, li) { text-wrap: pretty; }' },
  { label: 'justif/core, 0.6 em per word space (MARXY-19 model)', engine: { name: 'justif', stretch: 2 } },
  { label: 'ragged breaker, 1 em per line', engine: { name: 'ragged', stretch: 1 } },
  { label: '**ragged breaker, 2 em per line (shipped)**', engine: { name: 'ragged', stretch: 2 } },
  { label: 'ragged breaker, 3 em per line', engine: { name: 'ragged', stretch: 3 } },
];

const harness = await startHarness();
const rows = [];
const pooled = { native: [], set: [] };
let measure = 0;
const totals = { paragraphs: 0, typeset: 0, fallbacks: 0, short: 0, viewportMs: [], reasons: {} };
for (const file of files) {
  const page = await harness.open(renderCorpus(file));
  const native = await readLines(page);
  const stats = await page.evaluate(async (engine) => {
    const c = window.typeset.attach(document.getElementById('doc'), { lineBox: window.lineBox, glueStretchEm: 0.6, raggedStretchEm: engine.stretch, engine: engine.name, hyphenate: engine.hyphenate, lastLineMinWidth: 0.33, hanging: 'none', scheduler: window.immediateScheduler() });
    await c.done;
    return JSON.parse(JSON.stringify(c.stats));
  }, ENGINE);
  const set = await readLines(page);
  await page.close();
  // Only paragraphs of more than one line say anything about the rag; both columns use the same ones.
  const pairs = native.map((n, i) => [n, set[i]]).filter(([n, s]) => n.widths.length > 1 || s.widths.length > 1);
  if (pairs.length === 0) continue;
  measure = pairs[0][0].measure;
  const nm = ragMetrics(pairs.map(([n]) => n.widths), measure, OPTS);
  const sm = ragMetrics(pairs.map(([, s]) => s.widths), measure, OPTS);
  pooled.native.push(...pairs.map(([n]) => n.widths));
  pooled.set.push(...pairs.map(([, s]) => s.widths));
  rows.push({ file, paragraphs: pairs.length, native: nm, set: sm, linesNative: pairs.reduce((a, [n]) => a + n.widths.length, 0), linesSet: pairs.reduce((a, [, s]) => a + s.widths.length, 0), stats });
  for (const k of ['paragraphs', 'typeset', 'fallbacks', 'short']) totals[k] += stats[k];
  totals.viewportMs.push({ file, ms: stats.viewportMs });
  for (const [k, v] of Object.entries(stats.reasons)) totals.reasons[k] = (totals.reasons[k] ?? 0) + v;
}
const alternatives = [];
for (const alt of HYPHENATE ? [] : ALTERNATIVES) {
  const pool = [];
  for (const file of files) {
    const page = await harness.open(renderCorpus(file), { extraCss: alt.css ?? '' });
    if (alt.engine) {
      await page.evaluate(async (engine) => {
        const c = window.typeset.attach(document.getElementById('doc'), { lineBox: window.lineBox, glueStretchEm: 0.6, raggedStretchEm: engine.stretch, engine: engine.name, hyphenate: engine.hyphenate === true, lastLineMinWidth: 0.33, hanging: 'none', scheduler: window.immediateScheduler() });
        await c.done;
      }, alt.engine);
    }
    pool.push(...(await readLines(page)).map((p) => p.widths).filter((w) => w.length > 1));
    await page.close();
  }
  alternatives.push({ label: alt.label, lines: pool.reduce((a, w) => a + w.length, 0), m: ragMetrics(pool, measure, OPTS) });
}
await harness.close();

const all = { native: ragMetrics(pooled.native, measure, OPTS), set: ragMetrics(pooled.set, measure, OPTS) };
const pct = (a, b) => `${(((b - a) / a) * 100).toFixed(1)}%`;
const fmt = (m) => `${m.cv.toFixed(4)} | ${m.shortLines} (${m.shortLineRate.toFixed(1)}%) | ${m.meanShortfall.toFixed(1)}`;

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ rows, all, totals }, null, 2));
  process.exit(0);
}

const lines = [
  `Rendered in Playwright WebKit (\`${JSON.stringify(process.versions.node)}\` Node), default theme, bundled Literata at 17 px, measure ${measure.toFixed(1)} px (68 ch), glue stretch ${STRETCHES[0]} em, hyphenation ${HYPHENATE ? 'on (en-us/en-gb)' : 'off'}. Widths are real line boxes, px; a line is short when its shortfall exceeds 10% of the measure. Last lines excluded.`,
  '',
  '| Document | Paras | Lines native → set | CV native | CV set | Short native | Short set |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...rows.filter((r) => r.native.cv !== null).map((r) => `| \`${r.file}\` | ${r.paragraphs} | ${r.linesNative} → ${r.linesSet} | ${r.native.cv.toFixed(4)} | ${r.set.cv.toFixed(4)} | ${r.native.shortLines} (${r.native.shortLineRate.toFixed(1)}%) | ${r.set.shortLines} (${r.set.shortLineRate.toFixed(1)}%) |`),
  `| **corpus** | **${pooled.native.length}** | **${pooled.native.reduce((a, w) => a + w.length, 0)} → ${pooled.set.reduce((a, w) => a + w.length, 0)}** | **${all.native.cv.toFixed(4)}** | **${all.set.cv.toFixed(4)}** (${pct(all.native.cv, all.set.cv)}) | **${all.native.shortLines} (${all.native.shortLineRate.toFixed(1)}%)** | **${all.set.shortLines} (${all.set.shortLineRate.toFixed(1)}%)** |`,
  ...(alternatives.length === 0 ? [] : [
    '',
    '',
    'Every alternative over the whole corpus, paragraphs of two or more lines, same measure:',
    '',
    '| Arrangement | Lines | CV | Short lines | Mean shortfall (px) |',
    '| --- | --- | --- | --- | --- |',
    ...alternatives.map((a) => `| ${a.label} | ${a.lines} | ${a.m.cv.toFixed(4)} | ${a.m.shortLines} (${a.m.shortLineRate.toFixed(1)}%) | ${a.m.meanShortfall.toFixed(1)} |`),
  ]),
  '',
  `Typesetter over the corpus: ${totals.paragraphs} candidates, ${totals.typeset} set, ${totals.short} already one line, ${totals.fallbacks} left to the engine${Object.keys(totals.reasons).length ? ` (${Object.entries(totals.reasons).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}. Viewport pass: ${totals.viewportMs.map((v) => `${v.file.replace('.md', '')} ${v.ms.toFixed(0)} ms`).join(', ')}.`,
];
const table = lines.join('\n');
if (process.argv.includes('--write')) {
  const text = readFileSync(research, 'utf8');
  const start = HYPHENATE
    ? '<!-- hyphenated-table:start (generated by packages/typeset/scripts/measure-rendered.mjs --hyphenate; do not edit by hand) -->'
    : '<!-- rendered-table:start (generated by packages/typeset/scripts/measure-rendered.mjs; do not edit by hand) -->';
  const end = HYPHENATE ? '<!-- hyphenated-table:end -->' : '<!-- rendered-table:end -->';
  const heading = HYPHENATE ? '## Rendered, hyphenation on (MARXY-24)' : '## Rendered (MARXY-23)';
  const block = `${start}\n\n${table}\n\n${end}`;
  const next = text.includes(start) ? text.replace(new RegExp(`${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end}`), block) : `${text.trimEnd()}\n\n${heading}\n\n${block}\n`;
  writeFileSync(research, next);
}
console.log(table);
