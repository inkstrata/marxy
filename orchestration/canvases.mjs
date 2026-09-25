// Refresh Cursor fleet canvases from state.json, deps.json, needs-human.md, readiness, events.
// cycle.mjs runs this at the end of every cycle when the canvas directory exists (MARXY-208), and the
// fleet canvas carries a `health` block: the loop, the cycle lock, the planner and every in-flight
// story's verdict from reap.mjs.
// Timestamps embedded in canvas DATA use the machine's local timezone (short name suffix, e.g. PDT).
// usage: node orchestration/canvases.mjs [--dir PATH] [--json]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, here, stories, state, deps, models } from './lib.mjs';
import { selectReady } from './ready.mjs';
import { collect } from './readiness.mjs';
import { readPullRequest } from './review-order.mjs';
import { leaseHeld, readLease, LOOP_LEASE, CYCLE_LOCK } from './lease.mjs';
import { PLANNER_LEASE } from './plan-dispatch.mjs';
import { survey } from './reap.mjs';

const ROLE_KEYS = ['orchestrator', 'planner', 'implementor', 'implementorEscalation', 'reviewer'];

/** @param {string} [home] */
function storePaths(home = homedir()) {
  const dir = join(home, '.config', 'marxy', 'orchestration');
  return {
    dir,
    events: join(dir, 'events.jsonl'),
    implementFailures: join(dir, 'implement-failures.jsonl'),
  };
}

/** Cursor names a project's folder after its path: /Users/a/Dev/marxy → Users-a-Dev-marxy. */
export function cursorProjectName(root = ROOT) {
  return root.replace(/\/+$/, '').replace(/^\/+/, '').replaceAll('/', '-');
}

export function defaultCanvasDir(home = homedir(), root = ROOT) {
  return join(home, '.cursor', 'projects', cursorProjectName(root), 'canvases');
}

/** Liveness the fleet canvas shows; `health` from cycle.mjs is folded in when it has one. */
export function healthBlock({ inflight = null, cycleLog = [] } = {}, { read = readLease, held = leaseHeld } = {}) {
  const lease = path => {
    const l = read(path);
    return l ? { pid: l.pid, since: fmtLocalTime(l.started), alive: held(l) === true } : null;
  };
  return {
    loop: lease(LOOP_LEASE),
    cycle: lease(CYCLE_LOCK),
    planner: lease(PLANNER_LEASE),
    inflight: (inflight ?? survey().map(({ rec, ...r }) => r)).map(r => ({ key: r.key, verdict: r.verdict, why: r.why, to: r.to ?? null })),
    lastCycle: cycleLog.slice(-12),
  };
}

/** @param {Date} d */
function localTzShort(d) {
  return (
    new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(d).find(p => p.type === 'timeZoneName')
      ?.value ?? 'local'
  );
}

