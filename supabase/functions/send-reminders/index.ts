// Sends the due reminders as Web Push. Called every 5 minutes by pg_cron
// (see migrations/0002_push.sql) with the shared CRON_SECRET header.
//
// For every user with a push subscription: read their synced settings and
// cursors from user_state, work out which delivery times fell in the last
// five minutes in the device's timezone, pick the content exactly as the
// phone app would (same cursor, same word rules), and push it. The content
// itself comes from /push-data.json on the deployed site, so this function
// never needs the database.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

type Guidance = { ordinal: number; id: number; surah: number; ayah: number; ar: string; bs?: string; en?: string };
type Example = { id: number; surah: number; ayah: number; ar: string; bs?: string; en?: string };
type Lemma = { id: number; rank: number; ar: string; translit: string; gloss_bs: string; gloss_en: string; ex: Example | null };
type LessonItem = { lemma: number } | { ar: string; gloss_bs: string; gloss_en: string };
type Lesson = { id: number; ordinal: number; title_bs: string; title_en: string; body_bs: string; body_en: string; items: LessonItem[] };
type PushData = { surahs: Record<string, string>; guidance: Guidance[]; lemmas: Lemma[]; lessons: Lesson[] };

type Delivery = { time: string; count: number; mode: 'random' | 'sequential' };
type ArabicDelivery = { time: string; kind: 'lesson' | 'review' | 'word'; count: number };
type Settings = {
  deliveries: Delivery[];
  arabicDeliveries: ArabicDelivery[];
  translations: string[];
  showArabic: boolean;
  uiLanguage: string;
  notificationLanguages: string[] | null;
};
type Progress = Record<string, { box: number; due: number }>;
type Subscription = { endpoint: string; user_id: string; p256dh: string; auth: string; tz: string };
type Message = { title: string; body: string; url: string; tag: string };

const WINDOW_MINUTES = 5;
const TOTAL_GUIDANCE = 340;
const KNOWN_BOX = 2;

const STRINGS: Record<string, Record<string, string>> = {
  en: { lessonN: 'Lesson {n}', notifReview: 'Review', notifWord: 'Word of the day', words: '{n} words', word: '{n} word', surahN: 'Surah {n}', open: 'Open' },
  bs: { lessonN: 'Lekcija {n}', notifReview: 'Ponavljanje', notifWord: 'Riječ dana', words: '{n} riječi', word: '{n} riječ', surahN: 'Sura {n}', open: 'Otvori' },
};

// ---------------------------------------------------------------------------
// Content, cached across warm invocations
// ---------------------------------------------------------------------------

let cache: { at: number; data: PushData } | null = null;

async function loadData(siteUrl: string): Promise<PushData> {
  if (cache && Date.now() - cache.at < 60 * 60 * 1000) return cache.data;
  const res = await fetch(`${siteUrl}/push-data.json`);
  if (!res.ok) throw new Error(`push-data.json: ${res.status}`);
  const data = (await res.json()) as PushData;
  cache = { at: Date.now(), data };
  return data;
}

// ---------------------------------------------------------------------------
// Helpers mirroring the app
// ---------------------------------------------------------------------------

function displayArabic(text: string): string {
  return text.replace(/۟/g, '۠');
}

function uiLanguage(s: Settings): 'bs' | 'en' {
  const pick = s.uiLanguage !== 'auto' ? s.uiLanguage : s.translations.find((c) => c === 'bs' || c === 'en');
  return pick === 'en' ? 'en' : 'bs';
}

function tr(lang: string, key: string, n?: number): string {
  const s = STRINGS[lang]?.[key] ?? STRINGS.bs[key] ?? key;
  return n === undefined ? s : s.replace('{n}', String(n));
}

function notificationLanguages(s: Settings): string[] {
  if (s.notificationLanguages && s.notificationLanguages.length > 0) return s.notificationLanguages;
  return s.translations.length > 0 ? s.translations : ['ar'];
}

function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const timeOk = (t: unknown) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  return {
    deliveries: (Array.isArray(r.deliveries) ? r.deliveries : []).filter((d) => timeOk(d?.time)).map((d) => ({
      time: d.time,
      count: Math.min(10, Math.max(1, Math.round(Number(d.count) || 1))),
      mode: d.mode === 'random' ? 'random' : 'sequential',
    })),
    arabicDeliveries: (Array.isArray(r.arabicDeliveries) ? r.arabicDeliveries : []).filter((d) => timeOk(d?.time)).map((d) => ({
      time: d.time,
      kind: d.kind === 'review' || d.kind === 'word' ? d.kind : 'lesson',
      count: Math.min(10, Math.max(1, Math.round(Number(d.count) || 1))),
    })),
    translations: Array.isArray(r.translations) ? r.translations.filter((c) => c === 'bs' || c === 'en') : ['bs'],
    showArabic: r.showArabic !== false,
    uiLanguage: typeof r.uiLanguage === 'string' ? r.uiLanguage : 'auto',
    notificationLanguages: Array.isArray(r.notificationLanguages) ? r.notificationLanguages : null,
  };
}

