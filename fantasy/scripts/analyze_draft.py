"""Post-draft analysis, scored entirely off ESPN.

One source, so nothing contradicts itself:
  - value per pick   = draft slot vs ESPN ADP, normalised to this league's pace
  - team grade       = projected starting lineup, curved
  - power rank       = the same projection, plus live points once games are played

Draft value is reported per pick (steal / reach) but does NOT drive the team
grade. Beating ADP and building a high-scoring roster are only weakly related
(r = +0.12), so grading on ADP produced an A- team ranked 11th. The grade now
reflects the team a manager actually ended up with.

Kickers and defenses are excluded from value scoring: ADP ranks them late but
every roster must carry one, which otherwise makes a mandatory round-14 defense
look like the worst pick of the draft.

Roster metrics use AS-DRAFTED rosters so the section stays a snapshot of draft
night rather than drifting with waivers.

Writes data/draft_analysis.json.
"""
import collections
import csv
import json
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(HERE)
DATA = os.path.join(BASE, "data")
sys.path.insert(0, HERE)
from player_match import build_index, match  # noqa: E402

TEAMS = 12
STARTERS = (("QB", 1), ("RB", 2), ("WR", 2), ("TE", 1), ("K", 1), ("D/ST", 1))
FLEX = ("RB", "WR", "TE")
SKIP = ("K", "D/ST")


def live_points():
    try:
        sys.path.insert(0, BASE)
        from config import LEAGUE_ID, SWID, ESPN_S2
        from espn_api.football import League
        lg = League(league_id=LEAGUE_ID, year=2026, espn_s2=ESPN_S2, swid=SWID)
        owners = {int(r["team_id"]): r["canonical_manager"]
                  for r in csv.DictReader(open(os.path.join(DATA, "owner_map.csv")))}
        return {owners[t.team_id]: round(t.points_for, 1) for t in lg.teams}
    except Exception as e:
        print(f"  (live points unavailable: {e})", file=sys.stderr)
        return {}


def load():
    picks = list(csv.DictReader(open(os.path.join(DATA, "draft_2026.csv"))))
    roster = {r["player"]: r for r in
              csv.DictReader(open(os.path.join(DATA, "roster_2026.csv")))}
    pool = json.load(open(os.path.join(DATA, "espn_players_2026.json")))
    idx, lastn = build_index(pool.keys())
    for p in picks:
        p["overall"] = int(p["overall"])
        p["round"] = int(p["round"])
        r = roster.get(p["player"], {})
        m = match(p["player"], idx, lastn)
        e = pool.get(m) or {}
        p["pos"] = r.get("position") or e.get("pos") or "?"
        p["proj"] = float(r["proj"]) if r.get("proj") else (e.get("proj") or 0.0)
        p["adp"] = e.get("adp")
        p["injury"] = r.get("injury", "")
        p["pro_team"] = r.get("pro_team", "")
    return picks


def lineup(players):
    pool = {pos: sorted([x for x in players if x["pos"] == pos], key=lambda z: -z["proj"])
            for pos in ("QB", "RB", "WR", "TE", "K", "D/ST")}
    out = []
    for pos, n in STARTERS:
        out += pool[pos][:n]
    used = {x["player"] for x in out}
    rest = sorted([x for x in players if x["pos"] in FLEX and x["player"] not in used],
                  key=lambda z: -z["proj"])
    if rest:
        out.append(rest[0])
    return out


