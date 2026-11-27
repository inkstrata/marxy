// The Studio's specimens: a short page of each kind of text, and a few lines in each language
// with a palette, so a look can be seen as one system across them. Written for Marxy; nothing here is read from disk.
import type { SpecimenKind } from './context.ts';

/** The kind each specimen is read as: it picks the look's rules (fixed width for code, the interface face for data). */
export const KIND_OF: Readonly<Record<SpecimenKind, string>> = {
  prose: 'article',
  code: 'code',
  data: 'data',
  table: 'data',
  log: 'log',
  patch: 'diff',
  talk: 'transcript',
};

export const KIND_NAMES: readonly (readonly [SpecimenKind, string])[] = [
  ['prose', 'Prose'],
  ['code', 'Code'],
  ['data', 'Data'],
  ['table', 'Table'],
  ['log', 'Log'],
  ['patch', 'Patch'],
  ['talk', 'Talk'],
];

export const ESSAY = `# On margins

A page is mostly the space around its words. The margin tells the eye where a line begins and ends, and gives the hand somewhere to rest; take it away and even good prose reads as a wall.

The measure matters as much. A line of sixty or seventy characters lets the eye find the start of the next one without hunting, while a line twice as long loses its reader at every return. Type that is too small asks for a closer look; type that is too large breaks a thought into pieces.

Contrast is the quiet part. Ink that is nearly black on paper that is nearly white is restful for an hour; grey on grey is restful for a minute and tiring after that. The best setting is the one you stop noticing.

## What a look is

A look is a handful of numbers: the tone of the page by day and by night, how strongly the ink stands on it, one hue for links, the face, its size, the space between lines, and how many characters a line may hold. Every colour on the page is worked out from those, and none may fall below what a reader needs.

> The page is the canvas, and the canvas is always real text.

Change a number and the whole page follows: headings, quotations, code and the faint words in the margin all keep their places in the same system.
`;

const fence = (lang: string, body: string): string => `\`\`\`${lang}\n${body}\n\`\`\``;

export const SPECIMENS: Readonly<Record<Exclude<SpecimenKind, 'prose'>, string>> = {
  code: fence(
    'typescript',
    `// Waits until the folder has been quiet for a moment, then reports every file that changed.
import { watch, type FSWatcher } from 'node:fs';

export interface Change {
  readonly path: string;
  readonly at: number;
}

const QUIET_MS = 120;

export function settle(dir: string, report: (changes: readonly Change[]) => void): FSWatcher {
  const pending = new Map<string, Change>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(dir, { recursive: true }, (_event, name) => {
    if (name === null) return;
    pending.set(name, { path: name, at: Date.now() });
    clearTimeout(timer);
    timer = setTimeout(() => {
      report([...pending.values()].sort((a, b) => a.at - b.at));
      pending.clear();
    }, QUIET_MS);
  });
  return watcher;
}`,
  ),
  data: fence(
    'json',
    `{
  "services": [
    { "name": "indexer", "port": 7201, "replicas": 3, "healthy": true, "p95_ms": 41.5 },
    { "name": "watcher", "port": 7202, "replicas": 2, "healthy": true, "p95_ms": 12.0 },
    { "name": "search", "port": 7203, "replicas": 4, "healthy": false, "p95_ms": 188.2 },
    { "name": "notes", "port": 7204, "replicas": 1, "healthy": true, "p95_ms": 9.7 }
  ],
  "updated": "2026-10-14T09:14:02Z",
  "region": "eu-west"
}`,
  ),
  table: `| Service | Requests | p50 (ms) | p95 (ms) | Errors |
|---|---:|---:|---:|---:|
| indexer | 48,210 | 12.4 | 41.5 | 3 |
| watcher | 112,904 | 3.1 | 12.0 | 0 |
| search | 20,377 | 64.9 | 188.2 | 41 |
| notes | 7,512 | 2.8 | 9.7 | 0 |
| export | 1,096 | 210.3 | 640.0 | 2 |
| sync | 33,018 | 18.6 | 72.4 | 5 |`,
  log: fence(
    'log',
    `2026-10-14 09:14:02.118 INFO  indexer: walked 3,812 files in 1.9s
2026-10-14 09:14:02.240 INFO  http: GET /v1/files 200 12ms
2026-10-14 09:14:03.007 WARN  index: a file over 40 MB was read in parts
2026-10-14 09:14:03.512 INFO  cache: hit ratio 0.94 over 5m
2026-10-14 09:14:04.880 ERROR db: deadlock detected, transaction rolled back
2026-10-14 09:14:04.901 INFO  db: retrying transaction 7f3a (attempt 2)
2026-10-14 09:14:05.230 INFO  http: POST /v1/refresh 200 31ms
2026-10-14 09:14:06.044 INFO  journal: compacted 412 entries`,
  ),
  patch: fence(
    'diff',
    `--- a/src/watcher.ts
+++ b/src/watcher.ts
@@ -12,9 +12,11 @@ export function settle(dir: string, report: (changes: readonly Change[]) => void)
   const pending = new Map<string, Change>();
   let timer: ReturnType<typeof setTimeout> | undefined;
-  const watcher = watch(dir, (_event, name) => {
+  const watcher = watch(dir, { recursive: true }, (_event, name) => {
     if (name === null) return;
     pending.set(name, { path: name, at: Date.now() });
-    clearTimeout(timer);
-    timer = setTimeout(flush, 50);
+    clearTimeout(timer);
+    // Quiet for a moment first: an editor's save is several events.
+    timer = setTimeout(flush, QUIET_MS);
   });`,
  ),
  talk: `## You

Why does the watcher report the same file twice when I save it?

## Assistant

An editor often saves in two steps: it writes a new file and then renames it over the old one. The watcher sees both events, so the file appears twice.

Waiting until the folder has been quiet for a moment, about a hundred milliseconds, gathers both into one report.

## You

Will that delay be noticeable?

## Assistant

Not in practice. A tenth of a second is under the time it takes to look from the editor to the page.`,
};

