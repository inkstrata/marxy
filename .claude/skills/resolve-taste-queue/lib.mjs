// Parsing, artifact resolution and write-back for the taste-review harness. No I/O beyond the repo
// root it is given, so test.mjs can run it against a temp copy.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, basename, extname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const QUEUE_FILE = 'docs/taste-review/queue.md';
export const QUEUE_DIR = 'docs/taste-review/queue.d';
export const VERDICTS = {
  fine: { label: 'Fine', cell: 'Fine.' },
  tune: { label: 'Tune', cell: 'Tune.' },
  change: { label: 'Change', cell: 'Change.' },
  defer: { label: 'Defer', cell: 'Deferred.' },
};
const IMG = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const ROW_RE = /^\| \d{4}-\d\d-\d\d \|/;
const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim());

/** The repo helpers (fold, format) come from the checkout being reviewed, so --root works. */
export async function repoLib(root) {
  const url = p => pathToFileURL(join(root, p)).href;
  return { fold: (await import(url('scripts/taste-queue.mjs'))).fold, fmt: await import(url('scripts/lib/taste-queue.mjs')) };
}

function parseLine(line, source) {
  const c = cells(line);
  if (c.length !== 6) return null;
  const [date, key, notice, artifacts, question, decision] = c;
  const def = question.match(/\(Default:\s*([^)]*)\)/i)?.[1]?.trim() ?? null;
  return { date, key, notice, artifactsRaw: artifacts, question, decision, default: def, source, line };
}

// A fragment that is prose, not one table row (C-12.md is one). The repo's own --fold rejects it, so
// the harness shows it as a row, records the verdict in decisions.md only, and leaves the file be.
function proseFragment(text, name) {
  const key = name.replace(/\.md$/, '');
  const [head, ...rest] = text.split('\n\n');
  const body = rest.join('\n\n');
  const [lead, ...bullets] = body.split('\n').filter(Boolean);
  return { date: 'prose', key, notice: `${head.replace(/^#\s*/, '')}. ${lead ?? ''}`.trim(), artifactsRaw: '', question: bullets.map(b => b.replace(/^-\s*/, '')).join('\n'), decision: '', default: null, source: `queue.d/${name}`, line: null, malformed: true };
}

/** Every queue row, in table order, then unfolded fragments. Ids are `date|key` (+ `#n` on repeats). */
export async function loadRows(root) {
  const { fmt } = await repoLib(root);
  const rows = readFileSync(join(root, QUEUE_FILE), 'utf8').split('\n').filter(l => ROW_RE.test(l)).map(l => parseLine(l, 'queue.md'));
  const dir = join(root, QUEUE_DIR);
  if (existsSync(dir)) {
    for (const n of fmt.sortFragmentNames(readdirSync(dir))) {
      const text = readFileSync(join(dir, n), 'utf8').trim();
      rows.push(parseLine(text, `queue.d/${n}`) ?? proseFragment(text, n));
    }
  }
  const seen = new Map();
  return rows.filter(Boolean).map(r => {
    const base = `${r.date}|${r.key}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...r, id: n > 1 ? `${base}#${n}` : base, artifacts: resolveArtifacts(root, r.artifactsRaw) };
  });
}

