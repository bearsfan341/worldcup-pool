"""Parse the FantasyPros pre-draft ECR cheat sheet PDF into a cached JSON.

FantasyPros' ADP/ECR tables are rendered client-side from an authenticated
API, so scraping the page yields only the first few rows. The printable
cheat sheet PDF carries the same consensus board, so that is the source.

Output: fantasy/data/ecr_2026.json
    {"season":2026, "source":..., "players":{name:{overall,pos,pos_rank,team}}}

Re-run only when the cheat sheet changes; the site reads the cached JSON.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from player_match import defix  # noqa: E402

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "data", "ecr_2026.json")

ROW = re.compile(r"^\s*(\d{1,3})\.\s+([^,\n]+?),\s*([A-Z]{2,3})?\s*$", re.M)
SECTIONS = {
    "Quarterbacks": "QB", "Running Backs": "RB", "Wide Receivers": "WR",
    "Tight Ends": "TE", "Kickers": "K", "Defenses/Special Teams": "DST",
}


def rows(text):
    return [(int(n), p.strip(), (t or "").strip()) for n, p, t in ROW.findall(text)]


def main(pdf_path):
    try:
        import pymupdf
    except ImportError:
        print("error: pip install pymupdf", file=sys.stderr)
        return 1
    doc = pymupdf.open(pdf_path)
    pages = [defix(p.get_text()) for p in doc]

    # The overall board runs until the first positional heading.
    overall, positional = {}, {}
    for text in pages:
        first = min((text.find(h) for h in SECTIONS if text.find(h) >= 0), default=-1)
        head, tail = (text[:first], text[first:]) if first >= 0 else (text, "")
        for rank, name, team in rows(head):
            overall.setdefault(rank, (name, team))
        if not tail:
            continue
        # segment the remainder by positional heading
        marks = sorted((tail.find(h), h) for h in SECTIONS if tail.find(h) >= 0)
        for i, (start, head_name) in enumerate(marks):
            end = marks[i + 1][0] if i + 1 < len(marks) else len(tail)
            for rank, name, team in rows(tail[start:end]):
                positional.setdefault(name, (SECTIONS[head_name], rank, team))

    players = {}
    for rank, (name, team) in overall.items():
        pos, pos_rank, _ = positional.get(name, (None, None, None))
        players[name] = {"overall": rank, "pos": pos, "pos_rank": pos_rank, "team": team}
    # players ranked positionally but outside the printed overall board
    for name, (pos, pos_rank, team) in positional.items():
        players.setdefault(name, {"overall": None, "pos": pos,
                                  "pos_rank": pos_rank, "team": team})

    payload = {"season": 2026, "source": os.path.basename(pdf_path),
               "note": "FantasyPros Expert Consensus Rankings, pre-draft cheat sheet",
               "players": players}
    with open(OUT, "w") as f:
        json.dump(payload, f, indent=1, sort_keys=True)

    withpos = sum(1 for v in players.values() if v["pos"])
    print(f"wrote {OUT}")
    print(f"  {len(players)} players | {len(overall)} with overall rank | {withpos} with position rank")
    by = {}
    for v in players.values():
        if v["pos"]:
            by[v["pos"]] = by.get(v["pos"], 0) + 1
    print("  by position: " + ", ".join(f"{k}:{v}" for k, v in sorted(by.items())))
    return 0


if __name__ == "__main__":
    p = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("ECR_PDF", "")
    if not p or not os.path.exists(p):
        print("usage: parse_ecr.py <cheatsheet.pdf>", file=sys.stderr)
        raise SystemExit(2)
    raise SystemExit(main(p))
