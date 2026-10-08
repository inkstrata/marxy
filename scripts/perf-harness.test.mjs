import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  PALETTE_SIZES, buildRecord, commitOf, corpusFiles, detailMs, firstMarks, generateLarge, generateTranscript, liveReloadMs, median, openRenderMs,
  palettePerf, parseArgs, parseSize, percentile, stageDeltas, summaryTable,
} from './perf-harness.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('generateLarge is deterministic and at least the size asked for', () => {
  for (const size of ['256k', '1m']) {
    const target = parseSize(size);
    const a = generateLarge(target);
    const b = generateLarge(target);
    assert.equal(sha(a), sha(b), `${size}: two calls, two different documents`);
    assert.ok(a.length >= target, `${size}: ${a.length} bytes, under ${target}`);
  }
  // The sizes of the audit's generated documents (05-performance-audit.md §9.1).
  assert.equal(generateLarge(parseSize('256k')).length, 264_940);
  assert.equal(generateLarge(parseSize('1m')).length, 1_059_760);
});

test('generateLarge repeats the long technical document with one blank line between copies', () => {
  const source = readFileSync(new URL('../fixtures/corpus/01-long-technical.md', import.meta.url), 'utf8');
  const text = new TextDecoder().decode(generateLarge(1));
  assert.equal(text, `${source}\n\n`);
  const two = new TextDecoder().decode(generateLarge(generateLarge(1).length + 1));
  assert.equal(two, text + text);
});

test('generateTranscript repeats the agent transcript as numbered turns, deterministically, to at least the size (B-25)', () => {
  const turn = readFileSync(new URL('../fixtures/corpus/18-agent-transcript.md', import.meta.url), 'utf8');
  for (const size of ['64k', '256k', '1m']) {
    const target = parseSize(size);
    const a = generateTranscript(target);
    assert.equal(sha(a), sha(generateTranscript(target)), `${size}: two calls, two different documents`);
    assert.ok(a.length >= target, `${size}: ${a.length} bytes, under ${target}`);
  }
  const text = new TextDecoder().decode(generateTranscript(1));
  assert.equal(text, `## Turn 1\n\n${turn}\n`);
  const two = new TextDecoder().decode(generateTranscript(Buffer.byteLength(text) + 1));
  assert.equal(two, `${text}## Turn 2\n\n${turn}\n`);
});

test('--transcript takes sizes, as --large does', () => {
  assert.deepEqual(parseArgs(['--transcript', '64k,256k,1m']).transcript, ['64k', '256k', '1m']);
  assert.deepEqual(parseArgs([]).transcript, []);
});

test('parseSize knows the four names and a plain byte count, and nothing else', () => {
  assert.equal(parseSize('64k'), 65_536);
  assert.equal(parseSize('256k'), 262_144);
  assert.equal(parseSize('1m'), 1_048_576);
  assert.equal(parseSize('5m'), 5_242_880);
  assert.equal(parseSize('1000'), 1000);
  assert.throws(() => parseSize('2g'), /unknown size/);
});

test('stageDeltas maps the app marks to the columns of the audit table', () => {
  const marks = { script_start: -10, file_read: 5, parsed: 25, rendered: 32, fonts_ready: 55, render: 57, painted: 63, first_text: 63, typeset_viewport: 90 };
  assert.deepEqual(stageDeltas(marks, { typeset_viewport: 'ms=13.4 hyphenation_load_ms=2.0 set=12' }), {
    parse: 20, render: 7, layout_fonts: 23, grid: 2, paint_wait: 6, first_text: 63, typeset_viewport: 13.4,
  });
});

test('stageDeltas leaves out a stage whose marks are missing', () => {
  assert.deepEqual(stageDeltas({ file_read: 0, parsed: 10 }), { parse: 10 });
  assert.deepEqual(stageDeltas({ file_read: 0, parsed: 10 }, { typeset_viewport: 'hyphenation_load_ms=2.0' }), { parse: 10 });
});

test('median takes the middle of an odd count and the mean of the middle two of an even one', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([7]), 7);
  assert.ok(Number.isNaN(median([])));
});

