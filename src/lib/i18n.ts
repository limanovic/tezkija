import { useMemo, useSyncExternalStore } from 'react';

/**
 * UI strings. The ayah text itself comes from the `translation` table; this
 * file only covers app chrome (labels, buttons, notifications).
 *
 * `uiLanguage` in Settings is either 'auto' (follow the first selected
 * translation language) or an explicit code from this table.
 */

const en = {
  appTitle: 'Tezkija',
  tabGuidance: 'Ayahs',
  tabArabic: 'Arabic',
  guidanceTitle: 'Ayahs on conduct',
  guidanceIntro:
    '340 ayahs that say plainly how a person should act — to read, and to put into practice.',
  toProphet: 'To the Prophet',
  toProphetHint: 'Originally addressed to the Prophet ﷺ; the guidance applies to everyone.',
  surahs: 'Surahs',
  bookmarks: 'Bookmarks',
  notifOff:
    'Notifications are off, so daily ayahs can’t be delivered. Enable them to receive your readings.',
  enableNotifs: 'Enable notifications',
  reading: 'Reading',
  continueReading: 'Continue reading',
  startBeginning: 'Start from the beginning',
  allAyahs: 'All ayahs',
  passage: 'Passage',
  ayahs: 'Ayahs',
  wird: 'Daily ayahs',
  wirdHint: 'A few ayahs arrive at each time you set.',
  random: 'Random',
  sequential: 'In order',
  randomHint: 'A different passage each time, chosen at random.',
  sequentialHint: 'Takes the next ayahs in order, continuing on from your other in-order times.',
  sharedProgressionHint:
    'Every time set to In order continues where the last one stopped, as one pass through all 340 ayahs. It begins again from the first after the last.',
  nextUp: 'Next up',
  startOver: 'Start over from the beginning',
  time: 'Time',
  amount: 'Amount',
  noTimes: 'No times set — no notifications.',
  addTime: 'Add a time',
  remove: 'Remove',
  appearance: 'Appearance',
  settings: 'Settings',
  system: 'System',
  light: 'Light',
  dark: 'Dark',
  textTitle: 'Text',
  textSize: 'Text size',
  sampleText: 'In the name of God, the Most Gracious, the Most Merciful.',
  arabic: 'Arabic',
  appLanguage: 'App language',
  automatic: 'Automatic',
  previewNext: 'Preview the next passage',
  decrease: 'Decrease',
  increase: 'Increase',
  continueAyah: 'Open in the full list',
  loadError: 'Could not load this passage.',
  badRef: 'This passage reference could not be read.',
  noBookmarks: 'No bookmarks yet. While reading, tap ☆ Bookmark on any ayah to save your place.',
  ayahN: 'Ayah {n}',
  ayahOfN: 'Ayah {n} of {total}',
  juz: 'Juz',
  surahN: 'Surah {n}',
  meccan: 'Meccan',
  medinan: 'Medinan',
  ayahsCount: '{n} ayahs',
  bookmark: 'Bookmark',
  bookmarked: 'Bookmarked',
  channelName: 'Daily ayahs',
  deliveryTroubles: 'Reminders not arriving?',
  allowExactAlarms: 'Allow exact alarms',
  ignoreBatteryOpt: 'Ignore battery optimisation',
  exactAlarmsHint: 'Reminders may arrive a few minutes late. Allow exact alarms to fix that.',
  dismiss: 'Dismiss',
  autostartHint:
    'Your phone stops reminders from arriving in the background. Allow autostart so they reach you on time.',
  allowAutostart: 'Allow autostart',
  feedback: 'Feedback',
  sendFeedback: 'Send feedback',
  feedbackHint: 'Opens your email app. Ideas, bugs and requests are all welcome.',
  notifLangTitle: 'Notification language',
  sameAsReading: 'Same as reading text',
  arabicSoon: 'Arabic lessons are coming here.',
  arabicSoonHint:
    'Words of the Qur’an in frequency order, ten per lesson, with the ayahs they appear in. Repeat any lesson as often as you need.',
};

export type UiStringKey = keyof typeof en;
type Strings = Record<UiStringKey, string>;

