export const config = { runtime: "edge" };

const DB_URL = process.env.FIREBASE_DB_URL || "https://worldcup-pool-61157-default-rtdb.firebaseio.com";

export default async function handler(req) {
  // If a CRON_SECRET is configured, require Vercel's cron auth header.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

  // Read the current pool so we know the exact team names already in play.
  let pool;
  try {
    const r = await fetch(`${DB_URL}/pool.json`);
    pool = await r.json();
  } catch (e) {
    return json({ error: `Firebase read failed: ${e.message}` }, 502);
  }
  const currentScores = (pool && pool.scores) || {};
  const teamNames = Object.keys(currentScores);
  if (teamNames.length === 0) return json({ skipped: "no scores in pool yet" }, 200);

  const prompt = `Search the web for the latest 2026 FIFA World Cup results (today: ${new Date().toDateString()}).

Return ONLY a valid JSON object — no markdown, no explanation:
{
  "lastUpdated": "ISO timestamp",
  "teams": {
    "Mexico": { "w": 2, "d": 1, "l": 0, "gf": 5, "ga": 2, "advancement": "r32" }
  }
}

Advancement values: "group" | "r32" | "r16" | "qf" | "sf" | "final" | "champion"
Teams (use these exact names): ${teamNames.join(", ")}
Include ALL teams. Use 0s and "group" for teams that haven't played yet.`;

  let result;
  try {
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
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    const textBlocks = (data.content || []).filter(b => b.type === "text");
    if (!textBlocks.length) throw new Error("No response text from model");
    const raw = textBlocks[textBlocks.length - 1].text.replace(/```json|```/g, "").trim();
    result = JSON.parse(raw);
  } catch (e) {
    return json({ error: `Score fetch failed: ${e.message}` }, 502);
  }

  // Merge returned results into existing scores (only teams we already track).
  const nextScores = { ...currentScores };
  let updated = 0;
  Object.entries(result.teams || {}).forEach(([name, data]) => {
    if (nextScores[name]) { nextScores[name] = { ...nextScores[name], ...data }; updated++; }
  });

  const now = Date.now();
  try {
    const w = await fetch(`${DB_URL}/pool.json`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scores: nextScores, lastFetched: now }),
    });
    if (!w.ok) throw new Error(`Firebase write HTTP ${w.status}`);
  } catch (e) {
    return json({ error: `Firebase write failed: ${e.message}` }, 502);
  }

  return json({ ok: true, teamsUpdated: updated, lastFetched: now }, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
