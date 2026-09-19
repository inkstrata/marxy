# Ragged-right line breaking: justif/core vs tex-linebreak2 on the corpus

**Status:** measured, MARXY-19; re-run on the MARXY-64 prose fixture · **Decides:** the engine
and the tolerance MARXY-23 builds on · **Constrains:** ADR-0007 (own line breaking), ADR-0006
(licences), ADR-0015 (Literata)

ADR-0007 names `justif/core` as the paragraph breaker and `tex-linebreak2` as the fallback, and
requires ragged-right output to be **proved on the corpus in Phase 1**. This is that proof. It is a
decision note: nothing under `packages/typeset/src` changes, and no contract is touched.

## The command that produced every number below

```sh
node packages/typeset/scripts/measure-rag.mjs            # prints the tables
node packages/typeset/scripts/measure-rag.mjs --verify    # fails if this file is stale
node packages/typeset/scripts/measure-rag.mjs --selftest  # checks the metric arithmetic
```

The tables between the generated markers are written by `--write` and are byte-compared by
`--verify`, so this file cannot drift from the measurement. The run needs no network after the first
one: `tex-linebreak2@0.8.4` is fetched once into a temp directory outside the repo and pinned by the
SHA-256 of its bundle, which the script checks on every run and refuses to proceed without.

## What was measured, and how

- **Measure:** 68`ch`, mid-range of the 65–70`ch` in `docs/design-language.md`. `ch` is the advance
  of `0`, so 68`ch` is 39.304 em in Literata — the study is in em throughout and therefore holds at
  every font size, which is the point of capping in `ch`.
