# Story list

*Twenty-five stories, ordered by what a reader would notice first, in the board's format ([stories.csv](stories.csv), the same nine columns as `docs/plan/jira-issues.csv`). Every acceptance criterion names a test or a gate. Anything a machine cannot judge is a taste-review row below, with the before and after artifact to produce. The keys are placeholders: `node orchestration/jira.mjs sync --new` assigns real ones when the author files them.*

Evidence grades: **[A]** replicated findings or a meta-analysis · **[B]** one well-designed study · **[C]** small, limited or mixed studies · **[D]** expert convention, or convergence of shipping tools, without a direct test · **[X]** contested or contradicted. Part of the [Reader Artifacts Handbook](README.md).

**Before filing:** check each against the live board (`node orchestration/cycle.mjs`). Three overlap stories that exist: the removal notice extends MARXY-44 (the trust notice), the task-marker, copy and fidelity stories build on MARXY-42 and MARXY-43 (operations, both landed), and the heading-ids story touches the Phase 2 opener. Where they do, extend the existing story. Stories that need a draft ADR say which ([gap list](gaps.md)); they are not ready to dispatch until the author accepts it. Anything under `packages/core/src/sanitize/` or the shell's capabilities waits for a person (ADR-0028).

**Two stories are not about the evidence.** *Close the reserved-id bypass* fixes a reproduced security bug, and *Stop copy-section rewriting text* fixes a reproduced violation of "never touch a byte". Both should be filed and landed first, whatever their rank in the table below (which orders by what a reader would notice).

## In order

| # | Story | Reader impact | Depends on | Board key (placeholder) |
|---|---|---|---|---|
| 1 | Show front matter as a quiet document head | high | P08, P12 | `MARXY-NEW-ra-front-matter-head` |
| 2 | Tell the reader what the renderer removed | high | P01 | `MARXY-NEW-ra-removal-notice` |
| 3 | Keep the content of XML-style tags in instruction files | high | P01 | `MARXY-NEW-ra-keep-xml-tag-content` |
| 4 | Tint added and deleted lines in diff fences, marker first | high | P07, P12 | `MARXY-NEW-ra-diff-tint` |
| 5 | Copy code, kbd and commands exactly | high | P06 | `MARXY-NEW-ra-copy-exactness` |
| 6 | Close the reserved-id and clobbering bypass | high | P02 | `MARXY-NEW-ra-reserved-id-bypass` |
| 7 | Stop copy-section rewriting text in clipboard HTML | high | none | `MARXY-NEW-ra-copy-section-html` |
| 8 | Mark invisible and bidirectional characters | high | P12 | `MARXY-NEW-ra-invisible-char-marker` |
| 9 | Recognise GitHub alerts with a label-first head | medium | none | `MARXY-NEW-ra-alerts-label-first` |
| 10 | Every task item keeps its checkbox | medium | none | `MARXY-NEW-ra-task-marker-code-span` |
| 11 | Hold every colour pair with a check that can fail | medium | P14 | `MARXY-NEW-ra-contrast-gate-all-pairs` |
| 12 | Forced colours, contrast preference and reduced motion | medium | P14 | `MARXY-NEW-ra-media-query-rules` |
| 13 | Honour <details> and make it a grid unit | medium | P03 | `MARXY-NEW-ra-details-honoured` |
| 14 | Highlight console sessions and show ESC | medium | P13 | `MARXY-NEW-ra-console-and-ansi` |
| 15 | Line numbers in Source mode, kept out of copies | medium | none | `MARXY-NEW-ra-source-gutter` |
| 16 | Extend the operation fidelity property, and validate splice | medium | none | `MARXY-NEW-ra-fidelity-property` |
| 17 | Make section ranges and nodeAt nesting-aware | medium | none | `MARXY-NEW-ra-nested-source-map` |
| 18 | Badge line, honoured hero and picture variants | medium | P03 | `MARXY-NEW-ra-badge-hero-picture` |
| 19 | Heading ids and working links | medium | P15 | `MARXY-NEW-ra-heading-ids-links` |
| 20 | Gate the shipped CSP and constrain privileged commands | medium | P17 | `MARXY-NEW-ra-csp-and-command-gate` |
| 21 | A summoned, read-only transcript view for JSONL | medium | P10 | `MARXY-NEW-ra-derived-transcript` |
| 22 | Stable anchors and changed-since-last-read | medium | P05, P09 | `MARXY-NEW-ra-anchors-and-changed` |
| 23 | Show where a link that names another host really goes | low | none | `MARXY-NEW-ra-link-mismatch-label` |
| 24 | Register data-marxy-remote and read TOML titles | low | P12 | `MARXY-NEW-ra-registry-hygiene` |
| 25 | Break long paths after a slash; tab width from .editorconfig | low | none | `MARXY-NEW-ra-slash-break-and-tabs` |