/** Local wall clock in a timezone: calendar date and minutes since midnight. */
function localNow(tz: string, now: Date): { date: string; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(now);
  } catch {
    return localNow('Europe/Sarajevo', now);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const hour = Number(get('hour')) % 24; // some engines print 24 at midnight
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: hour * 60 + Number(get('minute')) };
}

function slotMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function isDue(time: string, nowMinutes: number): boolean {
  const diff = nowMinutes - slotMinutes(time);
  return diff >= 0 && diff < WINDOW_MINUTES;
}

function formatReference(rows: Guidance[], surahs: Record<string, string>, lang: string): string {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const name = (n: number) => surahs[String(n)] ?? tr(lang, 'surahN', n);
  if (first.id === last.id) return `${name(first.surah)} ${first.surah}:${first.ayah}`;
  if (first.surah === last.surah) return `${name(first.surah)} ${first.surah}:${first.ayah} – ${last.surah}:${last.ayah}`;
  return `${name(first.surah)} ${first.surah}:${first.ayah} – ${name(last.surah)} ${last.surah}:${last.ayah}`;
}

function cap(text: string): string {
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
}

// ---------------------------------------------------------------------------
// Guidance (Ajeti)
// ---------------------------------------------------------------------------

function guidanceMessage(d: Delivery, s: Settings, cursor: number, data: PushData): Message {
  const lang = uiLanguage(s);
  let start: number;
  let take: number;
  if (d.mode === 'sequential') {
    start = Math.min(TOTAL_GUIDANCE, Math.max(1, Math.floor(cursor) || 1));
    take = Math.min(d.count, TOTAL_GUIDANCE - start + 1);
  } else {
    start = 1 + Math.floor(Math.random() * (TOTAL_GUIDANCE - d.count + 1));
    take = d.count;
  }
  const rows = data.guidance.slice(start - 1, start - 1 + take);
  const langs = notificationLanguages(s);
  const arabic = () => rows.map((r) => displayArabic(r.ar)).join(' ');
  const blocks = langs
    .map((l) => (l === 'ar' ? arabic() : rows.map((r) => (l === 'en' ? r.en : r.bs) ?? '').join(' ').trim()))
    .filter((b) => b.length > 0);
  const key = JSON.stringify({ startOrdinal: start, count: take });
  return {
    title: formatReference(rows, data.surahs, lang),
    body: cap(blocks.length > 0 ? blocks.join('\n\n') : arabic()),
    url: `/reader?key=${encodeURIComponent(key)}`,
    tag: `guidance-${d.time}`,
  };
}

// ---------------------------------------------------------------------------
// Arapski
// ---------------------------------------------------------------------------

function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function boxOf(p: Progress, id: number): number {
  return p[String(id)]?.box ?? 0;
}

function pickUnknownWords(lemmas: Lemma[], progress: Progress, count: number): Lemma[] {
  const pool = lemmas.filter((l) => boxOf(progress, l.id) < KNOWN_BOX).slice(0, count * 5);
  return shuffle(pool).slice(0, count).sort((a, b) => a.rank - b.rank);
}

function pickReviewWords(data: PushData, progress: Progress, cursor: number, count: number, now: number): Lemma[] {
  const byId = new Map(data.lemmas.map((l) => [l.id, l]));
  const due = Object.entries(progress)
    .filter(([id, e]) => e.due <= now && byId.has(Number(id)))
    .sort((a, b) => a[1].due - b[1].due)
    .slice(0, count)
    .map(([id]) => byId.get(Number(id))!);
  if (due.length > 0) return due;
  const lesson = data.lessons.find((l) => l.id === cursor);
  const fresh = (lesson?.items ?? [])
    .map((i) => ('lemma' in i ? byId.get(i.lemma) : undefined))
    .filter((l): l is Lemma => l !== undefined && boxOf(progress, l.id) === 0)
    .slice(0, count);
  if (fresh.length > 0) return fresh;
  return pickUnknownWords(data.lemmas, progress, count);
}

