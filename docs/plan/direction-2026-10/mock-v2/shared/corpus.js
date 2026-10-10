/* Sample library for the prototypes. Sources use escaped backticks (\`) because they live in template literals. */
(function () {
  const G = (window.Marxy = window.Marxy || {});

  // type 'repo' collections show under Repositories in the sidebar, 'folder' under Folders.
  // `changed` is how many files changed since you last read them (a quiet count, shown only when above zero).
  G.collections = [
    { id: 'plans', name: 'Plans', path: '~/Work/plans', icon: 'g-folder', type: 'folder', watch: true, files: 214 },
    { id: 'projects', name: 'tidemark', path: '~/Code/tidemark', icon: 'g-repo', type: 'repo', watch: true, files: 86, changed: 3 },
    { id: 'reading', name: 'Reading', path: '~/Documents/Reading', icon: 'g-folder', type: 'folder', watch: false, files: 41 },
    { id: 'notes', name: 'Notes', path: '~/Notes', icon: 'g-folder', type: 'folder', watch: true, files: 932 },
    { id: 'inbox', name: 'Inbox', path: '~/Inbox', icon: 'g-folder', type: 'folder', watch: false, files: 17 },
    { id: 'marxy', name: 'marxy', path: '~/Dev/marxy', icon: 'g-repo', type: 'repo', watch: true, files: 412, changed: 12 },
    { id: 'dotfiles', name: 'dotfiles', path: '~/dotfiles', icon: 'g-repo', type: 'repo', watch: true, files: 31, changed: 0 }
  ];
  G.totalFiles = () => G.collections.reduce((n, c) => n + c.files, 0);

  // Icons are the custom glyph set drawn in app.js (g-*); `article` is the prose glyph.
  G.kinds = {
    report: { name: 'Report', icon: 'g-report', desc: 'Plans, handoffs, audits, research' },
    article: { name: 'Article', icon: 'g-prose', desc: 'Essays and posts read top to bottom' },
    book: { name: 'Book', icon: 'g-book', desc: 'Long-form chapters, paged or scrolled' },
    readme: { name: 'README', icon: 'g-readme', desc: 'Project front pages' },
    docs: { name: 'Docs', icon: 'g-docs', desc: 'Reference and guides, scanned more than read' },
    code: { name: 'Code', icon: 'g-code', desc: 'Source files, verbatim' },
    log: { name: 'Log', icon: 'g-log', desc: 'Build and application logs: timestamps and levels, as written' },
    terminal: { name: 'Terminal', icon: 'g-terminal', desc: 'A shell session: prompts, commands and their output' },
    transcript: { name: 'Transcript', icon: 'g-transcript', desc: 'Chat transcripts' },
    data: { name: 'Data', icon: 'g-data', desc: 'CSV, TSV, JSON, YAML' },
    notes: { name: 'Notes', icon: 'g-notes', desc: 'Short, dated, informal' },
    changelog: { name: 'Changelog', icon: 'g-changelog', desc: 'Release notes by version' }
  };

  // Language ids for the colour tint (--lang, defined per [data-lang] in lang-colors.css).
  const LANG_BY_EXT = { rs: 'rust', ts: 'typescript', tsx: 'typescript', mts: 'typescript', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', py: 'python', go: 'go', sh: 'shell', zsh: 'shell', bash: 'shell', json: 'json', jsonc: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml', md: 'markdown', markdown: 'markdown', css: 'css', html: 'html', htm: 'html', sql: 'sql', swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', java: 'java', rb: 'ruby' };
  const LANG_ALIAS_ID = { rs: 'rust', ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', javascript: 'javascript', typescript: 'typescript', py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell', console: 'shell', shellsession: 'shell', shell: 'shell', yml: 'yaml', md: 'markdown', rb: 'ruby', 'c++': 'cpp', htm: 'html', jsonc: 'json' };
  const LANG_IDS = new Set(Object.values(LANG_BY_EXT));
  // A fence tag or file extension to a language id, or '' when it has no colour.
  G.langId = (x) => { x = String(x || '').toLowerCase(); return LANG_ALIAS_ID[x] || (LANG_IDS.has(x) ? x : ''); };
  G.langOfPath = (p) => {
    const base = String(p || '').split('/').pop();
    if (/^(\.zshrc|\.zshenv|\.zprofile|\.bashrc)$/.test(base)) return 'shell';
    if (base === 'Brewfile' || base === 'Gemfile' || base === 'Rakefile') return 'ruby';
    const m = base.match(/\.([A-Za-z0-9]+)$/); return m ? LANG_BY_EXT[m[1].toLowerCase()] || '' : '';
  };

  // Paths the fake filesystem knows about, for path verification in reports.
  G.fs = new Set([
    'scripts/pg/list_extensions.sql',
    'ops/cron/partman.yaml',
    'src/auth/session.rs',
    'src/auth/token.rs',
    'src/auth/mod.rs',
    'tests/auth_flow.rs',
    'src/indexer.rs',
    'src/watch.rs',
    'docs/api/watch.md',
    'Cargo.toml'
  ]);

  const docs = [];
  const add = (d) => docs.push(d);

  add({
    id: 'pg16-plan', collection: 'plans', kind: 'report',
    path: '~/Work/plans/plans/pg16-upgrade-plan.md',
    title: 'Postgres 14 → 16 upgrade plan',
    created: '2026-10-08 09:14', modified: '2 min ago',
    status: { unread: true, pinned: true },
    src: `---
title: Postgres 14 → 16 upgrade plan
created: 2026-10-08T09:14:00Z
---

# Postgres 14 → 16 upgrade plan

A step-by-step plan for upgrading the primary cluster from Postgres 14 to 16.

## TL;DR

- Upgrade a promoted replica with \`pg_upgrade --link\`, not the primary in place.
- Expected downtime is **under 4 minutes**, dominated by the final sync and the DNS flip.
- Two blockers: the \`pg_partman\` 4.x extension and three \`regproc\` columns in \`legacy.audit_log\`.

## Context

The primary (\`db-prod-1\`) runs Postgres 14.11 with 412 GB of data across 38 schemas. Postgres 14 leaves community support in November 2026,[^eol] and 16 adds logical decoding on standbys, which the analytics team has asked for twice.

## Phases

### 1. Preparation

- [x] Inventory extensions with \`scripts/pg/list_extensions.sql\`
- [x] Confirm \`pg_partman\` 5.1 is packaged for 16
- [ ] Rewrite the \`regproc\` columns in \`legacy.audit_log\` (see \`migrations/2026_10_drop_regproc.sql\`)
- [ ] Snapshot the replica volume

> [!WARNING]
> \`pg_upgrade\` refuses to run while a user table has a \`reg*\` column other than \`regclass\`, \`regrole\` or \`regtype\`. Do this migration first, during business hours, with the audit writer paused.

### 2. Rehearsal on staging

\`\`\`bash
# On the staging replica, after promoting it
sudo -u postgres /usr/lib/postgresql/16/bin/pg_upgrade \\
  --old-datadir=/var/lib/postgresql/14/main \\
  --new-datadir=/var/lib/postgresql/16/main \\
  --old-bindir=/usr/lib/postgresql/14/bin \\
  --new-bindir=/usr/lib/postgresql/16/bin \\
  --link --check
\`\`\`

Record the timings in \`docs/runbooks/pg16-rehearsal.md\`.

### 3. Cutover

| Step | Owner | Est. time | Rollback |
|---|---|---:|---|
| Pause writers (\`app\`, \`worker\`) | On-call | 0:30 | Unpause |
| Final replica sync | DBA | 1:10 | – |
| \`pg_upgrade --link\` | DBA | 1:45 | Restore snapshot |
| \`ANALYZE\` hot tables | DBA | 0:20 | – |
| Flip \`db-primary\` DNS | On-call | 0:15 | Flip back |

> [!NOTE]
> With \`--link\`, the old cluster cannot be started once the new one has run. The snapshot is the rollback.

### 4. Verification

- [ ] Row counts match on the 12 largest tables
- [ ] p95 latency on \`/api/search\` within 10% of baseline
- [ ] Logical replication slot for analytics created

\`\`\`sql
SELECT relname, n_live_tup
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC
LIMIT 12;
\`\`\`

## Risks

1. **Extension drift.** \`pg_partman\` 5 changes the maintenance function signatures; the job in \`ops/cron/partman.yaml\` must change in the same deploy.
2. **Planner regressions.** 16 changes some join estimates; keep \`pg_hint_plan\` ready for the two report queries.
3. **Disk.** \`--link\` needs little extra space, but the rehearsal showed 9 GB of WAL growth.

## Open questions

- Does the analytics team need the slot on day one, or can it follow a week later?
- Who owns \`legacy.audit_log\` now that the compliance team has moved?

## Next steps

1. Merge \`migrations/2026_10_drop_regproc.sql\`.
2. Book the staging rehearsal for Thursday.
3. Announce the maintenance window.

[^eol]: PostgreSQL versioning policy, <https://www.postgresql.org/support/versioning/>
`
  });

  // Earlier revision, for version diffs.
  G.prevVersions = {
    'pg16-plan': { at: '09:02', label: 'rev 3 · 12 min ago', src: null }
  };

  add({
    id: 'auth-handoff', collection: 'plans', kind: 'report',
    path: '~/Work/plans/handoffs/auth-refactor-handoff.md',
    title: 'Handoff: session token refactor',
    created: '2026-10-07 18:40', modified: 'yesterday',
    status: { unread: false },
    src: `---
title: "Handoff: session token refactor"
created: 2026-10-07T18:40:00Z
branch: auth-session-tokens
status: ready for review
owner: sam
---

# Handoff: session token refactor

## State

The refactor is **complete on the branch and not merged**. Sessions now carry an opaque token; the JWT path is gone from \`src/auth/session.rs\` and \`src/auth/token.rs\`.

## What changed

| File | Change |
|---|---|
| \`src/auth/session.rs\` | Session lookup by token hash; 30-day sliding expiry |
| \`src/auth/token.rs\` | New: token generation (32 random bytes, base64url) |
| \`src/auth/mod.rs\` | Re-exports; old \`jwt\` module removed |
| \`src/auth/jwt.rs\` | Deleted |

## Verified

- [x] \`cargo test\` passes (212 tests)
- [x] Login, logout and refresh in the local app
- [ ] Load test against staging

## Not verified

- Behaviour when two tabs refresh at the same second. \`tests/auth_flow.rs\` has no case for it.

## Next

1. Run the staging load test.
2. Decide whether to keep the 30-day expiry or match the old 14 days.
`
  });

  add({
    id: 'vector-db', collection: 'plans', kind: 'report',
    path: '~/Work/plans/research/vector-store-comparison.md',
    title: 'Research: embedded vector stores for local search',
    created: '2026-10-06 11:02', modified: '2 days ago',
    status: {},
    src: `---
created: 2026-10-06T11:02:00Z
question: Which embedded vector store should a desktop app use for semantic search over ~50k documents?
status: draft
owner: ian
---

# Embedded vector stores for local search

## Summary

For about 50,000 documents on a laptop, **an HNSW index inside SQLite** is the simplest option that meets the latency goal. A dedicated store only pays off past a few million vectors.

## Candidates

| Store | Embeds in | Index | Disk for 50k × 768d | Query p95 |
|---|---|---|---:|---:|
| sqlite-vec | SQLite | Brute force, IVF | 154 MB | 38 ms |
| LanceDB | Rust / Python | IVF-PQ | 61 MB | 9 ms |
| usearch | C++ / Rust | HNSW | 170 MB | 2 ms |
| tantivy + HNSW | Rust | HNSW (separate) | 172 MB | 3 ms |

The query times are from the vendors' own benchmarks on different hardware,[^bench] so treat them as orders of magnitude.

> [!TIP]
> Full-text search answers most "find the file" queries better than embeddings. Run both and merge the results.

## Recommendation

Use **tantivy** for full text and **usearch** for vectors, both in-process from Rust.

[^bench]: Vendor documentation, retrieved 2026-10-06. Not reproduced here.
`
  });

  add({
    id: 'indexer-chat', collection: 'plans', kind: 'transcript',
    path: '~/Work/plans/transcripts/2026-10-07-indexer-perf.md',
    title: 'Why is the indexer slow?',
    created: '2026-10-07 15:22', modified: 'yesterday',
    status: {},
    src: `# Why is the indexer slow?

> 2026-10-07 15:22 · 6 turns · 3 tool calls

## You

The indexer takes 40 seconds on my notes folder. Can you find out why?

## Assistant

I'll profile a cold run first, then look at where the time goes.

### Tool · bash

\`\`\`text
$ cargo run --release -- index ~/Notes --profile
indexed 932 files in 41.8s
  parse      2.1s
  highlight 37.9s
  write      1.8s
\`\`\`

Highlighting is 91% of the run. Every file is highlighted on every index, even when it hasn't changed.

### Tool · read

\`\`\`text
src/indexer.rs (lines 40-58)
\`\`\`

## You

So cache it?

## Assistant

Yes. Key the highlighted output by the file's content hash and skip files whose hash is unchanged. On your folder that should bring a warm run under 2 seconds.

### Tool · edit

\`\`\`diff
- let html = highlight(&src, lang)?;
+ let html = cache.get_or_insert(hash(&src), || highlight(&src, lang))?;
\`\`\`

## You

Run it again.

## Assistant

Warm run: **1.6 s**. Cold run is unchanged at 41 s, which is expected, since the cache starts empty.
`
  });

  add({
    id: 'ragged-right', collection: 'reading', kind: 'article',
    path: '~/Documents/Reading/the-case-for-ragged-right.md',
    title: 'The case for ragged right',
    author: 'M. Ellery', created: '2026-09-12', modified: '3 weeks ago',
    status: {},
    src: `---
title: The case for ragged right
author: M. Ellery
published: 2026-09-12
source: https://example.org/essays/ragged-right
---

# The case for ragged right

*Justified text looks orderly from across the room. Up close, on a screen, it is usually worse.*

Open almost any e-reader and the text runs flush to both margins. It looks like a book, and that is the point: justification is the visual signature of print, and print is what reading apps want to resemble. But the resemblance is skin deep. A printed book is justified by a compositor, human or software, who considers a whole paragraph at once and moves words between lines until the spaces are even. A browser does not.

Browsers break lines greedily. They fill each line with as many words as fit, then move on, never revisiting a decision. When the next word is long, the line comes up short, and justification pads it with wide spaces. At a comfortable line length this happens every few paragraphs. On a phone it happens on almost every line.

> Ragged right is not a compromise. It is the setting that lets every space be the same width.

Ragged right lets each line end where it ends. Word spaces stay at their designed width, which is the width the type designer chose for reading. The right edge moves, but the eye does not read the right edge; it reads words, and evenly spaced words are easier to group.[^spacing]

None of this means justification is wrong. With a line breaker that sees the whole paragraph, hyphenation, and a measure of at least forty-five characters, justified text can be excellent. It is a reasonable option to offer. It is a poor default.

[^spacing]: The evidence on word spacing and reading speed is mixed, but no study has found that uneven spacing helps.
`
  });

  add({
    id: 'cartographer-ch3', collection: 'reading', kind: 'book',
    path: '~/Documents/Reading/The Cartographer/03-the-salt-road.md',
    title: 'The Cartographer · Chapter 3',
    author: 'A. Rowan', created: '2026-08-01', modified: 'last month',
    status: { progress: 0.38 },
    book: { title: 'The Cartographer', chapter: 3, chapters: 12, page: 41, pages: 312 },
    src: `# Chapter Three: The Salt Road

The road out of Veyre ran white for the first mile, where the salt carts had spilled for two hundred years, and Ines walked it with her eyes on the ground because the glare off it was too much to bear. Behind her the town was waking. She could hear shutters and a dog and, once, her own name, called from a window by someone who could not have known she was leaving.

She did not turn. Her father had drawn this road a dozen times, and she carried his drawings in a leather tube across her back, and she meant to find out which of them was true.

The first was dated in his small, careful hand, the year before she was born. In it the road ran straight to the marsh and stopped, as if whoever walked it had simply walked into the water. The second, from ten years later, bent north around a hill that the first had not shown. The third had no road at all, only a line of crosses and a word she had never been able to read.

*He drew what he was told,* her mother used to say. *Not what he saw.*

* * *

By noon the salt had thinned to a crust and then to nothing, and the road was ordinary dirt, rutted by carts that no longer came this way. Ines stopped where a stone marker leaned out of the grass and unrolled the second drawing on her knee. The hill was there. She could see it to the north, low and green and exactly where her father had put it, and for a moment she felt something close to relief.

Then she looked at the marker. It had been cut with a mile number and an arrow, and the arrow pointed south.

She sat for a long time with the drawing on her knee, until the wind lifted its corner and she had to hold it flat with both hands. Somewhere ahead, the road was lying to her, or the map was, or the stone. She had come out here to learn which.
`
  });

  add({
    id: 'tidemark-readme', collection: 'projects', kind: 'readme',
    path: '~/Code/tidemark/README.md',
    title: 'tidemark',
    created: '2026-03-02', modified: '4 days ago',
    status: {},
    src: `# tidemark

![build](https://img.shields.io/badge/build-passing-brightgreen) ![crates.io](https://img.shields.io/badge/crates.io-0.9.2-orange) ![license](https://img.shields.io/badge/license-MIT-blue)

A fast Markdown indexer for the command line. Point it at folders; search them by text, heading or code block in milliseconds.

## Install

\`\`\`bash
brew install tidemark
\`\`\`

Or from source:

\`\`\`bash
cargo install tidemark --locked
\`\`\`

## Usage

\`\`\`bash
tidemark add ~/Notes ~/Work/plans
tidemark search "pg_upgrade --link"
tidemark watch
\`\`\`

## Configuration

| Key | Default | Meaning |
|---|---|---|
| \`index.exclude\` | \`["node_modules", ".git"]\` | Globs to skip |
| \`index.max_file_mb\` | \`8\` | Larger files are listed but not indexed |
| \`highlight.cache\` | \`true\` | Cache highlighted code by content hash |

See [the watch API](docs/api/watch.md) for embedding tidemark in another program.

## License

MIT
`
  });

  add({
    id: 'watch-docs', collection: 'projects', kind: 'docs',
    path: '~/Code/tidemark/docs/api/watch.md',
    title: 'Index::watch',
    created: '2026-05-11', modified: '4 days ago',
    status: {},
    src: `---
title: Index::watch
date: 2026-05-11
status: stable
owner: ian
---

# Index::watch

Watch one or more folders and keep the index current as files change.

\`\`\`rust
pub fn watch(&self, roots: &[PathBuf], opts: WatchOptions) -> Result<WatchHandle, WatchError>
\`\`\`

## Parameters

| Name | Type | Description |
|---|---|---|
| \`roots\` | \`&[PathBuf]\` | Folders to watch, recursively |
| \`opts.debounce\` | \`Duration\` | Wait this long after the last event before re-indexing. Default 250 ms |
| \`opts.follow_symlinks\` | \`bool\` | Default \`false\` |

## Returns

A \`WatchHandle\`. Dropping it stops the watcher.

> [!NOTE]
> Events are coalesced per file. An editor that saves through a temporary file produces one re-index, not three.

## Errors

- \`WatchError::NotFound\` if a root does not exist.
- \`WatchError::Limit\` if the OS watch limit is reached (Linux \`inotify\`).

> [!CAUTION]
> On macOS, watching a folder inside iCloud Drive can deliver events minutes late. Index such folders on a timer instead.

## Example

\`\`\`rust
let index = Index::open("~/.tidemark")?;
let _handle = index.watch(&[home.join("Notes")], WatchOptions::default())?;
// The index now updates in the background.
\`\`\`
`
  });

  add({
    id: 'indexer-rs', collection: 'projects', kind: 'code',
    path: '~/Code/tidemark/src/indexer.rs', lang: 'rust',
    title: 'indexer.rs',
    created: '2026-03-02', modified: 'yesterday',
    status: { changed: true },
    src: `//! Builds and refreshes the on-disk index.
//!
//! Highlighting dominates indexing time, so highlighted HTML is cached by
//! the hash of the file's contents and reused while the file is unchanged.

use std::path::{Path, PathBuf};
use crate::highlight::{highlight, Lang};
use crate::store::{Cache, Store};

/// One indexed file.
pub struct Entry {
    pub path: PathBuf,
    pub hash: u64,
    pub words: usize,
    pub html: String,
}

pub struct Indexer {
    store: Store,
    cache: Cache,
}

impl Indexer {
    pub fn new(store: Store) -> Self {
        let cache = Cache::open(store.dir().join("hl-cache"));
        Self { store, cache }
    }

    /// Index one file. Returns \`None\` when the file is unchanged since the last run.
    pub fn index_file(&mut self, path: &Path) -> anyhow::Result<Option<Entry>> {
        let src = std::fs::read_to_string(path)?;
        let hash = fxhash::hash64(&src);
        if self.store.hash_of(path) == Some(hash) {
            return Ok(None); // unchanged: skip parse and highlight
        }
        let lang = Lang::from_path(path);
        // Highlight once per content hash; most re-index runs hit the cache.
        let html = self.cache.get_or_insert(hash, || highlight(&src, lang))?;
        let words = src.split_whitespace().count();
        let entry = Entry { path: path.to_owned(), hash, words, html };
        self.store.put(&entry)?;
        Ok(Some(entry))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unchanged_file_is_skipped() {
        let mut ix = Indexer::new(Store::temp());
        let p = ix.store.dir().join("a.md");
        std::fs::write(&p, "# A").unwrap();
        assert!(ix.index_file(&p).unwrap().is_some());
        assert!(ix.index_file(&p).unwrap().is_none());
    }
}
`
  });

  add({
    id: 'bench-csv', collection: 'projects', kind: 'data',
    path: '~/Code/tidemark/bench/results.csv', lang: 'csv',
    title: 'results.csv',
    created: '2026-10-07', modified: 'yesterday',
    status: {},
    src: `corpus,files,size_mb,cold_ms,warm_ms,peak_mb
notes,932,18.4,41800,1600,212
plans,214,9.7,9900,410,148
tidemark,86,2.1,2300,190,96
rust-book,112,6.3,7700,350,131
mdn-sample,2400,61.0,118400,5200,488
kernel-docs,3311,44.8,96100,4100,402
`
  });

  add({
    id: 'notes-1008', collection: 'notes', kind: 'notes',
    path: '~/Notes/2026-10-08.md',
    title: '2026-10-08',
    created: '2026-10-08', modified: 'today',
    status: {},
    src: `---
title: Thursday 8 October
date: 2026-10-08
status: open
owner: ian
---

# Thursday 8 October

- Standup: pg16 rehearsal moved to Thursday
- [ ] Read the pg16 plan properly, it was written in a hurry
- [x] Reply to Sam about the auth handoff
- [ ] Try the warm-cache build of tidemark on the kernel docs

Idea: Marxy should show which paths in a document actually exist.

Links: [pg16 plan](~/Work/plans/plans/pg16-upgrade-plan.md), [handoff](~/Work/plans/handoffs/auth-refactor-handoff.md)
`
  });

  add({
    id: 'changelog', collection: 'projects', kind: 'changelog',
    path: '~/Code/tidemark/CHANGELOG.md',
    title: 'CHANGELOG',
    created: '2026-03-02', modified: '4 days ago',
    status: {},
    src: `# Changelog

## [0.9.2] - 2026-10-04

### Fixed
- Watcher no longer re-indexes a file three times when an editor saves through a temporary file.

## [0.9.0] - 2026-09-20

### Added
- Highlight cache keyed by content hash. Warm runs are 20 to 30 times faster.
- \`tidemark watch\` command.

### Changed
- \`index.max_file_mb\` default raised from 4 to 8.
`
  });

  // A build log: timestamps, levels, a stack trace and one ANSI escape (the ESC byte, shown as a visible glyph when rendered).
  add({
    id: 'build-log', collection: 'projects', kind: 'log',
    path: '~/Code/tidemark/logs/build-2026-10-09.log', lang: 'log',
    title: 'build-2026-10-09.log',
    created: '2026-10-09', modified: '38 min ago',
    status: { changed: true },
    src: `2026-10-09T08:14:02.118Z INFO  build    tidemark 0.9.3 build started (rustc 1.84.0, aarch64-apple-darwin)
2026-10-09T08:14:02.131Z INFO  config   profile=release features=default,watch target-dir=target
2026-10-09T08:14:02.340Z DEBUG fetch    registry index up to date (3 ms)
2026-10-09T08:14:02.512Z INFO  fetch    214 crates in lockfile, 0 to download
2026-10-09T08:14:03.004Z DEBUG compile  fxhash v0.2.1 (fresh)
2026-10-09T08:14:03.009Z DEBUG compile  anyhow v1.0.89 (fresh)
2026-10-09T08:14:03.020Z DEBUG compile  notify v6.1.1 (fresh)
2026-10-09T08:14:03.447Z INFO  compile  tidemark-store v0.9.3 (compiling)
2026-10-09T08:14:09.882Z INFO  compile  tidemark-store finished in 6.43 s
2026-10-09T08:14:09.901Z INFO  compile  tidemark v0.9.3 (compiling)
2026-10-09T08:14:14.250Z WARN  rustc    src/watch.rs:41: unused variable: \`opts\`
2026-10-09T08:14:14.251Z WARN  rustc    help: if this is intentional, prefix it with an underscore: \`_opts\`
2026-10-09T08:14:17.608Z WARN  rustc    src/highlight.rs:118: this \`match\` has identical arms
2026-10-09T08:14:19.771Z WARN  rustc    \u001b[33mwarning\u001b[0m: unused import: \`std::fmt::Write\`
2026-10-09T08:14:19.772Z WARN  rustc      --> src/harmonics/mod.rs:6:5
2026-10-09T08:14:21.334Z INFO  compile  tidemark v0.9.3 finished in 11.43 s (3 warnings)
2026-10-09T08:14:21.340Z INFO  test     running unit tests (4 threads)
2026-10-09T08:14:21.402Z DEBUG test     seeding fixture index in /tmp/tidemark-fx-9ac1
2026-10-09T08:14:22.016Z INFO  test     indexer::unchanged_file_is_skipped ... ok
2026-10-09T08:14:22.031Z INFO  test     indexer::changed_file_is_reindexed ... ok
2026-10-09T08:14:22.118Z INFO  test     watch::coalesces_editor_saves ... ok
2026-10-09T08:14:22.190Z INFO  test     watch::limit_error_is_reported ... ok
2026-10-09T08:14:22.455Z INFO  test     highlight::cache_hits_by_content_hash ... ok
2026-10-09T08:14:22.460Z INFO  test     highlight::cache_miss_on_lang_change ... ok
2026-10-09T08:14:23.071Z INFO  test     harmonics::constituents::m2_period ... ok
2026-10-09T08:14:23.072Z INFO  test     harmonics::constituents::s2_period ... ok
2026-10-09T08:14:23.388Z INFO  test     harmonics::predict::spring_tide_range ... ok
2026-10-09T08:14:23.390Z WARN  test     harmonics::predict::neap_tide_range took 1.9 s (slow threshold 1.0 s)
2026-10-09T08:14:25.002Z INFO  test     harmonics::tables::loads_gauge_0042 ... ok
2026-10-09T08:14:25.411Z INFO  test     harmonics::tables::loads_gauge_0107 ...
2026-10-09T08:14:25.418Z ERROR test     thread 'harmonics::tables::loads_gauge_0107' panicked at src/harmonics/tables/loader.rs:88:41:
    called \`Result::unwrap()\` on an \`Err\` value: ParseFloatError { kind: Invalid }
stack backtrace:
   0: rust_begin_unwind
   1: core::panicking::panic_fmt
   2: core::result::unwrap_failed
   3: tidemark::harmonics::tables::loader::parse_row
             at ./src/harmonics/tables/loader.rs:88:41
   4: tidemark::harmonics::tables::loader::load
             at ./src/harmonics/tables/loader.rs:52:18
   5: tidemark::harmonics::tables::tests::loads_gauge_0107
             at ./src/harmonics/tables/mod.rs:140:9
note: Some details are omitted, run with \`RUST_BACKTRACE=full\` for a verbose backtrace.
2026-10-09T08:14:25.420Z WARN  test     fixture gauge-0107.csv row 3 has an empty height column
2026-10-09T08:14:25.902Z INFO  test     harmonics::tables::rejects_negative_period ... ok
2026-10-09T08:14:26.310Z INFO  test     store::roundtrip_entry ... ok
2026-10-09T08:14:26.314Z INFO  test     store::compacts_on_close ... ok
2026-10-09T08:14:26.731Z INFO  test     cli::add_search_remove ... ok
2026-10-09T08:14:26.733Z INFO  test     cli::search_exit_code_when_empty ... ok
2026-10-09T08:14:26.990Z INFO  test     result: FAILED. 19 passed; 1 failed; 0 ignored
2026-10-09T08:14:26.991Z INFO  test     1 failed test: harmonics::tables::loads_gauge_0107
2026-10-09T08:14:27.003Z DEBUG test     removing fixture index /tmp/tidemark-fx-9ac1
2026-10-09T08:14:27.040Z INFO  build    skipping packaging: tests failed
2026-10-09T08:14:27.041Z INFO  cache    keeping 212 build artefacts for the next run (418 MB)
2026-10-09T08:14:27.044Z INFO  report   warnings: 4, errors: 1, tests: 19 passed / 1 failed
2026-10-09T08:14:27.045Z ERROR build    build failed after 24.93 s (exit status 101)
2026-10-09T08:14:27.050Z INFO  notify   posted result to #tidemark-ci
`
  });

  // A shell session: prompts, commands, output.
  add({
    id: 'shell-session', collection: 'projects', kind: 'terminal',
    path: '~/Code/tidemark/notes/release-session.term', lang: 'term',
    title: 'release-session.term',
    created: '2026-10-09', modified: '2 hours ago',
    status: {},
    src: `ian@eris ~/Code/tidemark % git status --short
 M Cargo.toml
 M src/harmonics/tables/loader.rs
?? logs/build-2026-10-09.log
ian@eris ~/Code/tidemark % cargo test
   Compiling tidemark v0.9.3 (/Users/ian/Code/tidemark)
    Finished test [unoptimized + debuginfo] target(s) in 11.43s
     Running unittests src/lib.rs (target/debug/deps/tidemark-5c1e)

running 20 tests
test harmonics::constituents::m2_period ... ok
test harmonics::tables::loads_gauge_0107 ... ok
test store::roundtrip_entry ... ok
test cli::add_search_remove ... ok

test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured
ian@eris ~/Code/tidemark % git add -A && git commit -m "fix(tables): skip empty height cells"
[main 4be19a2] fix(tables): skip empty height cells
 3 files changed, 14 insertions(+), 3 deletions(-)
ian@eris ~/Code/tidemark % git tag v0.5.0
ian@eris ~/Code/tidemark % git tag --list 'v0.*' | tail -3
v0.3.2
v0.4.0
v0.5.0
ian@eris ~/Code/tidemark % pnpm build
> tidemark-docs@0.5.0 build /Users/ian/Code/tidemark/docs
> vitepress build

vitepress v1.4.1
build complete in 3.82s.
ian@eris ~/Code/tidemark % ls -lh dist | head -4
total 1672
-rw-r--r--  1 ian  staff   212K  9 Oct 08:52 index.html
-rw-r--r--  1 ian  staff   1.1M  9 Oct 08:52 search.json
ian@eris ~/Code/tidemark % git push origin main --tags
Enumerating objects: 9, done.
Writing objects: 100% (7/7), 1.04 KiB | 1.04 MiB/s, done.
To github.com:inkstrata/tidemark.git
   9d3e1a0..4be19a2  main -> main
 * [new tag]         v0.5.0 -> v0.5.0
ian@eris ~/Code/tidemark %
`
  });

  // A paste from Slack with bytes that do not show: a zero width space, a right-to-left override, a no-break space,
  // tabs, trailing spaces, two CRLF lines among LF lines, and no newline at the end.
  add({
    id: 'odd-bytes', collection: 'inbox', kind: 'notes',
    path: '~/Inbox/pasted-from-slack.txt',
    title: 'pasted-from-slack.txt',
    created: '2026-10-10', modified: 'today',
    status: { unread: true },
    src: 'From #db-ops, 09:12\n\nUse \`--link\` for the real run and \`--check\` first.\u200B Then run the\u00A0upgrade on the replica.\r\n\n\t- the old cluster cannot start again   \n\t- keep the snapshot\r\nThe path is /var/lib/postgresql/\u202E16/main\u202C\n\nIf the check passes, flip DNS.   \nNo final newline here'
  });

  G.docs = docs;
  G.doc = (id) => docs.find((d) => d.id === id);

  // Earlier revision of the plan (rev 3): differences drive the version diff demo.
  G.prevVersions['pg16-plan'].src = G.doc('pg16-plan').src
    .replace('Expected downtime is **under 4 minutes**, dominated by the final sync and the DNS flip.', 'Expected downtime is **under 10 minutes**.')
    .replace('| Flip \`db-primary\` DNS | On-call | 0:15 | Flip back |', '| Flip \`db-primary\` DNS | On-call | 0:15 | – |')
    .replace('3. **Disk.** \`--link\` needs little extra space, but the rehearsal showed 9 GB of WAL growth.\n', '')
    .replace('- [ ] Logical replication slot for analytics created\n', '');

  // Metadata-only entries so lists, search and the palette feel like a real library.
  const extra = [
    ['plans', 'report', 'plans/search-relevance-plan.md', 'Plan: search relevance tuning', null, '3 days ago', 2140],
    ['plans', 'report', 'plans/pg16-upgrade-plan.v2.md', 'Postgres 14 → 16 upgrade plan (v2)', null, '1 day ago', 1610, 'dup'],
    ['plans', 'report', 'audits/dependency-licences.md', 'Audit: dependency licences', null, '5 days ago', 3420],
    ['plans', 'report', 'audits/a11y-settings-panel.md', 'Audit: settings panel accessibility', null, '6 days ago', 1880],
    ['plans', 'report', 'handoffs/watcher-debounce.md', 'Handoff: watcher debounce', null, '1 week ago', 960],
    ['plans', 'report', 'research/line-breaking-in-webviews.md', 'Research: line breaking in WebViews', null, '1 week ago', 4120],
    ['plans', 'transcript', 'transcripts/2026-10-05-palette-design.md', 'Transcript: palette design', null, '3 days ago', 5200],
    ['plans', 'transcript', 'transcripts/2026-10-02-tauri-clipboard.md', 'Transcript: Tauri clipboard formats', null, '6 days ago', 3100],
    ['plans', 'report', 'specs/clipboard-ring-spec.md', 'Spec: clipboard ring', null, '4 days ago', 2650],
    ['plans', 'report', 'specs/collection-indexer-spec.md', 'Spec: collection indexer', null, '4 days ago', 3010],
    ['projects', 'code', 'src/watch.rs', 'watch.rs', null, '4 days ago', 610],
    ['projects', 'code', 'src/highlight.rs', 'highlight.rs', null, '1 week ago', 880],
    ['projects', 'code', 'Cargo.toml', 'Cargo.toml', null, '2 weeks ago', 90],
    ['projects', 'docs', 'docs/guide/getting-started.md', 'Getting started', null, '2 weeks ago', 1200],
    ['projects', 'docs', 'docs/api/search.md', 'Index::search', null, '4 days ago', 840],
    ['reading', 'book', 'The Cartographer/01-veyre.md', 'The Cartographer · Chapter 1', null, 'last month', 4800],
    ['reading', 'book', 'The Cartographer/02-the-drawings.md', 'The Cartographer · Chapter 2', null, 'last month', 5100],
    ['reading', 'article', 'measure-and-the-ch-unit.md', 'Measure and the ch unit', null, '1 month ago', 2300],
    ['reading', 'article', 'notes-on-dark-mode.md', 'Notes on dark mode', null, '2 months ago', 1900],
    ['notes', 'notes', '2026-10-07.md', '2026-10-07', null, 'yesterday', 210],
    ['notes', 'notes', '2026-10-06.md', '2026-10-06', null, '2 days ago', 340],
    ['notes', 'notes', 'ideas/marxy-features.md', 'Marxy feature ideas', null, '3 days ago', 1250],
    ['inbox', 'report', 'pg_upgrade-flags.md', 'pg_upgrade flags from Slack', null, 'today', 120],
    ['inbox', 'notes', 'meeting-notes.md', 'Meeting notes', null, 'yesterday', 300]
  ];
  G.library = docs.map((d) => ({
    id: d.id, collection: d.collection, kind: d.kind, path: d.path, title: d.title,
    // Same counting rule as G.stats: no front matter, no code, runs of letters and digits.
    modified: d.modified, words: (d.src.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/```[\s\S]*?```/g, '').match(/[\p{L}\p{N}'’-]+/gu) || []).length,
    status: d.status || {}, hasSrc: true, lang: d.lang && d.kind === 'code' ? G.langId(d.lang) : ['code', 'data'].includes(d.kind) ? G.langOfPath(d.path) : ''
  })).concat(extra.map(([c, k, p, t, _m, mod, w, flag], i) => ({
    id: 'x' + i, collection: c, kind: k,
    path: G.collections.find((x) => x.id === c).path.replace(/ \(.*\)$/, '') + '/' + p,
    title: t, modified: mod, words: w, status: flag === 'dup' ? { duplicateOf: 'pg16-plan' } : {}, hasSrc: false,
    lang: ['code', 'data'].includes(k) ? G.langOfPath(p) : ''
  })));

  /* ---------- Recent: the last documents opened (newest first); app.js persists it ---------- */

  G.recentSeed = ['pg16-plan', 'auth-handoff', 'indexer-rs', 'build-log', 'ragged-right', 'tidemark-readme', 'vector-db', 'notes-1008', 'indexer-chat'];

  /* ---------- File tree: real paths from the library, extra paths, and folders that generate their contents ---------- */

  const rootOf = (coll) => G.collections.find((c) => c.id === coll).path;
  const relOf = (path, coll) => { const r = rootOf(coll); return path.startsWith(r + '/') ? path.slice(r.length + 1) : path.replace(/^~\//, ''); };
  const base = (p) => p.split('/').pop();
  const kindOfName = (name, rel) => {
    if (/^readme\.md$/i.test(name)) return 'readme';
    if (/^changelog\.md$/i.test(name)) return 'changelog';
    if (/\.log$/.test(name)) return 'log';
    if (/\.(term|session)$/.test(name)) return 'terminal';
    if (/\.(csv|tsv|json|jsonl|ya?ml)$/.test(name)) return 'data';
    if (/\.(md|markdown|txt)$/.test(name)) return /(^|\/)(notes?|daily)\//.test(rel) ? 'notes' : /(^|\/)(plans?|audits?|specs?|handoffs?)\//.test(rel) ? 'report' : 'docs';
    return 'code';
  };
  // Paths that exist beyond the library rows. Several levels deep on purpose: tidemark/src/harmonics/tables/fixtures/…
  const TREE_EXTRA = {
    projects: [
      'src/harmonics/mod.rs', 'src/harmonics/constituents.rs', 'src/harmonics/predict.rs',
      'src/harmonics/tables/mod.rs', 'src/harmonics/tables/loader.rs', 'src/harmonics/tables/m2.rs', 'src/harmonics/tables/s2.rs', 'src/harmonics/tables/k1.rs', 'src/harmonics/tables/README.md',
      'src/harmonics/tables/fixtures/gauge-0042.csv', 'src/harmonics/tables/fixtures/gauge-0107.csv',
      'src/store/mod.rs', 'src/store/entry.rs', 'src/cli/main.rs', 'src/cli/search.rs',
      'tests/auth_flow.rs', 'docs/adr/0007-index-store.md', 'logs/build-2026-10-08.log', 'bench/results-warm.csv'
    ],
    marxy: [
      'AGENTS.md', 'README.md', 'mise.toml', 'package.json', 'pnpm-workspace.yaml',
      'docs/adr/0051-pause-the-fleet.md', 'docs/adr/0052-the-spirit.md', 'docs/ci-contract.md', 'docs/scope.md',
      'docs/plan/roadmap-2026-10/README.md', 'docs/plan/roadmap-2026-10/progress.md', 'docs/plan/roadmap-2026-10/00-orchestration.md',
      'docs/plan/direction-2026-10/README.md', 'docs/plan/direction-2026-10/05-plan.md',
      'docs/plan/direction-2026-10/mock-v2/README.md', 'docs/plan/direction-2026-10/mock-v2/FEATURES.md',
      'docs/plan/direction-2026-10/mock-v2/shared/app.js', 'docs/plan/direction-2026-10/mock-v2/shared/app.css', 'docs/plan/direction-2026-10/mock-v2/shared/tokens.css',
      'packages/core/src/contracts/ast.ts', 'packages/core/src/parse.ts', 'packages/core/src/outline.ts',
      'packages/typeset/src/knuth-plass.ts', 'packages/theme/src/tokens.css', 'packages/shell-api/src/index.ts',
      'apps/desktop/src/app.ts', 'apps/desktop/src/view/rendered-view.ts', 'apps/desktop/src/shell/fs.ts', 'apps/desktop/src-tauri/src/main.rs',
      'scripts/check-boundaries.mjs', 'scripts/lead-merge.mjs', 'changelog.d/x-01.md'
    ],
    dotfiles: [
      '.zshrc', '.zshenv', '.zprofile', '.gitconfig', 'Brewfile', 'README.md',
      '.config/mise/config.toml', '.config/nvim/init.lua', '.config/nvim/lua/plugins/lsp.lua', '.config/ghostty/config',
      'bin/audit.sh', 'docs/machine.md'
    ],
    plans: ['archive/2025-q4-roadmap.md', 'archive/2025-q3-retro.md'],
    notes: ['archive/2025-12-31.md', 'ideas/reader-ideas.md'],
    reading: ['Essays/on-margins.md']
  };
  // Folders whose contents are generated on demand, so a tree can be drilled to any depth.
  const TREE_GEN = { projects: ['src/harmonics/tables/fixtures'], marxy: ['docs/archive'], notes: ['archive'], plans: ['archive'], dotfiles: ['.config/archive'], reading: ['Essays'] };
  const GEN_DIRS = ['2024', '2025', 'archive', 'drafts', 'processed', 'raw', 'legacy', 'scratch'];
  const GEN_FILES = {
    projects: (h, i) => 'gauge-' + String(100 + ((h >>> 3) + i * 37) % 900).padStart(4, '0') + '.csv',
    marxy: (h, i) => String(10 + ((h >>> 2) + i * 7) % 40).padStart(4, '0') + '-' + ['reader-pass', 'typeset-notes', 'shell-limits', 'index-format', 'cut-list', 'theme-audit'][(h + i) % 6] + '.md',
    notes: (h, i) => '2025-' + String(1 + ((h >>> 1) + i * 3) % 12).padStart(2, '0') + '-' + String(1 + ((h >>> 4) + i * 5) % 28).padStart(2, '0') + '.md',
    plans: (h, i) => ['plan', 'spec', 'retro', 'audit', 'handoff'][(h + i) % 5] + '-' + ['search', 'indexer', 'palette', 'theme', 'watcher'][(h >>> 2) % 5] + '.md',
    dotfiles: (h, i) => ['alias', 'path', 'prompt', 'keys'][(h + i) % 4] + '.zsh',
    reading: (h, i) => ['on-', 'against-', 'notes-on-'][(h + i) % 3] + ['margins', 'leading', 'ligatures', 'hyphens'][(h >>> 2) % 4] + '.md'
  };
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const treeIndex = {};
  const buildIndex = (coll) => {
    const ix = new Map(); ix.set('', { dirs: new Set(), files: new Map() });
    const put = (rel, e) => {
      const parts = rel.split('/'); let dir = '';
      for (let i = 0; i < parts.length - 1; i++) {
        const next = dir ? dir + '/' + parts[i] : parts[i];
        if (!ix.has(next)) ix.set(next, { dirs: new Set(), files: new Map() });
        ix.get(dir).dirs.add(parts[i]); dir = next;
      }
      ix.get(dir).files.set(parts[parts.length - 1], Object.assign({ name: parts[parts.length - 1], rel }, e));
    };
    const langFor = (k, name) => (['code', 'data'].includes(k) ? G.langOfPath(name) : '');
    G.library.filter((d) => d.collection === coll).forEach((d) => put(relOf(d.path, coll), { id: d.id, kind: d.kind, lang: d.lang || '', unread: !!(d.status && d.status.unread) }));
    (TREE_EXTRA[coll] || []).forEach((rel) => { const name = base(rel); const k = kindOfName(name, rel); put(rel, { id: 't:' + coll + ':' + rel, kind: k, lang: langFor(k, name), unread: hash(rel) % 9 === 0 }); });
    Object.values(G.userDocs || {}).filter((d) => d.collection === coll && d.path).forEach((d) => put(relOf(d.path, coll), { id: d.id, kind: d.kind, lang: d.lang || '', unread: false, fork: !!d.fork, unsaved: !!d.unsaved }));
    return ix;
  };
  G.tree = {
    reset() { Object.keys(treeIndex).forEach((k) => delete treeIndex[k]); },
    // Children of a folder: { dirs: [{name, rel}], files: [{name, rel, id, kind, lang, unread}] }, folders first, both A to Z.
    children(coll, rel = '') {
      const ix = treeIndex[coll] || (treeIndex[coll] = buildIndex(coll));
      const node = ix.get(rel) || { dirs: new Set(), files: new Map() };
      const dirs = new Set(node.dirs); const files = new Map(node.files);
      const zone = (TREE_GEN[coll] || []).find((z) => rel === z || rel.startsWith(z + '/'));
      if (zone) {
        const depth = rel.split('/').length - zone.split('/').length; const h = hash(coll + ':' + rel);
        if (depth < 5) for (let i = 0; i < 1 + (h % 2); i++) dirs.add(GEN_DIRS[(h + i * 3) % GEN_DIRS.length]);
        const gen = GEN_FILES[coll] || GEN_FILES.notes;
        for (let i = 0; i < 3 + (h % 3); i++) {
          const name = gen(h, i);
          if (!files.has(name)) { const frel = rel + '/' + name; const k = kindOfName(name, frel); files.set(name, { name, rel: frel, id: 't:' + coll + ':' + frel, kind: k, lang: ['code', 'data'].includes(k) ? G.langOfPath(name) : '', unread: false }); }
        }
      }
      const by = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
      return {
        dirs: Array.from(dirs).map((name) => ({ name, rel: rel ? rel + '/' + name : name })).sort(by),
        files: Array.from(files.values()).sort(by)
      };
    },
    // The folders above a file, for revealing it in the tree.
    ancestors(path, coll) { const parts = relOf(path, coll).split('/').slice(0, -1); return parts.map((_, i) => parts.slice(0, i + 1).join('/')); },
    rootOf, relOf, kindOfName
  };

  /* ---------- Stand-in documents for files the prototype has no text for (tree files, metadata-only library rows) ---------- */

  const synthCache = {};
  const fakeCsv = (name) => { const h = hash(name); let t = 'time,height_m\n'; for (let i = 0; i < 14; i++) t += '2026-09-' + String(10 + i).padStart(2, '0') + 'T06:00Z,' + (1.2 + ((h >> (i % 8)) % 17) / 10).toFixed(2) + '\n'; return t; };
  const standIn = {
    rust: (n) => '//! Stand-in for ' + n + '. The prototype carries full text for a few files only.\n\nuse crate::store::Store;\n\npub fn load(store: &Store) -> anyhow::Result<usize> {\n    // In the app, Marxy reads this file from disk.\n    Ok(store.len())\n}\n',
    typescript: (n) => '// Stand-in for ' + n + '. The prototype carries full text for a few files only.\nexport function load(path: string): string {\n  // In the app, Marxy reads this file from disk.\n  return path;\n}\n',
    javascript: (n) => '// Stand-in for ' + n + '.\nexport const load = (path) => path;\n',
    python: (n) => '# Stand-in for ' + n + '.\n\n\ndef load(path):\n    # In the app, Marxy reads this file from disk.\n    return path\n',
    shell: (n) => '# Stand-in for ' + n + '\nset -euo pipefail\n\nexport PATH="$HOME/.local/bin:$PATH"\n',
    toml: (n) => '# Stand-in for ' + n + '\n[tools]\nnode = "22"\npython = "3.13"\n',
    yaml: (n) => '# Stand-in for ' + n + '\npackages:\n  - apps/*\n  - packages/*\n',
    json: (n) => '{\n  "name": "' + n + '",\n  "private": true\n}\n'
  };
  const synthSource = (kind, name, lang, path) => {
    if (kind === 'log') return '2026-10-08T21:40:11.002Z INFO  build    stand-in for ' + name + '\n2026-10-08T21:40:12.140Z WARN  rustc    unused variable\n2026-10-08T21:40:19.730Z INFO  build    finished in 17.7 s\n';
    if (kind === 'terminal') return 'ian@eris ~ % echo "stand-in for ' + name + '"\nstand-in for ' + name + '\nian@eris ~ %\n';
    if (kind === 'data') return /\.csv$/.test(name) ? fakeCsv(name) : (standIn[lang] || standIn.json)(name);
    if (kind === 'code') return (standIn[lang] || ((n) => '# Stand-in for ' + n + '\n'))(name);
    const title = name.replace(/\.\w+$/, '').replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
    return '# ' + title + '\n\nThis file is a stand-in. The prototype carries full text for a handful of documents; in the app Marxy reads `' + name + '` from disk, at `' + path + '`.\n\n## Notes\n\n- Open it, split it, copy from it: the reading and source views behave as on any other file.\n- Edits stay in this window; nothing is written to disk.\n';
  };
  G.synthSource = synthSource;
  // A document for a library row or tree file that has no source of its own.
  G.synth = (id) => {
    if (synthCache[id]) return synthCache[id];
    let coll, rel, kind, lang; const meta = G.library.find((d) => d.id === id);
    const m = /^t:([^:]+):(.+)$/.exec(id);
    if (m) { coll = m[1]; rel = m[2]; kind = kindOfName(base(rel), rel); lang = G.langOfPath(rel); }
    else if (meta) { coll = meta.collection; rel = relOf(meta.path, coll); kind = meta.kind; lang = meta.lang || G.langOfPath(rel); }
    else return null;
    if (!G.collections.find((c) => c.id === coll)) return null;
    const name = base(rel); const path = rootOf(coll) + '/' + rel;
    return (synthCache[id] = { id, collection: coll, kind, path, lang: kind === 'code' || kind === 'data' ? lang : undefined, title: meta ? meta.title : name, created: '2026-09-18', modified: meta ? meta.modified : '3 days ago', status: {}, synthetic: true, src: synthSource(kind, name, lang, path) });
  };
})();

