"""Post-draft analysis: grade every pick and roster against FantasyPros ECR.

Roster metrics use AS-DRAFTED rosters only (later waiver adds are excluded)
so the analysis stays a stable snapshot of draft night.

Writes data/draft_analysis.json, consumed by the site.
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

TEAMS, STARTERS = 12, (("QB", 1), ("RB", 2), ("WR", 2), ("TE", 1), ("K", 1), ("D/ST", 1))
FLEX = ("RB", "WR", "TE")

# Players FantasyPros' expert panel flagged as likely to underperform their cost.
BUSTS = {"Christian McCaffrey", "Puka Nacua", "De'Von Achane", "Ashton Jeanty",
         "Drake London", "Brock Bowers", "Jeremiyah Love", "Malik Nabers",
         "Rashee Rice", "Colston Loveland", "Ladd McConkey", "DJ Moore",
         "Drake Maye", "Joe Burrow", "TreVeyon Henderson", "Courtland Sutton",
         "Jaxson Dart", "Matthew Stafford"}

CAREER = {"Derek Booker": 4.09, "Johnny Marcks": 5.27, "Alex Topham": 5.73,
          "Angelo Hernandez": 5.91, "Tyler Scarlett": 5.91, "Jarett Coy": 6.00,
          "Andrew Campbell": 6.38, "Pj Lannon": 6.73, "Dustin Gamble": 7.18,
          "Corey Ploss": 7.45, "Kyle Torpey": 7.73, "Dakota Bender": 8.55}
RECENT = {"Angelo Hernandez": 2.0, "Derek Booker": 4.0, "Alex Topham": 5.0,
          "Tyler Scarlett": 5.0, "Johnny Marcks": 6.0, "Andrew Campbell": 6.33,
          "Dustin Gamble": 7.0, "Dakota Bender": 7.67, "Jarett Coy": 8.33,
          "Corey Ploss": 8.67, "Kyle Torpey": 9.0, "Pj Lannon": 9.0}


def load():
    picks = list(csv.DictReader(open(os.path.join(DATA, "draft_2026.csv"))))
    roster = list(csv.DictReader(open(os.path.join(DATA, "roster_2026.csv"))))
    ecr = json.load(open(os.path.join(DATA, "ecr_2026.json")))["players"]
    pool = json.load(open(os.path.join(DATA, "espn_players_2026.json")))
    pidx, plast = build_index(pool.keys())
    idx, lastn = build_index(ecr.keys())
    drafted = {r["player"] for r in picks}
    by_player = {}
    for r in roster:
        r["proj"] = float(r["proj"])
        by_player[r["player"]] = r
    for p in picks:
        p["overall"] = int(p["overall"])
        p["round"] = int(p["round"])
        info = by_player.get(p["player"], {})
        m = match(p["player"], idx, lastn)
        e = ecr.get(m) if m else None
        p["pos"] = info.get("position") or {"DST": "D/ST"}.get(
            (e or {}).get("pos"), (e or {}).get("pos")) or "?"
        p["proj"] = info.get("proj")
        if p["proj"] is None:
            # drafted then dropped: fall back to the league-wide projection cache
            pm = match(p["player"], pidx, plast)
            p["proj"] = (pool.get(pm) or {}).get("proj") or 0.0
            p["dropped"] = True
        p["pro_team"] = info.get("pro_team", "")
        p["injury"] = info.get("injury", "")
        p["ecr"] = (e or {}).get("overall")
        p["ecr_pos"] = (e or {}).get("pos_rank")
    # as-drafted rosters only
    rosters = collections.defaultdict(list)
    for p in picks:
        rosters[p["manager"]].append(p)
    return picks, rosters, drafted


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


def live_points():
    """Actual points scored so far, if the season has started."""
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


def main():
    picks, rosters, _ = load()
    points_for = live_points()
    skill = [p for p in picks if p["pos"] not in ("K", "D/ST") and p["ecr"]]
    pace = statistics.mean(p["overall"] - p["ecr"] for p in skill)
    for p in picks:
        p["val"] = round(p["overall"] - p["ecr"] - pace, 1) if p["ecr"] else None

    # positional premium: how far each position is drafted from its ECR
    premium = {}
    for pos in ("RB", "WR", "TE", "QB"):
        g = [p["overall"] - p["ecr"] for p in picks if p["pos"] == pos and p["ecr"]]
        premium[pos] = {"n": len(g), "mean": round(statistics.mean(g), 1),
                        "median": round(statistics.median(g), 1)}

    # slot medians for hole detection
    slot_p = collections.defaultdict(list)
    for m, pl in rosters.items():
        c = collections.Counter()
        for x in lineup(pl):
            c[x["pos"]] += 1
            slot_p[f'{x["pos"]}{c[x["pos"]]}'].append(x["proj"])
    med = {k: statistics.median(v) for k, v in slot_p.items()}

    teams = {}
    for m, pl in rosters.items():
        start = lineup(pl)
        used = {x["player"] for x in start}
        base = sum(x["proj"] for x in start)
        core = [x for x in start if x["pos"] in ("QB", "RB", "WR", "TE")]
        c, gaps = collections.Counter(), []
        for x in start:
            c[x["pos"]] += 1
            k = f'{x["pos"]}{c[x["pos"]]}'
            if x["pos"] in FLEX:
                gaps.append((med[k] - x["proj"], k, x["player"]))
        gaps.sort(reverse=True)
        hole = gaps[0] if gaps else (0, "", "")
        bust_pts = sum(x["proj"] for x in core if x["player"] in BUSTS)
        flagged = [x["player"] for x in pl if x["injury"] in
                   ("OUT", "INJURY_RESERVE", "SUSPENSION", "DAY_TO_DAY")]
        sk = [x for x in pl if x["pos"] not in ("K", "D/ST") and x["val"] is not None]
        rb = sorted([x["proj"] for x in start if x["pos"] == "RB"], reverse=True)
        wr = sorted([x["proj"] for x in start if x["pos"] == "WR"], reverse=True)
        st_names = {x["player"] for x in start}
        num = den = 0
        for x in pl:
            if not x["ecr"] or x["pos"] in ("K", "D/ST"):
                continue
            w = 2 if x["player"] in st_names else 1   # starters count double
            num += w * x["ecr"]
            den += w
        teams[m] = {
            "manager": m,
            "ecr_strength": round(num / den, 1),
            "points_for": points_for.get(m, 0.0),
            "starters_proj": round(base, 1),
            "rb_starters": round(sum(rb[:2]), 1),
            "wr_starters": round(sum(wr[:2]), 1),
            "skill_starters": round(sum(x["proj"] for x in start if x["pos"] in FLEX), 1),
            "biggest_hole": {"slot": hole[1], "player": hole[2], "gap": round(hole[0], 1)},
            "bust_share": round(100 * bust_pts / sum(x["proj"] for x in core), 1),
            "bust_players": sorted(x["player"] for x in core if x["player"] in BUSTS),
            "flagged": flagged,
            "draft_value": round(statistics.mean(x["val"] for x in sk), 1),
            "best_pick": max(sk, key=lambda z: z["val"])["player"],
            "worst_pick": min(sk, key=lambda z: z["val"])["player"],
            "pos_counts": dict(collections.Counter(x["pos"] for x in pl)),
        }

    def z(vals):
        mu, sd = statistics.mean(vals), (statistics.pstdev(vals) or 1.0)
        return lambda v: (v - mu) / sd

    # Draft value and ECR roster strength correlate at r=+0.96 -- they are the
    # same expert signal measured twice, so they are merged into one view rather
    # than each drawing its own weight. That view is then set against ESPN's
    # projections, which are near-uncorrelated with it (r=-0.04). Two independent
    # opinions, equal weight; a team the two disagree about lands mid-pack, which
    # is the honest treatment of genuine disagreement.
    z_draft = z([t["draft_value"] for t in teams.values()])
    z_ecr = z([-t["ecr_strength"] for t in teams.values()])
    z_proj = z([t["starters_proj"] for t in teams.values()])
    played = any(t["points_for"] for t in teams.values())
    z_pts = z([t["points_for"] for t in teams.values()]) if played else None

    W = ({"expert": 0.40, "model": 0.40, "points": 0.20} if played
         else {"expert": 0.50, "model": 0.50, "points": 0.0})

    for m, t in teams.items():
        expert = (z_draft(t["draft_value"]) + z_ecr(-t["ecr_strength"])) / 2
        model = z_proj(t["starters_proj"])
        t["z"] = {"draft": round(z_draft(t["draft_value"]), 2),
                  "ecr": round(z_ecr(-t["ecr_strength"]), 2),
                  "expert": round(expert, 2), "model": round(model, 2),
                  "points": round(z_pts(t["points_for"]), 2) if played else None}
        t["disagreement"] = round(abs(expert - model), 2)
        t["power_score"] = round(
            W["expert"] * expert + W["model"] * model
            + (W["points"] * t["z"]["points"] if played else 0.0), 3)

    def grade(zz):
        for cut, g in ((1.3, "A"), (0.8, "A-"), (0.4, "B+"), (0.0, "B"),
                       (-0.4, "B-"), (-0.8, "C+"), (-1.3, "C"), (-99, "D")):
            if zz >= cut:
                return g
    for t in teams.values():
        t["grade"] = grade(t["z"]["draft"])

    order = sorted(teams, key=lambda m: -teams[m]["power_score"])
    for i, m in enumerate(order, 1):
        teams[m]["power_rank"] = i

    ranked = sorted((p for p in picks if p["val"] is not None
                     and p["pos"] not in ("K", "D/ST")), key=lambda z: z["val"])
    out = {
        "season": 2026, "league_id": 684189, "teams": TEAMS, "picks": len(picks),
        "league_pace_vs_ecr": round(pace, 1),
        "positional_premium": premium,
        "board": [{k: p[k] for k in ("overall", "round", "pick", "manager", "player",
                                     "pos", "pro_team", "ecr", "ecr_pos", "proj", "val", "injury")}
                  for p in picks],
        "best_picks": [p["player"] for p in ranked[::-1][:10]],
        "worst_picks": [p["player"] for p in ranked[:10]],
        "weights": W,
        "component_note": "expert = mean(z draft value, z ECR strength); model = z trade-adjusted projection",
        "season_started": played,
        "teams": [teams[m] for m in order],
    }
    path = os.path.join(DATA, "draft_analysis.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=1)
    print(f"wrote {path}")
    print(f"  league drafts {-pace:.1f} picks ahead of ECR")
    print("  positional premium (pick - ECR): " +
          ", ".join(f'{k} {v["mean"]:+.1f}' for k, v in premium.items()))
    print("  weights: " + ", ".join(f"{k} {v:.2f}" for k, v in W.items()))
    print(f'\n  {"#":>2} {"manager":<19}{"gr":>4}{"expert":>8}{"model":>7}{"score":>8}{"gap":>7}')
    for m in order:
        t = teams[m]
        print(f'  {t["power_rank"]:>2} {m:<19}{t["grade"]:>4}{t["z"]["expert"]:>+8.2f}'
              f'{t["z"]["model"]:>+7.2f}{t["power_score"]:>+8.2f}{t["disagreement"]:>7.2f}')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
