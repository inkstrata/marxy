"""Build the Reader Typography Handbook: src/*.md -> dist/*.html (artifact page bodies).

Conventions in the Markdown sources:
  front matter      slug, number, title (artifact name), short, lede, description, icon, when
  {{A}}..{{X}}      evidence-grade marks
  [^key]            footnotes, rendered as margin notes (tap-to-open on narrow screens)
  !!! rec "Title"   callouts: rec, trap, gap, measured, note
  (@slug) links     cross-artifact links resolved through urls.json
  <!--DATA:name-->  tables generated from the lab's saved measurements
  <!--INCLUDE:path--> file contents inlined verbatim (demo scripts)
"""
import html
import json
import math
import pathlib
import re
import statistics

import markdown

ROOT = pathlib.Path(__file__).resolve().parent
SRC, DIST, TPL = ROOT / "src", ROOT / "dist", ROOT / "template"
LAB = ROOT.parent / "lab"
FONTS_URL = ("https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,200..900;1,7..72,200..900"
             "&family=Atkinson+Hyperlegible+Next:ital,wght@0,200..800;1,200..800"
             "&family=Atkinson+Hyperlegible+Mono:ital,wght@0,200..800;1,200..800&display=swap")
HLJS = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"
GRADES = {
    "A": "Evidence grade A: replicated or meta-analytic findings",
    "B": "Evidence grade B: a single well-designed study",
    "C": "Evidence grade C: small, limited or mixed studies",
    "D": "Evidence grade D: expert convention without direct empirical test",
    "X": "Evidence grade X: contested or contradicted",
}
HANDBOOK = "Reader Typography Handbook"


