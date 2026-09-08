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
TRADE_FRICTION, RB_PREMIUM = 0.85, 1.15

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


def main():
    picks, rosters, _ = load()
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
        surplus = sum(x["proj"] for x in pl
                      if x["pos"] == "RB" and x["player"] not in used and x["proj"] > 120)
        c, gaps = collections.Counter(), []
        for x in start:
            c[x["pos"]] += 1
            k = f'{x["pos"]}{c[x["pos"]]}'
            if x["pos"] in FLEX:
                gaps.append((med[k] - x["proj"], k, x["player"]))
        gaps.sort(reverse=True)
        hole = gaps[0] if gaps else (0, "", "")
        gain = round(min(surplus * RB_PREMIUM * TRADE_FRICTION, max(0.0, hole[0])), 1) if surplus else 0.0
        bust_pts = sum(x["proj"] for x in core if x["player"] in BUSTS)
        sk = [x for x in pl if x["pos"] not in ("K", "D/ST") and x["val"] is not None]
        rb = sorted([x["proj"] for x in start if x["pos"] == "RB"], reverse=True)
        wr = sorted([x["proj"] for x in start if x["pos"] == "WR"], reverse=True)
        teams[m] = {
            "manager": m,
            "starters_proj": round(base, 1),
            "trade_gain": gain,
            "adjusted_proj": round(base + gain, 1),
            "rb_starters": round(sum(rb[:2]), 1),
            "wr_starters": round(sum(wr[:2]), 1),
            "skill_starters": round(sum(x["proj"] for x in start if x["pos"] in FLEX), 1),
            "rb_surplus": round(surplus, 1),
            "biggest_hole": {"slot": hole[1], "player": hole[2], "gap": round(hole[0], 1)},
            "bust_share": round(100 * bust_pts / sum(x["proj"] for x in core), 1),
            "bust_players": sorted(x["player"] for x in core if x["player"] in BUSTS),
            "draft_value": round(statistics.mean(x["val"] for x in sk), 1),
            "best_pick": max(sk, key=lambda z: z["val"])["player"],
            "worst_pick": min(sk, key=lambda z: z["val"])["player"],
            "pos_counts": dict(collections.Counter(x["pos"] for x in pl)),
        }

    def rank(key, hi):
        order = sorted(teams, key=lambda m: -teams[m][key] if hi else teams[m][key])
        return {m: i + 1 for i, m in enumerate(order)}

    r_ros = rank("adjusted_proj", True)
    r_bust = rank("bust_share", False)
    r_draft = rank("draft_value", True)
    r_rec = {m: i + 1 for i, m in enumerate(sorted(RECENT, key=RECENT.get))}
    r_car = {m: i + 1 for i, m in enumerate(sorted(CAREER, key=CAREER.get))}
    for m, t in teams.items():
        t["ranks"] = {"roster": r_ros[m], "bust": r_bust[m], "draft": r_draft[m],
                      "recent": r_rec[m], "career": r_car[m]}
        t["composite"] = round(r_ros[m] * .40 + r_bust[m] * .15 + r_draft[m] * .15
                               + r_rec[m] * .20 + r_car[m] * .10, 2)
    order = sorted(teams, key=lambda m: teams[m]["composite"])
    for i, m in enumerate(order, 1):
        teams[m]["power_rank"] = i

    ranked = sorted((p for p in picks if p["val"] is not None), key=lambda z: z["val"])
    out = {
        "season": 2026, "league_id": 684189, "teams": TEAMS, "picks": len(picks),
        "league_pace_vs_ecr": round(pace, 1),
        "positional_premium": premium,
        "board": [{k: p[k] for k in ("overall", "round", "pick", "manager", "player",
                                     "pos", "pro_team", "ecr", "ecr_pos", "proj", "val", "injury")}
                  for p in picks],
        "best_picks": [p["player"] for p in ranked[::-1][:10]],
        "worst_picks": [p["player"] for p in ranked[:10]],
        "teams": [teams[m] for m in order],
    }
    path = os.path.join(DATA, "draft_analysis.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=1)
    print(f"wrote {path}")
    print(f"  league drafts {-pace:.1f} picks ahead of ECR")
    print("  positional premium (pick - ECR): " +
          ", ".join(f'{k} {v["mean"]:+.1f}' for k, v in premium.items()))
    print(f'\n  {"#":>2} {"manager":<19}{"adjProj":>9}{"bust%":>7}{"draft":>7}')
    for m in order:
        t = teams[m]
        print(f'  {t["power_rank"]:>2} {m:<19}{t["adjusted_proj"]:>9.0f}'
              f'{t["bust_share"]:>6.1f}%{t["draft_value"]:>7.1f}')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
