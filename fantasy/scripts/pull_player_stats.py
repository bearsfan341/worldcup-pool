"""
Pull season-total stats for every drafted player and every executed waiver/FA
add, across 2018-2025 (waivers) and 2015-2025 (draft), for value analysis.
"""
import csv
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import LEAGUE_ID, SWID, ESPN_S2  # noqa: E402
from espn_api.football import League  # noqa: E402

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
SEASONS = list(range(2015, 2026))


def log(msg):
    print(msg, flush=True)


def get_league(year):
    return League(league_id=LEAGUE_ID, year=year, espn_s2=ESPN_S2, swid=SWID)


def read_csv(name):
    path = os.path.join(DATA_DIR, name)
    with open(path) as f:
        return list(csv.DictReader(f))


def main():
    draft_rows = read_csv("draft.csv")
    waiver_rows = read_csv("waivers.csv")

    draft_ids_by_season = {}
    for r in draft_rows:
        draft_ids_by_season.setdefault(int(r["season"]), set()).add(int(r["player_id"]))

    waiver_ids_by_season = {}
    for r in waiver_rows:
        if r["status"] != "EXECUTED" or not r.get("players_added_ids"):
            continue
        season = int(r["season"])
        for pid in r["players_added_ids"].split(";"):
            pid = pid.strip()
            if pid and pid != "None":
                waiver_ids_by_season.setdefault(season, set()).add(int(pid))

    all_seasons = sorted(set(draft_ids_by_season) | set(waiver_ids_by_season))

    out_rows = []
    for year in all_seasons:
        ids = draft_ids_by_season.get(year, set()) | waiver_ids_by_season.get(year, set())
        if not ids:
            continue
        try:
            league = get_league(year)
        except Exception as e:
            log(f"{year}: failed to load league: {e}")
            continue

        id_list = sorted(ids)
        log(f"{year}: fetching stats for {len(id_list)} players (draft + waiver adds)")
        # batch in chunks of 100 to be safe
        for i in range(0, len(id_list), 100):
            chunk = id_list[i : i + 100]
            try:
                players = league.player_info(playerId=chunk)
            except Exception as e:
                log(f"  chunk error: {e}")
                continue
            if players is None:
                continue
            if not isinstance(players, list):
                players = [players]
            for p in players:
                weekly = {}
                for wk, s in (p.stats or {}).items():
                    if wk == 0:
                        continue
                    weekly[wk] = s.get("points", 0)
                out_rows.append(
                    {
                        "season": year,
                        "player_id": p.playerId,
                        "player_name": p.name,
                        "position": p.position,
                        "total_points": p.total_points,
                        "avg_points": p.avg_points,
                        "weekly_points": ";".join(f"{wk}:{pts}" for wk, pts in sorted(weekly.items())),
                    }
                )
            time.sleep(0.1)

    path = os.path.join(DATA_DIR, "player_season_stats.csv")
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(
            f, fieldnames=["season", "player_id", "player_name", "position", "total_points", "avg_points", "weekly_points"]
        )
        writer.writeheader()
        for row in out_rows:
            writer.writerow(row)
    log(f"wrote {path} ({len(out_rows)} rows)")


if __name__ == "__main__":
    main()