/** @param {string | null | undefined} iso */
export function fmtLocalTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da} ${h}:${mi} ${localTzShort(d)}`;
}

/** @param {string | null | undefined} iso — local calendar date for charts */
export function fmtLocalDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/** @deprecated use fmtLocalTime */
export const fmtUtc = fmtLocalTime;

/** @param {string} phaseKey */
function phaseLabel(phaseKey) {
  return phaseKey === 'ops' ? 'Ops' : `Phase ${phaseKey}`;
}

/** @param {string} key @param {ReturnType<typeof deps>} d */
export function phaseIdOf(key, d) {
  for (const [phase, keys] of Object.entries(d.phases || {})) {
    if ((keys || []).includes(key)) return phase;
  }
  return '?';
}

/** @param {string} key @param {ReturnType<typeof state>} board @param {ReturnType<typeof deps>} d */
export function unmetDeps(key, board, d) {
  const done = k => board.stories[k]?.status === 'done';
  return (d.deps[key] ?? []).filter(dep => !done(dep));
}

/** @param {{ Key: string, Summary: string, Labels?: string }} st @param {ReturnType<typeof state>} board @param {ReturnType<typeof deps>} d */
export function storyRow(st, board, d) {
  const rec = board.stories[st.Key] ?? { status: 'todo', attempts: 0 };
  return {
    key: st.Key,
    summary: st.Summary,
    phase: phaseIdOf(st.Key, d),
    status: rec.status ?? 'todo',
    attempts: rec.attempts ?? 0,
    model: rec.model ?? null,
    pr: rec.pr ?? null,
    started: fmtLocalTime(rec.started),
    finished: fmtLocalTime(rec.finished),
    deps: d.deps[st.Key] ?? [],
    unmet: unmetDeps(st.Key, board, d),
    labels: st.Labels ?? '',
  };
}

/** @param {ReturnType<typeof deps>} d @param {ReturnType<typeof state>} board */
export function phaseStats(d, board) {
  const statusOf = k => board.stories[k]?.status ?? 'todo';
  return Object.entries(d.phases || {}).map(([id, keys]) => {
    const list = keys || [];
    const total = list.length;
    let done = 0;
    let review = 0;
    let active = 0;
    let blocked = 0;
    let todo = 0;
    for (const k of list) {
      const s = statusOf(k);
      if (s === 'done') done += 1;
      else if (s === 'in_review') review += 1;
      else if (s === 'in_progress') active += 1;
      else if (s === 'blocked' || s === 'escalate') blocked += 1;
      else todo += 1;
    }
    return { id, label: phaseLabel(id), total, done, review, active, blocked, todo };
  });
}

/** @param {ReturnType<typeof deps>} d @param {ReturnType<typeof state>} board */
export function longestUnfinishedChain(d, board) {
  const done = k => board.stories[k]?.status === 'done';
  const open = new Set(
    Object.keys(board.stories).filter(k => !done(k)),
  );
  for (const k of Object.keys(d.deps || {})) {
    if (!done(k)) open.add(k);
  }
  const nodes = [...open];
  const adj = new Map(nodes.map(n => [n, []]));
  for (const to of nodes) {
    for (const from of d.deps[to] ?? []) {
      if (!open.has(from)) continue;
      adj.get(from).push(to);
    }
  }
  const memo = new Map();
  /** @param {string} n */
  function dfs(n) {
    if (memo.has(n)) return memo.get(n);
    let best = [n];
    for (const to of adj.get(n) ?? []) {
      const tail = dfs(to);
      if (tail.length + 1 > best.length) best = [n, ...tail];
    }
    memo.set(n, best);
    return best;
  }
  let longest = [];
  for (const n of nodes) {
    const chain = dfs(n);
    if (chain.length > longest.length) longest = chain;
  }
  return longest;
}

/**
 * @param {string} md
 * @param {{ openPrNumbers: Set<number>, storyDone: (k: string) => boolean }} ctx
 */
export function parseNeedsHuman(md, ctx) {
  const items = [];
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^- \[([ xX])\]\s*(.*)$/);
    if (!m) {
      i += 1;
      continue;
    }
    const open = m[1] === ' ';
    const rest = m[2];
    const dateM = rest.match(/^(\d{4}-\d{2}-\d{2})\s*[—–-]\s*/);
    const date = dateM ? dateM[1] : null;
    let title = dateM ? rest.slice(dateM[0].length) : rest;
    const detailParts = [];
    i += 1;
    while (i < lines.length && !lines[i].match(/^- \[[ xX]\]/) && !/^## /.test(lines[i])) {
      if (lines[i].trim()) detailParts.push(lines[i].trim());
      i += 1;
    }
    const detail = detailParts.join(' ').replace(/\s+/g, ' ').trim();
    const refs = [];
    const refRe = /\b(MARXY-\d+|PR #\d+)\b/g;
    for (const blob of [title, detail]) {
      let rm;
      while ((rm = refRe.exec(blob))) {
        if (!refs.includes(rm[1])) refs.push(rm[1]);
      }
    }
    const storyRefs = refs.filter(r => r.startsWith('MARXY-'));
    const holds = storyRefs.filter(k => !ctx.storyDone(k));
    const prRefs = refs
      .filter(r => r.startsWith('PR #'))
      .map(r => Number(r.slice(4)));
    const prsOpen = prRefs.some(n => ctx.openPrNumbers.has(n));
    const storiesOpen = storyRefs.some(k => !ctx.storyDone(k));
    let kind = 'action';
    if (/for information,\s*no action/i.test(title)) kind = 'info';
    else if (open && !storiesOpen && !prsOpen && (storyRefs.length || prRefs.length)) kind = 'stale';
    if (!open) continue;
    items.push({
      date,
      kind,
      title: title.replace(/\*\*/g, ''),
      detail,
      refs,
      holds,
      holdsCount: holds.length,
    });
  }
  return items;
}

/** @param {ReturnType<typeof stories>} all @param {ReturnType<typeof state>} board @param {ReturnType<typeof deps>} d */
export function shippedMetrics(all, board, d) {
  const rows = all
    .map(st => storyRow(st, board, d))
    .filter(r => r.status === 'done')
    .sort((a, b) => (b.finished ?? '').localeCompare(a.finished ?? ''));
  let firstTry = 0;
  let retried = 0;
  let tracked = 0;
  const cycleMins = [];
  for (const r of rows) {
    if (r.attempts > 0) {
      tracked += 1;
      if (r.attempts <= 1) firstTry += 1;
      else retried += 1;
    }
    const rec = board.stories[r.key];
    const startMs = rec?.started ? new Date(rec.started).getTime() : NaN;
    const endMs = rec?.finished ? new Date(rec.finished).getTime() : NaN;
    if (r.attempts > 0 && Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      cycleMins.push((endMs - startMs) / 60_000);
    }
  }
  const byDay = new Map();
  for (const r of rows) {
    const rec = board.stories[r.key];
    const day = fmtLocalDay(rec?.finished);
    if (!day) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const days = [...byDay.keys()].sort();
  const perDay = days.map(d => byDay.get(d));
  cycleMins.sort((a, b) => a - b);
  const medianMin =
    cycleMins.length === 0
      ? null
      : Math.round(cycleMins[Math.floor(cycleMins.length / 2)]);
  return {
    rows,
    days,
    perDay,
    firstTry,
    tracked,
    retried,
    medianMin,
    cycleN: cycleMins.length,
  };
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** @param {ReturnType<typeof state>} board */
export function modelTable(board, home = homedir()) {
  const store = storePaths(home);
  const events = readJsonl(store.events);
  const fails = readJsonl(store.implementFailures);
  /** @type {Map<string, { done: number, first: number, retried: number, attempts: number, dispatch: number, returns: number, escalate: number, fails: number }>} */
  const byModel = new Map();
  const touch = name => {
    if (!byModel.has(name)) {
      byModel.set(name, {
        done: 0,
        first: 0,
        retried: 0,
        attempts: 0,
        dispatch: 0,
        returns: 0,
        escalate: 0,
        fails: 0,
      });
    }
    return byModel.get(name);
  };
  for (const rec of Object.values(board.stories ?? {})) {
    if (rec.status !== 'done') continue;
    const name = rec.model?.trim() ? rec.model : 'not recorded';
    const b = touch(name);
    b.done += 1;
    b.attempts += rec.attempts ?? 0;
    if ((rec.attempts ?? 0) <= 1) b.first += 1;
    else b.retried += 1;
  }
  for (const ev of events) {
    const name = ev.model?.trim() ? ev.model : 'not recorded';
    const b = touch(name);
    if (ev.kind === 'dispatch' && ev.role === 'implementor') b.dispatch += 1;
    else if (ev.kind === 'return') b.returns += 1;
    else if (ev.kind === 'escalate') b.escalate += 1;
    else if (ev.kind === 'implement_fail') b.fails += 1;
  }
  for (const f of fails) {
    const name = f.model?.trim() ? f.model : 'not recorded';
    touch(name).fails += 1;
  }
  const modelRows = [...byModel.entries()]
    .map(([model, b]) => {
      const tracked = b.first + b.retried;
      return {
        model,
        done: b.done,
        first: b.first,
        retried: b.retried,
        firstPct: tracked ? Math.round((100 * b.first) / tracked) : null,
        avgAttempts: b.done ? Math.round((100 * b.attempts) / b.done) / 100 : null,
        dispatch: b.dispatch,
        returns: b.returns,
        escalate: b.escalate,
        fails: b.fails,
      };
    })
    .sort((a, b) => b.done - a.done || a.model.localeCompare(b.model));
  const eventCompute = [...new Set(events.map(e => e.compute).filter(Boolean))];
  const recentFails = fails
    .slice(-15)
    .reverse()
    .map(f => ({
      at: fmtLocalTime(f.at),
      key: f.key ?? '—',
      model: f.model ?? '—',
      attempt: f.attempt ?? 0,
      reason: f.reason ?? '—',
      compute: f.compute ?? '—',
    }));
  return { modelRows, eventsN: events.length, eventCompute, fails: recentFails };
}

function liveOpenPrs() {
  return JSON.parse(
    execFileSync(
      'gh',
      [
        'pr',
        'list',
        '--state',
        'open',
        '--limit',
        '200',
        '--json',
        'number,title,url,headRefName,headRefOid,state,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,createdAt,files,author',
      ],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 },
    ).trim(),
  );
}

/** @param {{ board?: ReturnType<typeof state>, d?: ReturnType<typeof deps>, all?: ReturnType<typeof stories>, prs?: unknown[], needsHumanMd?: string, home?: string, health?: { inflight?: unknown[], cycleLog?: string[] } }} [opts] */
export function gatherCanvasData(opts = {}) {
  const board = opts.board ?? state();
  const d = opts.d ?? deps();
  const all = opts.all ?? stories();
  const byKey = new Map(all.map(st => [st.Key, st]));
  const asOf = fmtLocalTime(new Date().toISOString());
  const storyRows = all.map(st => storyRow(st, board, d));
  const statusOf = k => board.stories[k]?.status ?? 'todo';
  const counts = { total: all.length, done: 0, in_review: 0, in_progress: 0, blocked: 0, escalate: 0, todo: 0 };
  for (const st of all) {
    const s = statusOf(st.Key);
    if (s === 'done') counts.done += 1;
    else if (s === 'in_review') counts.in_review += 1;
    else if (s === 'in_progress') counts.in_progress += 1;
    else if (s === 'blocked') counts.blocked += 1;
    else if (s === 'escalate') counts.escalate += 1;
    else counts.todo += 1;
  }
  const ready = selectReady({ all, s: board, d });
  const prsRaw = opts.prs ?? liveOpenPrs();
  const openPrNumbers = new Set(prsRaw.map(p => p.number));
  const prRows = collect({
    prs: prsRaw,
    readPr: readPullRequest,
    state: board,
    deps: d,
  });
  const prs = prRows.map(p => ({
    number: p.number,
    key: p.key,
    summary: p.key ? byKey.get(p.key)?.Summary ?? null : null,
    url: p.url,
    ci: p.ci,
    mergeable: p.mergeable,
    approval: p.approval,
    waitingOn: p.waitingOn,
    next: p.next,
  }));
  const needsHumanMd =
    opts.needsHumanMd ??
    (existsSync(here('needs-human.md')) ? readFileSync(here('needs-human.md'), 'utf8') : '');
  const human = parseNeedsHuman(needsHumanMd, {
    openPrNumbers,
    storyDone: k => statusOf(k) === 'done',
  });
  const inflight = storyRows.filter(s => s.status === 'in_progress');
  const m = models();
  const roles = ROLE_KEYS.map(role => ({
    role,
    model: m[role]?.model ?? '—',
    effort: m[role]?.effort ?? '—',
    inApp: m[role]?.inApp ?? '—',
  }));
  const modelsBlock = modelTable(board, opts.home);
  const phases = phaseStats(d, board);
  return {
    asOf,
    fleet: {
      health: healthBlock(opts.health ?? {}),
      merges: board.merges ?? 0,
      lastPlan: fmtLocalTime(board.lastPlan),
      counts,
      phases,
      inflight,
      next: ready.ready.map(r => ({ key: r.key, summary: r.summary })),
      blockedByDeps: ready.blockedByDeps.length,
      human,
      prs,
    },
    shipped: shippedMetrics(all, board, d),
    roadmap: {
      phases,
      stories: storyRows,
      chain: longestUnfinishedChain(d, board),
    },
    models: {
      compute: m.compute,
      eventCompute: modelsBlock.eventCompute,
      eventsN: modelsBlock.eventsN,
      modelRows: modelsBlock.modelRows,
      roles,
      fails: modelsBlock.fails,
    },
    humanQueue: { human, prs },
  };
}

export function formatDataJson(obj) {
  return JSON.stringify(obj, null, 1);
}

const CANVAS_FILES = {
  fleet: 'marxy-fleet.canvas.tsx',
  shipped: 'marxy-shipped.canvas.tsx',
  roadmap: 'marxy-roadmap.canvas.tsx',
  models: 'marxy-models.canvas.tsx',
  humanQueue: 'marxy-human-queue.canvas.tsx',
};

/** @param {string} filePath @param {unknown} data */
export function patchCanvasData(filePath, data) {
  const text = readFileSync(filePath, 'utf8');
  const re = /const DATA = \{[\s\S]*?\} as unknown as Data;/;
  if (!re.test(text)) throw new Error(`no DATA block in ${filePath}`);
  const block = `const DATA = ${formatDataJson(data)} as unknown as Data;`;
  writeFileSync(filePath, text.replace(re, block));
}

/** @param {ReturnType<typeof gatherCanvasData>} data @param {string} dir */
export function writeCanvases(data, dir) {
  patchCanvasData(join(dir, CANVAS_FILES.fleet), {
    asOf: data.asOf,
    ...data.fleet,
  });
  patchCanvasData(join(dir, CANVAS_FILES.shipped), {
    asOf: data.asOf,
    shipped: data.shipped,
  });
  patchCanvasData(join(dir, CANVAS_FILES.roadmap), {
    asOf: data.asOf,
    ...data.roadmap,
  });
  patchCanvasData(join(dir, CANVAS_FILES.models), {
    asOf: data.asOf,
    ...data.models,
  });
  patchCanvasData(join(dir, CANVAS_FILES.humanQueue), {
    asOf: data.asOf,
    ...data.humanQueue,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const dirFlag = process.argv.indexOf('--dir');
  const dir = dirFlag >= 0 ? process.argv[dirFlag + 1] : defaultCanvasDir();
  const data = gatherCanvasData();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    writeCanvases(data, dir);
    console.log(`Updated 5 canvases in ${dir} (as of ${data.asOf})`);
  }
}
