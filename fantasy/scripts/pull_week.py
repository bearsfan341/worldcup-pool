"""Pull a week's matchups with ESPN projections for the game preview.

Uses ESPN's own projected totals only -- no model of mine -- plus each side's
top projected starters, so the preview can say what is actually worth watching.

Writes data/week_preview.json. Re-run each week.
"""
import csv
import json
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
sys.path.insert(0, BASE)
from config import LEAGUE_ID, SWID, ESPN_S2  # noqa: E402
from espn_api.football import League  # noqa: E402

BENCH = {"BE", "IR"}


def main(week=None):
    lg = League(league_id=LEAGUE_ID, year=2026, espn_s2=ESPN_S2, swid=SWID)
    week = week or lg.current_week
    owners = {int(r["team_id"]): r["canonical_manager"]
              for r in csv.DictReader(open(os.path.join(DATA, "owner_map.csv")))}

    games = []
    for m in lg.box_scores(week):
        def side(team, lineup, projected):
            starters = [p for p in lineup if p.slot_position not in BENCH]
            starters.sort(key=lambda p: -(p.projected_points or 0))
            return {
                "manager": owners[team.team_id],
                "team_name": team.team_name.strip(),
                "projected": round(projected, 1),
                "top": [{"player": p.name, "pos": p.position,
                         "proj": round(p.projected_points or 0, 1),
                         "injury": p.injuryStatus or ""}
                        for p in starters[:4]],
                "risk": [{"player": p.name, "pos": p.position,
                          "proj": round(p.projected_points or 0, 1),
                          "injury": p.injuryStatus or ""}
                         for p in starters
                         if p.injuryStatus in ("OUT", "DOUBTFUL", "INJURY_RESERVE", "SUSPENSION")],
            }
        away = side(m.away_team, m.away_lineup, m.away_projected)
        home = side(m.home_team, m.home_lineup, m.home_projected)
        margin = round(abs(home["projected"] - away["projected"]), 1)
        games.append({
            "away": away, "home": home, "margin": margin,
            "favorite": (home if home["projected"] >= away["projected"] else away)["manager"],
            "underdog": (away if home["projected"] >= away["projected"] else home)["manager"],
        })
    games.sort(key=lambda g: g["margin"])

    out = {"week": week, "season": 2026,
           "note": "Projections are ESPN's own weekly starter projections.",
           "games": games}
    path = os.path.join(DATA, "week_preview.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=1)
    print(f"wrote {path} (week {week}, {len(games)} games)")
    for g in games:
        print(f'  {g["away"]["manager"]:<18} {g["away"]["projected"]:>6.1f}  @  '
              f'{g["home"]["manager"]:<18} {g["home"]["projected"]:>6.1f}   '
              f'margin {g["margin"]:>5.1f}  -> {g["favorite"]}')
    return 0


if __name__ == "__main__":
    raise SystemExit(main(int(sys.argv[1]) if len(sys.argv) > 1 else None))
