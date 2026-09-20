// Asserts the four MARXY-130 format samples have the shape the story asked for,
// that fixtures/ gained only additions, and that the dark 960 px 2× captures exist.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const corpus = join(root, 'fixtures/corpus');

export const SAMPLES = [
  {
    file: '16-api-reference.md',
    sampleOf: /API reference/i,
    png: '16-api-reference-dark-960-2x.png',
  },
  {
    file: '17-changelog.md',
    sampleOf: /changelog/i,
    png: '17-changelog-dark-960-2x.png',
  },
  {
    file: '18-agent-transcript.md',
    sampleOf: /AI\/agent|agent (transcript|artifact)/i,
    png: '18-agent-transcript-dark-960-2x.png',
  },
  {
    file: '19-source-file.md',
    sampleOf: /source file/i,
    png: '19-source-file-dark-960-2x.png',
  },
];

const FETCHABLE = /<img\b|!\[[^\]]*]\(|\bsrc\s*=|\bsrcset\s*=|@import\b/i;
const WIDTH = 960;
const DPR = 2;

export function pngSize(bytes) {
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export function fenceLangs(source) {
  const langs = [];
  const re = /^```([a-zA-Z0-9_-]*)/gm;
  let m;
  while ((m = re.exec(source))) langs.push(m[1] || '');
  return langs;
}

export function checkSample(sample, source) {
  const first = source.split(/\r?\n/, 1)[0] ?? '';
  assert.match(first, /^<!-- .+ -->$/, `${sample.file} must begin with one HTML comment naming what it is a sample of`);
  assert.match(first, sample.sampleOf, `${sample.file} first line must name the format it samples`);
  assert.doesNotMatch(source, FETCHABLE, `${sample.file} must not reference a remote image or any URL that would be fetched`);

  if (sample.file === '16-api-reference.md') {
    const nested = source.split('\n').some((line) => /^\s{6,}-\s/.test(line));
    assert.ok(nested, `${sample.file} needs a list nested at least three levels`);
    const tables = (source.match(/^\s*\|[-: ]+\|/gm) || []).length;
    assert.ok(tables >= 2, `${sample.file} has ${tables} option tables; need at least two`);
    const codes = (source.match(/`[^`\n]+`/g) || []).length;
    assert.ok(codes >= 20, `${sample.file} has ${codes} inline code spans; need many`);
  }

  if (sample.file === '17-changelog.md') {
    const versions = source.match(/^## \[[0-9][^\]]*\][^\n]*20\d\d-\d\d-\d\d/gm) || [];
    assert.ok(versions.length >= 4, `${sample.file} has ${versions.length} version headings with dates; need several`);
    const bullets = source.match(/^[-*] /gm) || [];
    assert.ok(bullets.length >= 12, `${sample.file} has ${bullets.length} bullets; need dense short ones`);
    assert.match(source, /https:\/\/example\.invalid\//, `${sample.file} must contain compare/release links`);
  }

  if (sample.file === '18-agent-transcript.md') {
    const langs = new Set(fenceLangs(source).filter(Boolean));
    assert.ok(langs.size >= 3, `${sample.file} has languages [${[...langs]}]; need several`);
    const longPath = source.split('\n').some((line) => /\/Users\/\S{40,}/.test(line) && !/\s/.test(line.trim().slice(0, 80)));
    assert.ok(
      source.includes('/Users/reader/Dev/shelf/packages/index/src/scan/build-row-from-stat.ts')
        || longPath,
      `${sample.file} must contain a long unbroken path`,
    );
    assert.match(source, /^## /m, `${sample.file} needs interleaved prose headings, not only fences`);
  }

  if (sample.file === '19-source-file.md') {
    const opened = fenceLangs(source).filter(Boolean);
    assert.equal(opened.length, 1, `${sample.file} must be one long fence, found ${opened.length}`);
    const long = source.split('\n').filter((line) => line.length > 120);
    assert.ok(long.length >= 3, `${sample.file} has ${long.length} lines past 120 characters; need several`);
  }
}

export function checkFixtureDiff(nameStatus, untracked = []) {
  const rows = nameStatus.split('\n').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    return { status: line.slice(0, tab === -1 ? 1 : tab).trim(), file: line.slice(tab + 1) };
  });
  const modified = rows.filter((r) => r.status !== 'A');
  assert.deepEqual(modified, [], `fixtures/ may only add files; not additions: ${modified.map((r) => `${r.status} ${r.file}`).join(', ')}`);
  for (const name of untracked) {
    assert.ok(
      SAMPLES.some((s) => name.endsWith(s.file)) || name.endsWith('check-format-samples.mjs'),
      `unexpected untracked fixture ${name}`,
    );
  }
  return rows;
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

const sources = new Map();
for (const sample of SAMPLES) {
  const path = join(corpus, sample.file);
  assert.ok(existsSync(path), `missing ${sample.file}`);
  const source = readFileSync(path, 'utf8');
  sources.set(sample.file, source);
  checkSample(sample, source);
}

const nameStatus = git(['diff', '--name-status', 'origin/main...HEAD', '--', 'fixtures/']);
const vsMain = git(['diff', '--name-status', 'origin/main', '--', 'fixtures/']);
const untracked = git(['ls-files', '--others', '--exclude-standard', '--', 'fixtures/'])
  .split('\n')
  .filter(Boolean);
checkFixtureDiff(nameStatus + vsMain, untracked);

for (const sample of SAMPLES) {
  const pngPath = join(here, sample.png);
  assert.ok(existsSync(pngPath), `missing capture ${sample.png}; run docs/taste-review/2026-09-marxy-130/render.mjs`);
  const size = pngSize(readFileSync(pngPath));
  assert.ok(size, `${sample.png} is not a PNG`);
  assert.equal(size.width, WIDTH * DPR, `${sample.png} is ${size.width} px wide; need ${WIDTH}×${DPR}`);
}

console.log(
  `format-samples check ok: ${SAMPLES.map((s) => s.file).join(', ')}; `
    + `fixtures/ diff is additions only; ${SAMPLES.length} dark ${WIDTH} px ${DPR}× captures`,
);
