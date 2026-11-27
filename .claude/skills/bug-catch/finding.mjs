#!/usr/bin/env node
// Adds one block to a hunt's findings or verification file in a single locked append, so several agents can
// write to the same file at once without one overwriting another. Nothing here edits or removes a block.
//
//   node finding.mjs next <file> <PREFIX>     the next free id for a prefix, e.g. EXP-04
//   node finding.mjs add <file> < block.md    append a finding (### EXP-04 · ...) after checking its fields
//   node finding.mjs verdict <file> < block   append a verdict (### EXP-04 verdict) after checking its fields
//   node finding.mjs list <file>              one line per block: id, severity or verdict, title
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmdirSync } from 'node:fs';

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
  const m = block.match(new RegExp(`^- ${name}:\\s*(.*)$`, 'm'));
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

const [cmd, file, prefix] = process.argv.slice(2);
if (!cmd || !file) fail('usage: next <file> <PREFIX> | add <file> | verdict <file> | list <file>');

if (cmd === 'next') {
  if (!/^[A-Z]{2,4}$/.test(prefix ?? '')) fail('a prefix is two to four capital letters');
  const n = Math.max(0, ...ids(read(file), prefix)) + 1;
  process.stdout.write(`${prefix}-${String(n).padStart(2, '0')}\n`);
} else if (cmd === 'add') {
  append(file, stdin(), 'finding');
} else if (cmd === 'verdict') {
  append(file, stdin(), 'verdict');
} else if (cmd === 'list') {
  for (const block of read(file).split(/^(?=### )/m).filter((b) => b.startsWith('### '))) {
    const head = block.split('\n')[0].slice(4);
    const tag = field(block, 'Verdict') ?? field(block, 'Severity') ?? '';
    process.stdout.write(`${head.split(' ')[0]}\t${tag.split(/\s/)[0]}\t${head.replace(/^\S+ (· )?/, '')}\n`);
  }
} else {
  fail(`unknown command ${cmd}`);
}
