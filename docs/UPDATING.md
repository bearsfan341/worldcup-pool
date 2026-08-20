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
