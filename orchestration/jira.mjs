// The Jira bridge: Jira is the board of record, the CSV is the machine-readable story spec.
// node orchestration/jira.mjs <doctor|bootstrap|sync|move|comment|pr|task|release|migrate-ids> [args]
// Credentials come from ~/.config/marxy/jira.env (never the repo) or the environment.
// Out-of-plan work uses `task` so it can get a key without a CSV row (MARXY-101).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { ROOT, here, readJson, writeJson, stories, parseCsv, state } from './lib.mjs';

const ENV_FILE = process.env.MARXY_JIRA_ENV ?? `${homedir()}/.config/marxy/jira.env`;
const MAP = here('jira-map.json');
const CSV = `${ROOT}docs/plan/jira-issues.csv`;
const NEEDED = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY'];
// Board status → the Jira status names we will accept for it, best first.
const STATUS = {
  todo: ['To Do', 'Backlog', 'Open'],
  in_progress: ['In Progress'],
  in_review: ['In Review', 'Review', 'Code Review', 'In Progress'],
  done: ['Done', 'Closed', 'Resolved'],
  // No Blocked column on a four-state board: such a story waits in To Do wearing the label,
  // which keeps "In Progress" honest about what is actually being worked on.
  blocked: ['Blocked', 'On Hold', 'To Do'],
  escalate: ['Blocked', 'On Hold', 'To Do'],
};
const LABELLED = { blocked: 'blocked', escalate: 'escalated' };

const args = process.argv.slice(2);
const flag = f => { const i = args.indexOf(f); if (i >= 0) args.splice(i, 1); return i >= 0; };
const DRY = flag('--dry-run'), YES = flag('--yes');
const [cmd, ...rest] = args;
// `node --test` sets NODE_TEST_CONTEXT (and may pass --test in execArgv). The CLI must not run then.
const underTest = Boolean(process.env.NODE_TEST_CONTEXT)
  || process.execArgv.some(a => a === '--test' || a.startsWith('--test='));
const AUTH = ['doctor', 'bootstrap', 'sync', 'push', 'move', 'comment', 'pr', 'release', 'project'];
// `task --dry-run` must create nothing and must not need credentials, so tests can prove the path.

