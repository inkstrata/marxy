// Computed review order for In Review pull requests. Phase, then disturbance descending, then
// age oldest first (ADR-0025). GitHub is read only through readPullRequest so --selftest can
// replace it.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deps, state } from './lib.mjs';

const SELFTEST_DIR = join(dirname(fileURLToPath(import.meta.url)), 'test/review-order');

/** Files every PR touches; counting them would make disturbance uniform and useless. */
export const SHARED_PATHS = [
  'CHANGELOG.md',
  'docs/taste-review/queue.md',
  'pnpm-lock.yaml',
];

const RESULT_JSON = /^orchestration\/results\/[^/]+\.json$/;

/** Whether a changed path counts when scoring how many other PRs this one disturbs. */
export function countsForDisturbance(file) {
  return !SHARED_PATHS.includes(file) && !RESULT_JSON.test(file);
}

let realGithubReads = 0;

/** How many times the real GitHub reader ran. Selftest asserts this stays at zero. */
export function realReadCount() {
  return realGithubReads;
}

/**
 * Read one pull request from GitHub. The only function that talks to the network.
 * Selftest replaces this; production is the only caller that may invoke it.
 */
export function readPullRequest(pr) {
  realGithubReads += 1;
  const raw = execFileSync(
    'gh',
    ['pr', 'view', String(pr), '--json', 'files,mergeStateStatus,mergeable,createdAt'],
    { encoding: 'utf8' },
  );
  const data = JSON.parse(raw);
  return {
    files: (data.files ?? []).map(f => f.path),
    mergeStateStatus: data.mergeStateStatus,
    mergeable: data.mergeable,
    createdAt: data.createdAt,
  };
}

export class PhaseError extends Error {
  /**
   * @param {string} key
   * @param {number[]} phases
   */
  constructor(key, phases) {
    const listed = [...phases].sort((a, b) => a - b).join(', ');
    const named = phases.length === 0 ? 'no phase' : `phases ${listed}`;
    super(`${key} is in ${named}`);
    this.name = 'PhaseError';
    this.key = key;
    this.phases = phases;
  }
}

/** Map each story key to every phase deps.json lists it in. */
export function phaseIndex(d) {
  const map = new Map();
  for (const [phase, keys] of Object.entries(d.phases || {})) {
    for (const key of keys || []) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(Number(phase));
    }
  }
  return map;
}

function throwIfDuplicatePhases(index) {
  for (const [key, phases] of index) {
    if (phases.length > 1) throw new PhaseError(key, phases);
  }
}

function isConflicted(pr) {
  return pr.mergeStateStatus === 'DIRTY' || pr.mergeable === 'CONFLICTING';
}

function intersect(a, b) {
  const set = new Set(a);
  return b.some(f => set.has(f));
}

/**
 * Compute the printable review order and the exclusions.
 * `readPr` is the injectable GitHub read; omit it only from the live CLI.
 */
