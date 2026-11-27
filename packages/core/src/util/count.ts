// Counting helpers shared across core: how many bytes a string takes in UTF-8, and a count as the reader sees it. Pure.

/**
 * The UTF-8 length of `s` in bytes, as `new TextEncoder().encode(s).length` gives it but without building the bytes (a
 * document may be megabytes). A lone surrogate counts as U+FFFD, three bytes, as the encoder writes it.
 */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i += 1;
    } else n += 3;
  }
  return n;
}

/** `n` and the word for that many, as the reader sees a count: "1 page", "1,234 pages" (digits grouped, en-GB). */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
}
