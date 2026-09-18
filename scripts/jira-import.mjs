// Create the epics and stories from docs/plan/jira-issues.csv through the Jira Cloud REST API v3.
// env: JIRA_BASE_URL (https://x.atlassian.net) JIRA_EMAIL JIRA_API_TOKEN JIRA_PROJECT_KEY
// Discovers issue-type ids from the project; links stories to epics via the parent field.
import { readFileSync } from 'node:fs';
const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY } = process.env;
if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN || !JIRA_PROJECT_KEY) { console.error('set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY'); process.exit(2); }
const auth = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
const api = async (path, init = {}) => { const r = await fetch(`${JIRA_BASE_URL}/rest/api/3${path}`, { ...init, headers: { authorization: auth, 'content-type': 'application/json', accept: 'application/json', ...(init.headers || {}) } }); if (!r.ok) throw new Error(`${init.method || 'GET'} ${path}: ${r.status} ${await r.text()}`); return r.status === 204 ? null : r.json(); };
const parseCsv = t => { const rows = []; let row = [], cell = '', q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c; } if (cell || row.length) { row.push(cell); rows.push(row); } const [h, ...rest] = rows; return rest.filter(r => r.length === h.length).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
const issues = parseCsv(readFileSync(new URL('../docs/plan/jira-issues.csv', import.meta.url), 'utf8'));
const project = await api(`/project/${JIRA_PROJECT_KEY}`);
const types = Object.fromEntries(project.issueTypes.map(t => [t.name.toLowerCase(), t.id]));
const epicType = types.epic, storyType = types.story ?? types.task;
if (!epicType || !storyType) { console.error('project has no Epic/Story issue types:', Object.keys(types)); process.exit(2); }
const doc = text => ({ type: 'doc', version: 1, content: text.split('\n\n').map(p => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })) });
const created = {};
for (const it of issues.filter(i => i.Type === 'Epic')) {
  const r = await api('/issue', { method: 'POST', body: JSON.stringify({ fields: { project: { key: JIRA_PROJECT_KEY }, issuetype: { id: epicType }, summary: it.Summary, description: doc(it.Description) } }) });
  created[it.Key] = r.key; console.log(`epic ${it.Key} → ${r.key}`);
}
for (const it of issues.filter(i => i.Type === 'Story')) {
  const body = `${it.Description}\n\nAcceptance criteria (machine-checkable):\n${it.Acceptance}\n\nPaths this story may touch: ${it.Paths}\n\nPlan id: ${it.Key}`;
  const fields = { project: { key: JIRA_PROJECT_KEY }, issuetype: { id: storyType }, summary: it.Summary, description: doc(body), labels: it.Labels.split(',').filter(Boolean) };
  if (created[it.Parent]) fields.parent = { key: created[it.Parent] };
  const r = await api('/issue', { method: 'POST', body: JSON.stringify({ fields }) });
  created[it.Key] = r.key; console.log(`story ${it.Key} → ${r.key}`);
}
console.log(JSON.stringify(created, null, 2));
