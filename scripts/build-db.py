#!/usr/bin/env python3
"""
Shape assets/quran.db for Tezkija.

Idempotent — run it against the full Daily Qur'an database or against its own
output and you get the same file:

  1. keep only the translations the app shows (English, Bosnian);
  2. (re)build the `guidance` table from docs/ajeti-o-ponasanju.md — the 340
     ayahs about conduct, in mushaf order, flagged where the ayah was
     originally addressed to the Prophet;
  3. VACUUM so the trimmed file is actually smaller.

Usage:  python3 scripts/build-db.py [--source path/to/full/quran.db]

Without --source it rewrites assets/quran.db in place.
"""
import argparse
import re
import shutil
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / 'assets' / 'quran.db'
DOC = ROOT / 'docs' / 'ajeti-o-ponasanju.md'

KEEP_TRANSLATIONS = ('en', 'bs')
KEEP_LANGUAGES = ('ar',) + KEEP_TRANSLATIONS
EXPECTED_COUNT = 340

# **2:42** — text            **2:149** `[Poslaniku]` — text
REF_RE = re.compile(r'^\*\*(\d+):(\d+)\*\*\s*(`\[Poslaniku\]`)?\s*—')


def parse_doc(path: Path) -> list[tuple[int, int, bool]]:
    refs = []
    for line in path.read_text(encoding='utf-8').splitlines():
        m = REF_RE.match(line)
        if m:
            refs.append((int(m.group(1)), int(m.group(2)), m.group(3) is not None))
    return refs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', type=Path, help='full database to start from (copied over assets/quran.db)')
    args = ap.parse_args()

    if args.source:
        shutil.copyfile(args.source, DB)

    refs = parse_doc(DOC)
    if len(refs) != EXPECTED_COUNT:
        print(f'expected {EXPECTED_COUNT} refs in {DOC.name}, found {len(refs)}', file=sys.stderr)
        return 1
    if len(set((s, a) for s, a, _ in refs)) != len(refs):
        print('duplicate refs in doc', file=sys.stderr)
        return 1
    # Mushaf order regardless of how the doc happens to be arranged.
    refs.sort()

    con = sqlite3.connect(DB)
    cur = con.cursor()

    placeholders = ','.join('?' * len(KEEP_TRANSLATIONS))
    cur.execute(f'DELETE FROM translation WHERE lang NOT IN ({placeholders})', KEEP_TRANSLATIONS)
    placeholders = ','.join('?' * len(KEEP_LANGUAGES))
    cur.execute(f'DELETE FROM language WHERE code NOT IN ({placeholders})', KEEP_LANGUAGES)

    cur.execute('DROP TABLE IF EXISTS guidance')
    cur.execute(
        '''
        CREATE TABLE guidance (
          ordinal INTEGER PRIMARY KEY,      -- 1..340, mushaf order
          ayah_id INTEGER NOT NULL UNIQUE REFERENCES ayah(id),
          to_prophet INTEGER NOT NULL DEFAULT 0  -- addressed to the Prophet, binding on all
        )
        '''
    )
    missing = []
    for ordinal, (surah, ayah, to_prophet) in enumerate(refs, start=1):
        row = cur.execute('SELECT id FROM ayah WHERE surah = ? AND ayah = ?', (surah, ayah)).fetchone()
        if row is None:
            missing.append(f'{surah}:{ayah}')
            continue
        cur.execute(
            'INSERT INTO guidance (ordinal, ayah_id, to_prophet) VALUES (?, ?, ?)',
            (ordinal, row[0], int(to_prophet)),
        )
    if missing:
        print('refs not found in ayah table: ' + ', '.join(missing), file=sys.stderr)
        con.rollback()
        return 1

    con.commit()
    con.execute('VACUUM')

    n_guidance = cur.execute('SELECT COUNT(*) FROM guidance').fetchone()[0]
    n_prophet = cur.execute('SELECT COUNT(*) FROM guidance WHERE to_prophet = 1').fetchone()[0]
    n_surahs = cur.execute('SELECT COUNT(DISTINCT surah) FROM guidance g JOIN ayah a ON a.id = g.ayah_id').fetchone()[0]
    langs = [r[0] for r in cur.execute('SELECT lang FROM translation GROUP BY lang ORDER BY lang')]
    con.close()
    size_mb = DB.stat().st_size / 1e6
    print(f'guidance: {n_guidance} ayahs in {n_surahs} surahs, {n_prophet} to the Prophet')
    print(f'translations: {", ".join(langs)}')
    print(f'{DB.relative_to(ROOT)}: {size_mb:.1f} MB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
