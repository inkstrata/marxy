# Draft P03. Inert layout HTML joins the default policy, and `<details>` works

**Status:** draft proposal, not an ADR and not accepted. It edits nothing. **Blocked by:** sanitiser-policy. **Evidence:** [READMEs](../06-readmes.md).

## Context

README heroes use `align`, image `width` and `height`, `<picture>` variants and `<details>`. `docs/design/13-trust.md` already designs a wide policy for them behind a per-document grant. Measured: `align` and sizes are dropped by default, `<picture>` loses its dark source and a `#gh-dark-mode-only` image shows in both themes, and under the wide policy a `<details>` whose body follows a blank line renders empty with its body outside it.

## Proposed decision

Move the inert attributes (`align`, `width`, `height`) and `details`/`summary` into the default list, with `open: boolean`. Resolve `<picture>` and the GitHub theme fragments to one image for the active theme and fetch only that one (a parsed single-URL `srcset`, never a list). Add a pipeline pairing pass that wraps the sibling blocks between an unbalanced `<details>` and its close, carrying provenance from open to close. Write `details`/`summary` rules in `base.css` as grid multiples.

## Consequences

README heroes look as authored. The grant in `13-trust.md` narrows to images. Whether GitHub's fragments are legacy is unverified; the decision does not depend on it.

## What would falsify it

Evidence that authored alignment harms reading, or a bypass through an inert attribute.