const bs: Strings = {
  appTitle: 'Tezkija',
  tabGuidance: 'Ajeti',
  tabArabic: 'Arapski',
  guidanceTitle: 'Ajeti o ponašanju',
  guidanceIntro:
    '340 ajeta koji jasno govore kako čovjek treba da se ponaša — da se čitaju i primjenjuju.',
  toProphet: 'Poslaniku',
  toProphetHint: 'Izvorno upućeno Poslaniku ﷺ; uputa vrijedi za svakog čovjeka.',
  surahs: 'Sure',
  bookmarks: 'Zabilješke',
  notifOff:
    'Obavještenja su isključena pa se dnevni ajeti ne mogu dostavljati. Uključi ih da primaš čitanja.',
  enableNotifs: 'Uključi obavještenja',
  reading: 'Čitanje',
  continueReading: 'Nastavi čitanje',
  startBeginning: 'Počni od početka',
  allAyahs: 'Svi ajeti',
  passage: 'Odlomak',
  ayahs: 'Ajeti',
  wird: 'Dnevni ajeti',
  wirdHint: 'Nekoliko ajeta stiže u svako vrijeme koje postaviš.',
  random: 'Nasumično',
  sequential: 'Redom',
  randomHint: 'Svaki put drugi odlomak, izabran nasumično.',
  sequentialHint: 'Uzima sljedeće ajete po redu, nastavljajući se na ostala vremena koja idu redom.',
  sharedProgressionHint:
    'Svako vrijeme postavljeno na Redom nastavlja tamo gdje je prethodno stalo, kao jedan prolaz kroz svih 340 ajeta. Poslije posljednjeg počinje ponovo od prvog.',
  nextUp: 'Sljedeće',
  startOver: 'Počni ponovo od početka',
  time: 'Vrijeme',
  amount: 'Količina',
  noTimes: 'Nema postavljenih vremena — nema obavještenja.',
  addTime: 'Dodaj vrijeme',
  remove: 'Ukloni',
  appearance: 'Izgled',
  settings: 'Postavke',
  system: 'Sistemski',
  light: 'Svijetla',
  dark: 'Tamna',
  textTitle: 'Tekst',
  textSize: 'Veličina teksta',
  sampleText: 'U ime Allaha, Milostivog, Samilosnog.',
  arabic: 'Arapski',
  appLanguage: 'Jezik aplikacije',
  automatic: 'Automatski',
  previewNext: 'Pogledaj sljedeći odlomak',
  decrease: 'Smanji',
  increase: 'Povećaj',
  continueAyah: 'Otvori u cijelom popisu',
  loadError: 'Odlomak se ne može učitati.',
  badRef: 'Ova referenca odlomka se ne može pročitati.',
  noBookmarks:
    'Još nema zabilješki. Dok čitaš, dodirni ☆ na bilo kojem ajetu da sačuvaš mjesto.',
  ayahN: 'Ajet {n}',
  ayahOfN: 'Ajet {n} od {total}',
  juz: 'Džuz',
  surahN: 'Sura {n}',
  meccan: 'Mekkanska',
  medinan: 'Medinska',
  ayahsCount: '{n} ajeta',
  bookmark: 'Zabilježi',
  bookmarked: 'Zabilježeno',
  channelName: 'Dnevni ajeti',
  deliveryTroubles: 'Podsjetnici ne stižu?',
  allowExactAlarms: 'Dozvoli tačne alarme',
  ignoreBatteryOpt: 'Isključi optimizaciju baterije',
  exactAlarmsHint:
    'Podsjetnici mogu stići nekoliko minuta kasnije. Dozvoli tačne alarme da to riješiš.',
  dismiss: 'Odbaci',
  autostartHint:
    'Tvoj telefon zaustavlja podsjetnike u pozadini. Dozvoli automatsko pokretanje da stignu na vrijeme.',
  allowAutostart: 'Dozvoli automatsko pokretanje',
  feedback: 'Povratne informacije',
  sendFeedback: 'Pošalji povratnu informaciju',
  feedbackHint: 'Otvara tvoju aplikaciju za e-poštu. Ideje, greške i prijedlozi su dobrodošli.',
  notifLangTitle: 'Jezik obavještenja',
  sameAsReading: 'Isto kao tekst za čitanje',
  arabicSoon: 'Ovdje dolaze lekcije arapskog.',
  arabicSoonHint:
    'Riječi Kur’ana po učestalosti, deset po lekciji, s ajetima u kojima se pojavljuju. Svaku lekciju ponavljaš koliko god puta trebaš.',
};

const STRINGS: Record<string, Strings> = { en, bs };

/** Codes the UI can render itself in (same set as TRANSLATION_CODES). */
export const UI_LANGUAGE_CODES = Object.keys(STRINGS);

// Like the theme preference, the resolved language lives in Settings but
// components need it synchronously on every render — mirrored in a tiny
// store. _layout seeds it at launch; the settings screen updates it.
let current = 'bs';
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Resolve and apply the UI language from settings: an explicit code, or for
 * 'auto' the first selected translation language (falling back to Bosnian).
 */
export function applyUiLanguage(settings: { uiLanguage: string; translations: string[] }): void {
  const resolved =
    settings.uiLanguage !== 'auto' && STRINGS[settings.uiLanguage]
      ? settings.uiLanguage
      : settings.translations.find((c) => STRINGS[c]) ?? 'bs';
  if (resolved === current) return;
  current = resolved;
  listeners.forEach((l) => l());
}

function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in params ? String(params[key]) : match,
  );
}

function translate(
  lang: string,
  key: UiStringKey,
  params?: Record<string, string | number>,
): string {
  return format(STRINGS[lang]?.[key] ?? en[key], params);
}

/** Translate a UI string in the current language. Safe outside React (notifications, refs). */
export function t(key: UiStringKey, params?: Record<string, string | number>): string {
  return translate(current, key, params);
}

/**
 * React hook: returns a translate function for the current language.
 *
 * The returned function is a NEW identity whenever the language changes.
 * This is load-bearing: React Compiler memoizes JSX chunks by their
 * dependencies, so a stable `t` would leave every `t('...')` call cached in
 * the old language. A fresh identity invalidates those chunks.
 */
export function useT(): typeof t {
  const lang = useSyncExternalStore(subscribe, () => current);
  return useMemo(
    () =>
      (key: UiStringKey, params?: Record<string, string | number>) =>
        translate(lang, key, params),
    [lang],
  );
}
