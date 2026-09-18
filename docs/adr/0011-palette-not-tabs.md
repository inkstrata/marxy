# ADR-0011 — The palette is the tab manager; no tab bar

**Status:** accepted, with a reversal criterion · **Source:** brainstorm D16, A21, C14

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
