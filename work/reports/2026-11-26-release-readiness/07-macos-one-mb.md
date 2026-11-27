# 1 MB Markdown open on macOS, 2026-11-27

MacBook Air M5 (10 cores, 24 GB), macOS 26, held awake (`caffeinate -i`), from `main` at `b30bf002` plus the
`fold-typeset` change (which does not touch the open). The page is the generated prose of
`scripts/measure-typeset-idle.mjs` at 1 MB (1,066,804 bytes, 2,394 top-level blocks).

## WebKit (Playwright's, over the memory shell): `node scripts/measure-typeset-idle.mjs --done --json`

| What | Number |
| --- | --- |
| First screens mounted | 4,396 ms |
| Every paragraph set (`typeset_done`) | 42,181 ms |
| While being set, at rest: longest frames | 75, 74, 60, 56, 55 ms (7 of 52 frames over 50 ms) |
| While being set, a wheel scroll: longest frames | 90, 86, 85, 81, 78 ms (14 of 241 over 50 ms) |
| Once set, at rest and on a scroll | 0 mutations; worst frame 69 ms |

## Chrome 158 (Chromium's metrics): `node scripts/measure-interactions.mjs --browser chrome --doc <1 MB file> --runs 1`

```
one-mb.md
  open               nodes 21598  layouts 1801  recalcs 3518  firstContentMs 972.4  taskMs 22080.17  scriptMs 4778.88  layoutMs 3756.28  styleMs 2307.26  longestTaskMs 0  settleMs 23041.6
  cursor key (j)     layouts 4  recalcs 5  handlerMs 39.65  taskMs 42.58  scriptMs 10.62  layoutMs 4.21
  first click        layouts 6  recalcs 9  handlerMs 31.8  taskMs 159.03  scriptMs 19.3  layoutMs 8.99  styleMs 19.12
  reload from disk   removedTop 0  addedTop 2  layouts 12  recalcs 14  taskMs 608.34  scriptMs 20.41  layoutMs 39.64  styleMs 40.61  longestTaskMs 208
  tab switch to it   layouts 2314  recalcs 4456  shownMs 274  taskMs 27806.7  scriptMs 7132.19  layoutMs 4482.5
  tab switch away    layouts 65  recalcs 126  shownMs 247  taskMs 203.12  scriptMs 39.71  layoutMs 22.23
  Source to Read     layouts 34  recalcs 36  shownMs 517.4  taskMs 571.54  scriptMs 25.61  layoutMs 222.18
  Read to Source     layouts 14  recalcs 49  shownMs 392  taskMs 1542.05  scriptMs 132.14  layoutMs 12.03
```

The undo step timed out (15 s for its selector) and has no number.

## Reading

- The text shows in about 1 s (Chrome) to 4.4 s (WebKit); the 78 s figure from Windows is main-thread time until the
  page goes idle, not time to the first screen. Here that is 22 s in Chrome and 42 s until WebKit has set every
  paragraph, with frames of 50 to 100 ms meanwhile (scrolling stays possible but uneven).
- Switching back to the tab holding the page cost 27.8 s of main-thread work in Chrome (2,314 layouts): the page is
  laid out again whole when it shows.
- Not measured: the real WKWebView window (the app), and a second run of either.
