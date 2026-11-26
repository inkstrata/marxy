import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ansiAccount, ansiClasses, ansiRuns, nearestTone } from './ansi.ts';
import { indexLines, lineHtml } from '../reading/lines.ts';

/** Each run as [text, escape kind, classes]. */
const read = (text: string) => ansiRuns(text).map((r) => [r.text, r.esc, r.style === null ? '' : ansiClasses(r.style)]);
const E = '\u001b';

test('the runs are the text, byte for byte, whatever the escapes ask', () => {
  const text = `a ${E}[1;33mwarn${E}[0m b ${E}]0;title\u0007 ${E}[2K c ${E}[38;5;208mx${E}[m${E}[`;
  assert.equal(ansiRuns(text).map((r) => r.text).join(''), text);
});

test('yellow is the warning tone, red the error tone, green the string tone; reset ends them', () => {
  assert.deepEqual(read(`${E}[33mslow${E}[0m ok`), [[`${E}[33m`, 'sgr', ''], ['slow', null, 'marxy-ansi-warn'], [`${E}[0m`, 'sgr', ''], [' ok', null, '']]);
  assert.deepEqual(read(`${E}[31mx`)[1], ['x', null, 'marxy-ansi-err']);
  assert.deepEqual(read(`${E}[32mx`)[1], ['x', null, 'marxy-ansi-ok']);
  assert.deepEqual([34, 35, 36].map((n) => read(`${E}[${n}mx`)[1]![2]), ['marxy-ansi-blue', 'marxy-ansi-magenta', 'marxy-ansi-cyan']);
  assert.deepEqual(read(`${E}[30mx${E}[37my`).filter((r) => r[1] === null).map((r) => r[2]), ['', ''], 'black and white are the page\'s own ink');
});

test('bold is weight, dim is the muted tone, and a tone with dim keeps the tone', () => {
  assert.deepEqual(read(`${E}[1mb${E}[22m n`).filter((r) => r[1] === null), [['b', null, 'marxy-ansi-bold'], [' n', null, '']]);
  assert.equal(read(`${E}[2mx`)[1]![2], 'marxy-ansi-muted');
  assert.equal(read(`${E}[90mx`)[1]![2], 'marxy-ansi-muted', 'bright black');
  assert.equal(read(`${E}[2;31mx`)[1]![2], 'marxy-ansi-err');
});

test('codes nest: a later code adds to the style, 39 drops the colour only, 22 drops weight', () => {
  assert.deepEqual(read(`${E}[1m${E}[31ma${E}[39mb${E}[0mc`).filter((r) => r[1] === null), [
    ['a', null, 'marxy-ansi-err marxy-ansi-bold'], ['b', null, 'marxy-ansi-bold'], ['c', null, ''],
  ]);
  assert.deepEqual(read(`${E}[1;3;4;33mx`)[1], ['x', null, 'marxy-ansi-warn marxy-ansi-bold marxy-ansi-italic marxy-ansi-underline']);
  assert.equal(read(`${E}[mx`)[1]![2], '', 'ESC[m is a reset');
});

test('a style does not carry past the line it was asked on', () => {
  assert.equal(ansiRuns('plain')[0]!.style, null);
  assert.equal(read(`${E}[31mred`)[1]![2], 'marxy-ansi-err');
  assert.deepEqual(read('next line'), [['next line', null, '']]);
});

test('256-colour codes take the nearest theme tone, never a colour of their own', () => {
  assert.equal(read(`${E}[38;5;1mx`)[1]![2], 'marxy-ansi-err');
  assert.equal(read(`${E}[38;5;10mx`)[1]![2], 'marxy-ansi-ok', 'bright green');
  assert.equal(read(`${E}[38;5;208mx`)[1]![2], 'marxy-ansi-warn', 'orange is nearest yellow');
  assert.equal(read(`${E}[38;5;21mx`)[1]![2], 'marxy-ansi-blue');
  assert.equal(read(`${E}[38;5;201mx`)[1]![2], 'marxy-ansi-magenta');
  assert.equal(read(`${E}[38;5;244mx`)[1]![2], 'marxy-ansi-muted', 'a mid grey');
  assert.equal(read(`${E}[38;5;255mx`)[1]![2], '', 'a near-white grey is the ink');
  assert.equal(read(`${E}[38;5;196;1mx`)[1]![2], 'marxy-ansi-err marxy-ansi-bold', 'what follows an extended colour is read');
});

test('truecolour codes take the nearest theme tone too, in both spellings', () => {
  assert.equal(read(`${E}[38;2;255;0;0mx`)[1]![2], 'marxy-ansi-err');
  assert.equal(read(`${E}[38;2;250;200;20mx`)[1]![2], 'marxy-ansi-warn');
  assert.equal(read(`${E}[38;2;0;0;255mx`)[1]![2], 'marxy-ansi-blue');
  assert.equal(read(`${E}[38:2::0:255:0mx`)[1]![2], 'marxy-ansi-ok', 'the colon form with its empty colour-space');
  assert.equal(read(`${E}[38:5:3mx`)[1]![2], 'marxy-ansi-warn');
  assert.equal(nearestTone(120, 120, 125), 'muted');
  assert.equal(nearestTone(0, 0, 0), null);
});

