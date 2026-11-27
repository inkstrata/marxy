# Partial notes from a duplicate review (stopped 16:40, not the review of record)

- At `9759222f` the screen is bisected over the article's top-level blocks and every paragraph in the blocks the screen meets is read: tables and folded paragraphs covered.
- A top-level float's bottom out of order can only start the bisection earlier, never later (harmless); `table align`, the one float holding paragraphs, is stripped by the sanitiser.
- Nothing calls `destroy({ discard: true })` yet.
- The view's one `onPass` handler re-reads blocks and restores the held place; neither changes when no height moved.
- New: the kill switch is no longer checked in `adopt()`. If it flips while idle, the next adopt schedules a step that un-sets the whole page; master returned early and left it set. Probably harmless (a theme change relays out anyway) but a behaviour change.
