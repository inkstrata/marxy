# Why is the indexer slow

## You

The index takes 9 seconds on my notes folder. It used to be instant. What changed?

## Assistant

Most of the time is in `stat`, not parsing. The walk now descends into `node_modules` because the `.gitignore` check was removed in the last refactor, so it visits about 180,000 files instead of 1,400.

## You

Can you put the ignore check back?

## Assistant

Yes. I restored it in `walk()` and added a test that a folder with a `node_modules` of 10,000 files indexes in under 100 ms.

> Tool: ran `cargo test indexer` — 12 passed
