---
key: MARXY-54
design: [14-release]
depends: [MARXY-51, MARXY-52, MARXY-53]
verify: [pnpm precheck, pnpm done MARXY-54]
---
# MARXY-54 — Tier 2 review on a Linux laptop and a Mac; v1.0 tag

**Design:** [14-release](../../design/14-release.md) §The v1 gate · **ADRs:** ADR-0014 (tier 2), ADR-0019 · **Depends on:** MARXY-51, MARXY-52, MARXY-53 · **Human-led:** the review and the tag are Ian's; an agent prepares everything and verifies the table.

**Outcome.** marxy 1.0.0 exists on both platforms, and the record shows a person read with it, blind against the incumbents, on real hardware, and chose it.

## Agent part
1. `docs/taste-review/review-4/` — the tier-2 kit: the blind pairing script from MARXY-31 re-run against the release candidate on the corpus's READMEs and AI artifacts, instructions for the reviewer (install from the release assets, not a dev build; one Mac, one Linux laptop with a real display), and an empty `decisions.md` with the ADR-0014 questions and a "first reaction, verbatim" field per machine.
2. `needs-human.md` entry naming the two machines, the rc tag, and the kit path.
3. After the review: fill §13's v1 gate table with evidence links in the PR that bumps `apps/desktop/src-tauri/tauri.conf.json` and `package.json` versions to `1.0.0` and moves `CHANGELOG.md`'s Unreleased to `1.0.0`.
4. Verify every row; any row false → the PR stays draft and says which.

## Human part (Ian)
The blind review on both machines; the decision in `decisions.md`; `git tag v1.0.0` on the merged version commit.

## Tests → expected
| Check | Expect |
| --- | --- |
| §13 v1 gate table | every row true with a link |
| release workflow on `v1.0.0` | green, including the signing checks that are optional before 1.0 |
| `decisions.md` | "passes" recorded for both machines; first reactions present |

## Acceptance → check
CSV: blind side-by-side passes on both → `decisions.md`; first reaction recorded → same; v1.0.0 released → the release page.

## Do not
Tag. Record a decision on the reviewer's behalf. Mark a gate row true without its evidence link.
