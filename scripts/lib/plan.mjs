// The one reader of the plan (ADR-0042, step 1). It returns the rows, dependencies and phases the
// fleet, Jira bridge and story checks act on, from the stories directory when there is one and from
// docs/plan/jira-issues.csv plus orchestration/deps.json otherwise, on disk or from git objects at a
// ref. It imports nothing else in the repo so that scripts/ and orchestration/ can both use it.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;

export const CSV_REL = 'docs/plan/jira-issues.csv';
export const DEPS_REL = 'orchestration/deps.json';
export const STORIES_DIR = 'docs/plan/stories';
export const EPICS_REL = 'docs/plan/epics.json';
/** The CSV's columns, in file order. A row is an object keyed by these. */
export const HEADERS = ['Key', 'Type', 'Summary', 'Epic', 'Parent', 'Labels', 'Paths', 'Description', 'Acceptance'];

export function parseCsv(t) { const rows = []; let row = [], cell = '', q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c; } if (cell || row.length) { row.push(cell); rows.push(row); } const [h, ...rest] = rows; return rest.filter(r => r.length === h.length).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); }

const quote = s => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
/** Rows as CSV text: a header line, one line per row, quoting only what needs it, final newline. */
export const toCsv = rows => [HEADERS.join(','), ...rows.map(r => HEADERS.map(h => quote(String(r[h] ?? ''))).join(','))].join('\n') + '\n';

const parseJson = (text, fallback) => { try { return JSON.parse(text ?? ''); } catch { return fallback; } };
const keyOrder = (a, b) => {
  const na = /^MARXY-(\d+)$/.exec(a), nb = /^MARXY-(\d+)$/.exec(b);
  if (na && nb) return Number(na[1]) - Number(nb[1]);
  if (na) return -1; // a numbered key sorts before a MARXY-NEW-<slug> placeholder
  if (nb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
};

/** A research entry in deps.json `research` as the row shape the board reads. */
const researchRow = ([k, v]) => ({ Key: k, Type: 'Research', Summary: v.summary, Paths: v.paths, Acceptance: 'A decision note committed at the path named in the summary, with measurements.', Labels: 'research', Parent: '' });

/**
 * The rows the board acts on: Story rows that are not placeholders (a placeholder has no Jira
 * issue yet and would be dispatched under a key `sync` then renames, MARXY-145), plus research.
 */
export function storyRows(all, research = {}, isPlaceholder = k => /^MARXY-NEW-/i.test(String(k ?? ''))) {
  const csv = all.filter(r => r.Type === 'Story' && !isPlaceholder(r.Key));
  return [...csv, ...Object.entries(research ?? {}).filter(([k]) => !k.startsWith('_')).map(researchRow)];
}

// A story file's fields as a CSV row, and the inverse of the columns the file does not carry.
const listOf = v => (Array.isArray(v) ? v : []).map(String);
function rowFromStory(o, file) {
  if (o == null || typeof o !== 'object' || Array.isArray(o)) throw new Error(`${file}: expected a JSON object`);
  if (typeof o.key !== 'string' || !o.key) throw new Error(`${file}: "key" is missing`);
  const text = f => (o[f] == null ? '' : String(o[f]));
  return {
    Key: o.key, Type: text('type'), Summary: text('summary'), Epic: text('epic'), Parent: text('parent'),
    Labels: listOf(o.labels).join(','), Paths: listOf(o.paths).join(', '), Description: text('description'), Acceptance: text('acceptance'),
  };
}

const shown = v => { const s = JSON.stringify(v); return s.length > 120 ? `${s.slice(0, 117)}...` : s; };

/**
 * Build the plan from a reader. `read(path)` is the file's text or null; `list(dir)` the paths of
 * the files under a directory, or []. Returns null when there is no plan at all.
 *
 * `{ form, csvText, all, deps }`: `all` is every row, epics included, in the CSV's column shape;
 * `deps` is `{ phases, deps, research }` (the raw deps.json, `_note` and all, in the CSV form).
 * While both forms exist they must agree, and a disagreement throws naming the key and field.
 */
export function planFrom({ read, list = () => [] }) {
  const storyFiles = list(STORIES_DIR + '/').filter(p => /\/[^/]+\.json$/.test(p)).sort();
  const epicsText = read(EPICS_REL);
  const csvText = read(CSV_REL);
  const depsText = read(DEPS_REL);
  const fromStories = storyFiles.length > 0 || epicsText != null;
  if (!fromStories && csvText == null && depsText == null) return null;

  const csvRows = csvText == null ? [] : parseCsv(csvText);
  const csvDeps = depsText == null ? null : parseJson(depsText, { deps: {}, phases: {} });
  if (!fromStories) return { form: 'csv', csvText, all: csvRows, deps: csvDeps ?? { deps: {}, phases: {}, research: {} } };

  const epics = epicsText == null ? [] : parseJson(epicsText, null);
  if (!Array.isArray(epics)) throw new Error(`${EPICS_REL}: expected a JSON array of epics`);
  const epicRows = epics.map(e => rowFromStory(e, EPICS_REL));
  const stories = storyFiles.map(f => {
    const o = parseJson(read(f), undefined);
    if (o === undefined) throw new Error(`${f}: not valid JSON`);
    const row = rowFromStory(o, f);
    if (f !== `${STORIES_DIR}/${row.Key}.json`) throw new Error(`${f}: the file name must be its key, ${row.Key}.json`);
    return { row, o };
  }).sort((a, b) => keyOrder(a.row.Key, b.row.Key));

  const phases = {}, depsMap = {};
  for (const { row, o } of stories) {
    if (o.phase != null && o.phase !== '') (phases[String(o.phase)] ??= []).push(row.Key);
    if (Array.isArray(o.depends) && o.depends.length) depsMap[row.Key] = o.depends.map(String);
  }
  const ordered = Object.fromEntries(Object.keys(phases).sort((a, b) => {
    const x = Number.isFinite(Number(a)), y = Number.isFinite(Number(b));
    return x && y ? Number(a) - Number(b) : x ? -1 : y ? 1 : a < b ? -1 : 1;
  }).map(p => [p, phases[p]]));
  const all = [...epicRows, ...stories.map(s => s.row)];
  const deps = { phases: ordered, deps: depsMap, research: {} };

  if (csvText != null) {
    const byKey = new Map(csvRows.map(r => [r.Key, r]));
    for (const r of all) {
      const c = byKey.get(r.Key);
      if (!c) throw new Error(`plan mismatch at ${r.Key}: it has a story file but no row in ${CSV_REL}`);
      for (const h of HEADERS) if ((r[h] ?? '') !== (c[h] ?? '')) throw new Error(`plan mismatch at ${r.Key}, field ${h}: story file says ${shown(r[h])}, ${CSV_REL} says ${shown(c[h])}`);
    }
    const have = new Set(all.map(r => r.Key));
    for (const c of csvRows) if (!have.has(c.Key)) throw new Error(`plan mismatch at ${c.Key}: it has a row in ${CSV_REL} but no story file`);
  }
  if (csvDeps != null) {
    const phaseIn = new Map();
    for (const [p, keys] of Object.entries(csvDeps.phases ?? {})) for (const k of keys ?? []) phaseIn.set(k, p);
    const keys = new Set([...Object.keys(depsMap), ...Object.keys(csvDeps.deps ?? {}), ...phaseIn.keys(), ...stories.map(s => s.row.Key)]);
    const phaseOfFile = new Map(); for (const [p, ks] of Object.entries(deps.phases)) for (const k of ks) phaseOfFile.set(k, p);
    const isStory = new Set(stories.map(s => s.row.Key));
    for (const k of [...keys].sort(keyOrder)) {
      if (!isStory.has(k)) throw new Error(`plan mismatch at ${k}: ${DEPS_REL} names it but it has no story file`);
      const a = phaseOfFile.get(k) ?? null, b = phaseIn.get(k) ?? null;
      if (a !== b) throw new Error(`plan mismatch at ${k}, field phase: story file says ${shown(a)}, ${DEPS_REL} says ${shown(b)}`);
      const da = depsMap[k] ?? [], db = csvDeps.deps?.[k] ?? [];
      if (JSON.stringify(da) !== JSON.stringify(db)) throw new Error(`plan mismatch at ${k}, field depends: story file says ${shown(da)}, ${DEPS_REL} says ${shown(db)}`);
    }
    deps.research = csvDeps.research ?? {};
  }
  return { form: 'stories', csvText, all, deps };
}

/** The plan in a checkout. `null` when it has none. */
export function readPlan({ root = ROOT } = {}) {
  const read = p => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null);
  const list = dir => { try { return readdirSync(join(root, dir)).map(f => dir + f); } catch { return []; } };
  return planFrom({ read, list });
}

