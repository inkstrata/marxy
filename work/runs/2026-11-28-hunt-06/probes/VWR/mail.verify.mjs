import { parseMessage, parseAddresses } from '../../../../../packages/core/src/mail/mime.ts';
const enc = new TextEncoder();
const s = (x) => JSON.stringify(x);
console.log('VWR-01 a', s(parseAddresses('Jane <jane@y.org> (Boss)')));
console.log('VWR-01 b', s(parseAddresses('"Doe, J" <j@x> (c)')));
console.log('VWR-01 c', s(parseAddresses('john@x.com (John, Jr.), b@y')));
console.log('VWR-01 ctl (no comment)', s(parseAddresses('Jane <jane@y.org>')));
const body = (h, bytes) => new Uint8Array([...enc.encode(h + '\r\n\r\n'), ...bytes]);
const m = parseMessage(body('Subject: x', [0x63, 0x61, 0x66, 0xe9]));
console.log('VWR-02 body', s(m.text?.text()));
const m2 = parseMessage(body('Subject: x\r\nContent-Type: text/plain; charset=utf-8', [0x63, 0x61, 0x66, 0xe9]));
console.log('VWR-02 explicit utf-8 (expected lossy)', s(m2.text?.text()));
const h = parseMessage(body('Subject: x\r\nContent-Type: text/html', enc.encode('<meta charset="iso-8859-1">caf').constructor.from([...enc.encode('<meta charset="iso-8859-1">caf'), 0xe9])));
console.log('VWR-02 html meta', s(h.html?.text()));
for (const t of ['just words, not a database', 'Subject: hi\r\nFrom: a@b\r\nbody line no blank']) {
  const r = parseMessage(enc.encode(t));
  console.log('VWR-07', s(t), '-> subject', s(r.subject), 'text', s(r.text?.text()), 'parts', r.parts.length);
}
