# Reader-typography pass (ADR-0033): before and after

Five corpus pages, rendered by `packages/theme/test/render-typography.mjs`. "Before" is the
stylesheet at `origin/main` (65374ec); "after" is ADR-0033. Both use the bundled faces and
highlight code with the core highlighter, and "after" wraps lines as the app's highlight pass does.
The captures are at 2×.

| Page | 960 dark, top | 960 dark, first code | 1440 dark, first code (breakout) | 960 light, top |
| --- | --- | --- | --- | --- |
| README | [before](before-02-readme-real-world-dark-960.png) · [after](after-02-readme-real-world-dark-960.png) | [before](before-02-readme-real-world-dark-960-code.png) · [after](after-02-readme-real-world-dark-960-code.png) | [before](before-02-readme-real-world-dark-1440-code.png) · [after](after-02-readme-real-world-dark-1440-code.png) | [before](before-02-readme-real-world-light-960.png) · [after](after-02-readme-real-world-light-960.png) |
| AI plan | [before](before-03-ai-plan-dark-960.png) · [after](after-03-ai-plan-dark-960.png) | [before](before-03-ai-plan-dark-960-code.png) · [after](after-03-ai-plan-dark-960-code.png) | [before](before-03-ai-plan-dark-1440-code.png) · [after](after-03-ai-plan-dark-1440-code.png) | [before](before-03-ai-plan-light-960.png) · [after](after-03-ai-plan-light-960.png) |
| Prose | [before](before-15-prose-volume-dark-960.png) · [after](after-15-prose-volume-dark-960.png) | — | — | [before](before-15-prose-volume-light-960.png) · [after](after-15-prose-volume-light-960.png) |
| API reference | [before](before-16-api-reference-dark-960.png) · [after](after-16-api-reference-dark-960.png) | [before](before-16-api-reference-dark-960-code.png) · [after](after-16-api-reference-dark-960-code.png) | [before](before-16-api-reference-dark-1440-code.png) · [after](after-16-api-reference-dark-1440-code.png) | [before](before-16-api-reference-light-960.png) · [after](after-16-api-reference-light-960.png) |
| Agent transcript | [before](before-18-agent-transcript-dark-960.png) · [after](after-18-agent-transcript-dark-960.png) | [before](before-18-agent-transcript-dark-960-code.png) · [after](after-18-agent-transcript-dark-960-code.png) | [before](before-18-agent-transcript-dark-1440-code.png) · [after](after-18-agent-transcript-dark-1440-code.png) | [before](before-18-agent-transcript-light-960.png) · [after](after-18-agent-transcript-light-960.png) |

What changed, and which chapter of `docs/research/reader-typography/` asks for it:

- **Size and leading:** 17/28 became 20/30 (`04-spacing-layout.md` "Size", "Line spacing").
- **Measure:** 85 real characters became 66 (`03-fonts.md` "Measured metrics").
- **Code:** blocks grow into the right margin to their authored width, ligatures are off, and the
  palette is restrained with comments no longer dimmed (`06-code.md`). The `ts` block in the agent
  transcript was uncoloured before because `ts` was not a recognised fence id.
- **Numbered lists:** each item's first line no longer starts 0.35em right of its continuation.

The research already answers size, measure and code colour, so the reviewer is not asked to re-decide
them (AGENTS.md "Evidence first"). The review is whether the page is **beautiful** within them. One
thing noticed while capturing, not changed here: on the taller 30 px line, task-list checkboxes sit
at the top of the line box, visibly above the text's cap height (`after-03-ai-plan-dark-960.png`).