- **Metrics**, all over each paragraph's **non-final** lines (a last line is short by construction
  and says nothing about the rag):
  - **CV of line lengths** — standard deviation over mean of the set width. The headline number.
  - **Short-line count** — lines whose shortfall exceeds 10% of the measure (6.8`ch`): a hole a
    reader sees.
  - **Worst-line badness** — TeX's `100·(t/s)³` at the worst line, against a reference tolerance of
    `\rightskip = 0pt plus 2em` (ragged2e's `\RaggedRight`). Mean and p95 shortfalls sit next to it
    because badness saturates at 10000 and a saturated column ranks nothing.
- **Both breakers get the identical item stream.** Boxes are whole-word advances; glue is Literata's
  space with stretch and no shrink; the stream ends in TeX's parfillskip idiom. Neither library
  exposes a true per-line `\rightskip`, so the shared approximation is glue stretch — which is
  exactly what tex-linebreak2 spells `lineFinalSpacesInNonJustified`. Feeding one stream to both is
  what makes this a comparison of *breakers* rather than of item builders.
- **A first-fit greedy baseline** stands in for the browser's own wrapping. Without it the study
  cannot answer the question ADR-0007 actually asks, which is whether Knuth–Plass earns its place.
- **Hyphenation is off for both.** Explicit hyphens and dashes are break opportunities at penalty 50.
- Justif's microtypography (protrusion, expansion, letterfit, ending pressure) is **off**, so this
  measures its breaker alone.
- **The ranking is pooled over one paragraph set** — the paragraphs *all three* arrangements set
  inside the measure. Dropping a paragraph because the engine being scored overflowed it takes that
  engine's own failures out of its own score, and on a comparison this close it reverses the sign;
  the first draft of this note did exactly that and reported justif/core at 0.0358 CV and 6.4% short
  lines when the comparable figures on that first corpus were 0.0339 and 4.8%. The harness now
  derives the set once and throws if any row is ever scored over a different one — and because a
  guard is only as good as its wiring, `--verify` counts the guard's invocations and fails if a
  measurement is ever taken without one, which is what deleting the call site would look like.
- **Each library runs at its own defaults, which is an asymmetry.** justif gets tolerance 200 and
  `emergencyStretch: 'auto'`; tex-linebreak2 has no equivalent of either. The generated block prices
  it: removing either escape, *and* removing both simultaneously, each reproduce justif's breakpoints
  in 191 of 191 paragraphs (it was 94 of 94 before MARXY-64) — the combination matters because two
  changes can cancel — so it is still inert on this corpus — but it is inert *as measured*, not by
  construction, and the count is printed so a later corpus can show it changing.
- **The fallback's licences are audited by the run itself.** `pnpm gate:licences` cannot see
  tex-linebreak2, because keeping it out of the lockfile is the point; instead the harness reads the
  declared licence of the fetched package and all twelve packages under it and refuses to print a
  measurement unless every one is permissive.

Font advances come from a 127-line TrueType reader in `scripts/font-metrics.mjs`. **This paragraph is
the one load-bearing claim in the note that you cannot re-run from this repository**: the reader's own
values are checked by `--selftest` against a hex dump of the file, but the browser comparison that
follows was made by hand and nothing in the harness re-checks it, so read it as testimony rather than
as a gate. The reader was validated against Chromium's own layout of the same strings from the same
file: with `font-kerning: none` and ligatures off the agreement is exact to every decimal printed,
including a 43-character line. With kerning and ligatures on, the reader runs 0.6–1.7% wide (0.35 em
over that same line). That bias is systematic and identical for all three engines, so it cannot move
the ranking; it does mean every shortfall here is a fraction of a character pessimistic.

## Results

<!-- rag-table:start (generated by packages/typeset/scripts/measure-rag.mjs; do not edit by hand) -->

Measure **68ch = 39.304 em** in `fonts/literata/Literata[opsz,wght].ttf` (default instance opsz 12, wght 400).
Engines: **justif/core 0.9.1** (MIT), **tex-linebreak2 0.8.4** (MIT), and a first-fit greedy baseline standing in for the engine's own wrapping.
Both breakers are fed the same stream: word glue of 0.6em stretch and no shrink. Badness is priced against `\rightskip = 0pt plus 2em`; a line is *short* when its shortfall exceeds 10% of the measure (6.8ch). Shortfalls are in ch. Every metric excludes each paragraph's last line, which is short by construction.

| Document | Paras | Engine | Lines | CV | Short lines | Mean shortfall | p95 shortfall | Worst badness | Overfull |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `01-long-technical.md` | 50 | justif/core | 103 | 0.0313 | 4 (3.9%) | 3.3 | 6.6 | 2443 | 0 |
|  |  | tex-linebreak2 | 104 | 0.0309 | 5 (4.8%) | 3.3 | 6.6 | 2035 | 1 |
|  |  | greedy (baseline) | 103 | 0.0350 | 7 (6.8%) | 3.2 | 7.5 | 2443 | 0 |
| `02-readme-real-world.md` | 1 | justif/core | 1 | 0.0000 | 0 (0.0%) | 1.3 | 1.3 | 5 | 0 |
|  |  | tex-linebreak2 | 1 | 0.0000 | 0 (0.0%) | 1.3 | 1.3 | 5 | 0 |
|  |  | greedy (baseline) | 1 | 0.0000 | 0 (0.0%) | 1.3 | 1.3 | 5 | 0 |
| `03-ai-plan.md` | 2 | justif/core | 2 | 0.0164 | 0 (0.0%) | 3.5 | 4.5 | 221 | 0 |
|  |  | tex-linebreak2 | 2 | 0.0164 | 0 (0.0%) | 3.5 | 4.5 | 221 | 0 |
|  |  | greedy (baseline) | 2 | 0.0164 | 0 (0.0%) | 3.5 | 4.5 | 221 | 0 |
| `04-source.css` | 0 | — | — | — | — | — | — | — | — |
| `04-source.py` | 0 | — | — | — | — | — | — | — | — |
| `04-source.rs` | 0 | — | — | — | — | — | — | — | — |
| `04-source.ts` | 0 | — | — | — | — | — | — | — | — |
| `05-pathological-table-and-nesting.md` | 0 | — | — | — | — | — | — | — | — |
| `06-math.md` | 5 | justif/core | 8 | 0.0576 | 1 (12.5%) | 3.4 | 12.2 | 4353 | 0 |
|  |  | tex-linebreak2 | 8 | 0.0576 | 1 (12.5%) | 3.4 | 12.2 | 4353 | 0 |
|  |  | greedy (baseline) | 8 | 0.0564 | 1 (12.5%) | 3.2 | 12.2 | 4353 | 0 |
| `07-cjk.md` | 2 | justif/core | 2 | 0.3140 | 0 (0.0%) | 0.1 | 0.3 | 0 | 1 |
|  |  | tex-linebreak2 | 2 | 0.3140 | 0 (0.0%) | 0.1 | 0.3 | 0 | 1 |
|  |  | greedy (baseline) | 1 | 0.0000 | 0 (0.0%) | 0.3 | 0.3 | 0 | 0 |
| `08-rtl.md` | 3 | justif/core | 4 | 0.0221 | 0 (0.0%) | 1.8 | 4.0 | 153 | 0 |
|  |  | tex-linebreak2 | 4 | 0.0120 | 0 (0.0%) | 3.4 | 4.1 | 166 | 0 |
|  |  | greedy (baseline) | 4 | 0.0221 | 0 (0.0%) | 1.8 | 4.0 | 153 | 0 |
| `09-gfm-everything.md` | 1 | justif/core | 4 | 0.0135 | 0 (0.0%) | 2.5 | 3.5 | 107 | 0 |
|  |  | tex-linebreak2 | 4 | 0.0135 | 0 (0.0%) | 2.5 | 3.5 | 107 | 0 |
|  |  | greedy (baseline) | 4 | 0.0138 | 0 (0.0%) | 2.5 | 3.6 | 111 | 0 |
| `10-hostile.md` | 0 | — | — | — | — | — | — | — | — |
| `11-empty.md` | 0 | — | — | — | — | — | — | — | — |
| `12-crlf-and-bom.md` | 0 | — | — | — | — | — | — | — | — |
| `13-no-trailing-newline.md` | 0 | — | — | — | — | — | — | — | — |
| `14-marxy-plan.md` | 30 | justif/core | 49 | 0.0412 | 6 (12.2%) | 3.6 | 9.0 | 2762 | 0 |
|  |  | tex-linebreak2 | 48 | 0.0369 | 4 (8.3%) | 3.8 | 9.0 | 2762 | 1 |
|  |  | greedy (baseline) | 49 | 0.0422 | 7 (14.3%) | 3.6 | 9.0 | 2762 | 0 |
| `15-prose-volume.md` | 93 | justif/core | 573 | 0.0255 | 6 (1.0%) | 2.6 | 5.5 | 2799 | 0 |
|  |  | tex-linebreak2 | 575 | 0.0257 | 9 (1.6%) | 2.9 | 5.9 | 2799 | 0 |
|  |  | greedy (baseline) | 573 | 0.0274 | 14 (2.4%) | 2.6 | 5.9 | 2556 | 0 |
| `README.md` | 4 | justif/core | 9 | 0.0303 | 1 (11.1%) | 3.5 | 7.1 | 857 | 0 |
|  |  | tex-linebreak2 | 9 | 0.0303 | 1 (11.1%) | 3.5 | 7.1 | 857 | 0 |
|  |  | greedy (baseline) | 9 | 0.0268 | 0 (0.0%) | 3.0 | 5.6 | 430 | 0 |
| `check-prose-volume.mjs` | 0 | — | — | — | — | — | — | — | — |
| **corpus, every paragraph** |  | **justif/core** | **755** | **0.0459** | **18 (2.4%)** | **2.8** | **6.2** | **4353** | **1** |
| **corpus, every paragraph** |  | **tex-linebreak2** | **757** | **0.0457** | **20 (2.6%)** | **3.0** | **6.4** | **4353** | **3** |
| **corpus, every paragraph** |  | **greedy (baseline)** | **754** | **0.0304** | **29 (3.8%)** | **2.7** | **6.5** | **4353** | **0** |
| **corpus, the 187 paragraphs all three set inside the measure** ← the ranking |  | **justif/core** | **750** | **0.0279** | **15 (2.0%)** | **2.8** | **6.0** | **4353** | **0** |
| **corpus, the 187 paragraphs all three set inside the measure** ← the ranking |  | **tex-linebreak2** | **753** | **0.0280** | **20 (2.7%)** | **3.0** | **6.4** | **4353** | **0** |
| **corpus, the 187 paragraphs all three set inside the measure** ← the ranking |  | **greedy (baseline)** | **750** | **0.0298** | **26 (3.5%)** | **2.7** | **6.3** | **4353** | **0** |
| *diagnostic: each engine over only its own successes — rows NOT comparable* |  | justif/core | 754 | 0.0286 | 18 (2.4%) | 2.8 | 6.2 | 4353 | 0 |
| *diagnostic: each engine over only its own successes — rows NOT comparable* |  | tex-linebreak2 | 753 | 0.0280 | 20 (2.7%) | 3.0 | 6.4 | 4353 | 0 |
| *diagnostic: each engine over only its own successes — rows NOT comparable* |  | greedy (baseline) | 754 | 0.0304 | 29 (3.8%) | 2.7 | 6.5 | 4353 | 0 |

The third block is the one to read. Both other blocks pool over sets that differ between rows — the first because an overfull line still scores, the last because each row drops the paragraphs *that* engine overflowed, which removes an engine's own failures from its own score. The last block is printed only to show the size of that bias; 4 of 191 paragraphs are outside the common set.

Paragraphs pushed past the margin, last line included: **justif/core 1**, **tex-linebreak2 4**, **greedy (baseline) 1**, out of 191.

Of the 191 paragraphs long enough to break, the two Knuth–Plass engines chose **identical** breakpoints in **148** and justif/core matched the greedy baseline in **131**.

justif/core is driven at its own defaults (tolerance 200, `emergencyStretch: 'auto'`) and tex-linebreak2 at its own, so justif has two escapes its rival lacks. Removing them changes nothing here: `emergencyStretch: 0`, `tolerance` opened to 10000, and **both at once** each reproduce justif's breakpoints in **191 of 191** paragraphs.

Knuth–Plass is not buying its rag with extra lines, and this holds paragraph by paragraph rather than only as a pooled total that could hide two paragraphs trading a line: justif/core and the greedy baseline set the same number of lines in **190 of 191** paragraphs, and in **all 187** of the common set. The 1 exception is outside it: 07-cjk.md#0, which no arrangement can set at this measure.

Licences of the out-of-tree fallback and everything under it, read from the fetched copy: ansi-regex MIT, base64-js MIT, debounce MIT, emoji-regex MIT, is-fullwidth-code-point MIT, linebreak MIT, pako MIT, string-width MIT, strip-ansi MIT, tex-linebreak2 MIT, tiny-inflate MIT, typescript-memoize MIT, unicode-trie MIT. The harness refuses to report a measurement if any of them is not permissive.

### Sensitivity to the glue stretch the breakers are fed

Each row is pooled over the common set recomputed at that stretch, with the badness denominator held at 2em throughout. The glue stretch is the breakers’ own rag tolerance and therefore the one parameter that could invent the result: the recommendation stands only if the ranking holds across the sweep.

| Glue stretch | Engine | Lines | CV | Short lines | Mean shortfall | Worst badness |
| --- | --- | --- | --- | --- | --- | --- |
| 0.2em | justif/core | 749 | 0.0270 | 1.6% | 2.7 | 4353 |
|  | tex-linebreak2 | 752 | 0.0269 | 1.9% | 2.9 | 4353 |
|  | greedy (baseline) | 749 | 0.0297 | 3.3% | 2.7 | 4353 |
| 0.6em | justif/core | 750 | 0.0279 | 2.0% | 2.8 | 4353 |
|  | tex-linebreak2 | 753 | 0.0280 | 2.7% | 3.0 | 4353 |
|  | greedy (baseline) | 750 | 0.0298 | 3.5% | 2.7 | 4353 |
| 2em | justif/core | 754 | 0.0327 | 4.9% | 2.8 | 5316 |
|  | tex-linebreak2 | 758 | 0.0319 | 5.9% | 3.6 | 10000 |
|  | greedy (baseline) | 754 | 0.0304 | 3.8% | 2.7 | 4353 |

<!-- rag-table:end -->

## What the numbers say

MARXY-64 added `15-prose-volume.md` (93 breakable paragraphs, 573 scored lines under justif/core)
and re-ran this harness. The MARXY-19 comparison is **confirmed**, not overturned: the ranking, the
modest win over greedy at a tight tolerance, the loss to greedy at 2 em, and the inert option
asymmetry all keep their signs on a sample more than four times the old scored-line count. What
changed is the size of the gaps, and one claim that the new prose did *not* reproduce.

1. **The two engines are still a tie on evenness and separated only on holes.** Over the 187
   paragraphs all three arrangements set inside the measure, CV is 0.0279 for justif/core against
   0.0280 for tex-linebreak2 — still nothing — while short lines are 2.0% against 2.7%, in justif's
   favour. That gap is fifteen short lines out of 750 against twenty out of 753: five lines on a
   pool that used to be two lines wide. On the first corpus the same comparison was 0.0339 against
   0.0338 and 4.8% against 5.9%. The two engines pick *identical* breakpoints in 148 of the 191
   paragraphs long enough to break (it was 84 of 94), so the honest summary is still a tie with a
   hair's edge to justif/core. Falsifier 1 asked for tex-linebreak2 to lead on short lines by more
   than 1.1 points *and* on CV by more than 0.002; it leads on neither.
2. **Knuth–Plass still beats greedy wrapping, modestly and only at a tight tolerance.** At 0.6 em
   of glue stretch, K–P cuts short lines from 3.5% to 2.0% and CV from 0.0298 to 0.0279 **for exactly
   the same line count** (750 lines for both; it was 168). That equality is still per paragraph:
   justif/core and greedy set the same number of lines in **all 187** paragraphs of the common set,
   and in 190 of all 191, the one exception remaining `07-cjk.md#0`. No paragraph pays a line for
   another paragraph. It now differs from greedy in 60 of 191 paragraphs (it was 17 of 94), so
   ADR-0007's differentiator rests on about a third of the paragraphs rather than a fifth — a
   larger share, not a reversal. Falsifier 2 asked for K–P to lose on short lines or CV; it lost
   on neither.
3. **The tolerance you feed the breaker still decides whether it helps at all.** At 2 em of glue
   stretch, both K–P engines become *worse than greedy* on every metric — short lines rise from 2.0%
   to 4.9%, and worst badness rises. The old corpus saw 4.8% become 12.8%; the sign is the same and
   the mechanism is the same. This remains the most actionable finding for MARXY-23: the rag
   tolerance is a first-class tuning parameter, not a default to inherit.
4. **The overfull 4-versus-1 is not a property of real prose.** Counted over the same 191
   paragraphs, tex-linebreak2 still overflows 4, justif/core 1, greedy 1. Those four are the same
   four as on the thin corpus: the unsettable CJK paragraph, plus three in `01-long-technical.md`
   and `14-marxy-plan.md` that justif/core sets cleanly. The new fixture overflowed **nothing**
   under any engine (93 paragraphs, 0 overfull). MARXY-19 asked this re-run to confirm the overflow
   gap before MARXY-23 leaned on it; the re-run leaves it as three events in two technical
   documents. MARXY-23 should still assert no line is overfull, but it should not treat a 4-versus-1
   as a reason to pick an engine.
5. **The thin-sample limit is closed.** The first run scored 90 common paragraphs and 168 lines,
   almost all of them in two documents. This run scores 187 common paragraphs and 750 lines;
   `15-prose-volume.md` alone is larger than the old corpus. `07-cjk.md` still cannot be set by any
   of the three at this measure: unspaced CJK offers no interword break opportunity in a Latin item
   model. That is a real gap against justif's kinsoku support, not a defect of the fixture.

## Recommendation for MARXY-23

**Build on `justif/core`.** MARXY-64 confirmed the rag ranking: the same evenness and 0.7 points
fewer short lines (it was 1.1 on the thin corpus) — still not enough to decide anything on its own.
What decides it is that the evenness numbers are a tie, so the choice falls to everything around
them, and there justif/core wins on every axis that matters to `packages/typeset`:

- It is **DOM-free by construction** (`justif/core` is a published subpath whose contract is
  "widths are px floats already resolved by the measurement layer"), which is precisely the shape
  `packages/typeset` needs. tex-linebreak2 ships one webpack UMD bundle whose main entry pulls in
  `debounce` and DOM justification; the pure breaker is reachable but not the supported surface.
- It **already implements the other three properties ADR-0007 requires** — hanging punctuation and
  optical margin alignment, font expansion, CJK kinsoku — inside the same cost model, so they
  participate in break choice instead of being bolted on after it. Composing them onto
  tex-linebreak2 would mean writing the item builder ourselves.
- It is **TypeScript with real types and current** (0.9.1); tex-linebreak2 is at 0.8.4 with a
  `@deprecated` hyphenation entry point and open TODOs in its own option docs
  ("*Is somewhat buggy*", "*Does not work*").
- It is **already the declared dependency**. The overflow count is unchanged (one paragraph against
  the fallback's four) and, as conclusion 4 says, the new prose added none of those four.
- Both are **MIT**, and so is every transitive dependency of tex-linebreak2. That is not asserted from
  memory: the harness reads the licence of all thirteen packages out of the copy it fetched and
  refuses to print a measurement if any is not permissive, so the licence line in the table above is
  itself a check. Neither candidate is copyleft, so ADR-0006 does not force the choice, and
  `pnpm gate:licences` stays green because tex-linebreak2 never entered the lockfile.

**Carry these two settings into MARXY-23 as decisions, not defaults:** ragged-right glue stretch at
or below ~0.6 em (three space advances in Literata), and an assertion that no line is overfull.

## What would change this recommendation

Three of these five are numbers this harness prints today, so they can be checked rather than argued.
The other two are **aspirational**: nothing here can evaluate them, and saying so is the point —
marking a claim checkable when it is not is how a decision note stops being evidence. Each names who
can settle it.

1. **Rag quality separating the engines.** *Checkable now* — the ranking block prints it. MARXY-64
   did not trip this: justif/core still leads on short lines, now by 0.7 points (2.0% against 2.7%)
   and still ties on CV (0.0279 against 0.0280). The threshold written before the re-run still
   stands: if a later corpus shows tex-linebreak2 with a **lower short-line rate than justif/core by
   more than 1.1 points** *and* a CV advantage greater than 0.002 *and* the reversal survives the
   glue-stretch sweep, the fallback becomes the primary. Any smaller difference is noise and must
   not move the decision.
2. **K–P not beating greedy.** *Checkable now* — the ranking block prints it. MARXY-64 did not trip
   this either. If a later corpus shows K–P's short-line rate and CV not both better than greedy's at
   the chosen tolerance, ADR-0007's Phase 1 test has failed and the breaker should be cut in a
   superseding ADR, exactly as ADR-0007 says rather than drifted into. Today it passes by 1.5 points
   of short lines at equal line count (it was 2.3 on the thin corpus).
3. **The option asymmetry turning out to matter.** *Checkable now* — the block prints it. justif runs
   at tolerance 200 with `emergencyStretch: 'auto'`, escapes tex-linebreak2 has no equivalent for, and
   removing either, or both together, reproduces justif's own breakpoints in 191 of 191 paragraphs
   (it was 94 of 94). If that count drops below the printed total, part of justif's result is coming
   from the escapes and the comparison needs re-levelling before it can be quoted.
4. **justif/core's microtypography not paying for itself.** *Aspirational — this harness cannot
   evaluate it.* Protrusion, expansion, letterfit and kinsoku are switched **off** here by
   construction, so the argument that they earn their place is untested. **MARXY-23** must measure the
   breaker with them on against the breaker alone; if there is no improvement, the main reason to
   prefer justif/core is gone and the two become interchangeable.
5. **The 100 ms typeset budget.** *Aspirational — this study measures quality and never time.* If
   justif/core cannot typeset a viewport inside the ADR-0013 budget and tex-linebreak2 can, speed
   wins. Only the **ADR-0013 perf gate** can settle it, and neither engine has been run against it.

A sixth would change it and is fully machine-checked, just not by a threshold: **a licence change on
either side.** `pnpm gate:licences` covers marxy's tree and the audit described above covers the
out-of-tree fallback, so a relicence fails a run rather than needing anyone to notice.

## What this note does not measure

Rendering (this is breakpoints and natural widths, not painted lines), hyphenation, kerning and
ligatures (~1% width bias, documented above), justified setting, RTL reordering, CJK kinsoku, the
baseline grid, performance, and beauty. Beauty is not a machine question (ADR-0016); the artifact for
the human queue is a rendered comparison, and it belongs to MARXY-23, not here.

## Rendered (MARXY-23)

<!-- rendered-table:start (generated by packages/typeset/scripts/measure-rendered.mjs; do not edit by hand) -->

Rendered in Playwright WebKit (`"24.18.1"` Node), default theme, bundled Literata at 17 px, measure 671.2 px (68 ch), glue stretch 2 em, hyphenation off. Widths are real line boxes, px; a line is short when its shortfall exceeds 10% of the measure. Last lines excluded.

| Document | Paras | Lines native → set | CV native | CV set | Short native | Short set |
| --- | --- | --- | --- | --- | --- | --- |
| `01-long-technical.md` | 50 | 151 → 151 | 0.0412 | 0.0441 | 12 (11.9%) | 13 (12.9%) |
| `02-readme-real-world.md` | 1 | 2 → 2 | 0.0000 | 0.0000 | 1 (100.0%) | 1 (100.0%) |
| `03-ai-plan.md` | 2 | 4 → 4 | 0.0201 | 0.0201 | 0 (0.0%) | 0 (0.0%) |
| `06-math.md` | 3 | 7 → 7 | 0.0097 | 0.0097 | 0 (0.0%) | 0 (0.0%) |
| `07-cjk.md` | 3 | 9 → 9 | 0.0170 | 0.0170 | 0 (0.0%) | 0 (0.0%) |
| `08-rtl.md` | 3 | 7 → 7 | 0.0177 | 0.0177 | 0 (0.0%) | 0 (0.0%) |
| `09-gfm-everything.md` | 1 | 5 → 5 | 0.3253 | 0.3253 | 2 (50.0%) | 2 (50.0%) |
| `10-hostile.md` | 4 | 8 → 8 | 0.0371 | 0.0371 | 0 (0.0%) | 0 (0.0%) |
| `14-marxy-plan.md` | 28 | 74 → 73 | 0.0435 | 0.0366 | 5 (10.9%) | 3 (6.7%) |
| `15-prose-volume.md` | 78 | 603 → 603 | 0.0301 | 0.0248 | 18 (3.4%) | 5 (1.0%) |
| `README.md` | 4 | 12 → 12 | 0.0354 | 0.0354 | 2 (25.0%) | 2 (25.0%) |
| **corpus** | **177** | **882 → 881** | **0.0420** | **0.0394** (-6.2%) | **40 (5.7%)** | **26 (3.7%)** |


Every alternative over the whole corpus, paragraphs of two or more lines, same measure:

| Arrangement | Lines | CV | Short lines | Mean shortfall (px) |
| --- | --- | --- | --- | --- |
| engine wrapping (WebKit, `text-wrap: auto`) | 882 | 0.0420 | 40 (5.7%) | 27.7 |
| WebKit `text-wrap: pretty` | 882 | 0.0456 | 261 (37.0%) | 56.9 |
| justif/core, 0.6 em per word space (MARXY-19 model) | 882 | 0.0398 | 27 (3.8%) | 28.0 |
| ragged breaker, 1 em per line | 882 | 0.0670 | 23 (3.3%) | 29.5 |
| **ragged breaker, 2 em per line (shipped)** | 881 | 0.0394 | 26 (3.7%) | 27.8 |
| ragged breaker, 3 em per line | 881 | 0.0394 | 26 (3.7%) | 27.8 |

Typesetter over the corpus: 287 candidates, 167 set, 102 already one line, 18 left to the engine (inline object 8, CJK 7, overflow after setting 3). Viewport pass: 01-long-technical 12 ms, 02-readme-real-world 3 ms, 03-ai-plan 3 ms, 06-math 0 ms, 07-cjk 0 ms, 08-rtl 10 ms, 09-gfm-everything 1 ms, 10-hostile 4 ms, 14-marxy-plan 15 ms, 15-prose-volume 24 ms, README 5 ms.

<!-- rendered-table:end -->

### What the rendered numbers say (MARXY-23)

The command is `node packages/typeset/scripts/measure-rendered.mjs --write`; the tables above are its
output. Unlike the MARXY-19 model, these are real line boxes: WebKit, the default theme, Literata at
17 px, the typesetter's own measurements and DOM edits.

1. **The engine switched for ragged text.** Driving justif/core with MARXY-19's stream (stretch on every
   word space) was good on prose and *worse than the engine* on technical text. A line holding a long
   code span has few spaces, so its shortfall looks expensive to that stream and the breaker shortens the
   lines around it. TeX's answer is a stretch that belongs to the line (`\rightskip`), which in an item
   stream needs negative glue, and justif forbids negative glue. `src/ragged.ts` is that per-line model
   directly: about ninety lines of total-fit dynamic programming over the same measured tokens. It sets
   the same number of lines as the engine, beats it on evenness and on holes, and is ahead of justif on
   both. justif/core stays in the package as the comparison and as the engine for a future justified
   setting (`--marxy-justify: 1`), which is what it is built for.
2. **The stretch matters below 2 em and not above it.** At 1 em too many lines saturate the badness
   cap and the choice degrades; 2 and 3 em choose identically, because scaling the stretch scales every
   badness alike. 2 em is TeX's `\RaggedRight` and ships.
3. **`text-wrap: pretty` is not a substitute.** WebKit's native paragraph balancer pulls lines in from
   the margin by design: a third of all lines end more than 10% short. That is a different aesthetic,
   not a better rag by this measure, and it would also give the grid and the future hanging punctuation
   nothing to hold on to.
4. **The honest size of the win.** Over the corpus, CV falls about 6% and short lines fall by a third.
   On continuous prose (`15-prose-volume.md`) CV falls about 17% and short lines from 18 to 5. On
   technical text it is a wash: the engine may break *inside* a code span at its hyphens, and marxy will
   not (a hyphen that may belong to a filename must never end a line), which costs about as much as the
   breaker gains there. The story's "CV −15%" holds for prose and not for the corpus as a whole. That
   matches the research's finding that Knuth–Plass changes about a third of paragraphs; the rest of the
   visible difference is the bundle MARXY-24 adds.
5. **Measuring was the hard part.** WebKit reports a Range's rectangles snapped to whole pixels, so
   summing per-word widths overstated a line by about 35 px, and lines came out 5% short and 5% more
   numerous. Every width is now a difference of left edges on one native line, so the rounding cancels.
   A range over an element also returns the element's own box, which counted a wrapped code span twice.
   Both are pinned by `test/typeset.test.mjs` (line count and rag against native).
