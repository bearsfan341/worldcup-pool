export const ALL_TEAMS = [
  // Group A
  { name: "Mexico",               group: "A", iso: "mx"     },
  { name: "South Korea",          group: "A", iso: "kr"     },
  { name: "South Africa",         group: "A", iso: "za"     },
  { name: "Czechia",              group: "A", iso: "cz"     },
  // Group B
  { name: "Canada",               group: "B", iso: "ca"     },
  { name: "Switzerland",          group: "B", iso: "ch"     },
  { name: "Qatar",                group: "B", iso: "qa"     },
  { name: "Bosnia",       group: "B", iso: "ba"     },
  // Group C
  { name: "Brazil",               group: "C", iso: "br"     },
  { name: "Morocco",              group: "C", iso: "ma"     },
  { name: "Scotland",             group: "C", iso: "gb-sct" },
  { name: "Haiti",                group: "C", iso: "ht"     },
  // Group D
  { name: "USA",                  group: "D", iso: "us"     },
  { name: "Australia",            group: "D", iso: "au"     },
  { name: "Paraguay",             group: "D", iso: "py"     },
  { name: "Türkiye",              group: "D", iso: "tr"     },
  // Group E
  { name: "Germany",              group: "E", iso: "de"     },
  { name: "Ecuador",              group: "E", iso: "ec"     },
  { name: "Ivory Coast",          group: "E", iso: "ci"     },
  { name: "Curaçao",              group: "E", iso: "cw"     },
  // Group F
  { name: "Netherlands",          group: "F", iso: "nl"     },
  { name: "Japan",                group: "F", iso: "jp"     },
  { name: "Tunisia",              group: "F", iso: "tn"     },
  { name: "Sweden",               group: "F", iso: "se"     },
  // Group G
  { name: "Belgium",              group: "G", iso: "be"     },
  { name: "Iran",                 group: "G", iso: "ir"     },
  { name: "Egypt",                group: "G", iso: "eg"     },
  { name: "New Zealand",          group: "G", iso: "nz"     },
  // Group H
  { name: "Spain",                group: "H", iso: "es"     },
  { name: "Uruguay",              group: "H", iso: "uy"     },
  { name: "Saudi Arabia",         group: "H", iso: "sa"     },
  { name: "Cape Verde",           group: "H", iso: "cv"     },
  // Group I
  { name: "France",               group: "I", iso: "fr"     },
  { name: "Senegal",              group: "I", iso: "sn"     },
  { name: "Norway",               group: "I", iso: "no"     },
  { name: "Iraq",                 group: "I", iso: "iq"     },
  // Group J
  { name: "Argentina",            group: "J", iso: "ar"     },
  { name: "Austria",              group: "J", iso: "at"     },
  { name: "Algeria",              group: "J", iso: "dz"     },
  { name: "Jordan",               group: "J", iso: "jo"     },
  // Group K
  { name: "Portugal",             group: "K", iso: "pt"     },
  { name: "Colombia",             group: "K", iso: "co"     },
  { name: "Uzbekistan",           group: "K", iso: "uz"     },
  { name: "DR Congo",             group: "K", iso: "cd"     },
  // Group L
  { name: "England",              group: "L", iso: "gb-eng" },
  { name: "Croatia",              group: "L", iso: "hr"     },
  { name: "Panama",               group: "L", iso: "pa"     },
  { name: "Ghana",                group: "L", iso: "gh"     },
];

export const POINT_SYSTEM = {
  groupWin: 3, groupDraw: 1, groupLoss: 0,
  r32: 5, r16: 8, qf: 13, sf: 21, final: 34, champion: 55,
};

export const ADVANCEMENT_BONUS = {
  group: 0, r32: 5, r16: 13, qf: 26, sf: 47, final: 81, champion: 136,
};

export const COLORS = [
  "#e63946","#f4a261","#2a9d8f","#457b9d",
  "#a8dadc","#e9c46a","#264653","#8ecae6",
  "#95d5b2","#cdb4db","#ffb703","#606c38",
];

export const GROUPS = ["A","B","C","D","E","F","G","H","I","J","K","L"];

export function flagUrl(iso, size = 40) {
  return `https://flagcdn.com/w${size}/${iso}.png`;
}

export function getSnakeOrder(numPlayers, totalPicks) {
  const order = [];
  let round = 0;
  while (order.length < totalPicks) {
    const indices = round % 2 === 0
      ? Array.from({ length: numPlayers }, (_, i) => i)
      : Array.from({ length: numPlayers }, (_, i) => numPlayers - 1 - i);
    for (const idx of indices) {
      if (order.length < totalPicks) order.push(idx);
    }
    round++;
  }
  return order;
}

export function calcPlayerPoints(playerIdx, draft, scores) {
  const teams = draft
    .filter(d => d.playerIdx === playerIdx)
    .map(d => ALL_TEAMS[d.teamIdx]);
  let groupPts = 0, bonusPts = 0, goals = 0;
  teams.forEach(t => {
    const s = scores[t.name];
    if (!s) return;
    groupPts += (s.w || 0) * POINT_SYSTEM.groupWin + (s.d || 0) * POINT_SYSTEM.groupDraw;
    bonusPts += ADVANCEMENT_BONUS[s.advancement] || 0;
    goals += s.gf || 0;
  });
  return { pts: groupPts + bonusPts, groupPts, bonusPts, goals, teams };
}

// Build a sorted leaderboard with competition ranking (ties share a rank) and
// each player's point gap behind the leader.
export function buildStandings(players, draft, scores) {
  const rows = players
    .map((name, idx) => ({ name, idx, ...calcPlayerPoints(idx, draft, scores) }))
    .sort((a, b) => b.pts - a.pts || b.goals - a.goals);
  const leaderPts = rows.length ? rows[0].pts : 0;
  let prevPts = null, prevGoals = null, prevRank = 0;
  rows.forEach((r, i) => {
    if (r.pts === prevPts && r.goals === prevGoals) {
      r.rank = prevRank;          // tie → same rank as the player above
    } else {
      r.rank = i; prevRank = i; prevPts = r.pts; prevGoals = r.goals;
    }
    r.gap = leaderPts - r.pts;
  });
  return rows;
}
