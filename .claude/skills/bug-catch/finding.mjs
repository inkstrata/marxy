#!/usr/bin/env node
// Adds one block to a hunt's findings or verification file in a single locked append, so several agents can
// write to the same file at once without one overwriting another. Nothing here edits or removes a block.
//
//   node finding.mjs next <file> <PREFIX>     the next free id for a prefix, e.g. EXP-04
//   node finding.mjs add <file> < block.md    append a finding (### EXP-04 · ...) after checking its fields
//   node finding.mjs verdict <file> < block   append a verdict (### EXP-04 verdict) after checking its fields
//   node finding.mjs list <file>              one line per block: id, severity or verdict, title
//   node finding.mjs yield <findings> <verification>
//                                             a Markdown table of what each axis (prefix) found: verdicts,
//                                             findings no other axis found, overlaps, and totals per round
//                                             when axes.md sits beside the findings file
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FINDING_FIELDS = ['Severity', 'Domain', 'Where', 'Repro', 'Expected', 'Actual', 'Evidence', 'Confidence', 'Found by'];
const VERDICT_FIELDS = ['Verdict', 'Proof', 'Checked by'];
const SEVERITIES = ['S1', 'S2', 'S3'];
const VERDICTS = ['CONFIRMED', 'PLAUSIBLE', 'NOT-REPRODUCED', 'DUPLICATE', 'BY-DESIGN'];

const fail = (msg) => {
  process.stderr.write(`finding.mjs: ${msg}\n`);
  process.exit(1);
};

const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

const field = (block, name) => {
  const m = block.match(new RegExp(`^- ${name}:[ \\t]*(.*)$`, 'm'));
  return m ? m[1].trim() : null;
};

const ids = (text, prefix) =>
  [...text.matchAll(new RegExp(`^### (${prefix}-(\\d+))\\b`, 'gm'))].map((m) => Number(m[2]));

// A directory is created atomically, so it serves as a lock that every agent on this machine respects.
const withLock = (file, fn) => {
  const lock = `${file}.lock`;
  const until = Date.now() + 10_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      if (Date.now() > until) fail(`${lock} has been held for 10 s; remove it if no agent is writing`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    return fn();
  } finally {
    rmdirSync(lock);
  }
};

const stdin = () => readFileSync(0, 'utf8').trim();