Reader impact is a judgement about how soon a reader would notice, not a measurement. *High* means content is missing, wrong on the clipboard or unsafe today. *Medium* means it reads worse than it should. *Low* is polish or hygiene.

## Taste-review rows to file

Nothing a reader sees changes in the pull request that carries this handbook, so it adds no row to `docs/taste-review/queue.md`. Each story below adds its own when it lands, with the artifact named here. The question is the reviewer's, and the decision is theirs.

| Story | Artifact to produce | Question for the reviewer |
|---|---|---|
| Show front matter as a quiet document head | Before/after of a SKILL.md and a plan file, dark and light | quiet enough to leave the title as the first thing read, or a box in disguise? |
| Tell the reader what the renderer removed | Notice on AGENTS.md with two comments, at rest and expanded | informative or nagging? |
| Keep the content of XML-style tags in instruction files | Rendered prompt file before/after | does the inline tag label read as the author's structure or as noise? |
| Tint added and deleted lines in diff fences, marker first | Diff fence before/after in both themes and under a deuteranopia simulation | tint, coloured marker or coloured text, and is the removed line's near-ground tint enough? |
| Mark invisible and bidirectional characters | Before/after of a Trojan Source snippet and a tag-smuggled AGENTS.md | visible without shouting? |
| Recognise GitHub alerts with a label-first head | Five alerts in a README, both themes | does the label alone carry the type? |
| Honour <details> and make it a grid unit | Closed and open details in the real-world README | marker and inset right? |
| Line numbers in Source mode, kept out of copies | Source view of a .rs file with and without the gutter | quiet enough? |
| Badge line, honoured hero and picture variants | Real-world README before/after, blocked and allowed | does the badge line read as a README's masthead? |
| A summoned, read-only transcript view for JSONL | Session file in Source and derived view side by side | does the derived view help or hide? |
| Stable anchors and changed-since-last-read | A regenerated plan with marks on and off | helpful margin or noise? |
| Show where a link that names another host really goes | Mismatched link at rest and focused | quiet enough? |
| Break long paths after a slash; tab width from .editorconfig | Agent transcript page before/after | does breaking a path after / read right? (MARXY-23's open question) |

## Stories the evidence does not support filing

- **A stripe token for tables.** Two web experiments, one linking a paper nobody here read, do not justify a token in the frozen contract ([READMEs](06-readmes.md)).
- **Flagging injection-looking prose.** Detectors are unreliable and the semantics are not the reader's job ([Trust and safety](07-trust-safety.md)).
- **Rendering ANSI colour.** SGR conceals text as well as colours it, and no-colour is a judgement call ([Structured output](03-structured-output.md)).
- **A YAML reformatter.** No byte-preserving general reflow exists ([Structured output](03-structured-output.md)).
- **Rendered Mermaid in v1.** Out of scope (`docs/scope.md`) and blocked by a dependency licence ([READMEs](06-readmes.md)).
