# The decision pass — open questions settled, and what was overturned

**Date:** 2026-09-18. The brainstorm left Q3, Q6, Q9, Q10, Q11, Q13 open and marked D4,
D15, D16 and the scope proposal as mine to revisit. Each is settled below with the losing
argument kept, as the brainstorm's own log does.

## Settled

| Q | Decision | ADR | The argument that lost |
| --- | --- | --- | --- |
| **Q9 stack** | Tauri, by a rule committed before measuring. The only measurement that could force Electron (an uncompensable WebKitGTK weight defect) did not reproduce on 2.52; both Linux engines sit ~70 units lighter than macOS, so the adjustment is a platform property, not a shell one. | 0010 | "Electron starts faster in the one same-app benchmark." True (40 ms), immaterial against a 500 ms budget that CI enforces on the real bundle either way. |
| **Q3 aesthetics test** | Two tiers: a mechanical CI gate (grid conformance, measure, contrast, zero layout shift, rag metrics against baseline, theme lint) and a scheduled human gate (blind side-by-side vs Typora and Marked 2, preferred on 2 of 3 documents; a fresh person's first reaction is about looks). | 0014 | "Indistinguishable from a printed book." Unfalsifiable as stated and unrunnable by agents; kept as the spirit, not the test. |
| **Q6 typeface** | Literata (text) + JetBrains Mono (code), pending taste review #0 against Source Serif 4 + IBM Plex Mono. | 0015 | iA Writer Quattro's duospaced coherence with code was the strongest argument for the iA route. The spike found its axis is 400–700, so it cannot be tuned below regular; that ended it as a body face whose weight must track platforms. |
| **Q10 indexed root** | The enclosing git repository, else the file's directory; twelve recent roots; ignore rules, deny list, extension allow-list, 50k ceiling. | 0012 | "Explicitly configured roots." Predictable but needs a settings surface, which fights chrome-at-zero and delays the first useful index. Deferred, not rejected. |
| **Q11 search** | Titles, headings and paths in v1. Contents in v1.1. | 0012 | Contents search is more useful; it is also where a JS index stops sufficing and where the schedule would go. |
| **Q13 resident process** | Single-instance always; "stay resident" is an opt-in preference, off by default, and the documented fallback if a platform misses the cold-start budget. | 0013 | "Be resident like Spotlight." Right for a launcher; surprising for a reader that the user expects to quit. The budget gate decides whether it is ever needed. |
| **Q5 raw HTML** | Always sanitise; markdown-equivalent allow-list by default; per-document opt-in widens it. | 0009 | "Strip entirely." Simpler, but sanitising is mandatory anyway and stripping breaks READMEs for no security gain. |
| **Q7 Mermaid** | Out of v1; first substantial request triggers reconsideration. | 0019 | Common in agent artifacts. Heavy, hard to grid. |
| **Q8 Windows** | After v1; nothing written assumes two platforms. | 0019 | — |
| **Q12 scripting** | No, stated early. | 0004 | Enormously powerful; breaks the no-execution posture. |
| **Q14 cross-document ops** | v2; the operation signature takes a `Document` so it is not foreclosed. | 0004 | — |

## Kept, with conditions

- **D4 Knuth–Plass** kept (ADR-0007), reframed: the demonstrable claim is the bundle (rag,
  hanging punctuation, zero-drift grid, `ch` measure), all four machine-measured. The Phase 1
  story must prove ragged-right through `justif/core` or switch engine; a Phase 1 review
  finding no visible gain cuts it via a superseding ADR, not by drift.
- **D15 two modes** kept as is.
- **D16 palette, not tabs** kept with a reversal criterion (ADR-0011).

## Overturned or changed from the brainstorm

| Inherited | Changed to | Why |
| --- | --- | --- |
| Run the full five-part spike, then decide | Ran the one part that could change the answer (M1), applied the rule, stopped | The rule was written so M1 alone could decide in Tauri's favour; the user judged the Electron half not worth its cost once M1 was in; the startup claim is better enforced as a CI gate on the real bundle than measured on a shell with no fonts or grammars |
| "Older distros ship WebKitGTK 2.36" | Every supported distro ships 2.50–2.52 | Measured on Debian 12, Ubuntu 22.04/24.04/26.04: WebKitGTK is a security package and is backported. The baseline in the theme contract is 2.50+ |
| Linux weight offset is "request one step lighter" | The offset is *upward* on Linux (both engines render lighter than macOS) | Measured. The mitigation shape is unchanged; the sign flipped, which is why Quattro's narrow axis stopped mattering for compensation and started mattering for choice |
| iA route as strongest non-serif candidate | Literata default; iA faces not bundled in v1 | Axis range; and not bundling avoids the iA "don't be a copycat" courtesy question entirely |
| v1 operations: seven | Four | Mechanism over catalogue (A16); the four cover both extraction and mutation |
| User theming API published in v1 with a linter | Contract published and user themes loadable in v1; linter and version negotiation in v1.1 | Keeps the headline feature; drops the support tooling that is not load-bearing for shipping |
| Content search "v1.1" | Same, made explicit in an ADR | — |
| Strip raw HTML by default | Sanitise always, narrow allow-list, opt-in widens | Parser flags are not an XSS boundary; sanitising is not optional |
| Resident process "consider promoting" | Opt-in preference; budget gate decides | See Q13 |
| Screenshot-diff CI "across whichever engines" | Playwright WebKit on macOS (CoreText, matches WKWebView within 10 units) plus WebKitGTK on a Linux runner | Playwright WebKit turned out to be a faithful, headless, CI-friendly proxy for WKWebView; that is the finding that makes the aesthetics gate affordable |
| Jira keys assumed discoverable | Issues delivered as an import file with a placeholder key `MARXY` | The Atlassian connector is not authorised in this environment; see `plan/README.md` |

## Not changed, explicitly

MIT (D18), two modes (D15), no plugin API, no telemetry, byte fidelity, macOS + Linux at
parity, the six design constraints and the type scale, the theme security posture.
