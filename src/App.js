import { useState, useEffect, useRef, useCallback } from "react";
import { dbSave, dbSubscribe } from "./firebase";
import { ALL_TEAMS, COLORS, GROUPS, getSnakeOrder, calcPlayerPoints, flagUrl } from "./data";

// ─── FLAG IMAGE COMPONENT ─────────────────────────────────────────────────────
// Uses flagcdn.com for real flag images — works on Windows, all browsers
function Flag({ iso, size = 24, style: extra }) {
  return (
    <img
      src={flagUrl(iso, 40)}
      alt={iso}
      width={size}
      height={size * 0.667}
      style={{
        objectFit: "cover",
        borderRadius: 2,
        display: "inline-block",
        flexShrink: 0,
        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        ...extra,
      }}
      loading="lazy"
      onError={e => { e.target.style.display = "none"; }}
    />
  );
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const STAGES = ["Players", "Draft", "Scores", "Standings"];

// ─── LOCAL STORAGE HELPERS ────────────────────────────────────────────────────
const ls = {
  get: (k, fallback = "") => { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} },
  getInt: (k) => { try { return parseInt(localStorage.getItem(k) || "0", 10); } catch { return 0; } },
};

// ─── FIREBASE CONFIGURED CHECK ────────────────────────────────────────────────
function isFirebaseConfigured() {
  try {
    // firebase.js replaces REPLACE_WITH_ strings; if any remain, it's not configured
    const src = window.__fbConfigured;
    return src !== false;
  } catch { return true; }
}

// ─── SCORE FETCHER ────────────────────────────────────────────────────────────
async function fetchLiveScores(apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{
        role: "user",
        content: `Search the web for the latest 2026 FIFA World Cup results (today: ${new Date().toDateString()}).

Return ONLY a valid JSON object — no markdown, no explanation:
{
  "lastUpdated": "ISO timestamp",
  "teams": {
    "Mexico": { "w": 2, "d": 1, "l": 0, "gf": 5, "ga": 2, "advancement": "r32" }
  }
}

Advancement values: "group" | "r32" | "r16" | "qf" | "sf" | "final" | "champion"
Teams: ${ALL_TEAMS.map(t => t.name).join(", ")}
Include ALL teams. Use 0s and "group" for teams that haven't played yet.`
      }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  const textBlocks = data.content.filter(b => b.type === "text");
  if (!textBlocks.length) throw new Error("No response text");
  const raw = textBlocks[textBlocks.length - 1].text.replace(/```json|```/g, "").trim();
  return JSON.parse(raw);
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function defaultScores() {
  const s = {};
  ALL_TEAMS.forEach(t => { s[t.name] = { w: 0, d: 0, l: 0, gf: 0, ga: 0, advancement: "group" }; });
  return s;
}

function timeSince(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h === 0 && m === 0) return "just now";
  return h >= 1 ? `${h}h ${m}m ago` : `${m}m ago`;
}

const ADV_LABEL = { group: "Group Stage", r32: "Round of 32", r16: "Round of 16", qf: "Quarterfinal", sf: "Semifinal", final: "Final", champion: "🏆 Champion" };
const ADV_COLOR = { champion: "#f59e0b", final: "#f59e0b", sf: "#10b981", qf: "#3b82f6", r16: "#6366f1", r32: "#8b5cf6", group: "" };

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const T = {
  bg:       "#0f1117",
  surface:  "#1a1d27",
  surface2: "#222535",
  border:   "#2a2d3e",
  text:     "#e8eaf0",
  muted:    "#6b7280",
  accent:   "#f59e0b",
  accentDim:"#78350f",
  green:    "#10b981",
  red:      "#ef4444",
  blue:     "#3b82f6",
  radius:   "12px",
  radiusSm: "8px",
};

// ─── GLOBAL STYLES ────────────────────────────────────────────────────────────
const globalStyle = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${T.bg}; color: ${T.text}; font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  input[type=number]::-webkit-inner-spin-button { opacity: 1; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 2px; }
  button { font-family: inherit; cursor: pointer; }
  input { font-family: inherit; }
