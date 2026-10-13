// A random Markdown document whose structure the generator chose and kept, and the reference move written from that structure
// (not from the parse), for the tests of move-section (W-10): core's operation test and the desktop's Outline tab test run the same
// documents through the operation and through the app and compare bytes. Imported only by tests.
import type { MoveDirection } from '../move-section.ts';
import { seededRandom } from './test-kit.ts';

export interface Line {
  readonly text: string;
  readonly eol: string;
}

export interface Gen {
  readonly head: Line[];
  readonly sections: { readonly level: number; readonly lines: Line[] }[];
}

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'ε', '漢字', 'x', 'long words in a line'];

/**
 * A random document, with the structure the generator chose recorded: front matter and an introduction, then sections whose
 * levels were picked at random, whose headings are ATX, indented ATX or setext, whose bodies hold the lines that a naive
 * scanner mistakes for headings (a fence with `#` lines, a quote, a list, an HTML comment) and whose line endings are
 * picked per line. The last line of the file may have none.
 */
export function generate(seed: number): { text: string; gen: Gen } {
  const next = seededRandom(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
  const eolStyle = pick(['lf', 'crlf', 'cr', 'mixed']);
  const eol = (): string => (eolStyle === 'lf' ? '\n' : eolStyle === 'crlf' ? '\r\n' : eolStyle === 'cr' ? '\r' : pick(['\n', '\r\n', '\r']));
  // A lone CR followed by a blank line that ends in LF would read as one CRLF, and the blank line would be gone.
  let before = '';
  const line = (text: string): Line => {
    let ending = eol();
    if (text === '' && before === '\r' && ending.startsWith('\n')) ending = '\r';
    before = ending;
    return { text, eol: ending };
  };
  const words = (): string => Array.from({ length: 1 + Math.floor(next() * 4) }, () => pick(WORDS)).join(' ');

  const head: Line[] = [];
  if (next() < 0.3) head.push(line('---'), line('title: front'), line('# a comment, not a heading'), line('---'));
  if (next() < 0.5) head.push(line(words()), line(''));

  const sections: Gen['sections'] = [];
  const count = 1 + Math.floor(next() * 7);
  for (let i = 0; i < count; i++) {
    const level = 1 + Math.floor(next() * 4);
    const lines: Line[] = [];
    const style = level <= 2 && next() < 0.3 ? 'setext' : next() < 0.15 ? 'indent' : 'atx';
    const title = `S${i} ${pick(WORDS)}`;
    if (style === 'setext') lines.push(line(title), line(level === 1 ? '===' : '---'));
    else lines.push(line(`${style === 'indent' ? ' ' : ''}${'#'.repeat(level)} ${title}`));
    for (let b = Math.floor(next() * 3); b > 0; b--) {
      lines.push(line(''));
      const kind = pick(['para', 'fence', 'quote', 'list', 'comment', 'table']);
      if (kind === 'para') lines.push(line(words()), line(words()));
      else if (kind === 'fence') lines.push(line('```md'), line('# not a heading'), line('## nor this'), line('```'));
      else if (kind === 'quote') lines.push(line('> # quoted heading'), line('> text'));
      else if (kind === 'list') lines.push(line('- # listed heading'), line('- item'));
      else if (kind === 'comment') lines.push(line('<!-- # hidden -->'));
      else lines.push(line('| a | b |'), line('|---|---|'), line('| 1 | 2 |'));
    }
    // Blank lines after the body: at least one, so no section can run into the next, except sometimes at the very end.
    for (let k = 1 + Math.floor(next() * 2); k > 0; k--) lines.push(line(''));
    sections.push({ level, lines });
  }
  // The end of the file: perhaps no blank lines, perhaps no final line ending at all.
  const last = sections[sections.length - 1]!.lines;
  const trim = next() < 0.5;
  const noEol = next() < 0.5;
  if (trim || noEol) while (last.length > 1 && last[last.length - 1]!.text === '') last.pop();
  if (noEol) last[last.length - 1] = { text: last[last.length - 1]!.text, eol: '' };
  const bom = next() < 0.2 ? '﻿' : '';
  const all = [...head, ...sections.flatMap((s) => s.lines)];
  return { text: bom + all.map((l) => l.text + l.eol).join(''), gen: { head, sections } };
}

const bytesOf = (lines: readonly Line[]): string => lines.map((l) => l.text + l.eol).join('');

/** The reference: swaps the generator's own sections, trading line endings at the join as the card words it. Written from the model, not the parse. */
export function reference(text: string, gen: Gen, at: number, direction: MoveDirection): string | null {
  const { sections } = gen;
  const levelOf = (i: number): number => sections[i]!.level;
  const endOf = (i: number): number => {
    let k = i + 1;
    while (k < sections.length && levelOf(k) > levelOf(i)) k++;
    return k;
  };
  let a: number;
  let b: number;
  if (direction === 'up') {
    let j = at - 1;
    while (j >= 0 && levelOf(j) > levelOf(at)) j--;
    if (j < 0 || levelOf(j) !== levelOf(at)) return null;
    a = j;
    b = at;
  } else {
    const k = endOf(at);
    if (k >= sections.length || levelOf(k) !== levelOf(at)) return null;
    a = at;
    b = k;
  }
  const firstLines = sections.slice(a, b).flatMap((s) => s.lines);
  const secondLines = sections.slice(b, endOf(b)).flatMap((s) => s.lines);
  const before = sections.slice(0, a).flatMap((s) => s.lines);
  const after = sections.slice(endOf(b)).flatMap((s) => s.lines);
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const prefix = bom + bytesOf(gen.head) + bytesOf(before);
  const second = bytesOf(secondLines);
  // The join: when the second section ends without a line ending, the first one's trailing endings come between.
  const lastLine = secondLines[secondLines.length - 1]!;
  if (lastLine.eol === '') {
    let p = firstLines.length - 1;
    while (firstLines[p]!.text === '') p--;
    const tail = firstLines[p]!.eol + bytesOf(firstLines.slice(p + 1));
    const body = bytesOf(firstLines.slice(0, p)) + firstLines[p]!.text;
    return prefix + second + tail + body + bytesOf(after);
  }
  return prefix + second + bytesOf(firstLines) + bytesOf(after);
}

/** Index of the moved section's heading after Move up: the sibling's old index (its sub-sections go below it). */
export function sectionIndexAfterUp(gen: Gen, at: number): number {
  let j = at - 1;
  while (gen.sections[j]!.level > gen.sections[at]!.level) j--;
  return j;
}
/** Index of the moved section's heading after Move down: the next sibling's section is now above it. */
export function sectionIndexAfterDown(gen: Gen, at: number): number {
  let k = at + 1;
  while (k < gen.sections.length && gen.sections[k]!.level > gen.sections[at]!.level) k++;
  let end = k + 1;
  while (end < gen.sections.length && gen.sections[end]!.level > gen.sections[k]!.level) end++;
  return at + (end - k);
}

