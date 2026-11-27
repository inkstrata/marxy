// Questions for the owner, answered on a page: `pnpm work ask [command] <set>`.
//   list        the sets under work/questions/ and how many of each are answered (the default)
//   new         a set folder with a questions.json to fill in
//   build       the set's page as one HTML file beside it, to open in a browser; answers stay in that browser
//   serve       the page on 127.0.0.1; every change is saved beside the set, and Send ends the command
//   read        the answers as Markdown; --from imports a file the page saved
// usage: node scripts/ask.mjs [list|new|build|serve|read] <set> [options]; --help lists them
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answeredCount, answersMarkdown } from './lib/ask-answers.mjs';
import { ANSWERS_FILE, ANSWERS_MD, cleanAnswers, pageName, QUESTIONS_FILE, readSet, renderPage, setTemplate } from './lib/ask.mjs';
import { workspace } from './lib/workspace.mjs';

const SCRIPT_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ASK_COMMANDS = ['list', 'new', 'build', 'serve', 'read'];

const USAGE = `usage: pnpm work ask [command] [<set>] [options]
  list                         the sets in work/questions/ with how many are answered (the default)
  new <set>                    work/questions/<set>/questions.json, a template to fill in
  build <set> [--no-fonts]     <set>-questions.html beside it; opened as a file it keeps answers in the browser
  serve <set> [--port n] [--open] [--no-fonts]
                               the page on http://127.0.0.1:<port>/ (default 4517, the next free one if taken);
                               answers are saved to answers.json and answers.md as they change; Send prints them and exits
  read <set> [--from <file>] [--json]
                               the answers as Markdown; --from takes a file the page saved and keeps it as the set's answers
a set name is lower-case letters, digits and hyphens; --dir <folder> uses a set folder anywhere instead`;

export function parseAskArgs(argv) {
  const o = { command: 'list', name: null, port: 4517, open: false, fonts: true, from: null, json: false, dir: null, help: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case '--port': o.port = Number(take()); break;
      case '--from': o.from = take(); break;
      case '--dir': o.dir = take(); break;
      case '--open': o.open = true; break;
      case '--no-fonts': o.fonts = false; break;
      case '--json': o.json = true; break;
      case '--help': case '-h': o.help = true; break;
      default:
        if (a.startsWith('-')) throw new Error(`unknown argument ${a}`);
        positional.push(a);
    }
  }
  if (positional.length) o.command = positional.shift();
  if (!ASK_COMMANDS.includes(o.command)) throw new Error(`unknown command ${o.command}; the commands are ${ASK_COMMANDS.join(', ')}`);
  if (o.command !== 'list') {
    o.name = positional.shift() ?? null;
    if (!o.name && !o.dir) throw new Error(`${o.command} needs a set name`);
    if (o.name && !/^[a-z0-9][a-z0-9-]{0,59}$/.test(o.name)) throw new Error(`a set name is lower-case letters, digits and hyphens, not ${o.name}`);
  }
  if (positional.length) throw new Error(`unexpected argument ${positional[0]}`);
  if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw new Error('--port is a number from 1 to 65535');
  return o;
}

/** The answers on disk, cleaned against the set, so a hand-edited file cannot hand the page a shape it does not expect. */
function readAnswers(dir, set) {
  const path = join(dir, ANSWERS_FILE);
  if (!existsSync(path)) return null;
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${path}: ${e.message}`);
  }
  return { ...cleanAnswers(set, raw), saved: typeof raw?.saved === 'string' ? raw.saved : null };
}

function writeAnswers(dir, set, answers) {
  writeFileSync(join(dir, ANSWERS_FILE), `${JSON.stringify(answers, null, 2)}\n`);
  writeFileSync(join(dir, ANSWERS_MD), answersMarkdown(set, answers));
}

function list(root) {
  if (!existsSync(root)) {
    console.log(`no sets yet in ${root}: pnpm work ask new <set>`);
    return 0;
  }
  const names = readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && existsSync(join(root, e.name, QUESTIONS_FILE))).map(e => e.name).sort();
  for (const name of names) {
    const dir = join(root, name);
    try {
      const set = readSet(dir);
      const a = readAnswers(dir, set);
      const n = answeredCount(set.questions, a?.answers ?? {});
      console.log(`${name.padEnd(32)} ${`${n} of ${set.questions.length} answered`.padEnd(18)} ${a?.sent ? 'sent' : a ? 'saved, not sent' : 'no answers'}  ${set.title}`);
    } catch (e) {
      console.log(`${name.padEnd(32)} cannot be read: ${e.message.split('\n')[0]}`);
    }
  }
  if (!names.length) console.log(`no sets yet in ${root}: pnpm work ask new <set>`);
  return 0;
}

function make(dir, name) {
  const path = join(dir, QUESTIONS_FILE);
  if (existsSync(path)) throw new Error(`${path} exists already`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(setTemplate(name), null, 2)}\n`);
  console.log(`wrote    ${path}`);
  console.log(`next     fill it in, then pnpm work ask serve ${name} (or build ${name})`);
  return 0;
}

