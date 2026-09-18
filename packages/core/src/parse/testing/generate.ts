// A deterministic generator that composes markdown documents from fragments written here, so the
// conformance suite gets its breadth from something this project authored and can reproduce, rather
// than from a transcribed example set (see cases.ts for why that matters).
//
// Reproducing a failure: every generated case carries its seed and index, and the generator is a pure
// function of the two. `generateCases(seed, count)` returns the same list on every machine and every
// run. `conformance.test.ts` prints `seed=… index=…` for any case that diverges, and
// `MARXY_CASE_SEED=<number> pnpm --filter @marxy/core test` explores a different seed; re-running with
// the printed seed reproduces the exact document.

export interface GeneratedCase {
  readonly seed: number;
  readonly index: number;
  /** The fragment names composed, so a failure says what shape broke. */
  readonly shape: readonly string[];
  readonly input: string;
}

/** The default seed: "marxy" in hex, so the committed suite is one fixed list. */
export const DEFAULT_SEED = 0x6d78_7900;

/** mulberry32: small, fast, and identical in every JavaScript engine, which is what determinism needs. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Inline fragments: each is valid inline markdown on its own and composes with the others. */
const INLINES: readonly (readonly [string, string])[] = [
  ['plain', 'a reader'],
  ['emphasis', '*read*'],
  ['strong', '**bytes**'],
  ['nested-emphasis', '**read *on* now**'],
  ['code', '`read()`'],
  ['code-with-backtick', '`` a ` b ``'],
  ['link', '[reader](/r)'],
  ['link-title', '[reader](/r "the title")'],
  ['link-emphasis', '[*read*](/r)'],
  ['reference-link', '[reader][ref]'],
  ['image', '![alt](/i.png)'],
  ['autolink', '<https://marxy.invalid/read>'],
  ['email-autolink', '<reader@marxy.invalid>'],
  ['raw-inline-html', '<kbd>K</kbd>'],
  ['comment', '<!-- byte -->'],
  ['entity', '&amp; &#x1F4D6;'],
  ['escape', '\\*literal\\*'],
  ['backslash-run', 'a\\\\b'],
  ['punctuation', '(read) "on" -- now...'],
  ['cjk', '读者与代码'],
  ['rtl', 'مرحبا بالعالم'],
  ['astral', 'read 😀 on'],
  ['underscore-word', 'snake_case_name'],
  ['star-word', 'by*te*s'],
  ['tab', 'read\ton'],
  ['angle', 'a < b > c'],
  ['ampersand', 'a & b'],
  ['brackets', '[not a link] (/r)'],
  ['tilde', '~~tildes~~'],
  ['dollar', '$x = 1$'],
  ['pipe', 'a | b'],
  ['hash', 'a # b'],
];

/** Block templates: `%s` takes one inline run, so blocks and inlines compose independently. */
const BLOCKS: readonly (readonly [string, string])[] = [
  ['paragraph', '%s\n'],
  ['two-line-paragraph', '%s\nand %s\n'],
  ['hard-break-paragraph', '%s  \n%s\n'],
  ['backslash-break-paragraph', '%s\\\n%s\n'],
  ['atx-heading', '## %s\n'],
  ['deep-atx-heading', '##### %s\n'],
  ['closed-atx-heading', '### %s ###\n'],
  ['setext-heading', '%s\n===\n'],
  ['setext-heading-2', '%s\n---\n'],
  ['quote', '> %s\n'],
  ['lazy-quote', '> %s\n%s\n'],
  ['nested-quote', '> > %s\n'],
  ['quote-with-blank', '> %s\n>\n> %s\n'],
  ['tight-bullets', '- %s\n- %s\n'],
  ['loose-bullets', '- %s\n\n- %s\n'],
  ['ordered', '3. %s\n4. %s\n'],
  ['nested-list', '- %s\n  - %s\n'],
  ['list-with-code', '- %s\n\n      code %s\n'],
  ['empty-item-list', '-\n- %s\n'],
  ['indented-code', '    %s\n'],
  ['fenced-code', '```\n%s\n```\n'],
  ['fenced-code-info', '```text\n%s\n```\n'],
  ['tilde-fence', '~~~\n%s\n~~~\n'],
  ['unclosed-fence', '```\n%s\n'],
  ['html-block', '<div>\n%s\n</div>\n'],
  ['html-block-blank', '<div>\n\n%s\n\n</div>\n'],
  ['thematic-break', '%s\n\n***\n'],
  ['definition-then-use', '[ref]: /r "t"\n\n%s\n'],
  ['indented-paragraph', '   %s\n'],
  ['tab-indented', '\t%s\n'],
  ['quote-with-fence', '> ```\n> %s\n> ```\n'],
  ['list-in-quote', '> - %s\n>   - %s\n'],
];

const pick = <T,>(items: readonly T[], next: () => number): T => items[Math.floor(next() * items.length)]!;

/**
 * `count` documents from `seed`. Each is one to three blocks, each block filled with one to three
 * inline fragments, and always followed by the reference definition the `reference-link` fragment
 * needs so an unresolved label is never the thing under test.
 */
export function generateCases(seed: number = DEFAULT_SEED, count = 240): GeneratedCase[] {
  const cases: GeneratedCase[] = [];
  for (let index = 0; index < count; index++) {
    // Seeding per case keeps every case independent of `count`: case 7 of 10 is case 7 of 1000.
    const next = random((seed + index * 0x9e37_79b9) >>> 0);
    const shape: string[] = [];
    const blocks: string[] = [];
    const blockCount = 1 + Math.floor(next() * 3);
    for (let block = 0; block < blockCount; block++) {
      const [blockName, template] = pick(BLOCKS, next);
      shape.push(blockName);
      let filled = template;
      while (filled.includes('%s')) {
        const runLength = 1 + Math.floor(next() * 3);
        const run: string[] = [];
        for (let part = 0; part < runLength; part++) {
          const [inlineName, fragment] = pick(INLINES, next);
          shape.push(inlineName);
          run.push(fragment);
        }
        filled = filled.replace('%s', run.join(' '));
      }
      blocks.push(filled);
    }
    cases.push({
      seed, index, shape,
      input: `${blocks.join('\n')}\n[ref]: /reference "a title"\n`,
    });
  }
  return cases;
}
