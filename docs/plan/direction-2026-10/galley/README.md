# Galley reference copies

Unmodified copies of three files from the Galley interface prototype (kept by the author in
`~/Dev/marxy-design/reader-app-prototype/`), so that this direction can cite them without pointing
outside the repository ("no rotting paths", AGENTS.md). The prototype calls the product Galley and
frames it as AI-first; these files are reference material for the look, not a specification.

| File | What it is | Used by |
| --- | --- | --- |
| [tokens.css](tokens.css) | Eight audited themes, five type sets, per-kind typography | Phase H (token contract v2, the ported themes) |
| [TYPOGRAPHY.md](TYPOGRAPHY.md) | Typography per content type, coupling rules, contrast results | Phase K (profiles), Studio › Look (coupling rules) |
| [audit_contrast.py](audit_contrast.py) | WCAG contrast audit of every theme | H-02 (`scripts/gate-contrast.mjs`) |

Nothing here is built, linted or run by CI.