`;

// ─── REUSABLE UI COMPONENTS ───────────────────────────────────────────────────
function Badge({ children, color, dim }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
      background: (color || T.accent) + "20",
      color: color || T.accent,
      border: `1px solid ${(color || T.accent)}30`,
    }}>{children}</span>
  );
}

function Pill({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      flexShrink: 0, padding: "6px 14px", borderRadius: 999, fontSize: 12, fontWeight: 500,
      background: active ? T.accent : T.surface2,
      color: active ? "#000" : T.muted,
      border: `1px solid ${active ? T.accent : T.border}`,
      transition: "all 0.15s",
    }}>{children}</button>
  );
}

function Input({ value, onChange, placeholder, type = "text", style: extraStyle }) {
  return (
    <input
      type={type} value={value} onChange={onChange} placeholder={placeholder}
      style={{
        width: "100%", background: T.surface2, border: `1px solid ${T.border}`,
        borderRadius: T.radiusSm, padding: "11px 14px", color: T.text,
        fontSize: 14, outline: "none", transition: "border-color 0.15s",
        ...extraStyle,
      }}
      onFocus={e => e.target.style.borderColor = T.accent}
      onBlur={e => e.target.style.borderColor = T.border}
    />
  );
}

function PrimaryButton({ onClick, disabled, children, danger, small }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: small ? "auto" : "100%",
      padding: small ? "8px 18px" : "13px 20px",
      background: disabled ? T.surface2 : danger ? T.red : T.accent,
      color: disabled ? T.muted : danger ? "#fff" : "#000",
      border: "none", borderRadius: T.radiusSm,
      fontSize: small ? 13 : 14, fontWeight: 700,
      cursor: disabled ? "not-allowed" : "pointer",
      transition: "opacity 0.15s",
      letterSpacing: "0.02em",
    }}>{children}</button>
  );
}

function Card({ children, style: extra, accent }) {
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: T.radius, padding: 20,
      borderLeft: accent ? `3px solid ${accent}` : undefined,
      ...extra,
    }}>{children}</div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>{children}</div>;
}

// ─── SETUP SCREEN ─────────────────────────────────────────────────────────────
function Setup({ onStart }) {
  const [players, setPlayers] = useState(["", "", ""]);
  const valid = players.filter(p => p.trim());

  return (
    <div style={{ maxWidth: 520, margin: "0 auto" }}>
      {/* Hero */}
      <div style={{ textAlign: "center", padding: "40px 0 32px" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>⚽</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: T.text, marginBottom: 8 }}>World Cup 2026 Pool</h1>
        <p style={{ fontSize: 14, color: T.muted, lineHeight: 1.6 }}>
          Snake draft · 48 teams · Live leaderboard<br />June 11 – July 19
        </p>
      </div>

      {/* Players */}
      <Card style={{ marginBottom: 16 }}>
        <SectionLabel>Players (2–12)</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {players.map((name, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                background: COLORS[i], display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#fff",
              }}>{i + 1}</div>
              <Input
                value={name} placeholder={`Player ${i + 1}`}
                onChange={e => { const n = [...players]; n[i] = e.target.value; setPlayers(n); }}
              />
              {players.length > 2 && (
                <button onClick={() => setPlayers(players.filter((_, j) => j !== i))}
                  style={{ background: "none", border: "none", color: T.muted, fontSize: 18, padding: "0 4px", flexShrink: 0, lineHeight: 1 }}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        {players.length < 12 && (
          <button onClick={() => setPlayers([...players, ""])} style={{
            marginTop: 12, width: "100%", padding: "10px", background: "transparent",
            border: `1px dashed ${T.border}`, borderRadius: T.radiusSm,
            color: T.muted, fontSize: 13, transition: "border-color 0.15s",
          }}
            onMouseEnter={e => e.currentTarget.style.borderColor = T.accent}
            onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
            + Add player
          </button>
        )}
      </Card>

      {/* Scoring reference */}
      <Card style={{ marginBottom: 24 }}>
        <SectionLabel>Scoring</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px" }}>
          {[
            ["Group Win", "3 pts"], ["Reach Round of 32", "+5"],
            ["Group Draw", "1 pt"],  ["Reach Round of 16", "+8"],
            ["Group Loss", "0 pts"], ["Quarterfinal", "+13"],
            ["", ""],                ["Semifinal", "+21"],
            ["", ""],                ["Final", "+34"],
            ["", ""],                ["Champion 🏆", "+55"],
          ].map(([l, v], i) => l ? (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "2px 0" }}>
              <span style={{ color: T.muted }}>{l}</span>
              <span style={{ color: T.accent, fontWeight: 600 }}>{v}</span>
            </div>
          ) : <div key={i} />)}
        </div>
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}`, fontSize: 12, color: T.muted }}>
          Tiebreaker: total goals scored by your teams
        </div>
      </Card>

      <PrimaryButton disabled={valid.length < 2} onClick={() => onStart(valid)}>
        Start Draft with {valid.length} player{valid.length !== 1 ? "s" : ""} →
      </PrimaryButton>
    </div>
  );
}

