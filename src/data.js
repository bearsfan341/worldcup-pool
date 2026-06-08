export const ALL_TEAMS = [
  { name: "Mexico",          group: "A", iso: "mx"     },
  { name: "South Korea",     group: "A", iso: "kr"     },
  { name: "South Africa",    group: "A", iso: "za"     },
  { name: "Czech Republic",  group: "A", iso: "cz"     },
  { name: "Canada",          group: "B", iso: "ca"     },
  { name: "Switzerland",     group: "B", iso: "ch"     },
  { name: "Qatar",           group: "B", iso: "qa"     },
  { name: "Bosnia & Herz.",  group: "B", iso: "ba"     },
  { name: "Brazil",          group: "C", iso: "br"     },
  { name: "Morocco",         group: "C", iso: "ma"     },
  { name: "Scotland",        group: "C", iso: "gb-sct" },
  { name: "Haiti",           group: "C", iso: "ht"     },
  { name: "USA",             group: "D", iso: "us"     },
  { name: "Australia",       group: "D", iso: "au"     },
  { name: "Paraguay",        group: "D", iso: "py"     },
  { name: "Türkiye",         group: "D", iso: "tr"     },
  { name: "Germany",         group: "E", iso: "de"     },
  { name: "Japan",           group: "E", iso: "jp"     },
  { name: "Saudi Arabia",    group: "E", iso: "sa"     },
  { name: "New Zealand",     group: "E", iso: "nz"     },
  { name: "Portugal",        group: "F", iso: "pt"     },
  { name: "Argentina",       group: "F", iso: "ar"     },
  { name: "Senegal",         group: "F", iso: "sn"     },
  { name: "DR Congo",        group: "F", iso: "cd"     },
  { name: "Spain",           group: "G", iso: "es"     },
  { name: "Belgium",         group: "G", iso: "be"     },
  { name: "Croatia",         group: "G", iso: "hr"     },
  { name: "Venezuela",       group: "G", iso: "ve"     },
  { name: "France",          group: "H", iso: "fr"     },
  { name: "Uruguay",         group: "H", iso: "uy"     },
  { name: "Nigeria",         group: "H", iso: "ng"     },
  { name: "Guatemala",       group: "H", iso: "gt"     },
  { name: "England",         group: "I", iso: "gb-eng" },
  { name: "Netherlands",     group: "I", iso: "nl"     },
  { name: "Cameroon",        group: "I", iso: "cm"     },
  { name: "Algeria",         group: "I", iso: "dz"     },
  { name: "Colombia",        group: "J", iso: "co"     },
  { name: "Ecuador",         group: "J", iso: "ec"     },
  { name: "Serbia",          group: "J", iso: "rs"     },
  { name: "Slovenia",        group: "J", iso: "si"     },
  { name: "Italy",           group: "K", iso: "it"     },
  { name: "Chile",           group: "K", iso: "cl"     },
  { name: "Ivory Coast",     group: "K", iso: "ci"     },
  { name: "Peru",            group: "K", iso: "pe"     },
  { name: "Denmark",         group: "L", iso: "dk"     },
  { name: "Iran",            group: "L", iso: "ir"     },
  { name: "Ghana",           group: "L", iso: "gh"     },
  { name: "Honduras",        group: "L", iso: "hn"     },
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
  let pts = 0, goals = 0;
  teams.forEach(t => {
    const s = scores[t.name];
    if (!s) return;
    pts += (s.w || 0) * POINT_SYSTEM.groupWin + (s.d || 0) * POINT_SYSTEM.groupDraw;
    pts += ADVANCEMENT_BONUS[s.advancement] || 0;
    goals += s.gf || 0;
  });
  return { pts, goals, teams };
}

export function saveState(state) {
  try { localStorage.setItem("wc2026_pool", JSON.stringify(state)); } catch {}
}
export function loadState() {
  try { const r = localStorage.getItem("wc2026_pool"); return r ? JSON.parse(r) : null; } catch { return null; }
}
