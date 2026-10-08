# ADR-0011 — The palette is the tab manager; no tab bar

**Status:** accepted, with a reversal criterion

## Decision
No persistent tab bar. Opening the palette with no query shows the most-recently-used stack,
newest first, with pinned documents on top. Back and forward navigate document history with
the standard keys. Switching an indexed document must paint in under 50 ms.

## Why
Tabs exist because switching is slow and you lose track of what is open. Instant switching
plus a navigable history removes both reasons, and "just the damn document" stays literally
true (design constraint 6). It is also less work than a tab bar.

## Reversal criterion
At taste review #2 the reviewer, given five documents opened in sequence, must reach "the
document from three switches ago" within five seconds using only the palette. Failure
triggers the designed-but-unbuilt fallback: tabs revealed only while switching (modifier
held) or on hover at the top edge, never at rest.

## Note: the native menu (MARXY-342)
The macOS menu lists Back, Forward and Open Quickly… (the palette) under Go. They only make the
same keys discoverable and clickable; the palette stays the tab manager, and no tab list or
document-specific command is added to the menu.

## Note: a split is not a tab bar (ADR-0057)
Two documents side by side (D-01 onward) is a summoned state, opened from the palette and closed by
key, with no strip, label or handle at rest; with one document the window is what it was. It
therefore passes this decision as written: the palette stays the document manager, and the reversal
criterion above is unchanged.
