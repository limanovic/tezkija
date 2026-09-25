import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';

/** One row of the `ayah` table. Global `id` runs 1..6236 across the whole Qur'an. */
export type AyahRow = {
  id: number;
  surah: number;
  ayah: number;
  page: number;
  juz: number;
  sajda: number;
  arabic: string;
};

/**
 * An ayah from the guidance set: one of the 340 ayahs about conduct, with its
 * place in that set. `ordinal` runs 1..340 in mushaf order, and is what
 * passages, the cursor and the reader position are measured in.
 */
export type GuidanceRow = AyahRow & {
  ordinal: number;
  /** Addressed to the Prophet, but binding on everyone — shown as a badge. */
  to_prophet: number;
};

/** One row of the `language` table. `ar` is Arabic itself (lives in ayah.arabic). */
export type LanguageRow = {
  code: string;
  native_name: string;
  name_en: string;
  translator: string;
  rtl: number;
  sort: number;
};

/** lang code → (ayah id → translated text) */
export type TranslationMap = Record<string, Record<number, string>>;

export type SurahRow = {
  number: number;
  name_ar: string;
  name_en: string;
  name_meaning_en: string;
  ayah_count: number;
  revelation: 'Meccan' | 'Medinan';
};

/** A surah that has guidance ayahs, with how many and where the first one sits. */
export type GuidanceSurah = SurahRow & { count: number; firstOrdinal: number };

/** Size of the guidance set. scripts/build-db.py asserts the table matches. */
export const TOTAL_GUIDANCE = 340;

// Bump the name whenever the bundled database changes shape — the copy runs
// once per install, so existing installs only pick up a new file under a new
// name. Older copies are deleted below.
const DB_NAME = 'tezkija.v1.db';
const OLD_DB_NAMES: string[] = [];

/**
 * expo-sqlite cannot open a database straight from the asset bundle, so on
 * first launch we copy the bundled quran.db into the app's document
 * directory under SQLite/ (where openDatabaseAsync looks for it). The copy
 * runs at most once per install: if the file already exists we skip it.
 * The database is treated as read-only — we never write to it.
 */
async function copyDatabaseIfNeeded(): Promise<void> {
  const sqliteDir = new Directory(Paths.document, 'SQLite');
  if (!sqliteDir.exists) {
    sqliteDir.create({ intermediates: true });
  }
  for (const oldName of OLD_DB_NAMES) {
    const oldFile = new File(sqliteDir, oldName);
    if (oldFile.exists) oldFile.delete();
  }
  const dbFile = new File(sqliteDir, DB_NAME);
  if (dbFile.exists) return;

  const asset = Asset.fromModule(require('../../assets/quran.db'));
  await asset.downloadAsync(); // resolves the asset to a local file:// URI
  if (!asset.localUri) {
    throw new Error('Could not resolve bundled quran.db asset');
  }
  new File(asset.localUri).copy(dbFile);
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Open (and on first call, copy) the bundled database. Safe to call repeatedly. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      await copyDatabaseIfNeeded();
      return SQLite.openDatabaseAsync(DB_NAME);
    })();
    // Reset on failure so a transient error doesn't poison every later call.
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

const GUIDANCE_SELECT = `
  SELECT a.*, g.ordinal, g.to_prophet
  FROM guidance g JOIN ayah a ON a.id = g.ayah_id`;

/** Guidance ayahs by ordinal range, inclusive, in mushaf order. */
export async function getGuidanceByOrdinalRange(
  start: number,
  end: number,
): Promise<GuidanceRow[]> {
  const db = await getDb();
  return db.getAllAsync<GuidanceRow>(
    `${GUIDANCE_SELECT} WHERE g.ordinal BETWEEN ? AND ? ORDER BY g.ordinal`,
    [start, end],
  );
}

/** The whole guidance set — 340 rows, small enough to hold at once. */
export function getAllGuidance(): Promise<GuidanceRow[]> {
  return getGuidanceByOrdinalRange(1, TOTAL_GUIDANCE);
}

/** Guidance rows for an arbitrary ayah id set (bookmarks). Returned in mushaf order. */
export async function getGuidanceByAyahIds(ids: number[]): Promise<GuidanceRow[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const placeholders = ids.map(() => '?').join(', ');
  return db.getAllAsync<GuidanceRow>(
    `${GUIDANCE_SELECT} WHERE a.id IN (${placeholders}) ORDER BY g.ordinal`,
    ids,
  );
}

/**
 * Translations for a set of ayah ids, keyed lang → ayah id → text. Guidance
 * ayahs are not contiguous in the mushaf, so this takes ids, not a range.
 */
export async function getTranslationsByIds(
  langs: string[],
  ids: number[],
): Promise<TranslationMap> {
  const map: TranslationMap = {};
  if (langs.length === 0 || ids.length === 0) return map;
  const db = await getDb();
  const langMarks = langs.map(() => '?').join(', ');
  const idMarks = ids.map(() => '?').join(', ');
  const rows = await db.getAllAsync<{ lang: string; ayah_id: number; text: string }>(
    `SELECT lang, ayah_id, text FROM translation
     WHERE lang IN (${langMarks}) AND ayah_id IN (${idMarks})`,
    [...langs, ...ids],
  );
  for (const row of rows) {
    (map[row.lang] ??= {})[row.ayah_id] = row.text;
  }
  return map;
}

let languagesPromise: Promise<LanguageRow[]> | null = null;

/** All languages in picker order (includes 'ar'), cached after the first query. */
export function getLanguages(): Promise<LanguageRow[]> {
  if (!languagesPromise) {
    languagesPromise = (async () => {
      const db = await getDb();
      return db.getAllAsync<LanguageRow>('SELECT * FROM language ORDER BY sort');
    })();
    languagesPromise.catch(() => {
      languagesPromise = null;
    });
  }
  return languagesPromise;
}

let surahsPromise: Promise<Map<number, SurahRow>> | null = null;

/** All 114 surahs keyed by number, cached after the first query. */
export function getSurahs(): Promise<Map<number, SurahRow>> {
  if (!surahsPromise) {
    surahsPromise = (async () => {
      const db = await getDb();
      const rows = await db.getAllAsync<SurahRow>('SELECT * FROM surah ORDER BY number');
      return new Map(rows.map((s) => [s.number, s]));
    })();
    surahsPromise.catch(() => {
      surahsPromise = null;
    });
  }
  return surahsPromise;
}

/** The surahs that contribute guidance ayahs, in mushaf order. */
export async function getGuidanceSurahs(): Promise<GuidanceSurah[]> {
  const db = await getDb();
  return db.getAllAsync<GuidanceSurah>(
    `SELECT s.*, COUNT(*) AS count, MIN(g.ordinal) AS firstOrdinal
     FROM guidance g JOIN ayah a ON a.id = g.ayah_id JOIN surah s ON s.number = a.surah
     GROUP BY s.number ORDER BY s.number`,
  );
}
