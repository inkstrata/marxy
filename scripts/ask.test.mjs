import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { askMain, parseAskArgs } from './ask.mjs';
import { answersMarkdown } from './lib/ask-answers.mjs';
import { checkSet, cleanAnswers, inline, renderPage, setTemplate } from './lib/ask.mjs';
import { parseArgs } from './work.mjs';

const SET = {
  title: 'Two calls',
  questions: [
    {
      id: 'sweep',
      title: 'What may a sweep remove?',
      context: ['A `tmp` file stays.'],
      visual: [{ bars: { unit: ' s', rows: [{ label: 'a', value: 2 }, { label: 'b', value: 1 }] } }, { table: { head: ['x'], rows: [['<b>']] } }],
      choices: [
        { id: 'none', label: 'Never' },
        { id: 'age', label: 'By age', specify: 'How old?' },
      ],
      default: 'Never',
    },
    { id: 'slice', title: 'Which slice?', multi: true, choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
    { id: 'free', title: 'Anything else?' },
  ],
};

function setDir(set = SET) {
  const dir = mkdtempSync(join(tmpdir(), 'marxy-ask-'));
  writeFileSync(join(dir, 'questions.json'), JSON.stringify(set));
  return dir;
}

test('pnpm work passes everything after ask to it', () => {
  const o = parseArgs(['ask', 'serve', 'x', '--port', '5000']);
  assert.equal(o.command, 'ask');
  assert.deepEqual(o.rest, ['serve', 'x', '--port', '5000']);
});

test('ask reads its own command line', () => {
  assert.equal(parseAskArgs([]).command, 'list');
  assert.deepEqual({ ...parseAskArgs(['serve', 'my-set', '--port', '5001', '--open']) }, { ...parseAskArgs([]), command: 'serve', name: 'my-set', port: 5001, open: true });
  assert.throws(() => parseAskArgs(['build']), /needs a set name/);
  assert.throws(() => parseAskArgs(['build', 'Bad Name']), /lower-case/);
  assert.throws(() => parseAskArgs(['serve', 'x', '--port', 'nine']), /--port/);
});

test('the template passes its own check, and a broken set lists every problem', () => {
  assert.deepEqual(checkSet(setTemplate('x')), []);
  assert.deepEqual(checkSet(SET), []);
  const problems = checkSet({ title: '', questions: [{ id: 'a', title: 't', choices: [{ id: 'c', label: 'x' }, { id: 'c', label: '' }] }, { id: 'a', title: '' }, { id: 'b', title: 't', visual: [{ bars: {}, table: {} }] }] });
  assert.ok(problems.some(p => /needs a title/.test(p) && !/question/.test(p)));
  assert.ok(problems.some(p => /choice c is used twice/.test(p)));
  assert.ok(problems.some(p => /id a is used twice/.test(p)));
  assert.ok(problems.some(p => /exactly one of/.test(p)));
});

test('text is escaped before code and bold are drawn', () => {
  assert.equal(inline('<img src=x> `a<b` **c**'), '&lt;img src=x&gt; <code>a&lt;b</code> <strong>c</strong>');
});

test('answers keep only real choices, one for a single-pick question, and drop empty ones', () => {
  const a = cleanAnswers(SET, {
    answers: {
      sweep: { picked: ['age', 'none', 'nope'], specify: { age: 'a week', none: 'ignored' }, note: '' },
      slice: { picked: ['a', 'b'] },
      free: { picked: [], note: '   ' },
      stranger: { note: 'x' },
    },
    sent: true,
  });
  assert.deepEqual(a.answers, { sweep: { picked: ['age'], specify: { age: 'a week' } }, slice: { picked: ['a', 'b'] } });
  assert.equal(a.sent, true);
});

test('answers as Markdown name each pick, what was specified, the note, and the default of an open question', () => {
  const md = answersMarkdown(SET, { sent: false, answers: { sweep: { picked: ['age'], specify: { age: 'a\nweek' } }, free: { picked: [], note: 'one\ntwo' } } });
  assert.match(md, /^# Answers: Two calls\n\n2 of 3 answered, not sent yet\./);
  assert.match(md, /## sweep: What may a sweep remove\?\n\n- Picked: By age \(`age`\)\n {2}- How old\?: a \/ week/);
  assert.match(md, /## slice: Which slice\?\n\nNot answered\.\n/);
  assert.match(md, /## free: Anything else\?\n\n> one\n> two\n/);
});

test('the page is one file: theme, answers code and data inline, and no text can close its script', () => {
  const evil = '</script><script>alert(1)</script>"><img onerror=x>';
  const set = {
    ...SET,
    title: evil,
    questions: [{ id: 'e', title: evil, context: [evil], from: evil, default: evil, note: evil, visual: [{ bars: { unit: evil, rows: [{ label: evil, value: 1, note: evil }] }, caption: evil }, { table: { head: [evil], rows: [[evil]] } }, { code: evil }], choices: [{ id: 'c', label: evil, detail: evil, specify: evil }] }],
  };
  const html = renderPage(set, { dir: '.', name: 'x', fonts: false });
  assert.doesNotMatch(html, /<img onerror/);
  assert.match(html, /--marxy-color-bg/);
  assert.match(html, /function answersMarkdown/);
  assert.doesNotMatch(html, /^export /m);
  assert.equal(html.match(/<\/script>/g).length, 2);
  assert.match(html, /data-act="save"/);
  assert.match(renderPage(SET, { dir: '.', name: 'x', served: true, fonts: false }), /data-act="send"/);
});

test('an image a set names must sit beside it', () => {
  assert.throws(() => renderPage({ title: 't', questions: [{ id: 'a', title: 't', visual: [{ image: 'missing.png' }] }] }, { dir: tmpdir(), name: 'x', fonts: false }), /no such file/);
});

// A loaded machine can take many seconds to answer the first request.
test('serve saves answers as they change and ends on send; another host is refused', { timeout: 120000 }, async t => {
  const dir = setDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const logs = [];
  t.mock.method(console, 'log', (...a) => logs.push(a.join(' ')));
  const out = [];
  const sink = { write: s => out.push(s) };
  const port = 46000 + Math.floor(Math.random() * 2000);
  const done = askMain(['serve', '--dir', dir, '--port', String(port), '--no-fonts'], undefined, sink);
  const base = await (async () => {
    for (let i = 0; i < 1500; i++) {
      const line = logs.find(l => l.startsWith('serving'));
      if (line) return line.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
      await new Promise(r => setTimeout(r, 20));
    }
    throw new Error('serve never said where');
  })();
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /data-act="send"/);
  // fetch drops a Host header it is given, so the other host is asked for by hand.
  const other = await new Promise((done, fail) => {
    const req = request(`${base}/`, { headers: { host: 'evil.example' } }, res => {
      res.resume();
      done(res.statusCode);
    });
    req.on('error', fail);
    req.end();
  });
  assert.equal(other, 403);
  const post = (path, body, headers = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post('/answers', { answers: { sweep: { picked: ['none'] } } }, { origin: 'http://evil.example' })).status, 403);
  assert.equal((await post('/answers', { answers: { sweep: { picked: ['none'] } } })).status, 200);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'answers.json'), 'utf8')).answers, { sweep: { picked: ['none'] } });
  assert.match(readFileSync(join(dir, 'answers.md'), 'utf8'), /not sent yet/);
  writeFileSync(join(dir, 'answers.json'), '{ not json');
  const broken = await fetch(`${base}/`);
  assert.equal(broken.status, 500);
  await broken.text();
  assert.equal((await post('/send', { answers: { sweep: { picked: ['age'], specify: { age: 'a week' } } } })).status, 200);
  assert.equal(await done, 0);
  const saved = JSON.parse(readFileSync(join(dir, 'answers.json'), 'utf8'));
  assert.equal(saved.sent, true);
  assert.match(out.join(''), /Picked: By age/);
});

test('read imports a saved file as the set\'s answers', async t => {
  const dir = setDir();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'from-browser.json');
  writeFileSync(file, JSON.stringify({ answers: { free: { note: 'hello' } } }));
  t.mock.method(console, 'log', () => {});
  const out = [];
  assert.equal(await askMain(['read', '--dir', dir, '--from', file], undefined, { write: s => out.push(s) }), 0);
  assert.ok(existsSync(join(dir, 'answers.md')));
  assert.match(out.join(''), /> hello/);
});
