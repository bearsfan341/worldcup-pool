export const config = { maxDuration: 30 };

const DB_URL = process.env.FIREBASE_DB_URL || "https://worldcup-pool-61157-default-rtdb.firebaseio.com";

// FIFA's official match feed for the 2026 World Cup (idCompetition 17 = World Cup,
// idSeason 285023 = 2026). Structured JSON — no AI, no web search, no timeouts.
const FIFA_URL =
  "https://api.fifa.com/api/v3/calendar/matches?idCompetition=17&idSeason=285023&count=200&language=en";

// FIFA 3-letter code → our app team name (see src/data.js). Codes are stable and
// avoid name-format mismatches ("Korea Republic", "Côte d'Ivoire", "Cabo Verde"…).
const CODE_TO_TEAM = {
  MEX: "Mexico", KOR: "South Korea", RSA: "South Africa", CZE: "Czechia",
  CAN: "Canada", SUI: "Switzerland", QAT: "Qatar", BIH: "Bosnia",
  BRA: "Brazil", MAR: "Morocco", SCO: "Scotland", HAI: "Haiti",
  USA: "USA", AUS: "Australia", PAR: "Paraguay", TUR: "Türkiye",
  GER: "Germany", ECU: "Ecuador", CIV: "Ivory Coast", CUW: "Curaçao",
  NED: "Netherlands", JPN: "Japan", TUN: "Tunisia", SWE: "Sweden",
  BEL: "Belgium", IRN: "Iran", EGY: "Egypt", NZL: "New Zealand",
  ESP: "Spain", URU: "Uruguay", KSA: "Saudi Arabia", CPV: "Cape Verde",
  FRA: "France", SEN: "Senegal", NOR: "Norway", IRQ: "Iraq",
  ARG: "Argentina", AUT: "Austria", ALG: "Algeria", JOR: "Jordan",
  POR: "Portugal", COL: "Colombia", UZB: "Uzbekistan", COD: "DR Congo",
  ENG: "England", CRO: "Croatia", PAN: "Panama", GHA: "Ghana",
};

// Knockout stage name → the advancement tier a team has "reached" by playing it.
const STAGE_REACHED = {
  "Round of 32": "r32", "Round of 16": "r16",
  "Quarter-final": "qf", "Semi-final": "sf", "Final": "final",
};
// Winning a stage promotes a team to the next tier (Final winner → champion).
const NEXT = { r32: "r16", r16: "qf", qf: "sf", sf: "final", final: "champion" };
const RANK = { group: 0, r32: 1, r16: 2, qf: 3, sf: 4, final: 5, champion: 6 };

export default async function handler(req, res) {
  // 1) Pull the official results feed.
  let rows;
  try {
    const r = await fetch(FIFA_URL, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`FIFA HTTP ${r.status}`);
    const data = await r.json();
    rows = data.Results || [];
  } catch (e) {
    return res.status(502).json({ error: `FIFA fetch failed: ${e.message}` });
  }

  // 2) Start every team at zero, then fold in each finished match.
  const scores = {};
  Object.values(CODE_TO_TEAM).forEach(name => {
    scores[name] = { w: 0, d: 0, l: 0, gf: 0, ga: 0, advancement: "group" };
  });
  const bump = (team, tier) => {
    if (RANK[tier] > RANK[scores[team].advancement]) scores[team].advancement = tier;
  };

  let finished = 0;
  for (const m of rows) {
    if (m.MatchStatus !== 0) continue; // 0 = finished; skip fixtures/live
    const home = CODE_TO_TEAM[m.Home && m.Home.Abbreviation];
    const away = CODE_TO_TEAM[m.Away && m.Away.Abbreviation];
    if (!home || !away) continue; // placeholder ("Winner Group A") or unknown
    const hs = m.HomeTeamScore, as = m.AwayTeamScore;
    if (hs == null || as == null) continue;
    finished++;

    const stage = (m.StageName && m.StageName[0] || {}).Description || "";
    scores[home].gf += hs; scores[home].ga += as;
    scores[away].gf += as; scores[away].ga += hs;

    if (stage === "First Stage") {
      if (hs > as) { scores[home].w++; scores[away].l++; }
      else if (as > hs) { scores[away].w++; scores[home].l++; }
      else { scores[home].d++; scores[away].d++; }
    } else {
      const reached = STAGE_REACHED[stage];
      if (reached) {
        bump(home, reached); bump(away, reached);
        let win = hs > as ? "home" : as > hs ? "away" : null;
        if (!win) {
          const hp = m.HomeTeamPenaltyScore, ap = m.AwayTeamPenaltyScore;
          if (hp != null && ap != null) win = hp > ap ? "home" : "away";
        }
        if (win) bump(win === "home" ? home : away, NEXT[reached]);
      }
    }
  }

  // 3) Write the recomputed scores back, preserving players/draft/draftLocked.
  const now = Date.now();
  try {
    const w = await fetch(`${DB_URL}/pool.json`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scores, lastFetched: now }),
    });
    if (!w.ok) throw new Error(`Firebase write HTTP ${w.status}`);
  } catch (e) {
    return res.status(502).json({ error: `Firebase write failed: ${e.message}` });
  }

  return res.status(200).json({ ok: true, matchesCounted: finished, lastFetched: now });
}