const append = (file, block, kind) => {
  const head = block.split('\n')[0];
  const want = kind === 'finding' ? /^### ([A-Z]{2,4}-\d{2,}) · \S/ : /^### ([A-Z]{2,4}-\d{2,}) verdict$/;
  const m = head.match(want);
  if (!m) {
    fail(kind === 'finding'
      ? `first line must be "### <PREFIX>-<nn> · <what the reader meets>", got: ${head}`
      : `first line must be "### <PREFIX>-<nn> verdict", got: ${head}`);
  }
  const fields = kind === 'finding' ? FINDING_FIELDS : VERDICT_FIELDS;
  const missing = fields.filter((f) => !field(block, f));
  if (missing.length) fail(`missing fields: ${missing.join(', ')} (each on its own "- Name: value" line)`);
  if (kind === 'finding' && !SEVERITIES.includes(field(block, 'Severity').slice(0, 2))) {
    fail(`Severity must start with ${SEVERITIES.join(', ')}`);
  }
  if (kind === 'verdict' && !VERDICTS.includes(field(block, 'Verdict').split(/[\s(]/)[0])) {
    fail(`Verdict must start with one of ${VERDICTS.join(', ')}`);
  }
  withLock(file, () => {
    const text = read(file);
    if (kind === 'finding' && new RegExp(`^### ${m[1]} · `, 'm').test(text)) {
      fail(`${m[1]} is already in ${file}; take the next id with: node finding.mjs next ${file} ${m[1].split('-')[0]}`);
    }
    appendFileSync(file, `${text.endsWith('\n\n') || text === '' ? '' : text.endsWith('\n') ? '\n' : '\n\n'}${block}\n`);
  });
  process.stdout.write(`appended ${m[1]} to ${file}\n`);
};

const blocks = (text) => text.split(/^(?=### )/m).filter((b) => b.startsWith('### '));
const ID = /[A-Z]{2,4}-\d{2,}/;

// Yield per axis. An axis is one catcher, so its prefix names it. A finding counts for its axis unless the
// owner reported it or the verdict is a duplicate of the same axis's own finding (a supersede). A duplicate
// of another axis's finding is an overlap: both axes found it, so neither found it alone. Chains of
// duplicates are followed through supersedes to the finding that kept a verdict of its own.
const yieldTable = (findingsFile, verificationFile) => {
  const verdicts = new Map();
  for (const b of blocks(read(verificationFile))) {
    const id = b.match(/^### (\S+) verdict/)?.[1];
    if (id) verdicts.set(id, field(b, 'Verdict') ?? ''); // the later verdict wins, as in triage
  }
  const all = blocks(read(findingsFile))
    .map((b) => ({ id: b.match(/^### (\S+) · /)?.[1], owner: /^owner\b/i.test(field(b, 'Found by') ?? '') }))
    .filter((f) => f.id && !f.owner)
    .map((f) => {
      const v = verdicts.get(f.id) ?? '';
      const kind = v.split(/[\s(]/)[0] || 'NONE';
      // Only the id right after "of" is the target; the rest of the line may name other findings.
      const target = kind === 'DUPLICATE' ? v.match(new RegExp(`^DUPLICATE of (${ID.source})\\b`))?.[1] ?? null : null;
      return { ...f, prefix: f.id.split('-')[0], kind, target };
    });
  const byId = new Map(all.map((f) => [f.id, f]));
  const resolve = (f) => {
    const seen = new Set([f.id]);
    let t = byId.get(f.target);
    while (t?.kind === 'DUPLICATE' && t.target) {
      if (seen.has(t.id)) return { end: null, cycle: [...seen] };
      seen.add(t.id);
      t = byId.get(t.target);
    }
    if (t && seen.has(t.id)) return { end: null, cycle: [...seen] };
    return { end: t ?? null, cycle: null };
  };
  const findings = all.filter((f) => !(f.kind === 'DUPLICATE' && f.target?.split('-')[0] === f.prefix));
  const overlaps = new Map(); // id of the kept finding -> prefixes of the axes that also found it
  const cycles = new Set();
  for (const f of findings) {
    if (f.kind !== 'DUPLICATE' || !f.target) continue;
    const { end, cycle } = resolve(f);
    f.inHunt = Boolean(end || cycle);
    if (cycle) cycles.add([...cycle].sort().join(' ↔ '));
    if (end && end.prefix !== f.prefix) overlaps.set(end.id, [...(overlaps.get(end.id) ?? []), f.prefix]);
  }
  const axes = new Map(); // prefix -> { name, round }
  const axesFile = join(dirname(findingsFile), 'axes.md');
  for (const b of blocks(read(axesFile))) {
    const m = b.match(/^### ([A-Z]{2,4}) · (.+)$/m);
    if (m) axes.set(m[1], { name: m[2].trim(), round: field(b, 'Round') ?? '' });
  }
  const rows = new Map();
  for (const f of findings) {
    const r = rows.get(f.prefix) ?? { found: 0, CONFIRMED: 0, PLAUSIBLE: 0, dupKnown: 0, dupOther: 0, other: 0, alone: 0, shared: 0 };
    r.found++;
    if (f.kind === 'CONFIRMED' || f.kind === 'PLAUSIBLE') {
      r[f.kind]++;
      if (overlaps.has(f.id)) r.shared++;
      else r.alone++;
    } else if (f.kind === 'DUPLICATE') {
      if (f.inHunt) r.dupOther++;
      else r.dupKnown++;
    } else r.other++;
    rows.set(f.prefix, r);
  }
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '–');
  const out = [
    '| Axis | Round | Findings | Confirmed | Plausible | Alone | Shared | Dup. of known | Dup. of another axis | Not reproduced, by design, no verdict | Precision |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  const order = [...rows.keys()].sort((a, b) => (rows.get(b).alone - rows.get(a).alone) || a.localeCompare(b));
  for (const p of order) {
    const r = rows.get(p);
    const a = axes.get(p);
    out.push(`| ${p}${a ? ` · ${a.name}` : ''} | ${a?.round || '–'} | ${r.found} | ${r.CONFIRMED} | ${r.PLAUSIBLE} | ${r.alone} | ${r.shared} | ${r.dupKnown} | ${r.dupOther} | ${r.other} | ${pct(r.CONFIRMED + r.PLAUSIBLE, r.found)} |`);
  }
  const rounds = new Map();
  for (const p of order) {
    const round = axes.get(p)?.round;
    if (!round) continue;
    const t = rounds.get(round) ?? { axes: 0, found: 0, alone: 0 };
    t.axes++;
    t.found += rows.get(p).found;
    t.alone += rows.get(p).alone;
    rounds.set(round, t);
  }
  if (rounds.size) {
    out.push('', '| Round | Axes | Findings | Found by one axis alone (confirmed or plausible) |', '| --- | --- | --- | --- |');
    for (const [round, t] of [...rounds].sort((x, y) => Number(x[0]) - Number(y[0]) || x[0].localeCompare(y[0]))) out.push(`| ${round} | ${t.axes} | ${t.found} | ${t.alone} |`);
  }
  if (overlaps.size) {
    out.push('', 'Overlaps (one finding, several axes):');
    for (const [id, ps] of overlaps) out.push(`- ${id}: also ${[...new Set(ps)].join(', ')}`);
  }
  if (cycles.size) {
    out.push('', 'Duplicate cycles (credited to no axis; give one finding a verdict of its own):');
    for (const c of cycles) out.push(`- ${c}`);
  }
  const missing = findings.filter((f) => f.kind === 'NONE').map((f) => f.id);
  if (missing.length) out.push('', `No verdict yet: ${missing.join(', ')}`);
  process.stdout.write(`${out.join('\n')}\n`);
};

const [cmd, file, prefix] = process.argv.slice(2);
if (!cmd || !file) fail('usage: next <file> <PREFIX> | add <file> | verdict <file> | list <file> | yield <findings> <verification>');

if (cmd === 'next') {
  if (!/^[A-Z]{2,4}$/.test(prefix ?? '')) fail('a prefix is two to four capital letters');
  const n = Math.max(0, ...ids(read(file), prefix)) + 1;
  process.stdout.write(`${prefix}-${String(n).padStart(2, '0')}\n`);
} else if (cmd === 'add') {
  append(file, stdin(), 'finding');
} else if (cmd === 'verdict') {
  append(file, stdin(), 'verdict');
} else if (cmd === 'yield') {
  if (!prefix) fail('usage: yield <findings.md> <verification.md>');
  yieldTable(file, prefix);
} else if (cmd === 'list') {
  for (const block of blocks(read(file))) {
    const head = block.split('\n')[0].slice(4);
    const tag = field(block, 'Verdict') ?? field(block, 'Severity') ?? '';
    process.stdout.write(`${head.split(' ')[0]}\t${tag.split(/\s/)[0]}\t${head.replace(/^\S+ (· )?/, '')}\n`);
  }
} else {
  fail(`unknown command ${cmd}`);
}
