import AsyncStorage from '@react-native-async-storage/async-storage';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import {
  GuidanceRow,
  LemmaRow,
  LessonItem,
  LessonRow,
  getExamplesForLemmas,
  getAllLemmas,
  getLemmasByIds,
  getLessonItems,
  getLessons,
  getTranslationsByIds,
} from './db';
import { applyUiLanguage, currentUiLanguage, t } from './i18n';
import { displayArabic } from './mushaf';
import { LedgerEntry, LedgerKind, NotificationPayload, TapListener } from './notification-types';
import { buildPassage, buildPassageAt, formatReference } from './passage';
import { ArabicDelivery, Delivery, Settings, notificationLanguages } from './settings';
import { Progress, boxOf, dueLemmaIds, isKnown, loadLessonCursor, loadProgress } from './vocab';
import { loadCursor } from './wird';

/*
 * Scheduling model — rolling window with pre-committed random picks.
 *
 * Local notifications freeze their content at scheduling time, and iOS caps
 * pending local notifications at 64. A single repeating "daily at 09:00"
 * trigger would therefore show the same passage forever. Instead, every
 * future (day × delivery-time) occurrence is scheduled as an independent
 * one-shot: the random passage is picked *now*, its text is baked into the
 * notification content, and a ledger entry records which passage belongs to
 * which occurrence so the Reader can reproduce it exactly.
 *
 * We keep at most MAX_PENDING (< 64, with headroom) one-shots queued. On
 * every app launch and foreground we prune past ledger entries and top the
 * window back up. If the user doesn't open the app for weeks the queue
 * eventually drains — OS-level guarantees for very long dormancy vary, and
 * the top-up-on-open pattern is the pragmatic fix for a personal app.
 *
 * Occurrences are scheduled nearest-first, so a run cut short by the app being
 * backgrounded still leaves the imminent reminders queued; the next foreground
 * fills in the tail.
 */

export type { LedgerEntry, LedgerKind, NotificationPayload } from './notification-types';

const LEDGER_KEY = 'ledger.v1';
const EXACT_PROMPT_KEY = 'exactAlarmPrompt.dismissed.v1';
const AUTOSTART_PROMPT_KEY = 'autostartPrompt.dismissed.v1';
const MAX_PENDING = 60;
// Android freezes a channel's importance at creation time — later
// setNotificationChannelAsync calls with the same id can't raise it, so a
// change of importance needs a new id here and the old one listed below.
const ANDROID_CHANNEL_ID = 'tezkija-v1';
const LEGACY_ANDROID_CHANNEL_IDS: string[] = [];

export function configureNotificationHandling(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Notification taps, the cold-start one included. The OS replays the launch
 * response to the listener as well, so a tap can be reported twice — the id
 * lets the caller take it once.
 */
export function subscribeToTaps(listener: TapListener): () => void {
  const record = (response: Notifications.NotificationResponse) =>
    listener(
      response.notification.request.identifier,
      response.notification.request.content.data as NotificationPayload | undefined,
    );
  Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      if (response) record(response);
    })
    .catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(record);
  return () => sub.remove();
}

/**
 * The OS module remembers the last response until it is cleared, so without
 * this every later cold start would reopen the Reader on a stale passage.
 */
export function clearLastTap(): void {
  Notifications.clearLastNotificationResponseAsync?.().catch(() => {});
}

/** Web only — the phone app has no push subscription. */
export async function forgetPushSubscription(): Promise<void> {}

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    // HIGH so the reminder surfaces as a heads-up banner. At DEFAULT it lands
    // in the shade only, which reads as "no notification arrived" to anyone
    // who doesn't pull the shade down at that moment.
    name: t('channelName'),
    importance: Notifications.AndroidImportance.HIGH,
    sound: undefined,
  });
  await Promise.all(
    LEGACY_ANDROID_CHANNEL_IDS.map((id) =>
      Notifications.deleteNotificationChannelAsync(id).catch(() => {}),
    ),
  );
}

