# Marxy

A markdown **reader**. Free and open source, quiet, fast, and set like a book.

Reading markdown in existing tools feels wrong: every one of them is a writing tool
with a preview pane bolted on. Marxy is the other thing — a very fast document opener
with an index you can flip through instantly, typography that owns its own line
breaking, code and AI artifacts as first-class content, and operations that let you
act on what you read without turning it into an editor.

**Promises, enforced in CI, not aspired to:**

- Never touches a byte you did not ask it to change.
- No telemetry. Nothing phones home. Themes cannot make network requests; remote
  images stay blocked until you allow them for a document.
- MIT, the whole tree. Bundled typefaces are OFL 1.1.

Status: pre-v1. See [`docs/plan.md`](docs/plan.md) and [`AGENTS.md`](AGENTS.md).

## Layout

```
apps/desktop        the desktop shell (Tauri) and app UI
packages/core       parse → AST with byte provenance, sanitise, outline, operations, index
packages/typeset    Knuth–Plass, hanging punctuation, baseline grid
packages/theme      default theme and the --marxy-* contract
packages/shell-api  the privileged-operation interface
fixtures/corpus     the documents every gate runs on
docs/               brief, design language, ADRs, plan, scope
```

## Building

Toolchain versions come from `mise.toml`.

```bash
mise install && pnpm install && pnpm build
```

## Licence

MIT (see `LICENSE`). `fonts/` and the KaTeX fonts are SIL OFL 1.1, isolated with their
own licence files. Third-party notices are generated into `THIRD_PARTY_NOTICES.md`.
