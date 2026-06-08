// ─── FIREBASE CONFIG ──────────────────────────────────────────────────────────
// Replace the values below with your own Firebase project config.
// Instructions: README.md → Step 2 (Firebase Setup)

import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, get } from "firebase/database";

const firebaseConfig = {
  apiKey:            "AIzaSyD6ZKl9_7KQrIr7BhZWqtEoul-pYQsLCTw",
  authDomain:        "worldcup-pool-61157.firebaseapp.com",
  databaseURL:       "https://worldcup-pool-61157-default-rtdb.firebaseio.com"",
  projectId:         "worldcup-pool-61157",
  storageBucket:     "worldcup-pool-61157.firebasestorage.app",
  messagingSenderId: "26462789319",
  appId:             "1:26462789319:web:651355fb3a4723757868e2",
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
