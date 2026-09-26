import * as store from './store';
import { ThemePreference } from './theme';

/**
 * How a delivery picks its passage. 'sequential' walks the guidance set in
 * order from wherever the shared cursor last reached (see lib/wird), wrapping
 * back to the first ayah after the last; 'random' picks a fresh start every
 * time.
 */
export type WirdMode = 'random' | 'sequential';

export type Delivery = {
  time: string; // 'HH:mm' 24h wall-clock
  count: number; // guidance ayahs for this delivery
  mode: WirdMode;
};

/**
 * What an Arapski delivery sends. 'lesson' is the lesson the cursor stands on
 * — the same one again until it is finished, which is the point; 'review' is
 * up to `count` words due for repetition; 'word' is `count` frequent words not
 * yet known, each with its meaning and one ayah.
 */
export type ArabicDeliveryKind = 'lesson' | 'review' | 'word';

export type ArabicDelivery = {
  time: string; // 'HH:mm' 24h wall-clock
  kind: ArabicDeliveryKind;
  count: number; // words, for 'review' and 'word'
};

/** Codes present in the bundled database ('ar' excluded — that's showArabic). */
export const TRANSLATION_CODES = ['bs', 'en'] as const;
export type TranslationCode = (typeof TRANSLATION_CODES)[number];

export type UiLanguage = 'auto' | TranslationCode;

export type Settings = {
  deliveries: Delivery[]; // unique times, sorted by time; empty = no notifications
  showArabic: boolean;
  translations: string[]; // language codes, in display order
  textScale: number; // multiplier on reader font sizes, within TEXT_SCALE
  theme: ThemePreference;
  uiLanguage: UiLanguage; // 'auto' follows the first translation
  /**
   * Languages the notification body is written in, in order. null follows
   * `translations` (plus Arabic if that's all that's shown), so people who
   * never visit the setting keep getting what they read. 'ar' is allowed
   * here, unlike `translations`, since it's the whole text for some.
   */
  notificationLanguages: string[] | null;
  /** Arapski deliveries; unique times, sorted. Shares the notification window with `deliveries`. */
  arabicDeliveries: ArabicDelivery[];
  /** Show the Latin transliteration under Arabic headwords. */
  showTranslit: boolean;
};

const SETTINGS_KEY = 'settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  deliveries: [{ time: '09:00', count: 1, mode: 'sequential' }],
  showArabic: true,
  translations: ['bs'],
  textScale: 1,
  theme: 'system',
  uiLanguage: 'auto',
  notificationLanguages: null,
  arabicDeliveries: [],
  showTranslit: true,
};

/** Reader text size range, as a multiplier on the base font sizes. */
export const TEXT_SCALE = { min: 0.8, max: 1.6, step: 0.05 } as const;

/** Snap a scale to the nearest step and keep it inside the range. */
export function clampTextScale(scale: number): number {
  const { min, max, step } = TEXT_SCALE;
  const snapped = Math.round(scale / step) * step;
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(2));
}

/** Guidance ayahs per delivery. */
export const COUNT_BOUNDS = { min: 1, max: 10 } as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeDelivery(d: Partial<Delivery>): Delivery {
  const { min, max } = COUNT_BOUNDS;
  const count = Math.min(max, Math.max(min, Math.round(d.count ?? min) || min));
  const mode: WirdMode = d.mode === 'random' ? 'random' : 'sequential';
  return { time: d.time ?? '', count, mode };
}

const ARABIC_KINDS: ArabicDeliveryKind[] = ['lesson', 'review', 'word'];

function normalizeArabicDelivery(d: Partial<ArabicDelivery>): ArabicDelivery {
  const { min, max } = COUNT_BOUNDS;
  const count = Math.min(max, Math.max(min, Math.round(d.count ?? min) || min));
  const kind = ARABIC_KINDS.includes(d.kind as ArabicDeliveryKind) ? (d.kind as ArabicDeliveryKind) : 'lesson';
  return { time: d.time ?? '', kind, count };
}

/** Keep well-formed, unique times in clock order. */
function uniqueTimes<T extends { time: string }>(list: unknown): T[] {
  const seen = new Set<string>();
  return (Array.isArray(list) ? (list as T[]) : [])
    .filter((d) => TIME_RE.test(d.time) && !seen.has(d.time) && (seen.add(d.time), true))
    .sort((a, b) => a.time.localeCompare(b.time));
}

/** Clamp/repair a settings object so the rest of the app can trust it. */
export function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  s.deliveries = uniqueTimes(
    (Array.isArray(s.deliveries) ? s.deliveries : []).map(normalizeDelivery),
  );
  s.arabicDeliveries = uniqueTimes(
    (Array.isArray(s.arabicDeliveries) ? s.arabicDeliveries : []).map(normalizeArabicDelivery),
  );
  s.showTranslit = s.showTranslit !== false;
  // An empty list is a valid choice: it's how a user turns notifications off
  // from inside the app. Fresh installs still start from DEFAULT_SETTINGS.
  const known = new Set<string>(TRANSLATION_CODES);
  s.translations = [...new Set(Array.isArray(s.translations) ? s.translations : [])].filter(
    (c) => known.has(c),
  );
  // Something must stay visible.
  if (!s.showArabic && s.translations.length === 0) s.translations = ['bs'];
  // Snap to the nearest step so a hand-edited or future-version value still
  // lands on something the picker can show as selected.
  s.textScale =
    typeof s.textScale === 'number' && Number.isFinite(s.textScale)
      ? clampTextScale(s.textScale)
      : DEFAULT_SETTINGS.textScale;
  if (s.theme !== 'system' && s.theme !== 'light' && s.theme !== 'dark') s.theme = 'system';
  if (s.uiLanguage !== 'auto' && !known.has(s.uiLanguage)) s.uiLanguage = 'auto';
  if (Array.isArray(s.notificationLanguages)) {
    const picked = [...new Set(s.notificationLanguages)].filter((c) => c === 'ar' || known.has(c));
    // An explicit empty list would mean silent notifications — fall back to auto.
    s.notificationLanguages = picked.length > 0 ? picked : null;
  } else {
    s.notificationLanguages = null;
  }
  return s;
}

/**
 * Languages a notification body is composed in, in order. Explicit choice
 * wins; otherwise the reading translations, or Arabic when nothing else is
 * shown.
 */
export function notificationLanguages(settings: Settings): string[] {
  if (settings.notificationLanguages && settings.notificationLanguages.length > 0) {
    return settings.notificationLanguages;
  }
  return settings.translations.length > 0 ? settings.translations : ['ar'];
}

export async function loadSettings(): Promise<Settings> {
  const raw = await store.getItem(SETTINGS_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  const normalized = normalizeSettings(settings);
  await store.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}
