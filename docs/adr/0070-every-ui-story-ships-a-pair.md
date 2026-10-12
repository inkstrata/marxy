# ADR-0070 — Every UI story ships an app-beside-mock pair; the mock's spec holds until a ruling departs from it

- **Status:** accepted (X-21 rulings, 2026-10-12; proposed 2026-10-11)
- **Date:** 2026-10-11
- **Builds on:** ADR-0016 (taste review is human and batched), ADR-0047 (screenshot comparison is nightly monitoring),
  ADR-0058 (the fold-up workspace, drawn by the mock), ADR-0059 (token contract v2, the mock's roles).
- **Evidence:** [`docs/plan/direction-2026-10/17-design-pass-chrome.md`](../plan/direction-2026-10/17-design-pass-chrome.md)
  (X-21) and the mock in `docs/plan/direction-2026-10/mock-v2/`.

## Context

The direction adopted a clickable mock (mock v2) for the workspace, Source, the palette, the library and the themes,
each page with a Markdown spec. Stories built the workspace's skeleton from it faithfully (the region sizes, the chrome
face and size, the radii), but none was asked to look at the result beside the mock, and the first time anyone did
(X-21) the app was found a long way from the picture: a dead column, a toolbar of words, Source without its frame, a
notice that moves the text. Each gap was small in its own story and none was visible from a test. The agents that build
Marxy cannot judge beauty (AGENTS.md, Verification), but they can put two images side by side, and a reviewer can
compare them in a minute.

## Decision

1. **A story that changes what the chrome, a summoned surface or Source looks like ships a pair.** For each mock-v2
   screen it moves toward, the story's PR adds the app's render and the mock's render of the same state, in Night and
   Paper, at the mock's size, as `docs/taste-review/<date>-<id>/<screen>-<theme>-{app,mock}.png` with an `index.html`
   that shows them side by side, made by one command (U-00's `scripts/mock-pair.mjs`). The card names the screens.
2. **The reviewer compares the pair** with the last pair of the same screen and says in the review which gaps the story
   closed and which it left. A pair is evidence for a human, never a pixel gate: nothing on the pull-request path
   compares it.
3. **The mock's `.md` is the spec for the chrome until something departs from it in writing.** Where a story draws
   something other than what the mock specifies, the card or an ADR says so and why, and the pair shows it. Where the mock
   is silent, the story asks (a question in the card) rather than invents.
4. **A story that adds a surface adds it to the no-displacement guard** (`apps/desktop/test/no-displacement.test.mjs`,
   F-45) in the same PR.

## Consequences

- Every UI card gains a line in its done-check ("Pair: `<screen>`, Night and Paper") and a reviewer step.
- The repository grows by about 1 MB of PNG per UI story (two screens, two themes, quantised where it helps). Kits are
  dated and regenerable; lasting documents never cite them (AGENTS.md, no rotting paths).
- The mock becomes the thing a departure is measured against, so it must be kept: a ruling that departs from it updates
  the mock's `.md` or records the departure beside the ruling.

## Alternatives

- **A pixel gate against the mock.** Rejected: the mock and the app share no renderer and no fonts at the pixel; a gate
  would be red forever or loose enough to pass anything.
- **A design review at the end of each wave only.** Rejected as the only check: X-21 is that review, and it found the
  drift had accumulated across a dozen stories that each looked fine alone.
- **Nothing; rely on the author's eye.** Rejected: it spends the author's time on what an agent can lay out.

## How we would know this was wrong

1. Pairs are attached and nobody reads them: the reviewer step is skipped, or no review names a gap.
2. Stories slow down for capture more than they gain: the pair command takes minutes, not seconds.
