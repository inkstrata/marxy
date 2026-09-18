<!-- Inventory and provenance for the fixture corpus the gates walk. -->

# Fixture corpus

The documents every golden, fidelity, no-network and aesthetics walk uses.
Numbered files are the cases. This file records provenance for anything whose
licence is not obvious from being original to an MIT tree.

## 15-prose-volume.md

Original continuous prose written for MARXY-64 so the line-breaking study has a
sample that can carry a comparison, rather than the ten paragraphs that decided
MARXY-19. It is not imported from the brainstorm tree, and it does not vendor
CommonMark or GFM specification examples (those are CC-BY-SA-4.0; ADR-0006).

Licence: MIT, same as the rest of this repository. No third-party text is
vendored in it. `pnpm gate:licences` stays green because nothing copyleft
entered the lockfile or the corpus.

The machine check for volume and shape is `check-prose-volume.mjs` in this
directory.