test('a background colour is read and not drawn', () => {
  assert.deepEqual(read(`${E}[41;37mx`), [[`${E}[41;37m`, 'sgr', ''], ['x', null, '']]);
  assert.equal(read(`${E}[48;5;196;32mx`)[1]![2], 'marxy-ansi-ok', 'the colour after an extended background is still read');
});

test('a malformed or unterminated escape is not swallowed', () => {
  // SGR whose colour is cut short, out of range, or whose number is not one: marked bad, and the style is left as it was.
  for (const bad of [`${E}[38;5m`, `${E}[38;5;300m`, `${E}[38;2;1;2m`, `${E}[38;9m`]) {
    assert.deepEqual(read(`${bad}x`), [[bad, 'bad', ''], ['x', null, '']], bad);
  }
  assert.deepEqual(read(`${E}[31m${E}[38;5mx`)[2], ['x', null, 'marxy-ansi-err'], 'a bad code leaves the colour as it was');
  // Cut short: no final byte, no end to an OSC. They stay in the text, with their ESC, as the file has them.
  assert.deepEqual(read(`a ${E}[31`), [[`a ${E}[31`, null, '']]);
  assert.deepEqual(read(`a ${E}]0;no end`), [[`a ${E}]0;no end`, null, '']]);
  assert.deepEqual(read(`${E}x ${E}`), [[`${E}x ${E}`, null, '']]);
});

test('cursor moves, clears and OSC titles are hidden as controls, not styles', () => {
  assert.deepEqual(read(`${E}[2Kgo${E}[1;1H${E}]0;build ok\u0007${E}]8;;http://x${E}\\link`), [
    [`${E}[2K`, 'control', ''], ['go', null, ''], [`${E}[1;1H`, 'control', ''], [`${E}]0;build ok\u0007`, 'control', ''], [`${E}]8;;http://x${E}\\`, 'control', ''], ['link', null, ''],
  ]);
  assert.equal(read(`${E}[?25lx`)[0]![1], 'control');
  assert.equal(read(`${E}[>4;2mx`)[0]![1], 'control', 'a private SGR-shaped sequence is not styling');
});

test('the account names what is drawn, what is hidden and not run, and what is shown as written', () => {
  assert.deepEqual(ansiAccount([`${E}[33m`, `${E}[0m`, `${E}[33m`]), [
    "The file colours text with escape codes. Marxy hides them and draws the text in the theme's own tones, never the colour written: here yellow as the warning tone.",
    'X-ray and Source show the bytes, escapes included.',
  ]);
  const both = ansiAccount([`${E}[1;91m`, `${E}[38;5;208m`, `${E}[38;2;1;2;3m`, `${E}[2K`, `${E}]0;t\u0007`, `${E}[A`, `${E}[38;5m`]);
  assert.ok(both[0]!.endsWith('here bold as weight, bright red as the error tone and a 256-colour code as the warning tone.'), both[0]);
  assert.equal(both[1], 'It also asks the terminal for clearing the line, a window title and cursor movement. Those codes are hidden and not run.');
  assert.equal(both[2], 'One code is cut short or garbled and shown as written.');
  assert.deepEqual(ansiAccount([]), []);
  assert.equal(ansiAccount([`${E}[0m`])[0], 'The file holds escape codes that only reset colour; Marxy hides them.');
});

test('an OSC body past 256 characters is not a sequence: it is shown as written', () => {
  const body = 'x'.repeat(257);
  assert.deepEqual(read(`${E}]0;${body}\u0007done`), [[`${E}]0;${body}\u0007done`, null, '']]);
  assert.equal(read(`${E}]0;${'x'.repeat(250)}\u0007`)[0]![1], 'control');
});

test('Lines: a byte that is not UTF-8 moves no range after it', () => {
  const head = Buffer.from('2026-11-19T09:00:02.000Z WARN  bad');
  const tail = Buffer.from(`${E}[33mslow ${E}[0m done\n`);
  const bytes = new Uint8Array([...head, 0xff, 0xe9, ...tail]);
  const lines = indexLines(bytes, true);
  const html = lineHtml(lines, 0);
  const spans = [...html.matchAll(/<span class="([^"]*)" data-marxy-s="(\d+)" data-marxy-e="(\d+)">/g)].map((m) => [m[1], Number(m[2]), Number(m[3])] as const);
  const esc = spans.filter(([c]) => c === 'marxy-log-esc');
  assert.deepEqual(esc.map(([, s, e]) => Buffer.from(bytes.subarray(s, e)).toString('latin1')), [`${E}[33m`, `${E}[0m`]);
  const tone = spans.find(([c]) => c === 'marxy-ansi-warn')!;
  assert.equal(Buffer.from(bytes.subarray(tone[1], tone[2])).toString('latin1'), 'slow ');
});
