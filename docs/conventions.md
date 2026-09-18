# Conventions — commits, PRs, comments, tags, reviews

One rule underneath all of these: **a human-readable summary comes first, in plain language;
technically specific detail follows, and agent-oriented detail is folded away.** Anyone
skimming history, a PR list, a changelog or a file header should understand what changed
and why without reading the machine-facing part.

Standards adopted, unmodified where possible: [Conventional Commits 1.0](https://www.conventionalcommits.org),
[Keep a Changelog 1.1](https://keepachangelog.com), [Semantic Versioning 2.0](https://semver.org),
[Conventional Comments](https://conventionalcomments.org) for review remarks, TSDoc and
rustdoc for code documentation. Enforced by commitlint in CI and the PR template.

## Commit messages

```
type(scope): imperative subject, ≤ 72 chars, no period (MARXY-123)

One to three sentences a person can read: what changed for a reader or a
developer, and why. Written for someone who will never open the diff.

- Specific change one
- Specific change two
- Anything surprising, and the alternative that was rejected

Refs: MARXY-123
ADR: 0007
```

- **Types:** `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `style`, `revert`.
- **Scopes:** `core`, `typeset`, `theme`, `shell`, `desktop`, `corpus`, `gates`, `ci`, `docs`,
  `orchestration`, `release`, `fonts`. Omit only for repo-wide changes.
- **Key in the subject**, in parentheses at the end, so Jira and git reconcile. Bootstrap
  commits before the tracker existed are the one exception, and that period is over.
- **Breaking changes** exist only for contracts: `feat(core)!: …` plus a `BREAKING CHANGE:`
  footer naming the ADR. Nothing else in this project is "breaking".
- Body is mandatory for `feat`, `fix`, `perf`, `refactor`; optional for the rest.
- No attribution trailers of any kind (a hook blocks them). `Refs:` and `ADR:` are the only
  trailers in use.
- Squash merges use the PR title as the subject and the PR body's Summary and Changes as the
  body, so a well-formed PR produces a well-formed commit without extra work.

## Pull requests

**Title** = the squash-commit subject, same format as above.

**Body**, in this order (the template enforces it):

1. **Summary** — two to four sentences, plain language: what a reader of marxy notices, or
   what a developer can now do, and why it was worth doing.
2. **Changes** — a short bulleted list, human-readable, one idea each.
3. **Verification** — how it was checked: gates run with their result lines, and one
   sentence on how a person could try it.
4. **For the reviewer** — anything that needs judgement: trade-offs, a decision the story
   did not specify, the ADRs relied on, a screenshot pair if anything visible changed.
5. **Agent detail** — inside `<details>`: acceptance criterion → the test or gate that checks
   it; files touched grouped by path; the raw result JSON. Collapsed by default so the PR list
   and the top of the page stay legible.
6. **Checklist** — the mechanical boxes.

**Labels** mirror the story's Jira labels (`phase-n`, `typography`, `speed`, `security`,
`agent-loop`, `release`) plus, when applicable: `needs-human`, `taste-review`,
`contract-change`, `baseline-update`.

**Size:** one story. Over ~600 changed lines or two concerns → split before review.

## Review remarks

[Conventional Comments](https://conventionalcomments.org): `label (decorations): subject`,
then the reasoning. Labels in use: `blocking`, `suggestion`, `question`, `nitpick`, `praise`
(rare, specific), `thought`, `issue`. Every `blocking` names the rule, ADR or acceptance
criterion it rests on and states what evidence would resolve it. Numbered when there are
several, most severe first. No unlabeled remarks.

## Code comments and documentation

- **File header:** one or two lines at the top of every module stating its responsibility
  and the ADR that governs it. Example: `// Splices operations into the buffer. The only
  place bytes change (ADR-0004).`
- **Doc comments** (`/** … */` in TypeScript, `///` in Rust) on every exported item: one
  sentence of purpose first, then parameters or invariants only when not obvious from types.
- **Inline comments explain why, never what.** If the code needs a "what" comment, rename
  or split it instead.
- **Tags**, uppercase, always with a key or a reference so they can be found and closed:
  - `TODO(MARXY-123):` planned work with a story;
  - `FIXME(MARXY-123):` known defect with a story;
  - `HACK(MARXY-123):` deliberate shortcut, with the story that removes it;
  - `SAFETY:` above every `unsafe` block in Rust, stating the invariant relied on;
  - `SECURITY:` where a boundary is enforced, citing ADR-0009;
  - `PERF:` where a non-obvious choice serves a budget, citing the budget;
  - `CONTRACT:` in frozen contract files, citing the ADR.
  A tag without a key does not pass review.
- No commented-out code. No narration ("here we loop over…"). No changelog-style comments
  ("changed on 2026-09-18 to…"); git has that. No comments addressed to an AI or written as
  one ("as an AI…", "note to self").
- Line length 100. Prose in comments is full sentences with punctuation.
- READMEs and docs follow the same rule as PRs: what it is and why in the first paragraph,
  then how, then reference detail.

## Changelog

`CHANGELOG.md` follows Keep a Changelog: an `Unreleased` section with `Added`, `Changed`,
`Fixed`, `Removed`, `Security` headings; one line per PR, written for a reader of marxy, key
in parentheses. Release notes are generated from the section at tag time.

```
## Unreleased
### Added
- Task-list checkboxes can be toggled in Rendered mode; only the marker bytes change (MARXY-042)
```

## Font binaries

Font files are never rewritten (Reserved Font Name; never touch a byte the user did not ask to
change). `.gitattributes` therefore marks **font binaries by extension** (`ttf`, `otf`, `woff`,
`woff2`) as `binary` and explicitly unsets `eol`. It does **not** mark the whole `fonts/` tree:
`fonts/README.md`, `LICENSE` and `OFL.txt` must stay ordinary text so a reviewer can read the
diff. A tree-wide `fonts/** binary` rule hid the MARXY-17 README row on GitHub; that is the
wrong trade.

The `*` rule sets `eol=lf`. `binary` does not unset `eol`, so each font pattern also says `-eol`,
and `fonts/** -text` keeps every file under `fonts/` out of line-ending conversion: licences are
verbatim too, and IBM Plex Mono's is stored with CRLF endings. `-text` does not hide a diff.

`scripts/gate-font-attrs.mjs` (`pnpm gate:font-attrs`, and the first step of `pnpm lint`, which CI
runs) fails if a font binary loses `binary` or gains `eol`, if text under `fonts/` becomes binary,
or if any file under `fonts/` becomes eligible for line-ending conversion.

## Versions and tags

Semantic Versioning. Annotated tags `vMAJOR.MINOR.PATCH`; pre-releases `v0.1.0-rc.1`. `0.x`
until v1; phase releases are minors (v0.1, v0.2, …). Tags are created from `main` only, after
the phase's taste review passes. The tag message is the release's Summary paragraph.

## Branches

`type/MARXY-123-short-slug`, from `main`, deleted on merge. Never shared between agents.

## Stories

Summary as a verb phrase naming the observable result; a plain-language paragraph on why;
acceptance criteria as a numbered list, each machine-checkable; then agent detail: paths,
ADRs, hints. Same shape as a PR, before the work instead of after.