/**
 * Android 12+ gates exact alarms behind SCHEDULE_EXACT_ALARM, and Android 14+
 * denies it by default. Without it a scheduled passage still arrives — the OS
 * batches it, landing a few minutes off the requested time.
 */
export { canScheduleExactAlarms, openExactAlarmSettings } from '../../modules/exact-alarms';

/**
 * The exact-alarm offer is a nicety, not a gate — reminders still arrive
 * without it. Once dismissed it stays dismissed; Settings keeps the row.
 */
export async function isExactAlarmPromptDismissed(): Promise<boolean> {
  return (await AsyncStorage.getItem(EXACT_PROMPT_KEY)) === '1';
}

export async function dismissExactAlarmPrompt(): Promise<void> {
  await AsyncStorage.setItem(EXACT_PROMPT_KEY, '1');
}

export { getManufacturer, needsAutostartSetup, openAutostartSettings } from '../../modules/exact-alarms';

/**
 * Autostart cannot be read back — the app can never tell whether the user
 * flipped it, so the prompt can't hide itself the way the exact-alarm one
 * does. Dismissal is the user saying "done"; Settings keeps the row after.
 */
export async function isAutostartPromptDismissed(): Promise<boolean> {
  return (await AsyncStorage.getItem(AUTOSTART_PROMPT_KEY)) === '1';
}

export async function dismissAutostartPrompt(): Promise<void> {
  await AsyncStorage.setItem(AUTOSTART_PROMPT_KEY, '1');
}

/**
 * Battery optimisation (and OEM "put app to sleep" features built on top of
 * it) suspends the alarm entirely while the phone is idle — the overnight
 * case where a morning reminder never fires at all.
 */
export async function openBatteryOptimizationSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS',
    );
  } catch {
    await Linking.openSettings().catch(() => {});
  }
}

export async function getPermissionGranted(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

export async function requestPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function loadLedger(): Promise<LedgerEntry[]> {
  const raw = await AsyncStorage.getItem(LEDGER_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as LedgerEntry[];
  } catch {
    return [];
  }
}

async function saveLedger(ledger: LedgerEntry[]): Promise<void> {
  await AsyncStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
}

function toDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Local wall-clock Date for an occurrence. Built from calendar components,
 * not UTC offsets, so 09:00 stays 09:00 across DST transitions.
 */
function occurrenceDate(dateISO: string, time: string): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

/**
 * The two delivery lists may share a wall-clock time — an ayah and a lesson
 * both at 09:00 — so an occurrence is keyed by list as well as by time.
 */
function occurrenceKey(e: { dateISO: string; time: string; kind?: LedgerKind }): string {
  const list = e.kind === undefined || e.kind === 'guidance' ? 'g' : 'a';
  return `${e.dateISO} ${e.time} ${list}`;
}

function byOccurrence(a: LedgerEntry, b: LedgerEntry): number {
  return occurrenceDate(a.dateISO, a.time).getTime() - occurrenceDate(b.dateISO, b.time).getTime();
}

/** Drop ledger entries whose occurrence has already fired. */
async function settleElapsed(now: Date): Promise<LedgerEntry[]> {
  const stored = await loadLedger();
  const pending = stored.filter((e) => occurrenceDate(e.dateISO, e.time) > now);
  if (pending.length !== stored.length) await saveLedger(pending);
  return pending;
}

/**
 * Notification body: the passage in each chosen language, one block per
 * language in the user's order. Arabic only when asked for (or when nothing
 * else is shown) — it renders poorly in OS notifications.
 */
async function buildBody(rows: GuidanceRow[], settings: Settings): Promise<string> {
  const langs = notificationLanguages(settings);
  const arabic = () => rows.map((r) => displayArabic(r.arabic)).join(' ');
  let blocks: string[] = [];
  if (rows.length > 0) {
    const codes = langs.filter((c) => c !== 'ar');
    const map = await getTranslationsByIds(codes, rows.map((r) => r.id));
    blocks = langs
      .map((lang) =>
        lang === 'ar' ? arabic() : rows.map((r) => map[lang]?.[r.id] ?? '').join(' ').trim(),
      )
      .filter((block) => block.length > 0);
  }
  const text = blocks.length > 0 ? blocks.join('\n\n') : arabic();
  // Android renders long bodies via BigText-style expansion; iOS truncates in
  // the banner and expands on long-press. Cap defensively anyway.
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
}

/**
 * `cursor` present means this delivery is in order and shows the passage at
 * that ordinal — the same one every time until the ayah is ticked; absent, the
 * passage is a random pick.
 */
async function scheduleGuidanceOccurrence(
  dateISO: string,
  delivery: Delivery,
  settings: Settings,
  cursor?: number,
): Promise<LedgerEntry> {
  const { rows, passageKey } =
    cursor === undefined
      ? await buildPassage(delivery.count)
      : await buildPassageAt(delivery.count, cursor);
  const title = await formatReference(rows);
  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body: await buildBody(rows, settings),
      data: { passageKey } satisfies NotificationPayload,
      sound: false,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: occurrenceDate(dateISO, delivery.time),
      channelId: ANDROID_CHANNEL_ID,
    },
  });
  return {
    notificationId,
    dateISO,
    time: delivery.time,
    kind: 'guidance',
    passageKey,
  };
}

