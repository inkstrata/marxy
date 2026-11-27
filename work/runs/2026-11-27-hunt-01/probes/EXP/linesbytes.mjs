import { linesBytes } from '/Users/<user>/Dev/marxy-wt/hunt-01/apps/desktop/src/export/model.ts';
import { lineSpan } from '/Users/<user>/Dev/marxy-wt/hunt-01/apps/desktop/src/selection/cursor.ts';
const enc = new TextEncoder(), dec = new TextDecoder();
const bytes = enc.encode('one\rtwo\rthree\rfour\r');
const start = 4, end = 8; // "two\r"
const { first, last } = lineSpan(bytes, start, end);
console.log('lineSpan of "two":', first, last);
console.log('linesBytes(first,last):', JSON.stringify(dec.decode(linesBytes(bytes, first, last))), '(expected "two\\r")');
const b2 = enc.encode('a\n\nb\n');
