# Hunt files: the format every bug-cycle step reads and writes

A hunt is a run of the kind `hunt`: `work/runs/<date>-hunt-<nn>/`, on the branch `agent/hunt-<nn>` in its
own worktree. Its files:

| File | Written by | How |
| --- | --- | --- |
| `README.md` | the orchestrator | the hunt's account: axes, catchers, counts, yield, what was triaged, what was not checked |
| `axes.md` | the planner, then the orchestrator | one block per axis, round by round (below) |
| `findings.md` | catchers | append-only, one block per finding, through `finding.mjs add` |
| `verification.md` | verifiers | append-only, one verdict block per finding, through `finding.mjs verdict` |
| `triage.md` | the orchestrator | one row per finding: verdict, outcome (tracker row, merged into another, dropped and why) |
| `probes/<PREFIX>/` | catchers and verifiers | the scenarios, probe tests and their output that prove a finding; text only |
| `briefs/` | the orchestrator | the brief each catcher and verifier was given |

**Append-only.** No one edits or removes a block in `findings.md` or `verification.md`, the orchestrator
included. A catcher that learns more about its own finding appends a new finding that says "Supersedes
EXP-02" in its Evidence. A finding found wrong is answered by its verdict, not deleted. Always write
through the helper, never with an editor tool, so parallel writers cannot overwrite each other:

```bash
H=.claude/skills/bug-catch/finding.mjs
node $H next work/runs/2026-11-27-hunt-01/findings.md EXP          # -> EXP-03
node $H add work/runs/2026-11-27-hunt-01/findings.md <<'EOF'
...block...
EOF
node $H list work/runs/2026-11-27-hunt-01/findings.md
node $H yield work/runs/2026-11-27-hunt-01/findings.md work/runs/2026-11-27-hunt-01/verification.md
```

## Axes

An axis is one catcher's slice of the hunt: an area, a cause, a rule or an input shape. Its prefix is the
prefix of every finding its catcher writes, so a finding's id says which axis found it. `axes.md` holds one
block per axis; the orchestrator edits it freely (it is not append-only), but never reuses a prefix within a
hunt, so round 2's axes take new prefixes even when they extend round 1's.

```markdown
### LNG · one long unbroken line, every reading path
- Round: 1
- Type: shape
- Source: hunt-01 B2, B3, B9 and its "For the next hunt"
- Lens: Assume a single 2 MB line reaches each reading path. Find every step whose work grows faster than the line, or that holds the main thread past 1 s.
- Start in: apps/desktop/src/render/, packages/typeset/, apps/desktop/src/viewers/
- Model: sonnet
```

- **Type**: `domain` (an area of the app, from the domain table), `pattern` (a cause found before, looked for
  elsewhere), `invariant` (a rule in `AGENTS.md` or `docs/`, assumed broken), `spec` (what a doc promises
  against what the code does), `shape` (an input across domains: size, one long line, empty, encoding,
  rapid keys) or `environment` (WebKit, Windows, the real window, sleep and resume).
- **Lens**: an order to the catcher, one to three sentences. It replaces the generic "What to look for" of
  the catcher brief, so it says what to look for, not only where.
- **Model**: `sonnet`, or `haiku` for a `pattern` axis a search can find whose earlier findings were all
  confirmed.

`finding.mjs yield` reads `axes.md` beside the findings file for each prefix's name and round. Its columns,
per axis: findings (owner reports and findings superseded by the same axis left out), the verdicts,
**Alone** (confirmed or plausible, and no other axis's finding is a duplicate of it), **Shared** (confirmed or
plausible, and another axis found it too), duplicates of something already known, duplicates of another
axis's finding, the rest, and precision (confirmed or plausible over findings). The counts are for the
whole hunt so far: a round-2 finding that duplicates a round-1 finding moves the round-1 one from Alone to
Shared. A duplicate cycle (two findings each marked a duplicate of the other) is listed and credited to no
one until one of them gets a verdict of its own. Owner reports (`OWN-…`) are left out. A verifier who finds that two
axes met one bug marks the later `DUPLICATE of <the other id>`; that is the only way the table learns of an
overlap, so name the id.

## A finding

```markdown
### EXP-03 · Choosing PDF in the Export panel freezes the window for good
- Severity: S1 freeze
- Domain: export
- Where: apps/desktop/src/left/panels/export.ts:212, apps/desktop/src/export/page.ts:88
- Repro: open fixtures/demo/plans/pg16-upgrade-plan.md; Export panel (seventh); What: This file; As: PDF; Save
- Expected: the system print sheet opens; the window keeps answering keys
- Actual: no sheet; the page stops answering; a probe's evaluate times out after 10 s
- Evidence: probe probes/EXP/pdf-freeze.mjs times out at step 4 (output in probes/EXP/pdf-freeze.out); `printPane` awaits `setAll()` which never resolves while nothing is visible (page.ts:88-104)
- Confidence: high
- Found by: catcher export, 2026-11-27
```

- **Title**: what a reader of the app meets, not the cause. One line.
- **Severity**: `S1` data loss, a crash, a freeze or hang, a security hole (bytes the reader did not ask to
  change, network, unsanitised HTML); `S2` a wrong result or a broken feature with no workaround; `S3` wrong
  but with a workaround, or cosmetic. Add one word after it (`S1 freeze`, `S2 wrong output`).
- **Where**: `path:line` for every place the cause lives; the first is where a fix would start.
- **Repro**: steps from a fixture (`fixtures/demo/...`) or a planted file, with the keys or clicks. Name
  the platform when it matters (`macOS only`, `real window only`).
- **Evidence**: how you know. Say which it is: a probe that shows it (path to the probe and its output),
  a test that fails, or code reading alone (quote the lines and the reasoning). Code reading alone is
  allowed, but the confidence is then `medium` at most.
- **Confidence**: `high` (seen happen), `medium` (code path certain, not driven), `low` (suspicion worth a
  verifier's hour).
- A finding that adds to a tracker row says so in Evidence: "Adds to todo row R10".

## A verdict

```markdown
### EXP-03 verdict
- Verdict: CONFIRMED
- Proof: probes/EXP/pdf-freeze.verify.mjs reproduces 3 of 3 runs on macOS (output in probes/EXP/pdf-freeze.verify.out); without the Save click the page answers, so the trigger is the print path
- Severity: S1 (agrees)
- Fix hint: `printPane` should time out or call `setAll()` before hiding the page; the test to write is a browser test that saves as PDF and presses a key after
- Checked by: verifier export, 2026-11-27
```

- **Verdict**: `CONFIRMED` (reproduced, proof attached); `PLAUSIBLE` (the code path is certain but could
  not be driven here, e.g. real window or Windows only; say what would drive it); `NOT-REPRODUCED` (tried,
  and say how); `DUPLICATE of <id or todo row>`; `BY-DESIGN` (a doc in `docs/` says so; cite it).
- **Severity**: the verifier's own, with `(agrees)` or `(was S2)`.
- **Fix hint**: optional; where a fix starts and which test would prove it. Not a fix.
