# Prompt for the Arapski session

Paste everything below the line into a new Claude Code session opened in
`~/Projekti/tezkija`.

---

Build the **Arapski** tab of Tezkija: Qur'anic vocabulary lessons. Read
`README.md` (sections "The guidance set", "How scheduling works", "Arapski —
the plan") and `docs/ajeti-o-ponasanju.md` first, then the code under
`src/lib` and `src/app`. Keep the app's existing conventions: expo-router,
bs + en UI strings in `src/lib/i18n.ts`, theme from `src/lib/theme.ts`,
shared list styles from `src/lib/ui-styles.ts`, read-only SQLite from
`assets/quran.db` rebuilt by scripts, AsyncStorage for user state.

## Goal

I am learning Qur'anic Arabic to understand the Qur'an, vocabulary first,
grammar later. The tab delivers short lessons of the most frequent words, in
frequency order, with the ayahs each word appears in. Lessons repeat until I
mark them done. Bosnian is my language; English is the fallback.

## Data pipeline (do this first, as `scripts/build-vocab.py`, Python 3 with
only the standard library plus what `pip` can install)

1. Download the Quranic Arabic Corpus morphology file
   (`quranic-corpus-morphology-0.4.txt`, GPL, from corpus.quran.com). Cache
   it under `scripts/data/` and add that folder to `.gitignore`. Each line
   is one morphological segment: location `(surah:ayah:word:segment)`, form,
   tag, and features including `LEM:` (lemma), `ROOT:`, and `POS:`.
2. Aggregate to **lemmas**: for each `LEM:` value, count occurrences, record
   the root, the dominant POS, and every (surah, ayah, word index) it occurs
   at. Segments without `LEM:` (prefixes, suffixes, particles like و/ف/ب/ل
   and pronoun suffixes) become the "glue" set, handled separately.
3. Pick **2 example ayahs per lemma**, preferring short ayahs (fewest words)
   and, when available, ayahs from the `guidance` table so the two halves
   of the app reinforce each other. Store the ayah id and the 1-based word
   index within the Uthmani text so the reader can highlight the token.
   Verify that splitting `ayah.arabic` on spaces gives the same word count
   as the corpus for that ayah; log mismatches and fall back to the next
   candidate ayah.
4. Build **lessons**:
   - Phase 0 "Glue" — 4 lessons: prefixes (و ف ب ل ك ال س), suffix pronouns
     (ه ها هم كم ك نا ي), how to peel them. These are hand-written lesson
     items, not lemmas; encode them as `lesson_item` rows with `lemma_id`
     NULL and explicit `arabic` / `gloss_bs` / `gloss_en` / `note`.
   - Phase 1 "Particles" — ~10 lessons of function words (particles,
     prepositions, pronouns, demonstratives, question words, كان/قال) taken
     from the lemma list by POS, frequency order.
   - Phase 2/3 "Riječi" — remaining lemmas in frequency order, 10 per
     lesson, through rank 1,000 (≈90 lessons). Stop at 1,000; the tail is
     learned in context, not from lists.
   - Phase 4 "Gramatika" — 6 short text-only lessons (verb-doer-object
     order; verb subject endings; "X Y" = X of Y; prepositions vs case;
     verb forms I–X sampler; negations ما/لا/لن/لم). Hand-written, bs + en,
     stored as `lesson.body_bs` / `lesson.body_en` markdown, no items.
5. **Glosses.** English glosses: the corpus does not ship a dictionary, so
   draft them yourself from the lemma and POS, one to three words each, and
   mark the column as drafted. Bosnian glosses: draft them yourself too.
   Write both to `scripts/data/glosses.csv` (lemma_id, arabic, root, pos,
   freq, gloss_en, gloss_bs, reviewed=0) so I can review in a spreadsheet;
   the build script reads that CSV back, so my edits survive rebuilds.
6. Write tables into `assets/quran.db` (idempotent, `DROP TABLE IF
   EXISTS` first, `VACUUM` at the end), and bump `DB_NAME` in
   `src/lib/db.ts`:

