# Skeptic pass — 08 · How other tools present artifacts

Reviewed 2026-09-26. 14 claims attacked: 4 upheld, 3 downgraded, 5 corrected, 0 removed, 2 qualified.

| # | Claim (short) | Attack | Outcome | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Codex: 5 lines per tool call, 50 for user shell, `… +N lines (ctrl+t …)` | Checked raw source | Upheld; qualified: middle truncation (head and tail kept), N counts hidden logical lines, user-shell output wrapped first so 50 counts rows; ctrl-t default; Apache-2.0; constants unchanged on main 12de0e3 | [render.rs](https://raw.githubusercontent.com/openai/codex/main/codex-rs/tui/src/exec_cell/render.rs) |
| 2 | Convergence "3 of 5" on bounding output | Claude Code's MCP "Called slack 3 times" is grouping, not a line bound; Jupyter scrolling is opt-in; Warp block-actions page has no collapse | Corrected to 2 of 5 (Codex, VS Code); spec line and Trap note fixed | [Warp](https://docs.warp.dev/terminal/blocks/block-actions.md), [CC](https://code.claude.com/docs/en/interactive-mode) |
| 3 | VS Code notebook 30 lines | Chapter 02 skeptic confirmed from source | Upheld; wrapping stays unverified | source cited in chapter |
| 4 | Claude.ai collapses thinking by default | Help page says only a Thinking section the reader clicks | Downgraded: "behind a click"; convergence "2 of 2" now "1 documented" | [help centre](https://support.claude.com/en/articles/10574485-using-extended-thinking) |
| 5 | ChatGPT collapse | help.openai.com 403; search snippets only | Downgraded, kept as secondary and unverified | search results |
| 6 | Hidden Unicode "3 of 12" and dates | GitHub changelog opened: 2025-05-01, file view; bidi 2021-10-31 as cited. Claude Code strips pasted input only, which is not display of an artifact | Qualified: count kept, scope stated | [changelog](https://github.blog/changelog/2025-05-01-github-now-provides-a-warning-about-hidden-unicode-text/) |
| 7 | GitHub fetches remote images through Camo by default | Docs say Camo generates anonymous proxy URLs; "fetched on GitHub's side" is inference; private repos not addressed | Corrected wording to what the page states | [anonymized URLs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls) |
| 8 | "No tool describes per-document per-host opt-in" | Checked VS Code security levels (workspace-wide, three levels), Typora reference, Marked 2 help and HTML settings, Obsidian syntax (external images documented, no policy) | Upheld as absence on pages opened only; effort stated in chapter; no settings pages or changelogs read | [VS Code](https://code.visualstudio.com/docs/languages/markdown) |
| 9 | Obsidian "no telemetry" | Page was unopened | Upheld after opening: states no telemetry, optional-to-disable update check; tier 3 to 1 | [privacy](https://obsidian.md/privacy) |
| 10 | Claude Code raw-Markdown copy key | Docs: `c` belongs to the `/btw` side-question overlay, not transcript or main answers | Corrected in profile, table, "gets wrong" | [interactive mode](https://code.claude.com/docs/en/interactive-mode) |
| 11 | "not documented" cells (GitHub copy/highlighting, Typora, Marked 2, Warp, Zed telemetry, Obsidian) | One more fetch each | GitHub: Linguist filled, copy still silent; Typora: anchors filled, Mermaid/details still silent; Marked 2, Warp, Zed: still silent (Zed telemetry default confirmed absent) | pages cited in footnotes |
| 12 | Closing synthesis "no tool does X" | Absolute phrasing | Corrected to "in the docs read" throughout | chapter |
| 13 | VS Code strict-by-default security "named levels" | Verified; added workspace scope | Upheld | VS Code page |
| 14 | 42 sources with generic text and empty grades | Rewrote each `shows`/`doesNotShow`; grade D (tool behaviour, no direct test); added 3 sources (45 total); tiers 1 for opened pages | Corrected | data/08.json |

## What still worries me

Most GitHub, Typora, Marked 2, Warp, Zed and Jupyter pages are still read through summarising fetches, so "not documented" remains weak. The 12-tool count for hidden Unicode mixes display warnings with input sanitisation. ChatGPT is unverified. VS Code notebook wrapping, GitHub's real copy button and Zed's preview behaviour were not settled from official pages. The Codex commit in the footnote predates 12de0e3; only the constants were re-checked.
