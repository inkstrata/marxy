// Standing check that branch protection and merge settings on main have not drifted from MARXY-6.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const FIXTURES = join(ROOT, 'scripts/fixtures/protection');
const PROTECTION_PATH = 'repos/{owner}/{repo}/branches/main/protection';
const REPOSITORY_PATH = 'repos/{owner}/{repo}';

const ENFORCE_ADMINS_FAIL =
  'enforce_admins: while it is false a direct push to main by the admin account is not rejected; MARXY-6 is the story that sets it';

/** GitHub wraps several protection flags as `{ enabled }`; accept a raw boolean too. */
export function enabled(value) {
  if (value && typeof value === 'object' && 'enabled' in value) return value.enabled;
  return value;
}

function statusContexts(protection) {
  const checks = protection?.required_status_checks ?? {};
  const fromContexts = Array.isArray(checks.contexts) ? checks.contexts : [];
  const fromChecks = Array.isArray(checks.checks)
    ? checks.checks.map((row) => row?.context).filter(Boolean)
    : [];
  return [...new Set([...fromContexts, ...fromChecks])];
}

const CONDITIONS = [
  {
    name: 'strict+ci',
    holds: (s) =>
      s.protection?.required_status_checks?.strict === true && statusContexts(s.protection).includes('ci'),
    fail: (s) => {
      const checks = s.protection?.required_status_checks;
      const contexts = statusContexts(s.protection);
      return `strict+ci: required status checks must be strict and contain ci (strict=${checks?.strict ?? 'absent'}, contexts=${JSON.stringify(contexts)})`;
    },
  },
  {
    name: 'enforce_admins',
    holds: (s) => enabled(s.protection?.enforce_admins) === true,
    fail: () => ENFORCE_ADMINS_FAIL,
  },
  {
    name: 'require_code_owner_reviews',
    holds: (s) => s.protection?.required_pull_request_reviews?.require_code_owner_reviews === true,
    fail: (s) =>
      `require_code_owner_reviews: expected true, got ${s.protection?.required_pull_request_reviews?.require_code_owner_reviews ?? 'absent'}`,
  },
  {
    name: 'required_linear_history',
    holds: (s) => enabled(s.protection?.required_linear_history) === true,
    fail: (s) => `required_linear_history: expected true, got ${enabled(s.protection?.required_linear_history) ?? 'absent'}`,
  },
  {
    name: 'allow_force_pushes',
    holds: (s) => enabled(s.protection?.allow_force_pushes) === false,
    fail: (s) => `allow_force_pushes: expected false, got ${enabled(s.protection?.allow_force_pushes) ?? 'absent'}`,
  },
  {
    name: 'allow_deletions',
    holds: (s) => enabled(s.protection?.allow_deletions) === false,
    fail: (s) => `allow_deletions: expected false, got ${enabled(s.protection?.allow_deletions) ?? 'absent'}`,
  },
  {
    name: 'allow_merge_commit',
    holds: (s) => s.repository?.allow_merge_commit === false,
    fail: (s) => `allow_merge_commit: expected false, got ${s.repository?.allow_merge_commit ?? 'absent'}`,
  },
  {
    name: 'allow_rebase_merge',
    holds: (s) => s.repository?.allow_rebase_merge === false,
    fail: (s) => `allow_rebase_merge: expected false, got ${s.repository?.allow_rebase_merge ?? 'absent'}`,
  },
  {
    name: 'allow_squash_merge',
    holds: (s) => s.repository?.allow_squash_merge === true,
    fail: (s) => `allow_squash_merge: expected true, got ${s.repository?.allow_squash_merge ?? 'absent'}`,
  },
  {
    name: 'delete_branch_on_merge',
    holds: (s) => s.repository?.delete_branch_on_merge === true,
    fail: (s) => `delete_branch_on_merge: expected true, got ${s.repository?.delete_branch_on_merge ?? 'absent'}`,
  },
  {
    name: 'merge_group',
    holds: (s) => !s.queueRequired || workflowHasMergeGroup(s.workflow),
    fail: () =>
      'merge_group: merge queue is required but the workflow has no merge_group trigger',
  },
];

export const CONDITION_NAMES = CONDITIONS.map((c) => c.name);

/** Pure so --selftest can drive it with fixtures and --live can drive it from gh api. */
export function evaluate(settings) {
  const out = [];
  const fails = [];
  for (const condition of CONDITIONS) {
    if (condition.holds(settings)) out.push(`${condition.name}: ok`);
    else fails.push(condition.fail(settings));
  }
  return { ok: fails.length === 0, out, fails };
}

