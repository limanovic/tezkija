#!/usr/bin/env node
/*
 * Everything the reminder sender needs from the database, as one JSON file
 * the web export publishes at /push-data.json. The Edge Function that sends
 * Web Push has no copy of quran.db, so it reads this instead: the guidance
 * ayahs with both translations, the lessons with their cards, and the
 * lemmas with one example ayah each. Regenerated on every web export, so it
 * always matches the deployed app.
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'public', 'push-data.json');

async function main() {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(path.join(root, 'assets', 'quran.db')));
  const all = (sql) => {
    const stmt = db.prepare(sql);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  };

  const surahs = Object.fromEntries(all('SELECT number, name_en FROM surah').map((r) => [r.number, r.name_en]));

  const tr = {};
  for (const r of all("SELECT lang, ayah_id, text FROM translation WHERE lang IN ('bs','en')")) {
    (tr[r.ayah_id] ??= {})[r.lang] = r.text;
  }

  const guidance = all(
    'SELECT g.ordinal, a.id, a.surah, a.ayah, a.arabic FROM guidance g JOIN ayah a ON a.id = g.ayah_id ORDER BY g.ordinal',
  ).map((r) => ({ ordinal: r.ordinal, id: r.id, surah: r.surah, ayah: r.ayah, ar: r.arabic, ...(tr[r.id] ?? {}) }));

  const lemmaRows = all('SELECT id, rank, arabic, translit, gloss_bs, gloss_en FROM lemma ORDER BY rank');
  // Shortest example per lemma, same preference as the app's word cards.
  const example = {};
  for (const r of all(
    'SELECT e.lemma_id, a.id, a.surah, a.ayah, a.arabic FROM lemma_example e JOIN ayah a ON a.id = e.ayah_id ORDER BY e.lemma_id, LENGTH(a.arabic)',
  )) {
    if (!example[r.lemma_id]) example[r.lemma_id] = { id: r.id, surah: r.surah, ayah: r.ayah, ar: r.arabic, ...(tr[r.id] ?? {}) };
  }
  const lemmas = lemmaRows.map((l) => ({
    id: l.id,
    rank: l.rank,
    ar: l.arabic,
    translit: l.translit,
    gloss_bs: l.gloss_bs,
    gloss_en: l.gloss_en,
    ex: example[l.id] ?? null,
  }));

  const items = {};
  for (const r of all(
    'SELECT i.lesson_id, i.ordinal, i.lemma_id, i.arabic, i.gloss_bs, i.gloss_en FROM lesson_item i ORDER BY i.lesson_id, i.ordinal',
  )) {
    (items[r.lesson_id] ??= []).push(
      r.lemma_id !== null ? { lemma: r.lemma_id } : { ar: r.arabic ?? '', gloss_bs: r.gloss_bs ?? '', gloss_en: r.gloss_en ?? '' },
    );
  }
  const lessons = all('SELECT id, ordinal, title_bs, title_en, body_bs, body_en FROM lesson ORDER BY ordinal').map((l) => ({
    id: l.id,
    ordinal: l.ordinal,
    title_bs: l.title_bs,
    title_en: l.title_en,
    body_bs: firstLines(l.body_bs),
    body_en: firstLines(l.body_en),
    items: items[l.id] ?? [],
  }));

  const data = { generatedAt: new Date().toISOString(), surahs, guidance, lemmas, lessons };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data));
  console.log(`public/push-data.json: ${guidance.length} ayahs, ${lemmas.length} lemmas, ${lessons.length} lessons, ${(fs.statSync(OUT).size / 1024).toFixed(0)} kB`);
}

/** Same summary the phone shows for a grammar lesson: first four plain lines. */
function firstLines(body) {
  return (body ?? '')
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').replace(/\*/g, '').trim())
    .filter((l) => l.length > 0)
    .slice(0, 4)
    .join(' ');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
