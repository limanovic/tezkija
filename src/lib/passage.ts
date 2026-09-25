import { GuidanceRow, TOTAL_GUIDANCE, getGuidanceByOrdinalRange, getSurahs } from './db';
import { t } from './i18n';

/**
 * A small serialisable reference to a passage: `count` guidance ayahs from
 * `startOrdinal` on, in mushaf order. This is what gets stored in the
 * notification payload and the AsyncStorage ledger — never the full text.
 * The Reader re-queries the database from this key.
 */
export type PassageKey = { startOrdinal: number; count: number };

export type Passage = { rows: GuidanceRow[]; passageKey: PassageKey };

/** Random integer in [min, max], inclusive both ends. */
function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * Pick a random starting point and take `count` consecutive guidance ayahs
 * from it. Consecutive in the set, not in the mushaf: 2:43 is followed by
 * 2:45, and 2:283 by 3:92. The clamp on maxStart guarantees a full-length
 * passage — we never wrap around the end.
 */
export async function buildPassage(count: number): Promise<Passage> {
  if (count < 1 || count > TOTAL_GUIDANCE) throw new Error(`Invalid count: ${count}`);
  const maxStart = TOTAL_GUIDANCE - count + 1;
  const start = randomInt(1, maxStart);
  const rows = await getGuidanceByOrdinalRange(start, start + count - 1);
  return { rows, passageKey: { startOrdinal: start, count } };
}

/**
 * Take `count` consecutive guidance ayahs starting at `start` — the in-order
 * reading. A portion that would run past the end of the set is truncated
 * instead of wrapped: a PassageKey describes one contiguous range, so a pass
 * through the set ends on a short final portion and the cursor restarts at
 * the first ayah after it.
 */
export async function buildPassageAt(count: number, start: number): Promise<Passage> {
  if (count < 1 || count > TOTAL_GUIDANCE) throw new Error(`Invalid count: ${count}`);
  const from = Math.min(TOTAL_GUIDANCE, Math.max(1, Math.floor(start) || 1));
  const take = Math.min(count, TOTAL_GUIDANCE - from + 1);
  const rows = await getGuidanceByOrdinalRange(from, from + take - 1);
  return { rows, passageKey: { startOrdinal: from, count: take } };
}

/** Re-query the exact passage a PassageKey refers to. Shared by Reader + scheduler. */
export function resolvePassage(key: PassageKey): Promise<GuidanceRow[]> {
  return getGuidanceByOrdinalRange(key.startOrdinal, key.startOrdinal + key.count - 1);
}

export function parsePassageKey(raw: string): PassageKey | null {
  try {
    const key = JSON.parse(raw) as PassageKey;
    if (typeof key.startOrdinal === 'number' && typeof key.count === 'number') return key;
    return null;
  } catch {
    return null;
  }
}

/**
 * Human reference for a passage, e.g.:
 *   "Al-Baqara 2:42"                       (single ayah)
 *   "Al-Baqara 2:42 – 2:45"                (range within one surah)
 *   "Al-Baqara 2:283 – Aal Imran 3:92"     (cross-surah range)
 * A range names its ends only — the ayahs between are not contiguous in the
 * mushaf, so "2:42–2:45" would be a lie.
 */
export async function formatReference(rows: GuidanceRow[]): Promise<string> {
  const surahs = await getSurahs();
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) return '';

  const firstName = surahs.get(first.surah)?.name_en ?? t('surahN', { n: first.surah });
  if (first.id === last.id) {
    return `${firstName} ${first.surah}:${first.ayah}`;
  }
  if (first.surah === last.surah) {
    return `${firstName} ${first.surah}:${first.ayah} – ${last.surah}:${last.ayah}`;
  }
  const lastName = surahs.get(last.surah)?.name_en ?? t('surahN', { n: last.surah });
  return `${firstName} ${first.surah}:${first.ayah} – ${lastName} ${last.surah}:${last.ayah}`;
}
