# Skeptic pass — 01 · Reading tasks and the evidence

Reviewed 2026-09-25. 13 claims attacked: 3 upheld, 3 downgraded, 5 corrected, 0 removed, 2 qualified.

| # | Claim (short) | Attack | Outcome | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Xia: 58% of time on comprehension | Cited from a search summary | Upheld [C]; depth raised, sample added (78 developers, 7 projects, 3,148 h) | [Monash repository page](https://research.monash.edu/en/publications/measuring-program-comprehension-a-large-scale-field-study-with-pr/) |
| 2 | Barik 2017, 13-25% of task time | Read only via secondary summary | Corrected: primary ACM abstract confirms 13-25%, 56 participants, performance finding; citation now points to ACM | [ACM](https://dl.acm.org/doi/10.1109/ICSE.2017.59) |
| 3 | ICER 2023 highlighting study, authors unknown | Unidentified | Corrected: Brown, Kölling, Weill-Tessier; plain Java vs BlueJ scope highlighting vs Stride, no difference in correctness or speed; 62-participant count from a search summary only | [KCL portal](https://kclpure.kcl.ac.uk/portal/en/publications/an-eye-tracking-study-assessing-the-impact-of-background-styling-/) |
| 4 | Rodeghero [X] on Abid's re-run | One follow-up with different method overstated as contradiction | Qualified: kept [X], reworded as contested by one larger, non-like-for-like study; signature claim known only via Abid | [Abid arXiv](https://arxiv.org/abs/1903.03358) |
| 5 | Duggan & Payne [B] (2011 and 2009) | Prose, time-pressured; 2011 is a re-analysis of 2009 data, so not two studies; 2009 found no skim advantage over reading the first/second half of each paragraph | Downgraded B → C, wording qualified | [CHI 2011 abstract](https://purehost.bath.ac.uk/ws/files/260193/Duggan_&_Payne,_11.pdf), [JEP:A 2009](https://pubmed.ncbi.nlm.nih.gov/19751073/) |
| 6 | Lorch [B] | 1989 prose memory review, abstract only, not location | Downgraded B → C; matrix cell and Default grade line updated | [Springer](https://link.springer.com/article/10.1007/BF01320135) (abstract via search) |
| 7 | Peitek 2020 ICPC | Replaced lead's ICSE 2021 | Corrected: ICPC 2020 real; 12 novices/19 intermediates, linearity beats experience confirmed. Re-ran Busjahn and Peacock (not "a third study"). Unverified "strategy a minor effect" removed | [ICPC programme](https://conf.researchr.org/details/icpc-2020/icpc-2020-research/21/What-Drives-the-Reading-Order-of-Programmers-An-Eye-Tracking-Study) |
| 8 | Duma 2026: "no human review" | Figure and definition | Corrected: arXiv abstract says "receive no review"; no percentage or definition there; authors warn review metrics may mislead. Wording softened | [arXiv 2605.02273](https://arxiv.org/abs/2605.02273) |
| 9 | AGDebugger CHI 2025 | Overread? | Upheld [C]: 5 interviews, 14-participant study, quoted problem is one of three | [arXiv 2503.02068](https://arxiv.org/abs/2503.02068) |
| 10 | F-pattern [D] | Grade | Upheld: 232 users, 2006, "rough" shape, E/L variants all on NN/g page. Vendor counter-claims (EyeQuant) not used as evidence | [NN/g](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content-discovered/) |
| 11 | Source mode `lineNumbers: false` | Grounding | Upheld at `apps/desktop/src/app.ts:117`; added that the wrapper default is on (`source/editor-cm6.ts:12`) | code |
| 12 | Rendered Mod+C uses getSelection text | Inconsistent with ch. 05 and 07 | Corrected: click-selected nodes run first applicable `copy-` op (`copy-code-clean`, `copy-section`); only drag selections use DOM text (`apply.ts` `runCopyShortcut`); sidecar spec updated | code |
| 13 | `copy-code-clean` keeps `$ ` prompts; "never adds anything" | Verify | Corrected: prompts kept (no stripping in code), but it appends a trailing newline if missing (`copy-code-clean.ts` `clipText`), so the "never adds" sentence was false and was reworded | code |

## What still worries me

The ICER participant count (62) came from a search summary, not the abstract I could open (ACM returned 403). Peitek's PDF could not be text-extracted, so the strategy finding is unverified and dropped. Duma's percentage and definition of "review" live in the paper body, which I did not read. Uwano, Sharif, Ko, Lawrance, Schröter, Yuan, He, Baltes, Yang and Bacchelli were not re-fetched; they are abstract-only claims in the chapter and I did not check them. The "[B for what it studies]" on Baltes and Diehl is generous for a task (attribution) unrelated to reading; I left it.
