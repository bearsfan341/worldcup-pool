"""
Pull all available ESPN fantasy football league history for analysis.
Writes raw CSVs to fantasy/data/ so nothing needs to be re-pulled from ESPN.
"""
import csv
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import LEAGUE_ID, SWID, ESPN_S2  # noqa: E402
from espn_api.football import League  # noqa: E402

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

SEASONS = list(range(2015, 2026))  # 2026 has no draft/season data yet
TRANSACTIONS_MIN_YEAR = 2018  # ESPN's transaction log doesn't go back further
MAX_WEEK = 18


def log(msg):
    print(msg, flush=True)


def get_league(year):
    return League(league_id=LEAGUE_ID, year=year, espn_s2=ESPN_S2, swid=SWID)


def owner_identity(team):
    """Return (owner_id, owner_name) using the primary listed owner."""
    if team.owners:
        o = team.owners[0]
        first = (o.get("firstName") or "").strip()
        last = (o.get("lastName") or "").strip()
        name = (first + " " + last).strip()
        if not name:
            name = o.get("displayName", "Unknown")
        return o.get("id", "Unknown"), name
    return "Unknown", "Unknown"


def write_csv(filename, rows, fieldnames):
    path = os.path.join(DATA_DIR, filename)
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    log(f"  wrote {path} ({len(rows)} rows)")


def pull_standings(year, league):
    rows = []
    for t in league.teams:
        oid, oname = owner_identity(t)
        rows.append(
            {
                "season": year,
                "team_id": t.team_id,
                "team_name": t.team_name.strip(),
                "owner_id": oid,
                "owner_name": oname,
                "wins": t.wins,
                "losses": t.losses,
                "ties": t.ties,
                "points_for": t.points_for,
                "points_against": t.points_against,
                "reg_season_standing": t.standing,
                "final_standing": t.final_standing,
                "reg_season_count": league.settings.reg_season_count,
                "playoff_team_count": league.settings.playoff_team_count,
                "num_teams": len(league.teams),
            }
        )
    return rows


def pull_matchups(year, league):
    rows = []
    for week in range(1, MAX_WEEK + 1):
        try:
            sb = league.scoreboard(week=week)
        except Exception as e:
            log(f"    week {week} scoreboard error: {e}")
            continue
        for m in sb:
            home = getattr(m, "home_team", None)
            away = getattr(m, "away_team", None)
            if home is None or away is None:
                continue  # bye
            hoid, honame = owner_identity(home)
            aoid, aoname = owner_identity(away)
            rows.append(
                {
                    "season": year,
                    "week": week,
                    "matchup_type": m.matchup_type,
                    "is_playoff": m.is_playoff,
                    "home_team_id": home.team_id,
                    "home_team_name": home.team_name.strip(),
                    "home_owner_id": hoid,
                    "home_owner_name": honame,
                    "home_score": m.home_score,
                    "away_team_id": away.team_id,
                    "away_team_name": away.team_name.strip(),
                    "away_owner_id": aoid,
                    "away_owner_name": aoname,
                    "away_score": m.away_score,
                }
            )
    return rows


def pull_draft(year, league):
    rows = []
    team_lookup = {t.team_id: t for t in league.teams}
    for pick in league.draft:
        team = pick.team
        oid, oname = ("Unknown", "Unknown")
        if team is not None:
            oid, oname = owner_identity(team)
        overall = None
        try:
            teams_n = len(league.teams)
            overall = (pick.round_num - 1) * teams_n + pick.round_pick
        except Exception:
            pass
        rows.append(
            {
                "season": year,
                "round_num": pick.round_num,
                "round_pick": pick.round_pick,
                "overall_pick": overall,
                "team_id": team.team_id if team else None,
                "team_name": team.team_name.strip() if team else None,
                "owner_id": oid,
                "owner_name": oname,
                "player_id": pick.playerId,
                "player_name": pick.playerName,
                "bid_amount": pick.bid_amount,
                "keeper_status": pick.keeper_status,
            }
        )
    return rows


def pull_transactions_raw(year, league):
    """Returns raw dedup'd transaction dicts across all weeks, both trade and waiver/FA filter sets."""
    if year < TRANSACTIONS_MIN_YEAR:
        return [], "no_transaction_data_before_2018"

    seen_ids = set()
    all_tx = []
    filter_sets = [
        {"TRADE_ACCEPT"},
        {"FREEAGENT", "WAIVER", "WAIVER_ERROR"},
    ]
    for week in range(1, MAX_WEEK + 1):
        for types in filter_sets:
            try:
                params = {"view": "mTransactions2", "scoringPeriodId": week}
                filters = {"transactions": {"filterType": {"value": list(types)}}}
                headers = {"x-fantasy-filter": json.dumps(filters)}
                data = league.espn_request.league_get(params=params, headers=headers)
                txs = data.get("transactions", [])
            except Exception as e:
                log(f"    week {week} transactions({types}) error: {e}")
                continue
            for t in txs:
                tid = t.get("id")
                if tid in seen_ids:
                    continue
                seen_ids.add(tid)
                all_tx.append(t)
            time.sleep(0.05)
    return all_tx, None


