// Punycode label decode for IDNA display (RFC 3492); browser-safe, no Node imports.

import { budget } from '../util/budget.ts';

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

/**
 * The most characters of a label decoded, `xn--` included: a DNS label is at most 63 octets, so anything longer is
 * no hostname a resolver would take, and refusing it keeps the decode (an insert per code point) small.
 */
export const PUNYCODE_LABEL_MAX = 63;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = delta;
  d = firstTime ? Math.floor(d / DAMP) : d >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

/** A basic code point's digit value: `0`-`9` are 26-35, letters either case 0-25; anything else is not a digit. */
function digitOf(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 22;
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61;
  return BASE;
}

const bad = (): Error => new Error('bad punycode');

/** Decode one `xn--` label (without the `xn--` prefix) to Unicode; throws on a label past the cap or one past the last code point. */
export function punycodeDecode(input: string): string {
  if (!budget(PUNYCODE_LABEL_MAX).take(input.length + 'xn--'.length)) throw bad();
  const output: number[] = [];
  let i = 0;
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let basicEnd = input.lastIndexOf('-');
  if (basicEnd === -1) basicEnd = 0;
  for (let j = 0; j < basicEnd; j++) {
    const cp = input.charCodeAt(j);
    if (cp >= 0x80) throw bad();
    output.push(cp);
  }
  let index = basicEnd > 0 ? basicEnd + 1 : 0;
  while (index < input.length) {
    const oldi = i;
    let w = 1;
    let k = BASE;
    for (;;) {
      if (index >= input.length) throw bad();
      const t = digitOf(input.charCodeAt(index++));
      if (t >= BASE) throw bad();
      i += t * w;
      const tmin = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (t < tmin) break;
      w *= BASE - tmin;
      k += BASE;
    }
    const points = output.length + 1;
    bias = adapt(i - oldi, points, oldi === 0);
    // RFC 3492 checks each sum against a 32-bit maxint because C wraps. Here nothing wraps: within the label cap w is at
    // most 35^58 and i finite, so a delta that would overflow lands n past the last code point, and this refuses it.
    n += Math.floor(i / points);
    if (n > 0x10ffff) throw bad();
    i %= points;
    output.splice(i, 0, n);
    i++;
  }
  let text = '';
  for (const cp of output) text += String.fromCodePoint(cp);
  return text;
}

/** Hostname with `xn--` labels shown in Unicode where decoding succeeds; otherwise the hostname as written. */
export function hostnameToUnicode(hostname: string): string {
  if (!hostname.includes('xn--')) return hostname;
  try {
    return hostname
      .split('.')
      .map((label) => (label.startsWith('xn--') ? punycodeDecode(label.slice(4)) : label))
      .join('.');
  } catch {
    return hostname;
  }
}