def main():
    picks = load()
    points_for = live_points()
    rosters = collections.defaultdict(list)
    for p in picks:
        rosters[p["manager"]].append(p)

    # Normalise per position, not league-wide. Quarterbacks slide in a 1-QB
    # format, so a league-wide baseline made every late QB look like a steal
    # and filled all ten "best picks" with quarterbacks. Comparing a QB only
    # against how far QBs actually slide here keeps the list meaningful.
    scored = [p for p in picks if p["adp"] and p["pos"] not in SKIP]
    pace = statistics.mean(p["overall"] - p["adp"] for p in scored)
    pos_pace = {}
    for pos in {p["pos"] for p in scored}:
        g = [p["overall"] - p["adp"] for p in scored if p["pos"] == pos]
        pos_pace[pos] = statistics.mean(g)
    for p in picks:
        p["val"] = (round(p["overall"] - p["adp"] - pos_pace[p["pos"]], 1)
                    if (p["adp"] and p["pos"] not in SKIP) else None)

    teams = {}
    for m, pl in rosters.items():
        start = lineup(pl)
        starters_proj = sum(x["proj"] for x in start)
        sk = [x for x in pl if x["val"] is not None]
        rb = sorted([x["proj"] for x in start if x["pos"] == "RB"], reverse=True)
        wr = sorted([x["proj"] for x in start if x["pos"] == "WR"], reverse=True)
        teams[m] = {
            "manager": m,
            "starters_proj": round(starters_proj, 1),
            "points_for": points_for.get(m, 0.0),
            "rb_starters": round(sum(rb[:2]), 1),
            "wr_starters": round(sum(wr[:2]), 1),
            "draft_value": round(statistics.mean(x["val"] for x in sk), 1),
            "best_pick": max(sk, key=lambda z: z["val"])["player"],
            "worst_pick": min(sk, key=lambda z: z["val"])["player"],
            "flagged": [x["player"] for x in pl if x["injury"] in
                        ("OUT", "INJURY_RESERVE", "SUSPENSION")],
            "lineup": [{"pos": x["pos"], "player": x["player"], "proj": x["proj"]}
                       for x in start],
        }

    # Grade and rank both come from the roster that was actually built, so a
    # high grade can never sit next to a low ranking.
    vals = [t["starters_proj"] for t in teams.values()]
    mu, sd = statistics.mean(vals), (statistics.pstdev(vals) or 1.0)
    played = any(t["points_for"] for t in teams.values())
    pmu, psd = ((statistics.mean(t["points_for"] for t in teams.values()),
                 statistics.pstdev([t["points_for"] for t in teams.values()]) or 1.0)
                if played else (0, 1))

    def grade(z):
        for cut, g in ((1.2, "A"), (0.7, "A-"), (0.3, "B+"), (0.0, "B"),
                       (-0.3, "B-"), (-0.7, "C+"), (-1.2, "C"), (-99, "D")):
            if z >= cut:
                return g

    for t in teams.values():
        zp = (t["starters_proj"] - mu) / sd
        t["z_proj"] = round(zp, 2)
        t["grade"] = grade(zp)
        t["power_score"] = round(
            (0.7 * zp + 0.3 * ((t["points_for"] - pmu) / psd)) if played else zp, 3)

    order = sorted(teams, key=lambda m: -teams[m]["power_score"])
    for i, m in enumerate(order, 1):
        teams[m]["power_rank"] = i

    ranked = sorted((p for p in picks if p["val"] is not None), key=lambda z: z["val"])
    out = {
        "season": 2026, "league_id": 684189, "team_count": TEAMS, "picks": len(picks),
        "source": "ESPN ADP and ESPN season projections",
        "league_pace_vs_adp": round(pace, 1),
        "positional_pace": {k: round(v, 1) for k, v in pos_pace.items()},
        "season_started": played,
        "board": [{k: p[k] for k in ("overall", "round", "manager", "player", "pos",
                                     "adp", "proj", "val", "injury")} for p in picks],
        "teams": [teams[m] for m in order],
    }
    with open(os.path.join(DATA, "draft_analysis.json"), "w") as f:
        json.dump(out, f, indent=1)

    print(f"wrote draft_analysis.json | league drafts {-pace:.1f} picks ahead of ESPN ADP")
    print("  positional slide vs ADP: " + ", ".join(
        f"{k} {v:+.1f}" for k, v in sorted(pos_pace.items(), key=lambda z: z[1])))
    print(f'\n  {"#":>2} {"manager":<19}{"grade":>6}{"projStarters":>14}{"draftVal":>10}')
    for m in order:
        t = teams[m]
        print(f'  {t["power_rank"]:>2} {m:<19}{t["grade"]:>6}{t["starters_proj"]:>14.0f}'
              f'{t["draft_value"]:>+10.1f}')
    print("\n  biggest steals:  " + ", ".join(
        f'{p["player"]} ({p["val"]:+.0f})' for p in ranked[::-1][:3]))
    print("  biggest reaches: " + ", ".join(
        f'{p["player"]} ({p["val"]:+.0f})' for p in ranked[:3]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
