export const config = { maxDuration: 60 };

const DB_URL = process.env.FIREBASE_DB_URL || "https://worldcup-pool-61157-default-rtdb.firebaseio.com";

export default async function handler(req, res) {
  // If a CRON_SECRET is configured, require Vercel's cron auth header.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  // Read the current pool so we know the exact team names already in play.
  let pool;
  try {
    const r = await fetch(`${DB_URL}/pool.json`);
    pool = await r.json();
  } catch (e) {
    return res.status(502).json({ error: `Firebase read failed: ${e.message}` });
  }
  const currentScores = (pool && pool.scores) || {};
  const teamNames = Object.keys(currentScores);
  if (teamNames.length === 0) return res.status(200).json({ skipped: "no scores in pool yet" });

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
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No JSON object in model response");
    result = JSON.parse(m[0]);
  } catch (e) {
    return res.status(502).json({ error: `Score fetch failed: ${e.message}` });
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
    return res.status(502).json({ error: `Firebase write failed: ${e.message}` });
  }

  return res.status(200).json({ ok: true, teamsUpdated: updated, lastFetched: now });
}