function env() {
  const file = existsSync(ENV_FILE) ? Object.fromEntries(readFileSync(ENV_FILE, 'utf8').split('\n')
    .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')])) : {};
  const e = { ...file };
  for (const k of NEEDED) if (process.env[k]) e[k] = process.env[k];
  const missing = NEEDED.filter(k => !e[k]);
  if (missing.length) {
    console.error(`jira: no credentials (${missing.join(', ')} unset).\n` +
      `Write them to ${ENV_FILE} (chmod 600) or export them. Token: https://id.atlassian.com/manage-profile/security/api-tokens\n` +
      `Without them the orchestrator must make the same change through the Atlassian MCP tools by hand.`);
    process.exit(3);
  }
  e.JIRA_BASE_URL = e.JIRA_BASE_URL.replace(/\/$/, '');
  return e;
}

const E = !underTest && (AUTH.includes(cmd) || (cmd === 'task' && !DRY)) ? env() : null;
const auth = () => 'Basic ' + Buffer.from(`${E.JIRA_EMAIL}:${E.JIRA_API_TOKEN}`).toString('base64');
async function api(path, init = {}, base = '/rest/api/3') {
  const url = `${E.JIRA_BASE_URL}${base}${path}`;
  if (DRY && init.method && init.method !== 'GET') { console.log(`[dry-run] ${init.method} ${path} ${init.body ?? ''}`); return { key: '(dry-run)', id: '0' }; }
  const r = await fetch(url, { ...init, headers: { authorization: auth(), 'content-type': 'application/json', accept: 'application/json', ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

/**
 * Every issue a JQL query matches. /search/jql pages with nextPageToken, and a single call stops at
 * maxResults: at 200 the board had ~190 issues, so push was one planning pass from silently
 * skipping the newest stories' status (MARXY-191).
 */
async function searchAll(jql, fields) {
  const issues = [];
  let token = null;
  do {
    const page = await api(`/search/jql?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=100${token ? `&nextPageToken=${encodeURIComponent(token)}` : ''}`);
    issues.push(...(page.issues ?? []));
    token = page.isLast === false || page.nextPageToken ? page.nextPageToken ?? null : null;
  } while (token);
  return issues;
}

const map = () => (existsSync(MAP) ? readJson(MAP) : { _note: 'plan id (pre-Jira) → the real Jira key. Written once by `jira.mjs bootstrap`; kept so old commits, ADRs and deltas stay readable.', keys: {} });
const jiraKey = k => map().keys[k] ?? k; // after migrate-ids the CSV already holds real keys
const doc = text => ({ type: 'doc', version: 1, content: text.split('\n\n').filter(Boolean).map(p => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })) });
// The plan id is only worth recording while it differs from the Jira key it became.
const body = (it, key) => [it.Description, it.Acceptance && `Acceptance criteria (machine-checkable): ${it.Acceptance}`,
  it.Paths && `Paths this story may touch: ${it.Paths}`, it.Key !== key && `Plan id: ${it.Key}`]
  .filter(s => s && s.trim()).join('\n\n');
const csvRows = () => parseCsv(readFileSync(CSV, 'utf8'));

async function statusNames() {
  const meta = await api(`/project/${E.JIRA_PROJECT_KEY}/statuses`).catch(() => []);
  return [...new Set(meta.flatMap(t => (t.statuses ?? []).map(s => s.name)))];
}

// Everything that could silently drift: credentials, the four states, and the three lists of
// stories (the CSV, the local board, Jira) that must name the same work.
async function doctor() {
  const me = await api('/myself');
  const project = await api(`/project/${E.JIRA_PROJECT_KEY}`).catch(e => ({ error: String(e) }));
  const names = project.error ? [] : await statusNames();
  const rows = csvRows(), board = readJson(here('state.json')).stories;
  const live = project.error ? [] : (await searchAll(`project = ${E.JIRA_PROJECT_KEY}`, 'summary')).map(i => i.key);
  const csvStories = rows.filter(r => r.Type === 'Story').map(r => r.Key);
  console.log(JSON.stringify({
    site: E.JIRA_BASE_URL, user: me.emailAddress ?? me.displayName,
    project: project.error ?? { key: project.key, name: project.name, style: project.style },
    statuses: names, missingForFourState: names.length ? ['To Do', 'In Progress', 'In Review', 'Done'].filter(n => !names.includes(n)) : '(unknown)',
    counts: { csvRows: rows.length, csvStories: csvStories.length, jiraIssues: live.length, boardStories: Object.keys(board).length, mapped: Object.keys(map().keys).length },
    drift: {
      csvRowsWithNoIssue: rows.map(r => r.Key).filter(k => !live.includes(k)),
      boardStoriesNotInCsv: Object.keys(board).filter(k => !csvStories.includes(k)),
      csvStoriesNotOnBoard: csvStories.filter(k => !board[k]),
    },
  }, null, 2));
}

// Create the project when it does not exist yet, and optionally delete a project we are replacing.
async function project(sub) {
  if (sub === 'delete') {
    const key = rest[1];
    if (!key || !YES) { console.error('usage: jira.mjs project delete KEY --yes'); process.exit(2); }
    await api(`/project/${key}`, { method: 'DELETE' });
    console.log(`deleted project ${key}`);
    return;
  }
  const existing = await api(`/project/${E.JIRA_PROJECT_KEY}`).catch(() => null);
  if (existing) { console.log(`project ${existing.key} (${existing.name}) already exists`); return; }
  const me = await api('/myself');
  const created = await api('/project', {
    method: 'POST', body: JSON.stringify({
      key: E.JIRA_PROJECT_KEY, name: process.env.JIRA_PROJECT_NAME ?? 'marxy', projectTypeKey: 'software',
      projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-agility-kanban',
      description: 'A markdown reader. Stories and acceptance criteria are generated from docs/plan/jira-issues.csv.',
      leadAccountId: me.accountId, assigneeType: 'PROJECT_LEAD',
    }),
  });
  console.log(`created project ${created.key ?? E.JIRA_PROJECT_KEY}`);
}

/** Fields posted for an out-of-plan Task. Dry-run and create share this so the label cannot drift. */
function taskFields(summary, text, projectKey) {
  const fields = {
    project: { key: projectKey },
    issuetype: { name: 'Task' },
    summary,
    labels: ['out-of-plan'],
  };
  if (text) fields.description = doc(text);
  return fields;
}

// Work that is not a planned story still needs a Jira key. A Task labelled out-of-plan is the
// supported path; `--dry-run` prints the payload and creates nothing.
async function task(summary, text) {
  if (!summary) { console.error('usage: jira.mjs task "summary" ["text"]'); process.exit(2); }
  const fields = taskFields(summary, text, E?.JIRA_PROJECT_KEY ?? 'MARXY');
  if (DRY) {
    console.log(`[dry-run] POST /issue ${JSON.stringify({ fields })}`);
    console.log('(dry-run)');
    return;
  }
  const p = await api(`/project/${E.JIRA_PROJECT_KEY}`);
  const type = p.issueTypes.find(t => t.name === 'Task');
  if (!type) { console.error('project has no Task issue type'); process.exit(2); }
  fields.issuetype = { id: type.id };
  const created = await api('/issue', { method: 'POST', body: JSON.stringify({ fields }) });
  console.log(created.key);
}

// First run: create every epic and story in CSV order so the Jira numbers follow the plan order.
async function bootstrap() {
  const p = await api(`/project/${E.JIRA_PROJECT_KEY}`);
  const types = Object.fromEntries(p.issueTypes.map(t => [t.name.toLowerCase(), t.id]));
  const epicType = types.epic, storyType = types.story ?? types.task;
  if (!epicType || !storyType) { console.error('project has no Epic/Story issue types:', Object.keys(types)); process.exit(2); }
  const m = map();
  for (const it of csvRows()) {
    if (m.keys[it.Key]) { console.log(`${it.Key} → ${m.keys[it.Key]} (already)`); continue; }
    const fields = {
      project: { key: E.JIRA_PROJECT_KEY }, issuetype: { id: it.Type === 'Epic' ? epicType : storyType },
      summary: it.Summary, description: doc(body(it, null)),
    };
    if (it.Labels) fields.labels = it.Labels.split(',').map(s => s.trim()).filter(Boolean);
    if (it.Parent && m.keys[it.Parent]) fields.parent = { key: m.keys[it.Parent] };
    const created = await api('/issue', { method: 'POST', body: JSON.stringify({ fields }) });
    m.keys[it.Key] = created.key;
    console.log(`${it.Type.toLowerCase()} ${it.Key} → ${created.key}`);
  }
  if (!DRY) writeJson(MAP, m);
  console.log(`\n${Object.keys(m.keys).length} issues mapped in ${MAP}.\nNext: node orchestration/jira.mjs migrate-ids`);
}

// Replace whole-word keys across the tree, skipping the corpus and the fonts whose bytes are
// never touched, and the map itself, which is the record of what the old keys were.
function rewriteTokens(pairs) {
  if (!pairs.length) return 0;
  const re = new RegExp(`\\b(${pairs.map(([f]) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g');
  const to = Object.fromEntries(pairs);
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n')
    .filter(f => f && !f.startsWith('fixtures/') && !f.startsWith('fonts/') && f !== 'orchestration/jira-map.json');
  let touched = 0;
  for (const f of files) {
    const p = `${ROOT}${f}`;
    let text;
    try { text = readFileSync(p, 'utf8'); } catch { continue; }
    const next = text.replace(re, k => to[k]);
    if (next === text) continue;
    touched++;
    if (DRY) console.log(`${f}: ${(text.match(re) ?? []).length} ids`);
    else writeFileSync(p, next);
  }
  return touched;
}

// Keep Jira's summary, description and labels equal to the CSV. Creates anything missing.
// A row the planner wrote with a placeholder key (MARXY-NEW-slug) gets Jira's real key here,
// and the placeholder is rewritten wherever it appears.
async function sync() {
  const p = await api(`/project/${E.JIRA_PROJECT_KEY}`);
  const types = Object.fromEntries(p.issueTypes.map(t => [t.name.toLowerCase(), t.id]));
  const m = map(); let created = 0, updated = 0, failed = 0; const renames = [];
  for (const it of csvRows()) {
    try {
    const placeholder = /^MARXY-NEW-/i.test(it.Key);
    const key = m.keys[it.Key] ?? it.Key;
    const issue = placeholder ? null : await api(`/issue/${key}?fields=summary,labels`).catch(() => null);
    const fields = { summary: it.Summary, description: doc(body(it, key)) };
    // The CSV owns the story's own labels; the orchestrator owns blocked/escalated, so they survive a sync.
    const own = Object.values(LABELLED).filter(l => issue?.fields?.labels?.includes(l));
    if (it.Labels || own.length) fields.labels = [...new Set([...(it.Labels ?? '').split(',').map(s => s.trim()).filter(Boolean), ...own])];
    if (issue) { await api(`/issue/${key}`, { method: 'PUT', body: JSON.stringify({ fields }) }); updated++; continue; }
    fields.project = { key: E.JIRA_PROJECT_KEY };
    fields.issuetype = { id: it.Type === 'Epic' ? types.epic : (types.story ?? types.task) };
    if (it.Parent) fields.parent = { key: m.keys[it.Parent] ?? it.Parent };
    const r = await api('/issue', { method: 'POST', body: JSON.stringify({ fields }) });
    if (!m.keys[it.Key]) m.keys[it.Key] = r.key;
    // Persist the mapping before doing anything else: a crash after this point must not let the
    // next run create a second issue for the same row.
    if (!DRY) writeJson(MAP, m);
    if (placeholder) renames.push([it.Key, r.key]);
    created++; console.log(`created ${it.Key} → ${r.key}`);
    // One unhappy row must not abandon the rest of the backlog half-synced.
    } catch (e) { failed++; console.error(`${it.Key}: ${e}`); }
  }
  if (!DRY) writeJson(MAP, m);
  // state.json is gitignored, so rewriteTokens never sees it. Re-read through state() so any
  // leftover MARXY-NEW- cache row moves onto the real key (MARXY-179).
  if (!DRY) state();
  const touched = rewriteTokens(renames);
  console.log(`sync: ${updated} updated, ${created} created, ${failed} failed${renames.length ? `, ${renames.length} placeholder key(s) resolved across ${touched} files` : ''}`);
  if (failed) process.exitCode = 1;
}

// Move an issue to the Jira status that represents a board status. Falls back and says so.
async function move(planKey, board) {
  const key = jiraKey(planKey), want = STATUS[board];
  if (!want) { console.error(`unknown board status ${board}; one of ${Object.keys(STATUS).join(', ')}`); process.exit(2); }
  const { transitions } = await api(`/issue/${key}/transitions`);
  const hit = want.map(name => transitions.find(t => t.to?.name?.toLowerCase() === name.toLowerCase())).find(Boolean);
  if (!hit) { console.error(`${key}: no transition to any of ${want.join(', ')} (has ${transitions.map(t => t.to?.name).join(', ')})`); process.exit(4); }
  await api(`/issue/${key}/transitions`, { method: 'POST', body: JSON.stringify({ transition: { id: hit.id } }) });
  const marker = LABELLED[board], stale = Object.values(LABELLED).filter(l => l !== marker);
  const update = { labels: [...(marker ? [{ add: marker }] : []), ...stale.map(l => ({ remove: l }))] };
  if (update.labels.length) await api(`/issue/${key}`, { method: 'PUT', body: JSON.stringify({ update }) }).catch(() => {});
  const exact = hit.to.name.toLowerCase() === want[0].toLowerCase();
  console.log(`${key} → ${hit.to.name}${marker ? ` + label ${marker}` : ''}${exact || marker ? '' : ` (wanted ${want[0]}; add that status to the board)`}`);
}

const comment = async (planKey, text) => { await api(`/issue/${jiraKey(planKey)}/comment`, { method: 'POST', body: JSON.stringify({ body: doc(text) }) }); console.log(`commented on ${jiraKey(planKey)}`); };

// A PR exists: link it on the issue and move the story to review.
async function pr(planKey, number) {
  const gh = (() => { try { return JSON.parse(execFileSync('gh', ['pr', 'view', number, '--json', 'url,title,headRefName'], { cwd: ROOT, encoding: 'utf8' })); } catch { return null; } })();
  await comment(planKey, `Pull request: ${gh?.url ?? `#${number}`}\n\n${gh?.title ?? ''}${gh?.headRefName ? `\n\nBranch: ${gh.headRefName}` : ''}`);
  await move(planKey, 'in_review');
}

// A phase is a Jira version; releasing it records the git tag that shipped it.
async function release(phase, tag) {
  const name = `v${tag.replace(/^v/, '')}`;
  const { values } = await api(`/project/${E.JIRA_PROJECT_KEY}/version?maxResults=100`);
  const found = values.find(v => v.name === name);
  const id = found?.id ?? (await api('/version', { method: 'POST', body: JSON.stringify({ name, projectId: (await api(`/project/${E.JIRA_PROJECT_KEY}`)).id, description: `Phase ${phase}` }) })).id;
  await api(`/version/${id}`, { method: 'PUT', body: JSON.stringify({ released: true, releaseDate: new Date().toISOString().slice(0, 10) }) });
  const keys = readJson(here('deps.json')).phases[String(phase)] ?? [];
  for (const k of keys) await api(`/issue/${jiraKey(k)}`, { method: 'PUT', body: JSON.stringify({ update: { fixVersions: [{ add: { id } }] } }) }).catch(e => console.error(String(e)));
  console.log(`${name} released with ${keys.length} issues from phase ${phase}`);
}

// Make Jira agree with the local board. Reports every drift it corrects, so a cycle that
// forgot to move an issue shows up as output rather than as a stale board.
async function push() {
  const board = readJson(here('state.json')).stories;
  const issues = await searchAll(`project = ${E.JIRA_PROJECT_KEY} AND issuetype != Epic`, 'status,labels');
  const live = Object.fromEntries(issues.map(i => [i.key, { status: i.fields.status.name, labels: i.fields.labels ?? [] }]));
  let moved = 0;
  for (const [key, rec] of Object.entries(board)) {
    const want = STATUS[rec.status], cur = live[key];
    if (!want || !cur) continue;
    const marker = LABELLED[rec.status];
    const agrees = want.some(n => n.toLowerCase() === cur.status.toLowerCase()) && (!marker || cur.labels.includes(marker));
    if (agrees) continue;
    await move(key, rec.status).catch(e => console.error(String(e)));
    moved++;
  }
  console.log(`push: ${moved} issue(s) moved, ${Object.keys(board).length - moved} already agreed`);
}

// Rewrite the pre-Jira plan ids to the real Jira keys everywhere except fixtures and fonts,
// whose bytes are never touched. Idempotent: unmapped ids are left alone.
function migrateIds() {
  const pairs = Object.entries(map().keys).filter(([from, to]) => from !== to).sort((a, b) => b[0].length - a[0].length);
  if (!pairs.length) { console.log('nothing to migrate (no map, or ids already are Jira keys)'); return; }
  const touched = rewriteTokens(pairs);
  if (!DRY) state();
  console.log(`${DRY ? 'would rewrite' : 'rewrote'} ${touched} files (fixtures/ and fonts/ untouched by rule)`);
}

if (!underTest) {
switch (cmd) {
  case 'doctor': await doctor(); break;
  case 'project': await project(rest[0] ?? 'create'); break;
  case 'bootstrap': await bootstrap(); break;
  case 'sync': await sync(); break;
  case 'push': await push(); break;
  case 'move': await move(rest[0], rest[1]); break;
  case 'comment': await comment(rest[0], rest.slice(1).join(' ')); break;
  case 'pr': await pr(rest[0], rest[1]); break;
  case 'task': await task(rest[0], rest.slice(1).join(' ')); break;
  case 'release': await release(rest[0], rest[1]); break;
  case 'migrate-ids': migrateIds(); break;
  default:
    console.error(`usage: jira.mjs <command> [--dry-run]
  doctor                       credentials, project, statuses, map health
  project create|delete KEY    create the project, or delete one (needs --yes)
  bootstrap                    create every epic and story from the CSV, write jira-map.json
  sync                         make Jira's summary/description/labels match the CSV
  push                         move every issue to the status the local board says
  move KEY <${Object.keys(STATUS).join('|')}>
  comment KEY "text"
  pr KEY <number>              link the PR on the issue and move it to review
  task "summary" ["text"]      create an out-of-plan Task and print its key
  release <phase> <tag>        create/release the version and stamp the phase's issues
  migrate-ids                  rewrite plan ids to Jira keys across the repo`);
    process.exit(2);
}
} else {
  const { default: test } = await import('node:test');
  const assert = await import('node:assert/strict');
  const { spawnSync, execFileSync } = await import('node:child_process');
  const { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const hookPath = join(repoRoot, '.githooks/commit-msg');
  const self = fileURLToPath(import.meta.url);

  function cliEnv(extra = {}) {
    const env = { ...process.env, ...extra };
    delete env.NODE_TEST_CONTEXT;
    return env;
  }

  function runTask(argv, extraEnv = {}) {
    return spawnSync(process.execPath, [self, ...argv], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: cliEnv(extraEnv),
    });
  }

  function cleanGitEnv(extra = {}) {
    const env = { ...process.env, ...extra };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    delete env.GIT_COMMON_DIR;
    delete env.NODE_TEST_CONTEXT;
    return env;
  }

  function runHook(message, { cwd, env } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'marxy-101-msg-'));
    const file = join(dir, 'msg');
    writeFileSync(file, message.endsWith('\n') ? message : `${message}\n`);
    try {
      return spawnSync(hookPath, [file], {
        encoding: 'utf8',
        cwd: cwd ?? repoRoot,
        env: cleanGitEnv(env),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('taskFields is a Task labelled out-of-plan', () => {
    const fields = taskFields('a summary', 'body text', 'MARXY');
    assert.equal(fields.issuetype.name, 'Task');
    assert.deepEqual(fields.labels, ['out-of-plan']);
    assert.equal(fields.summary, 'a summary');
    assert.equal(fields.project.key, 'MARXY');
    assert.ok(fields.description);
  });

  test('jira.mjs task without a summary prints usage and creates nothing', () => {
    const r = runTask(['task']);
    assert.equal(r.status, 2);
    assert.match(`${r.stdout}${r.stderr}`, /usage: jira\.mjs task/);
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /POST \/issue/);
  });

  test('jira.mjs task --dry-run prints the key placeholder and creates nothing', () => {
    const r = runTask(['task', '--dry-run', 'out-of-plan dry-run']);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /\[dry-run\] POST \/issue/);
    assert.match(r.stdout, /"name":"Task"/);
    assert.match(r.stdout, /"out-of-plan"/);
    assert.match(r.stdout, /\(dry-run\)/);
    assert.doesNotMatch(r.stdout, /MARXY-\d+/);
  });

  test('commit-msg exits non-zero when commitlint is missing and prints run pnpm install first', () => {
    const fake = mkdtempSync(join(tmpdir(), 'marxy-101-none-'));
    execFileSync('git', ['init', '-q'], { cwd: fake });
    chmodSync(hookPath, 0o755);
    const missing = runHook('fix(orchestration): short (MARXY-101)', { cwd: fake });
    rmSync(fake, { recursive: true, force: true });
    assert.notEqual(missing.status, 0);
    assert.match(`${missing.stdout}${missing.stderr}`, /run pnpm install first/);
  });

  test('commit-msg still fails a bad subject when commitlint is present', () => {
    chmodSync(hookPath, 0o755);
    const bad = runHook('not a conventional commit', { cwd: repoRoot });
    assert.notEqual(bad.status, 0, `${bad.stdout}${bad.stderr}`);
    assert.match(`${bad.stdout}${bad.stderr}`, /subject-empty|type-empty|marxy-key-in-subject|commitlint/);
  });

  test('AGENTS.md has a Work outside the plan rule naming jira.mjs task and type/KEY-slug', () => {
    const agents = readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8');
    assert.match(agents, /Work outside the plan/);
    assert.match(agents, /jira\.mjs task/);
    assert.match(agents, /type\/KEY-slug/);
  });
}
