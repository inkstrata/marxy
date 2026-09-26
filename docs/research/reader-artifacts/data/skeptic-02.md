# Skeptic pass — 02 · Agent artifacts: transcripts, tool calls, plans and instruction files

Reviewed 2026-09-26. 11 claims attacked: 4 upheld, 3 downgraded, 3 corrected, 0 removed, 1 qualified.

| # | Claim (short) | Attack | Outcome | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Transcript-UI convergence (2 of 3 tools) | Only Claude Code documents a reader view; Langfuse is an observability schema; Aider shows only "a file" | Downgraded: stated as one tool each, not a convergence | [interactive-mode](https://code.claude.com/docs/en/interactive-mode) `{`/`}` re-read |
| 2 | Langfuse: tool call "should nest as a sibling of the generation" | Re-fetched the page: it lists a `tool` type but does not say how it nests | Corrected (sibling claim removed; source note and sidecar fixed) | [langfuse](https://langfuse.com/docs/observability/features/observation-types) |
| 3 | 30 lines / 10+10 defaults | VS Code 30 confirmed from source but it is the scroll height when scrolling is on, not a fold or head-and-tail rule; Codex (chapter 8) is 5 lines, 50 for user shell | Downgraded: author's judgement, listed as taste; "1 of 3 tools gives a number" replaced by the 5-versus-30 disagreement. The head-and-tail rationale is unsourced | [notebook.contribution.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/notebook/browser/notebook.contribution.ts) |
| 4 | Progressive disclosure [C] (Nielsen 2006) | Practitioner essay; the 46-application study is a hotel-reservation test and the two-level limit is not its finding | Downgraded C to D | [NN/g](https://www.nngroup.com/articles/progressive-disclosure/) |
| 5 | JSONL measurements generalise | Counted (no content copied) 12 other local sessions: conversation share 0.15–0.62 (median about 0.48), thinking:text about 1:1 to 2:1, largest tool_result 1–30K chars | Qualified as one developer's sessions; "one line in three is a tool result" was wrong (165/941 is one in six) and corrected | local counts |
| 6 | Front matter dropped at render-html.ts:127 | Re-ran `renderSafeHtml` on a YAML head with Node 24: `name: pdf-tools` absent, `removed` empty | Upheld | render-html.ts:127 |
| 7 | Task item led by code span has no checkbox | Re-ran: code span, strong, em and link openers all lose the checkbox; plain text keeps it. Cause not re-derived | Upheld (broadened); cause attributed to the author | `renderSafeHtml` |
| 8 | offsetThroughEdit lands at 119 not 1495 | Not reproducible. Reader at byte 1495; status line plus a late-item edit returns 62; two edits both above the reader return 1495 | Corrected (119 withdrawn; scope of the limit stated precisely; file is restore.ts, called from reload.ts) | restore.ts |
| 9 | Claude Code strips block HTML comments and rule front matter | Fetched the memory docs: both confirmed; imports depth four confirmed. New caveat: comments stay visible if the model opens the file with the Read tool | Upheld with correction to "model never sees" | [memory](https://code.claude.com/docs/en/memory) |
| 10 | Sanitiser and app.ts:428 claims | Line 428 console.info and sanitize-html.ts:79 comment removal read | Upheld | code |
| 11 | Claude Code transcript viewer keys | `{`/`}` need fullscreen rendering; Ctrl+E toggle is classic-only | Upheld (note only) | interactive-mode |

## What still worries me

Not re-fetched: Agent Skills spec, Codex, Gemini, Cursor, Copilot and GitHub Actions pages, and the XML-tag guide. The sanitiser probe cases for XML and comments were taken from the lead's probe, not re-run. Codex's exact head/tail behaviour was taken from chapter 8. The task-marker cause (mdast-util-gfm-task-list-item) was not re-derived. "Speaker label" and derived-view defaults remain [D] convention with no reader evidence.
