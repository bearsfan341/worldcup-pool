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
PAGE = os.path.join(REPO, "docs", "index.html")
START, END = "/* DRAFT_DATA_START */", "/* DRAFT_DATA_END */"

# Fields the page actually reads; everything else stays out of the payload.
PICK_KEYS = ("overall", "round", "manager", "player", "pos", "ecr", "proj", "val")
TEAM_KEYS = ("manager", "power_rank", "grade", "power_score", "z", "disagreement",
             "starters_proj", "trade_gain", "bust_share", "draft_value",
             "ecr_strength", "rb_starters", "wr_starters", "rb_surplus",
             "biggest_hole", "bust_players", "best_pick", "worst_pick", "pos_counts")


def main():
    a = json.load(open(SRC))
    copy = json.load(open(COPY))
    payload = {
        "copy": {k: v for k, v in copy.items() if not k.startswith("_")},
        "weights": a["weights"],
        "season_started": a["season_started"],
        "picks": a["picks"],
        "positional_premium": a["positional_premium"],
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
    open(PAGE, "w").write(html)
    print(f"injected {len(blob):,} bytes of draft data into docs/index.html")
    print(f"  {payload['picks']} picks, {len(payload['teams'])} teams")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
