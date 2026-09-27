import * as store from './store';
import { TOTAL_GUIDANCE } from './db';

/*
 * How far the in-order reading has got: the guidance ayah (by ordinal, 1..340)
 * every in-order delivery starts from.
 *
 * The cursor never moves on its own. An in-order time sends the same ayah
 * again and again until it is ticked as practised — the idea being that an
 * ayah is read until it has become habit, then the next one. Ticks are kept
 * as a set of ordinals (`guidance.done.v1`); ticking the ayah under the
 * cursor moves the cursor to the next unticked one, and unticking an ayah
 * behind the cursor moves it back there. Random times ignore all of this and
 * pick freely.
 *
 * There is one position, not one per delivery time: every in-order time shows
 * the same passage that day. Kept out of Settings on purpose — Settings is held
 * in React state on two screens, and a stale copy written back would undo a
 * tick made elsewhere.
 */

const CURSOR_KEY = 'guidance.cursor.v1';
const DONE_KEY = 'guidance.done.v1';

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
  const raw = await store.getItem(CURSOR_KEY);
  if (raw === null) return CURSOR_START;
  try {
    return normalizeCursor(JSON.parse(raw));
  } catch {
    return CURSOR_START;
  }
}

export async function saveCursor(position: number): Promise<void> {
  await store.setItem(CURSOR_KEY, JSON.stringify(normalizeCursor(position)));
}

/** Start the pass through the set over: every tick cleared, cursor on the first ayah. */
export async function resetCursor(): Promise<void> {
  await store.removeItem(DONE_KEY);
  await saveCursor(CURSOR_START);
}

// ---------------------------------------------------------------------------
// Practised ayahs
// ---------------------------------------------------------------------------

export async function loadDone(): Promise<Set<number>> {
  const raw = await store.getItem(DONE_KEY);
  if (!raw) return new Set();
  try {
    const list = JSON.parse(raw) as unknown;
    return new Set(
      (Array.isArray(list) ? list : []).filter(
        (n): n is number => Number.isInteger(n) && n >= 1 && n <= TOTAL_GUIDANCE,
      ),
    );
  } catch {
    return new Set();
  }
}

async function saveDone(done: Set<number>): Promise<void> {
  await store.setItem(DONE_KEY, JSON.stringify([...done].sort((a, b) => a - b)));
}

/**
 * The first unticked ordinal at or after `from`, wrapping round to the start.
 * With everything ticked there is nothing to move to, so `from` stands.
 */
export function nextUnticked(done: Set<number>, from: number): number {
  for (let i = 0; i < TOTAL_GUIDANCE; i++) {
    const ordinal = advance(from, i, TOTAL_GUIDANCE);
    if (!done.has(ordinal)) return ordinal;
  }
  return from;
}

/**
 * Tick or untick an ayah. Ticking the one under the cursor carries the cursor
 * forward to the next unticked ayah. Unticking an ayah the cursor has already
 * passed brings the cursor back to it — an ayah that is not practised after
 * all is the one to be sent again. Unticking one further ahead changes nothing.
 */
export async function toggleDone(ordinal: number): Promise<{ done: Set<number>; cursor: number }> {
  const done = await loadDone();
  const unticking = done.has(ordinal);
  if (unticking) done.delete(ordinal);
  else done.add(ordinal);
  await saveDone(done);
  const stored = await loadCursor();
  let cursor = stored;
  if (unticking && ordinal < cursor) cursor = ordinal;
  else if (done.has(cursor)) cursor = nextUnticked(done, cursor);
  if (cursor !== stored) await saveCursor(cursor);
  return { done, cursor };
}