/*
 * Arapski deliveries. Like passages, their content is picked and baked in at
 * scheduling time: the lesson notification carries the lesson the cursor
 * stands on now, a review the words due by that occurrence, a word delivery
 * a few frequent words not yet known. Finishing a lesson or a quiz rebuilds
 * the window so the pending picks catch up.
 */

type ArabicContext = {
  lessons: LessonRow[];
  cursor: number;
  progress: Progress;
  lemmas: LemmaRow[]; // rank order
};

async function loadArabicContext(): Promise<ArabicContext> {
  const [lessons, cursor, progress, lemmas] = await Promise.all([
    getLessons(),
    loadLessonCursor(),
    loadProgress(),
    getAllLemmas(),
  ]);
  return { lessons, cursor, progress, lemmas };
}

function gloss(l: LemmaRow): string {
  return currentUiLanguage() === 'en' ? l.gloss_en : l.gloss_bs;
}

function lessonTitle(lesson: LessonRow): string {
  const title = currentUiLanguage() === 'en' ? lesson.title_en : lesson.title_bs;
  return `${t('lessonN', { n: lesson.ordinal })} · ${title}`;
}

/** Cards of a lesson as one line each; grammar lessons summarise their text. */
function lessonBody(lesson: LessonRow, items: LessonItem[]): string {
  const en = currentUiLanguage() === 'en';
  const lines = items.map((i) => {
    if (i.lemma) return `${displayArabic(i.lemma.arabic)} — ${gloss(i.lemma)}`;
    const g = (en ? i.gloss_en : i.gloss_bs) ?? '';
    return `${displayArabic(i.arabic ?? '')} — ${g}`;
  });
  if (lines.length > 0) return lines.join('\n');
  const body = (en ? lesson.body_en : lesson.body_bs) ?? '';
  const text = body
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').replace(/\*/g, '').trim())
    .filter((l) => l.length > 0)
    .slice(0, 4)
    .join(' ');
  return text || t('open');
}

/** Shuffle in place (Fisher–Yates) and return the array. */
function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * Words for a 'word' delivery: `count` picked at random from the most
 * frequent 5×count lemmas not yet known, so the notification stays useful
 * but not the same every day.
 */
function pickUnknownWords(ctx: ArabicContext, count: number): LemmaRow[] {
  const pool = ctx.lemmas.filter((l) => !isKnown(ctx.progress, l.id)).slice(0, count * 5);
  return shuffle(pool).slice(0, count).sort((a, b) => a.rank - b.rank);
}

/**
 * Words for a 'review' delivery: up to `count` due by the occurrence, soonest
 * first. With nothing due, the box-0 words of the cursor lesson stand in, then
 * frequent unknown words — a review slot is never empty.
 */