function build(dir, name, o) {
  const set = readSet(dir);
  const path = join(dir, pageName(name));
  writeFileSync(path, renderPage(set, { dir, name, answers: readAnswers(dir, set), fonts: o.fonts }));
  console.log(`wrote    ${path}`);
  return 0;
}

function openInBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

function listen(server, port, tries = 20) {
  return new Promise((done, fail) => {
    const attempt = p => {
      server.once('error', e => (e.code === 'EADDRINUSE' && p < port + tries && p < 65535 ? attempt(p + 1) : fail(e)));
      server.listen(p, '127.0.0.1', () => done(p));
    };
    attempt(port);
  });
}

function body(req, limit = 2 * 1024 * 1024) {
  return new Promise((done, fail) => {
    const parts = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) {
        fail(new Error('too large'));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => done(Buffer.concat(parts).toString('utf8')));
    req.on('error', fail);
  });
}

function serve(dir, name, o, out) {
  const set = readSet(dir);
  let port = 0;
  return new Promise((finish, fail) => {
    const server = createServer(async (req, res) => {
      const reply = (code, text, type = 'text/plain; charset=utf-8') => {
        res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
        res.end(text);
      };
      try {
        await handle(req, reply);
      } catch (e) {
        // A set or answers file edited into a bad state, or a failed write: the page says so and the server stays up.
        console.error(`ask: ${e.message}`);
        if (!res.headersSent) reply(500, e.message.split('\n')[0]);
      }
    });
    const handle = async (req, reply) => {
      // Only this machine's own page: another site in the browser cannot reach or write the set.
      if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return reply(403, 'wrong host');
      if (req.method === 'GET' && req.url === '/') {
        const now = readSet(dir);
        return reply(200, renderPage(now, { dir, name, served: true, answers: readAnswers(dir, now), fonts: o.fonts }), 'text/html; charset=utf-8');
      }
      if (req.method === 'POST' && (req.url === '/answers' || req.url === '/send')) {
        const origin = req.headers.origin;
        if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return reply(403, 'wrong origin');
        let raw;
        try {
          raw = JSON.parse(await body(req));
        } catch (e) {
          return reply(400, `bad answers: ${e.message}`);
        }
        const sent = req.url === '/send';
        const answers = cleanAnswers(set, { ...raw, sent });
        writeAnswers(dir, set, answers);
        reply(200, 'saved');
        if (sent) {
          console.log(`sent     ${join(dir, ANSWERS_MD)}\n`);
          out.write(answersMarkdown(set, answers));
          server.close();
          server.closeAllConnections?.();
          finish(0);
        }
        return;
      }
      reply(404, 'not found');
    };
    listen(server, o.port).then(p => {
      port = p;
      const url = `http://127.0.0.1:${p}/`;
      console.log(`serving  ${url}  (${set.questions.length} questions; answers go to ${join(dir, ANSWERS_FILE)})`);
      console.log('waiting  for Send on the page; Ctrl+C stops and keeps what was saved');
      if (o.open) openInBrowser(url);
    }, fail);
    process.once('SIGINT', () => {
      console.log(`\nstopped  before Send; saved answers, if any, are in ${dir}`);
      server.close();
      finish(130);
    });
  });
}

function read(dir, o, out) {
  const set = readSet(dir);
  if (o.from) {
    const raw = JSON.parse(readFileSync(resolve(o.from), 'utf8'));
    writeAnswers(dir, set, cleanAnswers(set, raw));
    console.log(`kept     ${resolve(o.from)} as ${join(dir, ANSWERS_FILE)}\n`);
  }
  const a = readAnswers(dir, set);
  if (!a) {
    console.log(`no answers yet in ${dir}`);
    return 1;
  }
  out.write(o.json ? `${JSON.stringify(a, null, 2)}\n` : answersMarkdown(set, a));
  return 0;
}

/** `out` takes the answers' Markdown, which a waiting command reads; the rest goes to the console. */
export async function askMain(argv, rootDir = SCRIPT_ROOT, out = process.stdout) {
  let o;
  try {
    o = parseAskArgs(argv);
  } catch (e) {
    console.error(`ask: ${e.message}\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    console.log(USAGE);
    return 0;
  }
  try {
    const sets = join(workspace(resolve(rootDir)).work, 'questions');
    const dir = o.dir ? resolve(o.dir) : o.name ? join(sets, o.name) : null;
    const name = o.name ?? (dir ? dir.split(/[\\/]/).filter(Boolean).at(-1) : null);
    if (o.command === 'list') return list(sets);
    if (o.command === 'new') return make(dir, name);
    if (o.command === 'build') return build(dir, name, o);
    if (o.command === 'serve') return await serve(dir, name, o, out);
    return read(dir, o, out);
  } catch (e) {
    console.error(`ask: ${String(e.stderr || e.message).trim()}`);
    return 2;
  }
}

if (import.meta.main) process.exit(await askMain(process.argv.slice(2)));
