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
  sequentialHint: 'Sends the ayah the reading stands on — the same one again until you tick it as practised.',
  sharedProgressionHint:
    'One pass through all 340 ayahs. The ayah under the cursor arrives at every in-order time until you tick it as practised; then the next unticked one takes its place.',
  nextUp: 'Next up',
  practised: 'Practised',
  practisedCount: '{n} of {total} practised',
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
  ayahsCountOne: '{n} ayah',
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
  arabicIntro:
    'Words of the Qur’an in frequency order, ten per lesson, with the ayahs they appear in. A lesson repeats until you mark it learned.',
  todaysLesson: 'Current lesson',
  open: 'Open',
  lessons: 'Lessons',
  lessonN: 'Lesson {n}',
  phaseGlue: 'Glue: prefixes and suffixes',
  phaseParticles: 'Particles',
  phaseWords: 'Words',
  phaseWords2: 'Words, continued',
  phaseGrammar: 'Grammar',
  statusNew: 'new',
  statusLearning: 'learning',
  statusDone: 'learned',
  wordsCount: '{n} words',
  wordsCountOne: '{n} word',
  coverage: 'You know words that cover {p} % of the Qur’an.',
  quiz: 'Quiz',
  finishLesson: 'Finish lesson',
  repeatLesson: 'Repeat',
  setCursorHere: 'Move the cursor here',
  cursorHere: 'current',
  know: 'I know it',
  dontKnow: 'I don’t know',
  tapToFlip: 'Tap to flip',
  quizDone: 'Quiz finished',
  quizSummary: '{known} known · {unknown} not yet',
  repeatUnknown: 'Repeat the unknown ones',
  back: 'Back',
  root: 'Root',
  rankLine: 'rank {rank} · {n}×',
  examples: 'Examples',
  progressTitle: 'Progress',
  dueWords: '{n} words due for review',
  dueWordsOne: '{n} word due for review',
  reviewDue: 'Review due words',
  noDue: 'No words due for review.',
  boxN: 'Box {n}',
  boxHint:
    'Every word climbs one box when you know it and falls back to box 0 when you don’t. Boxes are due again after 1, 3, 7, 14, 30 and 60 days.',
  lessonsDone: '{n} of {total} lessons learned',
  arabicWird: 'Daily Arabic',
  arabicWirdHint: 'A lesson, a review or a word arrives at each time you set.',
  kindLesson: 'Lesson',
  kindReview: 'Review',
  kindWord: 'Word',
  kindLessonHint: 'Sends the current lesson — the same one again until you finish it.',
  kindReviewHint: 'Sends up to this many words due for review, from every box.',
  kindWordHint: 'Sends this many frequent words you do not know yet, each with its meaning and one ayah.',
  translitToggle: 'Transliteration',
  nothingToQuiz: 'This lesson has no words to quiz.',
  delivery: 'Delivery',
  notifReview: 'Review',
  notifWord: 'Word of the day',
  words: 'Words',
  loading: 'Loading…',
  posN: 'noun',
  posPN: 'proper noun',
  posADJ: 'adjective',
  posV: 'verb (past, “he …”)',
  posP: 'preposition',
  posPRON: 'pronoun',
  posDEM: 'demonstrative',
  posREL: 'relative pronoun',
  posT: 'adverb of time',
  posLOC: 'adverb of place',
  posINTG: 'question word',
  posNEG: 'negation',
  posCONJ: 'conjunction',
  posCOND: 'conditional',
  posSUB: 'conjunction (“that”)',
  posACC: 'particle (accusative follows)',
  posOther: 'particle',
  langBs: 'Bosnian',
  langEn: 'English',
  ok: 'OK',
  cancel: 'Cancel',
  account: 'Account',
  signIn: 'Sign in',
  signOut: 'Sign out',
  accountHint:
    'Sign in to keep your progress — ayahs, Arabic lessons, bookmarks — and pick it up on another device.',
  email: 'Email',
  password: 'Password',
  signedInAs: 'Signed in as',
  syncNow: 'Sync now',
  syncing: 'Syncing…',
  lastSynced: 'Last synced {time}',
  neverSynced: 'Not synced yet',
  syncHint: 'Progress is saved on this device and synced to your account whenever you are online.',
  authError: 'Wrong email or password.',
  accountsUnavailable: 'Accounts are not set up in this build.',
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
  sequentialHint: 'Šalje ajet na kojem je čitanje stalo — isti ponovo dok ga ne označiš kao usvojen.',
  sharedProgressionHint:
    'Jedan prolaz kroz svih 340 ajeta. Ajet na kojem je kursor stiže u svako vrijeme koje ide redom dok ga ne označiš kao usvojen; onda na njegovo mjesto dolazi sljedeći neoznačeni.',
  nextUp: 'Sljedeće',
  practised: 'Usvojen',
  practisedCount: '{n} od {total} usvojeno',
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
  ayahsCountOne: '{n} ajet',
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
  arabicIntro:
    'Riječi Kur’ana po učestalosti, deset po lekciji, s ajetima u kojima se pojavljuju. Lekcija se ponavlja dok je ne označiš naučenom.',
  todaysLesson: 'Trenutna lekcija',
  open: 'Otvori',
  lessons: 'Lekcije',
  lessonN: 'Lekcija {n}',
  phaseGlue: 'Ljepilo: prefiksi i sufiksi',
  phaseParticles: 'Čestice',
  phaseWords: 'Riječi',
  phaseWords2: 'Riječi, nastavak',
  phaseGrammar: 'Gramatika',
  statusNew: 'nova',
  statusLearning: 'učim',
  statusDone: 'naučena',
  wordsCount: '{n} riječi',
  wordsCountOne: '{n} riječ',
  coverage: 'Znaš riječi koje pokrivaju {p} % Kur’ana.',
  quiz: 'Kviz',
  finishLesson: 'Završi lekciju',
  repeatLesson: 'Ponovi',
  setCursorHere: 'Vrati kursor ovdje',
  cursorHere: 'trenutna',
  know: 'Znam',
  dontKnow: 'Ne znam',
  tapToFlip: 'Dodirni da okreneš',
  quizDone: 'Kviz završen',
  quizSummary: '{known} znam · {unknown} još ne',
  repeatUnknown: 'Ponovi nepoznate',
  back: 'Nazad',
  root: 'Korijen',
  rankLine: 'rang {rank} · {n}×',
  examples: 'Primjeri',
  progressTitle: 'Napredak',
  dueWords: '{n} riječi za ponavljanje',
  dueWordsOne: '{n} riječ za ponavljanje',
  reviewDue: 'Ponovi dospjele riječi',
  noDue: 'Nema riječi za ponavljanje.',
  boxN: 'Kutija {n}',
  boxHint:
    'Svaka riječ se penje za jednu kutiju kad je znaš, a pada u kutiju 0 kad je ne znaš. Kutije dolaze na red nakon 1, 3, 7, 14, 30 i 60 dana.',
  lessonsDone: '{n} od {total} lekcija naučeno',
  arabicWird: 'Dnevni arapski',
  arabicWirdHint: 'Lekcija, ponavljanje ili riječ stiže u svako vrijeme koje postaviš.',
  kindLesson: 'Lekcija',
  kindReview: 'Ponavljanje',
  kindWord: 'Riječ',
  kindLessonHint: 'Šalje trenutnu lekciju — istu ponovo dok je ne završiš.',
  kindReviewHint: 'Šalje do ovoliko riječi koje su dospjele za ponavljanje, iz svih kutija.',
  kindWordHint: 'Šalje ovoliko čestih riječi koje još ne znaš, svaku sa značenjem i jednim ajetom.',
  translitToggle: 'Transliteracija',
  nothingToQuiz: 'Ova lekcija nema riječi za kviz.',
  delivery: 'Dostava',
  notifReview: 'Ponavljanje',
  notifWord: 'Riječ dana',
  words: 'Riječi',
  loading: 'Učitavanje…',
  posN: 'imenica',
  posPN: 'vlastito ime',
  posADJ: 'pridjev',
  posV: 'glagol (prošlo vrijeme, „on …“)',
  posP: 'prijedlog',
  posPRON: 'zamjenica',
  posDEM: 'pokazna zamjenica',
  posREL: 'odnosna zamjenica',
  posT: 'prilog za vrijeme',
  posLOC: 'prilog za mjesto',
  posINTG: 'upitna riječ',
  posNEG: 'negacija',
  posCONJ: 'veznik',
  posCOND: 'uslovna čestica',
  posSUB: 'veznik („da“)',
  posACC: 'čestica (iza nje akuzativ)',
  posOther: 'čestica',
  langBs: 'Bosanski',
  langEn: 'English',
  ok: 'U redu',
  cancel: 'Odustani',
  account: 'Račun',
  signIn: 'Prijavi se',
  signOut: 'Odjavi se',
  accountHint:
    'Prijavi se da sačuvaš napredak — ajete, arapske lekcije, zabilješke — i nastaviš na drugom uređaju.',
  email: 'E-pošta',
  password: 'Lozinka',
  signedInAs: 'Prijavljen kao',
  syncNow: 'Sinhronizuj sada',
  syncing: 'Sinhronizacija…',
  lastSynced: 'Zadnja sinhronizacija {time}',
  neverSynced: 'Još nije sinhronizovano',
  syncHint: 'Napredak se čuva na uređaju i sinhronizuje s računom kad si online.',
  authError: 'Pogrešna e-pošta ili lozinka.',
  accountsUnavailable: 'Računi nisu podešeni u ovoj verziji.',
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

/** The resolved UI language code ('bs' | 'en'). Safe outside React. */
export function currentUiLanguage(): string {
  return current;
}

function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    key in params ? String(params[key]) : match,
  );
}

/**
 * Singular form for a count. English: exactly 1. Bosnian: 1, 21, 31 … but not
 * 11 ("1 ajet", "21 ajet", "11 ajeta"); 2–4 and 5+ share the same form here.
 */
function isSingular(lang: string, n: number): boolean {
  return lang === 'bs' ? n % 10 === 1 && n % 100 !== 11 : n === 1;
}

function translate(
  lang: string,
  key: UiStringKey,
  params?: Record<string, string | number>,
): string {
  const strings = STRINGS[lang] ?? en;
  const n = params?.n;
  const one = `${key}One` as UiStringKey;
  if (typeof n === 'number' && one in strings && isSingular(lang, n)) {
    return format(strings[one], params);
  }
  return format(strings[key] ?? en[key], params);
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
  const lang = useSyncExternalStore(subscribe, () => current, () => current);
  return useMemo(
    () =>
      (key: UiStringKey, params?: Record<string, string | number>) =>
        translate(lang, key, params),
    [lang],
  );
}
