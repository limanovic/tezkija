import * as store from './store';

import { LemmaRow, LessonItem, LessonRow } from './db';
import { currentUiLanguage } from './i18n';
import { Settings } from './settings';

/*
 * Arapski user state — all in the key-value store (lib/store, synced to the
 * account when there is one), the database stays read-only.
 *
 * Three things are kept:
 *
 *  - Leitner progress per lemma (`vocab.progress.v1`): a box 0–5 and the time
 *    the word is next due. "Znam" moves a word up one box and pushes it out
 *    by BOX_DAYS[box]; "Ne znam" drops it to box 0, due now. A word counts as
 *    known — for the coverage line — from box 2 on.
 *
 *  - The lesson cursor (`vocab.cursor.v1`): the lesson id delivered as "the
 *    lesson" until it is marked finished. It never advances on its own; only
 *    "Završi lekciju" or "Vrati kursor ovdje" move it.
 *
 *  - Lesson states (`vocab.lessons.v1`): new until opened, learning once
 *    opened, done once finished. "Ponovi" puts a done lesson back to learning
 *    and resets its words' boxes without touching the cursor.
 */

export type WordProgress = { box: number; due: number };
/** Keyed by lemma id (as a string — JSON object keys). */
export type Progress = Record<string, WordProgress>;

export type LessonState = 'new' | 'learning' | 'done';
export type LessonStates = Record<string, LessonState>;

const PROGRESS_KEY = 'vocab.progress.v1';
const CURSOR_KEY = 'vocab.cursor.v1';
const LESSONS_KEY = 'vocab.lessons.v1';

/** Days until a word in box n is due again. */
export const BOX_DAYS = [1, 3, 7, 14, 30, 60] as const;
export const MAX_BOX = BOX_DAYS.length - 1;
/** From this box on a word counts as known. */
export const KNOWN_BOX = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

const FIRST_LESSON = 1;

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

function normalizeEntry(raw: unknown): WordProgress | null {
  if (!raw || typeof raw !== 'object') return null;
  const { box, due } = raw as Partial<WordProgress>;
  if (typeof box !== 'number' || typeof due !== 'number') return null;
  return { box: Math.min(MAX_BOX, Math.max(0, Math.floor(box))), due };
}

export async function loadProgress(): Promise<Progress> {
  const raw = await store.getItem(PROGRESS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Progress = {};
    for (const [id, entry] of Object.entries(parsed)) {
      const e = normalizeEntry(entry);
      if (e && /^\d+$/.test(id)) out[id] = e;
    }
    return out;
  } catch {
    return {};
  }
}

export async function saveProgress(progress: Progress): Promise<void> {
  await store.setItem(PROGRESS_KEY, JSON.stringify(progress));
}

/** Apply one flashcard answer. Pure — returns a new object. */
export function answer(progress: Progress, lemmaId: number, known: boolean, now = Date.now()): Progress {
  const current = progress[String(lemmaId)];
  const box = known ? Math.min(MAX_BOX, (current?.box ?? 0) + 1) : 0;
  const due = known ? now + BOX_DAYS[box] * DAY_MS : now;
  return { ...progress, [String(lemmaId)]: { box, due } };
}

/** Put the given words back to box 0, due now — "Ponovi". */
export function resetWords(progress: Progress, lemmaIds: number[], now = Date.now()): Progress {
  const next = { ...progress };
  for (const id of lemmaIds) next[String(id)] = { box: 0, due: now };
  return next;
}

export function boxOf(progress: Progress, lemmaId: number): number {
  return progress[String(lemmaId)]?.box ?? 0;
}

export function isKnown(progress: Progress, lemmaId: number): boolean {
  return boxOf(progress, lemmaId) >= KNOWN_BOX;
}

/** Lemma ids whose review is due at `at`, soonest-due first. All boxes count. */
export function dueLemmaIds(progress: Progress, at = Date.now()): number[] {
  return Object.entries(progress)
    .filter(([, e]) => e.due <= at)
    .sort((a, b) => a[1].due - b[1].due)
    .map(([id]) => Number(id));
}

/** How many words sit in each box, index = box. Words never seen are not counted. */
export function boxCounts(progress: Progress): number[] {
  const counts = new Array<number>(MAX_BOX + 1).fill(0);
  for (const e of Object.values(progress)) counts[e.box] += 1;
  return counts;
}

/**
 * Share of all Qur'an words covered by the lemmas known so far, in percent.
 * A lemma's `freq` is how many of the `totalTokens` words it accounts for.
 */
