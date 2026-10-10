"""Audit every Marxy theme in shared/tokens.css against WCAG 2.2 contrast thresholds.

Usage: python audit_contrast.py [--md]
Exit code 1 if any pair fails. --md prints a Markdown table for the themes doc.
Ratios are not rounded before comparison (4.499 fails, per Understanding 1.4.3).
"""
import re
import sys
from pathlib import Path

CSS = Path(__file__).resolve().parent.parent / "shared" / "tokens.css"

# (foreground, [surfaces], minimum)
CHECKS = [
    ("fg", ["doc"], 7.0),
    ("fg", ["inset", "raised", "side", "win"], 4.5),
    ("fg-strong", ["doc"], 7.0),
    ("fg-muted", ["doc", "inset", "raised", "side", "win"], 4.5),
    ("fg-faint", ["doc", "raised", "side", "win"], 4.5),
    ("accent", ["doc", "raised", "side"], 4.5),
    ("accent-fg", ["accent"], 4.5),
    ("ok", ["doc", "raised"], 4.5),
    ("warn", ["doc", "raised"], 4.5),
    ("err", ["doc", "raised"], 4.5),
    ("info", ["doc", "raised"], 4.5),
    ("tk-comment", ["inset", "doc", "sel@inset"], 4.5),
    ("tk-keyword", ["inset", "doc", "sel@inset"], 4.5),
    ("tk-string", ["inset", "doc", "sel@inset"], 4.5),
    ("tk-constant", ["inset", "doc", "sel@inset"], 4.5),
    ("tk-def", ["inset", "doc", "sel@inset"], 4.5),
    ("tk-type", ["inset", "doc", "sel@inset"], 4.5),
    ("tk-marker", ["doc", "inset"], 4.5),
    ("tk-punct", ["doc", "inset"], 4.5),
    ("tk-heading", ["doc", "inset"], 4.5),
    ("tk-link", ["doc", "inset"], 4.5),
    ("fg", ["sel@doc", "mark@doc", "accent-wash-strong@side"], 4.5),
    ("edge", ["doc", "raised", "side", "win"], 3.0),
]

SUMMARY_ROWS = [
    ("Body text", "fg", "doc"),
    ("Secondary text", "fg-muted", "doc"),
    ("Faint labels", "fg-faint", "side"),
    ("Accent / links", "accent", "doc"),
    ("Lowest code token", None, "inset"),
    ("Control edge", "edge", "doc"),
]


def parse(css):
    themes = {}
    for m in re.finditer(r'(?:^|\n)([^{}\n]*\[data-theme="([\w-]+)"\][^{]*)\{([^}]*)\}', css):
        name, body = m.group(2), m.group(3)
        props = dict(re.findall(r"--([\w-]+):\s*([^;]+);", body))
        themes[name] = props
    return themes


def rgba(value):
    value = value.strip()
    if value.startswith("#"):
        h = value[1:]
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (1.0,)
    m = re.match(r"rgba?\(([^)]+)\)", value)
    if m:
        parts = [p.strip() for p in m.group(1).split(",")]
        r, g, b = (float(p) for p in parts[:3])
        a = float(parts[3]) if len(parts) > 3 else 1.0
        return (r, g, b, a)
    raise ValueError(value)


def over(top, bottom):
    a = top[3]
    return tuple(top[i] * a + bottom[i] * (1 - a) for i in range(3)) + (1.0,)


def lum(c):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(x) for x in c[:3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def surface(props, spec):
    if "@" in spec:
        top, base = spec.split("@")
        return over(rgba(props[top]), rgba(props[base]))
    return rgba(props[spec])


def main():
    themes = parse(CSS.read_text(encoding="utf-8"))
    failures = []
    table = {}
    for name, props in themes.items():
        table[name] = {}
        for fg, surfaces, minimum in CHECKS:
            for s in surfaces:
                r = ratio(rgba(props[fg]), surface(props, s))
                table[name][(fg, s)] = r
                if r < minimum:
                    failures.append(f"{name}: --{fg} on {s} = {r:.2f} (< {minimum})")
    if "--md" in sys.argv:
        names = list(themes)
        print("| Role | " + " | ".join(names) + " |")
        print("|---|" + "---|" * len(names))
        for label, fg, s in SUMMARY_ROWS:
            cells = []
            for n in names:
                if fg is None:
                    toks = [k for k in table[n] if k[0].startswith("tk-") and k[1] == s and k[0] != "tk-marker"]
                    v = min(table[n][k] for k in toks)
                else:
                    v = table[n][(fg, s)]
                cells.append(f"{v:.1f}")
            print(f"| {label} | " + " | ".join(cells) + " |")
    else:
        for n in themes:
            body = table[n][("fg", "doc")]
            low_tok = min(v for k, v in table[n].items() if k[0].startswith("tk-") and k[0] != "tk-marker" and k[1] == "inset")
            print(f"{n:9s} body {body:5.2f}  lowest token {low_tok:5.2f}  edge {table[n][('edge', 'doc')]:4.2f}")
    if failures:
        print("\nFAILURES", file=sys.stderr)
        for f in failures:
            print("  " + f, file=sys.stderr)
        sys.exit(1)
    print(f"\nAll {len(themes)} themes pass.", file=sys.stderr)


if __name__ == "__main__":
    main()