function expandBraces(t) {
  const m = t.match(/^(.*?)\{([^{}]+)\}(.*)$/);
  return m ? m[2].split(',').flatMap(o => expandBraces(m[1] + o + m[3])) : [t];
}
function globOne(root, pat) {
  if (!pat.includes('*')) return existsSync(join(root, pat)) ? [pat] : [];
  const re = new RegExp('^' + basename(pat).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  try { return readdirSync(join(root, dirname(pat))).filter(f => re.test(f)).sort().map(f => join(dirname(pat), f)); } catch { return []; }
}
function imagesIn(root, dir, depth = 2, out = []) {
  let names = [];
  try { names = readdirSync(join(root, dir)).sort(); } catch { return out; }
  for (const n of names) {
    const p = join(dir, n);
    const st = statSync(join(root, p));
    if (st.isFile() && IMG.has(extname(n).toLowerCase())) out.push(p);
    else if (st.isDirectory() && depth > 0 && n !== 'node_modules') imagesIn(root, p, depth - 1, out);
  }
  return out;
}

const CAP = 16, TEXT_CAP = 6;
// Big baseline directories hold hundreds of PNGs; show the macOS 960 px ones first.
const score = p => (/webkit-macos|mac/.test(p) ? 0 : 2) + (/960/.test(p) ? 0 : 1);
/** Backticked tokens of an Artifacts cell that exist in the repo → images, files, and directories' images. */
export function resolveArtifacts(root, raw) {
  const tokens = [...raw.matchAll(/`([^`]+)`/g)].map(m => m[1].trim().replace(/[,;.]$/, ''));
  const dirs = ['docs/taste-review', 'fixtures/corpus'];
  const found = new Map();
  const add = (p, kind) => { if (!found.has(p)) found.set(p, { path: p, kind, name: basename(p) }); };
  for (const tok of tokens) {
    if (/\s|[<>=()"]/.test(tok)) continue;
    const cands = tok.includes('/') ? [tok] : [tok, ...dirs.map(d => join(d, tok))];
    for (const c of cands) {
      const hits = expandBraces(c).flatMap(x => globOne(root, x));
      if (!hits.length) continue;
      for (const h of hits) {
        const st = statSync(join(root, h));
        if (st.isDirectory()) { dirs.unshift(h); imagesIn(root, h).forEach(p => add(p, 'image')); }
        else if (IMG.has(extname(h).toLowerCase())) add(h, 'image');
        else if (st.size < 400_000) add(h, /\.(md|markdown)$/.test(h) ? 'doc' : 'text');
      }
      break;
    }
  }
  const all = [...found.values()];
  const images = all.filter(a => a.kind === 'image').map((a, i) => ({ a, i })).sort((x, y) => score(x.a.path) - score(y.a.path) || x.i - y.i);
  const keep = new Set(images.slice(0, CAP).map(x => x.a.path));
  const texts = all.filter(a => a.kind !== 'image');
  return {
    items: [...all.filter(a => a.kind === 'image' && keep.has(a.path)), ...texts.slice(0, TEXT_CAP)],
    hiddenImages: Math.max(0, images.length - CAP),
    hiddenFiles: Math.max(0, texts.length - TEXT_CAP),
  };
}

/** Whether `rel` is a file inside `root` (no escaping through `..` or symlinks). */
export function inside(root, rel) {
  const abs = resolve(root, rel);
  return abs === resolve(root) || abs.startsWith(resolve(root) + sep);
}

const esc = s => String(s).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();

function nextReviewDir(root, today) {
  const base = join(root, 'docs/taste-review');
  const n = readdirSync(base).map(d => d.match(/^\d{4}-\d\d-review-(\d+)$/)?.[1]).filter(Boolean).map(Number);
  const num = (n.length ? Math.max(...n) : -1) + 1;
  return `${today.slice(0, 7)}-review-${num}`;
}

/** Fold the well-formed fragments the way scripts/taste-queue.mjs does; prose ones stay where they are. */
function foldValid(root, fmt) {
  const dir = join(root, QUEUE_DIR);
  if (!existsSync(dir)) return { folded: 0 };
  const names = fmt.sortFragmentNames(readdirSync(dir)).filter(n => fmt.validQueueFragment(readFileSync(join(dir, n), 'utf8'), n.replace(/\.md$/, '')));
  if (!names.length) return { folded: 0 };
  const q = join(root, QUEUE_FILE);
  writeFileSync(q, fmt.foldRows(readFileSync(q, 'utf8'), names.map(n => readFileSync(join(dir, n), 'utf8').trim())));
  names.forEach(n => rmSync(join(dir, n)));
  return { folded: names.length };
}

/**
 * Fold fragments, write each verdict into its row's Decision cell, and write the dated decisions.md.
 * `decisions` is `{ [rowId]: { verdict, note } }`; `skip` rows stay open. Returns a summary.
 */
export async function finish(root, decisions, { today = new Date().toISOString().slice(0, 10), dirName } = {}) {
  const { fmt } = await repoLib(root);
  const before = await loadRows(root);
  const folded = foldValid(root, fmt);
  const folder = dirName ?? nextReviewDir(root, today);
  const rel = `${folder}/decisions.md`;
  const qPath = join(root, QUEUE_FILE);
  let text = readFileSync(qPath, 'utf8');
  const lines = text.split('\n');
  const decided = [], left = [];
  for (const r of before) {
    const d = decisions[r.id];
    if (r.decision || !d || !VERDICTS[d.verdict]) { if (!r.decision) left.push(r); continue; }
    if (r.malformed) { decided.push({ ...r, ...d }); continue; }
    const i = lines.findIndex(l => ROW_RE.test(l) && cells(l)[1] === r.key && cells(l)[0] === r.date && !cells(l)[5]);
    if (i < 0) throw new Error(`row ${r.id} not found in ${QUEUE_FILE}`);
    const c = cells(lines[i]);
    const note = d.note?.trim() ? ` ${esc(d.note)}` : '';
    c[5] = `**${VERDICTS[d.verdict].cell}**${note} \`${rel}\``;
    lines[i] = `| ${c.join(' | ')} |`;
    decided.push({ ...r, ...d });
  }
  writeFileSync(qPath, lines.join('\n'));
  const out = [`# Taste review — ${today}`, '', 'Recorded with the author through the `resolve-taste-queue` harness.', ''];
  for (const r of decided) {
    out.push(`## ${r.key} — ${r.notice.replace(/\.$/, '').split(/[;:]/)[0].slice(0, 90)}`, '',
      `- **${VERDICTS[r.verdict].label}.** ${r.note?.trim() || (r.verdict === 'fine' ? 'No change.' : '(no note)')}`,
      `- Asked: ${r.question}`, '');
  }
  if (left.length) out.push('## Left open', '', ...left.map(r => `- ${r.key} (${r.date})`), '');
  mkdirSync(join(root, 'docs/taste-review', folder), { recursive: true });
  writeFileSync(join(root, 'docs/taste-review', rel), out.join('\n'));
  return { folder, file: `docs/taste-review/${rel}`, decided: decided.length, left: left.length, folded: folded.folded, prose: decided.filter(r => r.malformed).map(r => r.key), byVerdict: decided.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] ?? 0) + 1), a), {}) };
}
