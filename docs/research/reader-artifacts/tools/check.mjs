// Checks the Reader Artifacts Handbook for the mechanical half of its own standard, so a reviewer is
// left with judgement only. Run from the repository root:
//
//   node docs/research/reader-artifacts/tools/check.mjs
//
// It fails when a chapter cites a footnote it never defines or defines one it never cites, when a
// chapter lacks the grade legend, when a spec line has no grade or no chapter link, when a ledger
// source lacks a URL or an access date, or when stories.csv strays from the board's columns or names
// no test or gate in an acceptance criterion. It reads files only; it fetches nothing.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const fail = (where, what) => problems.push(`${where}: ${what}`);

const GRADE_LEGEND = 'Evidence grades: **[A]**';
const CHAPTER = /^\d\d-[a-z-]+\.md$/;
const chapters = readdirSync(root).filter((f) => CHAPTER.test(f)).sort();

for (const expected of ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11']) {
  if (!chapters.some((f) => f.startsWith(expected + '-'))) fail('handbook', `chapter ${expected} is missing`);
}
for (const extra of ['README.md', 'gaps.md', 'stories.csv', 'stories.md', 'limits.md']) {
  if (!existsSync(join(root, extra))) fail('handbook', `${extra} is missing`);
}

/** Footnote references outside fenced code and inline code. */
function footnotes(text) {
  const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const defined = new Set();
  const cited = new Set();
  for (const line of prose.split('\n')) {
    const def = /^\[\^([^\]]+)\]:/.exec(line);
    if (def) defined.add(def[1]);
    const body = def ? line.slice(def[0].length) : line;
    for (const m of body.matchAll(/\[\^([^\]]+)\](?!:)/g)) cited.add(m[1]);
  }
  return { defined, cited };
}

for (const file of [...chapters, 'README.md', 'gaps.md', 'stories.md', 'limits.md']) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, 'utf8');
  if (CHAPTER.test(file) && !text.includes(GRADE_LEGEND)) fail(file, 'no evidence-grade legend under the title');
  const { defined, cited } = footnotes(text);
  for (const id of cited) if (!defined.has(id)) fail(file, `cites [^${id}] but never defines it`);
  for (const id of defined) if (!cited.has(id)) fail(file, `defines [^${id}] but never cites it`);
  for (const m of text.matchAll(/\]\(((?:\.\.\/)?[\w./-]+\.md)(#[^)]*)?\)/g)) {
    if (m[1].startsWith('http')) continue;
    if (!existsSync(join(root, m[1]))) fail(file, `links to ${m[1]}, which does not exist`);
  }
}

// Every spec line carries a grade and names the chapter that argues for it.
const specFile = chapters.find((f) => f.startsWith('10-'));
if (specFile) {
  const spec = readFileSync(join(root, specFile), 'utf8');
  // Only tables with a Grade column are held to "graded and linked"; the overrides table has none.
  const lines = spec.split('\n');
  const tableRows = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\|.*\bGrade\b.*\|/.test(lines[i]) || !/^\|\s*-/.test(lines[i + 1] ?? '')) continue;
    for (let j = i + 2; j < lines.length && lines[j].startsWith('|'); j++) tableRows.push(lines[j]);
  }
  let graded = 0;
  for (const row of tableRows) {
    const hasGrade = /\*\*\[(A|B|C|D|X)\]\*\*|Measured/.test(row);
    const hasLink = /\]\(0\d-[a-z-]+\.md/.test(row) || /\]\(\.\.\/reader-typography\//.test(row);
    if (!hasGrade) fail(specFile, `spec row has no grade: ${row.slice(0, 80)}`);
    if (!hasLink) fail(specFile, `spec row links no chapter: ${row.slice(0, 80)}`);
    graded++;
  }
  if (graded < 20) fail(specFile, `only ${graded} spec rows; expected the whole handbook distilled`);
}

// The ledger: every source has a URL and an access date.
const sourcesFile = chapters.find((f) => f.startsWith('11-'));
if (sourcesFile) {
  const ledger = readFileSync(join(root, sourcesFile), 'utf8');
  const entries = ledger.split('\n').filter((l) => /^\*\*.+\*\*/.test(l));
  for (const entry of entries) {
    const block = ledger.slice(ledger.indexOf(entry)).split('\n\n')[0];
    if (!/https?:\/\//.test(block)) fail(sourcesFile, `source has no URL: ${entry.slice(0, 70)}`);
    if (!/Accessed 20\d\d-\d\d-\d\d|accessed 20\d\d-\d\d-\d\d/.test(block)) fail(sourcesFile, `source has no access date: ${entry.slice(0, 70)}`);
  }
  if (entries.length < 40) fail(sourcesFile, `only ${entries.length} sources in the ledger`);
}

// Chapter sidecars: sources carry url, accessed and grade.
const dataDir = join(root, 'data');
if (existsSync(dataDir)) {
  for (const f of readdirSync(dataDir).filter((n) => /^\d\d\.json$/.test(n))) {
    const data = JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
    for (const s of data.sources ?? []) {
      if (!s.url) fail(`data/${f}`, `source ${s.id} has no url`);
      if (!/^20\d\d-\d\d-\d\d$/.test(s.accessed ?? '')) fail(`data/${f}`, `source ${s.id} has no access date`);
    }
  }
}

// stories.csv: the board's nine columns; every acceptance criterion names a check.
const COLUMNS = ['Key', 'Type', 'Summary', 'Epic', 'Parent', 'Labels', 'Paths', 'Description', 'Acceptance'];
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const storiesPath = join(root, 'stories.csv');
if (existsSync(storiesPath)) {
  const [header, ...rows] = parseCsv(readFileSync(storiesPath, 'utf8'));
  if (header.join(',') !== COLUMNS.join(',')) fail('stories.csv', `header is not the board's: ${header.join(',')}`);
  const CHECK = /\.test\.(m?[jt]s)|gate:[a-z-]+|gate-[a-z-]+\.mjs|check[-:][a-z-]+|grid\.test|golden|probe\.mjs|tools\/check\.mjs|pnpm test|cargo test/;
  for (const r of rows.filter((x) => x.length > 1)) {
    const key = r[0];
    if (!/^MARXY-NEW-ra-[a-z0-9-]+$/.test(key)) fail('stories.csv', `${key}: keys are MARXY-NEW-ra-<slug> until jira.mjs sync --new assigns them`);
    if (r.length !== COLUMNS.length) fail('stories.csv', `${key}: ${r.length} cells, expected ${COLUMNS.length}`);
    const criteria = (r[8] ?? '').split(/(?:^|;\s*|\s)(?=\d+\.\s)/).filter((c) => /^\d+\./.test(c.trim()));
    if (criteria.length === 0) fail('stories.csv', `${key}: no numbered acceptance criteria`);
    for (const c of criteria) if (!CHECK.test(c)) fail('stories.csv', `${key}: criterion names no test or gate: ${c.trim().slice(0, 70)}`);
    if (!r[6]?.trim()) fail('stories.csv', `${key}: no Paths`);
  }
}

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log(`reader-artifacts handbook: ${chapters.length} chapters, footnotes, spec, ledger and stories check out.`);
