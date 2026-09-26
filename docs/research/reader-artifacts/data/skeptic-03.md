# Skeptic pass — 03 · Structured output, front matter and logs

Reviewed 2026-09-25. 14 claims attacked: 5 upheld, 2 downgraded, 5 corrected, 1 removed, 1 qualified.

| # | Claim (short) | Attack | Outcome | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Log grammar maps to classes as inferred (traces/verbose to comment; info/debug/warn none) | Ran `log` grammar through the Marxy scope theme (Shiki 4.4.3) | Corrected: trace `at` lines, ERROR, FATAL, strings, exception names get `string`; numbers get `constant`; only dates/TRACE get `comment`; INFO/DEBUG/WARN none | local run, `packages/core/src/highlight/scopes.ts` |
| 2 | shellsession prompt/output map to no class | Ran it | Corrected: `$`/`#` take `punctuation`; output plain | local run |
| 3 | 544/64/364 line counts | Rebuilt from `lab/probe.mjs` (`{items:[60×…]}`) | Upheld (544, 3, 64, 364); but the Default's three-line placeholder gives 5/184/484, added | local run |
| 4 | 60 lines, depth 2 derived from measurement | Judgement, and 64 lines only holds on a one-line collapse | Downgraded to labelled judgement/taste; reconciled with ch. 2 (lens only) | ch. 02 line 75 |
| 5 | Flat results: reuse ch. 2's 10/10 over 30 lines | Ch. 2 says no number is supported; ch. 8 Codex uses 5/50 | Removed number | ch. 02, ch. 08 |
| 6 | 1,000/200 chars and 12-line head cap, 14ch key column | No basis | Downgraded to labelled judgement/taste; 12-line cap noted as departing from ch. 2 rule | — |
| 7 | Parse-then-stringify loses `é` forms | Node 24.18.1 | Corrected: NFC/NFD `é` preserved; loses big ints, duplicate keys, `1.0`, `é` escapes, and JSONC comments fail to parse | local run |
| 8 | RFC 8259 §4 and §6 | Re-fetched | Upheld (names SHOULD be unique; IEEE 754 binary64 interoperability; no normalisation text) | [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259) |
| 9 | ECMA-48 SGR 8 concealed | Checked | Upheld as fact; qualified: concealment and colour are separate arguments, no-colour default is judgement | [ECMA-48](https://ecma-international.org/publications-and-standards/standards/ecma-48/) |
| 10 | GitHub front matter from 2013 blog | Sought current docs | Corrected: no current GitHub docs page on rendering found; a Oct 2025 community request confirms the table still appears (secondary) | [discussion 178337](https://github.com/orgs/community/discussions/178337) |
| 11 | Schröter frame-depth 40%/88% | Unverifiable | Removed figures; [C] kept for the abstract claim only | [VU page](https://research.vu.nl/en/publications/do-stack-traces-help-developers-fix-bugs) |
| 12 | log/csv/shellsession grammars MIT | LICENSE files | Upheld: emilast 2015 and mechatroner 2017 LICENSE fetched, Shiki index lists both MIT; shellsession: repo page MIT, LICENSE text unfetched (softened, dropped "2022") | [emilast](https://raw.githubusercontent.com/emilast/vscode-logfile-highlighter/master/LICENSE), [rainbow_csv](https://raw.githubusercontent.com/mechatroner/vscode_rainbow_csv/master/LICENSE) |
| 13 | @codemirror packages MIT | node_modules LICENSE/package.json | Upheld for language, view, state, commands, search | local |
| 14 | Chapter graded [D] throughout | Grade check | Upheld | — |

## What still worries me

The tm-grammars index fetch did not list `shellsession`, so its MIT status rests on the upstream repo page and the raw grammar existing in Shiki's repo, not a LICENSE file (the raw URL guessed 404'd). The `log` run used one hand-written sample; other log dialects may tokenise differently. The Firefox JSON viewer, VS Code folding and WCAG 1.4.1 sources were not re-fetched, nor were the YAML/TOML spec claims. The GitHub front-matter behaviour rests on a user forum post.