function arabicMessage(d: ArabicDelivery, s: Settings, cursor: number, progress: Progress, data: PushData, now: number): Message {
  const lang = uiLanguage(s);
  const en = lang === 'en';
  const gloss = (l: Lemma) => (en ? l.gloss_en : l.gloss_bs);
  const byId = new Map(data.lemmas.map((l) => [l.id, l]));

  if (d.kind === 'lesson') {
    const lesson = data.lessons.find((l) => l.id === cursor) ?? data.lessons[0];
    const lines = lesson.items.map((i) => {
      if ('lemma' in i) {
        const l = byId.get(i.lemma);
        return l ? `${displayArabic(l.ar)} — ${gloss(l)}` : '';
      }
      return `${displayArabic(i.ar)} — ${en ? i.gloss_en : i.gloss_bs}`;
    }).filter((l) => l.length > 0);
    const body = lines.length > 0 ? lines.join('\n') : (en ? lesson.body_en : lesson.body_bs) || tr(lang, 'open');
    return {
      title: `${tr(lang, 'lessonN', lesson.ordinal)} · ${en ? lesson.title_en : lesson.title_bs}`,
      body: cap(body),
      url: `/lesson?id=${lesson.id}`,
      tag: `lesson-${d.time}`,
    };
  }

  const wordsCount = (n: number) => tr(lang, n === 1 ? 'word' : 'words', n);
  if (d.kind === 'review') {
    const words = pickReviewWords(data, progress, cursor, d.count, now);
    return {
      title: `${tr(lang, 'notifReview')} · ${wordsCount(words.length)}`,
      body: cap(words.map((w) => `${displayArabic(w.ar)} · ${w.translit}`).join('\n')),
      url: `/quiz?lemmas=${words.map((w) => w.id).join(',')}`,
      tag: `review-${d.time}`,
    };
  }

  const words = pickUnknownWords(data.lemmas, progress, d.count);
  const exLang = notificationLanguages(s).find((c) => c === 'bs' || c === 'en');
  const body = words
    .map((w) => {
      const head = `${displayArabic(w.ar)} (${w.translit}) — ${gloss(w)}`;
      if (!w.ex) return head;
      const lines = [head, `${displayArabic(w.ex.ar)} (${w.ex.surah}:${w.ex.ayah})`];
      const t = exLang === 'en' ? w.ex.en : exLang === 'bs' ? w.ex.bs : undefined;
      if (t) lines.push(t);
      return lines.join('\n');
    })
    .join('\n\n');
  return {
    title: words.length > 1 ? `${tr(lang, 'notifWord')} · ${wordsCount(words.length)}` : tr(lang, 'notifWord'),
    body: cap(body),
    url: `/lesson?lemmas=${words.map((w) => w.id).join(',')}`,
    tag: `word-${d.time}`,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response('unauthorized', { status: 401 });
  }
  const siteUrl = Deno.env.get('SITE_URL') ?? 'https://tezkija.adiv.dev';
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:office@adiv.dev',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  );
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: subs, error: subsError } = await db
    .from('push_subscriptions')
    .select('endpoint,user_id,p256dh,auth,tz')
    .order('updated_at', { ascending: false });
  if (subsError) return new Response(subsError.message, { status: 500 });
  if (!subs || subs.length === 0) return Response.json({ users: 0, sent: 0 });

  const byUser = new Map<string, Subscription[]>();
  for (const s of subs as Subscription[]) (byUser.get(s.user_id) ?? byUser.set(s.user_id, []).get(s.user_id)!).push(s);

  const { data: states, error: stateError } = await db
    .from('user_state')
    .select('user_id,key,value')
    .in('user_id', [...byUser.keys()])
    .in('key', ['settings.v1', 'guidance.cursor.v1', 'vocab.cursor.v1', 'vocab.progress.v1']);
  if (stateError) return new Response(stateError.message, { status: 500 });
  const state = new Map<string, Record<string, unknown>>();
  for (const row of states ?? []) (state.get(row.user_id) ?? state.set(row.user_id, {}).get(row.user_id)!)[row.key] = row.value;

  const data = await loadData(siteUrl);
  const now = new Date();
  let sent = 0;
  let failed = 0;
  const stale: string[] = [];

  for (const [userId, userSubs] of byUser) {
    const st = state.get(userId) ?? {};
    const settings = normalizeSettings(st['settings.v1']);
    if (settings.deliveries.length === 0 && settings.arabicDeliveries.length === 0) continue;
    // Newest subscription's timezone decides "now"; both phones of one person
    // are in the same place.
    const { date, minutes } = localNow(userSubs[0].tz, now);
    const guidanceCursor = Number(st['guidance.cursor.v1']) || 1;
    const lessonCursor = Number(st['vocab.cursor.v1']) || 1;
    const progress = (st['vocab.progress.v1'] ?? {}) as Progress;

    const due: { list: 'g' | 'a'; time: string; message: () => Message }[] = [];
    for (const d of settings.deliveries) {
      if (isDue(d.time, minutes)) due.push({ list: 'g', time: d.time, message: () => guidanceMessage(d, settings, guidanceCursor, data) });
    }
    for (const d of settings.arabicDeliveries) {
      if (isDue(d.time, minutes)) due.push({ list: 'a', time: d.time, message: () => arabicMessage(d, settings, lessonCursor, progress, data, now.getTime()) });
    }

    for (const slot of due) {
      // The log row is the lock: whoever inserts it sends, a second run sees a conflict.
      const { data: claimed } = await db
        .from('push_log')
        .insert({ user_id: userId, local_date: date, time: slot.time, list: slot.list })
        .select('time');
      if (!claimed || claimed.length === 0) continue;
      const message = slot.message();
      const payload = JSON.stringify(message);
      for (const sub of userSubs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: 60 * 60 * 6, urgency: 'normal' },
          );
          sent++;
        } catch (e) {
          failed++;
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) stale.push(sub.endpoint);
        }
      }
    }
  }

  if (stale.length > 0) await db.from('push_subscriptions').delete().in('endpoint', stale);
  return Response.json({ users: byUser.size, sent, failed, removed: stale.length });
});
