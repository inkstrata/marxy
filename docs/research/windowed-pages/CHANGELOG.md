# Changelog

Append-only. Newest first. Findings are never deleted or renumbered: a superseded finding keeps its
text, gains a `[superseded]` tag and a `*Superseded by XXX-NN (date): why.*` line, and is logged here.

## 2026-11-27 (lead, synthesis)
- Prefixes TV1 and A11 renamed TIR and ACC (the checker reads letters only); both chapters were verified again in full.
- Second verifier pass on every changed finding: 01, 02, 03, 04, 06, 07, 08, 09 and 10 are stamped at pass 2.
- Residue the second pass found, left as it is because only a supersession may follow it: NOD-04's setup line still says the kept run used 11 repetitions (the outputs do not record a count); TIR-08 labels 2.03 as presumably Chromium's (it is; WebKit's real sum is 259,500 and its p90 1.97); TBD-03 puts a paraphrase of `grid.ts:2` in quotation marks and names `snapChanged`, which lives in the app's view rather than in `packages/typeset/src`.
- SYNTHESIS.md written: seven decisions, answers to Q-01 to Q-14. The large-files synthesis's D-01 and D-04 are marked superseded there.

## 2026-11-27
- Created: brief, ten vectors.

## 2026-11-27 (lead, verifier corrections)
- 01-code-map: CMP-08 (three mount-everything callers, adds dress.ts:183, :373, line/go.ts:96, app-harness.ts:77; TL;DR), CMP-02 and CMP-12 (472 → 420 is from a wave 5 report under load, not re-run, `[measured]`; `derived` branch of `blocksOf`), CMP-06 (find land() null-top return about :563-565).
- 02-tier1-measure: TIR-02 (set-element counter wording, cause `[likely]`, read from code not traced; TL;DR), TIR-04 (35 minutes by file times; Chromium `md-technical` 4.3x added; recommendation and options), TIR-05 (run counts, "no less"), TIR-07 (Enter-step ranges, Chromium starting match, WebKit find cause `[likely]`), TIR-08 (259,500; p90 note; 0.011 %), setup (single-run caveats).
- 03-node-budget: abstract and NOD-02 (about 20–30x), NOD-01 (key total includes press round trip; repetitions and load not recorded), NOD-02 and NOD-06 (Windows Chromium numbers and `ro-cost.txt` as reported by another machine's run, not measured here), NOD-03 (per element about 1.3 µs), NOD-04 (about 25–40 % per node; append figures; "0.11 → 0.35 ms" dropped), NOD-05 (468k dense width change added), NOD-06 (6–8 ms; Chromium also reads 0), NOD-07 (10k interpolated, dense extrapolated, 0.6 s settle floor), Recommendation (10,000 kept; nodes per KB corrected to about 40–65 prose and about 470 dense; interpolated at 16–18 ms), Options table (about 800 KB more).
- 04-height-maps: TL;DR bullets re-pointed (HMP-05, HMP-11; HMP-10 `[likely]`), HMP-11 (pdf.js comment under the combined branch), HMP-12 (commit f4fda854 named; sources), HMP-14 (0.4.3 re-read).
- 05-engine-support: ENG-04 (`[absence]` added), table header (max versions `[likely]`, inferred; floors for macOS 15 and 26 from general knowledge).
- 06-estimates-anchoring: ANC-03 (line span 2140-2153, predicate at 2144), ANC-10 (2023 browsers), ANC-12 (`LG.Margin` note).
- 07-accessibility: ACC-01 (per MDN; no engine test), ACC-07 (WebKit 236865 open, virtualised grid), ACC-11 (second pass searches).
- 08-find-select-copy: FSC-02 and FSC-03 (`[confirmed]` → `[likely]`; pending change to find and copy, not on main at a6d7fab5), FSC-04 (`blocks` branch is code files only; line 137), FSC-12 (unsourced 8 KiB and Firefox mentions dropped; second search added), FSC-13 (`lightFind` plain queries only; line ranges), FSC-14 (about thirty selectors, 22-38).
- 09-typeset-distance: TL;DR (grid pass local once the origin read changes; print `[likely]`), TBD-01 (script not kept), TBD-03 (title: origin-relative step 2).
- 10-editing: EDW-07 (`[absence]` → `[superseded]`, text kept), EDW-10 (new: absolute tops, git ref f4fda854), TL;DR and Open questions point to EDW-10.
