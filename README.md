# Tezkija

*Tezkija* (تزكية) — purifying the self so it grows. A small, fully offline
personal app with two halves:

1. **Ajeti** — the 340 ayahs of the Qur’an that say plainly how a person should
   act, delivered a few at a time by local notification at the times you set,
   in order or at random, with Arabic, Bosnian (Muhamed Mehanović) and/or
   English (Sahih International). The list itself is in
   [`docs/ajeti-o-ponasanju.md`](docs/ajeti-o-ponasanju.md).
2. **Arapski** — lessons in Qur’anic vocabulary, frequency-ordered, ten words a
   lesson, each with the ayahs it occurs in; a lesson repeats until you mark it
   learned, and flashcards move each word through Leitner boxes.

No accounts, no server, no analytics. Everything runs on-device from a
bundled SQLite database. Forked from
[quran-daily](https://github.com/limanovic/quran-daily) at `f67b71c`.

## Run

```sh
npm install
npx expo start
```

Then open in a development build (`npx expo run:android`). Local
notifications need a real device or an emulator. See [BUILDING.md](BUILDING.md)
for release builds.

## Structure

```
assets/quran.db              bundled database: all 6,236 ayahs (Arabic), bs+en
                             translations, and the `guidance` table (340 rows)
assets/fonts/                KFGQPC Uthmanic Hafs (Madani mushaf) font
scripts/build-db.py          rebuilds assets/quran.db: trims translations to
                             bs/en and regenerates `guidance` from the doc
scripts/build-vocab.py       builds the Arapski tables from the Quranic Arabic
                             Corpus morphology (see "Arapski" below)
scripts/data/glosses.csv     the word glosses, en + bs — edit in a spreadsheet
scripts/data/notes.csv       usage notes for particles and pronouns, bs + en
docs/ajeti-o-ponasanju.md    the guidance list — source of truth for `guidance`
src/lib/db.ts                typed query helpers over the bundled database
src/lib/db-open.ts           native: first-launch DB copy, expo-sqlite (.web.ts: sql.js over fetched quran.db)
src/lib/passage.ts           buildPassage / resolvePassage / formatReference
src/lib/wird.ts              the shared in-order cursor (guidance ordinal)
src/lib/vocab.ts             Arapski state: Leitner boxes, lesson cursor, lesson states
src/lib/notifications.ts     scheduling window, top-up, ledger — both delivery lists (.web.ts: no-op stub)
src/lib/settings.ts          settings persistence + validation
src/lib/store.ts             key-value store under all user state: AsyncStorage + write stamps
src/lib/supabase.ts          Supabase client (null when .env is empty), password sign-in
src/lib/sync.ts              account sync: push on write, reconcile on sign-in/foreground
src/lib/i18n.ts              UI strings, bs + en
src/app/_layout.tsx          root stack: fonts, notification tap handler, top-up, account sync
src/app/+html.tsx            web only: the HTML shell — manifest, icons, service worker
public/                      web only: manifest, icons, sw.js (+ quran.db and the SQLite wasm at build)
scripts/prepare-web.js       copies quran.db and the sql.js wasm into public/ before a web export
src/app/(tabs)/_layout.tsx   the two tabs
src/app/(tabs)/index.tsx     Ajeti home: delivery times, progress, reading links
src/app/(tabs)/arabic.tsx    Arapski home: deliveries, current lesson, lesson list
src/app/guidance.tsx         the full list of 340, grouped by surah
src/app/reader.tsx           exactly the passage a notification delivered
src/app/lesson.tsx           one lesson: word cards with example ayahs, or grammar text
src/app/quiz.tsx             flashcards over a lesson or a list of words
src/app/progress.tsx         coverage, words due, Leitner boxes
src/app/surahs.tsx           the 71 surahs with guidance ayahs
src/app/bookmarks.tsx        bookmarks
src/app/settings.tsx         appearance, text, languages, delivery troubleshooting
src/app/account.tsx          sign in with email + password, sync now, sign out
```

## The guidance set

The `guidance` table maps `ordinal` (1..340, mushaf order) to `ayah.id` and
flags the 106 ayahs originally addressed to the Prophet ﷺ whose guidance
applies to everyone (shown as a badge). All passage selection, the in-order
cursor and the reader position are measured in ordinals, so a passage of
three is three consecutive *guidance* ayahs — 2:43, 2:45, 2:109 — not three
consecutive ayahs of the mushaf.

To change the set, edit the doc and run:

```sh
python3 scripts/build-db.py
```

The script is idempotent. It asserts 340 references, no duplicates, and that
every one resolves to an ayah. Bump `DB_NAME` in `src/lib/db.ts` afterwards
so existing installs pick up the new file.

## How scheduling works

Local notifications freeze their content when scheduled, and iOS caps
pending local notifications at 64. So there is no repeating trigger.
Instead:

1. Every future (day × delivery-time) occurrence is scheduled as an
   independent **one-shot** notification. The passage is picked at
   scheduling time and its text baked into the notification content.
2. Each scheduled occurrence is recorded in a **ledger** in AsyncStorage
   (`{notificationId, dateISO, time, kind, passageKey | lessonId | lemmaIds}`),
   so a notification tap can reopen the exact passage, lesson or words.
3. At most **60** one-shots are kept pending (headroom under the 64 cap),
   covering `floor(60 / times-per-day)` days ahead, both delivery lists
   counted.
4. On every app launch and foreground, past ledger entries are pruned and
   the window is **topped up** back to full.
5. Any settings change cancels everything, clears the ledger, and rebuilds
   the window from scratch.

An **in-order** time sends the ayah under the cursor (`guidance.cursor.v1`)
— the same one at every in-order time, every day, until it is ticked as
practised (☑ Usvojen, in the Reader or the full list; ticks live in
`guidance.done.v1`). Ticking the ayah under the cursor moves the cursor to the
next unticked one and rebuilds the window. The cursor never advances on its
own. "Počni ponovo od početka" clears every tick. Random times ignore ticks
and pick freely.

Occurrence times are built from local wall-clock components
(`new Date(y, m, d, hh, mm)`), so 09:00 stays 09:00 across DST changes.

## Accounts and sync

Optional. Without a Supabase project in `.env` the app has no account screen
and keeps everything on the device, as before. With one, Settings gains an
**Account** row: sign in with email and password and the progress —
wird cursor and ticks, Arapski boxes, lesson cursor and states, bookmarks,
last position, settings — follows the account to any other device.

### Setup

1. Create a Supabase project (or reuse one). In the SQL editor run
   `supabase/migrations/0001_user_state.sql`: one table, `user_state`, with
   row-level security so a user only ever sees their own rows.
2. Authentication → Users → **Add user**: email, password, "Auto confirm
   user" on. There is no sign-up in the app, and no email is ever sent —
   the accounts are made here, one per person.
3. Copy `.env.example` to `.env` and fill in the project URL and anon key
   (Project settings → API). The anon key is public; RLS does the guarding.
4. Rebuild the app — `EXPO_PUBLIC_*` values are baked in at build time.

### How it works

`src/lib/store.ts` is AsyncStorage plus a per-key write stamp. The domain
modules (`wird`, `vocab`, `bookmarks`, `settings`) write there and know
nothing about accounts. `src/lib/sync.ts` pushes each write to the account
shortly after it happens and, on sign-in and every foreground, reconciles
all keys: the copy with the newer stamp wins, per key. Failed pushes need no
queue — the next reconcile sees the newer local stamp and pushes again.
Removing a key (start-over clears the done set) is pushed as a null row so
the removal reaches the other device too.

The first sign-in on a device merges what is already there into the
account. If a different account then signs in on the same device, the local
state is cleared first rather than merged into the wrong account. Signing
out leaves the local copy in place.

Device-local state — the notification ledger and dismissed prompts — is
never synced.

## Web (PWA)

The same code exports as a static site that installs to a phone's home
screen — the iPhone route, since there is no App Store build.

```sh
npm run web:export      # → web-build/ (dist/ is where release APKs are kept)
npx serve web-build     # try it locally
```

What differs from native, all behind platform files (`*.web.ts`):

- **Database**: `expo-sqlite` has no web path here, so `db-open.web.ts`
  fetches `/quran.db` and opens it in memory with sql.js (SQLite as
  WebAssembly). `scripts/prepare-web.js` copies the database and the wasm
  into `public/` first; both are gitignored there.
- **Notifications**: `notifications.web.ts` is a stub — no reminders on the
  web for now. Delivery times can still be edited (they sync to the phone
  app through the account). Server-sent Web Push is a later phase.
- **Time picker**: `components/time-picker.web.tsx` is an `<input type="time">`
  with a confirm button; the community picker has no web build.
- **Offline**: `public/sw.js` precaches the shell, the database and the
  wasm, and caches every bundle it sees; pages are network-first so a new
  deploy shows up on the next open. Bump `VERSION` in it to drop old caches.
- **Installable**: `src/app/+html.tsx` links `public/manifest.json`, the
  home-screen icons and registers the service worker. On iPhone: Safari →
  Share → Add to Home Screen.

### Deploying to Vercel

New project from this repo. Build command `npm run web:export`, output
directory `web-build`, environment variables `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_ANON_KEY`. `vercel.json` turns on clean URLs (so
`/reader` serves `reader.html`) and sets cache headers. Add the domain under
Domains and point a CNAME at it from the DNS host.

## Arapski

### Data

Everything comes from the **Quranic Arabic Corpus** morphology file, version
0.4 (Kais Dukes, GPL), one line per morphological segment of the Uthmani text
with its lemma, root and part of speech. Build the tables with:

```sh
python3 scripts/build-vocab.py
```

The script downloads the corpus into `scripts/data/` (gitignored, hash-checked;
if the mirror is gone, fetch version 0.4 from
[corpus.quran.com/download](https://corpus.quran.com/download/) and drop it
there), then:

1. Aggregates segments to **lemmas** — frequency, root, dominant POS, every
   (surah, ayah, word) occurrence. Standalone personal pronouns carry no lemma
   in the corpus, so they become pseudo-lemmas (`PRON:3MS` → هُوَ). Prefixes and
   suffixes have no lemma either; they are the "glue" taught by hand in phase 0.
2. Ranks lemmas by frequency and keeps the top **1,000** (87 % of all words;
   rank 100 is 56 %, rank 300 is 72 %). The tail is learned in context.
3. Picks **two example ayahs** per lemma: short ones first, ayahs from the
   `guidance` set before others, so the two halves of the app reinforce each
   other. The word to highlight is stored as a 1-based index into
   `ayah.arabic.split(' ')`. Pause marks (ۚ ۖ ۗ ۞ …) are separate tokens in the
   Uthmani text and are skipped when mapping corpus words onto them; the four
   ayahs where the corpus joins two words (بَعْدَ مَا, إِلْ يَاسِينَ) are logged and
   never used as examples.
4. Builds the **lessons**: phase 0 glue (4 hand-written lessons), phase 1
   particles (function words by POS, 8 lessons), phases 2–3 words in frequency
   order, ten per lesson (93 lessons), phase 4 grammar (6 hand-written markdown
   lessons). 111 in all.
5. Reads **glosses** from `scripts/data/glosses.csv` (tracked in git). The
   first run created it with drafted one-to-three-word glosses in English and
   Bosnian, `reviewed=0`. Edit it in a spreadsheet — rows are matched by `key`,
   the corpus lemma, so ids and edits survive rebuilds; set `reviewed=1` as you
   go. Missing glosses are reported in the summary.
6. Reads **usage notes** from `scripts/data/notes.csv` (`key, note_bs,
   note_en`) into `lesson_item.note_*` for the matching lemma cards — written
   for every particle and pronoun; add a row for any word that needs one.
   Every list lesson also gets an intro paragraph (`lesson.body_*`) with the
   lesson's occurrence count and the coverage reached so far.

In the app a lesson is shown in the app language plus every reading
translation that is on (Settings › Tekst): glosses, notes, grammar text and
the example ayahs all appear in each, labelled when there is more than one.

Transliteration is simple Latin in the Bosnian convention: dž, š, ' for ء and
ع, v for و, j for ي; emphatic and interdental letters fold onto their plain
neighbours (ث ص → s, ذ ظ → z, ح خ → h, ط → t, ض → d, ق → k); long vowels ā ī ū;
shadda doubles the consonant.

Tables (all dropped and recreated, then `VACUUM`):

```
lemma          id, arabic, translit, root, pos, freq, rank, gloss_en, gloss_bs
lemma_example  lemma_id, ayah_id, word_index (1-based token in ayah.arabic)
lesson         id, ordinal, phase, title_bs, title_en, body_bs, body_en (grammar markdown)
lesson_item    lesson_id, ordinal, lemma_id | arabic, gloss_bs, gloss_en, note_bs, note_en (glue)
vocab_meta     total_tokens (77,429 words), lemma_count, max_rank
```

Bump `DB_NAME` in `src/lib/db.ts` after rebuilding, as for `guidance`.

### Progress

All user state is in AsyncStorage; the database stays read-only.

- **Leitner boxes** (`vocab.progress.v1`, keyed by lemma id): every word has a
  box 0–5 and a due time. "Znam" moves it up one box and sets due to now +
  1, 3, 7, 14, 30 or 60 days by box; "Ne znam" drops it to box 0, due now. A
  word counts as known from box 2 on; the coverage line is the `freq` of known
  lemmas over `vocab_meta.total_tokens`.
- **Lesson cursor** (`vocab.cursor.v1`): the lesson "the lesson" delivery sends.
  It never advances on its own — "Završi lekciju" marks the lesson done and
  moves the cursor to the next one; "Vrati kursor ovdje" on any lesson sets it
  there. "Ponovi" resets a lesson's words to box 0 without moving the cursor.
- **Lesson states** (`vocab.lessons.v1`): nova until opened, učim once opened,
  naučena once finished.

### Deliveries

`Settings.arabicDeliveries` is a second list of times, each with a kind:

- `lesson` — the cursor lesson, every card as one line. The same lesson again
  until it is finished; that is the point.
- `review` — up to N words due by that occurrence, Arabic and transliteration
  only, opening as a quiz. With nothing due, the cursor lesson's box-0 words
  stand in, then frequent words not yet known.
- `word` — N frequent words not yet known, each with its meaning and one
  example ayah (translated in the notification language), opening as cards.

Both lists share the one 60-notification window: the horizon is
`floor(60 / (times per day, both lists))` days. Content is baked in at
scheduling time exactly as passages are, and recorded in the ledger as `kind`
plus `lessonId` or `lemmaIds`; finishing a lesson, moving the cursor, or
closing a quiz rebuilds the window so pending picks catch up. Entries without a
`kind` are guidance passages from before Arapski existed.
