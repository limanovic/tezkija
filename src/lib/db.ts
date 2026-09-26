import { openDatabase } from './db-open';
import { Db } from './db-types';

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

/*
 * Arapski — vocabulary tables built by scripts/build-vocab.py from the Quranic
 * Arabic Corpus morphology. `lemma` holds the 1,000 most frequent lemmas,
 * `lesson` the 111 lessons in the order they are taught, `lesson_item` what
 * each lesson contains (a lemma, or hand-written glue text), `lemma_example`
 * two ayahs per lemma with the token to highlight.
 */

export type LemmaRow = {
  id: number;
  arabic: string;
  translit: string;
  root: string | null;
  pos: string;
  freq: number;
  rank: number;
  gloss_en: string;
  gloss_bs: string;
};

/**
 * Phases: 0 glue (prefixes/suffixes), 1 particles, 2–3 words in frequency
 * order, 4 grammar. Grammar lessons carry markdown in body_* and no items.
 */
export type LessonRow = {
  id: number;
  ordinal: number;
  phase: number;
  title_bs: string;
  title_en: string;
  body_bs: string | null;
  body_en: string | null;
};

/** One card of a lesson: a lemma, or (phase 0) hand-written glue text. */
export type LessonItem = {
  ordinal: number;
  lemma: LemmaRow | null;
  arabic: string | null;
  gloss_bs: string | null;
  gloss_en: string | null;
  note_bs: string | null;
  note_en: string | null;
};

/** An example ayah for a lemma. `word_index` is 1-based into `arabic.split(' ')`. */
export type LemmaExampleRow = AyahRow & { lemma_id: number; word_index: number };

export type VocabMeta = { total_tokens: number; lemma_count: number; max_rank: number };

let dbPromise: Promise<Db> | null = null;

/** Open the bundled database (platform-specific, see db-open). Safe to call repeatedly. */
export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = openDatabase();
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

// ---------------------------------------------------------------------------
// Arapski
// ---------------------------------------------------------------------------

let lessonsPromise: Promise<LessonRow[]> | null = null;

/** Every lesson in teaching order, cached after the first query. */
export function getLessons(): Promise<LessonRow[]> {
  if (!lessonsPromise) {
    lessonsPromise = (async () => {
      const db = await getDb();
      return db.getAllAsync<LessonRow>('SELECT * FROM lesson ORDER BY ordinal');
    })();
    lessonsPromise.catch(() => {
      lessonsPromise = null;
    });
  }
  return lessonsPromise;
}

export async function getLesson(id: number): Promise<LessonRow | null> {
  const lessons = await getLessons();
  return lessons.find((l) => l.id === id) ?? null;
}

/** The lesson's cards in order, with the lemma joined in where there is one. */
export async function getLessonItems(lessonId: number): Promise<LessonItem[]> {
  const db = await getDb();
  type Row = {
    ordinal: number;
    lemma_id: number | null;
    arabic: string | null;
    gloss_bs: string | null;
    gloss_en: string | null;
    note_bs: string | null;
    note_en: string | null;
    l_arabic: string | null;
    l_translit: string | null;
    l_root: string | null;
    l_pos: string | null;
    l_freq: number | null;
    l_rank: number | null;
    l_gloss_en: string | null;
    l_gloss_bs: string | null;
  };
  const rows = await db.getAllAsync<Row>(
    `SELECT i.ordinal, i.lemma_id, i.arabic, i.gloss_bs, i.gloss_en, i.note_bs, i.note_en,
            l.arabic AS l_arabic, l.translit AS l_translit, l.root AS l_root, l.pos AS l_pos,
            l.freq AS l_freq, l.rank AS l_rank, l.gloss_en AS l_gloss_en, l.gloss_bs AS l_gloss_bs
     FROM lesson_item i LEFT JOIN lemma l ON l.id = i.lemma_id
     WHERE i.lesson_id = ? ORDER BY i.ordinal`,
    [lessonId],
  );
  return rows.map((r) => ({
    ordinal: r.ordinal,
    lemma:
      r.lemma_id !== null
        ? {
            id: r.lemma_id,
            arabic: r.l_arabic ?? '',
            translit: r.l_translit ?? '',
            root: r.l_root,
            pos: r.l_pos ?? '',
            freq: r.l_freq ?? 0,
            rank: r.l_rank ?? 0,
            gloss_en: r.l_gloss_en ?? '',
            gloss_bs: r.l_gloss_bs ?? '',
          }
        : null,
    arabic: r.arabic,
    gloss_bs: r.gloss_bs,
    gloss_en: r.gloss_en,
    note_bs: r.note_bs,
    note_en: r.note_en,
  }));
}

/** Lemmas by id, returned in the order asked for. */
export async function getLemmasByIds(ids: number[]): Promise<LemmaRow[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const marks = ids.map(() => '?').join(', ');
  const rows = await db.getAllAsync<LemmaRow>(`SELECT * FROM lemma WHERE id IN (${marks})`, ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is LemmaRow => r !== undefined);
}

/** All lemmas, rank order — 1,000 small rows, fine to hold at once. */
export async function getAllLemmas(): Promise<LemmaRow[]> {
  const db = await getDb();
  return db.getAllAsync<LemmaRow>('SELECT * FROM lemma ORDER BY rank');
}

/** Example ayahs for a set of lemmas, keyed by lemma id, shortest first. */
export async function getExamplesForLemmas(ids: number[]): Promise<Map<number, LemmaExampleRow[]>> {
  const map = new Map<number, LemmaExampleRow[]>();
  if (ids.length === 0) return map;
  const db = await getDb();
  const marks = ids.map(() => '?').join(', ');
  const rows = await db.getAllAsync<LemmaExampleRow>(
    `SELECT a.*, e.lemma_id, e.word_index
     FROM lemma_example e JOIN ayah a ON a.id = e.ayah_id
     WHERE e.lemma_id IN (${marks}) ORDER BY e.lemma_id, LENGTH(a.arabic)`,
    ids,
  );
  for (const row of rows) {
    const list = map.get(row.lemma_id) ?? [];
    list.push(row);
    map.set(row.lemma_id, list);
  }
  return map;
}

let vocabMetaPromise: Promise<VocabMeta> | null = null;

export function getVocabMeta(): Promise<VocabMeta> {
  if (!vocabMetaPromise) {
    vocabMetaPromise = (async () => {
      const db = await getDb();
      const row = await db.getFirstAsync<VocabMeta>('SELECT * FROM vocab_meta');
      if (!row) throw new Error('vocab_meta is empty');
      return row;
    })();
    vocabMetaPromise.catch(() => {
      vocabMetaPromise = null;
    });
  }
  return vocabMetaPromise;
}

/** How many word cards each lesson has, keyed by lesson id — one query, not one per lesson. */
export async function getLessonWordCounts(): Promise<Map<number, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ lesson_id: number; n: number }>(
    'SELECT lesson_id, COUNT(*) AS n FROM lesson_item WHERE lemma_id IS NOT NULL GROUP BY lesson_id',
  );
  return new Map(rows.map((r) => [r.lesson_id, r.n]));
}
