# definitions-index: working notes

## New tests on the old code (master 17cfe661 source, tests added first)

`node --test --experimental-strip-types --test-name-pattern=definition src/parse/reparse.test.ts`, before any source change:

- corpus files with definitions: `region 27, whole 106` (needs region > 2 x whole) -- every edit on a file that still held a definition went whole with 'a definition applies across the file'; the 27 region ones followed an edit that removed the file's only definitions.
- named region cases: first case 'a shortcut reference above its definition, before the definitions, at the top: took the region path' actual 'whole'.
- structured with definitions: `region 196, whole 2304`.
- the "touches a definition" guard test passed on the old code (it pins whole parses, which the old code always took).

## Scratch probes

- probe1.mjs: references before their definitions (heading, table, list, quote, footnotes) all resolve in a whole micromark parse: definitions are tokenised with the flow before any text.
- probe3.ts: every corpus file's index is trusted (micromark's lists agree with the tree); 90 one-line insertions over 32-long-reference.md all took the region path.
- probe4.ts: the branch's parseMarkdown (with the label hook) equals master's on 4,034 inputs (corpus, 3,000 generated with tricky labels, 1,000 hostile).
- probe5.ts: whole parse and one-line reload, master against the branch.
