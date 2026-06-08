// ─── FIREBASE CONFIG ──────────────────────────────────────────────────────────
// Replace the values below with your own Firebase project config.
// Instructions: README.md → Step 2 (Firebase Setup)

import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, get } from "firebase/database";

const firebaseConfig = {
  apiKey:            "REPLACE_WITH_YOUR_API_KEY",
  authDomain:        "REPLACE_WITH_YOUR_AUTH_DOMAIN",
  databaseURL:       "REPLACE_WITH_YOUR_DATABASE_URL",
  projectId:         "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket:     "REPLACE_WITH_YOUR_STORAGE_BUCKET",
  messagingSenderId: "REPLACE_WITH_YOUR_MESSAGING_SENDER_ID",
  appId:             "REPLACE_WITH_YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// ─── DB HELPERS ───────────────────────────────────────────────────────────────

/** Write the full pool state (players, draft, scores, lastFetched) */
export async function dbSave(state) {
  await set(ref(db, "pool"), state);
}

/** Read the pool state once */
export async function dbLoad() {
  const snap = await get(ref(db, "pool"));
  return snap.exists() ? snap.val() : null;
}

/** Subscribe to real-time updates. Returns an unsubscribe function. */
export function dbSubscribe(callback) {
  const poolRef = ref(db, "pool");
  const unsub = onValue(poolRef, (snap) => {
    if (snap.exists()) callback(snap.val());
  });
  return unsub;
}
