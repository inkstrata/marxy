# Next steps — the first four weeks

The runbook from "scaffold committed" to "Phase 1 underway". Human touchpoints are the scarce
resource, so they are listed first and kept few.

## Week 0 — you, about an hour

1. **Push.** The `gh` token lacks the `workflow` scope, so the three local commits could not
   be pushed. As the repository owner you bypass protection:
   `gh auth refresh -h github.com -s workflow && git push origin main`.
2. **First CI run.** Expect it to need one or two fixes on the runners (mise installing Rust,
   Playwright browsers, `xvfb-run` for the startup measurement on Linux). Treat the first green
   run as MARXY-5 done; hand any failure to an agent with the log.
3. **Tag v0.0.1** once CI is green: `git tag v0.0.1 && git push --tags`. The release workflow
   produces a DMG (unsigned until Apple secrets exist; `xattr -d com.apple.quarantine` to test)
   and an AppImage and .deb. Verify each installs and opens `fixtures/corpus/02-readme-real-world.md`.
4. ~~**Jira.**~~ Done: the project MARXY at <https://marxy.atlassian.net> holds all 51 epics and
   stories, keys MARXY-4 to MARXY-54, and `orchestration/jira.mjs` keeps it in step with the
   board. Process: `docs/sdlc.md`. Credentials: `~/.config/marxy/jira.env`.
5. **Decide two things nobody else can:** (a) whether a Linux desktop is available for
   MARXY-22 (a laptop or a GNOME VM; the OrbStack machines are headless), and (b) whether an
   Apple Developer account exists for notarization by Phase 4. Neither blocks the next four weeks.

## Week 1 — the fleet, five lanes in parallel (file ownership keeps them apart)

| Lane | Stories | Paths | Note |
| --- | --- | --- | --- |
| Core | MARXY-11 parser → MARXY-12 sanitiser | `packages/core` | On everyone's critical path; start first, keep it small |
| Shell | MARXY-13 shell via shell-api → MARXY-14 byte-faithful save | `apps/desktop` | Hello world already prints marks and saves atomically; the story is the contract audit and tests |
| Process | MARXY-7, MARXY-8, MARXY-9 (MARXY-6 is largely done: protection is on) | `.github`, `scripts`, `biome.json` | Small, unblocks everyone |
| Speed | MARXY-15 startup gate in CI | `scripts/measure-startup.mjs`, `ci.yml` | Independent of the parser |
| Typography research | MARXY-19 (ragged-right through `justif/core`, ahead of MARXY-23) and MARXY-17 (typeface specimen for review #0) | `packages/typeset`, `docs/taste-review` | The highest-uncertainty item in Phase 1; start it now so its answer arrives before the theme lands |

**A technical call for MARXY-11, made now so the agent does not re-derive it.** `markdown-it`
gives line ranges for blocks and no positions for inline tokens; byte provenance on every node
(ADR-0003) needs a parser that positions inlines. Use `mdast-util-from-markdown` with
`micromark-extension-gfm` (MIT, CommonMark-compliant, positions on every node) and convert its
UTF-16 offsets to byte offsets once per document. If parse time shows in the Phase 2 waterfall,
`pulldown-cmark` compiled to WASM produces the same AST by contract with native byte offsets;
the goldens are parser-independent, so the swap is contained.

## Weeks 2–4 — Phase 1's critical path

MARXY-20 tokens and grid → MARXY-21 fonts and the Linux offset → MARXY-23 Knuth–Plass (informed
by MARXY-19) → MARXY-24 hanging punctuation → MARXY-25 headless render entry and the full
aesthetics gate → MARXY-30 baselines → MARXY-31 the review #1 artifact. MARXY-26 to MARXY-29
(images, highlighting, KaTeX, smart typography) run in parallel lanes against
`packages/core/src/render`. MARXY-16 (the release) lands as soon as MARXY-13 and MARXY-15 are green.

Proceed with Literata as the default while review #0 runs; the tokens make a swap one line.

## The dispatcher's checklist, per story

The full version, with the definitions of ready and done, is `docs/sdlc.md`; this is the short form.

1. Story is *ready*: paths listed, acceptance machine-checkable, ADRs named, Jira issue To Do.
2. Branch `type/KEY-slug` from `main`; the agent gets `AGENTS.md`, the story, the named ADRs,
   and nothing from the brainstorm.
3. PR uses the template; gates green; queue entry if anything visible changed.
4. Squash-merge; the PR body is the record; `CHANGELOG.md` line present.
5. After merge: if a decision changed, the ADR and `AGENTS.md` are updated in the same PR.

## What to watch in the first month

- The parser story slipping: everything queues behind it. Split it (blocks, then inlines,
  then GFM) rather than let it grow.
- Agents editing outside their paths. Reject the PR; the ownership rule is the loop's safety.
- Any PR that adds chrome. Constraint 6 erodes one affordance at a time.
- The taste queue staying empty. That means visual work is happening without artifacts.
