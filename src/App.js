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
// Calls our Vercel serverless proxy (/api/fetch-scores) to avoid CORS issues.
// The proxy forwards the request to Anthropic with web_search enabled.
async function fetchLiveScores() {
  const prompt = `Search the web for the latest 2026 FIFA World Cup results (today: ${new Date().toDateString()}).

Return ONLY a valid JSON object — no markdown, no explanation:
{
  "lastUpdated": "ISO timestamp",
  "teams": {
    "Mexico": { "w": 2, "d": 1, "l": 0, "gf": 5, "ga": 2, "advancement": "r32" }
  }
}

Advancement values: "group" | "r32" | "r16" | "qf" | "sf" | "final" | "champion"
Teams: ${ALL_TEAMS.map(t => t.name).join(", ")}
Include ALL teams. Use 0s and "group" for teams that haven't played yet.`;

  const res = await fetch("/api/fetch-scores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(`Proxy error ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in response");
  return JSON.parse(m[0]);
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
  body { background: ${T.bg}; color: ${T.text}; font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; -webkit-text-size-adjust: 100%; }
  input[type=number]::-webkit-inner-spin-button { opacity: 1; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 2px; }
  button { font-family: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  input { font-family: inherit; font-size: 16px; } /* 16px prevents iOS zoom on focus */
  select { font-family: inherit; }
  @media (max-width: 480px) {
    .hide-mobile { display: none !important; }
    .full-mobile { width: 100% !important; }
  }
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
function Draft({ players, initialDraft, onComplete, onLockDraft, isCommissioner, draftLocked }) {
  const totalPicks   = ALL_TEAMS.length;
  const numRounds    = Math.ceil(totalPicks / players.length);
  const snakeOrder   = useRef(getSnakeOrder(players.length, totalPicks)).current;
  const [draft, setDraft]             = useState(initialDraft || []);
  const [filterGroup, setFilterGroup] = useState("All");
  const [search, setSearch]           = useState("");
  const [lastPick, setLastPick]       = useState(null);
  const [view, setView]               = useState("board");

  const currentPick      = draft.length;
  const isDone           = currentPick >= totalPicks;
  const currentPlayerIdx = !isDone ? snakeOrder[currentPick] : null;
  const pickedIdxs       = new Set(draft.map(d => d.teamIdx));
  const round            = Math.floor(currentPick / players.length) + 1;
  const upcoming         = !isDone ? snakeOrder.slice(currentPick, currentPick + 6) : [];

  const available = ALL_TEAMS
    .map((t, i) => ({ ...t, idx: i }))
    .filter(t =>
      !pickedIdxs.has(t.idx) &&
      (filterGroup === "All" || t.group === filterGroup) &&
      (search === "" || t.name.toLowerCase().includes(search.toLowerCase()))
    );

  const pick = useCallback((teamIdx) => {
    if (isDone) return;
    const next = [...draft, { playerIdx: snakeOrder[currentPick], teamIdx }];
    setLastPick({ teamIdx });
    setDraft(next);
    setSearch(""); setFilterGroup("All");
    if (next.length >= totalPicks) onComplete(next);
    else setView("board");
  }, [draft, currentPick, isDone, onComplete, snakeOrder, totalPicks]);

  const playerTeams = (pIdx) =>
    draft.filter(d => d.playerIdx === pIdx).map(d => ALL_TEAMS[d.teamIdx]);

  // Board grid: rows=rounds, cols=players (snake order aware)
  const board = Array.from({ length: numRounds }, (_, r) =>
    Array.from({ length: players.length }, (_, p) => {
      const pickNum = r * players.length + p;
      const d = draft[pickNum];
      return { team: d ? ALL_TEAMS[d.teamIdx] : null, ownerIdx: d?.playerIdx, pickNum };
    })
  );

  const pct = Math.round((currentPick / totalPicks) * 100);

  return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "flex", flexDirection: "column" }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.45} }
        @keyframes flashIn { 0%{transform:scale(1.06);filter:brightness(1.4)} 100%{transform:scale(1);filter:brightness(1)} }
        @keyframes slideUp { from{transform:translateY(12px);opacity:0} to{transform:translateY(0);opacity:1} }
        .team-btn:active { transform: scale(0.96); }
      `}</style>

      {/* ── TOP BAR ── */}
      <div style={{
        background: T.surface, borderBottom: `1px solid ${T.border}`,
        padding: "10px 12px", position: "sticky", top: 0, zIndex: 50,
      }}>
        {/* Row 1: spotlight + view toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          {!isDone ? (
            <div style={{
              display: "flex", alignItems: "center", gap: 10, flex: 1,
              background: COLORS[currentPlayerIdx] + "18",
              border: `1px solid ${COLORS[currentPlayerIdx]}40`,
              borderRadius: T.radiusSm, padding: "8px 12px",
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%", background: COLORS[currentPlayerIdx],
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, fontWeight: 800, color: "#fff", flexShrink: 0,
              }}>{players[currentPlayerIdx][0].toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10, color: T.muted, letterSpacing: "0.06em" }}>ROUND {round} · PICK {currentPick + 1}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: COLORS[currentPlayerIdx], overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {players[currentPlayerIdx]}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, flexWrap: "wrap" }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: T.accent }}>🏆 Draft Complete!</span>
              {isCommissioner && !draftLocked && (
                <button onClick={onLockDraft} style={{
                  padding: "7px 14px", background: T.green, border: "none",
                  borderRadius: T.radiusSm, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
                }}>🔒 Save &amp; Lock Draft</button>
              )}
              {draftLocked && (
                <span style={{ fontSize: 11, color: T.green, fontWeight: 600 }}>🔒 Locked</span>
              )}
            </div>
          )}

          {/* View toggle */}
          <div style={{ display: "flex", background: T.surface2, borderRadius: T.radiusSm, padding: 3, flexShrink: 0 }}>
            {[["board","📋"],["pick","⚽"]].map(([key, icon]) => (
              <button key={key} onClick={() => setView(key)} style={{
                padding: "6px 12px", borderRadius: 6, fontSize: 13, border: "none",
                background: view === key ? T.accent : "transparent",
                color: view === key ? "#000" : T.muted,
                fontWeight: view === key ? 700 : 400, cursor: "pointer",
              }}>{icon} {key === "board" ? "Board" : "Pick"}</button>
            ))}
          </div>
        </div>

        {/* Row 2: progress + up next */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ height: 5, background: T.border, borderRadius: 3 }}>
              <div style={{ width: `${pct}%`, height: "100%", background: T.accent, borderRadius: 3, transition: "width 0.3s" }} />
            </div>
          </div>
          <div style={{ fontSize: 10, color: T.muted, flexShrink: 0 }}>{pct}%</div>
          {!isDone && (
            <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontSize: 9, color: T.muted }}>NEXT</span>
              {upcoming.slice(1, 4).map((pIdx, i) => (
                <div key={i} title={players[pIdx]} style={{
                  width: 22, height: 22, borderRadius: "50%",
                  background: COLORS[pIdx] + "40", border: `1.5px solid ${COLORS[pIdx]}80`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, fontWeight: 700, color: COLORS[pIdx],
                }}>{players[pIdx][0]}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── BOARD VIEW ── */}
      {view === "board" && (
        <div style={{ flex: 1, overflowX: "auto", WebkitOverflowScrolling: "touch", padding: "12px 8px" }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 3, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 32 }} />
              {players.map((_, i) => <col key={i} style={{ width: 100 }} />)}
            </colgroup>
            <thead>
              <tr>
                <th style={{ padding: "6px 4px", fontSize: 9, color: T.muted, fontWeight: 600, textAlign: "center" }}>#</th>
                {players.map((p, i) => (
                  <th key={i} style={{
                    padding: "6px 4px",
                    background: i === currentPlayerIdx && !isDone ? COLORS[i] + "18" : "transparent",
                    borderBottom: `2px solid ${i === currentPlayerIdx && !isDone ? COLORS[i] : "transparent"}`,
                    borderRadius: "6px 6px 0 0",
                  }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: "50%", background: COLORS[i],
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 10, fontWeight: 800, color: "#fff",
                      }}>{p[0].toUpperCase()}</div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: COLORS[i], overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90, display: "block" }}>{p}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {board.map((row, r) => (
                <tr key={r}>
                  <td style={{ textAlign: "center", padding: "3px 2px" }}>
                    <div style={{ fontSize: 9, color: T.muted, fontWeight: 600 }}>{r + 1}</div>
                    <div style={{ fontSize: 8, color: T.border }}>{r % 2 === 0 ? "→" : "←"}</div>
                  </td>
                  {row.map(({ team, ownerIdx, pickNum }, p) => {
                    const isActive = pickNum === currentPick;
                    const isFlash  = lastPick && team && team === ALL_TEAMS[lastPick.teamIdx];
                    return (
                      <td key={p} style={{ padding: "2px" }}>
                        {team ? (
                          <div style={{
                            background: COLORS[ownerIdx] + "22",
                            border: `1px solid ${COLORS[ownerIdx]}50`,
                            borderRadius: 6, padding: "4px 5px",
                            display: "flex", alignItems: "center", gap: 4,
                            animation: isFlash ? "flashIn 0.5s ease" : "none",
                            minHeight: 36,
                          }}>
                            <Flag iso={team.iso} size={16} />
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 9, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{team.name}</div>
                              <div style={{ fontSize: 8, color: T.muted }}>Grp {team.group}</div>
                            </div>
                          </div>
                        ) : isActive ? (
                          <div style={{
                            background: COLORS[currentPlayerIdx] + "20",
                            border: `1.5px dashed ${COLORS[currentPlayerIdx]}`,
                            borderRadius: 6, minHeight: 36,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            animation: "pulse 1.4s infinite",
                          }}>
                            <span style={{ fontSize: 9, color: COLORS[currentPlayerIdx], fontWeight: 700 }}>…</span>
                          </div>
                        ) : (
                          <div style={{
                            background: T.surface2 + "60", border: `1px solid ${T.border}20`,
                            borderRadius: 6, minHeight: 36, opacity: 0.25,
                          }} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── PICK VIEW ── */}
      {view === "pick" && (
        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "12px" }}>

          {/* Current player's picks so far */}
          {!isDone && playerTeams(currentPlayerIdx).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: T.muted, letterSpacing: "0.06em", marginBottom: 8 }}>
                {players[currentPlayerIdx].toUpperCase()}'S PICKS
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {playerTeams(currentPlayerIdx).map(t => (
                  <div key={t.name} style={{
                    display: "flex", alignItems: "center", gap: 5,
                    background: COLORS[currentPlayerIdx] + "20",
                    border: `1px solid ${COLORS[currentPlayerIdx]}40`,
                    borderRadius: T.radiusSm, padding: "5px 8px",
                  }}>
                    <Flag iso={t.iso} size={16} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: T.text }}>{t.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Search */}
          <div style={{ position: "relative", marginBottom: 10 }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: T.muted, fontSize: 13, pointerEvents: "none" }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search teams…"
              style={{ width: "100%", background: T.surface2, border: `1px solid ${T.border}`, borderRadius: T.radiusSm, padding: "10px 12px 10px 34px", color: T.text, fontSize: 14, outline: "none", boxSizing: "border-box" }} />
          </div>

          {/* Group filter */}
          <div style={{ display: "flex", gap: 5, overflowX: "auto", marginBottom: 12, paddingBottom: 2 }}>
            {["All", ...GROUPS].map(g => <Pill key={g} active={filterGroup === g} onClick={() => setFilterGroup(g)}>{g === "All" ? "All" : g}</Pill>)}
          </div>

          {/* Team grid — bigger touch targets on mobile */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 8 }}>
            {available.map(t => (
              <button key={t.idx} className="team-btn" onClick={() => pick(t.idx)} style={{
                padding: "12px 10px", background: T.surface, border: `1px solid ${T.border}`,
                borderRadius: T.radius, color: T.text, textAlign: "left",
                display: "flex", alignItems: "center", gap: 8,
                cursor: "pointer", WebkitTapHighlightColor: "transparent",
                transition: "border-color 0.1s, background 0.1s",
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = COLORS[currentPlayerIdx]; e.currentTarget.style.background = COLORS[currentPlayerIdx] + "15"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = T.surface; }}>
                <Flag iso={t.iso} size={26} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>{t.name}</div>
                  <div style={{ fontSize: 10, color: T.muted }}>Group {t.group}</div>
                </div>
              </button>
            ))}
            {available.length === 0 && (
              <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 40, color: T.muted, fontSize: 14 }}>No teams match</div>
            )}
          </div>

          {isDone && (
            <div style={{ textAlign: "center", padding: 40 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🏆</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: T.accent, marginBottom: 20 }}>Draft Complete!</div>
              {isCommissioner && !draftLocked && (
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 13, color: T.muted, marginBottom: 16 }}>
                    Lock the draft to save it permanently and hide the Players &amp; Draft tabs from everyone.
                  </p>
                  <button onClick={onLockDraft} style={{
                    padding: "14px 32px", background: T.green, border: "none",
                    borderRadius: T.radiusSm, color: "#fff", fontSize: 15, fontWeight: 700,
                    cursor: "pointer",
                  }}>
                    🔒 Save &amp; Lock Draft
                  </button>
                </div>
              )}
              {draftLocked && (
                <div style={{
                  padding: "10px 20px", background: T.green + "20",
                  border: `1px solid ${T.green}40`, borderRadius: T.radiusSm,
                  fontSize: 13, color: T.green, fontWeight: 600, display: "inline-block",
                }}>✅ Draft locked &amp; saved — Players and Draft tabs are now hidden</div>
              )}
            </div>
          )}
        </div>
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
  const [search, setSearch] = useState("");

  const doFetch = async () => {
    setFetching(true); setFetchStatus("loading"); setFetchMsg("Searching the web for live scores…");
    try {
      const result = await fetchLiveScores();
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
            Scores update automatically once a day on the server and sync to everyone — no need to keep the app open.
            Use the button below to fetch right now (e.g. just after a game ends).
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <PrimaryButton onClick={doFetch} disabled={fetching} small>
              {fetching ? "Fetching…" : "Fetch & sync now"}
            </PrimaryButton>
            <div style={{ fontSize: 12, color: fetchStatus === "ok" ? T.green : fetchStatus === "error" ? T.red : T.muted }}>
              {fetchMsg || (lastFetched
                ? `Updated ${timeSince(lastFetched)} · auto-updates daily`
                : "Auto-updates daily on the server"
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
  const [draftLocked, setDraftLocked] = useState(false);
  const [synced, setSynced]           = useState(false);
  const [fbError, setFbError]         = useState(false);

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
        if (data.draftLocked) setDraftLocked(true);
        setSynced(true);
      });
    } catch (e) {
      clearTimeout(timeout);
      setFbError(true);
      setSynced(true);
    }
    return () => { clearTimeout(timeout); try { unsub?.(); } catch {} };
  }, []);

  const handleStart = (p) => {
    setPlayers(p);
    dbSave({ players: p, draft: [], scores: defaultScores(), lastFetched: 0, draftLocked: false });
    setStage(1);
  };

  const handleDraftComplete = (d) => {
    setDraft(d);
    dbSave({ players, draft: d, scores, lastFetched, draftLocked: false });
    setStage(2);
  };

  const handleLockDraft = () => {
    setDraftLocked(true);
    dbSave({ players, draft, scores, lastFetched, draftLocked: true });
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
          <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 10px", display: "flex", alignItems: "center", gap: 0, height: 52 }}>
            <span style={{ fontSize: 18, marginRight: 10 }}>⚽</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.text, marginRight: "auto" }}>WC26 Pool</span>

            {/* Stage tabs — hide Players/Draft when draft is locked */}
            <div style={{ display: "flex", gap: 2 }}>
              {STAGES.map((s, i) => {
                if (draftLocked && i < 2) return null; // hide Players + Draft tabs when locked
                return (
                  <button key={s} onClick={() => { if (!draftLocked && stage > i) setStage(i); else if (draftLocked && i >= 2) setStage(i); }}
                    disabled={draftLocked ? false : stage < i}
                    style={{
                      padding: "6px 12px", background: "none", border: "none",
                      fontSize: 12, fontWeight: stage === i ? 700 : 400,
                      color: stage === i ? T.accent : (draftLocked || stage > i) ? T.text : T.muted,
                      cursor: (draftLocked || stage > i) ? "pointer" : stage === i ? "default" : "not-allowed",
                      borderBottom: stage === i ? `2px solid ${T.accent}` : "2px solid transparent",
                      marginBottom: -1,
                    }}>{s}</button>
                );
              })}
            </div>

            {/* Commissioner toggle + sync dot */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 16 }}>
              {stage >= 1 && (
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: T.muted }}>
                  <input type="checkbox" checked={isCommissioner} onChange={e => setIsCommissioner(e.target.checked)}
                    style={{ accentColor: T.accent, cursor: "pointer" }} />
                  <span>Admin</span>
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
        <main style={{ padding: "12px 10px 60px" }}>
          {stage === 0 && <Setup onStart={handleStart} />}
          {stage === 1 && <Draft players={players} initialDraft={draft} onComplete={handleDraftComplete} onLockDraft={handleLockDraft} isCommissioner={isCommissioner} draftLocked={draftLocked} />}
          {stage === 2 && (
            <Scores
              players={players} draft={draft} scores={scores} setScores={setScores}
              lastFetched={lastFetched} setLastFetched={setLastFetched}
              onViewStandings={() => setStage(3)}
              isCommissioner={isCommissioner}
              draftLocked={draftLocked}
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
