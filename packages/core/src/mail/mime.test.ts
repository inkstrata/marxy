import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cleanPage, leftOutLine } from '../page/clean.ts';
import { MAIL_LIMITS, decodeBase64, decodeQuotedPrintable, decodeWords, looksLikeMessage, parseAddresses, parseMailDate, parseMessage, parseParams, textLines } from './mime.ts';
import { cpuNow } from '../testing/cpu-clock.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const demo = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../../../fixtures/demo/mail/${name}`, import.meta.url)));

test('the notice reads as its tree: alternative text and related HTML, a crest by Content-ID, three attachments', () => {
  const m = parseMessage(demo('low-water-notice.eml'));
  assert.equal(m.subject, 'Low water walk — 14 November');
  assert.deepEqual(m.from, [{ name: 'Harbour Office', address: 'office@harbour.example' }]);
  assert.deepEqual(m.to, [{ name: 'Reader Lab', address: 'lab@reader.example' }]);
  assert.deepEqual(m.cc, [{ name: '', address: 'notices@harbour.example' }]);
  assert.deepEqual(m.date?.when, { year: 2026, month: 11, day: 2, weekday: 1, hour: 8, minute: 14, second: 9, zone: '+0000' });
  assert.equal(m.headers.length, 14);
  assert.deepEqual(
    m.parts.map((p) => [p.depth, p.type, p.filename, p.encoding, p.size]),
    [
      [0, 'multipart/mixed', null, '7bit', 0],
      [1, 'multipart/alternative', null, '7bit', 0],
      [2, 'text/plain', null, 'quoted-printable', 780],
      [2, 'multipart/related', null, '7bit', 0],
      [3, 'text/html', null, 'quoted-printable', 2050],
      [3, 'image/png', 'crest.png', 'base64', 1117],
      [1, 'text/csv', 'tide-table-november.csv', 'base64', 1065],
      [1, 'image/jpeg', 'harbour-mouth.jpg', 'base64', 16056],
      [1, 'text/calendar', 'low-water-walk.ics', 'base64', 405],
    ],
  );
  assert.equal(m.leaves, 6);
  assert.equal(m.html?.type, 'text/html');
  assert.equal(m.text?.type, 'text/plain');
  assert.deepEqual(m.attachments.map((a) => a.filename), ['tide-table-november.csv', 'harbour-mouth.jpg', 'low-water-walk.ics']);
  assert.equal(m.inline.get('crest@harbour.example')?.filename, 'crest.png');
  // Decoded from base64 to the bytes the parts are: a PNG, a JPEG, and the CSV's own text.
  assert.deepEqual([...m.inline.get('crest@harbour.example')!.bytes().subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.deepEqual([...m.attachments[1]!.bytes().subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.match(m.attachments[0]!.text()!, /^date,/i);
  assert.match(m.html!.text()!, /<title>Low water walk<\/title>/);
  assert.deepEqual(m.capped, []);
});

test('the HTML part, cleaned: one script and one handler out, three images from the network held back, one pixel among them', () => {
  const m = parseMessage(demo('low-water-notice.eml'));
  const c = cleanPage(m.html!.text()!, { cid: (id) => (m.inline.has(id) ? 'data:image/png;base64,iVBORw0KGgo=' : null) });
  assert.equal(c.left.scripts, 1);
  assert.equal(c.left.handlers, 1);
  assert.deepEqual(
    c.left.images.map((i) => [i.host, i.width, i.height]),
    [['news.harbour.example', 600, 120], ['news.harbour.example', 520, 260], ['t.harbour.example', 1, 1]],
  );
  assert.equal(leftOutLine(c.left), '1 script not run, 1 event handler left out; 3 images from the network not loaded (news.harbour.example, t.harbour.example)');
  assert.doesNotMatch(c.html, /<script|onclick|\shref=|\ssrc="https?:/i);
  assert.match(c.html, /src="data:image\/png;base64,iVBORw0KGgo="/, 'the crest is drawn from its part');
  assert.equal((c.html.match(/data-marxy-remote="https:\/\//g) ?? []).length, 3);
  assert.equal(c.css.length, 1);
  assert.match(c.css[0]!, /\.wrap \{ max-width: 600px/);
  assert.deepEqual(
    c.links.map((l) => [l.text, l.goes, l.odd]),
    [['https://harbour.example/notices', 'harbour-example.net', true], ['tide table', 'harbour.example', false], ['Unsubscribe', 'harbour.example', false]],
  );
});

test('a text-only reply: its quotes by level, its signature after the two dashes and a space, all 13 headers', () => {
  const m = parseMessage(demo('re-gauge-readings.eml'));
  assert.equal(m.html, null);
  assert.equal(m.text, m.root);
  assert.equal(m.attachments.length, 0);
  assert.equal(m.headers.length, 13);
  assert.equal(m.headers.find((h) => h.name === 'References')?.raw, '<20261028093000.2218@reader.example> <20261029101500.3302@harbour.example>');
  const lines = textLines(m.text!.text()!);
  const at = (s: string) => lines.find((l) => l.text.startsWith(s))!;
  assert.equal(at('Thanks for the notice').level, 0);
  assert.equal(at('On Thu, 29 Oct').level, 1);
  assert.equal(at('On Wed, 28 Oct').level, 2);
  assert.equal(at('Yes, still on the north wall').level, 1);
  assert.equal(at('Ines Varga').signature, true);
  assert.equal(at('Thanks for the notice').signature, false);
  assert.equal(lines.filter((l) => l.signature).length, 4);
});

test('encoded words: B and Q, a charset each, and the space between two words dropped', () => {
  assert.equal(decodeWords('=?utf-8?b?4oCU?='), '—');
  assert.equal(decodeWords('=?ISO-8859-1?Q?Caf=E9_au_lait?='), 'Café au lait');
  assert.equal(decodeWords('=?utf-8?q?a?= =?utf-8?q?b?= c'), 'ab c');
  assert.equal(decodeWords('plain =?bogus-charset?q?x?='), 'plain =?bogus-charset?q?x?=');
});

test('transfer encodings, parameters, addresses and dates as written', () => {
  assert.equal(new TextDecoder().decode(decodeBase64('aGVs\r\nbG8=')), 'hello');
  assert.equal(new TextDecoder().decode(decodeQuotedPrintable(enc('caf=C3=A9 =\r\nau lait=3D'))), 'café au lait=');
  const disp = parseParams("attachment; filename*=utf-8''tide%20table.csv");
  assert.deepEqual([disp.value, { ...disp.params }], ['attachment', { filename: 'tide table.csv' }]);
  assert.deepEqual({ ...parseParams('text/plain; name*0="a"; name*1="b.txt"; charset="UTF-8"').params }, { name: 'ab.txt', charset: 'UTF-8' });
  assert.deepEqual(parseAddresses('"Varga, Ines" <ines@reader.example>, =?utf-8?q?J=C3=B6rg?= <j@x.example>, team: a@x.example;'), [
    { name: 'Varga, Ines', address: 'ines@reader.example' },
    { name: 'Jörg', address: 'j@x.example' },
    { name: '', address: 'a@x.example' },
  ]);
  assert.deepEqual(parseMailDate('Fri, 30 Oct 2026 16:41:22 -0700').when, { year: 2026, month: 10, day: 30, weekday: 5, hour: 16, minute: 41, second: 22, zone: '-0700' });
  assert.equal(parseMailDate('yesterday').when, null);
});

test('found from the bytes: a message opens with headers that name a sender and something only mail has', () => {
  assert.equal(looksLikeMessage(demo('re-gauge-readings.eml')), true);
  assert.equal(looksLikeMessage(enc('From: a\nSubject: b\nDate: c\n\nhi')), true);
  assert.equal(looksLikeMessage(enc('# From: a heading\n\nNot mail.')), false);
  assert.equal(looksLikeMessage(enc('name: x\nversion: 1\nfrom: y\n')), false);
});

test('caps: parts past the cap and nesting past the depth are not read, and each is said', () => {
  const many = ['Content-Type: multipart/mixed; boundary=b', '', ...Array.from({ length: MAIL_LIMITS.parts + 20 }, (_, i) => `--b\nContent-Type: text/plain\n\npart ${i}`), '--b--', ''].join('\n');
  const m = parseMessage(enc(many));
  assert.equal(m.parts.length, MAIL_LIMITS.parts);
  assert.match(m.capped.join(' '), /first 500 parts/);
  let deep = 'leaf';
  for (let d = 0; d < MAIL_LIMITS.depth + 4; d++) deep = `Content-Type: multipart/mixed; boundary=b${d}\n\n--b${d}\n${deep}\n--b${d}--\n`;
  const n = parseMessage(enc(deep));
  assert.ok(Math.max(...n.parts.map((p) => p.depth)) <= MAIL_LIMITS.depth);
  assert.match(n.capped.join(' '), /nested past 12 levels/);
  assert.throws(() => parseMessage({ length: MAIL_LIMITS.messageBytes + 1 } as unknown as Uint8Array), /past the 64 MB/);
});

test('a message of millions of parts stops looking once the parts it reads are found, and says so', () => {
  const count = 9_000_000;
  const head = enc('Content-Type: multipart/mixed; boundary=b\n\n');
  const part = enc('--b\n\nx\n');
  const bytes = new Uint8Array(head.length + count * part.length);
  bytes.set(head, 0);
  for (let i = 0; i < count; i++) bytes.set(part, head.length + i * part.length);
  const t0 = cpuNow();
  const m = parseMessage(bytes);
  const ms = cpuNow() - t0;
  assert.equal(m.parts.length, MAIL_LIMITS.parts);
  assert.deepEqual(m.capped, ['Only the first 500 parts are read.']);
  // The last part read ends where the next one starts, not at the end of the file.
  assert.equal(m.parts.at(-1)!.text(), 'x');
  // Finding every delimiter in the file took half a second and nine million records; the parts read are a few hundred.
  assert.ok(ms < 100, `${Math.round(ms)} ms`);
});

test('a part with no close delimiter runs to the end; a missing Content-Type is plain text', () => {
  const m = parseMessage(enc('Content-Type: multipart/mixed; boundary="x"\n\n--x\n\nfirst\n--x\nContent-Type: text/html\n\n<p>second</p>\n'));
  assert.deepEqual(m.parts.map((p) => p.type), ['multipart/mixed', 'text/plain', 'text/html']);
  assert.equal(m.parts[1]!.text(), 'first');
  assert.equal(m.parts[2]!.text(), '<p>second</p>\n');
});

/** parseAddresses as it was, with the two regexes, for the inputs short enough to be fair to them. */
function addressesByRegex(value: string): { name: string; address: string }[] {
  const out: { name: string; address: string }[] = [];
  let cur = '';
  let quoted = false;
  let angle = false;
  const flush = (): void => {
    const s = cur.trim();
    cur = '';
    if (s === '') return;
    const m = /^(.*?)<([^>]*)>\s*$/.exec(s);
    if (m) out.push({ name: decodeWords(m[1]!.trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1')).trim(), address: m[2]!.trim() });
    else out.push({ name: '', address: s.replace(/\s*\(.*\)\s*$/, '') });
  };
  for (const ch of value) {
    if (ch === '"' && !angle) quoted = !quoted;
    else if (ch === '<' && !quoted) angle = true;
    else if (ch === '>' && !quoted) angle = false;
    if ((ch === ',' || ch === ';') && !quoted && !angle) {
      flush();
      continue;
    }
    if (ch === ':' && !quoted && !angle && !/@/.test(cur)) {
      cur = '';
      continue;
    }
    cur += ch;
  }
  flush();
  return out.filter((a) => a.address !== '' || a.name !== '');
}

test('addresses read as the regexes read them, in time in proportion to the header', () => {
  const pieces = ['<', '>', '(', ')', '"', ',', ';', ':', '@', ' ', '\n', '\r', String.fromCharCode(0x2028), 'a', 'b.example', String.fromCharCode(92), '=?utf-8?q?J=C3=B6rg?=', '\t'];
  let seed = 99;
  const next = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  for (let i = 0; i < 5000; i += 1) {
    let text = '';
    for (let j = 0, n = 1 + (next() % 24); j < n; j += 1) text += pieces[next() % pieces.length];
    assert.deepEqual(parseAddresses(text), addressesByRegex(text), JSON.stringify(text));
  }
  for (const header of ['<'.repeat(256_000), '('.repeat(256_000), `a${' '.repeat(256_000)}b)`]) {
    const t0 = cpuNow();
    parseAddresses(header);
    assert.ok(cpuNow() - t0 < 500, `${JSON.stringify(header.slice(0, 2))}: ${(cpuNow() - t0).toFixed(0)} ms`);
  }
});

test('an RFC 2231 continuation of 200,000 characters reads', () => {
  const long = 'a'.repeat(200_000);
  const m = parseMessage(enc(`From: a@b\nContent-Type: text/plain; name*0="${long}"; name*1="b"\n\nhi`));
  assert.equal(m.parts[0]!.params.name, `${long}b`);
});