```sql
CREATE TABLE lemma (
  id INTEGER PRIMARY KEY, arabic TEXT NOT NULL, translit TEXT NOT NULL,
  root TEXT, pos TEXT NOT NULL, freq INTEGER NOT NULL, rank INTEGER NOT NULL,
  gloss_en TEXT NOT NULL, gloss_bs TEXT NOT NULL
);
CREATE TABLE lemma_example (
  lemma_id INTEGER NOT NULL REFERENCES lemma(id),
  ayah_id INTEGER NOT NULL REFERENCES ayah(id),
  word_index INTEGER NOT NULL,       -- 1-based, within ayah.arabic split on spaces
  PRIMARY KEY (lemma_id, ayah_id)
);
CREATE TABLE lesson (
  id INTEGER PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE, phase INTEGER NOT NULL,
  title_bs TEXT NOT NULL, title_en TEXT NOT NULL, body_bs TEXT, body_en TEXT
);
CREATE TABLE lesson_item (
  lesson_id INTEGER NOT NULL REFERENCES lesson(id), ordinal INTEGER NOT NULL,
  lemma_id INTEGER REFERENCES lemma(id),
  arabic TEXT, gloss_bs TEXT, gloss_en TEXT, note_bs TEXT, note_en TEXT,  -- for glue items
  PRIMARY KEY (lesson_id, ordinal)
);
```

Transliteration: simple Latin, Bosnian-friendly (š for ش, dž for ج, h for
ح/ه, ' for ء, long vowels doubled or with macron — pick one and be
consistent). Print a summary at the end: lemma count, coverage of the total
token count at ranks 100/300/1,000, lesson count per phase, glosses drafted.

## App

`src/app/(tabs)/arabic.tsx` becomes the Arapski home; add screens under
`src/app/lesson.tsx`, `src/app/quiz.tsx`, `src/app/progress.tsx` (or a
`src/app/arabic/` group if cleaner). Reuse `AyahBlock` for examples with a
new `highlightWord` prop that renders the token at `word_index` in accent
colour; the Uthmani font and `displayArabic()` from `src/lib/mushaf.ts`
apply.

- **Home**: today's lesson card (title, phase, N words, "Otvori"), then the
  lesson list grouped by phase with status per lesson: nova / učim /
  naučena, and a small coverage line: "Znaš riječi koje pokrivaju 61 %
  Kur'ana" computed from `lemma.freq` of words in Leitner box ≥ 2 divided
  by total token count (store total token count in a one-row `vocab_meta`
  table).
- **Lesson**: header, then 10 cards vertically: Arabic (large, Uthmani
  font), transliteration, gloss in my UI language with the other language
  smaller, root, frequency rank, then the two example ayahs with the word
  highlighted. Grammar lessons render `body_*` as simple markdown (headings,
  bullets, bold). Bottom: "Kviz" button and "Završi lekciju".
- **Quiz**: flashcards for the lesson's items, Arabic front, tap to flip,
  "Znam" / "Ne znam". Leitner: every lemma has a box 0–5 and a due date in
  AsyncStorage (`vocab.progress.v1`, keyed by lemma id). Znam moves up one
  box and sets due = now + [1, 3, 7, 14, 30, 60] days by box; Ne znam drops
  to box 0, due now. Quiz shows the lesson's items in order, unknown ones
  first if any are box 0.
- **Progress rule**: the lesson cursor (`vocab.cursor.v1`) never advances
  on its own. "Završi lekciju" marks it done and moves the cursor to the
  next lesson. Any lesson can be reopened from the list at any time and
  "Ponovi" resets its items' boxes to 0 without moving the cursor. A
  "Vrati kursor ovdje" action on any lesson sets the cursor to it.
- **Deliveries**: add `arabicDeliveries: Delivery[]` to `Settings` with
  `kind: 'lesson' | 'review' | 'word'` and `count` (words for `word`).
  `lesson` delivers the cursor lesson (same lesson again if not finished —
  that is the point); `review` delivers up to N due words from all boxes;
  `word` delivers one word with gloss and one example. Extend the ledger
  entry with `kind` and a `lessonId` / `lemmaIds` payload, keep the shared
  60-notification window, and route notification taps to the lesson or
  quiz screen. Settings UI for these times mirrors the Ajeti delivery list.
- **Settings**: nothing new beyond the delivery list; transliteration
  toggle (on by default) is fine to add.
- Strings: add every new label to both `en` and `bs` in `i18n.ts`, Bosnian
  first. Keep the singular-plural helper for counts.

## Constraints

- `npx tsc --noEmit` and `npx expo lint` must pass; run `npx expo export
  --platform android` once to catch bundling errors.
- Stage changes with `git add`; do not commit or push unless I say so.
- Don't touch the Ajeti half except for the shared settings/ledger/notifi-
  cation plumbing, and keep existing Ajeti behaviour identical.
- Bump `DB_NAME` when the database changes; document the new tables and the
  pipeline in README under "Arapski".
- When done, build a release APK the way BUILDING.md describes and put it in
  `dist/` so I can install it over Wi-Fi.
