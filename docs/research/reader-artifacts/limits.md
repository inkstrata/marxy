# What would change my mind, and what remains taste

*The handbook's recommendations are mostly reasoned defaults, not findings. This page says which result would reverse each one, what no evidence can settle, and where the handbook's own method is weakest. It is written to be argued with.*

Evidence grades: **[A]** replicated findings or a meta-analysis · **[B]** one well-designed study · **[C]** small, limited or mixed studies · **[D]** expert convention, or convergence of shipping tools, without a direct test · **[X]** contested or contradicted. Part of the [Reader Artifacts Handbook](README.md).

## What would change my mind

Each line names a result and the recommendation it would reverse. None of these studies exists yet, which is the reason the recommendations are **[D]** and not something stronger.

| A result that would reverse it | Recommendation it reverses | Chapter |
|---|---|---|
| A controlled study in which readers verifying agent output catch more errors with collapsed tool output | The default of folding nothing the author did not fold | [Agent artifacts](02-agent-artifacts.md), [Reading tasks](01-reading-tasks.md) |
| A study in which readers verifying agent work read collapsed output less accurately | A bounded tool result in the derived view | [Agent artifacts](02-agent-artifacts.md) |
| A study showing line-count truncation hurts finding the relevant line | The bound on tool output, and Codex's and VS Code's numbers with it | [Teardown](08-teardown.md) |
| A measured frequency of copy-substitution errors near zero | The priority of exact copy for code and commands | [Reading tasks](01-reading-tasks.md), [Trust and safety](07-trust-safety.md) |
| A study showing line numbers do not aid retrieval | The Source-mode gutter default | [Code as read](04-code-typography.md), [Reading tasks](01-reading-tasks.md) |
| A reader study showing wrapped code is misread more than scrolled code | Wrapping, and ADR-0033 point 5 with it | [Code as read](04-code-typography.md) |
| A study showing split or word-level highlighting improves review accuracy | Unified-only diffs | [Diffs and provenance](05-diffs-provenance.md) |
| A study showing lightness-only added and removed pairs slow diff reading | The lightness-first tint design | [Colour and access](09-colour-access.md) |
| A reading-task threshold well above a colour difference of 4 (the CSS Color 4 JND is 2) | The light theme's protan line pair, which is 4.7 | [Colour and access](09-colour-access.md) |
| A study showing readers find log errors faster by hue than by weight | Weight-over-hue log levels | [Structured output](03-structured-output.md) |
| A study showing readers miss label-only warnings compared with boxed ones | The label-only alert, and the ban on boxes | [READMEs](06-readmes.md), [Colour and access](09-colour-access.md) |
| A study showing striping improves README-sized table tasks | No stripe token | [READMEs](06-readmes.md) |
| A reader study in which injection-phrase flags change accept-or-reject decisions without desensitising readers | Never flagging injection-looking prose | [Trust and safety](07-trust-safety.md) |
| A study in which a marker on invisible characters does not change what readers do | The marker, as anything more than a courtesy | [Trust and safety](07-trust-safety.md) |
| A measurement that unicode-bidi isolation does not neutralise overrides inside highlighted spans or in the app webview | The isolate-per-control rule | [Trust and safety](07-trust-safety.md) |
| Evidence that target agents strip HTML comments | The comment notice, which would become noise | [Trust and safety](07-trust-safety.md), [Agent artifacts](02-agent-artifacts.md) |
| Evidence that readers expect Cmd+C in a rendered view to copy source | Rendered text for prose drags | [Diffs and provenance](05-diffs-provenance.md) |
| A measured failure rate of quote-plus-context anchors on regenerated artifacts | Fuzzy matching staying off | [Diffs and provenance](05-diffs-provenance.md) |
| A finding that readers mistake a slash at a line end for the end of a path | The slash break | [Code as read](04-code-typography.md) |
| A licence-clean Mermaid build with elkjs excluded | The v1 caption and the deferral of rendered diagrams | [READMEs](06-readmes.md) |
| A reader test showing collapsed front matter beats a visible head | The front matter head | [Structured output](03-structured-output.md) |
| WKWebView reporting `forced-colors` | The forced-colours rules, which would move from defensive to first-class | [Colour and access](09-colour-access.md) |

## What remains taste

These are judgements no study in the handbook, and probably none anywhere, can settle. Each needs a before and after artifact and a person, which is what the taste-review queue is for; the rows to file are in [the story list](stories.md).

- **Whether the artifacts feel like part of the same book as the prose.** The design language's test is whether a page reads as a well-made book. Nothing here measures that.
- **The quietness of every marker.** The invisible-character mark, the notice for removed content, the `␛` glyph, the badge line, the fold glyph, the changed-since-last-read rule and the diagram caption each have a size, a weight and a colour that are a matter of eye.
- **Whether the front matter head reads as metadata or as a box in disguise**, and whether its 12-line cap and 14ch key column are right.
- **Whether a label-only alert is noticed enough for Warning.** Habituation research supports fewer, plainer notices only by analogy.
- **The diff palette.** Whether the added line raised and the removed line resting reads as intended, whether the dark removed tint looks brown rather than red, whether the light word tint is visible at a colour difference of 1.8 to 2.9 from its line tint, and whether amber comment text on the removed tint reads as two meanings.
- **The truncation numbers.** Thirty lines, ten and ten, sixty lines for a data fold, depth two, a thousand characters and two hundred, twelve lines of front matter: all are judgement, and the two tools that document a number disagree six-fold.
- **Whether outdented speaker labels or a rule between exchanges reads better** in a long transcript, and whether thinking should exist at rest at all.
- **Whether a 1 px rule and a 2ch hang read as a continuation** in nested Python and YAML, and whether a diff continuation needs more.
- **Whether the mono weight on dark should be 340, 380 or 400.** It is 380 by inheritance, not by decision.
- **Whether breaking a path after a slash reads right.** This is the open question from MARXY-23, and the handbook's rule is a proposal.

## Where the method is weakest

- **Almost every source on presentation is [D].** The empirical literature is about reading code, mostly short snippets by tens of students, and does not test the choices Marxy has to make. Agent artifacts in their present form are too new to have a literature: the closest studies are of how developers use assistants, not of how they read what an agent leaves behind.
- **Many primary sources were read as abstracts.** ACM, PubMed and several publisher pages returned 403 or a CAPTCHA, so a large share of the papers rest on the abstract or a search summary and are capped at **[C]** for anything the abstract does not state. The ledger records depth for every entry.
- **Tool documentation was read through summarising fetches.** In the teardown, "not documented" means not on the page fetched. Only the Codex source and a few Claude Code pages were read as raw text. The claim that no tool documents a per-host remote-image opt-in is an absence on the pages opened.
- **Measurements are of one engine build in headless test harnesses.** The line-number copy result, the bidi isolate result and the diff palette contrast come from WebKit 26.6 and Chromium 153 under Playwright on `file://` pages, not from the shipped Tauri webview. The tritanopia simulation is an approximation that the Machado paper itself says it does not validate.
- **One developer's session files** are the whole basis of the JSONL structure numbers (twelve more sessions were counted, and conversation ranged from 15 to 62 % of lines).
- **The colour differences use a threshold of 4 that the handbook chose.** The CSS Color 4 just-noticeable difference is 2, and a small-patch value.
- **The handbook was written by model agents and checked by model agents.** Every load-bearing claim was re-fetched by a separate skeptic pass and many were downgraded or corrected, and the probes and measurements are reproducible from files in the folder, but no person has read the sources these chapters cite. The author's review is the last skeptic.