/** A few lines in each language with a palette of its own, in the palettes' order. */
export const LANGUAGE_SPECIMENS: Readonly<Record<string, string>> = {
  rust: fence('rust', `/// The height of the tide at a gauge, in metres.\n#[derive(Debug, Clone, Copy)]\npub struct Reading { pub at: u64, pub height_m: f32 }\n\npub fn highest(readings: &[Reading]) -> Option<Reading> {\n    readings.iter().copied().max_by(|a, b| a.height_m.total_cmp(&b.height_m))\n}`),
  python: fence('python', `@dataclass\nclass Reading:\n    at: int\n    height_m: float\n\ndef highest(readings: list[Reading]) -> Reading | None:\n    """The reading with the greatest height, or None."""\n    return max(readings, key=lambda r: r.height_m, default=None)`),
  go: fence('go', `package tide\n\n// Reading is the height of the tide at a gauge.\ntype Reading struct {\n\tAt      int64\n\tHeightM float64\n}\n\nfunc Highest(rs []Reading) (Reading, bool) {\n\tif len(rs) == 0 {\n\t\treturn Reading{}, false\n\t}\n\treturn rs[0], true\n}`),
  typescript: fence('typescript', `interface Reading {\n  readonly at: number;\n  readonly heightM: number;\n}\n\nexport function highest(rs: readonly Reading[]): Reading | null {\n  return rs.reduce<Reading | null>((a, r) => (a === null || r.heightM > a.heightM ? r : a), null);\n}`),
  javascript: fence('javascript', `// The next high water after now, from a list of readings.\nexport function nextHigh(readings, now = Date.now()) {\n  const ahead = readings.filter((r) => r.at > now);\n  return ahead.length > 0 ? ahead.reduce((a, r) => (r.height > a.height ? r : a)) : null;\n}`),
  sql: fence('sql', `-- The lowest water at each gauge this week.\nselect gauge, min(height_m) as low_m, count(*) as readings\nfrom readings\nwhere at >= date('now', '-7 days')\ngroup by gauge\norder by low_m asc;`),
  shellscript: fence('bash', `#!/usr/bin/env bash\n# Publish the tide tables, then say where they went.\nset -euo pipefail\nout="\${1:-dist}"\nfor f in tables/*.csv; do\n  cp "$f" "$out/" && echo "published $f"\ndone`),
  css: fence('css', `/* A notice that does not shout. */\n@media (prefers-contrast: more) {\n  .notice { border-width: 2px; }\n}\n.notice {\n  padding: 0.75rem 1rem;\n  border: 1px solid var(--rule);\n  border-radius: 6px;\n}`),
};