def read_pages():
    pages = []
    for path in sorted(SRC.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
        meta = {}
        for line in m.group(1).splitlines():
            k, _, v = line.partition(":")
            meta[k.strip()] = v.strip()
        meta["number"] = int(meta["number"])
        meta["body"] = text[m.end():]
        pages.append(meta)
    return sorted(pages, key=lambda p: p["number"])


def load_urls():
    f = ROOT / "urls.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}


# ---------------------------------------------------------------- data tables

def _metrics():
    data = json.loads((LAB / "data" / "metrics.json").read_text(encoding="utf-8"))
    return data, {r["name"]: r for r in data["rows"] if r.get("present")}


def _fmt(v, nd=2):
    return "" if v is None else f"{v:.{nd}f}"


def gen_font_metrics(kind):
    data, rows = _metrics()
    ref = rows["Literata"]["xHeight"]
    cats = {"serif": "serif", "sans": "sans", "mono": "mono"}
    sel = [r for r in rows.values() if (r["source"] == "system") == (kind == "system")]
    if kind in cats:
        sel = [r for r in sel if r["category"] == cats[kind]]
    sel.sort(key=lambda r: r["name"].lower())
    head = ("<tr><th>Family</th>" + ("<th>Kind</th>" if kind == "system" else "") +
            "<th class='num'>x-height</th><th class='num'>Cap height</th><th class='num'>Average character</th>"
            "<th class='num'>Width of 0 (1ch)</th><th class='num'>Characters in 66ch</th>"
            "<th class='num'>Size matching Literata 18px x-height</th><th class='num'>line-height: normal</th><th>Default figures</th></tr>")
    body = []
    for r in sel:
        match = 18 * ref / r["xHeight"]
        body.append(
            "<tr><td>" + html.escape(r["name"]) + "</td>" + (f"<td>{r['category']}</td>" if kind == "system" else "") +
            f"<td class='num'>{_fmt(r['xHeight'], 3)}</td><td class='num'>{_fmt(r['capHeight'], 3)}</td>"
            f"<td class='num'>{_fmt(r['avgCharEm'], 3)}</td><td class='num'>{_fmt(r['chEm'], 3)}</td>"
            f"<td class='num'>{r['charsPer66ch']:.0f}</td><td class='num'>{match:.1f}</td>"
            f"<td class='num'>{_fmt(r['lineHeightNormal'])}</td><td>{r['defaultFigures']}</td></tr>")
    return ("<div class='table-wrap' tabindex='0' role='region' aria-label='Font metrics table'><table>"
            f"<thead>{head}</thead><tbody>{''.join(body)}</tbody></table></div>")


def gen_opsz_table():
    data, rows = _metrics()
    body = []
    for name in ["Source Serif 4", "Inter", "Roboto Serif", "Literata", "Piazzolla", "Newsreader", "Georgia"]:
        r = rows[name]
        a = r["advancePerEm"]
        change = (a[-1] - a[0]) / a[0] * 100
        body.append(f"<tr><td>{html.escape(name)}{' (static control)' if name == 'Georgia' else ''}</td>"
                    + "".join(f"<td class='num'>{v:.2f}</td>" for v in a)
                    + f"<td class='num'>{change:+.1f}%</td><td class='num'>{r['xHeight']:.3f}</td><td class='num'>{r['xHeightAt72']:.3f}</td></tr>")
    head = ("<tr><th>Family</th><th class='num'>12px</th><th class='num'>16px</th><th class='num'>24px</th><th class='num'>48px</th>"
            "<th class='num'>72px</th><th class='num'>12 to 72px</th><th class='num'>x-height at 16px</th><th class='num'>x-height at 72px</th></tr>")
    return ("<div class='table-wrap' tabindex='0' role='region' aria-label='Optical size table'><table>"
            f"<thead>{head}</thead><tbody>{''.join(body)}</tbody></table></div>")


def _lb():
    return json.loads((LAB / "data" / "linebreak.json").read_text(encoding="utf-8"))


def gen_linebreak_justified():
    d = _lb()
    rows = []
    for n in d["measures"]:
        rs = [r for r in d["results"] if r["mode"] == "justified" and r["measure"] == n]
        def m(method, key):
            return statistics.mean(r[method][key] for r in rs)
        rows.append(
            f"<tr><td class='num'>{n}</td>"
            f"<td class='num'>{m('firstFit', 'meanR'):.2f}</td><td class='num'>{m('knuthPlass', 'meanR'):.2f}</td>"
            f"<td class='num'>{m('firstFit', 'veryLoose'):.1f}</td><td class='num'>{m('knuthPlass', 'veryLoose'):.1f}</td>"
            f"<td class='num'>{m('firstFit', 'maxSpaceEm'):.2f}</td><td class='num'>{m('knuthPlass', 'maxSpaceEm'):.2f}</td>"
            f"<td class='num'>{m('firstFit', 'hyphens'):.1f}</td><td class='num'>{m('knuthPlass', 'hyphens'):.1f}</td>"
            f"<td class='num'>{m('firstFit', 'lines'):.1f}</td><td class='num'>{m('knuthPlass', 'lines'):.1f}</td></tr>")
    head = ("<tr><th class='num' rowspan='2'>Target characters per line</th><th colspan='2'>Mean adjustment ratio</th>"
            "<th colspan='2'>Very loose lines per paragraph</th><th colspan='2'>Widest space, em</th>"
            "<th colspan='2'>Hyphens per paragraph</th><th colspan='2'>Lines per paragraph</th></tr>"
            "<tr>" + "<th class='num'>First-fit</th><th class='num'>Total-fit</th>" * 5 + "</tr>")
    return ("<div class='table-wrap' tabindex='0' role='region' aria-label='Justified line-breaking results'><table>"
            f"<thead>{head}</thead><tbody>{''.join(rows)}</tbody></table></div>")


def gen_linebreak_ragged():
    d = _lb()
    rows = []
    for n in d["measures"]:
        rs = [r for r in d["results"] if r["mode"] == "ragged" and r["measure"] == n]
        def m(method, key):
            return statistics.mean(r[method][key] for r in rs)
        rows.append(
            f"<tr><td class='num'>{n}</td>"
            f"<td class='num'>{m('firstFit', 'sdSlackEm'):.2f}</td><td class='num'>{m('knuthPlass', 'sdSlackEm'):.2f}</td><td class='num'>{m('chromePretty', 'sdSlackEm'):.2f}</td>"
            f"<td class='num'>{m('firstFit', 'maxSlackEm'):.2f}</td><td class='num'>{m('knuthPlass', 'maxSlackEm'):.2f}</td><td class='num'>{m('chromePretty', 'maxSlackEm'):.2f}</td>"
            f"<td class='num'>{m('firstFit', 'lastLineFill'):.2f}</td><td class='num'>{m('knuthPlass', 'lastLineFill'):.2f}</td><td class='num'>{m('chromePretty', 'lastLineFill'):.2f}</td></tr>")
    head = ("<tr><th class='num' rowspan='2'>Target characters per line</th><th colspan='3'>Spread of line ends (SD), em</th>"
            "<th colspan='3'>Largest gap at line end, em</th><th colspan='3'>Last-line fill</th></tr>"
            "<tr>" + "<th class='num'>First-fit</th><th class='num'>Total-fit</th><th class='num'>Chromium pretty</th>" * 3 + "</tr>")
    return ("<div class='table-wrap' tabindex='0' role='region' aria-label='Ragged-right line-breaking results'><table>"
            f"<thead>{head}</thead><tbody>{''.join(rows)}</tbody></table></div>")


def gen_pretty_changes():
    d = _lb()
    rows = []
    for r in d["results"]:
        if r["mode"] != "justified" or r["prettyEqualsWrap"]:
            continue
        rows.append(f"<tr><td>{html.escape(r['font'])}</td><td class='num'>{r['measure']}</td><td>{r['text']}</td>"
                    f"<td class='num'>{r['chromeWrap']['lastLineFill']:.2f}</td><td class='num'>{r['chromePretty']['lastLineFill']:.2f}</td>"
                    f"<td class='num'>{r['chromeWrap']['meanR']:.2f}</td><td class='num'>{r['chromePretty']['meanR']:.2f}</td>"
                    f"<td class='num'>{r['knuthPlass']['meanR']:.2f}</td></tr>")
    head = ("<tr><th>Font</th><th class='num'>Characters</th><th>Paragraph</th><th class='num'>Last-line fill, wrap</th>"
            "<th class='num'>Last-line fill, pretty</th><th class='num'>Mean ratio, wrap</th><th class='num'>Mean ratio, pretty</th><th class='num'>Mean ratio, total-fit</th></tr>")
    return ("<div class='table-wrap' tabindex='0' role='region' aria-label='Paragraphs changed by text-wrap pretty'><table>"
            f"<thead>{head}</thead><tbody>{''.join(rows)}</tbody></table></div>")


def gen_linebreak_meta():
    d = _lb()
    ua = re.search(r"Chrome/[\d.]+", d["userAgent"]).group(0).replace("/", " ")
    res = d["results"]
    j = [r for r in res if r["mode"] == "justified"]
    same_ff = sum(r["wrapEqualsFirstFit"] for r in res)
    pretty_changed = sum(not r["prettyEqualsWrap"] for r in j)
    passes = {}
    for r in j:
        passes[r["kpPass"]] = passes.get(r["kpPass"], 0) + 1
    return json.dumps({"engine": ua, "configs": len(res), "sameAsFirstFit": same_ff, "prettyChanged": pretty_changed,
                       "justified": len(j), "passes": passes})


def gen_theme_contrast():
    rows = json.loads((ROOT / "data" / "themes.json").read_text(encoding="utf-8"))
    keys = [("fg", "Text"), ("comment", "Comment"), ("string", "String"), ("keyword", "Keyword"),
            ("function", "Function"), ("number", "Number"), ("type", "Type")]
    body = []
    for r in rows:
        cells = []
        for k, _ in keys:
            v = r["ratios"][k]
            fail = v < 4.5
            # Each ratio is drawn in the token's own colour on the theme's background; failure is also spelled out.
            cells.append(f"<td class='num'><span class='swatch{' fail' if fail else ''}' style='background:{r['bg']};color:{r['colors'][k]}'>"
                         f"{v:.2f}</span>{'<span class=\"fail-note\"> below AA</span>' if fail else ''}</td>")
        body.append(f"<tr><td>{html.escape(r['name'])}</td><td>{r['mode']}</td>{''.join(cells)}</tr>")
    head = "<tr><th>Theme</th><th>Mode</th>" + "".join(f"<th class='num'>{t}</th>" for _, t in keys) + "</tr>"
    return ("<div class='table-wrap' tabindex='0' role='region' aria-label='Code theme contrast ratios'><table class='theme-table'>"
            f"<thead>{head}</thead><tbody>{''.join(body)}</tbody></table></div>")


GENERATORS = {
    "theme-contrast": gen_theme_contrast,
    "font-metrics-serif": lambda: gen_font_metrics("serif"),
    "font-metrics-sans": lambda: gen_font_metrics("sans"),
    "font-metrics-mono": lambda: gen_font_metrics("mono"),
    "font-metrics-system": lambda: gen_font_metrics("system"),
    "opsz-table": gen_opsz_table,
    "linebreak-justified": gen_linebreak_justified,
    "linebreak-ragged": gen_linebreak_ragged,
    "pretty-changes": gen_pretty_changes,
}


# ---------------------------------------------------------------- transforms

def sidenotes(h):
    m = re.search(r'<div class="footnote">.*</div>\s*$', h, re.S)
    if not m:
        return h
    block, h = m.group(0), h[:m.start()]
    notes = {}
    for li in re.finditer(r'<li id="fn:([^"]+)">(.*?)</li>', block, re.S):
        content = re.sub(r'<a class="footnote-backref"[^>]*>.*?</a>', "", li.group(2), flags=re.S).replace("&#160;", " ")
        paras = re.findall(r"<p>(.*?)</p>", content, re.S) or [content]
        notes[li.group(1)] = "<br>".join(p.strip() for p in paras)
    seen = set()

    def rep(mm):
        key, num = mm.group(1), mm.group(2)
        if key in seen:
            return f'<span class="sn-ref">{num}</span>'
        seen.add(key)
        sid = "sn-" + re.sub(r"[^A-Za-z0-9_-]", "-", key)
        return (f'<input type="checkbox" id="{sid}" class="sn-toggle" aria-label="Show note {num}">'
                f'<label for="{sid}" class="sn-ref">{num}</label>'
                f'<span class="sidenote" role="note"><span class="sn-no">{num}</span>{notes.get(key, "")}</span>')

    return re.sub(r'<sup id="fnref\d*:([^"]+)"><a class="footnote-ref" href="#fn:[^"]+"[^>]*>(\d+)</a></sup>', rep, h)


def outside_code(h, fn):
    parts = re.split(r"(<pre[\s\S]*?</pre>|<code[\s\S]*?</code>|<script[\s\S]*?</script>)", h)
    for i in range(0, len(parts), 2):
        parts[i] = fn(parts[i])
    return "".join(parts)


def grades(h):
    return outside_code(h, lambda s: re.sub(
        r"\{\{([ABCDX])\}\}",
        lambda m: f'<abbr class="grade" data-g="{m.group(1)}" title="{GRADES[m.group(1)]}">{m.group(1)}</abbr>', s))


def resolve_links(h, urls, pages):
    by_slug = {p["slug"]: p for p in pages}

    def rep(m):
        slug, frag = m.group(1), m.group(2) or ""
        if slug not in by_slug:
            raise SystemExit(f"unknown cross-link @{slug}")
        return f'href="{urls.get(slug, "#")}{frag if slug in urls else ""}"'
    return re.sub(r'href="@([a-z0-9-]+)(#[A-Za-z0-9_.~-]+)?"', rep, h)


def number_sections(h, number, toc_tokens):
    entries = []
    n = [0]

    def rep(m):
        n[0] += 1
        label = f"{number}.{n[0]}"
        entries.append((m.group(1), label, re.sub(r"<[^>]+>", "", m.group(2))))
        return f'<h2 id="{m.group(1)}"><span class="sec-no">{label}</span>{m.group(2)}</h2>'
    h = re.sub(r'<h2 id="([^"]+)">(.*?)</h2>', rep, h)
    return h, entries


def convert(page, urls, pages):
    md = markdown.Markdown(
        extensions=["extra", "admonition", "toc", "smarty", "sane_lists"],
        extension_configs={"toc": {"toc_depth": "2-3"}, "smarty": {"smart_angled_quotes": False}},
    )
    body = md.convert(page["body"])
    body = sidenotes(body)
    body = grades(body)
    body = body.replace("<table>", '<div class="table-wrap" tabindex="0" role="region" aria-label="Scrollable table"><table>')
    body = body.replace("</table>", "</table></div>")
    body = body.replace("<pre><code>", '<pre tabindex="0"><code class="language-plaintext">').replace("<pre><code ", '<pre tabindex="0"><code ')
    body = re.sub(r"<!--DATA:([a-z0-9-]+)-->", lambda m: GENERATORS[m.group(1)](), body)
    for _ in range(3):  # includes may contain includes (the demo pulls in kp.js)
        body = re.sub(r"<!--INCLUDE:([^>]+?)-->", lambda m: (ROOT / m.group(1).strip()).read_text(encoding="utf-8"), body)
    body = resolve_links(body, urls, pages)
    entries = []
    if page["number"] > 0:
        body, entries = number_sections(body, page["number"], md.toc_tokens)
    return body, entries


# ---------------------------------------------------------------- template

SETTINGS_PANEL = """<details class="reader-settings">
<summary aria-label="Reading settings">Aa&#8202; Reading settings</summary>
<div class="reader-panel" role="group" aria-label="Reading settings">
<label for="rs-size"><span class="row">Text size <output id="rs-size-out" for="rs-size"></output></span><input id="rs-size" type="range" min="15" max="26" step="1"></label>
<label for="rs-leading"><span class="row">Line spacing <output id="rs-leading-out" for="rs-leading"></output></span><input id="rs-leading" type="range" min="1.3" max="2" step="0.05"></label>
<label for="rs-measure">Line length<select id="rs-measure"><option value="narrow">Narrow, about 55 characters</option><option value="standard">Standard, about 66 characters</option><option value="wide">Wide, about 75 characters</option></select></label>
<label for="rs-face">Typeface<select id="rs-face"><option value="serif">Literata (serif)</option><option value="sans">Atkinson Hyperlegible Next (sans)</option><option value="system-serif">System serif</option><option value="system-sans">System sans</option></select></label>
<label for="rs-align">Alignment<select id="rs-align"><option value="ragged">Ragged right</option><option value="justify">Justified</option></select></label>
<label for="rs-theme">Theme<select id="rs-theme"><option value="auto">Follow the viewer</option><option value="dark">Dark</option><option value="light">Light</option></select></label>
<p class="hint">Kept in this browser only. The Reader Typography Spec explains each default and range.</p>
<button id="rs-reset" type="button">Restore defaults</button>
</div>
</details>"""


def link(pages, urls, slug, text, current=False):
    if slug in urls:
        cur = ' aria-current="page"' if current else ""
        return f'<a href="{urls[slug]}"{cur}>{text}</a>'
    return f"<span>{text}</span>"


def chapter_map(pages, urls):
    items = []
    for p in pages:
        if p["number"] == 0:
            continue
        title = html.escape(p["title"])
        t = link(pages, urls, p["slug"], title)
        items.append(f'<li><span class="no">{p["number"]:02d}</span><div><div class="t">{t}</div>'
                     f'<div class="d">{html.escape(p["description"])}</div>'
                     + (f'<div class="q">Start here if {html.escape(p["when"])}</div>' if p.get("when") else "")
                     + "</div></li>")
    return '<ol class="chapter-map">' + "".join(items) + "</ol>"


def render(page, pages, urls):
    body, entries = convert(page, urls, pages)
    body = body.replace("<!--CHAPTER-MAP-->", chapter_map(pages, urls))
    css = (TPL / "base.css").read_text(encoding="utf-8")
    js = (TPL / "base.js").read_text(encoding="utf-8")
    chapters = [p for p in pages if p["number"] > 0]
    idx = next((i for i, p in enumerate(chapters) if p["slug"] == page["slug"]), None)
    hub = next(p for p in pages if p["number"] == 0)
    has_code = bool(re.search(r'class="language-(?!plaintext)', body))

    if page["number"] == 0:
        eyebrow = "Orientation"
        home = f'<span class="home">{HANDBOOK}</span>'
    else:
        eyebrow = f"Chapter {page['number']} of {len(chapters)} &middot; {html.escape(page['short'])}"
        home = link(pages, urls, hub["slug"], HANDBOOK).replace("<a ", '<a class="home" ').replace("<span>", '<span class="home">')

    contents = ""
    if entries:
        lis = "".join(f'<li><a href="#{i}"><span class="sec-no">{lab}</span>{html.escape(html.unescape(t))}</a></li>' for i, lab, t in entries)
        contents = f'<nav class="contents" aria-label="Contents"><details open><summary>Contents</summary><ol>{lis}</ol></details></nav>'

    pager = ""
    if idx is not None:
        prev_p = chapters[idx - 1] if idx > 0 else hub
        next_p = chapters[idx + 1] if idx + 1 < len(chapters) else None
        pv = (f'<a class="prev" href="{urls[prev_p["slug"]]}"><span class="dir">Previous</span>{html.escape(prev_p["title"])}</a>'
              if prev_p["slug"] in urls else "")
        nx = (f'<a class="next" href="{urls[next_p["slug"]]}"><span class="dir">Next</span>{html.escape(next_p["title"])}</a>'
              if next_p and next_p["slug"] in urls else "")
        pager = f'<div class="pager">{pv}{nx}</div>'
    elif chapters and chapters[0]["slug"] in urls:
        pager = (f'<div class="pager"><a class="next" href="{urls[chapters[0]["slug"]]}"><span class="dir">Begin</span>'
                 f'{html.escape(chapters[0]["title"])}</a></div>')
    index = " &middot; ".join(
        link(pages, urls, p["slug"], f'{p["number"]:02d} {html.escape(p["short"])}' if p["number"] else "Orientation", p["slug"] == page["slug"])
        for p in pages)

    out = f"""<title>{html.escape(page['title'])}</title>
<meta name="description" content="{html.escape(page['description'])}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS_URL}">
<style>
{css}
</style>
<header class="masthead" lang="en">{home}<nav aria-label="Handbook">{SETTINGS_PANEL}</nav></header>
<header class="chapter-head" lang="en">
<p class="eyebrow">{eyebrow}</p>
<h1>{html.escape(page.get('h1', page['title']))}</h1>
<p class="lede">{page['lede']}</p>
<p class="colophon" id="colophon"><span data-k="face">Set in <b>Literata</b></span><span data-k="size"></span><span data-k="measure"></span><span data-k="align">ragged right, hyphenated</span><span data-k="theme"></span></p>
</header>
{contents}
<main class="article" id="main" lang="en">
{body}
</main>
<footer class="chapter-foot" lang="en">
{pager}
<p class="index">{index}</p>
<p class="fine">Researched and written in September 2026. Every empirical claim carries an evidence grade (A strongest, D convention, X contested) and a source in the margin; the Typography Source Ledger lists them all with notes on quality. Original measurements were taken in Chromium 152 on Windows 11 and are described where they are used.</p>
</footer>
{f'<script src="{HLJS}"></script>' if has_code else ''}
<script>
{js}
</script>
"""
    return out


def main():
    pages = read_pages()
    urls = load_urls()
    # site/ is the locally browsable copy: same pages, links rewritten to sibling files, orientation as index.html.
    local = {p["slug"]: ("index.html" if p["number"] == 0 else f"{p['number']:02d}-{p['slug']}.html") for p in pages}
    DIST.mkdir(exist_ok=True)
    site = ROOT / "site"
    site.mkdir(exist_ok=True)
    for p in pages:
        name = f"{p['number']:02d}-{p['slug']}.html"
        out = render(p, pages, urls)
        (DIST / name).write_text(out, encoding="utf-8")
        # The artifact host supplies the document shell (and standards mode) at publish time; locally we add it.
        shell = ('<!doctype html><html><head><meta charset="utf-8">'
                 '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
                 '</head><body>{}</body></html>')
        (site / local[p["slug"]]).write_text(shell.format(render(p, pages, local)), encoding="utf-8")
        text = re.sub(r"<(style|script)[\s\S]*?</\1>", " ", out)
        words = len(re.sub(r"<[^>]+>", " ", text).split())
        print(f"{p['number']:02d} {p['slug']:<28} {len(out) // 1024:>5} KB  ~{words} words")


if __name__ == "__main__":
    main()
