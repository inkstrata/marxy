# Conventions — commits, PRs, comments, tags, reviews

One rule underneath all of these: **a human-readable summary comes first, in plain language;
technically specific detail follows, and agent-oriented detail is folded away.** Anyone
skimming history, a PR list, a changelog or a file header should understand what changed
and why without reading the machine-facing part.

Standards adopted, unmodified where possible: [Conventional Commits 1.0](https://www.conventionalcommits.org),
[Keep a Changelog 1.1](https://keepachangelog.com), [Semantic Versioning 2.0](https://semver.org),
[Conventional Comments](https://conventionalcomments.org) for review remarks, TSDoc and
rustdoc for code documentation. Commitlint enforces the commit rules (the hook locally, the title in CI); the rest is the reviewer's.

## Commit messages

```
type(scope): imperative subject, no period (A-07)

One to three sentences a person can read: what changed for a reader or a
developer, and why. Written for someone who will never open the diff.

- Specific change one
- Specific change two
- Anything surprising, and the alternative that was rejected

Refs: A-07
ADR: 0007
```

The ref in parentheses is optional (ADR-0051). Work from the October 2026 roadmap ends in its
story id, `(A-07)` or `(A-14.1)`; older work and anything tracked in Jira ends in a key,
`(MARXY-123)`; a change that is neither ends in nothing.

- **Types:** `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `style`, `revert`.
- **Scopes:** `core`, `typeset`, `theme`, `shell`, `desktop`, `corpus`, `gates`, `ci`, `docs`,
  `orchestration`, `release`, `fonts`, `repo`, `workspace`, `bootstrap`, `spike`. Omit only for
  repo-wide changes.
- **Length:** the whole header, key included, is at most 100 characters; aim for about 72.
  Body and footer lines over 100 characters are a warning, not a failure.
- **Ref in the subject**, optional, in parentheses at the end: a story id (`(A-07)`, or `(A-14.1)`
  for a sub-story), a Jira key (`(MARXY-123)`), or nothing. commitlint enforces it as
  `marxy-ref-in-subject`: a trailing parenthesis that *looks* like a ref but is malformed, such as
  `(MARXY-)` or `(a-01)`, is an error, and the ` (#nn)` a squash merge appends is allowed after
  it. The ref is how git history reconciles with the roadmap; when you have one, use it. A body may
  name other stories freely.
- **Breaking changes** exist only for contracts: `feat(core)!: …` plus a `BREAKING CHANGE:`
  footer naming the ADR. Nothing else in this project is "breaking".
- Body is mandatory for `feat`, `fix`, `perf`, `refactor`; optional for the rest.
- No attribution trailers of any kind. `.githooks/commit-msg` strips them and fails if it
  cannot, then runs commitlint on the message — from the main checkout's `node_modules` when a
  worktree has none, refusing the commit if neither has one; install it once with
  `git config core.hooksPath .githooks`. `Refs:` and `ADR:` are
  the only trailers in use.
- Squash merges use the PR title as the subject and the PR body's Summary and Changes as the
  body, so a well-formed PR produces a well-formed commit without extra work.

## Pull requests

**Title** = the squash-commit subject, same format as above; the `conventions` job lints it. (While the fleet ran, its cycle prefixed `[human]` or `(signed)` to an open title; the job strips such a prefix first, and nothing adds one now.) The author merges by squash through GitHub; nobody else merges and auto-merge stays off.

**Body**, in this order. The template (`.github/pull_request_template.md`) is a suggestion that nothing in CI enforces, but a reviewer reads it in this order:

1. **Summary** — two to four sentences, plain language: what a reader of Marxy notices, or
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

**Labels** are optional. The ones in use mirror the Jira labels the board used (`phase-n`,
`typography`, `speed`, `security`, `agent-loop`, `release`), plus, when applicable: `needs-human`, `taste-review`,
`contract-change`, `baseline-update`.

**Size:** one story, one concern. Two concerns → split before review. There is no line limit: a
change that is one concern stays one PR, however long (MARXY-191).

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
  - `CONTRACT:` in reviewed contract files (ADR-0045), citing the ADR.
  A tag without a key does not pass review. `check-deferrals` (in `pnpm check`) accepts a deferral
  marker that names a `MARXY-nnn` key or a roadmap story id (`A-07`, `B-13`, `A-14.1`) that has not
  landed; name one, or remove the marker.
- No commented-out code. No narration ("here we loop over…"). No changelog-style comments
  ("changed on 2026-09-18 to…"); git has that. No comments addressed to an AI or written as
  one ("as an AI…", "note to self").
- Line length 100. Prose in comments is full sentences with punctuation.
- READMEs and docs follow the same rule as PRs: what it is and why in the first paragraph,
  then how, then reference detail.

## Changelog

Nearly every pull request used to add a line to the same spot in `CHANGELOG.md`, so almost
every merge put every other open PR in conflict there. A story's entry is now its own file,
`changelog.d/<id>.md` (the story id, `A-07`, or a key, `MARXY-123`) — one line, written for a
reader of Marxy, ending in that id in parentheses; `changelog.d/README.md` has the rule. Two fragments in different files cannot
conflict on merge (MARXY-315).

```
Task-list checkboxes can be toggled in Rendered mode; only the marker bytes change (MARXY-43)
```

`scripts/lib/changelog.mjs`'s `hasEntry` is the one place that checks for an entry, so a gate,
a script and a prompt cannot disagree; it also accepts, during the transition, a `CHANGELOG.md`
line under `Unreleased` — the format `CHANGELOG.md` follows: [Keep a Changelog](https://keepachangelog.com),
key in parentheses. `node scripts/changelog.mjs --release X.Y.Z` folds every fragment into
`CHANGELOG.md` under a new version heading, in key order, and deletes the fragments. Release
notes are generated from that heading at tag time.

## Font binaries

Font files are never rewritten (Reserved Font Name; never touch a byte the user did not ask to
change). `.gitattributes` therefore marks **font binaries by extension** (`ttf`, `otf`, `woff`,
`woff2`) as `binary` and explicitly unsets `eol`. It does **not** mark the whole `fonts/` tree:
`fonts/README.md` and `LICENSE` files must stay ordinary text so a reviewer can read the
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

`type/<id>-short-slug` from `main`, where `<id>` is the story id in lower case (`docs/a-11-ci-contract-rewrite`)
or a Jira key (`type/MARXY-123-short-slug`); a branch with neither is allowed. Deleted on merge, and
never shared between agents: one story, one branch, one worktree, one pull request.

## Stories

Summary as a verb phrase naming the observable result; a plain-language paragraph on why;
acceptance criteria as a numbered list, each machine-checkable; then agent detail: paths,
ADRs, hints. Same shape as a PR, before the work instead of after.
