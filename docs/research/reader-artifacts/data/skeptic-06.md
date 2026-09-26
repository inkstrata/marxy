# Skeptic pass — 06 · READMEs as structured documents

Reviewed 2026-09-25. 14 claims attacked: 5 upheld, 2 downgraded, 5 corrected, 0 removed, 2 qualified.

| # | Claim (short) | Attack | Outcome | Evidence |
| --- | --- | --- | --- | --- |
| 1 | elkjs is `EPL-2.0 OR GPL-3.0-or-later` under mermaid 12.0.0 | Checked versions | Corrected: mermaid declares `elkjs ^0.9.3` as a hard dependency; all 0.9.x are EPL-2.0 only; the dual licence is 0.12.0, out of range | [registry](https://registry.npmjs.org/mermaid/12.0.0), [elkjs](https://registry.npmjs.org/elkjs) |
| 2 | That licence is disqualifying under ADR-0006 | Read the ADR and the gate | Qualified: ADR text only lists grammar/pattern allow-lists; the enforcing rule is `PERMISSIVE` in `scripts/gate-licences.mjs`. `classifyLicence` gives `EPL-2.0` unknown (fails) and the dual copyleft. Electing EPL does not help; admitting EPL would need an ADR amendment | `docs/adr/0006-*.md`, `scripts/gate-licences.mjs` |
| 3 | CVE-2026-41159 concerns `securityLevel: 'loose'` | Read advisory summaries | Corrected: default-config CSS injection via fontFamily/themeCSS | [GHSA-87f9-hvmw-gh4p](https://github.com/advisories/GHSA-87f9-hvmw-gh4p) |
| 4 | GitHub copy button copies `$` | Looked for a doc/changelog | Qualified: none found; evidence is discussion 35615 (opened 2022-10-09, last comment 2026-05-03, no staff reply, confirmed) plus closed github/docs issue 21645 | [35615](https://github.com/orgs/community/discussions/35615), [21645](https://github.com/github/docs/issues/21645) |
| 5 | `details` with markdown body under WIDE_POLICY renders empty | Re-ran on Node 24 with `WIDE_POLICY` and `WIDE_RENDERED_POLICY` | Upheld; added that the no-blank-line form keeps the body inside | local run |
| 6 | Alerts 2023; "beta from 2022" | Fetched changelog | Corrected: changelog mentions no beta; the 2022 beta was the bold-Note syntax | [changelog](https://github.blog/changelog/2023-12-14-new-markdown-extension-alerts-provide-distinctive-styling-for-significant-content/) |
| 7 | `#gh-dark-mode-only` legacy | Searched docs | Upheld as hedged (unverified); docs source has no mention; secondary sources say deprecated but still parsed | docs source |
| 8 | github-slugger outputs | Re-ran 2.0.0 | Upheld (all four outputs, `-1` suffix) | `npm pack` |
| 9 | sphinx-copybutton prompt-lines-else-whole rule | Read docs | Upheld; MIT confirmed | [docs](https://sphinx-copybutton.readthedocs.io/en/latest/use.html) |
| 10 | Enders "unrefereed" | Re-fetched both | Corrected: first article points to a peer-reviewed paper (unread); second used a 15-second limit; C stands | [A List Apart](https://alistapart.com/article/zebrastripingdoesithelp/) |
| 11 | Wogalter [B] | Only abstract, and its results not retrieved | Downgraded B → C; middle-word finding marked unverified | [DOI](https://doi.org/10.1177/001872089403600310) (403) |
| 12 | Anderson 2015/2016 [B] | Abstracts only, security dialogs | Downgraded B → C; n=25 and n=80 confirmed | [BYU](https://scholarsarchive.byu.edu/facpub/1955/) |
| 13 | Safari find in `details` partial (BCD) | Read BCD main | Corrected: Firefox is partial 139-147, full from 148; Safari 26.2 partial (WebKit 304174) | [BCD](https://github.com/mdn/browser-compat-data/blob/main/html/elements/details.json) |
| 14 | `gemoji` MIT; Prana, readmepop, Trockman numbers | Re-fetched | Upheld (registry and repo licence file; 4,226/393/0.746; 1,950; 294,941) | registry, arXiv |

## What still worries me

The registry's "latest" for mermaid is 12.0.0 while the advisories name fixes in 11.15.0; I did not reconcile the version lines. I could not read the Wogalter abstract's results (publisher 403), so the middle-word claim is unverified rather than refuted. Whether a bundler can drop elkjs from mermaid is untested. The Trockman survey-clutter claim was not re-read in full. the "Marxy today" claims beyond details, alerts and the licence gate were not re-run.
