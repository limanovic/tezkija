import AsyncStorage from '@react-native-async-storage/async-storage';
import { TOTAL_GUIDANCE } from './db';

/*
 * How far the in-order reading has got: the guidance ayah (by ordinal, 1..340)
 * its *next* in-order delivery starts from.
 *
 * There is one position, not one per delivery time. Every time set to "in
 * order" draws from it, in clock order — 09:00 takes #1, 10:00 takes #2,
 * 14:00 takes #3 — so several readings a day are one continuous pass through
 * the set rather than several parallel ones all starting at 2:42. A time set
 * to "random" never touches it, which is how a delivery opts out.
 *
 * Kept out of Settings on purpose. The scheduler advances it as occurrences
 * elapse, while Settings is held in React state on two screens — a screen that
 * loaded before an advance would write the stale position back on the next
 * unrelated edit and re-deliver passages the user already had.
 *
 * It moves only when an occurrence has actually passed. Pending notifications
 * bake their passage in at scheduling time, but the positions they consume are
 * walked over in memory (see notifications.ts) and never stored, so cancelling
 * and rebuilding the window always lands on the same passages.
 */

const CURSOR_KEY = 'guidance.cursor.v1';

/** The first guidance ayah — where a reading that has never run begins. */
export const CURSOR_START = 1;

/** Repair a stored position into a usable ordinal. */
export function normalizeCursor(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= TOTAL_GUIDANCE ? n : CURSOR_START;
}

/** Next start after taking `count` ayahs from `start`, wrapping past the end. */
export function advance(start: number, count: number, total: number): number {
  return ((start - 1 + count) % total) + 1;
}

export async function loadCursor(): Promise<number> {
  const raw = await AsyncStorage.getItem(CURSOR_KEY);
  if (raw === null) return CURSOR_START;
  try {
    return normalizeCursor(JSON.parse(raw));
  } catch {
    return CURSOR_START;
  }
}

export async function saveCursor(position: number): Promise<void> {
  await AsyncStorage.setItem(CURSOR_KEY, JSON.stringify(normalizeCursor(position)));
}

/** Start the pass through the set over from the first ayah. */
export async function resetCursor(): Promise<void> {
  await saveCursor(CURSOR_START);
}
