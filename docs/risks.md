# Risk register

Carried from the brainstorm (`concerns/agent-concerns.md`, A1–A21), re-scored at handoff.
Severity: critical invalidates the thesis; high costs months; medium costs weeks.

| Id | Risk | Now | Mitigation in the plan |
| --- | --- | --- | --- |
| A1 | WebKitGTK rasterises weights wrong on Linux | **medium** (was critical) | Did not reproduce on 2.52 under Xvfb; harness kept; re-run on a real desktop in Phase 1; `--marxy-weight-offset` token |
| A5 | v1 too large to ship | **high** | ADR-0019 cut; four operations; theme linter deferred; phases end runnable |
| A6 | No aesthetics acceptance test | closed → **medium residual** | ADR-0014; tier 2 is only as good as the reviews actually held |
| A16 | Operations catalogue sprawls | medium | bounded per release, no API |
| A17 | "Very fast" unproven | medium | Standing observation of packaged cold start (2844 ms macOS / 1735 ms Linux, 2026-09-18); no 500 ms commitment; CI fails on warm-start inflation |
| A18 | Index unbounded | low | root rule, deny list, ceiling |
| A19 | Watching misses atomic writes | low | explicit test against rename-over |
| A20 | The brief moves again | medium | ADRs make the cost of a move explicit; authoring re-entering scope unwinds ADR-0005 first |
| A21 | No tab bar is a bet | low | reversal criterion in ADR-0011 |
| A3 | Theme authors on engines we do not control | medium | published baseline, versioned contract, linter in v1.1 |
| A7 | Untrusted content | low | ADR-0009, no-network gate, hostile fixture |
| A13 | Theming drifts into a plugin API | low | boundary stated in ADR-0008 |
| new | `justif` is young (2026-07) and justify-only in its DOM layer | **medium** | Phase 1 story proves ragged-right through `justif/core`; `tex-linebreak2` fallback; the algorithm is separable |
| new | Xvfb measurements differ from real desktops | medium | Phase 1 story; taste review #1 on a Linux laptop |
| new | Agents drift from the design language | medium | screenshot diffs + constraints as gates + taste queue |
| new | macOS notarization surprises at release | medium | Phase 0 hello-world release exercises signing; secrets gated |

Dissolved by scope, not mitigated: A2, A4, A10 (live-render editing), A9 (analysis vs lean).
