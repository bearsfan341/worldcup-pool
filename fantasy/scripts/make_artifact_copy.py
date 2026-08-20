#!/usr/bin/env python3
"""Generate the Claude-artifact copy of the site from docs/index.html.

The GitHub Pages file is a complete HTML document. The artifact host wraps
whatever it is given in its own <!doctype>/<head>/<body>, so publishing the
full document there nests a second one. This strips exactly the document
wrapper and keeps everything the page actually needs: <title>, the font
<link> tags, <style>, the markup, and <script>.

Usage:  python3 fantasy/scripts/make_artifact_copy.py [output_path]
"""

import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
SRC = REPO / "docs" / "index.html"

DEFAULT_OUT = pathlib.Path(
    "/tmp/claude-0/-home-user-worldcup-pool/"
    "98083a44-da01-58f3-b7ac-a200dcd285cd/scratchpad/wolves-preview.html"
)

# Lines that exist only to make the standalone file a valid document.
DROP_EXACT = {
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    "</head>",
    "<body>",
    "</body>",
    "</html>",
    '<meta charset="UTF-8">',
}
DROP_PREFIXES = ('<meta name="viewport"', '<meta name="theme-color"', '<meta name="description"')


def main() -> int:
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT

    if not SRC.exists():
        print(f"error: {SRC} not found", file=sys.stderr)
        return 1

    kept = []
    for line in SRC.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped in DROP_EXACT or stripped.startswith(DROP_PREFIXES):
            continue
        kept.append(line)

    result = "\n".join(kept).strip() + "\n"

    # The artifact host scans the first 8KB for a <title>; make sure it survived.
    problems = []
    if "<title>" not in result:
        problems.append("<title> was stripped")
    if "<!DOCTYPE" in result or re.search(r"<html\b", result):
        problems.append("document wrapper survived")
    if "<style>" not in result or "<script>" not in result:
        problems.append("style or script block missing")
    if "fonts.googleapis.com" not in result:
        problems.append("font <link> was stripped")
    if problems:
        print("error: " + "; ".join(problems), file=sys.stderr)
        return 1

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(result, encoding="utf-8")
    print(f"wrote {out} ({len(result):,} bytes, {len(kept)} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
