"""Build Uptick founder documents in the house style of the existing packet.

Reuses the packet's styles.xml, theme, numbering, header and footer so every
document looks like it came from the same set, then substitutes a generated
word/document.xml.
"""
import os, re, shutil, subprocess, sys

TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "template")
DARK, ZEBRA, CALLOUT, GREY = "123D45", "F2F5F5", "E6F2ED", "54636A"
FONT = '<w:rFonts w:ascii="Noto Sans" w:hAnsi="Noto Sans"/>'
CONTENT_W = 10224  # 12240 page - 1008 left - 1008 right

def esc(t):
    return (str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))

def runs(text, bold=False, color=None, sz="19", font=True):
    rpr = "<w:rPr>"
    if font: rpr += FONT
    if bold: rpr += "<w:b/>"
    if color: rpr += f'<w:color w:val="{color}"/>'
    rpr += f'<w:sz w:val="{sz}"/></w:rPr>'
    parts = str(text).split("\n")
    out = ""
    for i, part in enumerate(parts):
        if i: out += "<w:br/>"
        out += f'<w:t xml:space="preserve">{esc(part)}</w:t>'
    return f"<w:r>{rpr}{out}</w:r>"

def eyebrow(text):
    return ('<w:p><w:pPr><w:spacing w:after="140"/></w:pPr>'
            + runs(text, color=GREY, sz="18", font=False) + "</w:p>")

def title(text):
    body = "<w:br/>".join(f'<w:t xml:space="preserve">{esc(p)}</w:t>' for p in text.split("\n"))
    return f'<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r>{body}</w:r></w:p>'

def lead(text):
    return ('<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>'
            + runs(text, sz="24", font=False) + "</w:p>")

def callout(text):
    return ('<w:p><w:pPr><w:spacing w:after="200" w:before="100"/>'
            f'<w:shd w:fill="{CALLOUT}"/><w:ind w:left="140" w:right="140"/></w:pPr>'
            + runs(text, bold=True, font=False) + "</w:p>")

def h1(text):
    return ('<w:p><w:pPr><w:pStyle w:val="Heading1"/>'
            '<w:spacing w:before="0" w:after="120"/></w:pPr>'
            f'<w:r><w:t>{esc(text)}</w:t></w:r></w:p>')

def h2(text):
    return ('<w:p><w:pPr><w:pStyle w:val="Heading2"/>'
            '<w:spacing w:before="200" w:after="80"/></w:pPr>'
            f'<w:r><w:t>{esc(text)}</w:t></w:r></w:p>')

def para(text, bold=False):
    return ('<w:p><w:pPr><w:spacing w:after="120" w:line="250" w:lineRule="auto"/></w:pPr>'
            + runs(text, bold=bold) + "</w:p>")

def bullet(text):
    return ('<w:p><w:pPr><w:spacing w:after="60" w:line="250" w:lineRule="auto"/>'
            '<w:ind w:left="260" w:hanging="180"/></w:pPr>'
            + runs("•  " + str(text)) + "</w:p>")

def note(text):
    return ('<w:p><w:pPr><w:spacing w:after="160" w:line="250" w:lineRule="auto"/></w:pPr>'
            + runs(text, color=GREY, sz="18") + "</w:p>")

def pagebreak():
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

def _cell(text, w, fill, bold=False, color=None):
    shd = f'<w:shd w:fill="{fill}"/>' if fill else ""
    return (f'<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="{w}"/>{shd}<w:vAlign w:val="center"/>'
            '<w:tcMar><w:top w:w="75" w:type="dxa"/><w:left w:w="95" w:type="dxa"/>'
            '<w:bottom w:w="75" w:type="dxa"/><w:right w:w="95" w:type="dxa"/></w:tcMar></w:tcPr>'
            '<w:p><w:pPr><w:spacing w:after="40" w:before="0" w:line="250" w:lineRule="auto"/></w:pPr>'
            + runs(text, bold=bold, color=color) + "</w:p></w:tc>")

def table(header, rows, widths):
    total = sum(widths)
    widths = [round(w * CONTENT_W / total) for w in widths]
    widths[-1] = CONTENT_W - sum(widths[:-1])
    grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths)
    out = ('<w:tbl><w:tblPr><w:tblW w:type="auto" w:w="0"/><w:jc w:val="center"/>'
           '<w:tblLayout w:type="fixed"/><w:tblLook w:firstColumn="1" w:firstRow="1" '
           'w:lastColumn="0" w:lastRow="0" w:noHBand="0" w:noVBand="1" w:val="04A0"/></w:tblPr>'
           f"<w:tblGrid>{grid}</w:tblGrid>")
    out += '<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>'
    for text, w in zip(header, widths):
        out += _cell(text, w, DARK, bold=True, color="FFFFFF")
    out += "</w:tr>"
    for i, row in enumerate(rows):
        fill = ZEBRA if i % 2 == 0 else None
        out += '<w:tr><w:trPr><w:cantSplit/></w:trPr>'
        for j, (text, w) in enumerate(zip(row, widths)):
            out += _cell(text, w, fill, bold=(j == 0 and len(row) > 1 and False))
        out += "</w:tr>"
    return out + "</w:tbl>" + '<w:p><w:pPr><w:spacing w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>'