def build_trades_waivers(year, league, raw_tx):
    team_lookup = {t.team_id: t for t in league.teams}

    def team_name_owner(team_id):
        if team_id == 0 or team_id is None:
            return "FREE AGENT", "Unknown", "Unknown"
        t = team_lookup.get(team_id)
        if t is None:
            return f"team_{team_id}", "Unknown", "Unknown"
        oid, oname = owner_identity(t)
        return t.team_name.strip(), oid, oname

    trades = []
    waivers = []

    for t in raw_tx:
        ttype = t.get("type")
        status = t.get("status")
        date = t.get("processDate") or t.get("proposedDate")
        scoring_period = t.get("scoringPeriodId")
        tx_id = t.get("id")
        bid = t.get("bidAmount", 0)
        acting_team_id = t.get("teamId")
        acting_team_name, acting_oid, acting_oname = team_name_owner(acting_team_id)

        if ttype == "TRADE_ACCEPT":
            for item in t.get("items", []):
                if item.get("type") != "TRADE":
                    continue
                from_name, from_oid, from_oname = team_name_owner(item.get("fromTeamId"))
                to_name, to_oid, to_oname = team_name_owner(item.get("toTeamId"))
                player_id = item.get("playerId")
                trades.append(
                    {
                        "season": year,
                        "trade_id": tx_id,
                        "date_epoch_ms": date,
                        "scoring_period": scoring_period,
                        "status": status,
                        "from_team_id": item.get("fromTeamId"),
                        "from_team_name": from_name,
                        "from_owner_id": from_oid,
                        "from_owner_name": from_oname,
                        "to_team_id": item.get("toTeamId"),
                        "to_team_name": to_name,
                        "to_owner_id": to_oid,
                        "to_owner_name": to_oname,
                        "player_id": player_id,
                        "player_name": league.player_map.get(player_id, "Unknown"),
                    }
                )
        elif ttype in ("FREEAGENT", "WAIVER", "WAIVER_ERROR"):
            add_items = [i for i in t.get("items", []) if i.get("type") == "ADD"]
            drop_items = [i for i in t.get("items", []) if i.get("type") == "DROP"]
            add_names = [league.player_map.get(i.get("playerId"), "Unknown") for i in add_items]
            drop_names = [league.player_map.get(i.get("playerId"), "Unknown") for i in drop_items]
            waivers.append(
                {
                    "season": year,
                    "transaction_id": tx_id,
                    "date_epoch_ms": date,
                    "scoring_period": scoring_period,
                    "type": ttype,
                    "status": status,
                    "bid_amount": bid,
                    "team_id": acting_team_id,
                    "team_name": acting_team_name,
                    "owner_id": acting_oid,
                    "owner_name": acting_oname,
                    "players_added": "; ".join(add_names),
                    "players_dropped": "; ".join(drop_names),
                }
            )

    return trades, waivers


def main():
    standings_all, matchups_all, draft_all, trades_all, waivers_all = [], [], [], [], []
    gaps = []

    for year in SEASONS:
        log(f"=== {year} ===")
        try:
            league = get_league(year)
        except Exception as e:
            log(f"  FAILED to load league: {e}")
            gaps.append(f"{year}: could not load league ({e})")
            continue

        standings_all += pull_standings(year, league)
        matchups_all += pull_matchups(year, league)
        draft_all += pull_draft(year, league)

        raw_tx, gap_reason = pull_transactions_raw(year, league)
        if gap_reason:
            gaps.append(f"{year}: {gap_reason}")
        trades, waivers = build_trades_waivers(year, league, raw_tx)
        trades_all += trades
        waivers_all += waivers
        log(f"  standings rows so far / draft picks: {len(league.teams)} teams, "
            f"{len(league.draft)} draft picks, {len(trades)} trade items, {len(waivers)} waiver txns")

    write_csv(
        "standings.csv",
        standings_all,
        [
            "season", "team_id", "team_name", "owner_id", "owner_name",
            "wins", "losses", "ties", "points_for", "points_against",
            "reg_season_standing", "final_standing", "reg_season_count",
            "playoff_team_count", "num_teams",
        ],
    )
    write_csv(
        "matchups.csv",
        matchups_all,
        [
            "season", "week", "matchup_type", "is_playoff",
            "home_team_id", "home_team_name", "home_owner_id", "home_owner_name", "home_score",
            "away_team_id", "away_team_name", "away_owner_id", "away_owner_name", "away_score",
        ],
    )
    write_csv(
        "draft.csv",
        draft_all,
        [
            "season", "round_num", "round_pick", "overall_pick",
            "team_id", "team_name", "owner_id", "owner_name",
            "player_id", "player_name", "bid_amount", "keeper_status",
        ],
    )
    write_csv(
        "trades.csv",
        trades_all,
        [
            "season", "trade_id", "date_epoch_ms", "scoring_period", "status",
            "from_team_id", "from_team_name", "from_owner_id", "from_owner_name",
            "to_team_id", "to_team_name", "to_owner_id", "to_owner_name",
            "player_id", "player_name",
        ],
    )
    write_csv(
        "waivers.csv",
        waivers_all,
        [
            "season", "transaction_id", "date_epoch_ms", "scoring_period",
            "type", "status", "bid_amount", "team_id", "team_name",
            "owner_id", "owner_name", "players_added", "players_dropped",
        ],
    )

    gaps_path = os.path.join(DATA_DIR, "DATA_GAPS.txt")
    with open(gaps_path, "w") as f:
        if gaps:
            f.write("Known data gaps / limitations from this pull:\n\n")
            for g in gaps:
                f.write(f"- {g}\n")
        else:
            f.write("No known gaps.\n")
    log(f"Wrote {gaps_path}")
    log("DONE")


if __name__ == "__main__":
    main()
