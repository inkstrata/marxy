# Partial notes from a duplicate review (stopped 16:40, not the review of record)

- `8e2c26c9`'s claim holds: the release CSP's font-src has no data:, and after `c908352d` KaTeX_Size3 would have had only an inlined woff2, so it would not load.
- The real window notices uncoloured code: check:tauri (`tauri-check.mjs` about 611-668) checks a coloured Ruby keyword in Source and a Rust keyword in Read; with the page tokenizer gone, a failing worker fails those.
- check:tauri has no maths check. File for later.
- `gate-highlight-bundle` checks whatever `apps/desktop/dist` exists; verify does not build it first, and with no dist it checks source imports only, so a stale dist can pass the new checks vacuously (as the old gate did).
- Not done: gate mutation against a fresh build; maths in Edge.
