# Indigo: a look drawn from the standing-automation page

The owner asked for the look of the "Marxy Standing Automation" page (its `:root` palette and font stack) as a
bundled theme, checked against the Reader Typography Handbook first. This is the investigation and the decisions,
approved by the owner on 2026-11-28 before it was built.

## Source

| Role | Night | Day |
| --- | --- | --- |
| ground, surface, line | `#11131b`, `#181b26`, `#2a2e3d` | `#f3f4f6`, `#ffffff`, `#d9dbe2` |
| text, muted | `#e8e6df`, `#9b9aa8` | `#1c1e26`, `#5c5e6b` |
| periwinkle, amber, teal, coral | `#8d9bff`, `#e7b450`, `#7fc8b2`, `#e48a6f` | `#3c4ed0`, `#a8700e`, `#237a62`, `#b4472b` |

Type: Newsreader headings, IBM Plex Sans body, IBM Plex Mono code, all from Google Fonts.

## Against the shelf

Midnight is nearest: as dark a ground (OKLCH L 0.189 against 0.188) but steel blue (hue 257 against 274), with cool
text, accent (254) and code. The page's text is warm (hue 94) on a cool ground; no shipped look pairs those.

## Against the Handbook

| Choice | Finding | Outcome |
| --- | --- | --- |
| Off-black indigo ground | ch. 9: avoid pure black; tinted grounds neither help nor harm **[D]** | kept |
| Text at 14.8 : 1 | ch. 9: off-white near 13 : 1 against halation **[D]** | body 13.5 : 1; the page's colour kept for headings (14.8) |
| Periwinkle, chroma 0.146 | ch. 9: desaturate accents on dark grounds **[D]**; Night 0.115, Midnight 0.093 | hue kept, chroma 0.115: `#9daafa` |
| Borders in the line colour, 1.37 : 1 | ch. 9, WCAG 1.4.11: component edges 3 : 1 | line stays the rule; edge `#6c7184` at 3.8 : 1 |
| Newsreader | ch. 3: x-height 0.446 (20.5 px to match Literata 18), no onum or smcp, Latin and Vietnamese only, `line-height: normal` 1.01 | not bundled |
| IBM Plex Sans, Mono | ch. 3: RFN "Plex" (subsetting needs a rename), Sans features unverified; ch. 2: serif or sans makes no reading difference **[A]** | not bundled |

Type as built: Inter for all prose (nearest bundled to Plex Sans; largest x-height bundled, 0.543), Source Serif 4
headings through `headFace` (optical sizes to 60 give the display cut that stands in for Newsreader), JetBrains Mono
for code; sized to Literata's x-height at 20 px, leading 1.55 (the page sets 1.6), measure 66.

## Measured through the engine

The page's colours mapped straight onto the roles, unadjusted, moved 8 pins by night and 7 by day:

| Scheme | Pin | Drawn | Engine | Why |
| --- | --- | --- | --- | --- |
| night | secondary, faint | `#9b9aa8` | `#a9a8b6` | under 4.5 : 1 on selection and find grounds |
| night | edge | `#2a2e3d` | `#616677` | 1.37 : 1, floor 3 |
| night | keyword, function, comment, operator, marker | page hues | lighter | under 4.5 on diff and selection grounds |
| day | ok, warn, err | `#237a62`, `#a8700e`, `#b4472b` | `#1b745c`, `#8e5c00`, `#b04327` | warn was 3.82 : 1 on the page; the others fail on their washes |
| day | edge | `#d9dbe2` | `#8b8d94` | 1.26 : 1 |
| day | string, number, function | page hues | darker | under 4.5 on code grounds |

The adjusted palette in `packages/theme/src/looks/indigo.ts` resolves with no pin moved in either scheme;
`gate-contrast` checks 453,750 pairs with none failing.

## Looked at

`shots` over the browser build, chosen through the command line (`Look: Indigo`), night and day, on a getting-started
doc, the Postgres plan, `indexer.rs`, the build log, a patch and a CSV table. One change came of it: by night the
added-line ground (`#1c252a`) was hardly apart from the code ground beside the coral deletions, so it became `#1d2c2b`
(word `#28403b`). Prose under `reading/` shows Book, not Indigo, because of the starter rule; that is the rule, not
the look.
