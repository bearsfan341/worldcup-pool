"""Inject data/draft_analysis.json into the DRAFT_DATA block in docs/index.html.

Keeps the page a single self-contained file while letting the analysis be
regenerated: re-run pull_draft_2026.py -> analyze_draft.py -> this script.
"""
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(BASE)
SRC = os.path.join(BASE, "data", "draft_analysis.json")
COPY = os.path.join(BASE, "data", "draft_copy.json")
WEEK = os.path.join(BASE, "data", "week_preview.json")
PAGE = os.path.join(REPO, "docs", "index.html")
START, END = "/* DRAFT_DATA_START */", "/* DRAFT_DATA_END */"
WSTART, WEND = "/* WEEK_DATA_START */", "/* WEEK_DATA_END */"

# Fields the page actually reads; everything else stays out of the payload.
PICK_KEYS = ("overall", "round", "manager", "player", "pos", "adp", "proj", "val")
TEAM_KEYS = ("manager", "power_rank", "grade", "starters_proj", "draft_value",
             "rb_starters", "wr_starters", "flagged", "best_pick", "worst_pick")


def main():
    a = json.load(open(SRC))
    copy = json.load(open(COPY))
    payload = {
        "copy": {k: v for k, v in copy.items() if not k.startswith("_")},
        "season_started": a["season_started"],
        "source": a["source"],
        "picks": a["picks"],
        "board": [{k: p.get(k) for k in PICK_KEYS} for p in a["board"]],
        "teams": [{k: t.get(k) for k in TEAM_KEYS} for t in a["teams"]],
    }
    blob = json.dumps(payload, separators=(",", ":"))

    html = open(PAGE).read()
    if START not in html or END not in html:
        print(f"error: markers not found in {PAGE}", file=sys.stderr)
        return 1
    new = f"{START}\n  var DRAFT = {blob};\n  {END}"
    html = re.sub(re.escape(START) + r".*?" + re.escape(END), lambda _: new, html, flags=re.S)

    if os.path.exists(WEEK):
        wk = json.load(open(WEEK))
        wblob = json.dumps(wk, separators=(",", ":"))
        wnew = f"{WSTART}\n  var WEEK_PREVIEW = {wblob};\n  {WEND}"
        html = re.sub(re.escape(WSTART) + r".*?" + re.escape(WEND), lambda _: wnew, html, flags=re.S)
        print(f"  week {wk['week']} preview: {len(wk['games'])} games, {len(wblob):,} bytes")
    open(PAGE, "w").write(html)
    print(f"injected {len(blob):,} bytes of draft data into docs/index.html")
    print(f"  {payload['picks']} picks, {len(payload['teams'])} teams")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