export function readLiveSettings(reader) {
  return {
    protection: reader(PROTECTION_PATH),
    repository: reader(REPOSITORY_PATH),
  };
}

export function createGhReader({ execFile = execFileSync } = {}) {
  return (path) => {
    try {
      return JSON.parse(execFile('gh', ['api', path], { encoding: 'utf8' }));
    } catch (error) {
      const detail = (error.stderr || error.message || '').toString().trim();
      throw new Error(`gh api ${path}: ${detail}`);
    }
  };
}

export function workflowsReferenceGate(text) {
  return text.includes('gate-protection');
}

/** A workflow that will run the required `ci` check on a GitHub merge-group event. */
export function workflowHasMergeGroup(text) {
  return /^\s*merge_group\s*:/m.test(String(text ?? ''));
}

export function hygieneDocumentsPatch(text) {
  const hasPatch = text.includes('gh api -X PATCH');
  const hasStrict = text.includes('-F strict=true');
  const namesCi = /requires `ci` only|single required context|contexts\[\]=ci/.test(text);
  const documentsPutCommand = text.includes('gh api -X PUT');
  return hasPatch && hasStrict && namesCi && !documentsPutCommand;
}

function passingSettings() {
  return {
    protection: {
      required_status_checks: { strict: true, contexts: ['ci'], checks: [{ context: 'ci' }] },
      enforce_admins: { enabled: true },
      required_pull_request_reviews: { require_code_owner_reviews: true },
      required_linear_history: { enabled: true },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
    },
    repository: {
      allow_merge_commit: false,
      allow_rebase_merge: false,
      allow_squash_merge: true,
      delete_branch_on_merge: true,
    },
  };
}

function loadFixtures() {
  const names = readdirSync(FIXTURES).filter((name) => name.endsWith('.json')).sort();
  return names.map((name) => {
    const raw = readFileSync(join(FIXTURES, name), 'utf8');
    return { name, settings: JSON.parse(raw) };
  });
}

