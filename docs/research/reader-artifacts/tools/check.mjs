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

// coverage.json: every unit of the handbook has exactly one disposition, and it agrees with the board.
const coveragePath = join(root, 'coverage.json');
const DISPOSITIONS = ['story', 'existing', 'applied', 'partial', 'deferred', 'declined', 'default'];
if (!existsSync(coveragePath)) fail('handbook', 'coverage.json is missing');
else {
  const coverage = JSON.parse(readFileSync(coveragePath, 'utf8'));
  const units = coverage.units ?? [];
  const read = (f) => readFileSync(join(root, f), 'utf8');
  const section = (text, heading) => (text.split(`\n## ${heading}\n`)[1] ?? '').split('\n## ')[0];
  const firstCells = (text) => text.split('\n').filter((l) => /^\| /.test(l) && !/^\|\s*-/.test(l))
    .map((l) => l.split('|')[1].trim()).filter((c) => !['Setting', 'Operation'].includes(c));
  const spec = read('10-spec.md');
  const expected = {
    default: firstCells(section(spec, 'Defaults and ranges')),
    operation: firstCells(section(spec, 'Operations')),
    rule: [...section(spec, 'Coupling rules').matchAll(/^(\d+)\. \*\*/gm)].map((m) => m[1]),
    verification: [...section(spec, 'Verification').matchAll(/^\*\*([^*]+)\*\*/gm)].map((m) => m[1]),
    proposal: readdirSync(join(root, 'proposals')).map((f) => /^(P\d\d)-/.exec(f)?.[1]).filter(Boolean),
    declined: [...section(read('stories.md'), 'Stories the evidence does not support filing').matchAll(/^- \*\*([^*]+)\*\*/gm)].map((m) => m[1]),
    taste: [...section(read('limits.md'), 'What remains taste').matchAll(/^- \*\*([^*]+)\*\*/gm)].map((m) => m[1]),
    'handbook-story': parseCsv(read('stories.csv')).slice(1).filter((r) => r.length > 1).map((r) => r[0]),
  };
  const ids = new Set();
  for (const x of units) {
    if (ids.has(x.id)) fail('coverage.json', `${x.id} is listed twice`);
    ids.add(x.id);
    if (!DISPOSITIONS.includes(x.disposition)) fail('coverage.json', `${x.id}: unknown disposition ${x.disposition}`);
    if (['story', 'existing', 'partial', 'default'].includes(x.disposition) && !x.keys?.length) fail('coverage.json', `${x.id}: ${x.disposition} names no key`);
    if (['deferred', 'partial'].includes(x.disposition) && !coverage.bundles?.[x.bundle]) fail('coverage.json', `${x.id}: ${x.disposition} names no known bundle`);
    if (x.disposition === 'declined' && !x.note) fail('coverage.json', `${x.id}: declined without a reason`);
    if (!expected[x.kind]) fail('coverage.json', `${x.id}: unknown kind ${x.kind}`);
  }
  for (const [kind, specs] of Object.entries(expected)) {
    if (!specs.length) fail('coverage.json', `found no ${kind} units in the handbook; has a heading moved?`);
    const listed = units.filter((x) => x.kind === kind).map((x) => x.spec);
    for (const s of specs) {
      const n = listed.filter((l) => l === s).length;
      if (n !== 1) fail('coverage.json', `${kind} "${s}" has ${n} dispositions, expected 1`);
    }
    for (const l of listed) if (!specs.includes(l)) fail('coverage.json', `${kind} "${l}" is not in the handbook`);
  }
  // Keys must be board rows, and a card that names its units must name exactly the ledger's.
  const repo = join(root, '..', '..', '..');
  const boardKeys = new Set(parseCsv(readFileSync(join(repo, 'docs/plan/jira-issues.csv'), 'utf8')).slice(1).map((r) => r[0]));
  const byKey = {};
  for (const x of units) for (const k of x.keys ?? []) {
    if (!boardKeys.has(k)) fail('coverage.json', `${x.id}: ${k} is not a row in docs/plan/jira-issues.csv`);
    (byKey[k] ??= []).push(x.id);
  }
  for (const [k, list] of Object.entries(byKey)) {
    const card = join(repo, 'docs/plan/tasks', `${k}.md`);
    const line = existsSync(card) ? /^\*\*Handbook units closed by this story\*\*.*$/m.exec(readFileSync(card, 'utf8'))?.[0] : null;
    if (!line) continue;
    const named = [...line.matchAll(/`([A-Za-z0-9.-]+)`/g)].map((m) => m[1]).filter((id) => id !== 'coverage.json');
    const missing = list.filter((id) => !named.includes(id));
    const extra = named.filter((id) => !list.includes(id));
    if (missing.length || extra.length) fail(`docs/plan/tasks/${k}.md`, `units disagree with coverage.json (missing ${missing.join(', ') || 'none'}; extra ${extra.join(', ') || 'none'})`);
  }
}

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log(`reader-artifacts handbook: ${chapters.length} chapters, footnotes, spec, ledger and stories check out.`);
