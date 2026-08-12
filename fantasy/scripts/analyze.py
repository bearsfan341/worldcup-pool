"""
Build manager profiles and league-wide superlatives from the raw CSV pull.
Writes fantasy/data/analysis.json (everything downstream markdown needs)
plus a couple of flat CSVs for spot-checking.
"""
import csv
import json
import os
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")


def read_csv(name):
    with open(os.path.join(DATA_DIR, name)) as f:
        return list(csv.DictReader(f))


def to_float(x, default=0.0):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def to_int(x, default=0):
    try:
        return int(float(x))
    except (TypeError, ValueError):
        return default


def main():
    standings = read_csv("standings.csv")
    matchups = read_csv("matchups.csv")
    draft = read_csv("draft.csv")
    trades = read_csv("trades.csv")
    waivers = read_csv("waivers.csv")
    player_stats = read_csv("player_season_stats.csv")
    owner_map_rows = read_csv("owner_map.csv")

    owner_map = {r["team_id"]: r["canonical_manager"] for r in owner_map_rows}
    manager_note = {r["team_id"]: r["note"] for r in owner_map_rows}
    all_team_ids = sorted(owner_map.keys(), key=int)
    current_team_ids = [tid for tid in all_team_ids if tid != "9"]  # Phil Lannon left after 2016

    # player stats lookup: (season, player_id) -> row
    pstat_lookup = {}
    for r in player_stats:
        pstat_lookup[(r["season"], r["player_id"])] = r

    # ---------- Standings-based stats ----------
    profiles = {tid: {
        "manager": owner_map[tid],
        "note": manager_note[tid],
        "seasons": [],
        "wins": 0, "losses": 0, "ties": 0,
        "points_for": 0.0, "points_against": 0.0,
        "finishes": [],
        "playoff_appearances": 0,
        "championships": 0,
        "last_place_finishes": 0,
        "championship_seasons": [],
        "last_place_seasons": [],
    } for tid in all_team_ids}

    season_num_teams = {}
    for r in standings:
        tid = r["team_id"]
        season = r["season"]
        if tid not in profiles:
            continue
        p = profiles[tid]
        p["seasons"].append(season)
        p["wins"] += to_int(r["wins"])
        p["losses"] += to_int(r["losses"])
        p["ties"] += to_int(r["ties"])
        p["points_for"] += to_float(r["points_for"])
        p["points_against"] += to_float(r["points_against"])
        final_standing = to_int(r["final_standing"])
        p["finishes"].append({"season": season, "final_standing": final_standing, "team_name": r["team_name"]})
        num_teams = to_int(r["num_teams"])
        season_num_teams[season] = num_teams
        if final_standing == 1:
            p["championships"] += 1
            p["championship_seasons"].append(season)
        if final_standing == num_teams:
            p["last_place_finishes"] += 1
            p["last_place_seasons"].append(season)

    # playoff appearance = played in a WINNERS_BRACKET matchup that season
    playoff_seasons = defaultdict(set)
    for m in matchups:
        if m["matchup_type"] == "WINNERS_BRACKET":
            playoff_seasons[m["home_team_id"]].add(m["season"])
            playoff_seasons[m["away_team_id"]].add(m["season"])
    for tid, seasons in playoff_seasons.items():
        if tid in profiles:
            profiles[tid]["playoff_appearances"] = len(seasons)
            profiles[tid]["playoff_seasons"] = sorted(seasons)

    for tid, p in profiles.items():
        p["finishes"] = sorted(p["finishes"], key=lambda f: f["season"])
        games = p["wins"] + p["losses"] + p["ties"]
        p["games"] = games
        p["win_pct"] = round((p["wins"] + 0.5 * p["ties"]) / games, 4) if games else None
        p["avg_finish"] = round(sum(f["final_standing"] for f in p["finishes"]) / len(p["finishes"]), 2) if p["finishes"] else None
        p["avg_points_for"] = round(p["points_for"] / games, 2) if games else None
        p["avg_points_against"] = round(p["points_against"] / games, 2) if games else None
        p.setdefault("playoff_seasons", [])

    # ---------- Luck index (all-play method) ----------
    # For each season+week, gather every team's score, compute all-play win fraction.
    week_scores = defaultdict(list)  # (season, week) -> [(team_id, score)]
    for m in matchups:
        key = (m["season"], m["week"])
        week_scores[key].append((m["home_team_id"], to_float(m["home_score"])))
        week_scores[key].append((m["away_team_id"], to_float(m["away_score"])))

    actual_result = {}  # (season, week, team_id) -> 1/0.5/0 actual result
    for m in matchups:
        season, week = m["season"], m["week"]
        h, a = m["home_team_id"], m["away_team_id"]
        hs, aws = to_float(m["home_score"]), to_float(m["away_score"])
        if hs > aws:
            actual_result[(season, week, h)] = 1.0
            actual_result[(season, week, a)] = 0.0
        elif hs < aws:
            actual_result[(season, week, h)] = 0.0
            actual_result[(season, week, a)] = 1.0
        else:
            actual_result[(season, week, h)] = 0.5
            actual_result[(season, week, a)] = 0.5

    luck_by_team_season = defaultdict(lambda: {"actual_wins": 0.0, "expected_wins": 0.0, "weeks": 0})
    for (season, week), entries in week_scores.items():
        n = len(entries)
        if n < 2:
            continue
        for tid, score in entries:
            beaten = sum(1 for other_tid, other_score in entries if other_tid != tid and score > other_score)
            tied = sum(1 for other_tid, other_score in entries if other_tid != tid and score == other_score)
            expected = (beaten + 0.5 * tied) / (n - 1)
            key = (tid, season)
            luck_by_team_season[key]["expected_wins"] += expected
            luck_by_team_season[key]["weeks"] += 1
            actual = actual_result.get((season, week, tid))
            if actual is not None:
                luck_by_team_season[key]["actual_wins"] += actual

    luck_by_team = defaultdict(lambda: {"actual_wins": 0.0, "expected_wins": 0.0})
    luck_by_team_season_out = defaultdict(dict)
    for (tid, season), d in luck_by_team_season.items():
        luck = round(d["actual_wins"] - d["expected_wins"], 2)
        luck_by_team_season_out[tid][season] = {
            "actual_wins": round(d["actual_wins"], 2),
            "expected_wins": round(d["expected_wins"], 2),
            "luck": luck,
        }
        luck_by_team[tid]["actual_wins"] += d["actual_wins"]
        luck_by_team[tid]["expected_wins"] += d["expected_wins"]

    for tid, p in profiles.items():
        d = luck_by_team.get(tid, {"actual_wins": 0, "expected_wins": 0})
        p["luck_all_time"] = round(d["actual_wins"] - d["expected_wins"], 2)
        p["expected_wins_all_time"] = round(d["expected_wins"], 2)
        p["actual_wins_all_time_allplay_basis"] = round(d["actual_wins"], 2)
        p["luck_by_season"] = luck_by_team_season_out.get(tid, {})

    # ---------- Championship playoff-scoring deep dive ----------
    # For every championship season, compare regular-season scoring average to
    # what the team actually put up in each playoff (WINNERS_BRACKET) game that year.
    team_season_games = defaultdict(lambda: {"reg_scores": [], "playoff_games": []})
    for m in matchups:
        for side, other in (("home", "away"), ("away", "home")):
            tid_side = m[f"{side}_team_id"]
            key = (tid_side, m["season"])
            score = to_float(m[f"{side}_score"])
            opp_score = to_float(m[f"{other}_score"])
            opp_tid = m[f"{other}_team_id"]
            if m["matchup_type"] == "WINNERS_BRACKET":
                team_season_games[key]["playoff_games"].append({
                    "week": m["week"], "score": score, "opp_score": opp_score,
                    "opponent": owner_map.get(opp_tid, opp_tid),
                    "result": "W" if score > opp_score else ("L" if score < opp_score else "T"),
                })
            elif m["matchup_type"] == "NONE":
                team_season_games[key]["reg_scores"].append(score)

    for tid, p in profiles.items():
        runs = []
        for season in p["championship_seasons"]:
            key = (tid, season)
            g = team_season_games.get(key, {"reg_scores": [], "playoff_games": []})
            reg_avg = round(sum(g["reg_scores"]) / len(g["reg_scores"]), 1) if g["reg_scores"] else None
            runs.append({
                "season": season,
                "reg_season_avg": reg_avg,
                "reg_season_games": len(g["reg_scores"]),
                "playoff_games": sorted(g["playoff_games"], key=lambda x: x["week"]),
            })
        p["championship_runs"] = runs

    # ---------- Head-to-head matrix ----------
    h2h = defaultdict(lambda: defaultdict(lambda: {"w": 0, "l": 0, "t": 0, "pf": 0.0, "pa": 0.0}))
    for m in matchups:
        h, a = m["home_team_id"], m["away_team_id"]
        hs, aws = to_float(m["home_score"]), to_float(m["away_score"])
        if h not in profiles or a not in profiles:
            continue
        h2h[h][a]["pf"] += hs
        h2h[h][a]["pa"] += aws
        h2h[a][h]["pf"] += aws
        h2h[a][h]["pa"] += hs
        if hs > aws:
            h2h[h][a]["w"] += 1
            h2h[a][h]["l"] += 1
        elif hs < aws:
            h2h[h][a]["l"] += 1
            h2h[a][h]["w"] += 1
        else:
            h2h[h][a]["t"] += 1
            h2h[a][h]["t"] += 1

    h2h_out = {tid: {opp: v for opp, v in opps.items()} for tid, opps in h2h.items()}

    # best/worst rival per manager (min 4 games played, current managers only)
    for tid, p in profiles.items():
        opps = h2h_out.get(tid, {})
        best_rival, worst_rival = None, None
        for opp, rec in opps.items():
            if opp not in current_team_ids:
                continue
            total = rec["w"] + rec["l"] + rec["t"]
            if total < 4:
                continue
            margin = rec["w"] - rec["l"]
            entry = {"opponent": owner_map.get(opp, opp), "w": rec["w"], "l": rec["l"], "t": rec["t"], "margin": margin}
            if best_rival is None or margin > best_rival["margin"]:
                best_rival = entry
            if worst_rival is None or margin < worst_rival["margin"]:
                worst_rival = entry
        p["best_rival"] = best_rival
        p["worst_rival"] = worst_rival

    # ---------- Draft tendencies + pick value ----------
    draft_by_season = defaultdict(list)
    for r in draft:
        draft_by_season[r["season"]].append(r)

    pick_value_rows = []
    for season, picks in draft_by_season.items():
        scored = []
        for r in picks:
            key = (season, r["player_id"])
            ps = pstat_lookup.get(key)
            total_points = to_float(ps["total_points"]) if ps else None
            scored.append((r, total_points))
        # rank by total_points desc (None goes last)
        ranked = sorted(
            [s for s in scored if s[1] is not None],
            key=lambda x: -x[1],
        )
        points_rank = {id(r): i + 1 for i, (r, pts) in enumerate(ranked)}
        for r, pts in scored:
            overall = to_int(r["overall_pick"])
            prank = points_rank.get(id(r))
            value_score = (overall - prank) if prank else None
            position = pstat_lookup.get((season, r["player_id"]), {}).get("position")
            pick_value_rows.append({
                "season": season,
                "team_id": r["team_id"],
                "manager": owner_map.get(r["team_id"], "Unknown"),
                "round_num": to_int(r["round_num"]),
                "overall_pick": overall,
                "player_name": r["player_name"],
                "position": position,
                "total_points": pts,
                "points_rank": prank,
                "value_score": value_score,
            })

    # early-round position tendencies (rounds 1-3) per manager
    early_round_positions = defaultdict(lambda: defaultdict(int))
    for row in pick_value_rows:
        if row["round_num"] and row["round_num"] <= 3 and row["position"]:
            early_round_positions[row["team_id"]][row["position"]] += 1

    for tid, p in profiles.items():
        counts = early_round_positions.get(tid, {})
        p["early_round_position_counts"] = dict(counts)
        mine = [row for row in pick_value_rows if row["team_id"] == tid and row["value_score"] is not None]
        if mine:
            ranked_best = sorted(mine, key=lambda r: -r["value_score"])
            ranked_worst = sorted(mine, key=lambda r: r["value_score"])
            p["best_draft_pick"] = ranked_best[0]
            p["worst_draft_pick"] = ranked_worst[0]
            p["best_draft_picks_top2"] = ranked_best[:2]
            p["worst_draft_picks_top2"] = ranked_worst[:2]
            p["avg_draft_value_score"] = round(sum(r["value_score"] for r in mine) / len(mine), 2)
        else:
            p["best_draft_pick"] = None
            p["worst_draft_pick"] = None
            p["best_draft_picks_top2"] = []
            p["worst_draft_picks_top2"] = []
            p["avg_draft_value_score"] = None

    # ---------- Trades ----------
    trades_by_id = defaultdict(list)
    for r in trades:
        trades_by_id[r["trade_id"]].append(r)

    trade_summaries = []
    for tid_key, items in trades_by_id.items():
        season = items[0]["season"]
        involved_teams = set()
        for it in items:
            involved_teams.add(it["from_team_id"])
            involved_teams.add(it["to_team_id"])
        team_net = {}
        for team in involved_teams:
            received = [it for it in items if it["to_team_id"] == team]
            given = [it for it in items if it["from_team_id"] == team]

            def rest_of_season_points(item):
                ps = pstat_lookup.get((item["season"], item["player_id"]))
                if not ps or not ps["weekly_points"]:
                    return 0.0
                sp = to_int(item["scoring_period"])
                total = 0.0
                for chunk in ps["weekly_points"].split(";"):
                    if not chunk:
                        continue
                    wk, pts = chunk.split(":")
                    if to_int(wk) >= sp:
                        total += to_float(pts)
                return total

            recv_pts = sum(rest_of_season_points(it) for it in received)
            give_pts = sum(rest_of_season_points(it) for it in given)
            team_net[team] = {
                "received_players": [it["player_name"] for it in received],
                "given_players": [it["player_name"] for it in given],
                "rest_of_season_points_received": round(recv_pts, 1),
                "rest_of_season_points_given": round(give_pts, 1),
                "net": round(recv_pts - give_pts, 1),
            }
        if len(team_net) < 2:
            continue
        nets = [v["net"] for v in team_net.values()]
        lopsidedness = round(max(nets) - min(nets), 1)
        trade_summaries.append({
            "trade_id": tid_key,
            "season": season,
            "teams": {owner_map.get(t, t): v for t, v in team_net.items()},
            "team_ids": list(involved_teams),
            "lopsidedness": lopsidedness,
        })

    trade_counts = defaultdict(int)
    for tid_key, items in trades_by_id.items():
        involved = set()
        for it in items:
            involved.add(it["from_team_id"])
            involved.add(it["to_team_id"])
        for team in involved:
            trade_counts[team] += 1

    for tid, p in profiles.items():
        p["trade_count"] = trade_counts.get(tid, 0)

    # per-manager trade ledger (all trades, with net rest-of-season result)
    for tid, p in profiles.items():
        manager_name = p["manager"]
        mine = [t for t in trade_summaries if manager_name in t["teams"]]
        ledger = []
        for t in mine:
            v = t["teams"][manager_name]
            other_managers = [m for m in t["teams"] if m != manager_name]
            ledger.append({
                "season": t["season"],
                "trade_id": t["trade_id"],
                "counterparty": ", ".join(other_managers),
                "received": v["received_players"],
                "given": v["given_players"],
                "net": v["net"],
            })
        ledger.sort(key=lambda x: -x["net"])
        p["trade_ledger"] = ledger
        p["trades_won"] = sum(1 for x in ledger if x["net"] > 0)
        p["trades_lost"] = sum(1 for x in ledger if x["net"] < 0)
        p["trades_net_total"] = round(sum(x["net"] for x in ledger), 1)

    # ---------- Waivers ----------
    waiver_counts = defaultdict(int)
    waiver_pickups = []
    for r in waivers:
        if r["status"] != "EXECUTED":
            continue
        waiver_counts[r["team_id"]] += 1
        ids = [x for x in r["players_added_ids"].split(";") if x and x != "None"]
        for pid in ids:
            ps = pstat_lookup.get((r["season"], pid))
            if not ps or not ps["weekly_points"]:
                continue
            sp = to_int(r["scoring_period"])
            total = 0.0
            for chunk in ps["weekly_points"].split(";"):
                if not chunk:
                    continue
                wk, pts = chunk.split(":")
                if to_int(wk) >= sp:
                    total += to_float(pts)
            waiver_pickups.append({
                "season": r["season"],
                "team_id": r["team_id"],
                "manager": owner_map.get(r["team_id"], "Unknown"),
                "player_name": ps["player_name"],
                "position": ps["position"],
                "scoring_period_added": sp,
                "rest_of_season_points": round(total, 1),
                "bid_amount": to_float(r["bid_amount"]),
            })

    for tid, p in profiles.items():
        p["waiver_add_count"] = waiver_counts.get(tid, 0)
        mine = [w for w in waiver_pickups if w["team_id"] == tid]
        if mine:
            best = max(mine, key=lambda r: r["rest_of_season_points"])
            p["best_waiver_pickup"] = best
        else:
            p["best_waiver_pickup"] = None

    # ---------- League-wide superlatives ----------
    all_pickups_sorted = sorted(waiver_pickups, key=lambda r: -r["rest_of_season_points"])
    all_picks_sorted = sorted(
        [r for r in pick_value_rows if r["value_score"] is not None], key=lambda r: -r["value_score"]
    )
    worst_picks_sorted = sorted(
        [r for r in pick_value_rows if r["value_score"] is not None], key=lambda r: r["value_score"]
    )
    trades_sorted = sorted(trade_summaries, key=lambda t: -t["lopsidedness"])

    luckiest_season = max(
        ((tid, season, d) for tid, seasons in luck_by_team_season_out.items() for season, d in seasons.items()),
        key=lambda x: x[2]["luck"],
        default=None,
    )
    unluckiest_season = min(
        ((tid, season, d) for tid, seasons in luck_by_team_season_out.items() for season, d in seasons.items()),
        key=lambda x: x[2]["luck"],
        default=None,
    )

    superlatives = {
        "best_draft_pick_ever": all_picks_sorted[0] if all_picks_sorted else None,
        "worst_draft_pick_ever": worst_picks_sorted[0] if worst_picks_sorted else None,
        "biggest_lopsided_trade": trades_sorted[0] if trades_sorted else None,
        "best_waiver_pickup_ever": all_pickups_sorted[0] if all_pickups_sorted else None,
        "luckiest_season": {
            "team_id": luckiest_season[0], "manager": owner_map.get(luckiest_season[0]),
            "season": luckiest_season[1], **luckiest_season[2]
        } if luckiest_season else None,
        "unluckiest_season": {
            "team_id": unluckiest_season[0], "manager": owner_map.get(unluckiest_season[0]),
            "season": unluckiest_season[1], **unluckiest_season[2]
        } if unluckiest_season else None,
    }

    output = {
        "profiles": profiles,
        "h2h": h2h_out,
        "superlatives": superlatives,
        "trade_summaries": trade_summaries,
        "top_waiver_pickups": all_pickups_sorted[:20],
        "top_draft_steals": all_picks_sorted[:20],
        "top_draft_busts": worst_picks_sorted[:20],
        "season_num_teams": season_num_teams,
        "owner_map": owner_map,
        "current_team_ids": current_team_ids,
    }

    out_path = os.path.join(DATA_DIR, "analysis.json")
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2, default=str)
    print(f"wrote {out_path}")

    # quick sanity print
    for tid in current_team_ids:
        p = profiles[tid]
        print(f"{p['manager']:20s} rec={p['wins']}-{p['losses']}-{p['ties']} "
              f"avg_finish={p['avg_finish']} champs={p['championships']} last={p['last_place_finishes']} "
              f"luck={p['luck_all_time']}")


if __name__ == "__main__":
    main()
