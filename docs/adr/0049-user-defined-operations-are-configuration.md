# ADR-0049 — User-defined operations are configuration, not plugins

- **Status:** accepted (author, 2026-10-02); recorded now, not scheduled
- **Date:** 2026-10-02
- **Amends:** ADR-0004's "no shell-pipe or scripting surface, now or in v1.1". The security argument
  in ADR-0004 and ADR-0009 about documents causing execution stands, absolutely.
- **Evidence:** `docs/research/audit-2026-10/10-overfit-decisions.md` §4.

## Context

The spirit says the user is a first-class owner of their tools. ADR-0004 forbids a plugin API or a
scripting surface, and gives a reason that is about documents: a scripting surface would break the
no-execution posture, and an operation, unlike a theme, can corrupt a file. That reason does not
cover the reader configuring an operation of their own. The two are different trust relations. A
document is untrusted input. `config.toml` is the reader's own file, in their own home directory,
read at startup like `external_editor` (D-A31, `docs/design/00-architecture.md`).

This ADR does not schedule the feature. It records the shape so the operation contract is not
designed to forbid it.

## Decision

1. **A user-defined operation is a line in `config.toml`** naming a command and a title, for
   example `[[operation]] title = "Sort lines" run = "sort"`. Nothing else is configurable: no
   hooks, no events, no access to the AST, no network, no files.
2. **The command receives the selected bytes on stdin and returns replacement bytes on stdout.**
   It runs with no shell and no interpolation: the `run` string is split on whitespace into an
   argument vector and executed directly, the rule D-A31 already states for `external_editor`.
   `sh -c` is something the reader may write on purpose in `run`; Marxy never adds it.
3. **It is `string → string`.** It is not an `Operation` of `packages/core`, whose `run` is
   synchronous and pure (`packages/core/src/contracts/operation.ts`). The process spawn is privileged
   work, so it lives behind `packages/shell-api` (ADR-0020 keeps core free of Node built-ins), and its
   result becomes a `Splice` on the same path as every other edit (ADR-0037 `apply`). Whether an
   async variant of the contract is cleaner is for the story that schedules this, an ordinary pull
   request under ADR-0045.
4. **A bad run changes nothing.** A non-zero exit, a timeout (10 s), output over a fixed limit, or
   output that is not valid UTF-8 leaves the buffer as it was and shows one notice with the first
   line of stderr.
5. **It is tested by the fidelity property.** The shell-side runner is tested against fixture
   commands; the splice is the existing path, and `pnpm gate:fidelity` already asserts that nothing
   outside the range changes.
6. **Nothing in a document ever runs anything.** A document cannot declare, name, trigger or
   discover an operation. A config line is the only source, and it is edited by the reader.

## Consequences

- Adding the feature later is a config key, a shell command, one capability in
  `apps/desktop/src-tauri/capabilities/default.json`, and a palette listing. The splice path is unchanged.
- A reader can break their own data with `rm`. That is ownership; the undo path still restores the
  buffer, but not a side effect outside it.
- The security audit surface gains one spawn function, reached only from a config line.
- Not for the next release. The only work now is this record, and keeping the operation contract
  permissive enough (ADR-0045 makes that easy).

## Rejected

- **A plugin API with JavaScript.** It runs inside the webview and invites documents to reach it.
- **Run the command through a shell by default.** Interpolation of selected text into a command
  line is the injection route; stdin is not.
- **Never allow it.** The reader's own tools are the point.

## How we would know this was wrong

1. A reader reports a document that caused a command to run: item 6 was broken somewhere, and the
   feature is withdrawn first and explained second.
2. The config grows `env`, `cwd` or `when` keys: it has become a scripting language. Stop at stdin
   and stdout.
