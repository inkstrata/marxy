import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carriesMarkdown, describeColumn, looksLikeVerse, readingOf, READING_MAX_ROWS, RUN_BLOCKS, RUNS_FROM, setsPlainReading } from './index.ts';
import { FIRST_ROWS } from './rows.ts';
import { parseJson, parseToml, parseXml, parseYaml, TreeError, type TreeNode } from './tree.ts';
import { cpuNow } from '../testing/cpu-clock.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const keys = (n: TreeNode): (string | null)[] => (n.children ?? []).map((c) => c.key);
const child = (n: TreeNode, key: string): TreeNode => {
  const found = n.children?.find((c) => c.key === key);
  assert.ok(found, `no ${key}`);
  return found;
};

/** Every `data-marxy-s`/`data-marxy-e` pair in `html`, as the bytes it names. */
function spans(html: string, bytes: Uint8Array): string[] {
  const dec = new TextDecoder();
  return [...html.matchAll(/data-marxy-s="(\d+)" data-marxy-e="(\d+)"/g)].map((m) => dec.decode(bytes.subarray(Number(m[1]), Number(m[2]))));
}

test('JSON: keys in the order written, values typed, each with the text it came from', () => {
  const text = '{"b": 1, "a": [true, null, "x"], "c": {"d": 2.5e3}}';
  const root = parseJson(text);
  assert.deepEqual(keys(root), ['b', 'a', 'c']);
  assert.equal(child(root, 'b').type, 'number');
  assert.deepEqual(child(root, 'a').children?.map((c) => c.type), ['bool', 'null', 'string']);
  const d = child(child(root, 'c'), 'd');
  assert.equal(text.slice(d.start, d.end).includes('2.5e3'), true);
});

test('JSON: a file that does not parse says where and what was expected', () => {
  assert.throws(() => parseJson('{"a": 1,\n "b" 2}'), (e: unknown) => e instanceof TreeError && e.at === 14 && /expected/.test(e.message));
  assert.throws(() => parseJson('{"a": 1} trailing'), TreeError);
});

test('YAML: block maps, lists of maps, quoted and block scalars, comments that are not in quotes', () => {
  const root = parseYaml(
    ['name: ci # the pipeline', 'on: [push, pull_request]', 'jobs:', '  - id: build', '    run: "make # all"', '  - id: test', 'notes: |', '  line one', '  line two', ''].join('\n'),
  );
  assert.deepEqual(keys(root), ['name', 'on', 'jobs', 'notes']);
  assert.equal(child(root, 'name').value, 'ci');
  assert.deepEqual(child(root, 'on').children?.map((c) => c.value), ['push', 'pull_request']);
  const jobs = child(root, 'jobs');
  assert.equal(jobs.kind, 'list');
  assert.equal(child(jobs.children![0]!, 'run').value, 'make # all');
  assert.equal(child(root, 'notes').type, 'block');
  assert.equal(child(root, 'notes').value, 'line one\nline two');
});

test('TOML: tables, arrays of tables, dotted keys, inline tables', () => {
  const root = parseToml(['title = "tidemark"', 'owner.name = "Ada"', '[index]', 'workers = 4', '[[watch]]', 'path = "~/notes"', '[[watch]]', 'path = "~/code"', 'opts = { deep = true }', ''].join('\n'));
  assert.deepEqual(keys(root), ['title', 'owner', 'index', 'watch']);
  assert.equal(child(child(root, 'owner'), 'name').value, 'Ada');
  assert.equal(child(child(root, 'index'), 'workers').type, 'number');
  const watch = child(root, 'watch');
  assert.equal(watch.kind, 'list');
  assert.equal(watch.children?.length, 2);
  assert.equal(child(child(watch.children![1]!, 'opts'), 'deep').type, 'bool');
});

test('XML: elements, attributes, entities and CDATA; the prolog and comments are skipped', () => {
  const root = parseXml('<?xml version="1.0"?>\n<!-- feed -->\n<feed lang="en"><title>A &amp; B</title><raw><![CDATA[<b>]]></raw></feed>');
  assert.equal(root.kind, 'element');
  assert.equal(root.key, 'feed');
  assert.deepEqual(root.attrs, [{ name: 'lang', value: 'en' }]);
  assert.equal(child(root, 'title').children?.[0]?.value ?? child(root, 'title').value, 'A & B');
  assert.throws(() => parseXml('<a><b></a>'), TreeError);
});

