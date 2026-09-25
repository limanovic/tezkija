# Tezkija

*Tezkija* (تزكية) — purifying the self so it grows. A small, fully offline
personal app with two halves:

1. **Ajeti** — the 340 ayahs of the Qur’an that say plainly how a person should
   act, delivered a few at a time by local notification at the times you set,
   in order or at random, with Arabic, Bosnian (Muhamed Mehanović) and/or
   English (Sahih International). The list itself is in
   [`docs/ajeti-o-ponasanju.md`](docs/ajeti-o-ponasanju.md).
2. **Arapski** — lessons in Qur’anic vocabulary, frequency-ordered, ten words a
   lesson, each with the ayahs it occurs in. *Not built yet — placeholder tab.*

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
docs/ajeti-o-ponasanju.md    the guidance list — source of truth for `guidance`
src/lib/db.ts                first-launch DB copy + typed query helpers
src/lib/passage.ts           buildPassage / resolvePassage / formatReference
src/lib/wird.ts              the shared in-order cursor (guidance ordinal)
src/lib/notifications.ts     scheduling window, top-up, ledger
src/lib/settings.ts          settings persistence + validation
src/lib/i18n.ts              UI strings, bs + en
src/app/_layout.tsx          root stack: fonts, notification tap handler, top-up
src/app/(tabs)/_layout.tsx   the two tabs
src/app/(tabs)/index.tsx     Ajeti home: delivery times, progress, reading links
src/app/(tabs)/arabic.tsx    Arapski placeholder
src/app/guidance.tsx         the full list of 340, grouped by surah
src/app/reader.tsx           exactly the passage a notification delivered
src/app/surahs.tsx           the 71 surahs with guidance ayahs
src/app/bookmarks.tsx        bookmarks
src/app/settings.tsx         appearance, text, languages, delivery troubleshooting
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
   (`{notificationId, dateISO, time, passageKey, nextCursor?}`), so a
   notification tap can reopen the exact passage.
3. At most **60** one-shots are kept pending (headroom under the 64 cap),
   covering `floor(60 / times-per-day)` days ahead.
4. On every app launch and foreground, past ledger entries are settled
   (the in-order cursor moves past them) and pruned, and the window is
   **topped up** back to full.
5. Any settings change cancels everything, clears the ledger, and rebuilds
   the window from scratch.

Occurrence times are built from local wall-clock components
(`new Date(y, m, d, hh, mm)`), so 09:00 stays 09:00 across DST changes.

## Arapski — the plan

Not started. The intended shape, so the Ajeti half leaves room for it:

- Data: lemma frequencies and per-token lemma tags from the Quranic Arabic
  Corpus morphology, built offline into `lemma`, `lemma_example`, `lesson`
  and `lesson_item` tables in the same database. Glosses in en (from the
  corpus) and bs (drafted, then reviewed).
- Lessons: glue (prefixes/suffixes), particles, then lemmas in frequency
  order, ten per lesson; ~110 lessons to the 1,000 most frequent words.
- Progress: a lesson cursor that never auto-advances — a lesson repeats until
  marked done. Per-word Leitner boxes; a review delivery type serves due words.
- Deliveries: a second delivery list, sharing the 60-notification window.
