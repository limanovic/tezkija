import AsyncStorage from '@react-native-async-storage/async-storage';

/*
 * The key-value store behind all user state. It is AsyncStorage with two
 * additions the account sync (lib/sync) needs:
 *
 *  - every write to a synced key is stamped with the time it happened
 *    (`sync.meta.v1`), so two copies of the same key can be compared;
 *  - a listener hears about each write, so it can be pushed to the account.
 *
 * Domain modules (wird, vocab, bookmarks, settings) only ever call
 * getItem/setItem/removeItem here; they don't know whether an account exists.
 * Device-local state (the notification ledger, dismissed prompts) stays on
 * AsyncStorage directly and is never synced.
 */

export const SYNCED_KEYS = [
  'settings.v1',
  'guidance.cursor.v1',
  'guidance.done.v1',
  'vocab.progress.v1',
  'vocab.cursor.v1',
  'vocab.lessons.v1',
  'bookmarks.v1',
  'lastPosition.v1',
] as const;

export type SyncedKey = (typeof SYNCED_KEYS)[number];

const META_KEY = 'sync.meta.v1';

/** Last local write per key, epoch ms. Missing = never written through here. */
export type Meta = Partial<Record<SyncedKey, number>>;

type WriteListener = (key: SyncedKey) => void;
let listener: WriteListener | null = null;

/** Register the one listener that pushes local writes to the account. */
export function onWrite(fn: WriteListener | null): void {
  listener = fn;
}

export async function loadMeta(): Promise<Meta> {
  const raw = await AsyncStorage.getItem(META_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Meta = {};
    for (const key of SYNCED_KEYS) {
      const v = parsed[key];
      if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    }
    return out;
  } catch {
    return {};
  }
}

// Stamps are read-modify-write on one JSON blob; two keys written in the same
// tick would otherwise race and one stamp would be lost.
let metaQueue: Promise<unknown> = Promise.resolve();

function updateMeta(patch: (meta: Meta) => void): Promise<void> {
  const next = metaQueue.then(async () => {
    const meta = await loadMeta();
    patch(meta);
    await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
  });
  metaQueue = next.catch(() => {});
  return next;
}

export function stamp(key: SyncedKey, at = Date.now()): Promise<void> {
  return updateMeta((meta) => {
    meta[key] = at;
  });
}

export function getItem(key: SyncedKey): Promise<string | null> {
  return AsyncStorage.getItem(key);
}

export async function setItem(key: SyncedKey, value: string): Promise<void> {
  await AsyncStorage.setItem(key, value);
  await stamp(key);
  listener?.(key);
}

export async function removeItem(key: SyncedKey): Promise<void> {
  await AsyncStorage.removeItem(key);
  await stamp(key);
  listener?.(key);
}

/**
 * A value arriving from the account: written as-is, stamped with the server
 * time so it doesn't look newer than it is, and never pushed back.
 */
export async function applyRemote(key: SyncedKey, value: string | null, updatedAt: number): Promise<void> {
  if (value === null) await AsyncStorage.removeItem(key);
  else await AsyncStorage.setItem(key, value);
  await stamp(key, updatedAt);
}

/** Forget every synced key and its stamps — before pulling another account's state. */
export async function clearSynced(): Promise<void> {
  await AsyncStorage.multiRemove([...SYNCED_KEYS, META_KEY]);
  metaQueue = Promise.resolve();
}