// A-03: the nightly record. One launch's canned shell `mark` calls, as the page hands them back
// ([name, epoch ms, detail]); the harness turns them into the record the nightly job keeps.
const T0 = 1_000_000;
const LAUNCH = [
  ['script_start', T0 - 30], ['file_read', T0 + 8], ['parsed', T0 + 40], ['rendered', T0 + 60],
  ['first_screen', T0 + 60, 'blocks=40 bytes=9000'], ['fonts_ready', T0 + 80], ['render', T0 + 84, 'blocks=40 chars=9000 heading=Stack'],
  ['painted', T0 + 100, 'frames=2'], ['first_text', T0 + 100], ['typeset_viewport', T0 + 140, 'ms=31.5 hyphenation_load_ms=2.0 set=12'],
  ['content_complete', T0 + 900, 'ms=820.0 chunks=6'], ['live_reload', T0 + 1300, 'ms=84.2'],
];
const OPEN_AT = T0 + 5000;
const OPEN = [['render', T0 + 84, 'blocks=3'], ['file_read', OPEN_AT + 2], ['render', OPEN_AT + 61, 'blocks=40']];

function cannedDocument() {
  const { marks, details } = firstMarks(LAUNCH, T0);
  const stages = { ...stageDeltas(marks, details), live_reload: liveReloadMs(LAUNCH, T0 + 1000), open_render: openRenderMs(OPEN, OPEN_AT) };
  return { file: '01-long-technical.md', bytes: 20_378, runs: 1, stages };
}
const PALETTE = PALETTE_SIZES.map((entries) => ({ entries, samples: 200, prepare_ms: 1, p50_ms: 1, p95_ms: 2, max_ms: 3 }));
const ALL = { reload: true, openSecond: true, palette: true };

test('a record from a canned mark list holds every measurement the nightly job asks for', () => {
  const record = buildRecord({
    meta: { date: '2026-10-02T04:00:00.000Z', commit: 'abc123', runner: 'ubuntu-latest', node: 'v24.0.0', webkit: '26.0', runs: 1 },
    documents: [cannedDocument()],
    palette: PALETTE,
    requested: ALL,
  });
  for (const key of ['date', 'commit', 'runner', 'node', 'webkit', 'note', 'documents', 'palette', 'missing']) assert.ok(key in record, `the record has no ${key}`);
  assert.match(record.note, /ADR-0032/);
  assert.match(record.note, /trend/);
  const [doc] = record.documents;
  assert.deepEqual(doc.stages, {
    parse: 32, render: 20, layout_fonts: 20, grid: 4, paint_wait: 16,
    first_screen: 60, first_text: 100, typeset_viewport: 31.5, content_complete: 900,
    live_reload: 84.2, open_render: 61,
  });
  assert.deepEqual(record.palette.map((r) => [r.entries, r.p95_ms]), [[5_000, 2], [20_000, 2], [50_000, 2]]);
  assert.deepEqual(record.missing, []);
});

test('a requested measurement with no sample is named in missing; one not requested is not', () => {
  const doc = cannedDocument();
  delete doc.stages.live_reload;
  delete doc.stages.typeset_viewport;
  const record = buildRecord({ documents: [doc], palette: PALETTE.slice(0, 2), requested: ALL });
  assert.deepEqual(record.missing, ['01-long-technical.md: typeset_viewport', '01-long-technical.md: live_reload', 'palette 50000: p95_ms']);
  assert.deepEqual(buildRecord({ documents: [{ ...doc, stages: { first_text: 9, typeset_viewport: 1 } }] }).missing, []);
  assert.deepEqual(buildRecord({ documents: [{ file: 'x.md', stages: { first_text: null } }] }).missing, ['x.md: first_text', 'x.md: typeset_viewport']);
});

test('live reload and open → render read the marks made after their own event, not before', () => {
  assert.equal(liveReloadMs(LAUNCH, T0 + 1301), undefined);
  assert.equal(liveReloadMs([['live_reload', T0, 'ms=5.0'], ['live_reload', T0 + 10, 'ms=7.5']], T0 + 1), 7.5);
  // The boot's own render comes first in the list; the open's is the one after the call.
  assert.equal(openRenderMs(OPEN, OPEN_AT), 61);
  assert.equal(openRenderMs(OPEN, OPEN_AT + 100), undefined);
  assert.equal(detailMs('blocks=3'), undefined);
});

