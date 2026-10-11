// Local server for the taste-review harness. Zero dependencies.
// usage: node server.mjs [--root DIR] [--port N] [--keep]
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { loadRows, finish, inside, VERDICTS } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const root = resolve(arg('--root', join(here, '../../..')));
const port = Number(arg('--port', 4747));
const keep = process.argv.includes('--keep');
const redoDeferred = process.argv.includes('--deferred');
const sessionFile = process.env.TASTE_SESSION ?? join(homedir(), '.cache/marxy-taste-review/session.json');
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

const load = () => { try { return JSON.parse(readFileSync(sessionFile, 'utf8')); } catch { return { decisions: {} }; } };
const save = s => { mkdirSync(dirname(sessionFile), { recursive: true }); writeFileSync(sessionFile, JSON.stringify(s, null, 2)); };
const body = req => new Promise(r => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => r(b ? JSON.parse(b) : {})); });
const send = (res, code, data, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(data) : data); };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, readFileSync(join(here, 'ui.html')), 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/queue') {
      return send(res, 200, { rows: (await loadRows(root, { redoDeferred })).filter(r => !redoDeferred || r.previous), session: load(), verdicts: VERDICTS });
    }
    if (req.method === 'GET' && url.pathname === '/file') {
      const p = url.searchParams.get('p') ?? '';
      if (!inside(root, p) || !existsSync(join(root, p)) || !statSync(join(root, p)).isFile()) return send(res, 404, { error: 'no such file' });
      return send(res, 200, readFileSync(join(root, p)), MIME[extname(p).toLowerCase()] ?? 'text/plain; charset=utf-8');
    }
    if (req.method === 'PUT' && url.pathname === '/api/decision') {
      const { id, verdict, note } = await body(req);
      const s = load();
      if (!verdict || verdict === 'skip') delete s.decisions[id]; else s.decisions[id] = { verdict, note: note ?? '', at: new Date().toISOString() };
      save(s);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/open') {
      const { path } = await body(req);
      if (!inside(root, path)) return send(res, 400, { error: 'outside repo' });
      const abs = join(root, path);
      execFile('open', ['-a', 'Marxy', abs], err => err && execFile('open', [abs], () => {}));
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/finish') {
      const summary = await finish(root, load().decisions, { redoDeferred });
      save({ decisions: {}, finishedAt: new Date().toISOString(), summary });
      console.log('FINISHED', JSON.stringify(summary));
      if (!keep) setTimeout(() => process.exit(0), 2000);
      return send(res, 200, summary);
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});
server.listen(port, '127.0.0.1', () => console.log(`taste review → http://127.0.0.1:${port}  (root ${root})`));
