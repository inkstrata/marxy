## Sources that were weaker than their reputation

These appear in the chapters with their limits stated. Several are widely cited for claims they do not support.

- **"Programmers look at method signatures"** (Rodeghero et al., 2014). It is known here only through Abid et al. (2019), which found more gaze on the method body under different conditions. It is graded **[X]**, and the disagreement is between two studies of different tasks, not a clean replication ([Reading tasks](01-reading-tasks.md)).
- **Skimming and signalling** (Duggan and Payne 2011; Lorch). The 2011 paper is a re-analysis of the eye data from a 2009 paper, so it is one dataset, not two studies, and the 2009 paper found skimming no better than reading half of each paragraph. Both are prose studies applied to code and logs, and both are graded **[C]** in this handbook ([Reading tasks](01-reading-tasks.md)).
- **The F-pattern** (Nielsen Norman Group). Practitioner research on web pages that its author calls rough; graded **[D]**.
- **Progressive disclosure** (Nielsen 2006). The 46-application study is a hotel-reservation test, and the two-level limit is a general principle, not its finding; graded **[D]** ([Agent artifacts](02-agent-artifacts.md)).
- **Zebra striping** (Enders, two web experiments). Study one showed no accuracy effect and points to a peer-reviewed paper that was not read; study two gave a gain on 3 of 8 questions under a 15-second limit. Graded **[C]**; no test on README-sized tables ([READMEs](06-readmes.md)).
- **Warning research** (Wogalter 1994; Anderson 2015, 2016). Read as abstracts only, so capped at **[C]**; the middle-signal-word result never appeared in the abstract retrieved. Both transfer to documentation callouts only by analogy ([READMEs](06-readmes.md)).
- **Injection detectors** (Liu et al. 2024). The abstract gives no verdict on detectors, so it does not carry the "never flag prose" recommendation, which rests on Nasr et al. (adaptive attacks bypass 12 defences) and on the reader's job not being semantics ([Trust and safety](07-trust-safety.md)).
- **Passive URL cues** (Dhamija et al. 2006; Lin et al. 2011). Dhamija's figures were verified against its abstract. Lin's page returned 403 everywhere, so its detail was removed, and a contrary study (Xiong 2017) makes passive cues **[X]** ([Trust and safety](07-trust-safety.md)).
- **VS Code's 30-line output limit.** Confirmed from source, but it is a text-output line limit that doubles as a scroll height when scrolling is on, not a fold threshold and not a head-and-tail rule ([Agent artifacts](02-agent-artifacts.md), [Teardown](08-teardown.md)).
- **Machado, Oliveira and Fernandes (2009) matrices.** The numbers match the authors' own page digit for digit, but the paper says it does not model tritanopia, so the tritan columns are an approximation the paper does not validate ([Colour and access](09-colour-access.md)).
- **"Histogram diff is better than Myers"** (Nugroho et al.). Java only, judged for repository mining, and a 2025 thesis abstract reports histogram cases where one changed line marks the rest of the file as changed. Graded **[C]** ([Diffs and provenance](05-diffs-provenance.md)).

## Claims that could not be verified and were left out

The research could not verify these, so the chapters do not assert them or mark them "not verified".

- A Barik et al. MSR 2016 paper on how developers read logs (not found; Barik 2017 on compiler errors is used) and a Peitek et al. ICSE 2021 eye-tracking study (that paper is an fMRI study on code metrics; Peitek 2020 is used).
- The Schröter et al. (2010) figures of 40 % top-frame and 88 % within ten frames: only "traces help" survives, at **[C]**.
- Any eye-tracking or reader study of transcript formatting, log skimming, diff colouring, moved-code highlighting or line numbers as a retrieval aid. None was found.
- Yin et al. (SOSP 2011) on configuration errors, Miara et al. (1983) first hand, Lin et al. (CHI 2011) and the Duma (2026) percentage of AI pull requests without review: the pages or figures could not be read.
- Whether GitHub honours `.editorconfig` for tab width, GitHub's code-copy-button behaviour, Zed's preview scroll sync, Warp's copy and collapse, Jupyter's ANSI handling, and ChatGPT's reasoning collapse: not in the official pages fetched.
- Screen-reader speech for a bare `+` or `-` in a diff, and whether WKWebView reports `prefers-contrast` or `forced-colors`.
- Whether Tauri 2 allows an unmanifested application command to be called from the webview by default.
- Whether target agents other than Claude Code strip HTML comments.
- Source-mode ligatures and the Chromium drag-from-gutter result in the running app (measured in a harness only).
- Whether a bundler can exclude `elkjs` from Mermaid, and the exact current Mermaid version line (the registry and the advisories disagree).
