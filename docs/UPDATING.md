# Updating the site

The site is a single self-contained file: `docs/index.html`. Edit it, commit,
push — GitHub Pages rebuilds in about a minute at
<https://bearsfan341.github.io/worldcup-pool/>.

## Adding a weekly recap

Find `var WEEKS = [` in the `<script>` block near the bottom of the file and add
the newest week **to the top** of the array:

```js
var WEEKS = [
  {
    season: 2026,
    week:   3,
    date:   "Sep 29, 2026",
    headline: "Marcks finally loses one",
    paras: [
      ["The streak is over.", "Johnny Marcks dropped his first game since week 11 of last year, 118.4 to 131.0."],
      ["Gamble is back.", "Three straight wins after last season's collapse."]
    ],
    games: [
      ["Corey Ploss", 131.0, "Johnny Marcks", 118.4],
      ["Dustin Gamble", 142.6, "Kyle Torpey", 99.8]
    ]
  },
  // ...older weeks stay below, untouched
];
```

Field notes:

- **`paras`** — each entry is `[lead-in, rest]`. The lead-in is bolded for you.
- **`games`** — **winner first**: `[winner, winnerScore, loser, loserScore]`.
  The winner is emphasized and their score turns green automatically.
  Omit `games` entirely if you only want prose.
- **`date`** — also becomes the "updated" stamp in the header.

Everything else derives itself: the `Week N Recap` heading, the hero eyebrow,
the "Earlier Weeks" archive, and which week is featured on top. You never touch
those.

Before the first week is added, `WEEKS` is empty and the section shows a
"season hasn't kicked off yet" placeholder.

## Adding a data table

Tables are declared once and render on both desktop and mobile:

```js
renderTable("#some-table", [
  { label: "Rank",    cls: "num", cell: "rank"  },
  { label: "Manager", cls: "mgr", cell: "title" },
  { label: "Win%",    cls: "num" }
], ROWS);
```

`cell` controls the **mobile card** layout only — below 700px each row becomes a
labelled card instead of a clipped, side-scrolling table row:

| `cell` | Mobile rendering |
|---|---|
| `"rank"` | small accent eyebrow at the top of the card |
| `"title"` | the card's heading |
| `"wide"` | full-width row, label above the value (for long text) |
| *(omitted)* | half-width `LABEL — value` pair |

The column order in the array must match the `<thead>` order in the HTML;
mobile ordering is handled by CSS, so you never reorder columns to fix layout.

## Regenerating the Claude artifact copy

The artifact at claude.ai hosts the same page without the `<html>/<head>/<body>`
wrapper (its host supplies one). To refresh it after editing `index.html`:

```
python3 fantasy/scripts/make_artifact_copy.py
```

Then publish the generated file. If you have stopped using the artifact, this
step can be skipped entirely — the GitHub Pages site is self-sufficient.

## Regenerating the post-draft analysis

Four steps, in order:

```
python3 fantasy/scripts/parse_ecr.py <cheatsheet.pdf>   # only when ECR changes
python3 fantasy/scripts/pull_draft_2026.py              # ESPN draft, rosters, ADP, projections
python3 fantasy/scripts/analyze_draft.py                # -> data/draft_analysis.json
python3 fantasy/scripts/build_draft_section.py          # injects it into docs/index.html
```

Scoring is entirely ESPN: ADP for pick value, season projections for team
grades. `parse_ecr.py` and `data/ecr_2026.json` are kept for reference but are
no longer part of the pipeline. `player_match.py` still handles name mismatches
(Jr./II suffixes, defense naming — "Chiefs D/ST" vs "Kansas City Chiefs").

Pick value is normalised **per position**: quarterbacks slide in a one-QB
league, so a league-wide baseline filled all ten "best picks" with QBs. Team
grades are curved off projected starting points rather than ADP value — beating
the market and building a high-scoring roster correlate at only r=+0.12, and
grading on ADP produced an A- team ranked 11th.

Roster metrics deliberately use **as-drafted** rosters, so the section stays a
snapshot of draft night instead of drifting as waiver moves happen. A player
drafted and later dropped still resolves via the league-wide projection cache
in `data/espn_players_2026.json`.

## Weekly game preview

```
python3 fantasy/scripts/pull_week.py [week]     # -> data/week_preview.json
python3 fantasy/scripts/build_draft_section.py  # injects draft + week data
```

The "This Week" section shows the upcoming preview while `WEEKS` is empty and
switches to recaps once you add entries. Preview projections are ESPN's own
weekly starter projections, not a model of ours.

**Caution on string replacement:** `build_draft_section.py` overwrites the
`DRAFT_DATA` / `WEEK_DATA` blocks, so any hand edit anchored on `var DRAFT =
null;` will silently no-op after a build has run. Assert your match count.
