# ADR-0001 — marxy is a reader, not an editor with a preview

**Status:** accepted · **Source:** brainstorm D1, D13, C1–C3

## Decision
Reading is the primary use case. Every incumbent treats reading as a mode you toggle into
from an editing buffer, which is why their reading typography inherits editor defaults. When
reading and editing want different things, reading wins. The default surface has no caret.

## Consequences
- The typesetting path runs in the default mode, always, not in a mode users rarely visit.
- Authoring features (live render, WYSIWYM, table editors) are out of scope; see ADR-0004 for
  what editing means instead.
- Feature requests are filtered by one question: does someone reading a long technical
  document notice its absence in the first ten minutes?
