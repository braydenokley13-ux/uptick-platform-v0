# Founder document sources

These scripts generate the founder-facing DOCX files and their PDFs. They exist
so the documents stay maintainable and can be regenerated after a status change,
rather than being hand-edited binaries.

## What is here

| File            | Produces                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `build_docx.py` | Shared house style: cover panels, numbered section bars, stat rows, tinted panels, two-tone comparison blocks, tables. |
| `playbook.py`   | `UPTICK_FOUNDER_PLAYBOOK`                                                                                              |
| `one_pager.py`  | `UPTICK_MERCHANT_ONE_PAGER` (the merchant leave-behind)                                                                |
| `demo.py`       | `UPTICK_THURSDAY_DEMO`                                                                                                 |
| `template/`     | The unpacked styles, theme, header and footer every document shares.                                                   |

The Thursday meeting packet (`UPTICK_GAS_STATION_MEETING_2026-09-17`) is edited
directly as a DOCX rather than generated, because it was authored by hand and its
layout should be preserved; the template here is taken from it so the generated
documents match its house style.

## Regenerating

Requires Python 3, `pypdfium2` and `Pillow` (for rendering checks) and
LibreOffice with Writer (`soffice`) for the PDF conversion.

```bash
python3 docs/founder/playbook.py
python3 docs/founder/one_pager.py
python3 docs/founder/demo.py
```

Output goes to `private/founder/`, which is git-ignored, because the finished
documents are founder working material and are expected to be filled in with real
names, contacts and commercial terms. Override the destination with
`UPTICK_DOC_OUT=/some/path`.

## Rules these documents follow

- Every status claim is dated and tied to a commit. Status statements expire.
- Anything unconfirmed stays in `[BRACKETS]`. Do not replace a bracket with a
  guess.
- A recorded redemption is never described as a verified purchase or a confirmed
  physical handoff.
- A configured member cap is never described as an existing audience.
- No invented price, no claimed legal review, no launch date before the gates in
  `docs/PILOT_RELEASE_CANDIDATE.md` are actually closed.

## Fonts

The documents use the product's own typefaces so they read as the same brand:
**Newsreader** for display type and **Geist** for body text, with the warm canvas
ground, marine, mint and amber values taken from `src/app/globals.css`.

Both families ship with the app in `node_modules/@fontsource/`, as `.woff2` only.
To render the PDFs exactly, convert the faces you need to TrueType and install
them, then rebuild:

```bash
pip install fonttools brotli
python3 - <<'PY'
from fontTools.ttLib import TTFont
import os
src, out = "node_modules/@fontsource", "/usr/local/share/fonts/uptick"
os.makedirs(out, exist_ok=True)
for fam, key in [("newsreader", "latin-400-normal"), ("newsreader", "latin-400-italic"),
                 ("newsreader", "latin-600-normal"), ("newsreader", "latin-700-normal"),
                 ("geist-sans", "latin-400-normal"), ("geist-sans", "latin-500-normal"),
                 ("geist-sans", "latin-600-normal"), ("geist-sans", "latin-700-normal")]:
    f = TTFont(f"{src}/{fam}/files/{fam}-{key}.woff2"); f.flavor = None
    f.save(f"{out}/{fam}-{key}.ttf")
PY
fc-cache -f
```

The Newsreader faces are published under the family name `Newsreader 16pt`; the
documents reference plain `Newsreader`, so rename the family in the `name` table
(IDs 1, 4, 6 and 16) after converting, or install the family from Google Fonts
instead. Without these fonts installed, Word and LibreOffice substitute a default
serif and sans — the layout still holds, but the type will not match the product.
