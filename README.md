# ⚽ World Cup 2026 Fantasy Pool — Setup Guide

Real-time leaderboard, snake draft, and auto-score updates. Friends open the link and see live standings — no sharing files, no imports.

---

## Overview of what you're setting up

| Service | What it does | Cost |
|---|---|---|
| **GitHub** | Stores your code | Free |
| **Firebase** | Live database — syncs scores to all friends | Free |
| **Vercel** | Hosts your app at a public URL | Free |
| **Anthropic API** | Fetches live World Cup scores daily | Free credits included |

Total setup time: ~20 minutes, one time.

---

## Step 1 — GitHub: Store your code

1. Go to **[github.com/signup](https://github.com/signup)** and create a free account
2. Go to **[github.com/new](https://github.com/new)** to create a new repository
   - Name it `worldcup-pool`
   - Leave everything else as default
   - Click **Create repository**
3. On your new repo page, click **"uploading an existing file"**
4. Unzip the file I gave you, then drag the entire contents of the `worldcup-pool` folder into the GitHub upload area
   - You should see: `src/`, `public/`, `package.json`, `README.md`
5. Click **Commit changes**

---

## Step 2 — Firebase: Set up the live database

This is the key step. Firebase is what lets all your friends see the same live data.

1. Go to **[console.firebase.google.com](https://console.firebase.google.com)** and sign in with a Google account
2. Click **"Add project"** → name it `worldcup-pool` → click through the prompts → **Create project**
3. Once inside your project, click **"Realtime Database"** in the left sidebar
4. Click **"Create Database"** → choose **United States** → click **Next**
5. Select **"Start in test mode"** → click **Enable**
   - This lets anyone with the URL read/write for 30 days — fine for a friend group. After 30 days, change the rules to allow reads forever (see note below).
6. You'll see a database URL like `https://worldcup-pool-xxxxx-default-rtdb.firebaseio.com` — copy it, you'll need it shortly

### Get your Firebase config keys

7. Click the **gear icon** (⚙️) next to "Project Overview" → **Project settings**
8. Scroll down to **"Your apps"** → click the **web icon** (`</>`)
9. Register your app with any nickname (e.g. `worldcup-pool-web`) → click **Register app**
10. You'll see a `firebaseConfig` object like this:
    ```js
    const firebaseConfig = {
      apiKey: "AIza...",
      authDomain: "worldcup-pool-xxxxx.firebaseapp.com",
      databaseURL: "https://worldcup-pool-xxxxx-default-rtdb.firebaseio.com",
      projectId: "worldcup-pool-xxxxx",
      storageBucket: "worldcup-pool-xxxxx.appspot.com",
      messagingSenderId: "123456789",
      appId: "1:123456789:web:abc123"
    };
    ```
11. Open `src/firebase.js` in your GitHub repo (click the file → pencil icon to edit)
12. Replace all the `REPLACE_WITH_YOUR_...` values with your actual values from step 10
13. Click **Commit changes**

### Extend database access past 30 days (do this once)

14. In Firebase, go to **Realtime Database → Rules** tab and replace the rules with:
    ```json
    {
      "rules": {
        ".read": true,
        ".write": true
      }
    }
    ```
15. Click **Publish** — this keeps the database open for the whole tournament

---

## Step 3 — Vercel: Deploy your app

1. Go to **[vercel.com](https://vercel.com)** → click **Sign Up → Continue with GitHub**
2. Click **"Add New Project"**
3. Find and select your `worldcup-pool` repository → click **Import**
4. Leave all settings as default — Vercel auto-detects React
5. Click **Deploy**

In about 60 seconds you'll get a live URL like:
```
worldcup-pool-yourname.vercel.app
```

**That's the link you send to everyone.** They open it and see live standings automatically.

---

## Step 4 — Anthropic API: Auto-fetch live scores

1. Go to **[console.anthropic.com](https://console.anthropic.com)** and sign up
2. Navigate to **API Keys → Create Key** → copy it (starts with `sk-ant-...`)
3. Open your app URL → go to the **Scoring** tab
4. Check the **"I'm the commissioner"** box
5. Paste your API key and click **Fetch & Sync Now** to confirm it works

After that, scores auto-update every 24 hours when you open the app, and sync to Firebase instantly — all your friends see updated standings without doing anything.

---

## How it works day-to-day

**You (commissioner):**
- Open the app once a day (scores auto-fetch in the background)
- Optionally hit "Fetch & Sync Now" after big match days if you want it faster

**Your friends:**
- Open the same Vercel URL anytime
- See live standings, rosters, and scores — no setup, no imports needed

---

## Troubleshooting

**"Connecting…" spinner won't go away**
→ Your Firebase config in `src/firebase.js` is probably still set to `REPLACE_WITH_YOUR_...`. Double-check you edited and committed that file.

**Scores aren't updating automatically**
→ The auto-fetch only runs on your device (the commissioner's). Make sure you open the app at least once a day.

**Firebase says "Permission denied"**
→ Your 30-day test mode expired. Go back to Firebase → Realtime Database → Rules and set both `.read` and `.write` to `true`.
