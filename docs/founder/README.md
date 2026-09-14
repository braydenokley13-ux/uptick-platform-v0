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
