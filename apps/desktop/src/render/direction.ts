// A block's direction and language are its own: each block of prose takes its direction from its first strong
// letter (`dir="auto"`), and a block written mostly in a script other than Latin does not inherit the chrome's `en`.
// Latin text keeps it, since the typesetter's hyphenation is English and is chosen by that tag.

const BLOCKS = ':scope > :is(p, h1, h2, h3, h4, h5, h6, ul, ol, dl, blockquote, table)';
const OTHER = /(?!\p{Script=Latin})\p{L}/gu;
const LATIN = /\p{Script=Latin}/gu;

/** Whether `text` is written mostly in letters that are not Latin (Arabic, Hebrew, CJK, Cyrillic, Greek...). */
export function notLatin(text: string): boolean {
  const other = text.match(OTHER)?.length ?? 0;
  if (other === 0) return false;
  return other > (text.match(LATIN)?.length ?? 0);
}

/** Marks the top-level blocks of `parsed` before they reach the page. */
export function markBlockDirections(parsed: HTMLElement): void {
  for (const block of parsed.querySelectorAll(BLOCKS)) {
    block.setAttribute('dir', 'auto');
    if (notLatin(block.textContent ?? '')) block.setAttribute('lang', '');
  }
}