export function computeOrder({
  s = state(),
  d = deps(),
  readPr,
  now = Date.now(),
} = {}) {
  if (typeof readPr !== 'function') {
    throw new Error('computeOrder requires readPr; pass readPullRequest in live use');
  }
  const index = phaseIndex(d);
  throwIfDuplicatePhases(index);

  const excluded = [];
  const candidates = [];

  for (const [key, rec] of Object.entries(s.stories || {})) {
    if (rec.status !== 'in_review') continue;
    if (rec.pr == null || rec.pr === '') {
      excluded.push({ key, why: 'no pull request number' });
      continue;
    }
    const phases = index.get(key) ?? [];
    if (phases.length !== 1) throw new PhaseError(key, phases);
    let prData;
    try {
      prData = readPr(rec.pr);
    } catch (e) {
      excluded.push({ key, pr: rec.pr, why: `could not read pull request: ${e.message}` });
      continue;
    }
    const files = (prData.files ?? []).filter(countsForDisturbance);
    candidates.push({
      key,
      pr: rec.pr,
      phase: phases[0],
      files,
      conflicted: isConflicted(prData),
      behind: prData.mergeStateStatus === 'BEHIND',
      dirty: prData.mergeStateStatus === 'DIRTY',
      ageHours: prData.createdAt == null ? 0 : (now - Date.parse(prData.createdAt)) / 36e5,
    });
  }

  for (const c of candidates) {
    c.disturbs = candidates.filter(o => o !== c && intersect(c.files, o.files)).length;
  }

  const order = [];
  for (const c of candidates) {
    const row = {
      key: c.key,
      pr: c.pr,
      phase: c.phase,
      disturbs: c.disturbs,
      ageHours: c.ageHours,
      behind: c.behind,
      dirty: c.dirty,
    };
    if (c.conflicted) {
      const why = c.dirty
        ? 'conflicts with main (mergeStateStatus DIRTY)'
        : 'conflicts with main (mergeable CONFLICTING)';
      excluded.push({ key: c.key, pr: c.pr, why });
      continue;
    }
    order.push(row);
  }

  order.sort((a, b) => {
    if (a.phase !== b.phase) return a.phase - b.phase;
    if (a.disturbs !== b.disturbs) return b.disturbs - a.disturbs;
    if (a.ageHours !== b.ageHours) return b.ageHours - a.ageHours;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  return { order, excluded };
}

const REQUIRED_SORT_CASES = [
  'sort: phase decides while disturbs, ageHours and key would not',
  'sort: disturbs decides while phase ties',
  'sort: ageHours decides while phase and disturbs tie',
  'sort: key decides while phase, disturbs and ageHours tie',
];

function matchFields(got, expect) {
  for (const [k, v] of Object.entries(expect)) {
    if (got[k] !== v) return `${k}: got ${JSON.stringify(got[k])}, want ${JSON.stringify(v)}`;
  }
  return null;
}

function runBoard(board) {
  const now = board.now ? Date.parse(board.now) : Date.now();
  const pulls = board.pulls || {};
  const readPr = pr => {
    const rec = pulls[String(pr)] ?? pulls[pr];
    if (!rec) throw new Error(`no fixture pull ${pr}`);
    return rec;
  };
  try {
    const got = computeOrder({ s: board.state, d: board.deps, readPr, now });
    if (board.expect?.exit === 1) {
      return { ok: false, detail: 'exited 0, want 1' };
    }
    const exp = board.expect || {};
    if (exp.orderKeys) {
      const keys = got.order.map(r => r.key);
      if (JSON.stringify(keys) !== JSON.stringify(exp.orderKeys)) {
        const detail = `order ${JSON.stringify(keys)}, want ${JSON.stringify(exp.orderKeys)}`;
        return { ok: false, detail };
      }
    }
    if (exp.excludedKeys) {
      const keys = got.excluded.map(r => r.key);
      if (JSON.stringify(keys) !== JSON.stringify(exp.excludedKeys)) {
        const detail = `excluded ${JSON.stringify(keys)}, want ${JSON.stringify(exp.excludedKeys)}`;
        return { ok: false, detail };
      }
    }
    if (exp.order) {
      for (const want of exp.order) {
        const row = got.order.find(r => r.key === want.key);
        if (!row) return { ok: false, detail: `${want.key} missing from order` };
        const miss = matchFields(row, want);
        if (miss) return { ok: false, detail: `${want.key} ${miss}` };
      }
    }
    if (exp.excluded) {
      for (const want of exp.excluded) {
        const row = got.excluded.find(r => r.key === want.key);
        if (!row) return { ok: false, detail: `${want.key} missing from excluded` };
        if (want.why && !String(row.why).includes(want.why)) {
          const got = JSON.stringify(row.why);
          const wantWhy = JSON.stringify(want.why);
          return { ok: false, detail: `${want.key} why ${got}, want ${wantWhy}` };
        }
        if (want.notInOrder && got.order.some(r => r.key === want.key)) {
          return { ok: false, detail: `${want.key} is in order; a conflicted PR must not be` };
        }
      }
    }
    if (exp.notInOrder) {
      for (const key of exp.notInOrder) {
        if (got.order.some(r => r.key === key)) {
          return { ok: false, detail: `${key} must not appear in order` };
        }
      }
    }
    if (exp.notListed) {
      for (const key of exp.notListed) {
        if (got.order.some(r => r.key === key) || got.excluded.some(r => r.key === key)) {
          return { ok: false, detail: `${key} must not appear in order or excluded` };
        }
      }
    }
    return { ok: true, got };
  } catch (e) {
    if (board.expect?.exit === 1) {
      const needle = board.expect.errorIncludes;
      if (needle && !String(e.message).includes(needle)) {
        const detail = `error ${JSON.stringify(e.message)}, want ${JSON.stringify(needle)}`;
        return { ok: false, detail };
      }
      if (!(e instanceof PhaseError)) {
        return { ok: false, detail: `threw ${e.name || e.constructor.name}, want PhaseError` };
      }
      return { ok: true };
    }
    return { ok: false, detail: e.message };
  }
}

function selftest() {
  let bad = 0;
  let ran = 0;
  const names = [];
  const report = (ok, name, detail) => {
    ran += 1;
    names.push(name);
    if (ok) console.log(`selftest ok: ${name}`);
    else {
      bad += 1;
      console.error(`selftest FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
    }
  };

  const files = readdirSync(SELFTEST_DIR).filter(f => f.endsWith('.json')).sort();
  for (const file of files) {
    const board = JSON.parse(readFileSync(join(SELFTEST_DIR, file), 'utf8'));
    const name = board.name || file;
    const { ok, detail } = runBoard(board);
    report(ok, name, detail);
  }

  for (const name of REQUIRED_SORT_CASES) {
    report(
      names.includes(name),
      `required sort case is present: ${name}`,
      names.includes(name) ? null : 'missing',
    );
  }

  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const prod = source.split('function selftest')[0];
  const readerSrc = (prod.match(/export function readPullRequest[\s\S]*?\nexport /) || [''])[0];
  const token = ["'", 'gh', "'"].join('');
  const ghInProd = prod.split(token).length - 1;
  const ghInReader = readerSrc.split(token).length - 1;
  report(
    ghInReader === 1 && ghInProd === 1 && !prod.includes('fetch(') && !/\bhttps\b/.test(prod),
    'GitHub is read through exactly one injectable function',
    `gh in production=${ghInProd} in reader=${ghInReader}`,
  );

  report(
    realReadCount() === 0,
    'selftest: the real GitHub reader is called zero times and makes no network request',
    `realReadCount=${realReadCount()}`,
  );

  const sdlc = readFileSync(new URL('../docs/sdlc.md', import.meta.url), 'utf8');
  const section = '## Review order and the review WIP limit';
  const chunk = sdlc.includes(section) ? sdlc.split(section)[1].split('\n## ')[0] : '';
  report(sdlc.includes(section), 'docs: sdlc.md has the Review order section');
  report(
    /phase/i.test(chunk) && /disturb/i.test(chunk) && /age/i.test(chunk) && /descend/i.test(chunk),
    'docs: the section states the three sort keys and why disturbance is descending',
  );
  report(
    /conflicted/i.test(chunk) && /returned rather than queued/i.test(chunk),
    'docs: a conflicted PR is returned rather than queued',
  );
  report(
    /does not count against the review WIP/i.test(chunk) && /same unit of work/i.test(chunk),
    'docs: a returned story does not count against the review WIP',
  );
  report(
    /original age/i.test(chunk) && /not at the\s+head/i.test(chunk),
    'docs: a returned story re-enters at its own phase, disturbance and original age',
  );

  const adrUrl = new URL('../docs/adr/0025-review-order-and-review-wip.md', import.meta.url);
  const adr = readFileSync(adrUrl, 'utf8');
  const adrIndex = readFileSync(new URL('../docs/adr/README.md', import.meta.url), 'utf8');
  report(/\*\*Status:\*\*\s*accepted/i.test(adr), 'docs: ADR-0025 is accepted');
  report(
    /\[0025\]\(0025-review-order-and-review-wip\.md\).*\baccepted\b/.test(adrIndex),
    'docs: ADR-0025 is listed in docs/adr/README.md',
  );
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const unreleased = changelog.split('## Unreleased')[1]?.split('\n## ')[0] || '';
  report(/MARXY-80/.test(unreleased), 'docs: CHANGELOG.md has a MARXY-80 line under Unreleased');

  if (ran < 12) {
    bad += 1;
    console.error(`selftest FAIL: case count ${ran} is below 12`);
  }
  if (bad) {
    console.error(`review-order selftest failed: ${bad} case(s)`);
    process.exit(1);
  }
  console.log(`review-order selftest ok: ${ran} named cases`);
  process.exit(0);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  if (process.argv.includes('--selftest')) selftest();
  else {
    try {
      const out = computeOrder({ readPr: readPullRequest });
      console.log(JSON.stringify(out, null, 2));
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  }
}
