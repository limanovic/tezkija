import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import * as store from './store';
import { SYNCED_KEYS, SyncedKey } from './store';
import { getSession, supabase } from './supabase';

/*
 * Account sync: one row per (user, key) in `user_state`, holding the same
 * JSON the key holds locally plus the time it was last written.
 *
 * Local-first. Every write lands in AsyncStorage first and is pushed
 * afterwards; if the push fails nothing is lost, the next full sync sees a
 * local stamp newer than the server's and pushes again. A full sync runs on
 * sign-in and whenever the app comes to the foreground: for each key the
 * newer of the two copies wins. That is last-write-wins per key, which is
 * fine for one person on two devices — the only thing it can't do is merge
 * two offline edits of the same key, and the later one takes it.
 *
 * Deletions are rows with a null value: `resetCursor` removes the done set,
 * and the removal must reach the other device too.
 */

const LAST_USER_KEY = 'sync.user.v1';
const LAST_SYNCED_KEY = 'sync.lastAt.v1';
const TABLE = 'user_state';

type Row = { key: string; value: unknown; updated_at: string };

/** Local raw string → jsonb. Every synced key holds JSON already. */
function encode(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function decode(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Change notification — screens re-read their state after a pull
// ---------------------------------------------------------------------------

let version = 0;
const listeners = new Set<() => void>();

function bump(): void {
  version += 1;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Increments each time a sync changes local state; put it in a focus effect's deps. */
export function useSyncVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

export async function loadLastSyncedAt(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(LAST_SYNCED_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

async function pushKeys(keys: SyncedKey[]): Promise<void> {
  if (!supabase || keys.length === 0) return;
  const session = await getSession();
  if (!session) return;
  const meta = await store.loadMeta();
  const rows = [];
  for (const key of keys) {
    const raw = await store.getItem(key);
    let at = meta[key];
    // Written before sync existed: give it a stamp now so both sides agree.
    if (at === undefined) {
      at = Date.now();
      await store.stamp(key, at);
    }
    rows.push({
      user_id: session.user.id,
      key,
      value: raw === null ? null : encode(raw),
      updated_at: new Date(at).toISOString(),
    });
  }
  const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: 'user_id,key' });
  if (error) throw error;
}

// A slider writes settings on every step; one push after the burst is enough.
const PUSH_DELAY_MS = 800;
const pending = new Set<SyncedKey>();
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePush(key: SyncedKey): void {
  pending.add(key);
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const keys = [...pending];
    pending.clear();
    pushKeys(keys).catch(() => {
      // Left for the next full sync to reconcile.
    });
  }, PUSH_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Full sync
// ---------------------------------------------------------------------------

export type SyncResult = { changed: SyncedKey[] };

let inflight: Promise<SyncResult> | null = null;

/** Reconcile every synced key with the account. Safe to call repeatedly. */
export function syncAll(): Promise<SyncResult> {
  if (!inflight) {
    inflight = runSync().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function runSync(): Promise<SyncResult> {
  if (!supabase) return { changed: [] };
  const session = await getSession();
  if (!session) return { changed: [] };
  const userId = session.user.id;

  // The first sign-in on a device merges what is already there into the
  // account. A *different* account signing in afterwards must not inherit it.
  const lastUser = await AsyncStorage.getItem(LAST_USER_KEY);
  if (lastUser !== null && lastUser !== userId) {
    await store.clearSynced();
  }
  await AsyncStorage.setItem(LAST_USER_KEY, userId);

  const { data, error } = await supabase.from(TABLE).select('key,value,updated_at');
  if (error) throw error;
  const remote = new Map<string, Row>((data as Row[]).map((r) => [r.key, r]));
  const meta = await store.loadMeta();

  const changed: SyncedKey[] = [];
  const toPush: SyncedKey[] = [];
  for (const key of SYNCED_KEYS) {
    const local = await store.getItem(key);
    const row = remote.get(key);
    // Unstamped local data predates sync: it counts as older than anything
    // on the server, and is pushed only when the server has nothing.
    const localAt = meta[key] ?? (local !== null ? 0 : -1);
    const remoteAt = row ? Date.parse(row.updated_at) : -1;
    if (row && remoteAt > localAt) {
      await store.applyRemote(key, decode(row.value), remoteAt);
      changed.push(key);
    } else if (localAt > remoteAt || (localAt === 0 && !row)) {
      toPush.push(key);
    }
  }
  await pushKeys(toPush);
  await AsyncStorage.setItem(LAST_SYNCED_KEY, String(Date.now()));
  if (changed.length > 0) bump();
  return { changed };
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/**
 * Start pushing writes and syncing on sign-in and foreground. Returns a stop
 * function. `onChanged` runs after a pull that changed something — the root
 * layout uses it to re-apply theme, language and the notification window.
 */
export function startSync(onChanged: (changed: SyncedKey[]) => void): () => void {
  if (!supabase) return () => {};
  const client = supabase;

  store.onWrite(schedulePush);

  const sync = () =>
    syncAll()
      .then((r) => {
        if (r.changed.length > 0) onChanged(r.changed);
      })
      .catch(() => {});

  const { data: auth } = client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') sync();
  });

  // Tokens refresh only while the app is in front, as Supabase recommends
  // for React Native; a foreground is also the moment to catch up.
  client.auth.startAutoRefresh();
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      client.auth.startAutoRefresh();
      sync();
    } else {
      client.auth.stopAutoRefresh();
    }
  });

  return () => {
    store.onWrite(null);
    auth.subscription.unsubscribe();
    appState.remove();
    client.auth.stopAutoRefresh();
  };
}
