// Punycode label decode for IDNA display (RFC 3492); browser-safe, no Node imports (MARXY-236).

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

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

/** Decode one `xn--` label (without the `xn--` prefix) to Unicode. */
export function punycodeDecode(input: string): string {
  const output: number[] = [];
  let i = 0;
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let basicEnd = input.lastIndexOf('-');
  if (basicEnd === -1) basicEnd = 0;
  for (let j = 0; j < basicEnd; j++) {
    const cp = input.charCodeAt(j);
    if (cp >= 0x80) throw new Error('bad punycode');
    output.push(cp);
  }
  let index = basicEnd > 0 ? basicEnd + 1 : 0;
  while (index < input.length) {
    const oldi = i;
    let w = 1;
    let k = BASE;
    for (;;) {
      if (index >= input.length) throw new Error('bad punycode');
      const digit = input.charCodeAt(index++);
      const t =
        digit - 48 < 10
          ? digit - 22
          : digit - 65 < 26
            ? digit - 65
            : digit - 97 < 26
              ? digit - 97
              : BASE;
      if (t >= BASE) throw new Error('bad punycode');
      i += t * w;
      const tmin = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (t < tmin) break;
      w *= BASE - tmin;
      k += BASE;
    }
    bias = adapt(i - oldi, output.length + 1, oldi === 0);
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    output.splice(i, 0, n);
    i++;
  }
  return String.fromCodePoint(...output);
}

/** Hostname with `xn--` labels shown in Unicode where decoding succeeds. */
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
