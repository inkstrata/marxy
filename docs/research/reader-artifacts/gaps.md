# Gap list

*Where the frozen theme contract, the registry, the operations contract, the AST, the sanitiser policy or the shell API cannot express what the evidence recommends. Each gap is a draft ADR proposal in [proposals/](proposals/), not an edit: none changes an accepted ADR, and each says what would falsify it. The nine chapters recorded 47 gaps between them; they collapse to these 17 decisions.*

Evidence grades: **[A]** replicated findings or a meta-analysis · **[B]** one well-designed study · **[C]** small, limited or mixed studies · **[D]** expert convention, or convergence of shipping tools, without a direct test · **[X]** contested or contradicted. Part of the [Reader Artifacts Handbook](README.md).

Two of them are not really proposals about the evidence at all. **P02** fixes a reproduced security bug, and **P12** repays a registry drift; neither should wait for the rest.

| Draft | What cannot be expressed today | Blocked by | Evidence | Chapters |
|---|---|---|---|---|
| [P01](proposals/P01-hidden-content-is-reported.md) | Showing or reporting what the sanitiser removes (comments, unknown tags, orphan `[//]:` definitions), so a human sees what an agent reads | Sanitiser policy (CODEOWNERS-gated), registry | Measured; **[D]** | [7](07-trust-safety.md), [2](02-agent-artifacts.md) |
| [P02](proposals/P02-reserved-and-clobbering-identifiers.md) | A document cannot be stopped from claiming `marxy-` ids, internal classes or ids that shadow globals | Sanitiser policy (CODEOWNERS-gated) | Measured | [7](07-trust-safety.md) |
| [P03](proposals/P03-inert-layout-html-in-the-default-policy.md) | `align`, image sizes, `<picture>` variants and a working `<details>` in READMEs | Sanitiser policy, pipeline | Measured; **[D]** | [6](06-readmes.md) |
| [P04](proposals/P04-operations-may-see-the-source.md) | `path:L-M` references and anchors with context | Operations contract (frozen) | Measured (contract read) | [5](05-diffs-provenance.md), [4](04-code-typography.md) |
| [P05](proposals/P05-lenses-are-not-operations.md) | View lenses (reveal, fold, changed-since-last-read, compare, jump) and how the catalogue grows | Operations contract | **[D]** | [3](03-structured-output.md), [5](05-diffs-provenance.md), [7](07-trust-safety.md) |
| [P06](proposals/P06-copy-is-exact-where-text-is-code.md) | Exact copy of code, `kbd` and commands; drag selections resolving to a span | Operations contract, design 03 | Measured; **[D]** | [7](07-trust-safety.md), [5](05-diffs-provenance.md), [1](01-reading-tasks.md) |
| [P07](proposals/P07-diff-and-status-tokens.md) | Diff tints, diff line classes, a log-level weight class | Theme contract, registry | Measured; **[D]** | [9](09-colour-access.md), [5](05-diffs-provenance.md), [3](03-structured-output.md) |
| [P08](proposals/P08-front-matter-head.md) | Showing front matter | Theme contract, registry | **[D]** | [3](03-structured-output.md), [2](02-agent-artifacts.md) |
| [P09](proposals/P09-stable-anchors.md) | An anchor that survives regeneration | ADR-0018 (frozen record) | Measured; **[D]** | [5](05-diffs-provenance.md) |
| [P10](proposals/P10-derived-transcript-view.md) | Turn, role and tool structure derived from a JSONL file | AST contract | **[D]** | [2](02-agent-artifacts.md) |
| [P11](proposals/P11-wrap-exception-for-diffs-and-logs.md) | A scroller for diff, patch, log and ASCII-art fences | ADR-0033 point 5 | **[D]** | [4](04-code-typography.md) |
| [P12](proposals/P12-names-to-register.md) | Marks, attributes and classes for every new unit; a registry gate that a concatenated name evades | Registry | Measured | [7](07-trust-safety.md), [6](06-readmes.md) |
| [P13](proposals/P13-grammar-allow-list-additions.md) | `shellsession`, `jsonl`, `log` highlighting | Highlight allow-list, licence gate | Measured; **[D]** | [3](03-structured-output.md) |
| [P14](proposals/P14-accessibility-rules-and-gates.md) | Forced-colours, contrast-preference and reduced-motion rules; a contrast gate over every pair; a 320 px pass | Gates | Measured | [9](09-colour-access.md) |
| [P15](proposals/P15-links-that-work.md) | Heading ids, relative links and an external-open path | Shell API | Measured | [6](06-readmes.md), [7](07-trust-safety.md) |
| [P16](proposals/P16-diagram-rendering-licence.md) | Rendering Mermaid, if ever | Licence gate (elkjs is EPL-2.0) | Measured (registry and gate read) | [6](06-readmes.md) |
| [P17](proposals/P17-shipped-app-security-gate.md) | A gate on the shipped CSP and a constrained command surface | Gates, shell | Measured; one claim unverified | [7](07-trust-safety.md) |

## Gaps that are not decisions

Some chapter gaps need no ADR, only work: heading `id`s are in [P15](proposals/P15-links-that-work.md) because they touch the shell; the slash break in [Code as read](04-code-typography.md) is a typesetter change with no contract involved; the task-item marker for a code-span opener is a parse bug ([Agent artifacts](02-agent-artifacts.md)); tab width from `.editorconfig` is a small shared setting; and the fidelity property test and `splice` validation ([Diffs and provenance](05-diffs-provenance.md)) are core-only. They appear as stories.

## One absence, stated honestly

The chapters found no evidence that any presentation aids the verification of agent output ([Reading tasks](01-reading-tasks.md)), and the teardown found no tool documenting a per-document, per-host remote-image opt-in like ADR-0027 ([Teardown](08-teardown.md)). The second is an absence of documentation on the pages read, not proof that nobody does it. Both are treated as design to be taste-tested, and neither is a gap in the contracts.