export function coveragePercent(
  progress: Progress,
  lemmas: Pick<LemmaRow, 'id' | 'freq'>[],
  totalTokens: number,
): number {
  if (totalTokens <= 0) return 0;
  const covered = lemmas.reduce((sum, l) => (isKnown(progress, l.id) ? sum + l.freq : sum), 0);
  return (100 * covered) / totalTokens;
}

/** Quiz order: the lesson's words in order, the box-0 ones first. */
export function quizOrder<T extends { lemma: LemmaRow | null }>(items: T[], progress: Progress): T[] {
  const withLemma = items.filter((i) => i.lemma !== null);
  const unknown = withLemma.filter((i) => boxOf(progress, i.lemma!.id) === 0);
  const rest = withLemma.filter((i) => boxOf(progress, i.lemma!.id) !== 0);
  return [...unknown, ...rest];
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

export async function loadLessonCursor(): Promise<number> {
  const raw = await store.getItem(CURSOR_KEY);
  const n = raw ? Math.floor(Number(raw)) : NaN;
  return Number.isFinite(n) && n >= FIRST_LESSON ? n : FIRST_LESSON;
}

export async function saveLessonCursor(lessonId: number): Promise<void> {
  await store.setItem(CURSOR_KEY, String(Math.max(FIRST_LESSON, Math.floor(lessonId))));
}

/** The lesson after `lessonId` in teaching order; the last one stays put. */
export function nextLessonId(lessons: LessonRow[], lessonId: number): number {
  const i = lessons.findIndex((l) => l.id === lessonId);
  const next = i >= 0 ? lessons[i + 1] : undefined;
  return next ? next.id : lessonId;
}

// ---------------------------------------------------------------------------
// Lesson states
// ---------------------------------------------------------------------------

export async function loadLessonStates(): Promise<LessonStates> {
  const raw = await store.getItem(LESSONS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: LessonStates = {};
    for (const [id, state] of Object.entries(parsed)) {
      if (state === 'learning' || state === 'done') out[id] = state;
    }
    return out;
  } catch {
    return {};
  }
}

async function saveLessonStates(states: LessonStates): Promise<void> {
  await store.setItem(LESSONS_KEY, JSON.stringify(states));
}

export function lessonState(states: LessonStates, lessonId: number): LessonState {
  return states[String(lessonId)] ?? 'new';
}

/** Opening a lesson marks it as being learned; a finished one stays finished. */
export async function markLessonOpened(lessonId: number): Promise<LessonStates> {
  const states = await loadLessonStates();
  if (lessonState(states, lessonId) !== 'new') return states;
  const next = { ...states, [String(lessonId)]: 'learning' as const };
  await saveLessonStates(next);
  return next;
}

/** "Završi lekciju": mark done and move the cursor to the next lesson. */
export async function finishLesson(lessons: LessonRow[], lessonId: number): Promise<void> {
  const states = await loadLessonStates();
  await saveLessonStates({ ...states, [String(lessonId)]: 'done' });
  // Only a finished lesson at the cursor advances it: finishing an older
  // lesson reopened from the list must not skip the one being learned now.
  const cursor = await loadLessonCursor();
  if (cursor === lessonId) await saveLessonCursor(nextLessonId(lessons, lessonId));
}

/** "Ponovi": back to learning, words back to box 0. The cursor stays. */
export async function repeatLesson(lessonId: number, items: LessonItem[]): Promise<void> {
  const [states, progress] = await Promise.all([loadLessonStates(), loadProgress()]);
  await saveLessonStates({ ...states, [String(lessonId)]: 'learning' });
  const ids = items.map((i) => i.lemma?.id).filter((id): id is number => id !== undefined);
  await saveProgress(resetWords(progress, ids));
}

/** Every user-facing piece of Arapski state, loaded together. */
export async function loadVocabState(): Promise<{
  progress: Progress;
  cursor: number;
  states: LessonStates;
}> {
  const [progress, cursor, states] = await Promise.all([
    loadProgress(),
    loadLessonCursor(),
    loadLessonStates(),
  ]);
  return { progress, cursor, states };
}

/**
 * Languages a lesson is shown in: the app language first, then every reading
 * translation that is on. Glosses, notes, grammar text and example ayahs all
 * follow this — someone reading Bosnian with English on sees both.
 */
export function lessonLanguages(settings: Pick<Settings, 'translations'>): ('bs' | 'en')[] {
  const ui = currentUiLanguage() === 'en' ? 'en' : 'bs';
  const list: ('bs' | 'en')[] = [ui];
  for (const code of settings.translations) {
    if ((code === 'bs' || code === 'en') && !list.includes(code)) list.push(code);
  }
  return list;
}