test('stageDeltas reports first_screen and content_complete since start, and leaves out content_complete when there was none', () => {
  const { marks, details } = firstMarks(LAUNCH.filter(([name]) => name !== 'content_complete'), T0);
  const stages = stageDeltas(marks, details);
  assert.equal(stages.first_screen, 60);
  assert.ok(!('content_complete' in stages));
});

test('--files corpus is every numbered markdown file but the empty one', () => {
  const files = corpusFiles();
  assert.ok(files.includes('01-long-technical.md') && files.includes('32-long-reference.md'));
  assert.ok(!files.includes('11-empty.md') && !files.includes('README.md'));
  assert.ok(files.every((f) => /^\d+-.*\.md$/.test(f)));
  assert.deepEqual(parseArgs(['--files', 'corpus']).files, files);
  const opts = parseArgs(['--files', '01-long-technical.md', '--large', '256k', '--reload', '--open-second', '--palette', '--record', 'r.json']);
  assert.deepEqual([opts.reload, opts.openSecond, opts.palette, opts.record], [true, true, true, 'r.json']);
  assert.throws(() => parseArgs(['--grid-only', '--reload']), /grid-only/);
});

test('palettePerf times real searches and reports p50 and p95 per size', async () => {
  const rows = await palettePerf([300, 600], 20);
  assert.deepEqual(rows.map((r) => r.entries), [300, 600]);
  for (const r of rows) {
    assert.ok(Number.isFinite(r.p50_ms) && Number.isFinite(r.p95_ms) && r.p95_ms >= r.p50_ms, JSON.stringify(r));
    assert.ok(r.hits > 0, 'the queries matched nothing');
  }
});

test('the summary table has one row per document and per palette size', () => {
  const record = buildRecord({ meta: { runs: 5 }, documents: [cannedDocument()], palette: PALETTE, requested: ALL });
  const table = summaryTable(record);
  assert.match(table, /\| 01-long-technical\.md \| 20378 \| 60 \| 100 \| 31\.5 \| 900 \| 84\.2 \| 61 \|/);
  assert.match(table, /\| 50000 \| 1 \| 1 \| 2 \|/);
  assert.match(summaryTable({ ...record, missing: ['x: first_text'] }), /No sample:\*\* x: first_text/);
});

test('percentile is nearest-rank', () => {
  const xs = Array.from({ length: 200 }, (_, i) => 200 - i);
  assert.equal(percentile(xs, 95), 190);
  assert.equal(percentile(xs, 50), 100);
  assert.ok(Number.isNaN(percentile([], 95)));
});

// The nightly jobs cannot run on a pull request, so this is what catches the workflow's command and
// the harness drifting apart: the flags nightly.yml passes must parse, and ask for every measurement.
const workflow = (name) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
const jobBlock = (text, job) => {
  const at = text.indexOf(`\n  ${job}:\n`);
  if (at < 0) return undefined;
  const rest = text.slice(at + 1);
  const next = rest.slice(1).search(/\n  [A-Za-z0-9_-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
};

test('nightly.yml runs the harness with flags it accepts, and the start-up measurement', () => {
  const nightly = workflow('nightly.yml');
  const perf = jobBlock(nightly, 'perf-harness');
  assert.ok(perf, 'nightly.yml has no perf-harness job');
  const run = /run: pnpm perf (.+)$/m.exec(perf)?.[1];
  assert.ok(run, 'perf-harness does not run pnpm perf');
  const opts = parseArgs(run.replace(/"\$GITHUB_STEP_SUMMARY"/, 'summary.md').split(/\s+/));
  assert.deepEqual(opts.files, corpusFiles());
  assert.deepEqual(opts.large, ['256k', '1m']);
  assert.deepEqual([opts.reload, opts.openSecond, opts.palette, opts.record], [true, true, true, 'results/perf-nightly.json']);
  const startup = jobBlock(nightly, 'startup-macos');
  assert.ok(startup, 'nightly.yml has no startup-macos job');
  assert.match(startup, /run: node scripts\/measure-startup\.mjs\n/);
});

test('the record names the commit it measured', () => {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(commitOf(), head);
});