/**
 * A ref's files read from git objects: one `git ls-tree` for the story files, then one
 * `git cat-file --batch` for those and every path in `extra`. `read(path)` is the text or null.
 */
export function gitSnapshot(ref, { cwd = ROOT, extra = [CSV_REL, DEPS_REL, EPICS_REL] } = {}) {
  const git = (args, input) => spawnSync('git', args, { cwd, input, maxBuffer: 1 << 28 });
  const tree = git(['ls-tree', '-r', ref, '--', `${STORIES_DIR}/`]);
  const files = new Map(); // path -> sha
  if (tree.status === 0) for (const line of tree.stdout.toString().split('\n')) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
    if (m && m[2].endsWith('.json')) files.set(m[2], m[1]);
  }
  const names = [...files.values(), ...extra.map(p => `${ref}:${p}`)];
  const texts = [];
  const out = names.length ? git(['cat-file', '--batch'], names.join('\n') + '\n') : { status: 0, stdout: Buffer.alloc(0) };
  if (out.status === 0) {
    const buf = out.stdout; let at = 0;
    for (let i = 0; i < names.length; i++) {
      const nl = buf.indexOf(10, at); const head = buf.toString('utf8', at, nl);
      const m = /^\S+ blob (\d+)$/.exec(head);
      if (!m) { texts.push(null); at = nl + 1; continue; }
      const size = Number(m[1]);
      texts.push(buf.toString('utf8', nl + 1, nl + 1 + size));
      at = nl + 1 + size + 1;
    }
  }
  const byPath = new Map();
  [...files.keys()].forEach((p, i) => byPath.set(p, texts[i]));
  extra.forEach((p, i) => byPath.set(p, texts[files.size + i] ?? null));
  return { read: p => byPath.get(p) ?? null, list: dir => [...files.keys()].filter(p => p.startsWith(dir)) };
}

/** The plan at a git ref. */
export const readPlanAt = (ref, opts = {}) => planFrom(gitSnapshot(ref, opts));
