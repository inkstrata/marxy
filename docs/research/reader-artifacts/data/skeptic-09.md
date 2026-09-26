# Skeptic pass — 09 · Colour, contrast and access for artifacts

Reviewed 2026-09-26. 14 claims attacked: 6 upheld, 1 downgraded, 2 corrected, 0 removed, 5 qualified.

| # | Claim (short) | Attack | Outcome | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Contrast of every token on the four tints (dark and light) | Re-ran final.py from the hex; no rounding | Upheld: min 4.91 dark, 4.60 light; secondary on dark added word 4.05 also confirmed | scripts |
| 2 | OKLab ΔE tables for the proposed pair | Recomputed | Upheld (9.0/12.4 dark normal, light protan 4.7/4.6) | scripts |
| 3 | Machado matrices, citation only from Crossref | Read the 2009 PDF and the authors' page | Corrected: matrices match the authors' page digit for digit; the paper does NOT model tritanopia (tritanomaly shift only), so tritan numbers are an out-of-scope approximation; validation was an FM100H experiment | [paper](https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/Machado_Oliveira_Fernandes_CVD_Vis2009_final.pdf), [page](https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html) |
| 4 | Primer hex values (six themes) | Fetched @primer/primitives 11.10.0 built CSS; recomposited | Upheld (all line/word values and composites match; MIT) | [primer](https://github.com/primer/primitives) |
| 5 | VS Code hex values | Fetched theme-defaults and editorColors.ts | Corrected: default light word insert is `#9ccc2c40`, prose said 33 (table value was right); 2026 values and Light fallback confirmed | [vscode](https://github.com/microsoft/vscode) |
| 6 | Alpha compositing in sRGB | Compared with linear-light compositing (#154422 vs #12261e) | Upheld: sRGB blend is the CSS default and reproduces the table | scripts |
| 7 | ΔE ≥ 4 threshold unsourced | Found CSS Color 4: JND = 0.02 OkLCh (2 here) | Qualified: now "about two JNDs", still taste [D], JND is for small patches | [CSS Color 4](https://www.w3.org/TR/css-color-4/) |
| 8 | "Redundant tints are exempt from 1.4.11" | Read Understanding page | Downgraded to analogy: page speaks of graphics whose info is also text; no diff ruling | [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) |
| 9 | 1.4.1 lightness 3:1 counts as visual means | Read Understanding page | Upheld | [1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) |
| 10 | Added-emphatic / removed-at-ground asymmetry is forced by headroom | Recomputed tint-vs-ground ΔE; searched alternatives | Qualified: removed line ΔE from ground 2.7/2.6 dark, 1.2/0.3 light (protan/deutan), below the chapter's own 4; `#f3d8d7` keeps comment 4.85:1 with ΔE ≥ 4.5. It is a choice. Light word step also under 4 | scripts |
| 11 | Hue overlap with string/comment tokens | Computed contrast and ΔE token vs tint | Qualified: no legibility issue (contrast 4.6 to 9.0, ΔE 40 to 57), but in light added tint 139° equals string 138°; chapter's 41° holds only in dark | scripts |
| 12 | Safari/forced-colors on macOS "never" | Checked issue 27143 and search results | Qualified: one reporter, Safari not WKWebView-in-Tauri; softened to "likely" [C] | [issue](https://github.com/mdn/browser-compat-data/issues/27143) |
| 13 | Screen-reader claims from Roselli | Read page | Qualified: JAWS rollback dated April 2020, single practitioner source; stated so | [Roselli](https://adrianroselli.com/2017/12/tweaking-text-level-styles.html) |
| 14 | "Marxy today" (focus rule, no prefers-* rules) | Grepped worktree | Upheld: base.css:250, headless.ts:306 correct | repo |

Also corrected: design constraint 3 said lightness gap ≥ 0.05 while light protan is 0.037 (wording now separates normal from simulated).

## What still worries me

Tritan is not modelled by the source paper, so the tritan columns need a different simulator or should be dropped. Whether matrices apply to linear RGB is assumed. Only two VS Code token colours and five Primer ones were sampled, so "fails" counts are lower bounds. WKWebView's reporting of `prefers-contrast` and forced-colors, and speech for bare `+`/`-`, remain untested. The light diff pair does not meet the chapter's own ΔE 4 outside the pair itself.