test('a data file reads as a tree whose blocks name their own bytes, multi-byte text included', () => {
  const bytes = enc('{\n  "café": "naïve",\n  "n": 3\n}\n');
  const r = readingOf('x.json', bytes, 'data');
  assert.ok(r);
  assert.equal(r.id, 'tree');
  assert.equal(r.format, 'JSON');
  assert.deepEqual(r.contents?.items.map((i) => i.text), ['café', 'n']);
  const named = spans(r.html, bytes);
  // The value after a two-byte é: an offset counted in UTF-16 would land a byte short.
  assert.ok(named.includes('"naïve"'), named.join(' | '));
  assert.ok(named.includes('3'), named.join(' | '));
});

test('a data file that does not parse is set as written, with the line', () => {
  const r = readingOf('bad.json', enc('{\n  "a": 1,\n  "b"\n}\n'), 'data');
  assert.ok(r);
  assert.equal(r.id, 'written');
  assert.equal(r.failed?.line, 4);
});

test('a data file chosen as another kind is that kind’s page, not a tree', () => {
  assert.equal(readingOf('x.json', enc('{"a": 1}'), 'code'), null);
  assert.equal(readingOf('x.csv', enc('a,b\n1,2\n'), 'code'), null);
});

test('JSON Lines: records as rows, keys as columns in first-seen order, a bad line kept and said', () => {
  const bytes = enc('{"at": "t1", "ms": 5}\n{"at": "t2", "ok": true}\nnot json\n');
  const r = readingOf('runs.jsonl', bytes, 'data');
  assert.ok(r);
  assert.equal(r.id, 'records');
  assert.deepEqual(r.contents?.items.map((i) => [i.text, i.sub]), [
    ['at', 'every record'],
    ['ms', 'in 1 of 2'],
    ['ok', 'in 1 of 2'],
  ]);
  assert.match(r.html, /marxy-records-bad[^>]*>.*line 3/);
  assert.ok(spans(r.html, bytes).includes('{"at": "t2", "ok": true}'));
});

test('JSON Lines that are a conversation are left to the transcript page', () => {
  assert.equal(readingOf('s.jsonl', enc('{"role":"user"}\n{"role":"assistant"}\n'), 'transcript'), null);
});

test('CSV: a table with sortable headers, numbers marked, columns described', () => {
  const r = readingOf('p.csv', enc('date,service,ms\n2026-10-08,api,41\n2026-10-10,auth,22\n2026-10-09,api,39\n'), 'data');
  assert.ok(r);
  assert.equal(r.id, 'table');
  assert.equal((r.html.match(/data-marxy-sort=/g) ?? []).length, 3);
  assert.equal((r.html.match(/class="marxy-num"/g) ?? []).length, 3);
  assert.deepEqual(r.contents?.items.map((i) => i.sub), ['3 dates, 10-08 to 10-10', 'api, auth', '22 to 41']);
});

test('a table past the rows drawn whole is set with its first rows, and holds every row for the page to draw', () => {
  const body = Array.from({ length: READING_MAX_ROWS + 5 }, (_, i) => `${i},x`).join('\n');
  const r = readingOf('big.csv', enc(`n,v\n${body}\n`), 'data');
  assert.ok(r);
  assert.equal((r.html.match(/<tr data-marxy-s/g) ?? []).length, FIRST_ROWS);
  assert.match(r.html, new RegExp(`The first ${FIRST_ROWS} rows of ${(READING_MAX_ROWS + 5).toLocaleString('en-GB')}; the file open in Read has them all\\.`));
  assert.equal(r.rows?.starts.length, READING_MAX_ROWS + 5);
  assert.equal(r.rows?.indexed, true);
});

