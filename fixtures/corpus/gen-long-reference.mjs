#!/usr/bin/env node
// Generates 32-long-reference.md, the scale fixture for the Marxy corpus.
//
// Deterministic by construction: one seeded PRNG (mulberry32, fixed seed), no clock, no
// environment, no network, no dependencies. no unseeded random source is used. Running this script
// twice, on any machine, writes byte-identical output. The fictional subject (Brindle, a job
// scheduler and configuration layer) is invented for the fixture; nothing here is third-party text.
//
//   node gen-long-reference.mjs [output-path]
//
// The default output path is 32-long-reference.md beside this script. A summary of what was
// produced (bytes, headings by level, fences, tables, links) is printed to stdout.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SEED = 0x4d415258; // "MARX"
const LARGE = process.argv.includes('--large');
const OUT = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? fileURLToPath(new URL('./32-long-reference.md', import.meta.url));

// ---------------------------------------------------------------------------------------------
// PRNG and small helpers
// ---------------------------------------------------------------------------------------------

function mulberry32(a) {
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;
function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The github-slugger algorithm, as the reader-artifacts spec describes it: lowercase, drop
 *  punctuation, spaces to hyphens, and a `-n` suffix for the second and later duplicates. */
function makeSlugger() {
  const seen = new Map();
  return (text) => {
    const base = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

// ---------------------------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------------------------

const CHAPTERS = [
  { title: 'Introduction', key: 'intro' },
  { title: 'Scheduler', key: 'scheduler' },
  { title: 'Queues', key: 'queue' },
  { title: 'Workers', key: 'worker' },
  { title: 'Retries and backoff', key: 'retry' },
  { title: 'Storage', key: 'storage' },
  { title: 'Locks and leases', key: 'lock' },
  { title: 'Secrets', key: 'secrets' },
  { title: 'Metrics', key: 'metrics' },
  { title: 'Tracing', key: 'tracing' },
  { title: 'Logging', key: 'log' },
  { title: 'Networking', key: 'net' },
  { title: 'Transport security', key: 'tls' },
  { title: 'Authentication', key: 'authn' },
  { title: 'Authorization', key: 'authz' },
  { title: 'Quotas and limits', key: 'quota' },
  { title: 'Plugins', key: 'plugin' },
  { title: 'Migrations', key: 'migrate' },
  { title: 'Command line', key: 'cli' },
  { title: 'Webhooks', key: 'webhook' },
];

const ADJ = ['default', 'strict', 'relaxed', 'adaptive', 'bounded', 'shared', 'regional', 'durable', 'deferred', 'priority', 'ephemeral', 'sticky', 'verbose', 'compact', 'tiered'];
const NOUN = ['window', 'budget', 'policy', 'ceiling', 'floor', 'cursor', 'horizon', 'batch', 'channel', 'profile', 'quorum', 'snapshot', 'ledger', 'shard', 'lease', 'cadence', 'threshold', 'handshake', 'manifest', 'digest'];
const KEYS = ['timeout', 'interval', 'limit', 'enabled', 'max', 'min', 'ttl', 'jitter', 'burst', 'path', 'mode', 'size', 'depth', 'factor', 'grace', 'level', 'target', 'retain'];
const THING = ['a job', 'a worker', 'a queue', 'a lease', 'a shard', 'a snapshot', 'a plugin', 'a webhook delivery', 'a tenant', 'a node'];
const VERB = ['claimed', 'released', 'rescheduled', 'compacted', 'drained', 'rotated', 'flushed', 'replayed', 'promoted', 'quarantined'];
const COND = ['the cluster is partitioned', 'a node restarts', 'the queue is empty', 'the clock moves backwards', 'a deploy is in progress', 'the primary is unreachable', 'a tenant exceeds its quota', 'the disk is more than 90 % full'];
const ACTION = ['holds the work', 'defers the decision to the next tick', 'refuses new claims', 'logs a warning and continues', 'falls back to the previous value', 'escalates to the operator channel'];
const RESOURCE = ['memory', 'disk', 'network', 'CPU', 'file descriptor', 'connection'];
const METRIC = ['recovery time', 'tail latency', 'queue depth', 'time to first claim', 'restart time'];
const UNITS = ['ms', 's', 'min', 'h'];

const phrase = {
  setting: (ch) => `${ch.key}.${pick(ADJ)}_${pick(NOUN)}.${pick(KEYS)}`,
  value: () => pick(['true', 'false', '30s', '5m', '250ms', '1h', '64', '1024', '"auto"', '"strict"', '0.25', '8', '"/var/lib/brindle"', '12']),
};

// ---------------------------------------------------------------------------------------------
// Prose
// ---------------------------------------------------------------------------------------------

function sentence(ch, key) {
  const k = `\`${key}\``;
  const forms = [
    () => `The ${k} setting controls how ${pick(THING)} is ${pick(VERB)} when ${pick(COND)}.`,
    () => `Raising ${k} increases ${pick(RESOURCE)} use but shortens ${pick(METRIC)}.`,
    () => `A value of \`${phrase.value()}\` is the default and suits most deployments.`,
    () => `If ${pick(COND)}, Brindle ${pick(ACTION)} and records the event in the audit log.`,
    () => `Operators who run ${int(3, 40)} or more nodes should set ${k} explicitly rather than rely on the default.`,
    () => `The ${pick(ADJ)} ${pick(NOUN)} is evaluated once per ${pick(['tick', 'claim', 'heartbeat', 'sweep'])}, never between ticks.`,
    () => `Changing ${k} at run time takes effect after the next ${pick(['tick', 'sweep', 'rotation'])}; no restart is needed.`,
    () => `This is independent of ${ch.title.toLowerCase()} limits set elsewhere in the file.`,
    () => `Values are read as ${pick(['durations', 'integers', 'byte counts', 'ratios'])}; a bare number is taken in ${pick(UNITS)}.`,
  ];
  return pick(forms)();
}

function paragraph(ch, key, n, xref) {
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(sentence(ch, key));
  if (xref) parts.push(xref);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------------------------
// Plan: every heading, with its number and slug, decided before any body is written, so the
// cross-references are to anchors that exist.
// ---------------------------------------------------------------------------------------------

const slug = makeSlugger();
const plan = [];            // chapters
const anchors = [];         // { num, title, slug, level } for numbered targets
const h1 = 'Brindle Reference, version 4.2';
slug(h1); // the H1 takes its slug first

CHAPTERS.forEach((ch, ci) => {
  const n = ci + 1;
  const chapter = { ...ch, n, heading: `${n}. ${ch.title}`, sections: [] };
  chapter.slug = slug(chapter.heading);
  anchors.push({ num: `${n}`, slug: chapter.slug, level: 2 });
  const count = n === 1 ? 4 : 8;
  for (let si = 1; si <= count; si++) {
    const name = n === 1
      ? ['Purpose', 'Audience', 'Conventions', 'Stability promises'][si - 1]
      : `${cap(pick(ADJ))} ${pick(NOUN)}`;
    const section = { n: `${n}.${si}`, name, heading: `${n}.${si} ${name}`, subs: [] };
    section.slug = slug(section.heading);
    anchors.push({ num: section.n, slug: section.slug, level: 3 });
    // H4s: either numbered settings, or one of the repeated unnumbered ones that exercise the
    // duplicate-slug suffix.
    const subCount = n === 1 ? 0 : (chance(0.55) ? 1 : 0) + (chance(0.45) ? 1 : 0) + (chance(0.2) ? 1 : 0) + (si === 1 ? 1 : 0);
    for (let k = 1; k <= subCount; k++) {
      let sub;
      if (k === subCount && chance(0.45)) {
        sub = { heading: pick(['Example', 'Errors', 'Compatibility', 'Notes']), numbered: false };
      } else {
        const key = phrase.setting(ch);
        sub = { heading: `${section.n}.${k} \`${key}\``, key, numbered: true };
      }
      sub.slug = slug(sub.heading);
      if (sub.numbered) anchors.push({ num: `${section.n}.${k}`, slug: sub.slug, level: 4 });
      section.subs.push(sub);
    }
    chapter.sections.push(section);
  }
  plan.push(chapter);
});

// Changelog: 20 releases of ten lines each (200 lines), one H3 per release.
const RELEASES = [];
{
  let major = 4, minor = 2, patch = 0, year = 2026, month = 9, day = 28;
  for (let i = 0; i < 20; i++) {
    RELEASES.push({ v: `${major}.${minor}.${patch}`, date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` });
    // step backwards through time
    if (patch > 0) patch--; else if (minor > 0) { minor--; patch = int(0, 3); } else { major--; minor = 9; patch = 1; }
    day -= int(5, 19);
    while (day < 1) { day += 28; month--; if (month < 1) { month = 12; year--; } }
  }
}
const changelog = { n: CHAPTERS.length + 1, title: 'Changelog' };
changelog.heading = `${changelog.n}. ${changelog.title}`;
changelog.slug = slug(changelog.heading);
const notes = { n: CHAPTERS.length + 2, title: 'Notes' };
notes.heading = `${notes.n}. ${notes.title}`;
notes.slug = slug(notes.heading);
for (const r of RELEASES) { r.heading = `${r.v} (${r.date})`; r.slug = slug(r.heading); }

// ---------------------------------------------------------------------------------------------
// Slots for tables and code fences: decided up front so the totals are exact.
// ---------------------------------------------------------------------------------------------

const slots = [];
for (const ch of plan.slice(1)) {
  for (const s of ch.sections) {
    slots.push({ s, where: 'section' });
    for (const sub of s.subs) slots.push({ s: sub, where: 'sub' });
  }
}
const TABLES = 60;
const WIDE_TABLES = 9;
const FENCES = 120;
const FENCE_LANGS = ['yaml', 'json', 'bash', 'python', 'typescript'];
const tableSlots = shuffle(slots).slice(0, TABLES);
tableSlots.forEach((slot, i) => { slot.s.table = i < WIDE_TABLES ? 'wide' : 'narrow'; });
const fenceSlots = shuffle(slots).slice(0, FENCES);
fenceSlots.forEach((slot, i) => { slot.s.fence = FENCE_LANGS[i % FENCE_LANGS.length]; });

// Footnotes: 30 references spread over the chapters, definitions in the final chapter.
const FOOTNOTES = 30;
// Note 1 is referenced from the introduction; the rest are numbered in document order.
const footSlots = shuffle(slots.map((slot, index) => index)).slice(0, FOOTNOTES - 1).sort((x, y) => x - y);
footSlots.forEach((index, i) => { slots[index].s.foot = i + 2; });

// ---------------------------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------------------------

const out = [];
const emit = (...lines) => { for (const l of lines) out.push(l); };
const stats = { xrefs: 0, defLists: 0, pandocDefs: 0 };

function xref() {
  const target = pick(anchors.filter((a) => a.level >= 3));
  stats.xrefs++;
  return `Related: [see §${target.num}](#${target.slug}).`;
}

function definitionList(ch, key) {
  const n = int(2, 3);
  const terms = shuffle(KEYS).slice(0, n);
  emit('');
  if (chance(0.35)) {
    // Pandoc-style definition blocks. GFM has no definition lists, so these are plain paragraphs
    // with a colon; the fixture wants that rendering, not the extension's.
    for (const t of terms) {
      emit('', `${t}`, `:   ${cap(sentence(ch, key))}`);
      stats.pandocDefs++;
    }
  } else {
    for (const t of terms) emit(`- **\`${t}\`** — ${cap(sentence(ch, key))}`);
    stats.defLists++;
  }
}

function narrowTable(ch) {
  const rows = LARGE ? int(3, 5) : int(2, 4);
  emit('', '| Option | Type | Default | Description |', '| --- | :---: | ---: | --- |');
  for (let i = 0; i < rows; i++) {
    const key = `${pick(ADJ)}_${pick(NOUN)}.${pick(KEYS)}`;
    emit(`| \`${key}\` | ${pick(['string', 'integer', 'duration', 'boolean', 'ratio'])} | \`${phrase.value().replace(/\|/g, '/')}\` | ${cap(sentence(ch, key))} |`);
  }
}

function wideTable(ch) {
  const rows = LARGE ? int(3, 6) : int(3, 5);
  emit('', '| Endpoint | Method | Auth | Rate | Idempotent | Cache | Since | Notes |', '| --- | --- | --- | ---: | :---: | --- | --- | --- |');
  for (let i = 0; i < rows; i++) {
    const path = `/v4/${ch.key}/${pick(NOUN)}s/{id}${chance(0.3) ? `/${pick(VERB)}` : ''}`;
    emit(`| \`${path}\` | ${pick(['GET', 'PUT', 'POST', 'DELETE', 'PATCH'])} | ${pick(['token', 'mTLS', 'none', 'token+scope'])} | ${int(1, 600)}/min | ${pick(['yes', 'no'])} | ${pick(['none', 'private', '30s', '5m'])} | ${int(1, 4)}.${int(0, 9)} | ${cap(pick(ADJ))} ${pick(NOUN)} variant. |`);
  }
}

function fence(lang, ch, key) {
  const k1 = pick(KEYS); const k2 = pick(KEYS); const k3 = pick(KEYS);
  const v1 = phrase.value(); const v2 = phrase.value(); const v3 = phrase.value();
  const base = key.split('.').slice(0, 2).join('.');
  emit('', '```' + lang);
  switch (lang) {
    case 'yaml':
      emit(`# ${cap(sentence(ch, key)).replace(/`/g, '')}`, `${ch.key}:`, `  ${pick(ADJ)}_${pick(NOUN)}:`, `    ${k1}: ${v1}`, `    ${k2}: ${v2}`, `  ${pick(ADJ)}_${pick(NOUN)}:`, `    ${k3}: ${v3}`, `    tags: [${pick(ADJ)}, ${pick(ADJ)}]`);
      break;
    case 'json':
      emit('{', `  "${ch.key}": {`, `    "${pick(ADJ)}_${pick(NOUN)}": {`, `      "${k1}": ${v1.startsWith('"') || /^[0-9.]+$|^true$|^false$/.test(v1) ? v1 : `"${v1}"`},`, `      "${k2}": ${v2.startsWith('"') || /^[0-9.]+$|^true$|^false$/.test(v2) ? v2 : `"${v2}"`},`, `      "tags": ["${pick(ADJ)}", "${pick(ADJ)}"]`, '    }', '  }', '}');
      break;
    case 'bash':
      emit(`# ${cap(pick(VERB))} ${pick(THING)}`, `brindle config set ${base}.${k1} ${v1.replace(/"/g, '')}`, `brindle ${ch.key} ${pick(['status', 'inspect', 'list', 'drain'])} --format json \\`, `  | jq '.items[] | select(.${k2} != null)'`, `curl -sS -H "Authorization: Bearer $BRINDLE_TOKEN" \\`, `  "https://api.example.invalid/v4/${ch.key}/${pick(NOUN)}s?limit=${int(5, 100)}"`);
      break;
    case 'python':
      emit('from brindle import Client', '', 'client = Client("https://api.example.invalid", token=os.environ["BRINDLE_TOKEN"])', `${pick(NOUN)} = client.${ch.key}.get("${pick(ADJ)}-${pick(NOUN)}")`, `if ${pick(NOUN)}.${k1} > ${int(1, 99)}:`, `    client.${ch.key}.update(${pick(NOUN)}.id, ${k2}=${v2.startsWith('"') ? v2 : `"${v2}"`})`, 'else:', `    raise RuntimeError("${pick(ADJ)} ${pick(NOUN)} is below its floor")`);
      break;
    case 'typescript':
      emit("import { Brindle } from '@example/brindle';", '', "const brindle = new Brindle({ url: 'https://api.example.invalid', token: process.env.BRINDLE_TOKEN });", `const ${pick(NOUN)} = await brindle.${ch.key}.get('${pick(ADJ)}-${pick(NOUN)}');`, `if (${pick(NOUN)}.${k1} > ${int(1, 99)}) {`, `  await brindle.${ch.key}.update(${pick(NOUN)}.id, { ${k2}: ${v2.startsWith('"') ? v2.replace(/"/g, "'") : `'${v2}'`} });`, '}');
      break;
    default: break;
  }
  emit('```');
}

function body(ch, node, key, withParagraph = true) {
  const paragraphs = chance(0.12) ? 2 : 1;
  for (let i = 0; i < paragraphs; i++) {
    const sentences = LARGE ? int(2, 3) : int(1, 2);
    let text = paragraph(ch, key, sentences, chance(0.25) ? xref() : null);
    if (i === 0 && node.foot) text += `[^${node.foot}]`;
    emit('', text);
  }
  if (chance(LARGE ? 0.45 : 0.3)) definitionList(ch, key);
  if (node.table === 'wide') wideTable(ch);
  else if (node.table === 'narrow') narrowTable(ch);
  if (node.fence) fence(node.fence, ch, key);
}

// ---------------------------------------------------------------------------------------------
// The hand-written introduction. Continuous prose, about ten thousand bytes, so a typesetter and
// a line breaker have something to chew on before the tables start.
// ---------------------------------------------------------------------------------------------

const INTRO_SPLIT = [4, 4, 3, 3]; // paragraphs under each of the four introduction sections
const INTRO = [
  `Brindle is a scheduler for work that has to happen eventually, preferably once, and never silently. It began as a collection of shell scripts on a single machine, grew into a daemon when the scripts started to disagree about what "once" meant, and acquired a configuration layer when the daemon was installed on a second machine and the two copies drifted apart. This reference describes version 4.2. It is written for the person who has to run Brindle at three in the morning, which is also the person most likely to be reading it on a small screen with a terminal open beside it, and so it prefers short sentences, exact names and examples that can be pasted without editing.`,
  `Most of the system is a matter of three nouns and the promises made about them. A job is a unit of work with an identity, a payload and a deadline. A queue is an ordered place where jobs wait, and the order is a promise: within a queue, jobs of equal priority are claimed in the order they were enqueued, unless a retry has put one of them back. A worker is whatever claims a job, runs it and reports the outcome. Everything else in this document, from the lease on a claim to the shape of a webhook, exists to keep those three promises true when the network is slow, the clock is wrong, and the disk is nearly full.`,
  `The design makes several choices that readers coming from other schedulers may not expect. First, Brindle prefers to run a job twice over losing it, and it says so loudly in the log whenever it does. A job that is claimed and then abandoned by a worker that vanished will be offered again after its lease expires, and the second worker will see the same identity and the same payload as the first. Handlers are therefore expected to be idempotent, and the chapter on retries explains how to make them so. Second, Brindle keeps its configuration in a single tree of named settings with typed values, and it refuses to start if a setting is unknown. A misspelt name is an error rather than a silent default, because the cost of a silent default is paid later, usually in the middle of the night.`,
  `Third, and most important for anyone planning a deployment, Brindle assumes that clocks lie. It does not use wall-clock time to order events, only to schedule them, and it measures every interval with a monotonic source that cannot move backwards. When the wall clock jumps, a scheduled job is neither skipped nor run twice; the scheduler notices the jump, logs it, and reschedules according to the policy in the scheduler chapter. This matters more than it sounds. In the first year of production use of an early version, the most common cause of duplicated work was not a crash, or a network partition, or a bug in a handler. It was a virtual machine that was suspended for a few minutes and resumed with a clock that had not yet caught up.`,
  `The settings are grouped by the part of the system they affect, and the names follow one rule: a dotted path whose first segment is the chapter's key, as in the examples throughout this reference. A setting named scheduler.default_window.timeout belongs to the scheduler, describes a window, and sets a timeout. Durations are written with a unit suffix, such as 250ms, 30s, 5m or 1h; a bare number is read in the unit named in the setting's description. Sizes are written in bytes unless a suffix says otherwise. Booleans are the words true and false and nothing else, since the alternatives that other tools accept (yes, on, 1) have, in Brindle's experience, caused more confusion than they have saved keystrokes.`,
  `Each chapter has the same shape. It opens with sections that describe a group of related settings, in prose first and then in a table. The table lists the option, its type, its default and what it does, and a reader who already knows the answer to the question of what the setting does can look only at the default. Sections that need one are followed by an example, in YAML for the configuration file, in JSON for the HTTP interface, and in the command line, Python or TypeScript where those are the natural way to reach the same setting. The examples have been run against a test cluster, but the values in them are illustrative; the defaults are the numbers that matter in production, and these are the numbers in the tables.`,
  `Cross-references are written with a section sign and a number, such as the discussion of leases in {{LEASES}}, and every one of them is a link. If a link takes you to a place where the question is answered only by another link, that is a bug in this document, and it would be welcome as an issue. The same is true of any example that does not run, any default that differs from the one in the program, and any sentence whose meaning depends on the reader having already read the sentence after it. A reference is a promise, too, and the promise is that nothing in it requires you to guess.`,
  `Stability is described by three words. A stable setting will not change meaning, type or default inside a major version; if it must change, it is deprecated for at least two minor versions and the log says so each time the old name is used. An experimental setting may change in any release and is marked as such in its table row. An internal setting is not documented here at all, and any configuration file that names one will be rejected by the strict parser. The changelog at the end of this document lists every change to a stable setting, with the version in which it first appeared, so that an operator upgrading across several versions can read one page rather than twelve. Nothing in the changelog is retroactive: a line describes a release as it shipped, and a later correction appears as its own line in the later release instead of a quiet edit to the earlier one.`,
  `Operators sometimes ask why Brindle has so many settings for a system whose purpose is simple. The honest answer is that the purpose is simple and the environments are not. A scheduler that runs on one laptop needs no tuning; the same scheduler spread across three regions, with a flaky link between two of them and a compliance rule about where the payloads may rest, needs a dozen decisions made explicitly. Brindle's position is that each of those decisions should be a named setting with a documented default, so that nothing important is decided by accident. The defaults are chosen for a cluster of three to five nodes in one region with ordinary disks and a reliable network, and they are conservative on purpose: slow and safe in preference to fast and surprising.`,
  `There is a short list of settings that nearly every deployment changes, and it is worth knowing before reading further. The location of the data directory is one. The address that other nodes use to reach this one is another, because the address a node believes it has is often not the address that is reachable from outside its container. The retention window for finished jobs is a third, since the default of seven days is a guess about how long people look at results. The remaining ones concern credentials and are covered in the chapters on secrets and authentication. A configuration that sets these and nothing else is a perfectly respectable configuration, and many of the best running installations are exactly that.`,
  `Upgrades follow a rule that has served the project well: the new version must be able to read the old version's data, and the old version need not be able to read the new one's. A rolling upgrade is therefore safe if the nodes are upgraded one at a time and the cluster is never downgraded while a mixed state exists. The migrations chapter gives the exact sequence and the checks to run between steps, and the changelog marks every release that changes a stored format with the word Changed and the name of the format. If the line is absent, nothing on disk changed, and the upgrade is a matter of replacing a binary and restarting it.`,
  `The interfaces fall into three groups. The configuration file is for things that are decided once, by the person who installs the system. The HTTP interface is for things that are decided continuously, by programs: enqueueing a job, inspecting a lease, draining a node. The command line is for things that are decided by a person at a terminal in a hurry, and it is deliberately a thin wrapper over the HTTP interface, so that anything the command line can do, a program can do, and the reverse. Where the two disagree, that is a bug, and the HTTP interface is the one that is correct.`,
  `A last convention concerns the examples. Hostnames in them end in .invalid, an address that is reserved so that it can never resolve, and tokens are read from the environment rather than written out; nothing in this document should be pasted into a shell without first being read. Where an example shows output, it is trimmed to the lines that matter, and a line that begins with an ellipsis stands for lines that were left out. Where an example shows a failure, the failure is real: it is the message that a recent version of the program printed for exactly that input, with the identifiers replaced.`,
  `Finally, a word about what Brindle does not do. It does not run your code for you; it hands a payload to a worker and waits for an outcome. It does not store your results beyond the retention window you configure. It does not try to be a workflow engine, a message bus or a database, and every time it has been asked to become one of those the answer has been to publish a hook and let somebody else do it better. The scope is deliberately narrow, and the narrowness is the reason that the rest of this document can be so specific.[^1]`,
];

// ---------------------------------------------------------------------------------------------
// Assemble the document
// ---------------------------------------------------------------------------------------------

emit(`# ${h1}`, '');
emit('*A configuration and API reference for the Brindle job scheduler. Brindle is an invented product; every name, address and value in this document was generated for a test fixture and refers to nothing real.*', '');
emit('## Contents', '');
// The contents heading takes a slug of its own, after the plan's, so it cannot disturb them.
for (const ch of plan) emit(`- [${ch.heading}](#${ch.slug})`);
emit(`- [${changelog.heading}](#${changelog.slug})`, `- [${notes.heading}](#${notes.slug})`);

// Chapter 1: the prose.
{
  const ch = plan[0];
  emit('', `## ${ch.heading}`);
  let used = 0;
  ch.sections.forEach((s, i) => {
    emit('', `### ${s.heading}`);
    const per = INTRO_SPLIT[i];
    for (let p = 0; p < per; p++) emit('', INTRO[used++].replace('{{LEASES}}', () => { const a = anchors.find((x) => x.num === '7.1'); return `[§7.1](#${a.slug})`; }));
  });
  if (used !== INTRO.length) throw new Error('the introduction split does not use every paragraph');
}

// Chapters 2 to 20.
for (const ch of plan.slice(1)) {
  emit('', `## ${ch.heading}`, '', `${cap(sentence(ch, `${ch.key}.${pick(KEYS)}`))} ${cap(sentence(ch, `${ch.key}.${pick(KEYS)}`))}`);
  for (const s of ch.sections) {
    emit('', `### ${s.heading}`);
    const key = `${ch.key}.${s.name.toLowerCase().replace(/ /g, '_')}`;
    body(ch, s, key);
    for (const sub of s.subs) {
      emit('', `#### ${sub.heading}`);
      body(ch, sub, sub.key ?? key);
    }
  }
}

// Changelog: 200 lines.
emit('', `## ${changelog.heading}`, '', 'Newest first. Each line names the setting or interface that changed.');
let changeLines = 0;
for (const r of RELEASES) {
  emit('', `### ${r.heading}`, '');
  for (let i = 0; i < 10; i++) {
    const ch = pick(CHAPTERS.slice(1));
    const kind = pick(['Added', 'Changed', 'Fixed', 'Deprecated', 'Removed']);
    const key = phrase.setting(ch);
    const text = pick([
      `\`${key}\` now accepts ${pick(['durations', 'ratios', 'byte counts'])} as well as integers`,
      `\`${key}\` no longer ${pick(['blocks', 'retries', 'logs'])} when ${pick(COND)}`,
      `the default of \`${key}\` is ${phrase.value()} (was ${phrase.value()})`,
      `${ch.title.toLowerCase()}: ${pick(VERB)} ${pick(THING)} is now recorded in the audit log`,
      `\`/v4/${ch.key}/${pick(NOUN)}s\` returns \`${int(400, 429)}\` instead of \`${int(500, 503)}\` when ${pick(COND)}`,
    ]);
    emit(`- **${kind}:** ${text}.`);
    changeLines++;
  }
}

// Notes: footnote definitions.
emit('', `## ${notes.heading}`, '', 'The numbered notes below are referenced from the chapters above.', '');
for (let i = 1; i <= FOOTNOTES; i++) {
  const ch = pick(CHAPTERS.slice(1));
  if (i === 1) {
    emit(`[^${i}]: This scope is a decision, not a gap. The plugin chapter (§${anchors.find((a) => a.slug.endsWith('plugins'))?.num ?? '17'}) lists the hooks that exist so that the missing features can live elsewhere.`, '');
    continue;
  }
  if (chance(0.4)) {
    emit(`[^${i}]: ${cap(sentence(ch, `${ch.key}.${pick(KEYS)}`))}`, '', `    ${cap(sentence(ch, `${ch.key}.${pick(KEYS)}`))} ${cap(sentence(ch, `${ch.key}.${pick(KEYS)}`))}`, '');
  } else {
    emit(`[^${i}]: ${cap(sentence(ch, `${ch.key}.${pick(KEYS)}`))} ${cap(sentence(ch, `${ch.key}.${pick(KEYS)}`))}`, '');
  }
}

// Collapse any doubled blank lines the emitters produced, and end with one newline.
let text = out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';

// ---------------------------------------------------------------------------------------------
// Write and verify
// ---------------------------------------------------------------------------------------------

writeFileSync(OUT, text);

const bytes = Buffer.byteLength(text, 'utf8');
const lines = text.split('\n');
const headings = { 1: 0, 2: 0, 3: 0, 4: 0 };
let inFence = false; let fences = 0; const langs = {}; let tables = 0; let wide = 0;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (/^```/.test(l)) {
    if (!inFence) { fences++; const lang = l.slice(3).trim(); langs[lang] = (langs[lang] ?? 0) + 1; }
    inFence = !inFence;
    continue;
  }
  if (inFence) continue;
  const m = /^(#{1,4}) /.exec(l);
  if (m) headings[m[1].length]++;
  if (/^\| ---/.test(l) || /^\| :?-{3}/.test(l)) {
    tables++;
    if (lines[i - 1].split('|').length - 2 >= 8) wide++;
  }
}
// Every cross-reference anchor must resolve against the headings as written.
const reslug = makeSlugger();
const present = new Set();
inFence = false;
for (const l of lines) {
  if (/^```/.test(l)) { inFence = !inFence; continue; }
  if (inFence) continue;
  const m = /^#{1,6} (.*)$/.exec(l);
  if (m) present.add(reslug(m[1].replace(/\s+$/, '')));
}
const links = [...text.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
const broken = links.filter((a) => !present.has(a));
const footRefs = (text.match(/\[\^\d+\](?!:)/g) ?? []).length;
const footDefs = (text.match(/^\[\^\d+\]:/gm) ?? []).length;
const introBytes = Buffer.byteLength(INTRO.join('\n\n'), 'utf8');

const summary = {
  seed: `0x${SEED.toString(16)}`,
  bytes,
  lines: lines.length - 1,
  headings: { ...headings, total: headings[1] + headings[2] + headings[3] + headings[4] },
  fences,
  fenceLanguages: langs,
  tables,
  wideTables: wide,
  changelogLines: changeLines,
  introProseBytes: introBytes,
  anchorLinks: links.length,
  brokenAnchors: broken.length,
  footnoteReferences: footRefs,
  footnoteDefinitions: footDefs,
  boldTermLists: stats.defLists,
  pandocDefinitionBlocks: stats.pandocDefs,
};
console.log(JSON.stringify(summary, null, 2));
if (broken.length > 0) { console.error('broken anchors:', broken.slice(0, 10)); process.exit(1); }
if (footRefs < footDefs - 1) { console.error('footnote reference/definition mismatch'); process.exit(1); }