function fileUnchanged(path) {
  const committed = execFileSync('git', ['show', `origin/main:${path}`], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return committed === readFileSync(join(ROOT, path), 'utf8');
}

function workflowFiles() {
  const dir = join(ROOT, '.github/workflows');
  return readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
}

function selftest() {
  let bad = 0;
  let ran = 0;
  const report = (ok, name, detail) => {
    ran += 1;
    if (ok) console.log(`selftest ok: ${name}`);
    else {
      bad += 1;
      console.error(`selftest FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
    }
  };

  const fixtures = loadFixtures();
  report(
    fixtures.length >= 10,
    `fixtures: case count ${fixtures.length} (need at least 10)`,
    fixtures.length < 10 ? `only ${fixtures.length} JSON files under scripts/fixtures/protection/` : null,
  );

  const seen = new Set();
  for (const fixture of fixtures) {
    const condition = fixture.settings.condition;
    const verdict = evaluate(fixture.settings);
    if (verdict.ok) {
      report(false, `fixture ${fixture.name} must not pass`, 'evaluate() accepted a flipped fixture');
      continue;
    }
    const named = verdict.fails.some((line) => line.startsWith(`${condition}:`));
    report(
      Boolean(condition) && CONDITION_NAMES.includes(condition) && named && !seen.has(condition),
      `fixture ${fixture.name}: ${condition} flipped and rejected`,
      !condition
        ? 'fixture has no condition field'
        : seen.has(condition)
          ? `duplicate condition ${condition}`
          : named
            ? null
            : `expected a failure naming ${condition}; got ${JSON.stringify(verdict.fails)}`,
    );
    seen.add(condition);
    if (condition === 'enforce_admins') {
      const text = verdict.fails.find((line) => line.startsWith('enforce_admins:')) ?? '';
      report(
        text.includes('while it is false a direct push to main by the admin account is not rejected')
          && text.includes('MARXY-6'),
        'enforce_admins failure text names the admin-push hole and MARXY-6',
        text || 'no enforce_admins failure',
      );
    }
  }
  for (const name of CONDITION_NAMES) {
    report(seen.has(name), `fixtures: ${name} has a flipped case`, seen.has(name) ? null : 'missing');
  }

  const passing = passingSettings();
  const passVerdict = evaluate(passing);
  report(passVerdict.ok && passVerdict.out.length === CONDITIONS.length, 'inline passing settings are accepted');

  let readerCalls = 0;
  let ghSpawns = 0;
  const reader = (path) => {
    readerCalls += 1;
    if (path === PROTECTION_PATH) return passing.protection;
    if (path === REPOSITORY_PATH) return passing.repository;
    throw new Error(`unexpected path ${path}`);
  };
  const execFile = (cmd, args) => {
    ghSpawns += 1;
    throw new Error(`selftest must not spawn ${cmd} ${args.join(' ')}`);
  };
  const fromReader = evaluate(readLiveSettings(reader));
  report(
    fromReader.ok && readerCalls === 2 && ghSpawns === 0,
    'injected reader call counter: no network, no gh',
    `ok=${fromReader.ok} reads=${readerCalls} gh=${ghSpawns}`,
  );
  createGhReader({ execFile });
  report(ghSpawns === 0, 'createGhReader is not invoked during selftest', `gh spawns ${ghSpawns}`);

  const workflows = workflowFiles();
  const referenced = workflows.filter((file) => workflowsReferenceGate(file.text)).map((file) => file.name);
  report(referenced.length === 0, 'workflows: nothing under .github/workflows/ references this script', referenced.join(', '));
  report(
    workflowsReferenceGate('run: node scripts/gate-protection.mjs --selftest'),
    'workflows: a reference to this script is detected',
  );

  report(fileUnchanged('package.json'), 'package.json is byte-identical to origin/main');
  const cycleSrc = readFileSync(join(ROOT, 'orchestration/cycle.mjs'), 'utf8');
  report(/\bmergeQueue\b/.test(cycleSrc), 'cycle.mjs reads mergeQueue');
  const ciYml = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  report(workflowHasMergeGroup(ciYml), 'ci.yml listens for merge_group');
  report(/^name:\s*ci\s*$/m.test(ciYml), 'required check name ci is unchanged');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  report(!pkg.scripts['gate:protection'], 'package.json has no gate:protection script');

  const hygiene = readFileSync(join(ROOT, 'docs/hygiene.md'), 'utf8');
  report(hygieneDocumentsPatch(hygiene), 'hygiene.md documents gh api -X PATCH with -F strict=true and ci');
  report(
    !hygieneDocumentsPatch(
      "After this workflow merges, set it once: `gh api -X PUT repos/inkstrata/marxy/branches/main/protection/required_status_checks -f strict=true -f 'contexts[]=ci'`.",
    ),
    'hygiene.md: the old PUT command is rejected',
  );

  report(
    process.argv.includes('--selftest') && process.argv.some((arg) => arg.endsWith('gate-protection.mjs')),
    'invoked as node scripts/gate-protection.mjs --selftest',
  );

  const cases = ran;
  if (fixtures.length < 10) {
    bad += 1;
    console.error(`selftest FAIL: case count ${fixtures.length} is below 10`);
  }
  if (bad) {
    console.error(`protection gate selftest failed: ${bad} case(s)`);
    process.exit(1);
  }
  console.log(`protection gate selftest ok: ${fixtures.length} fixtures, ${cases} named cases`);
}

function live(reader = createGhReader()) {
  if (process.env.CI) {
    console.error('✗ --live never runs in CI');
    console.error('    fix: invoke node scripts/gate-protection.mjs --selftest; live mode needs admin and is not a CI job');
    process.exit(1);
  }
  let settings;
  try {
    settings = readLiveSettings(reader);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    console.error('    fix: install gh, authenticate, and have permission to read branch protection on main');
    process.exit(1);
  }
  const verdict = evaluate(settings);
  for (const line of verdict.out) console.log(line);
  if (!verdict.ok) {
    for (const line of verdict.fails) {
      console.error(`✗ ${line}`);
      console.error('    fix: MARXY-6 is the story that sets these; this gate does not change GitHub settings');
    }
    process.exit(1);
  }
  console.log(`… ok (${CONDITIONS.length})`);
}

function main() {
  const self = process.argv.includes('--selftest');
  const liveMode = process.argv.includes('--live');
  if (self && liveMode) {
    console.error('✗ pass only one of --selftest or --live');
    console.error('    fix: node scripts/gate-protection.mjs --selftest');
    process.exit(2);
  }
  if (self) {
    selftest();
    return;
  }
  if (liveMode) {
    live();
    return;
  }
  console.error('usage: node scripts/gate-protection.mjs --selftest | --live');
  process.exit(2);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main();