test('describeColumn: ranges for numbers and dates, the values when few, a count otherwise', () => {
  assert.equal(describeColumn(['3', '10', '-2', '']), '-2 to 10');
  assert.equal(describeColumn(['7', '7']), '7');
  assert.equal(describeColumn(['2025-12-30', '2026-01-02']), '2 dates, 2025-12-30 to 2026-01-02');
  assert.equal(describeColumn(['a', 'b', 'a']), 'a, b');
  assert.equal(describeColumn(['a', 'b', 'c', 'd', 'e']), '5 values');
  assert.equal(describeColumn(['', ' ']), 'empty');
});

const POEM = ['Tide table', '', 'Low water at six. The harbour', 'gives back what it borrowed:', 'a boot, a rope gone green,', 'the ribs of a boat no one claims.', '', 'We walk out on the sand', 'as if the sea had signed for it,', 'reading the ripples like a page', 'that someone left mid-sentence.', ''].join('\n');

test('verse keeps every line where the file breaks it and lists its stanzas', () => {
  assert.equal(looksLikeVerse(POEM), true);
  const r = readingOf('tide.txt', enc(POEM), 'article');
  assert.ok(r);
  assert.equal(r.id, 'verse');
  assert.equal((r.html.match(/class="marxy-verse-line/g) ?? []).length, 8);
  assert.equal(r.contents?.items.length, 2);
});

test('plain text: wrapped prose joins its lines into paragraphs, Markdown in a .txt is left to Markdown, the rest is as written', () => {
  const prose = 'This is a long line of words that goes on and on\nto the next line of words here.\n\nA second paragraph with five words or more in it.\n';
  assert.equal(readingOf('n.txt', enc(prose), 'article')?.id, 'prose');
  assert.equal(readingOf('n.txt', enc('# Title\n\nSee [the guide](https://example.com/guide) first.\n'), 'article'), null);
  assert.equal(readingOf('n.txt', enc('a=1\nb=2\n'), 'article')?.id, 'written');
  assert.equal(readingOf('n.md', enc(prose), 'article'), null);
});

test('a .txt keeps its lines unless it carries Markdown marks: lists, numbered lines and one `*` are plain text\'s too', () => {
  const notice = [
    "HARBOUR MASTER'S OFFICE - NOTE TO MASTERS AND PILOTS",
    '',
    'All vessels must report to the Harbour Master before entering the Lock Gate.',
    '',
    '1. Pilotage and dues',
    '   - Pilotage for vessels over 40 m is payable at the office.',
    '   - A *special tide* surcharge applies at springs.',
    '',
    '2. Tide times (at the Ferry Steps)',
    '   High water   06:12   4.9 m',
    '   Low water    12:31   0.6 m',
    '   High water   18:40   5.1 m',
    '',
  ].join('\r\n');
  const field = [
    'Field notes, tide gauge visits, October',
    '',
    'Mon. First visit to the mole. Range 4.9 m at springs, the pencil mark on the steps is 0.3 m too low.',
    'Tue. Ynys Mon tide tables arrived: they run about half an hour ahead of ours.',
    'Wed. Compared notes with the Aero crew by radio; they quote the bridge as the datum for everything.',
    'Thu. The old pilots call the open water the deep, mostly as a joke, and mean it kindly.',
    '',
  ].join('\n');
  for (const [name, text] of [['notice', notice], ['field notes', field]] as const) {
    const bytes = enc(text);
    const r = readingOf(`/n/${name}.txt`, bytes, 'notes');
    assert.equal(r?.id, 'written', name);
    assert.equal(setsPlainReading(`/n/${name}.txt`, bytes, 'notes'), true, name);
    // Every line is drawn on its own, and each drawn line is its bytes, line ending excluded.
    assert.deepEqual(spans(r!.html, bytes), text.split(/\r?\n/).slice(0, -1), name);
  }
  // Two lines with marks plain text does not write: Markdown.
  for (const md of ['## Install\n\nRun `make` first.\n', 'Read the [guide](https://example.com).\n\n```\nmake\n```\n', '| a | b |\n|---|---|\n| 1 | 2 |\n\n**Note:** x\n']) {
    assert.equal(readingOf('/n/r.txt', enc(md), 'article'), null, md);
  }
  // A `# ` heading counts as two marks: a heading over a list is Markdown.
  assert.equal(readingOf('/n/r.txt', enc('# Notes\n\n- a\n- b\n'), 'notes'), null);
  assert.equal(carriesMarkdown('# Notes\n\n- a\n- b\n'), true);
  // A #hashtag, a list, a quote or an underlined title is not enough.
  for (const plain of ['#1 priority list\n- milk\n- eggs\n- bread\n', '#tides #harbour\n- milk\n', 'Agenda\n======\n\n> quoted from the minutes\n1) tides\n2) dues\n', 'snake_case_name and 5 * 3 = 15\n']) {
    assert.notEqual(readingOf('/n/r.txt', enc(plain), 'article'), null, plain);
    assert.equal(carriesMarkdown(plain), false, plain);
  }
});

test('the Markdown marks are looked for in each line\'s first characters only: a long line costs no more than they do', () => {
  const lines = [' '.repeat(50_000) + 'x', '[a]('.repeat(20_000), '*a'.repeat(100_000), '[a]'.repeat(60_000), `|${' '.repeat(100_000)}-`, '_a'.repeat(100_000)];
  const t0 = cpuNow();
  for (const line of lines) assert.equal(carriesMarkdown(`${line}\n${line}\n`), false, line.slice(0, 12));
  const ms = cpuNow() - t0;
  assert.ok(ms < 200, `${Math.round(ms)} ms for six crafted lines of 50 to 200 KB`);
  // Many lines of unclosed `[`: each is scanned once, not from every bracket to its end.
  const brackets = `${'[a '.repeat(334)}\n`.repeat(2000);
  const t1 = cpuNow();
  assert.equal(carriesMarkdown(brackets), false);
  const bracketMs = cpuNow() - t1;
  assert.ok(bracketMs < 200, `${Math.round(bracketMs)} ms for 2,000 lines of unclosed brackets`);
  assert.equal(carriesMarkdown('See [the notes](a.md).\nAnd [more](b.md).\n'), true);
  // A mark past the first thousand characters of its line is not seen.
  assert.equal(carriesMarkdown(`${'x'.repeat(1000)} [a](b)\n${'x'.repeat(1000)} [a](b)\n`), false);
});

test('a written line is its own bytes, whatever ends it: a BOM, CRLF, a CR alone, no final newline, UTF-16', () => {
  const dec = new TextDecoder();
  const lines = (html: string): string[] => [...html.matchAll(/<div class="marxy-written-line" data-marxy-s="(\d+)" data-marxy-e="(\d+)">.*?<span class="marxy-written-text">(.*?)<\/span>/g)].map((m) => `${m[1]}-${m[2]}:${m[3]}`);
  const plain = 'one=1\rtwo=2\r\nthree=3\nfour=4';
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc(plain)]);
  const r = readingOf('/n/w.txt', bom, 'article')!;
  assert.equal(r.id, 'written');
  assert.deepEqual(lines(r.html), ['3-8:one=1', '9-14:two=2', '16-23:three=3', '24-30:four=4'], 'a lone CR ends a line, the BOM and every line ending are outside the ranges');
  for (const [s, e] of lines(r.html).map((l) => l.split(':')[0]!.split('-').map(Number))) assert.doesNotMatch(dec.decode(bom.subarray(s, e)), /[\r\n]/);
  // UTF-16LE with its BOM: two bytes a character, the ranges in the file's bytes.
  const text = 'tide=4.9\r\nwind=NW\r\n';
  const le = new Uint8Array(2 + text.length * 2);
  le[0] = 0xff;
  le[1] = 0xfe;
  for (let i = 0; i < text.length; i++) le[2 + i * 2] = text.charCodeAt(i);
  const u = readingOf('/n/u.txt', le, 'article')!;
  assert.equal(u.id, 'written');
  assert.deepEqual(lines(u.html), ['2-18:tide=4.9', '22-36:wind=NW'], 'no NUL drawn, each line its UTF-16 bytes');
  assert.equal(new TextDecoder('utf-16le').decode(le.subarray(22, 36)), 'wind=NW');
  // A lone-CR file of words reads by its lines, not as one paragraph.
  assert.equal(looksLikeVerse('a\rb\rc\r\rd\re\rf\r\rg\rh\r'), true);
  assert.equal(readingOf('/n/cr.txt', enc('one\rtwo\rthree four\r'), 'article')?.id, 'written');
  assert.equal((readingOf('/n/cr.txt', enc('one\rtwo\rthree four\r'), 'article')!.html.match(/marxy-written-line/g) ?? []).length, 3);
});

test('a log, a session or a patch in a .txt is that kind\'s page, not plain text', () => {
  for (const kind of ['log', 'terminal', 'diff']) {
    assert.equal(readingOf('/n/api-2026-11-19.txt', enc('2026-11-19T08:10:00.000Z INFO api: listening on $PORT and $HOST\n'), kind), null, kind);
  }
});

test('a long prose, verse or written reading goes in runs that each carry the byte their last block ends at', () => {
  const para = 'This is a long line of words that goes on and on\nto the next line of words here.\n\n';
  const stanza = 'the tide comes in\nthe tide goes out\nthe sand stays on\n\n';
  const cases = [
    ['n.txt', para.repeat(RUNS_FROM + 40), 'prose', /<p data-marxy-s/g],
    ['v.txt', `Tide\n\n${stanza.repeat(RUNS_FROM)}`, 'verse', /<div class="marxy-stanza">|<h1 class="marxy-verse-title"/g],
    ['w.txt', 'a=1\nb=2\n'.repeat(RUNS_FROM), 'written', /class="marxy-written-line"/g],
  ] as const;
  for (const [path, text, id, block] of cases) {
    const bytes = enc(text);
    const r = readingOf(path, bytes, 'article');
    assert.equal(r?.id, id, path);
    assert.match(r.html, new RegExp(`^<div class="marxy-reading marxy-reading-runs marxy-${id}" data-marxy-reading="${id}">`));
    const runs = [...r.html.matchAll(/<div class="marxy-reading-run" data-marxy-e="(\d+)">/g)];
    const blocks = r.html.match(block)?.length ?? 0;
    assert.equal(runs.length, Math.ceil(blocks / RUN_BLOCKS), path);
    // A run ends where its last block's bytes end: the mount finds a landing byte's run by it.
    for (const run of r.html.split('<div class="marxy-reading-run" ').slice(1)) {
      const own = Number(/^data-marxy-e="(\d+)"/.exec(run)![1]);
      const last = [...run.matchAll(/data-marxy-e="(\d+)"/g)].at(-1)![1];
      assert.equal(own, Number(last), path);
    }
  }
  // A short one is set as before, in no runs.
  const short = readingOf('n.txt', enc(para.repeat(RUNS_FROM)), 'article');
  assert.equal(short?.html.includes('marxy-reading-runs'), false);
  assert.equal(short?.html.includes('marxy-reading-run'), false);
  assert.deepEqual(spans(readingOf('n.txt', enc(para.repeat(RUNS_FROM + 40)), 'article')!.html, enc(para.repeat(RUNS_FROM + 40)))[0], 'This is a long line of words that goes on and on\nto the next line of words here.\n');
});

test('a prose name reads as its neighbour does: a NOTICE as AUTHORS (by its shape), a NEWS as CHANGES (its Markdown page)', () => {
  const prose = 'This is a long line of words that goes on and on\nto the next line of words here.\n\nA second paragraph with five words or more in it.\n';
  for (const [path, kind, id] of [
    ['/r/AUTHORS', 'article', 'prose'], ['/r/NOTICE', 'article', 'prose'], ['/r/COPYRIGHT', 'article', 'prose'], ['/r/LICENSE-MIT', 'article', 'prose'],
    ['/r/LICENSE.mit', 'article', 'prose'], ['/r/COPYING.LESSER', 'article', 'prose'], ['/r/ACKNOWLEDGEMENTS', 'article', 'prose'],
    ['/r/README', 'readme', 'prose'], ['/r/SECURITY', 'readme', 'prose'], ['/r/CODE_OF_CONDUCT', 'readme', 'prose'], ['/r/HACKING', 'readme', 'prose'],
    ['/r/TODO', 'notes', 'prose'], ['/r/ROADMAP', 'notes', 'prose'],
    ['/r/CHANGES', 'changelog', null], ['/r/NEWS', 'changelog', null], ['/r/RELEASES', 'changelog', null],
    ['/r/CONTRIBUTING', 'readme', null], ['/r/report.qmd', 'article', null], ['/r/llms.txt', 'article', null],
  ] as const) assert.equal(readingOf(path, enc(prose), kind)?.id ?? null, id, path);
});

test('a big CSV is read from its first rows, not derived whole (50 MB took seconds on the main thread)', () => {
  const line = 'alpha,1234567,2026-01-02,some words here,3.25,beta,gamma,delta,epsilon,zeta\n';
  const body = line.repeat(Math.ceil((50 * 1024 * 1024) / line.length));
  const bytes = enc(`a,b,c,d,e,f,g,h,i,j\n${body}`);
  const t0 = cpuNow();
  const r = readingOf('big.csv', bytes);
  const ms = cpuNow() - t0;
  assert.ok(r);
  assert.ok(ms < 300, `readingOf on 50 MB CSV took ${ms.toFixed(0)} ms`);
  assert.equal((r.html.match(/<tr data-marxy-s/g) ?? []).length, FIRST_ROWS);
  assert.match(r.html, /The first 200 rows; the file open in Read has them all\./);
  assert.equal(r.contents?.items[1]?.sub, '1234567');
  assert.match(r.contents?.detail ?? '', /the first 2,000 rows/);
});

test('setsPlainReading says whether readingOf sets verse, prose or as written, without making the reading', () => {
  const verse = Array.from({ length: 3 }, (_, s) => Array.from({ length: 4 }, (_, i) => `a short line ${s}${i}`).join('\n')).join('\n\n');
  const prose = 'The reader keeps a place in a long text and the page holds it.\nIt goes on for a while in words.\n\nAnother paragraph of ordinary words here.';
  const markdown = '# Title\n\n- one item\n- two items\n\n```\ncode\n```\n';
  const written = 'x=1\ny=2\nz=3\n';
  const texts = { verse, prose, markdown, written, empty: '' };
  const paths = ['/n/a.txt', '/n/README', '/n/LICENSE', '/n/a.md', '/n/a.json', '/n/a.csv', '/n/a.jsonl', '/n/a.py', '/n/notes'];
  const kinds = [null, 'article', 'notes', 'code', 'data', 'log', 'readme'];
  for (const [name, text] of Object.entries(texts)) {
    for (const path of paths) {
      for (const kind of kinds) {
        const bytes = enc(text);
        let read: ReturnType<typeof readingOf> = null;
        try {
          read = readingOf(path, bytes, kind);
        } catch {
          read = null;
        }
        const plain = read !== null && (read.id === 'verse' || read.id === 'prose' || (read.id === 'written' && read.format === 'plain text'));
        assert.equal(setsPlainReading(path, bytes, kind), plain, `${name} as ${path} (${kind}): readingOf gives ${read?.id ?? 'null'}`);
      }
    }
  }
});

test('JSON Lines with a record past the bytes read: the head line says it was cut, and the other records read', () => {
  const big = `{"k":"${'x'.repeat(1024 * 1024 + 5)}"}`;
  const r = readingOf('big.jsonl', enc(`{"a":1}\n${big}\n{"a":2}\n`), 'data');
  assert.equal(r?.id, 'records');
  assert.match(r?.html ?? '', /1 record cut/);
  assert.match(r?.html ?? '', /marxy-records-bad[^>]*>.*line 2: record of 1\.0 MB/);
});

test('a file with fewer than two records under the limit is not JSON Lines, however many are over it', () => {
  const big = `{"k":"${'x'.repeat(1024 * 1024 + 5)}"}`;
  assert.notEqual(readingOf('all-big.jsonl', enc(`${big}\n${big}\n{"a":1}\n`), 'data')?.id, 'records');
});