SECTPR = ('<w:sectPr><w:headerReference w:type="default" r:id="rId9"/>'
          '<w:footerReference w:type="default" r:id="rId10"/>'
          '<w:pgSz w:w="12240" w:h="15840"/>'
          '<w:pgMar w:top="936" w:right="1008" w:bottom="936" w:left="1008" '
          'w:header="374" w:footer="389" w:gutter="0"/>'
          '<w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>')

def set_chrome(workdir, header_text=None, footer_text=None):
    """Rewrite header/footer wording. The header has two runs: the brand and a
    grey qualifier; only the qualifier changes so every document stays branded."""
    import re as _re

    def _sub_nth(path, n, value):
        x = open(path, encoding="utf-8").read()
        hits = list(_re.finditer(r"(<w:t[^>]*>)([^<]*)(</w:t>)", x))
        if n >= len(hits):
            return
        m = hits[n]
        x = x[: m.start()] + m.group(1) + esc(value) + m.group(3) + x[m.end():]
        open(path, "w", encoding="utf-8").write(x)

    if header_text is not None:
        _sub_nth(os.path.join(workdir, "word", "header1.xml"), 1, "  /  " + header_text)
    if footer_text is not None:
        _sub_nth(os.path.join(workdir, "word", "footer1.xml"), 0, footer_text)


def build(blocks, out_path, workdir, header_text=None, footer_text=None):
    src = open(os.path.join(TEMPLATE, "word", "document.xml"), encoding="utf-8").read()
    head = src[: src.index("<w:body>") + len("<w:body>")]
    if os.path.exists(workdir): shutil.rmtree(workdir)
    shutil.copytree(TEMPLATE, workdir)
    xml = head + "".join(blocks) + SECTPR + "</w:body></w:document>"
    with open(os.path.join(workdir, "word", "document.xml"), "w", encoding="utf-8") as f:
        f.write(xml)
    set_chrome(workdir, header_text, footer_text)
    if os.path.exists(out_path): os.remove(out_path)
    subprocess.run(["zip", "-Xqr", out_path, "."], cwd=workdir, check=True)
    return out_path

def to_pdf(docx_path, outdir):
    env = dict(os.environ, HOME="/tmp")
    subprocess.run(["soffice", "-env:UserInstallation=file:///tmp/lo3", "--headless",
                    "--norestore", "--convert-to", "pdf", docx_path, "--outdir", outdir],
                   check=True, capture_output=True, env=env)
    return os.path.join(outdir, os.path.basename(docx_path).replace(".docx", ".pdf"))

def render(pdf_path, prefix):
    import pypdfium2 as p
    d = p.PdfDocument(pdf_path)
    paths = []
    for i in range(len(d)):
        q = f"{prefix}-{i+1:02d}.png"
        d[i].render(scale=1.5).to_pil().save(q)
        paths.append(q)
    return paths


# ---------------------------------------------------------------- visual kit
ACCENT = "1F7A5C"   # uptick green
AMBER  = "FDF3E3"
AMBER_EDGE = "B9772A"
INK    = "12211F"
RULE   = "D8E0DE"

def _tbl(grid_widths, rows_xml, indent=0):
    grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in grid_widths)
    ind = f'<w:tblInd w:w="{indent}" w:type="dxa"/>' if indent else ""
    return ('<w:tbl><w:tblPr><w:tblW w:type="auto" w:w="0"/><w:jc w:val="center"/>'
            f'{ind}<w:tblLayout w:type="fixed"/><w:tblLook w:firstColumn="0" w:firstRow="0" '
            'w:lastColumn="0" w:lastRow="0" w:noHBand="1" w:noVBand="1" w:val="0000"/></w:tblPr>'
            f"<w:tblGrid>{grid}</w:tblGrid>{rows_xml}</w:tbl>")

def _tc(inner, w, fill=None, margin=150, valign="center"):
    shd = f'<w:shd w:fill="{fill}"/>' if fill else ""
    return (f'<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="{w}"/>{shd}<w:vAlign w:val="{valign}"/>'
            f'<w:tcMar><w:top w:w="{margin}" w:type="dxa"/><w:left w:w="{margin}" w:type="dxa"/>'
            f'<w:bottom w:w="{margin}" w:type="dxa"/><w:right w:w="{margin}" w:type="dxa"/></w:tcMar>'
            f"</w:tcPr>{inner}</w:tc>")

def _p(runs_xml, after=0, before=0, line=None, align=None):
    sp = f'<w:spacing w:after="{after}" w:before="{before}"'
    sp += f' w:line="{line}" w:lineRule="auto"' if line else ""
    sp += "/>"
    jc = f'<w:jc w:val="{align}"/>' if align else ""
    return f"<w:p><w:pPr>{sp}{jc}</w:pPr>{runs_xml}</w:p>"