// ─── DRAFT SCREEN ─────────────────────────────────────────────────────────────
function Draft({ players, onComplete }) {
  const totalPicks = ALL_TEAMS.length;
  const snakeOrder = useRef(getSnakeOrder(players.length, totalPicks)).current;
  const [draft, setDraft] = useState([]);
  const [filterGroup, setFilterGroup] = useState("All");
  const [search, setSearch] = useState("");

  const currentPick = draft.length;
  const isDone = currentPick >= totalPicks;
  const pickedIdxs = new Set(draft.map(d => d.teamIdx));
  const currentPlayerIdx = !isDone ? snakeOrder[currentPick] : null;

  const available = ALL_TEAMS
    .map((t, i) => ({ ...t, idx: i }))
    .filter(t =>
      !pickedIdxs.has(t.idx) &&
      (filterGroup === "All" || t.group === filterGroup) &&
      (search === "" || t.name.toLowerCase().includes(search.toLowerCase()))
    );

  const upcoming = !isDone ? snakeOrder.slice(currentPick, currentPick + 5) : [];
  const round = Math.floor(currentPick / players.length) + 1;

  const pick = useCallback((teamIdx) => {
    if (isDone) return;
    const next = [...draft, { playerIdx: snakeOrder[currentPick], teamIdx }];
    setDraft(next);
    if (next.length >= totalPicks) onComplete(next);
  }, [draft, currentPick, isDone, onComplete, snakeOrder, totalPicks]);

  return (
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      {/* Pick header */}
      {!isDone && (
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`,
          borderTop: `3px solid ${COLORS[currentPlayerIdx]}`,
          borderRadius: T.radius, padding: 20, marginBottom: 16, textAlign: "center",
        }}>
          <div style={{ fontSize: 11, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
            Round {round} · Pick {currentPick + 1} of {totalPicks}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: T.text, marginBottom: 12 }}>
            <span style={{ color: COLORS[currentPlayerIdx] }}>{players[currentPlayerIdx]}</span>'s pick
          </div>
          {/* Up next */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: T.muted }}>Up next:</span>
            {upcoming.slice(1).map((pIdx, i) => (
              <span key={i} style={{
                padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 500,
                background: COLORS[pIdx] + "20", color: COLORS[pIdx],
                border: `1px solid ${COLORS[pIdx]}40`,
              }}>{players[pIdx]}</span>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 160 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: T.muted, fontSize: 14, pointerEvents: "none" }}>🔍</span>
          <input
            value={search} onChange={e => setSearch(e.target.value)} placeholder="Search teams…"
            style={{
              width: "100%", background: T.surface2, border: `1px solid ${T.border}`,
              borderRadius: T.radiusSm, padding: "8px 12px 8px 36px", color: T.text,
              fontSize: 13, outline: "none",
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
          {["All", ...GROUPS].map(g => (
            <Pill key={g} active={filterGroup === g} onClick={() => setFilterGroup(g)}>
              {g === "All" ? "All" : g}
            </Pill>
          ))}
        </div>
      </div>

      {/* Team grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
        {available.map(t => (
          <button key={t.idx} onClick={() => pick(t.idx)} style={{
            padding: "14px 12px", background: T.surface, border: `1px solid ${T.border}`,
            borderRadius: T.radius, color: T.text, textAlign: "left",
            display: "flex", alignItems: "center", gap: 10, transition: "all 0.15s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.background = T.surface2; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = T.surface; }}>
            <Flag iso={t.iso} size={28} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>Group {t.group}</div>
            </div>
          </button>
        ))}
        {available.length === 0 && (
          <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 40, color: T.muted, fontSize: 14 }}>
            No teams match your filter
          </div>
        )}
      </div>

      {/* Sidebar: draft log */}
      {draft.length > 0 && (
        <Card style={{ marginTop: 16 }}>
          <SectionLabel>Draft Log — {draft.length} picks made</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
            {[...draft].reverse().map((d, i) => {
              const team = ALL_TEAMS[d.teamIdx];
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, padding: "4px 0" }}>
                  <span style={{ color: COLORS[d.playerIdx], fontWeight: 600, minWidth: 80 }}>{players[d.playerIdx]}</span>
                  <Flag iso={team.iso} size={18} />
                  <span style={{ color: T.text }}>{team.name}</span>
                  <span style={{ color: T.muted, fontSize: 11, marginLeft: "auto" }}>Pick {draft.length - i}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── SCORES SCREEN ────────────────────────────────────────────────────────────
function Scores({ players, draft, scores, setScores, lastFetched, setLastFetched, onViewStandings, isCommissioner }) {
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState("");
  const [fetchStatus, setFetchStatus] = useState("idle"); // idle | loading | ok | error
  const [filterGroup, setFilterGroup] = useState("All");
  const [tab, setTab] = useState("rosters");
  const [apiKey, setApiKey] = useState(() => ls.get("wc2026_apikey"));
  const [search, setSearch] = useState("");

  const handleKeyChange = (e) => { setApiKey(e.target.value); ls.set("wc2026_apikey", e.target.value); };

  const doFetch = async () => {
    const k = apiKey.trim();
    if (!k) { setFetchMsg("Enter your API key above"); setFetchStatus("error"); return; }
    setFetching(true); setFetchStatus("loading"); setFetchMsg("Searching the web for live scores…");
    try {
      const result = await fetchLiveScores(k);
      const next = { ...scores };
      Object.entries(result.teams || {}).forEach(([name, data]) => {
        if (next[name]) next[name] = { ...next[name], ...data };
      });
      const now = Date.now();
      await dbSave({ players, draft, scores: next, lastFetched: now });
      ls.set("wc2026_lastfetched", now);
      setLastFetched(now);
      setScores(next);
      setFetchStatus("ok");
      setFetchMsg("Scores updated and synced to all friends");
    } catch (e) {
      setFetchStatus("error");
      setFetchMsg(e.message);
    }
    setFetching(false);
  };

  const updateScore = (teamName, field, val) => {
    const next = { ...scores, [teamName]: { ...scores[teamName], [field]: Math.max(0, Number(val)) } };
    setScores(next);
    dbSave({ players, draft, scores: next, lastFetched });
  };

  const updateAdv = (teamName, val) => {
    const next = { ...scores, [teamName]: { ...scores[teamName], advancement: val } };
    setScores(next);
    dbSave({ players, draft, scores: next, lastFetched });
  };

  const standings = players
    .map((name, idx) => ({ name, idx, ...calcPlayerPoints(idx, draft, scores) }))
    .sort((a, b) => b.pts - a.pts || b.goals - a.goals);

  const filtered = ALL_TEAMS.filter(t =>
    (filterGroup === "All" || t.group === filterGroup) &&
    (search === "" || t.name.toLowerCase().includes(search.toLowerCase()))
  );

  const nextIn = lastFetched
    ? Math.max(0, Math.ceil((lastFetched + TWENTY_FOUR_HOURS - Date.now()) / 3600000))
    : null;

  return (
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      {/* Mini standings at top for quick check */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <SectionLabel style={{ marginBottom: 0 }}>Standings</SectionLabel>
          <button onClick={onViewStandings} style={{
            background: "none", border: "none", color: T.accent, fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>Full view →</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {standings.map((p, rank) => {
            const medals = ["🥇", "🥈", "🥉"];
            return (
              <div key={p.idx} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 16, minWidth: 24 }}>{medals[rank] || `${rank + 1}`}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS[p.idx], flexShrink: 0, display: "inline-block" }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</span>
                  </div>
                </div>
                <span style={{ fontWeight: 700, color: rank === 0 ? T.accent : T.text, fontSize: 14 }}>{p.pts}</span>
                <span style={{ color: T.muted, fontSize: 11 }}>pts</span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Commissioner panel */}
      {isCommissioner && (
        <Card style={{ marginBottom: 16, borderTop: `2px solid ${T.green}` }}>
          <SectionLabel>Auto-update scores</SectionLabel>
          <p style={{ fontSize: 13, color: T.muted, marginBottom: 12, lineHeight: 1.6 }}>
            Fetches live results via the Claude API, then syncs to all friends instantly.
            Get a free key at <a href="https://console.anthropic.com" target="_blank" rel="noreferrer"
              style={{ color: T.accent }}>console.anthropic.com</a>
          </p>
          <Input
            type="password" value={apiKey} onChange={handleKeyChange}
            placeholder="sk-ant-api03-…" style={{ fontFamily: "monospace", fontSize: 12, marginBottom: 10 }}
          />
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <PrimaryButton onClick={doFetch} disabled={fetching} small>
              {fetching ? "Fetching…" : "Fetch & sync now"}
            </PrimaryButton>
            <div style={{ fontSize: 12, color: fetchStatus === "ok" ? T.green : fetchStatus === "error" ? T.red : T.muted }}>
              {fetchMsg || (lastFetched
                ? `Updated ${timeSince(lastFetched)}${nextIn > 0 ? ` · auto in ~${nextIn}h` : ""}`
                : apiKey ? "Key saved · daily auto-fetch active" : ""
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Tab nav */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, background: T.surface2, borderRadius: T.radiusSm, padding: 4 }}>
        {[["rosters", "Rosters"], ["teams", "All Teams"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            flex: 1, padding: "8px 0", borderRadius: 6, fontSize: 13, fontWeight: 500, border: "none",
            background: tab === key ? T.surface : "transparent",
            color: tab === key ? T.text : T.muted,
            cursor: "pointer", transition: "all 0.15s",
          }}>{label}</button>
        ))}
      </div>

      {/* Rosters tab */}
      {tab === "rosters" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {standings.map((p, rank) => {
            return (
              <Card key={p.idx} accent={COLORS[p.idx]}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: COLORS[p.idx], marginBottom: 2 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: T.muted }}>{p.teams.length} teams · {p.goals} goals</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: rank === 0 ? T.accent : T.text }}>{p.pts}</div>
                    <div style={{ fontSize: 11, color: T.muted }}>points</div>
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {p.teams.map(t => {
                    const s = scores[t.name] || {};
                    const adv = s.advancement || "group";
                    const advColor = ADV_COLOR[adv];
                    return (
                      <div key={t.name} style={{
                        display: "flex", alignItems: "center", gap: 6,
                        background: T.surface2, borderRadius: T.radiusSm, padding: "6px 10px",
                        border: `1px solid ${advColor ? advColor + "40" : T.border}`,
                      }}>
                        <Flag iso={t.iso} size={20} />
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{t.name}</div>
                          <div style={{ fontSize: 10, color: advColor || T.muted }}>
                            {s.w || 0}W {s.d || 0}D {s.l || 0}L · {ADV_LABEL[adv] || adv}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* All Teams tab */}
      {tab === "teams" && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 140 }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: T.muted, fontSize: 13, pointerEvents: "none" }}>🔍</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                style={{ width: "100%", background: T.surface2, border: `1px solid ${T.border}`, borderRadius: T.radiusSm, padding: "8px 12px 8px 32px", color: T.text, fontSize: 13, outline: "none" }} />
            </div>
            <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
              {["All", ...GROUPS].map(g => <Pill key={g} active={filterGroup === g} onClick={() => setFilterGroup(g)}>{g === "All" ? "All" : g}</Pill>)}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map(t => {
              const s = scores[t.name] || { w: 0, d: 0, l: 0, gf: 0, ga: 0, advancement: "group" };
              const owner = draft.find(d => ALL_TEAMS[d.teamIdx].name === t.name);
              const ownerColor = owner ? COLORS[owner.playerIdx] : undefined;
              const ownerName = owner ? players[owner.playerIdx] : null;
              const adv = s.advancement || "group";

              return (
                <Card key={t.name} accent={ownerColor}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: isCommissioner ? 12 : 0 }}>
                    <Flag iso={t.iso} size={32} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</span>
                        <Badge color={ADV_COLOR[adv] || T.muted}>{ADV_LABEL[adv]}</Badge>
                        {ownerName && <Badge color={ownerColor}>{ownerName}</Badge>}
                      </div>
                      <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
                        Group {t.group} · {s.w}W {s.d}D {s.l}L · {s.gf} GF {s.ga} GA
                      </div>
                    </div>
                  </div>

                  {isCommissioner && (
                    <>
                      {/* W/D/L/GF/GA inputs */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6, marginBottom: 10 }}>
                        {[["W","w"],["D","d"],["L","l"],["GF","gf"],["GA","ga"]].map(([label, field]) => (
                          <div key={field}>
                            <div style={{ fontSize: 10, color: T.muted, textAlign: "center", marginBottom: 4, fontWeight: 600 }}>{label}</div>
                            <input type="number" min="0" value={s[field] || 0}
                              onChange={e => updateScore(t.name, field, e.target.value)}
                              style={{
                                width: "100%", background: T.surface2, border: `1px solid ${T.border}`,
                                borderRadius: 6, padding: "6px 0", color: T.text,
                                fontSize: 14, fontWeight: 700, textAlign: "center", outline: "none",
                              }} />
                          </div>
                        ))}
                      </div>
                      {/* Advancement */}
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {Object.entries(ADV_LABEL).map(([val, label]) => (
                          <button key={val} onClick={() => updateAdv(t.name, val)} style={{
                            padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 500, cursor: "pointer",
                            background: adv === val ? (ADV_COLOR[val] || T.accent) : T.surface2,
                            color: adv === val ? (val === "group" ? T.text : "#000") : T.muted,
                            border: `1px solid ${adv === val ? (ADV_COLOR[val] || T.accent) : T.border}`,
                          }}>{label}</button>
                        ))}
                      </div>
                    </>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── STANDINGS SCREEN ─────────────────────────────────────────────────────────
function Standings({ players, draft, scores, lastFetched, onBack }) {
  const standings = players
    .map((name, idx) => ({ name, idx, ...calcPlayerPoints(idx, draft, scores) }))
    .sort((a, b) => b.pts - a.pts || b.goals - a.goals);

  return (
    <div style={{ maxWidth: 520, margin: "0 auto" }}>
      <div style={{ textAlign: "center", padding: "32px 0 24px" }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🏆</div>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: T.text }}>Leaderboard</h2>
        {lastFetched > 0 && (
          <div style={{ fontSize: 12, color: T.muted, marginTop: 6 }}>
            Scores as of {new Date(lastFetched).toLocaleString()} · Tiebreaker: total goals
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {standings.map((p, rank) => {
          const medals = ["🥇", "🥈", "🥉"];
          const isFirst = rank === 0;
          return (
            <div key={p.idx} style={{
              background: isFirst ? `linear-gradient(135deg, ${T.accentDim}40, ${T.surface})` : T.surface,
              border: `1px solid ${isFirst ? T.accent + "60" : T.border}`,
              borderLeft: `4px solid ${COLORS[p.idx]}`,
              borderRadius: T.radius, padding: 18,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ fontSize: rank < 3 ? 28 : 15, minWidth: 32, textAlign: "center", fontWeight: 700, color: T.muted }}>
                  {medals[rank] || `${rank + 1}`}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: isFirst ? T.accent : T.text }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                    {p.teams.length} teams · {p.goals} goals
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: isFirst ? T.accent : T.text }}>{p.pts}</div>
                  <div style={{ fontSize: 11, color: T.muted }}>points</div>
                </div>
              </div>

              {/* Team chips */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 12 }}>
                {p.teams.map(t => {
                  const adv = (scores[t.name] || {}).advancement || "group";
                  const c = ADV_COLOR[adv];
                  return (
                    <span key={t.name} style={{
                      padding: "3px 8px", borderRadius: 999, fontSize: 11, fontWeight: 500,
                      background: c ? c + "20" : T.surface2,
                      color: c || T.muted,
                      border: `1px solid ${c ? c + "40" : T.border}`,
                    }}><Flag iso={t.iso} size={14} style={{ borderRadius: 1 }} /> {t.name}</span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <button onClick={onBack} style={{
        marginTop: 20, width: "100%", padding: 12, background: "transparent",
        border: `1px solid ${T.border}`, borderRadius: T.radiusSm,
        color: T.muted, fontSize: 13, cursor: "pointer",
      }}>← Back to Scores</button>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [stage, setStage]             = useState(0);
  const [players, setPlayers]         = useState([]);
  const [draft, setDraft]             = useState([]);
  const [scores, setScores]           = useState(defaultScores());
  const [lastFetched, setLastFetched] = useState(ls.getInt("wc2026_lastfetched"));
  const [isCommissioner, setIsCommissioner] = useState(false);
  const [synced, setSynced]           = useState(false);
  const [fbError, setFbError]         = useState(false);

  // Refs to latest values for use inside effects without stale closures
  const playersRef = useRef(players);
  const draftRef   = useRef(draft);
  const scoresRef  = useRef(scores);
  const lastFetchedRef = useRef(lastFetched);
  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { scoresRef.current = scores; }, [scores]);
  useEffect(() => { lastFetchedRef.current = lastFetched; }, [lastFetched]);

  const autoFetchedRef = useRef(false);

  // ── Firebase subscription ─────────────────────────────────────────────────
  useEffect(() => {
    let unsub;
    // Fallback: if Firebase hasn't responded in 3s (empty database), show app anyway
    const timeout = setTimeout(() => setSynced(true), 3000);
    try {
      unsub = dbSubscribe((data) => {
        clearTimeout(timeout);
        if (data.players) setPlayers(data.players);
        if (data.draft)   setDraft(data.draft);
        if (data.scores)  setScores(data.scores);
        if (data.lastFetched) {
          setLastFetched(data.lastFetched);
          ls.set("wc2026_lastfetched", data.lastFetched);
        }
        if (data.draft?.length > 0) setStage(prev => prev < 2 ? 2 : prev);
        setSynced(true);
      });
    } catch (e) {
      clearTimeout(timeout);
      setFbError(true);
      setSynced(true);
    }
    return () => { clearTimeout(timeout); try { unsub?.(); } catch {} };
  }, []);

  // ── Daily auto-fetch (fires after Firebase loads, using refs for fresh values)
  useEffect(() => {
    if (!synced || autoFetchedRef.current) return;
    autoFetchedRef.current = true;
    const key = ls.get("wc2026_apikey");
    const last = ls.getInt("wc2026_lastfetched");
    if (!key || Date.now() - last <= TWENTY_FOUR_HOURS) return;
    fetchLiveScores(key).then(result => {
      const next = { ...scoresRef.current };
      Object.entries(result.teams || {}).forEach(([name, data]) => {
        if (next[name]) next[name] = { ...next[name], ...data };
      });
      const now = Date.now();
      dbSave({ players: playersRef.current, draft: draftRef.current, scores: next, lastFetched: now });
      ls.set("wc2026_lastfetched", now);
      setScores(next);
      setLastFetched(now);
    }).catch(() => {});
  }, [synced]);

  const handleStart = (p) => {
    setPlayers(p);
    dbSave({ players: p, draft: [], scores: defaultScores(), lastFetched: 0 });
    setStage(1);
  };

  const handleDraftComplete = (d) => {
    setDraft(d);
    dbSave({ players, draft: d, scores, lastFetched });
    setStage(2);
  };

  // Loading
  if (!synced) {
    return (
      <>
        <style>{globalStyle}</style>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 36 }}>⚽</div>
          <div style={{ fontSize: 13, color: T.muted, letterSpacing: "0.06em" }}>Connecting…</div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{globalStyle}</style>
      <div style={{ minHeight: "100vh", background: T.bg }}>

        {/* Top nav */}
        <header style={{
          position: "sticky", top: 0, zIndex: 100,
          background: T.bg + "f0", backdropFilter: "blur(12px)",
          borderBottom: `1px solid ${T.border}`,
        }}>
          <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 16px", display: "flex", alignItems: "center", gap: 0, height: 52 }}>
            <span style={{ fontSize: 18, marginRight: 10 }}>⚽</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.text, marginRight: "auto" }}>WC26 Pool</span>

            {/* Stage tabs */}
            <div style={{ display: "flex", gap: 2 }}>
              {STAGES.map((s, i) => (
                <button key={s} onClick={() => { if (stage > i) setStage(i); }}
                  disabled={stage < i}
                  style={{
                    padding: "6px 12px", background: "none", border: "none",
                    fontSize: 12, fontWeight: stage === i ? 700 : 400,
                    color: stage === i ? T.accent : stage > i ? T.text : T.muted,
                    cursor: stage > i ? "pointer" : stage === i ? "default" : "not-allowed",
                    borderBottom: stage === i ? `2px solid ${T.accent}` : "2px solid transparent",
                    marginBottom: -1,
                  }}>{s}</button>
              ))}
            </div>

            {/* Commissioner toggle + sync dot */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 16 }}>
              {stage >= 2 && (
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: T.muted }}>
                  <input type="checkbox" checked={isCommissioner} onChange={e => setIsCommissioner(e.target.checked)}
                    style={{ accentColor: T.accent, cursor: "pointer" }} />
                  <span style={{ display: "none", "@media(min-width:480px)": { display: "inline" } }}>Admin</span>
                </label>
              )}
              <div title={fbError ? "Firebase not configured" : "Live sync active"} style={{
                width: 8, height: 8, borderRadius: "50%",
                background: fbError ? T.red : synced ? T.green : "#f59e0b",
              }} />
            </div>
          </div>

          {/* Last updated strip */}
          {lastFetched > 0 && (
            <div style={{ background: T.green + "15", borderTop: `1px solid ${T.green}20`, padding: "4px 16px", textAlign: "center", fontSize: 11, color: T.green }}>
              Scores updated {timeSince(lastFetched)} · Live synced
            </div>
          )}

          {/* Firebase warning */}
          {fbError && (
            <div style={{ background: T.red + "15", borderTop: `1px solid ${T.red}20`, padding: "6px 16px", textAlign: "center", fontSize: 12, color: T.red }}>
              ⚠️ Firebase not configured — see README Step 2. Running in local-only mode.
            </div>
          )}
        </header>

        {/* Page content */}
        <main style={{ padding: "16px 16px 60px" }}>
          {stage === 0 && <Setup onStart={handleStart} />}
          {stage === 1 && <Draft players={players} onComplete={handleDraftComplete} />}
          {stage === 2 && (
            <Scores
              players={players} draft={draft} scores={scores} setScores={setScores}
              lastFetched={lastFetched} setLastFetched={setLastFetched}
              onViewStandings={() => setStage(3)}
              isCommissioner={isCommissioner}
            />
          )}
          {stage === 3 && (
            <Standings players={players} draft={draft} scores={scores} lastFetched={lastFetched} onBack={() => setStage(2)} />
          )}
        </main>
      </div>
    </>
  );
}