async function pickReviewWords(ctx: ArabicContext, count: number, at: Date): Promise<LemmaRow[]> {
  const known = new Set(ctx.lemmas.map((l) => l.id));
  const due = dueLemmaIds(ctx.progress, at.getTime()).filter((id) => known.has(id));
  if (due.length > 0) return getLemmasByIds(due.slice(0, count));
  const items = await getLessonItems(ctx.cursor);
  const fresh = items
    .map((i) => i.lemma)
    .filter((l): l is LemmaRow => l !== null && boxOf(ctx.progress, l.id) === 0)
    .slice(0, count);
  if (fresh.length > 0) return fresh;
  return pickUnknownWords(ctx, count);
}

async function wordBody(words: LemmaRow[], settings: Settings): Promise<string> {
  const examples = await getExamplesForLemmas(words.map((w) => w.id));
  const lang = notificationLanguages(settings).find((c) => c !== 'ar');
  const ayahIds = words.map((w) => examples.get(w.id)?.[0]?.id).filter((id): id is number => id !== undefined);
  const translations = lang ? await getTranslationsByIds([lang], ayahIds) : {};
  return words
    .map((w) => {
      const head = `${displayArabic(w.arabic)} (${w.translit}) — ${gloss(w)}`;
      const ex = examples.get(w.id)?.[0];
      if (!ex) return head;
      const lines = [head, `${displayArabic(ex.arabic)} (${ex.surah}:${ex.ayah})`];
      const tr = lang ? translations[lang]?.[ex.id] : undefined;
      if (tr) lines.push(tr);
      return lines.join('\n');
    })
    .join('\n\n');
}

async function scheduleArabicOccurrence(
  dateISO: string,
  delivery: ArabicDelivery,
  settings: Settings,
  ctx: ArabicContext,
): Promise<LedgerEntry> {
  const at = occurrenceDate(dateISO, delivery.time);
  let title: string;
  let body: string;
  const payload: NotificationPayload = { kind: delivery.kind };
  if (delivery.kind === 'lesson') {
    const lesson = ctx.lessons.find((l) => l.id === ctx.cursor) ?? ctx.lessons[0];
    const items = await getLessonItems(lesson.id);
    title = lessonTitle(lesson);
    body = lessonBody(lesson, items);
    payload.lessonId = lesson.id;
  } else if (delivery.kind === 'review') {
    const words = await pickReviewWords(ctx, delivery.count, at);
    title = `${t('notifReview')} · ${t('wordsCount', { n: words.length })}`;
    // Arabic only: the point is to recall the meaning before opening.
    body = words.map((w) => `${displayArabic(w.arabic)} · ${w.translit}`).join('\n');
    payload.lemmaIds = words.map((w) => w.id);
  } else {
    const words = pickUnknownWords(ctx, delivery.count);
    title = words.length > 1 ? `${t('notifWord')} · ${t('wordsCount', { n: words.length })}` : t('notifWord');
    body = await wordBody(words, settings);
    payload.lemmaIds = words.map((w) => w.id);
  }
  if (body.length > 2000) body = `${body.slice(0, 2000)}…`;
  const notificationId = await Notifications.scheduleNotificationAsync({
    content: { title, body, data: payload, sound: false },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at,
      channelId: ANDROID_CHANNEL_ID,
    },
  });
  return { notificationId, dateISO, time: delivery.time, ...payload };
}

// Scheduling operations mutate the ledger and the OS notification queue, so
// concurrent runs (e.g. two quick settings changes) must not interleave —
// serialize them through this promise chain.
let scheduleChain: Promise<LedgerEntry[]> = Promise.resolve([]);

const ledgerListeners = new Set<(ledger: LedgerEntry[]) => void>();

/** Subscribe to ledger updates (fires after every top-up/rebuild). Returns unsubscribe. */
export function onLedgerChange(listener: (ledger: LedgerEntry[]) => void): () => void {
  ledgerListeners.add(listener);
  return () => ledgerListeners.delete(listener);
}

