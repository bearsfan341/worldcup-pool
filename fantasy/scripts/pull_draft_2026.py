"""Pull the 2026 draft board, post-draft rosters and ESPN ADP.

Writes:
    data/draft_2026.csv    every pick: round, overall, team, manager, player
    data/roster_2026.csv   post-draft rosters + ESPN season projections
    data/espn_players_2026.json  ESPN ADP + season projection for the pool
"""
import csv
import json
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
DATA = os.path.join(BASE, "data")

from config import LEAGUE_ID, SWID, ESPN_S2  # noqa: E402
from espn_api.football import League  # noqa: E402

SEASON = 2026
ADP_URL = ("https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/"
           f"{SEASON}/segments/0/leagues/{LEAGUE_ID}")


def owner_map():
    with open(os.path.join(DATA, "owner_map.csv")) as f:
        return {int(r["team_id"]): r["canonical_manager"] for r in csv.DictReader(f)}


def write(name, rows):
    path = os.path.join(DATA, name)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"  wrote {name} ({len(rows)} rows)")


def pull_players():
    """Cache ADP + season projection for every player in the pool.

    Drafted players who are later dropped vanish from team rosters, so the
    analysis needs a projection source that does not depend on current
    ownership.
    """
    import requests
    hdr = {"x-fantasy-filter": json.dumps(
        {"players": {"limit": 1200,
                     "sortDraftRanks": {"sortPriority": 100, "sortAsc": True, "value": "PPR"}}}),
        "User-Agent": "Mozilla/5.0"}
    r = requests.get(ADP_URL, params={"view": "kona_player_info"},
                     cookies={"SWID": SWID, "espn_s2": ESPN_S2}, headers=hdr, timeout=90)
    r.raise_for_status()
    out = {}
    for e in r.json().get("players", []):
        p = e["player"]
        adp = (p.get("ownership") or {}).get("averageDraftPosition")
        proj = None
        for s in p.get("stats", []):
            if (s.get("seasonId") == SEASON and s.get("statSourceId") == 1
                    and s.get("statSplitTypeId") == 0):
                proj = round(s.get("appliedTotal") or 0, 1)
                break
        out[p["fullName"]] = {"adp": round(adp, 1) if adp and adp > 0 else None,
                              "proj": proj}
    path = os.path.join(DATA, "espn_players_2026.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
    n_adp = sum(1 for v in out.values() if v["adp"])
    n_proj = sum(1 for v in out.values() if v["proj"])
    print(f"  wrote espn_players_2026.json ({len(out)} players, {n_adp} adp, {n_proj} proj)")


def main():
    owners = owner_map()
    lg = League(league_id=LEAGUE_ID, year=SEASON, espn_s2=ESPN_S2, swid=SWID)
    teams = len(lg.teams)
    print(f"league {LEAGUE_ID} {SEASON}: {teams} teams, {len(lg.draft)} picks")

    picks = []
    for p in lg.draft:
        tid = p.team.team_id if p.team else None
        picks.append({
            "overall": (p.round_num - 1) * teams + p.round_pick,
            "round": p.round_num, "pick": p.round_pick,
            "team_id": tid, "manager": owners.get(tid, "?"),
            "team_name": p.team.team_name.strip() if p.team else "?",
            "player": p.playerName, "player_id": p.playerId,
        })
    write("draft_2026.csv", sorted(picks, key=lambda r: r["overall"]))

    roster = []
    for t in lg.teams:
        for pl in t.roster:
            roster.append({
                "team_id": t.team_id, "manager": owners.get(t.team_id, "?"),
                "player": pl.name, "player_id": pl.playerId,
                "position": pl.position, "pro_team": getattr(pl, "proTeam", ""),
                "proj": round(pl.projected_total_points or 0, 1),
                "proj_avg": round(pl.projected_avg_points or 0, 2),
                "injury": pl.injuryStatus or "",
                "owned": round(pl.percent_owned or 0, 1),
            })
    write("roster_2026.csv", roster)
    pull_players()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
