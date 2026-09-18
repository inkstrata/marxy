<!-- Fixture corpus the gates sweep. Bytes of an existing file are frozen: extend by appending. -->

# Fixture corpus

The files the golden AST gate, the no-network gate and the fidelity property run over. Reading is
what they are for: a README, an AI plan, source, prose, and a hostile document that must not fetch
or execute. None of them are written in marxy.

An existing fixture is frozen. Changing a byte moves every later provenance range and every golden
that cites it, so a new family of cases is appended, or a new numbered file is added. `10-hostile.md`
is the attack-vector document: each family is a labelled section so the corpus sweep, not a probe
string inside a test, is what watches it.

| File | Why it is here |
| --- | --- |
| `01-long-technical.md` | Long technical prose with tables and code, the taste-review document |
| `02-readme-real-world.md` | A badge-heavy project README |
| `03-ai-plan.md` | An AI/agent artifact |
| `04-source.*` | Source files treated as first-class reading |
| `05-pathological-table-and-nesting.md` | Nesting and tables that stress the parser |
| `06-math.md` | Math blocks |
| `07-cjk.md` | CJK text |
| `08-rtl.md` | Right-to-left text |
| `09-gfm-everything.md` | GitHub-flavoured markdown, one of each construct |
| `10-hostile.md` | Attack vectors. Append only. Sections include srcdoc, formaction, srcset, poster, MathML, base, template, a namespaced element, a double-encoded javascript scheme, the backslash-authority image and the self-closing anchor |
| `12-crlf-and-bom.md` | A byte-order mark and Windows line endings |
| `13-no-trailing-newline.md` | A file that does not end in a newline |
| `14-marxy-plan.md` | The project's own plan, as a real document |
