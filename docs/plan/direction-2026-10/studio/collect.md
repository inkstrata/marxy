# Collect: gathering several copies into one (designed, for the author)

**Verdict:** leave, designed (mock row 12). **The ruling stands:** 06 row 5 keeps the collect stack
dropped, and this page does not change that. It designs the stack far enough to build so the author
can rule on it. **Card if lifted:** J-13 in [08-cards-studio.md](../08-cards-studio.md), held.
**Plate:** [collect.html](collect.html).

**In short.** The mock's stack catches every copy on the Mac and pastes them back one per `⌘V`. Both
halves need watching: one the pasteboard, the other the reader's pastes in other apps. A stack that
keeps the commitments works in Marxy only, and its result is one text on the clipboard. History's
*Copy joined* already produces that text from copies the reader has made. The recommendation is to
keep collect dropped, and to build it only if readers ask for a mode in place of selecting afterwards.

## Two ways to the same text

| | History's *Copy joined* (in J-09) | Collect mode (J-13, if lifted) |
| --- | --- | --- |
| The reader | Copies as usual, then opens history, selects several items, *Copy joined* | Starts collecting, copies several pieces, stops |
| The clipboard | Holds the last copy, then the joined text | Holds all the pieces so far, joined, after every copy |
| New state | None | A mode, which must be visible while it is on |
| Order and separator | Oldest first, a blank line | Order of copying, reorderable; blank line, rule, newline or custom |
| Needs | J-08 | J-08, a mode, a summoned surface |

## The design, if the author lifts row 5

**Entry.** `>Start collecting` in the palette, and *Collect* in the history pane's menu. No key: the
mock's `⌥⌘K` is free, but one more chord for an occasional mode is not worth learning, and a mode
started by accident changes what `⌘C` does.

**While collecting.** Each copy in Marxy (`⌘C`, Copy as, Extract, a workbench result) appends a piece,
and Marxy writes the joined pieces to the clipboard as one item, tagged with Marxy as the source. So
`⌘V` anywhere pastes everything so far, and nothing needs to watch the paste. Copies are still
recorded in history as they are now. Copies in other apps are not collected (under option A Marxy does
not see them).

**What shows.** A mode that changes what `⌘C` does is shown while it is on (commitment 4): a small
pill at the foot of the window, centred, folded or not: "Collecting · 3 pieces · 1,204 chars" with
*Review* and *Stop*. It is the one surface collect adds, and it leaves when collecting stops.

**Review.** A sheet over the view: the pieces in order, each with its source; drag or `⌥↑` `⌥↓` to
reorder; `⌫` removes (Undo); *Reverse*; the separator (blank line, horizontal rule, newline, custom with
`\n` and `\t`); *Drop duplicates*; the joined preview with its size.

**Stopping.** *Stop* (or `Esc` on the pill) leaves the joined text on the clipboard and records it in
history as one item, `origin: "copy"`, format *Joined*. The pieces stay in history as they were. The
stack is in memory only and never written, in any history mode.

**States.** Empty (started, no piece: "Copy something to start the stack"); normal; large (at most 200
pieces and 1 MB joined: the next copy is refused with "The stack is full" and the clipboard keeps the
stack); error (a write failure keeps the previous clipboard and says so).

## What it may never do

Watch the pasteboard, watch or count pastes, paste "in sequence" (it needs to see each paste), collect
from other apps, survive a quit, or start on its own.
