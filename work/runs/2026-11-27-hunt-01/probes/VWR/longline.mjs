import { parseMessage, textLines } from '../../../../../packages/core/src/mail/mime.ts';
for (const n of [50e3, 100e3, 200e3, 400e3]) {
  const raw = new TextEncoder().encode('From: a\r\n\r\n' + 'x'.repeat(n));
  let t = performance.now(); const m = parseMessage(raw); const tx = m.text?.text() ?? ''; const a = performance.now() - t;
  t = performance.now(); const l = textLines(tx); const b = performance.now() - t;
  console.log(n, 'parse', Math.round(a), 'ms textLines', Math.round(b), 'ms', l.length);
}