def cover(kicker, title_lines, subtitle, meta_lines):
    """A dark panel cover block, used at the top of a document."""
    inner = _p(runs(kicker, color="9FD3C0", sz="18", bold=True), after=140)
    for i, line in enumerate(title_lines):
        inner += _p(runs(line, color="FFFFFF", bold=True, sz="56"), after=40 if i < len(title_lines) - 1 else 160)
    inner += _p(runs(subtitle, color="D7E7E1", sz="22"), after=200 if meta_lines else 0)
    for line in meta_lines:
        inner += _p(runs(line, color="9FD3C0", sz="18"), after=50)
    row = f'<w:tr><w:trPr><w:cantSplit/></w:trPr>{_tc(inner, CONTENT_W, DARK, margin=320)}</w:tr>'
    return _tbl([CONTENT_W], row) + _p("", after=180)

def sectionbar(number, label):
    """Numbered section divider: large accent numeral beside a rule and label."""
    n = _p(runs(number, color=ACCENT, bold=True, sz="44"), after=0)
    t = _p(runs(label.upper(), color=GREY, bold=True, sz="19"), after=0)
    cells = _tc(n, 700, margin=0) + _tc(t, CONTENT_W - 700, margin=0)
    row = f'<w:tr><w:trPr><w:cantSplit/></w:trPr>{cells}</w:tr>'
    tight = ('<w:p><w:pPr><w:spacing w:after="0" w:before="0" w:line="30" '
             'w:lineRule="exact"/></w:pPr></w:p>')
    return ('<w:p><w:pPr><w:spacing w:after="0" w:before="0" w:line="150" '
            'w:lineRule="exact"/></w:pPr></w:p>'
            + _tbl([700, CONTENT_W - 700], row) + tight + hr())

def hr():
    return ('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" '
            f'w:color="{RULE}"/></w:pBdr><w:spacing w:after="70" w:before="0"/></w:pPr></w:p>')

def stats(items):
    """A borderless row of large figures with small captions."""
    n = len(items)
    w = CONTENT_W // n
    cells = ""
    for value, caption in items:
        inner = _p(runs(value, color=ACCENT, bold=True, sz="40"), after=30)
        inner += _p(runs(caption, color=GREY, sz="17"), after=0)
        cells += _tc(inner, w, ZEBRA, margin=170, valign="top")
    row = f'<w:tr><w:trPr><w:cantSplit/></w:trPr>{cells}</w:tr>'
    return _tbl([w] * n, row) + _p(runs("", sz="6"), after=100)

def panel(heading, body, tone="info"):
    """A tinted panel for a caution or an emphasis note."""
    fill = CALLOUT if tone == "info" else AMBER
    edge = ACCENT if tone == "info" else AMBER_EDGE
    inner = _p(runs(heading.upper(), color=edge, bold=True, sz="17"), after=70)
    for i, line in enumerate(body if isinstance(body, list) else [body]):
        inner += _p(runs(line, sz="19"), after=60)
    row = f'<w:tr><w:trPr><w:cantSplit/></w:trPr>{_tc(inner, CONTENT_W, fill, margin=200, valign="top")}</w:tr>'
    return _tbl([CONTENT_W], row) + _p(runs("", sz="6"), after=110)

def twocol(left_title, left_items, right_title, right_items):
    """A do / do-not style pair of stacked lists."""
    w = CONTENT_W // 2
    def col(title, items, color):
        inner = _p(runs(title.upper(), color=color, bold=True, sz="17"), after=80)
        for it in items:
            inner += _p(runs("•  " + it, sz="19"), after=60, line="250")
        return inner
    cells = (_tc(col(left_title, left_items, ACCENT), w, ZEBRA, margin=190, valign="top")
             + _tc(col(right_title, right_items, AMBER_EDGE), w, AMBER, margin=190, valign="top"))
    row = f'<w:tr><w:trPr><w:cantSplit/></w:trPr>{cells}</w:tr>'
    return _tbl([w, w], row) + _p(runs("", sz="6"), after=110)

def weekstrip(weeks):
    """Four-week timeline strip."""
    n = len(weeks)
    w = CONTENT_W // n
    cells = ""
    for i, (label, text) in enumerate(weeks):
        inner = _p(runs(label.upper(), color="FFFFFF", bold=True, sz="17"), after=0)
        cells += _tc(inner, w, DARK, margin=120)
    head = f'<w:tr><w:trPr><w:cantSplit/></w:trPr>{cells}</w:tr>'
    cells = ""
    for i, (label, text) in enumerate(weeks):
        inner = _p(runs(text, sz="18"), after=0, line="250")
        cells += _tc(inner, w, ZEBRA if i % 2 == 0 else None, margin=150, valign="top")
    body = f'<w:tr><w:trPr><w:cantSplit/></w:trPr>{cells}</w:tr>'
    return _tbl([w] * n, head + body) + _p(runs("", sz="6"), after=110)