function enqueue(op: () => Promise<LedgerEntry[]>): Promise<LedgerEntry[]> {
  scheduleChain = scheduleChain.then(op, op).then((ledger) => {
    ledgerListeners.forEach((l) => l(ledger));
    return ledger;
  });
  return scheduleChain;
}

/**
 * Prune past ledger entries and schedule forward until the window is full.
 * Called on app launch and on every foreground. Safe to call repeatedly.
 */
export function topUpSchedule(settings: Settings): Promise<LedgerEntry[]> {
  return enqueue(() => topUpScheduleInner(settings));
}

/** Both lists merged into one clock-ordered day plan. */
type Slot = { time: string; guidance?: Delivery; arabic?: ArabicDelivery };

function daySlots(settings: Settings): Slot[] {
  const slots: Slot[] = [
    ...settings.deliveries.map((d) => ({ time: d.time, guidance: d })),
    ...settings.arabicDeliveries.map((d) => ({ time: d.time, arabic: d })),
  ];
  return slots.sort((a, b) => a.time.localeCompare(b.time));
}

async function topUpScheduleInner(settings: Settings): Promise<LedgerEntry[]> {
  const slots = daySlots(settings);
  // No times set: the user has turned notifications off from inside the app.
  // Clear anything still pending — and note the horizon maths below would
  // divide by zero and loop forever on an empty list.
  if (slots.length === 0) {
    await settleElapsed(new Date());
    await Notifications.cancelAllScheduledNotificationsAsync();
    await saveLedger([]);
    return [];
  }
  if (!(await getPermissionGranted())) return loadLedger();
  // Notification titles/bodies bake in text at scheduling time — make sure
  // they are built in the language these settings ask for.
  applyUiLanguage(settings);
  await ensureAndroidChannel();

  const now = new Date();
  const ledger = await settleElapsed(now);
  const scheduled = new Set(ledger.map(occurrenceKey));

  // Every in-order occurrence in the window shows the passage under the
  // cursor. Ticking the ayah moves the cursor and rebuilds the window.
  const cursor = await loadCursor();
  // Lesson cursor and Leitner state are read once per top-up; every Arapski
  // occurrence in this run is picked against the same snapshot.
  const arabicCtx = settings.arabicDeliveries.length > 0 ? await loadArabicContext() : null;

  // Fill the window: N days × deliveries/day (both lists), never exceeding
  // MAX_PENDING total.
  const horizonDays = Math.max(1, Math.floor(MAX_PENDING / slots.length));
  outer: for (let offset = 0; offset < horizonDays; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const dateISO = toDateISO(day);
    for (const slot of slots) {
      if (ledger.length >= MAX_PENDING) break outer;
      if (occurrenceDate(dateISO, slot.time) <= now) continue; // today's already-past times
      let entry: LedgerEntry;
      if (slot.guidance) {
        const delivery = slot.guidance;
        if (scheduled.has(occurrenceKey({ dateISO, time: delivery.time, kind: 'guidance' }))) continue;
        entry = await scheduleGuidanceOccurrence(
          dateISO,
          delivery,
          settings,
          delivery.mode === 'sequential' ? cursor : undefined,
        );
      } else if (slot.arabic && arabicCtx) {
        const delivery = slot.arabic;
        if (scheduled.has(occurrenceKey({ dateISO, time: delivery.time, kind: delivery.kind }))) continue;
        entry = await scheduleArabicOccurrence(dateISO, delivery, settings, arabicCtx);
      } else {
        continue;
      }
      ledger.push(entry);
      scheduled.add(occurrenceKey(entry));
    }
  }

  ledger.sort(byOccurrence);
  await saveLedger(ledger);
  return ledger;
}

/**
 * Settings changed: throw away every pending pick and rebuild the whole
 * window with the new count/times/translations.
 */
export function rebuildSchedule(settings: Settings): Promise<LedgerEntry[]> {
  return enqueue(async () => {
    await settleElapsed(new Date());
    await Notifications.cancelAllScheduledNotificationsAsync();
    await AsyncStorage.removeItem(LEDGER_KEY);
    return topUpScheduleInner(settings);
  });
}
