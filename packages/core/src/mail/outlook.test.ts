import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseMessage } from './mime.ts';
import { outlookBodyWords, readOutlookFrame, type OutlookFacts } from './outlook.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const NBSP = String.fromCharCode(0xa0);

/** The demo's Outlook message as the Rust reader wrote it, from the stand-in table `cargo test stand_in` keeps. */
function demoMail(): { facts: OutlookFacts; mime: Uint8Array } {
  const table = readFileSync(new URL('../../../../apps/desktop/src/harness/native-facts.ts', import.meta.url), 'utf8');
  const line = table.split('\n').find((l) => l.includes('"name":"mail/gauge-4-reply.msg"'));
  assert.ok(line, 'the stand-in table holds the demo message');
  const row = JSON.parse(line.slice(line.indexOf('{')).replace(/,\s*$/, '')) as { mail: { facts: OutlookFacts; mime: string } };
  return { facts: row.mail.facts, mime: enc(row.mail.mime) };
}

test('the shell frame is the facts, then the message', () => {
  const facts = JSON.stringify({ class: 'IPM.Note', body: 'html', codePage: 1252, received: null, transport: false, recipients: 1, attachments: 0, notes: [] });
  const head = enc(facts);
  const body = new Uint8Array(4 + head.length + 3);
  new DataView(body.buffer).setUint32(0, head.length, true);
  body.set(head, 4);
  body.set(enc('A: '), 4 + head.length);
  const got = readOutlookFrame(body);
  assert.equal(got.facts.codePage, 1252);
  assert.equal(new TextDecoder().decode(got.mime), 'A: ');
  assert.throws(() => readOutlookFrame(new Uint8Array([9, 0, 0, 0, 1])));
  assert.equal(outlookBodyWords(got.facts), 'Its body is the HTML Outlook kept with it.');
});

test('the demo Outlook message reads as a mail: its head, the HTML from its RTF, an attachment and the message it answers', () => {
  const { facts, mime } = demoMail();
  assert.equal(facts.body, 'rtf-html');
  assert.equal(facts.received, 'Mon, 02 Nov 2026 08:14:50 +0000');
  const m = parseMessage(mime);
  assert.equal(m.subject, 'Re: Gauge 4 after the storm');
  assert.deepEqual(m.from, [{ name: 'Harbour Office', address: 'office@harbour.example' }]);
  assert.deepEqual(m.to, [{ name: 'Reader Lab', address: 'lab@reader.example' }]);
  assert.deepEqual(m.cc, [{ name: 'Tide Desk', address: 'tides@harbour.example' }]);
  assert.deepEqual(m.bcc, []);
  assert.deepEqual(m.date?.when, { year: 2026, month: 11, day: 2, weekday: 1, hour: 8, minute: 14, second: 9, zone: '+0000' });
  assert.ok((m.html?.text() ?? '').includes(`<td>0.4${NBSP}m</td>`));
  assert.match(m.text?.text() ?? '', /^Gauge 4 after the storm\r\n/);
  assert.deepEqual(
    m.attachments.map((a) => [a.type, a.filename, a.size]),
    [
      ['text/csv', 'low-water-november.csv', 86],
      ['message/rfc822', 'Gauge 4 after the storm.eml', 386],
    ],
  );
  const inner = parseMessage(m.attachments[1]!.bytes());
  assert.equal(inner.subject, 'Gauge 4 after the storm');
  assert.match(inner.text?.text() ?? '', /^Hello,/);
  assert.deepEqual(m.capped, []);
});

test('a Bcc header is read as the sender keeps it in their own copy', () => {
  const m = parseMessage(enc('From: a@x.example\r\nTo: b@x.example\r\nBcc: "Archive" <archive@x.example>, c@x.example\r\nSubject: s\r\n\r\nhi\r\n'));
  assert.deepEqual(m.bcc, [
    { name: 'Archive', address: 'archive@x.example' },
    { name: '', address: 'c@x.example' },
  ]);
});
