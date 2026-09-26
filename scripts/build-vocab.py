#!/usr/bin/env python3
"""
Build the Arapski (vocabulary) tables in assets/quran.db.

Source: the Quranic Arabic Corpus morphology file, version 0.4 (Kais Dukes,
GPL), one line per morphological segment of the Uthmani text:

    (surah:ayah:word:segment)  form  tag  features

Forms, lemmas and roots are in (extended) Buckwalter transliteration.

Steps — idempotent, run as often as you like:

  1. Download the corpus file into scripts/data/ (cached; sha256-checked).
  2. Aggregate segments to lemmas: frequency, root, dominant POS, every
     (surah, ayah, word) occurrence. Standalone personal pronouns carry no
     LEM in the corpus, so they become pseudo-lemmas keyed PRON:<features>.
     Segments without a lemma — prefixes and suffixes — are the "glue" set,
     taught by hand in phase 0 rather than from the lemma list.
  3. Pick two example ayahs per lemma: short ones first, guidance ayahs
     (the Ajeti set) before others, only ayahs whose word count agrees with
     the database text so the token can be highlighted by index.
  4. Build the lessons: phase 0 glue (hand-written), phase 1 particles,
     phases 2–3 words in frequency order through rank 1,000, phase 4 grammar
     (hand-written markdown).
  5. Glosses come from scripts/data/glosses.csv, which this script creates on
     first run with empty cells and thereafter only appends to — edit it in a
     spreadsheet, rerun, and your edits survive. reviewed=0 means drafted.
  6. Write lemma / lemma_example / lesson / lesson_item / vocab_meta, VACUUM.

Then bump DB_NAME in src/lib/db.ts.

Usage:  python3 scripts/build-vocab.py [--corpus path] [--max-rank 1000]
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import sqlite3
import sys
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / 'assets' / 'quran.db'
DATA_DIR = ROOT / 'scripts' / 'data'
CORPUS_FILE = DATA_DIR / 'quranic-corpus-morphology-0.4.txt'
GLOSSES_CSV = DATA_DIR / 'glosses.csv'

# The corpus is GPL and may be redistributed verbatim. corpus.quran.com serves
# it behind an e-mail form (https://corpus.quran.com/download/), so the script
# fetches a verbatim mirror and checks the hash of the original file.
CORPUS_SHA256 = '910b721a8f04f4334ac5d4c62b19e858f5d720c525bb975f2e750ea2c6bb532d'
CORPUS_URLS = [
    'https://media.githubusercontent.com/media/AhmedSaadi0/quran-words/main/data/quranic-corpus-morphology-0.4.txt',
    'https://media.githubusercontent.com/media/ezAldinWaez/quran-etl/master/reports/resources/quranic-corpus/quranic-corpus-morphology-0.4.txt',
]

WORDS_PER_LESSON = 10
EXAMPLES_PER_LEMMA = 2
# Ayahs longer than this are the last resort as examples: a card should show
# a line or two, not a page.
LONG_AYAH_WORDS = 25

# POS tags that carry lexical meaning; everything else is a function word.
CONTENT_POS = {'N', 'PN', 'ADJ', 'V', 'IMPN'}
# Verbs so grammatical that they belong with the particles.
PARTICLE_VERBS = {'kaAna', 'qaAla'}

# Tokens of ayah.arabic that are not words: pause marks, rub-el-hizb, sajda.
# Kept in the split (word_index counts them) but never mapped to a corpus word.
MARK_CHARS = set('ۖۗۘۙۚۛۜ۝۞۩')

# ---------------------------------------------------------------------------
# Buckwalter (corpus flavour) → Arabic
# ---------------------------------------------------------------------------

BUCKWALTER = {
    "'": 'ء', '>': 'أ', '&': 'ؤ', '<': 'إ', '}': 'ئ',
    'A': 'ا', 'b': 'ب', 'p': 'ة', 't': 'ت', 'v': 'ث',
    'j': 'ج', 'H': 'ح', 'x': 'خ', 'd': 'د', '*': 'ذ',
    'r': 'ر', 'z': 'ز', 's': 'س', '$': 'ش', 'S': 'ص',
    'D': 'ض', 'T': 'ط', 'Z': 'ظ', 'E': 'ع', 'g': 'غ',
    '_': 'ـ', 'f': 'ف', 'q': 'ق', 'k': 'ك', 'l': 'ل',
    'm': 'م', 'n': 'ن', 'h': 'ه', 'w': 'و', 'Y': 'ى',
    'y': 'ي', 'F': 'ً', 'N': 'ٌ', 'K': 'ٍ', 'a': 'َ',
    'u': 'ُ', 'i': 'ِ', '~': 'ّ', 'o': 'ْ', '^': 'ٓ',
    '#': 'ٔ', '`': 'ٰ', '{': 'ٱ', ':': 'ۜ', '@': '۟',
    '"': '۠', '[': 'ۢ', ';': 'ۣ', ',': 'ۥ', '.': 'ۦ',
    '!': 'ۨ', '-': '۪', '+': '۫', '%': '۬', ']': 'ۭ',
}


def headword(bw: str) -> str:
    """Corpus lemma → headword: drop the homograph digit and the shadda a lemma
    that only ever follows the article carries on its first letter (n~aAs)."""
    bw = ''.join(c for c in bw if not c.isdigit())
    if len(bw) > 1 and bw[1] == '~':
        bw = bw[0] + bw[2:]
    return bw


def to_arabic(bw: str) -> str:
    # The corpus writes a bare hamza seat as tatweel + hamza-above (ٱلْـَٔانَ);
    # as a headword a plain hamza reads better.
    bw = headword(bw).replace('_#', "'")
    return ''.join(BUCKWALTER.get(c, '') for c in bw)


# ---------------------------------------------------------------------------
# Buckwalter → simple Latin, Bosnian-friendly
#
# Consonants follow the Bosnian convention for Islamic terms (dž, š, ć-less):
# emphatic and interdental letters collapse onto their plain Bosnian
# neighbours (ث ص س → s, ذ ز ظ → z, ح خ ه → h, ط ت → t, ض د → d, ق ك → k),
# ع and ء → ' (a word-initial hamza is dropped), و → v, ي → j. Long vowels take macrons: ā ī ū. Shadda doubles
# the consonant. Tanwin is spelled out (-an, -un, -in).
# ---------------------------------------------------------------------------

LATIN_CONS = {
    "'": "'", '>': "'", '<': "'", '&': "'", '}': "'", 'b': 'b', 't': 't',
    'v': 's', 'j': 'dž', 'H': 'h', 'x': 'h', 'd': 'd', '*': 'z', 'r': 'r',
    'z': 'z', 's': 's', '$': 'š', 'S': 's', 'D': 'd', 'T': 't', 'Z': 'z',
    'E': "'", 'g': 'g', 'f': 'f', 'q': 'k', 'k': 'k', 'l': 'l', 'm': 'm',
    'n': 'n', 'h': 'h', 'w': 'v', 'y': 'j', 'Y': 'j',
}
VOWELS = set('aiu')
IGNORE = set('^[],.@";:!-+%o')


def transliterate(bw: str, proper: bool = False) -> str:
    s = headword(bw).replace('_#', "'")
    s = ''.join(c for c in s if c not in IGNORE)
    out: list[str] = []
    i = 0
    n = len(s)

    def nxt(k: int = 1) -> str:
        return s[i + k] if i + k < n else ''

    while i < n:
        c = s[i]
        if c == '{':  # alif wasla: a- before the article, i- in verb stems
            out.append('a' if nxt() == 'l' else 'i')
            i += 1
        elif c == 'A':  # bare alif (madda / after another vowel) → long ā
            if out and out[-1] == 'a':
                out[-1] = 'ā'
            else:
                out.append('ā')
            i += 1
        elif c == '`':  # dagger alif
            if out and out[-1] == 'a':
                out[-1] = 'ā'
            else:
                out.append('ā')
            i += 1
        elif c == 'a':
            if nxt() in ('A', '`'):
                out.append('ā')
                i += 2
            elif nxt() == 'w' and nxt(2) == '`':
                out.append('ā')  # صَلَوٰة — waw as the seat of a long a
                i += 3
            elif nxt() == 'Y' and (i + 2 >= n or s[i + 2] in 'FNK`'):
                # alif maqsura: عَلَىٰ → 'alā (a following dagger alif is silent)
                out.append('ā')
                i += 3 if nxt(2) == '`' else 2
            else:
                out.append('a')
                i += 1
        elif c == 'i' and nxt() == 'Y' and i + 2 >= n:
            out.append('ī')  # فِى، ٱلَّذِى — ya written without dots
            i += 2
        elif c == 'i' and nxt() == 'A':
            out.append('i')  # مِائَة — the alif is silent
            i += 2
        elif c == 'i' and nxt() == 'y':
            after = nxt(2)
            if after == '~':
                out.append('ijj')
                i += 3
            elif after in VOWELS or after in ('A', '`'):
                out.append('ij')
                i += 2
            else:
                out.append('ī')
                i += 2
        elif c == 'u' and nxt() == 'w':
            after = nxt(2)
            if after == '~':
                out.append('uvv')
                i += 3
            elif after in VOWELS or after in ('A', '`'):
                out.append('uv')
                i += 2
            else:
                out.append('ū')
                i += 2
        elif c in VOWELS:
            out.append(c)
            i += 1
        elif c == 'p':  # ta marbuta → -a
            if not (out and out[-1] in ('a', 'ā')):
                out.append('a')
            i += 1
        elif c in 'FNK':
            out.append({'F': 'an', 'N': 'un', 'K': 'in'}[c])
            i += 1
            if nxt(0) in ('A', 'Y'):  # the seat of the tanwin is silent
                i += 1
        elif c == '~':
            # Shadda doubles the consonant — unless the article's lam already
            # sits in front of it (ٱللَّه → allah, not alllah).
            if out and not (len(out) > 1 and out[-2] == out[-1]):
                out[-1] = out[-1] + out[-1]
            i += 1
        elif c in LATIN_CONS:
            lat = LATIN_CONS[c]
            if lat == "'" and not out and c != 'E':
                pass  # word-initial hamza is silent in Latin; ع keeps its mark
            else:
                out.append(lat)
            i += 1
        else:
            i += 1
    text = ''.join(out)
    if proper and text:
        text = text[0].upper() + text[1:]
    return text


# ---------------------------------------------------------------------------
# Corpus parsing
# ---------------------------------------------------------------------------

@dataclass
class Segment:
    surah: int
    ayah: int
    word: int
    seg: int
    form: str
    tag: str
    kind: str  # PREFIX / STEM / SUFFIX
    feats: dict[str, str]


def download_corpus() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if CORPUS_FILE.exists():
        digest = hashlib.sha256(CORPUS_FILE.read_bytes()).hexdigest()
        if digest == CORPUS_SHA256:
            return
        print(f'warning: {CORPUS_FILE.name} has an unexpected hash, re-downloading', file=sys.stderr)
    for url in CORPUS_URLS:
        try:
            print(f'downloading {url}')
            data = urllib.request.urlopen(url, timeout=300).read()
        except Exception as e:  # noqa: BLE001
            print(f'  failed: {e}', file=sys.stderr)
            continue
        if hashlib.sha256(data).hexdigest() != CORPUS_SHA256:
            print('  hash mismatch, skipping', file=sys.stderr)
            continue
        CORPUS_FILE.write_bytes(data)
        return
    sys.exit(
        f'could not fetch the corpus; download version 0.4 from '
        f'https://corpus.quran.com/download/ and save it as {CORPUS_FILE}'
    )


def parse_corpus() -> list[Segment]:
    segs: list[Segment] = []
    with CORPUS_FILE.open(encoding='utf-8') as f:
        for line in f:
            if not line.startswith('('):
                continue
            loc, form, tag, feats = line.rstrip('\n').split('\t')
            s, a, w, g = (int(x) for x in loc.strip('()').split(':'))
            parts = feats.split('|')
            d: dict[str, str] = {}
            for p in parts[1:]:
                if ':' in p:
                    k, v = p.split(':', 1)
                    d[k] = v
                else:
                    d[p] = ''
            segs.append(Segment(s, a, w, g, form, tag, parts[0], d))
    return segs


# ---------------------------------------------------------------------------
# Lemmas
# ---------------------------------------------------------------------------

@dataclass
class Lemma:
    key: str  # Buckwalter LEM, or PRON:<features>
    bw: str  # Buckwalter form to render / transliterate
    root: str | None
    freq: int = 0
    pos: Counter = field(default_factory=Counter)
    occurrences: list[tuple[int, int, int]] = field(default_factory=list)
    first: tuple[int, int, int] = (999, 999, 999)
    forms: Counter = field(default_factory=Counter)

    @property
    def dominant_pos(self) -> str:
        return self.pos.most_common(1)[0][0]


def aggregate(segs: list[Segment]) -> dict[str, Lemma]:
    lemmas: dict[str, Lemma] = {}
    by_word: dict[tuple[int, int, int], list[Segment]] = defaultdict(list)
    for s in segs:
        by_word[(s.surah, s.ayah, s.word)].append(s)

    for loc, word_segs in by_word.items():
        governed = False  # a preposition prefix makes a following pronoun "attached"
        for s in word_segs:
            if s.kind == 'PREFIX':
                if s.tag in ('P', 'PRP'):
                    governed = True
                continue
            if s.kind != 'STEM':
                continue
            if 'LEM' in s.feats:
                key = s.feats['LEM']
                lem = lemmas.get(key)
                if lem is None:
                    lem = lemmas[key] = Lemma(key, key, s.feats.get('ROOT'))
            elif s.tag == 'PRON' and not governed:
                # Independent personal pronoun: هُوَ, هُمْ, أَنتُمْ … The feature
                # after POS names person/gender/number.
                feat = next((k for k in s.feats if k not in ('POS',)), None)
                if not feat:
                    continue
                key = f'PRON:{feat}'
                lem = lemmas.get(key)
                if lem is None:
                    lem = lemmas[key] = Lemma(key, s.form, None)
                lem.forms[s.form.rstrip('^",.')] += 1
            else:
                continue
            lem.freq += 1
            lem.pos[s.feats.get('POS', s.tag)] += 1
            lem.occurrences.append(loc)
            if loc < lem.first:
                lem.first = loc
    # Pronoun headword: the most frequent standalone spelling.
    for lem in lemmas.values():
        if lem.key.startswith('PRON:'):
            lem.bw = lem.forms.most_common(1)[0][0]
    return lemmas


# ---------------------------------------------------------------------------
# Examples: corpus word index → token index in ayah.arabic
# ---------------------------------------------------------------------------

def token_map(arabic: str) -> list[int]:
    """1-based raw token index for each corpus word (marks skipped)."""
    out = []
    for i, tok in enumerate(arabic.split(' '), start=1):
        if tok and all(ch in MARK_CHARS for ch in tok):
            continue
        out.append(i)
    return out


# ---------------------------------------------------------------------------
# Hand-written content: phase 0 (glue) and phase 4 (grammar)
# ---------------------------------------------------------------------------

# (arabic, gloss_bs, gloss_en, note_bs, note_en)
GLUE_LESSONS: list[tuple[str, str, str, str, list[tuple[str, str, str, str, str]]]] = [
    (
        'Prefiksi I: وَ فَ بِ لِ',
        'Prefixes I: wa fa bi li',
        'Arapska riječ često nosi jedno ili dva slova zalijepljena sprijeda. To nisu dio riječi nego samostalne riječi — veznici i prijedlozi — koje se pišu zajedno sa sljedećom. Ako ih naučiš prepoznati i skinuti, ostaje jezgra koju tražiš u rječniku. Ova četiri prefiksa pokrivaju preko 15.000 pojava u Kur’anu.',
        'An Arabic word often carries one or two letters stuck to its front. They are not part of the word but words in their own right — conjunctions and prepositions — written joined to what follows. Learn to spot and peel them and what remains is the core you look up. These four prefixes account for over 15,000 occurrences in the Qur’an.',
        [
            ('وَ', 'i, a; tako mi', 'and; by (oath)',
             'Najčešći prefiks u Kur’anu, preko 9.000 puta. Veže riječi (ٱلسَّمَٰوَٰتِ وَٱلْأَرْضِ „nebesa i zemlju“) i rečenice (وَقَالَ „i reče“). Na početku ajeta često samo nastavlja govor i ne prevodi se. Uz riječ u genitivu je zakletva: وَٱلْعَصْرِ „tako mi vremena“, وَٱلضُّحَىٰ „tako mi jutra“. Nikad ne stoji sam — uvijek je zalijepljen za sljedeću riječ.',
             'The commonest prefix in the Qur’an, over 9,000 times. It joins words (ٱلسَّمَٰوَٰتِ وَٱلْأَرْضِ “the heavens and the earth”) and clauses (وَقَالَ “and he said”). At the start of a verse it often just carries the discourse on and goes untranslated. With a genitive noun it is an oath: وَٱلْعَصْرِ “by time”, وَٱلضُّحَىٰ “by the morning light”. It never stands alone — always attached to the next word.'),
            ('فَ', 'pa, tada, zato', 'then, so, therefore',
             'Slijed bez razmaka („pa, odmah zatim“) ili posljedica („zato, stoga“). فَقَالَ „pa reče“, فَٱذْكُرُونِىٓ أَذْكُرْكُمْ „zato se Mene sjećajte, i Ja ću se vas sjećati“. Poslije uslova (إِن، إِذَا، مَن) uvodi drugi dio: مَن يَعْمَلْ … فَلَهُ „ko uradi …, njemu pripada“. Poslije أَمَّا „što se tiče“ obavezno: فَأَمَّا ٱلْيَتِيمَ فَلَا تَقْهَرْ.',
             'A sequence with no gap (“then, right after”) or a consequence (“so, therefore”). فَقَالَ “so he said”, فَٱذْكُرُونِىٓ أَذْكُرْكُمْ “so remember Me and I will remember you”. After a condition (إِن، إِذَا، مَن) it opens the second half: مَن يَعْمَلْ … فَلَهُ “whoever does …, his is”. After أَمَّا “as for” it is obligatory: فَأَمَّا ٱلْيَتِيمَ فَلَا تَقْهَرْ.'),
            ('بِ', 'sa, u, pomoću', 'with, by, in',
             'Prijedlog zalijepljen za riječ; riječ iza njega ide u genitiv (kesra): بِسْمِ ٱللَّهِ „u ime Allaha“, بِٱلْحَقِّ „s istinom“, بِإِذْنِ ٱللَّهِ „s Allahovom dozvolom“. Sredstvo („pomoću“): بِأَمْوَٰلِكُمْ „imecima svojim“. Uz glagole vjerovanja: ءَامَنَ بِٱللَّهِ „vjerovao je u Allaha“. Uz zamjenice: بِهِ „njime, u njega“, بِهِمْ „njima“, بِكُمْ „vama“.',
             'A preposition joined to its word, which takes the genitive (kasra): بِسْمِ ٱللَّهِ “in the name of God”, بِٱلْحَقِّ “with the truth”, بِإِذْنِ ٱللَّهِ “by God’s leave”. Instrument (“by means of”): بِأَمْوَٰلِكُمْ “with your wealth”. With verbs of belief: ءَامَنَ بِٱللَّهِ “he believed in God”. With pronouns: بِهِ “with it, in him”, بِهِمْ “with them”, بِكُمْ “with you”.'),
            ('لِ', 'za, radi; pripada', 'for, to; belongs to',
             'Prijedlog „za, radi, pripada“; riječ iza u genitivu. لِلَّهِ „Allahu pripada“ (لِ + ٱللَّه, elif člana ispada), لِلنَّاسِ „ljudima“, لِرَبِّكَ „Gospodaru svome“. Uz zamjenice se vokal mijenja u فَتْحَة: لَهُ „njemu / njegovo je“, لَكُمْ „vama“, لَنَا „nama“, ali لِى „meni“. Ispred glagola „da bi“: لِيَعْلَمَ „da bi znao“; ispred glagola bez fethe zapovijed „neka“: لِيَعْبُدُوا „neka obožavaju“.',
             'The preposition “for, to, belongs to”; genitive follows. لِلَّهِ “belongs to God” (لِ + ٱللَّه, the article’s alif drops), لِلنَّاسِ “for the people”, لِرَبِّكَ “to your Lord”. Before pronouns its vowel becomes fatha: لَهُ “to him / his”, لَكُمْ “to you”, لَنَا “to us”, but لِى “to me”. Before a verb, “in order to”: لِيَعْلَمَ “so that he knows”; before a jussive verb, a command “let”: لِيَعْبُدُوا “let them worship”.'),
            ('لَ', 'zaista, doista', 'indeed, surely',
             'Isti oblik kao لِ + zamjenica, ali drugi zadatak: pojačava. Najčešće uz إِنَّ, na drugoj riječi: إِنَّ ٱللَّهَ لَغَفُورٌ رَّحِيمٌ „Allah, doista, prašta i milostiv je“. Uz قَدْ: لَقَدْ „zaista već“. U odgovoru na لَوْ i zakletvu: لَوْ … لَـ „da …, sigurno bi“; وَٱلْعَصْرِ إِنَّ ٱلْإِنسَٰنَ لَفِى خُسْرٍ „tako mi vremena, čovjek je doista na gubitku“.',
             'Same shape as لِ + pronoun, different job: emphasis. Mostly with إِنَّ, on the second word: إِنَّ ٱللَّهَ لَغَفُورٌ رَّحِيمٌ “God is indeed forgiving and merciful”. With قَدْ: لَقَدْ “indeed already”. In the answer to لَوْ and to an oath: لَوْ … لَـ “if …, then surely”; وَٱلْعَصْرِ إِنَّ ٱلْإِنسَٰنَ لَفِى خُسْرٍ “by time, man is surely in loss”.'),
            ('وَلَ / فَلَ', 'i zaista / pa zaista', 'and indeed / so indeed',
             'Prefiksi se slažu jedan na drugi, uvijek istim redom: prvo veznik (وَ، فَ), pa prijedlog ili pojačanje (بِ، لِ، لَ، كَ), pa član (ٱلْ), pa riječ. وَلَقَدْ „i doista već“, وَلِلَّهِ „i Allahu pripada“, فَلَهُمْ „pa njima pripada“, فَبِأَىِّ „pa kojom“. Guli se sloj po sloj s lijeva.',
             'Prefixes stack, always in the same order: conjunction first (وَ، فَ), then preposition or emphasis (بِ، لِ، لَ، كَ), then the article (ٱلْ), then the word. وَلَقَدْ “and indeed already”, وَلِلَّهِ “and to God belongs”, فَلَهُمْ “so theirs is”, فَبِأَىِّ “so by which”. Peel from the left, one layer at a time.'),
        ],
    ),
    (
        'Prefiksi II: كَ ٱلْ سَ أَ يَا',
        'Prefixes II: ka al sa a ya',
        'Još pet prefiksa: poređenje كَ, određeni član ٱلْ (najčešća „riječ“ u Kur’anu poslije وَ), budućnost سَ, pitanje أَ i dozivanje يَا. Član je najvažniji: pola riječi koje vidiš počinje s ٱل, a to nije slovo korijena.',
        'Five more prefixes: the comparison كَ, the definite article ٱلْ (the commonest “word” in the Qur’an after وَ), the future سَ, the question أَ and the vocative يَا. The article matters most: half the words you see begin with ٱل, and it is never part of the root.',
        [
            ('كَ', 'kao', 'like, as',
             'Poređenje; riječ iza u genitivu. كَمَثَلِ „kao primjer“, كَٱلْجِبَالِ „kao brda“. Slaže se sa zamjenicama u nove riječi: كَذَٰلِكَ „tako, isto tako“ (كَ + ذَٰلِكَ), كَمَا „kao što“ (كَ + مَا), كَأَنَّ „kao da“. Nikad ne stoji uz zamjenički sufiks — za „kao on“ kaže se مِثْلُهُ.',
             'Comparison; genitive follows. كَمَثَلِ “like the example of”, كَٱلْجِبَالِ “like mountains”. It fuses with pronouns into new words: كَذَٰلِكَ “thus, likewise” (كَ + ذَٰلِكَ), كَمَا “just as” (كَ + مَا), كَأَنَّ “as if”. It never takes a pronoun suffix — “like him” is مِثْلُهُ.'),
            ('ٱلْ', 'određeni član', 'the',
             'Član „the“; arapski nema neodređeni član, pa je riječ bez ٱلْ „neki, jedan“ i nosi tenvin (كِتَٰبٌ „knjiga, neka knjiga“), a s ٱلْ „ta“ (ٱلْكِتَٰبُ). Piše se s vaslom ٱ: iza prethodne riječi elif se ne izgovara (بِسْمِ ٱللَّهِ = bismi-llāhi). Ispred „sunčevih slova“ (ت ث د ذ ر ز س ش ص ض ط ظ ل ن) lam se ne čuje, a slovo se udvaja: ٱلرَّحْمَٰنِ = ar-raḥmān, ٱلنَّاسِ = an-nās, ٱلشَّمْسُ = aš-šams. Ispred ostalih se čuje: ٱلْحَمْدُ = al-ḥamd, ٱلْكِتَٰبُ = al-kitāb.',
             'The article “the”; Arabic has no indefinite article, so a word without ٱلْ is “a, some” and carries tanwin (كِتَٰبٌ “a book”), with ٱلْ it is “the” (ٱلْكِتَٰبُ). Written with wasla ٱ: after a preceding word the alif is silent (بِسْمِ ٱللَّهِ = bismi-llāhi). Before the “sun letters” (ت ث د ذ ر ز س ش ص ض ط ظ ل ن) the lam is silent and the letter doubles: ٱلرَّحْمَٰنِ = ar-raḥmān, ٱلنَّاسِ = an-nās, ٱلشَّمْسُ = aš-šams. Before the rest it is heard: ٱلْحَمْدُ = al-ḥamd, ٱلْكِتَٰبُ = al-kitāb.'),
            ('بِٱلْ / لِلْ / وَٱلْ', 'sa (tim) / (tome) pripada / i (ta)', 'with the / to the / and the',
             'Prijedlog ili veznik + član. بِٱلْحَقِّ „s istinom“, وَٱلْأَرْضِ „i zemlja“, كَٱلْأَعْمَىٰ „kao slijepac“. Poslije لِ elif člana ispada i ostaju dva lama: لِلنَّاسِ „ljudima“ (لِ + ٱلْ + نَاس), لِلَّهِ „Allahu“, لِلْمُتَّقِينَ „bogobojaznima“. Kad vidiš لل na početku, to je لِ + ٱلْ.',
             'Preposition or conjunction + article. بِٱلْحَقِّ “with the truth”, وَٱلْأَرْضِ “and the earth”, كَٱلْأَعْمَىٰ “like the blind”. After لِ the article’s alif drops, leaving two lams: لِلنَّاسِ “for the people” (لِ + ٱلْ + نَاس), لِلَّهِ “to God”, لِلْمُتَّقِينَ “for the God-fearing”. A word starting with لل is لِ + ٱلْ.'),
            ('سَ', 'će (budućnost)', 'will (future)',
             'Budućnost; ide samo uz glagol sadašnjeg vremena: سَيَقُولُ „reći će“, سَنُرِيهِمْ „pokazat ćemo im“, سَتَجِدُنِى „naći ćeš me“, سَيَعْلَمُونَ „saznat će“. Sadašnje vrijeme bez سَ pokriva i sadašnjost i budućnost — سَ je precizira. Duži oblik, zasebna riječ: سَوْفَ.',
             'The future; only before an imperfect verb: سَيَقُولُ “will say”, سَنُرِيهِمْ “We will show them”, سَتَجِدُنِى “you will find me”, سَيَعْلَمُونَ “they will know”. The imperfect without سَ covers both present and future — سَ pins it to the future. The longer form, a separate word: سَوْفَ.'),
            ('أَ', 'zar? da li?', 'question marker',
             'Elif s fethom na početku pretvara rečenicu u pitanje. أَلَمْ تَرَ „zar nisi vidio“, أَفَلَا تَعْقِلُونَ „zar ne razumijete“, أَأَنتُمْ „jeste li vi“, أَلَيْسَ ٱللَّهُ „zar Allah nije“. Poslije njega dolazi وَ ili فَ, pa negacija: أَوَلَمْ، أَفَلَا — po tri riječi u jednoj. Pazi: أَ je i početak mnogih pravih riječi (أَنزَلَ، أَرْض) — pitanje je samo kad se može skinuti.',
             'An alif with fatha at the start turns a sentence into a question. أَلَمْ تَرَ “have you not seen”, أَفَلَا تَعْقِلُونَ “will you not understand”, أَأَنتُمْ “is it you”, أَلَيْسَ ٱللَّهُ “is God not”. It stacks with وَ or فَ and a negation: أَوَلَمْ، أَفَلَا — three words in one. Beware: أَ also begins many real words (أَنزَلَ، أَرْض) — it is a question only when it can be peeled off.'),
            ('يَا', 'o! (dozivanje)', 'O (vocative)',
             'Dozivanje. يَٰقَوْمِ „o narode moj“, يَٰبُنَىَّ „o sinko moj“, يَٰمُوسَىٰ „o Musa“. Uz riječ sa članom umeće se أَيُّهَا: يَٰٓأَيُّهَا ٱلَّذِينَ ءَامَنُوا „o vi koji vjerujete“, يَٰٓأَيُّهَا ٱلنَّاسُ „o ljudi“. U mushafu se piše skraćeno, elif kao mali znak: يَٰ.',
             'Address. يَٰقَوْمِ “O my people”, يَٰبُنَىَّ “O my son”, يَٰمُوسَىٰ “O Moses”. Before a word with the article أَيُّهَا is inserted: يَٰٓأَيُّهَا ٱلَّذِينَ ءَامَنُوا “O you who believe”, يَٰٓأَيُّهَا ٱلنَّاسُ “O mankind”. The mushaf writes it short, the alif as a small sign: يَٰ.'),
        ],
    ),
    (
        'Sufiksi: zamjenice',
        'Suffixes: pronouns',
        'Zamjenice „njega, tebe, naš, vaš“ ne stoje same nego se lijepe na kraj riječi. Na imenici znače posvojnost (رَبُّكَ „Gospodar tvoj“), na glagolu objekat (رَزَقَكَ „opskrbio te“), na prijedlogu njegov objekat (لَكَ „tebi“). Jedan skup nastavaka za sva tri slučaja — nauči ga jednom.',
        'The pronouns “him, you, our, your” never stand alone; they attach to the end of a word. On a noun they mark possession (رَبُّكَ “your Lord”), on a verb the object (رَزَقَكَ “He provided for you”), on a preposition its object (لَكَ “to you”). One set of endings for all three — learn it once.',
        [
            ('ـهُ', 'njega; njegov', 'him; his',
             'Treće lice jednine muškog roda. رَبُّهُ „Gospodar njegov“, خَلَقَهُ „stvorio ga je“, لَهُ „njemu, njegovo je“, مِنْهُ „od njega“. Iza kesre, ي ili يْ vokal se mijenja u kesru: بِهِ „njime“, فِيهِ „u njemu“, عَلَيْهِ „na njemu“, إِلَيْهِ „njemu“. U mushafu se dugo هُو piše kao هُۥ.',
             'Third person masculine singular. رَبُّهُ “his Lord”, خَلَقَهُ “He created him”, لَهُ “to him, his”, مِنْهُ “from him”. After kasra, ي or يْ the vowel becomes kasra: بِهِ “with it”, فِيهِ “in it”, عَلَيْهِ “on him”, إِلَيْهِ “to him”. The mushaf writes the long form as هُۥ.'),
            ('ـهَا', 'nju; njen', 'her, it; her, its',
             'Treće lice jednine ženskog roda — i za sve množine stvari, jer se one slažu kao ženski rod jednine. أَهْلَهَا „stanovnike njene“, فِيهَا „u njoj / u njima“, عَلَيْهَا „na njoj“, رَبَّهَا „Gospodara svoga“. ٱلْجَنَّةُ … فِيهَا أَنْهَٰرٌ „Džennet … u njemu su rijeke“.',
             'Third person feminine singular — also for all non-human plurals, which agree as feminine singular. أَهْلَهَا “its people”, فِيهَا “in it / in them”, عَلَيْهَا “on it”, رَبَّهَا “its Lord”. ٱلْجَنَّةُ … فِيهَا أَنْهَٰرٌ “Paradise … in it are rivers”.'),
            ('ـهُمْ', 'njih; njihov', 'them; their',
             'Treće lice množine muškog roda, najčešći sufiks u Kur’anu (preko 7.000 puta). رَبُّهُمْ „Gospodar njihov“, أَنذَرْتَهُمْ „opomenuo si ih“, لَهُمْ „njima“, مِنْهُمْ „od njih, neki od njih“. Iza kesre هِمْ: عَلَيْهِمْ „na njima“, بِهِمْ „njima“, فِيهِمْ „među njima“. Kad slijedi riječ s vaslom, dobija dammu: عَلَيْهِمُ ٱلذِّلَّةُ.',
             'Third person masculine plural, the commonest suffix in the Qur’an (over 7,000 times). رَبُّهُمْ “their Lord”, أَنذَرْتَهُمْ “you warned them”, لَهُمْ “for them”, مِنْهُمْ “from them, some of them”. After kasra هِمْ: عَلَيْهِمْ “on them”, بِهِمْ “with them”, فِيهِمْ “among them”. Before a wasla it takes damma: عَلَيْهِمُ ٱلذِّلَّةُ.'),
            ('ـهُنَّ / ـهُمَا', 'njih (ž.) / njih dvoje', 'them (f.) / them two',
             'Ženska množina ـهُنَّ: عَلَيْهِنَّ „nad njima (ženama)“, لَهُنَّ „njima“. Dvojina ـهُمَا za dvoje bilo kojeg roda: بَيْنَهُمَا „između njih dvoje“, مِنْهُمَا „od njih dvoje“, وَمَا بَيْنَهُمَا „i ono što je između njih (neba i zemlje)“.',
             'Feminine plural ـهُنَّ: عَلَيْهِنَّ “over them (women)”, لَهُنَّ “for them”. Dual ـهُمَا for two of either gender: بَيْنَهُمَا “between the two of them”, مِنْهُمَا “from the two”, وَمَا بَيْنَهُمَا “and what is between them (heaven and earth)”.'),
            ('ـكَ / ـكِ', 'tebe; tvoj (m. / ž.)', 'you; your (m. / f.)',
             'Drugo lice jednine. Muški rod ـكَ: رَبِّكَ „Gospodara tvoga“, إِيَّاكَ „Tebe (samo)“, عَلَيْكَ „na tebi“, لَكَ „tebi“. Ženski rod ـكِ: رَبَّكِ „Gospodara tvoga“ (Merjemi), عَلَيْكِ. Nastavak glagola „ti si“ je drugačiji: ـتَ (كُنتَ „bio si“).',
             'Second person singular. Masculine ـكَ: رَبِّكَ “your Lord”, إِيَّاكَ “You (alone)”, عَلَيْكَ “on you”, لَكَ “to you”. Feminine ـكِ: رَبَّكِ “your Lord” (to Mary), عَلَيْكِ. The verb ending “you (did)” is different: ـتَ (كُنتَ “you were”).'),
            ('ـكُمْ', 'vas; vaš', 'you; your (pl.)',
             'Drugo lice množine. رَبُّكُمْ „Gospodar vaš“, خَلَقَكُمْ „stvorio vas je“, عَلَيْكُمْ „na vas“, لَكُمْ „vama“, أَنفُسَكُمْ „vas same“. Dvojina ـكُمَا: رَبِّكُمَا „Gospodara vas dvoje“ (u suri Er-Rahman, džinima i ljudima). Ženska množina ـكُنَّ.',
             'Second person plural. رَبُّكُمْ “your Lord”, خَلَقَكُمْ “He created you”, عَلَيْكُمْ “upon you”, لَكُمْ “for you”, أَنفُسَكُمْ “yourselves”. Dual ـكُمَا: رَبِّكُمَا “the Lord of you two” (in ar-Rahman, to jinn and men). Feminine plural ـكُنَّ.'),
            ('ـنَا', 'nas; naš', 'us; our',
             'Prvo lice množine. رَبَّنَا „Gospodaru naš“, عَلَيْنَا „na nas“, لَنَا „nama“, ءَايَٰتِنَا „ajete Naše“. Isti oblik je i nastavak glagola „mi smo“: قُلْنَا „rekli smo“, خَلَقْنَا „stvorili smo“, أَنزَلْنَا „objavili smo“. Razlika: na imenici je posvojno, na glagolu je vršilac — إِنَّا أَنزَلْنَٰهُ „Mi smo ga, doista, objavili“ ima oba (إِنَّ + نَا, أَنزَلْ + نَا + هُ).',
             'First person plural. رَبَّنَا “our Lord”, عَلَيْنَا “upon us”, لَنَا “for us”, ءَايَٰتِنَا “Our signs”. The same shape is the verb ending “we (did)”: قُلْنَا “we said”, خَلَقْنَا “We created”, أَنزَلْنَا “We sent down”. Tell them apart: on a noun it is possessive, on a verb the doer — إِنَّا أَنزَلْنَٰهُ “We have indeed sent it down” has both (إِنَّ + نَا, أَنزَلْ + نَا + هُ).'),
            ('ـِى / ـنِى', 'mene; moj', 'me; my',
             'Prvo lice jednine. Na imenici i prijedlogu ـِى: رَبِّى „Gospodar moj“, قَوْمِى „narod moj“, لِى „meni“, بِى „mnome“. Na glagolu s umetnutim ن: ـنِى: ٱذْكُرُونِىٓ „sjećajte se Mene“, أَرِنِى „pokaži mi“, إِنَّنِى „ja sam doista“. U mushafu se završno ى često piše bez tačaka (رَبِّىَ).',
             'First person singular. On a noun or preposition ـِى: رَبِّى “my Lord”, قَوْمِى “my people”, لِى “to me”, بِى “with me”. On a verb with an inserted ن: ـنِى: ٱذْكُرُونِىٓ “remember Me”, أَرِنِى “show me”, إِنَّنِى “I am indeed”. The mushaf often writes the final ى without dots (رَبِّىَ).'),
        ],
    ),
    (
        'Kako oguliti riječ',
        'How to peel a word',
        'Vježba: svaka od ovih riječi je tri ili četiri riječi u jednoj. Postupak je uvijek isti — skini prefikse s lijeva (وَ فَ بِ لِ كَ سَ أَ, pa ٱلْ), skini sufiks-zamjenicu s desna (ـهُ ـهُمْ ـكُمْ ـنَا …), i ono što ostane je jezgra: imenica ili glagol koji tražiš u rječniku. S vremenom ćeš to raditi bez razmišljanja.',
        'Practice: each of these words is three or four words in one. The procedure never changes — strip the prefixes from the left (وَ فَ بِ لِ كَ سَ أَ, then ٱلْ), strip the pronoun suffix from the right (ـهُ ـهُمْ ـكُمْ ـنَا …), and what remains is the core: the noun or verb you look up. In time you will do it without thinking.',
        [
            ('وَلِلَّهِ', 'i Allahu pripada', 'and to God belongs',
             'وَ + لِ + ٱللَّه. Elif člana ispada iza لِ, pa ostaju dva lama i ime: لِلَّهِ. وَلِلَّهِ مَا فِى ٱلسَّمَٰوَٰتِ „i Allahu pripada sve što je na nebesima“.',
             'وَ + لِ + ٱللَّه. The article’s alif drops after لِ, leaving two lams and the name: لِلَّهِ. وَلِلَّهِ مَا فِى ٱلسَّمَٰوَٰتِ “and to God belongs whatever is in the heavens”.'),
            ('بِرَبِّهِمْ', 's Gospodarom njihovim', 'with their Lord',
             'بِ + رَبّ + هِمْ. Jezgra je رَبّ „Gospodar“; kesra iz بِ pretvara هُمْ u هِمْ. Ista jezgra u رَبُّكُمْ، رَبَّنَا، رَبِّى.',
             'بِ + رَبّ + هِمْ. The core is رَبّ “Lord”; the kasra of بِ turns هُمْ into هِمْ. The same core in رَبُّكُمْ، رَبَّنَا، رَبِّى.'),
            ('أَفَلَا', 'zar onda ne', 'will you not then',
             'أَ + فَ + لَا: pitanje + „pa“ + negacija, tri riječi u jednoj, uvijek ispred glagola: أَفَلَا تَعْقِلُونَ „zar ne razumijete“, أَفَلَا يَتَدَبَّرُونَ ٱلْقُرْءَانَ „zar ne razmišljaju o Kur’anu“. Slično: أَوَلَمْ „zar nisu“, أَوَلَا.',
             'أَ + فَ + لَا: question + “then” + negation, three words in one, always before a verb: أَفَلَا تَعْقِلُونَ “will you not understand”, أَفَلَا يَتَدَبَّرُونَ ٱلْقُرْءَانَ “do they not reflect on the Qur’an”. Similar: أَوَلَمْ “have they not”, أَوَلَا.'),
            ('وَٱلَّذِينَ', 'i oni koji', 'and those who',
             'وَ + ٱلَّذِينَ. Odnosna zamjenica u množini; jezgra je ٱلَّذِى. وَٱلَّذِينَ ءَامَنُوا وَعَمِلُوا ٱلصَّٰلِحَٰتِ „a oni koji vjeruju i dobra djela čine“ — najčešća fraza u Kur’anu.',
             'وَ + ٱلَّذِينَ. The relative pronoun, plural; the core is ٱلَّذِى. وَٱلَّذِينَ ءَامَنُوا وَعَمِلُوا ٱلصَّٰلِحَٰتِ “and those who believe and do good deeds” — the commonest phrase in the Qur’an.'),
            ('مِنْهُمْ', 'od njih, neki od njih', 'from them, some of them',
             'مِنْ + هُمْ. Prijedlog i zamjenica pišu se zajedno. Isto: مِنْهُ „od njega“, مِنكُمْ „od vas“, مِنَّا „od nas“ (مِنْ + نَا, nun se udvaja).',
             'مِنْ + هُمْ. Preposition and pronoun are written as one word. Likewise: مِنْهُ “from him”, مِنكُمْ “from you”, مِنَّا “from us” (مِنْ + نَا, the nun doubles).'),
            ('سَنُرِيهِمْ', 'pokazat ćemo im', 'We will show them',
             'سَ + نُرِى + هِمْ: budućnost + glagol u 1. licu množine („mi pokazujemo“) + objekat. سَنُرِيهِمْ ءَايَٰتِنَا فِى ٱلْءَافَاقِ „pokazat ćemo im znakove Naše na obzorjima“ (41:53).',
             'سَ + نُرِى + هِمْ: future + verb in the first person plural (“we show”) + object. سَنُرِيهِمْ ءَايَٰتِنَا فِى ٱلْءَافَاقِ “We will show them Our signs on the horizons” (41:53).'),
            ('فَٱذْكُرُونِىٓ', 'pa sjećajte se Mene', 'so remember Me',
             'فَ + ٱذْكُرُوا + نِى: „pa“ + zapovijed u množini („sjećajte se“) + „mene“. Elif zapovijedi ima vaslu, pa se poslije فَ ne izgovara: fa-zkurūnī. Nastavak: أَذْكُرْكُمْ „(i Ja ću) se vas sjećati“ = أَذْكُرْ + كُمْ.',
             'فَ + ٱذْكُرُوا + نِى: “so” + plural command (“remember”) + “me”. The command’s alif has wasla, so after فَ it is silent: fa-dhkurūnī. It continues: أَذْكُرْكُمْ “(and I will) remember you” = أَذْكُرْ + كُمْ.'),
            ('وَبِٱلْحَقِّ', 'i s istinom', 'and with the truth',
             'وَ + بِ + ٱلْ + حَقّ. Četiri sloja; jezgra حَقّ nosi značenje. Redoslijed je uvijek isti: veznik, prijedlog, član, riječ.',
             'وَ + بِ + ٱلْ + حَقّ. Four layers; the core حَقّ carries the meaning. The order is always the same: conjunction, preposition, article, word.'),
            ('أَنفُسَكُمْ', 'vas same', 'yourselves',
             'أَنفُس + كُمْ. Ovdje أَ nije pitanje nego dio riječi: أَنفُس je množina od نَفْس „duša, osoba“. Doslovno „duše vaše“. Provjera: ako riječ bez أَ nema smisla, أَ je dio riječi.',
             'أَنفُس + كُمْ. Here أَ is not a question but part of the word: أَنفُس is the plural of نَفْس “soul, self”. Literally “your souls”. Test: if the word makes no sense without أَ, the أَ belongs to it.'),
            ('لَعَلَّكُمْ', 'da biste vi', 'so that you may',
             'لَعَلَّ + كُمْ. Čestica nade i svrhe + zamjenica; iza nje uvijek glagol: لَعَلَّكُمْ تَتَّقُونَ „da biste se sačuvali“, لَعَلَّكُمْ تَعْقِلُونَ „da biste razumjeli“, لَعَلَّهُمْ يَرْجِعُونَ „ne bi li se vratili“.',
             'لَعَلَّ + كُمْ. The particle of hope and purpose + a pronoun; a verb always follows: لَعَلَّكُمْ تَتَّقُونَ “so that you may be mindful”, لَعَلَّكُمْ تَعْقِلُونَ “so that you may understand”, لَعَلَّهُمْ يَرْجِعُونَ “so that they may return”.'),
        ],
    ),
]

# Intro paragraphs for the list lessons, by phase. {coverage} is the share of
# all Qur'an words covered by every lemma up to this lesson's last rank.
PHASE_INTRO: dict[int, tuple[str, str]] = {
    1: (
        'Čestice su kratke riječi bez korijena i bez promjene: prijedlozi, veznici, zamjenice, upitne i negacijske riječi. Ne nose značenje same, ali drže rečenicu na okupu — bez njih ne možeš pratiti ko šta radi kome. Riječi u ovoj lekciji zajedno se pojavljuju {count} puta; sve riječi do ovdje pokrivaju {coverage} % Kur’ana.',
        'Particles are short words with no root and no inflection: prepositions, conjunctions, pronouns, question and negation words. They carry little meaning of their own but hold the sentence together — without them you cannot follow who does what to whom. The words in this lesson occur {count} times between them; every word up to here covers {coverage} % of the Qur’an.',
    ),
    2: (
        'Deset riječi po učestalosti. Za svaku: korijen (tri slova koja nose osnovno značenje — druge riječi istog korijena su ti već pola poznate), rang, broj pojava i dva ajeta s riječju označenom. Nauči korijen, ne samo oblik. Riječi u ovoj lekciji pojavljuju se {count} puta; sve riječi do ovdje pokrivaju {coverage} % Kur’ana.',
        'Ten words in frequency order. For each: the root (the three letters that carry the core meaning — other words of the same root are already half familiar), rank, number of occurrences, and two ayahs with the word highlighted. Learn the root, not just the form. The words in this lesson occur {count} times; every word up to here covers {coverage} % of the Qur’an.',
    ),
    3: (
        'Nastavak riječi po učestalosti. Ovdje se sve više javljaju riječi koje se pojavljuju samo desetak puta — ali svaka je u ajetima koje ćeš sresti. Riječi u ovoj lekciji pojavljuju se {count} puta; sve riječi do ovdje pokrivaju {coverage} % Kur’ana.',
        'Words in frequency order, continued. More and more of these occur only a dozen times — yet each sits in ayahs you will meet. The words in this lesson occur {count} times; every word up to here covers {coverage} % of the Qur’an.',
    ),
}

# (title_bs, title_en, body_bs, body_en) — simple markdown: #, -, **bold**
GRAMMAR_LESSONS: list[tuple[str, str, str, str]] = [
    (
        'Red riječi: glagol – vršilac – objekat',
        'Word order: verb – doer – object',
        """# Glagol dolazi prvi

Arapska rečenica s glagolom najčešće ide **glagol – vršilac – objekat**:

- خَلَقَ ٱللَّهُ ٱلسَّمَٰوَٰتِ — *stvorio je Allah nebesa*
- قَالَ مُوسَىٰ — *reče Musa*

Vršilac je često sakriven u glagolu: قَالُوا۟ „rekoše (oni)“, نَعْبُدُ „obožavamo (mi)“.

# Rečenica bez glagola

Dvije imenice jedna do druge čine cijelu rečenicu s nevidljivim „je“:

- ٱللَّهُ غَفُورٌ — *Allah (je) Onaj koji prašta*
- ٱلْحَمْدُ لِلَّهِ — *hvala (pripada) Allahu*

Prvi dio je određen (ٱلْ, ime, zamjenica), drugi obično neodređen (tenvin: ـٌ).

# Kako čitati

1. Nađi glagol (ili zaključi da ga nema).
2. Ko vrši radnju? Ako nema posebne riječi, vršilac je u glagolu.
3. Ostatak su objekat, prijedlozi i dodaci.
""",
        """# The verb comes first

An Arabic verbal sentence usually runs **verb – doer – object**:

- خَلَقَ ٱللَّهُ ٱلسَّمَٰوَٰتِ — *created God the heavens*
- قَالَ مُوسَىٰ — *said Moses*

The doer is often hidden inside the verb: قَالُوا۟ “they said”, نَعْبُدُ “we worship”.

# The sentence without a verb

Two nouns side by side make a full sentence with an invisible “is”:

- ٱللَّهُ غَفُورٌ — *God (is) Forgiving*
- ٱلْحَمْدُ لِلَّهِ — *praise (belongs) to God*

The first part is definite (ٱلْ, a name, a pronoun), the second usually indefinite (tanwin: ـٌ).

# How to read

1. Find the verb (or decide there is none).
2. Who acts? With no separate word, the doer is inside the verb.
3. The rest is object, prepositions and extras.
""",
    ),
    (
        'Nastavci glagola za lice',
        'Verb endings for person',
        """# Prošlo vrijeme: nastavak na kraju

Osnova + nastavak kaže *ko*:

- فَعَلَ — *on je učinio* (bez nastavka)
- فَعَلَتْ — *ona* (ـَتْ)
- فَعَلُوا۟ — *oni* (ـُوا۟)
- فَعَلْتَ — *ti* (ـْتَ) · فَعَلْتُمْ — *vi* (ـْتُمْ)
- فَعَلْتُ — *ja* (ـْتُ) · فَعَلْنَا — *mi* (ـْنَا)

Primjeri: قَالُوا۟ „rekoše“, ءَامَنَّا „povjerovali smo“, كَفَرْتُمْ „niste vjerovali“.

# Sadašnje vrijeme: prefiks na početku

- يَفْعَلُ — *on* (يَـ) · تَفْعَلُ — *ona / ti* (تَـ)
- يَفْعَلُونَ — *oni* (يَـ … ـُونَ) · تَفْعَلُونَ — *vi*
- أَفْعَلُ — *ja* (أَ) · نَفْعَلُ — *mi* (نَـ)

Primjeri: يَعْلَمُونَ „oni znaju“, تَعْلَمُونَ „vi znate“, نَعْبُدُ „mi obožavamo“.

**Pravilo:** prošlost gledaj na kraju riječi, sadašnjost na početku.
""",
        """# Past tense: the ending tells who

Stem + ending says *who*:

- فَعَلَ — *he did* (no ending)
- فَعَلَتْ — *she* (ـَتْ)
- فَعَلُوا۟ — *they* (ـُوا۟)
- فَعَلْتَ — *you* (ـْتَ) · فَعَلْتُمْ — *you pl.* (ـْتُمْ)
- فَعَلْتُ — *I* (ـْتُ) · فَعَلْنَا — *we* (ـْنَا)

Examples: قَالُوا۟ “they said”, ءَامَنَّا “we believed”, كَفَرْتُمْ “you disbelieved”.

# Present tense: the prefix tells who

- يَفْعَلُ — *he* (يَـ) · تَفْعَلُ — *she / you* (تَـ)
- يَفْعَلُونَ — *they* (يَـ … ـُونَ) · تَفْعَلُونَ — *you pl.*
- أَفْعَلُ — *I* (أَ) · نَفْعَلُ — *we* (نَـ)

Examples: يَعْلَمُونَ “they know”, تَعْلَمُونَ “you know”, نَعْبُدُ “we worship”.

**Rule:** for the past look at the end of the word, for the present at the start.
""",
    ),
    (
        '„X Y“ = X od Y',
        '“X Y” = X of Y',
        """# Genitivna veza (idafa)

Dvije imenice zaredom, prva bez ٱلْ i bez tenvina, druga u genitivu (kesra):

- رَبِّ ٱلْعَٰلَمِينَ — *Gospodar svjetova*
- يَوْمِ ٱلدِّينِ — *Dan sudnji* (dan suda)
- أَهْلَ ٱلْكِتَٰبِ — *sljedbenici Knjige*
- كِتَٰبُ ٱللَّهِ — *Knjiga Allahova*

Prva riječ je „ono što pripada“, druga „kome pripada“. Prva nikad ne nosi ٱلْ; određenost dobiva od druge.

# Sa zamjenicom

Sufiks-zamjenica je druga riječ veze: رَبُّكُمْ „Gospodar vaš“, أَعْمَٰلُهُمْ „djela njihova“.

# Pridjev dolazi poslije

Pridjev slijedi imenicu i slaže se s njom u određenosti: ٱلصِّرَٰطَ ٱلْمُسْتَقِيمَ „put pravi“, عَذَابٌ أَلِيمٌ „kazna bolna“.

**Test:** ako druga riječ ima ٱلْ a prva nema — veza. Ako obje imaju ili obje nemaju — pridjev.
""",
        """# The genitive construction (idafa)

Two nouns in a row, the first without ٱلْ and without tanwin, the second in the genitive (kasra):

- رَبِّ ٱلْعَٰلَمِينَ — *Lord of the worlds*
- يَوْمِ ٱلدِّينِ — *Day of Judgement*
- أَهْلَ ٱلْكِتَٰبِ — *people of the Book*
- كِتَٰبُ ٱللَّهِ — *the Book of God*

The first word is “the thing possessed”, the second “the possessor”. The first never carries ٱلْ; it takes its definiteness from the second.

# With a pronoun

A suffix pronoun is the second term: رَبُّكُمْ “your Lord”, أَعْمَٰلُهُمْ “their deeds”.

# The adjective comes after

An adjective follows its noun and matches it in definiteness: ٱلصِّرَٰطَ ٱلْمُسْتَقِيمَ “the straight path”, عَذَابٌ أَلِيمٌ “a painful punishment”.

**Test:** second word has ٱلْ and the first does not — idafa. Both have it or neither — adjective.
""",
    ),
    (
        'Prijedlozi i padeži',
        'Prepositions and case',
        """# Tri padeža, tri harfa

Kraj imenice pokazuje ulogu u rečenici:

- **ـُ (damma)** — nominativ: vršilac, subjekat. ٱللَّهُ, رَبُّ
- **ـَ (fetha)** — akuzativ: objekat, poslije إِنَّ. ٱللَّهَ, رَبَّ
- **ـِ (kesra)** — genitiv: poslije prijedloga i u vezi „X od Y“. ٱللَّهِ, رَبِّ

Neodređena imenica ima tenvin: ـٌ ـً ـٍ (kitābun, kitāban, kitābin).

# Prijedlozi traže kesru

Riječ iza prijedloga uvijek je u genitivu:

- مِنَ ٱللَّهِ — *od Allaha* · فِى ٱلْأَرْضِ — *na zemlji*
- عَلَى ٱلَّذِينَ — *nad onima koji* · إِلَى رَبِّهِمْ — *Gospodaru svome*
- بِٱلْحَقِّ — *s istinom* · عَنِ ٱلنَّبَإِ — *o vijesti*

# Množina „sound“

Muška pravilna množina: ـُونَ (nom.) / ـِينَ (ak. i gen.): مُؤْمِنُونَ, مُؤْمِنِينَ. Ženska: ـَٰتٌ / ـَٰتٍ.

**Prečica:** kesra na kraju = traži prijedlog ili vezu ispred.
""",
        """# Three cases, three vowels

The end of a noun shows its role in the sentence:

- **ـُ (damma)** — nominative: doer, subject. ٱللَّهُ, رَبُّ
- **ـَ (fatha)** — accusative: object, after إِنَّ. ٱللَّهَ, رَبَّ
- **ـِ (kasra)** — genitive: after prepositions and in “X of Y”. ٱللَّهِ, رَبِّ

An indefinite noun takes tanwin: ـٌ ـً ـٍ (kitābun, kitāban, kitābin).

# Prepositions demand kasra

The word after a preposition is always genitive:

- مِنَ ٱللَّهِ — *from God* · فِى ٱلْأَرْضِ — *in the earth*
- عَلَى ٱلَّذِينَ — *upon those who* · إِلَى رَبِّهِمْ — *to their Lord*
- بِٱلْحَقِّ — *with the truth* · عَنِ ٱلنَّبَإِ — *about the news*

# Sound plurals

Masculine sound plural: ـُونَ (nom.) / ـِينَ (acc. and gen.): مُؤْمِنُونَ, مُؤْمِنِينَ. Feminine: ـَٰتٌ / ـَٰتٍ.

**Shortcut:** kasra at the end — look for a preposition or an idafa in front.
""",
    ),
    (
        'Glagolske vrste I–X',
        'Verb forms I–X',
        """# Isti korijen, deset kalupa

Korijen od tri slova ulazi u kalupe koji mijenjaju značenje. Primjeri iz Kur’ana:

- **I** فَعَلَ — osnovno: عَلِمَ *znao je*, كَتَبَ *pisao je*
- **II** فَعَّلَ — pojačano/uzročno: عَلَّمَ *poučio je*, نَزَّلَ *spuštao je*
- **III** فَاعَلَ — uzajamno: جَٰهَدَ *borio se*, قَٰتَلَ *ratovao je*
- **IV** أَفْعَلَ — uzročno: أَنزَلَ *spustio je*, أَخْرَجَ *izveo je*
- **V** تَفَعَّلَ — povratno od II: تَعَلَّمَ *naučio je*, تَوَكَّلَ *oslonio se*
- **VI** تَفَاعَلَ — uzajamno: تَعَاوَنَ *pomagati se*
- **VII** ٱنفَعَلَ — pasivno/refleksivno: ٱنقَلَبَ *okrenuo se*
- **VIII** ٱفْتَعَلَ — za sebe: ٱتَّقَىٰ *čuvao se*, ٱتَّبَعَ *slijedio je*
- **IX** ٱفْعَلَّ — boje (rijetko): ٱبْيَضَّ *pobijelio je*
- **X** ٱسْتَفْعَلَ — tražiti: ٱسْتَغْفَرَ *tražio oprost*, ٱسْتَكْبَرَ *oholio se*

# Kako prepoznati

- Udvojeno srednje slovo → II. Elif poslije prvog → III.
- أَ na početku prošlog vremena → IV.
- تَ ispred II ili III → V ili VI.
- ٱ na početku i ن / ت / سْت unutra → VII / VIII / X.
""",
        """# One root, ten moulds

A three-letter root enters patterns that shift its meaning. Qur’anic examples:

- **I** فَعَلَ — basic: عَلِمَ *he knew*, كَتَبَ *he wrote*
- **II** فَعَّلَ — intensive/causative: عَلَّمَ *he taught*, نَزَّلَ *he sent down*
- **III** فَاعَلَ — reciprocal: جَٰهَدَ *he strove*, قَٰتَلَ *he fought*
- **IV** أَفْعَلَ — causative: أَنزَلَ *he sent down*, أَخْرَجَ *he brought out*
- **V** تَفَعَّلَ — reflexive of II: تَعَلَّمَ *he learned*, تَوَكَّلَ *he relied*
- **VI** تَفَاعَلَ — mutual: تَعَاوَنَ *to help one another*
- **VII** ٱنفَعَلَ — passive/reflexive: ٱنقَلَبَ *he turned back*
- **VIII** ٱفْتَعَلَ — for oneself: ٱتَّقَىٰ *he was mindful*, ٱتَّبَعَ *he followed*
- **IX** ٱفْعَلَّ — colours (rare): ٱبْيَضَّ *it turned white*
- **X** ٱسْتَفْعَلَ — to seek: ٱسْتَغْفَرَ *he sought forgiveness*, ٱسْتَكْبَرَ *he was arrogant*

# How to recognise them

- Doubled middle letter → II. Alif after the first letter → III.
- أَ at the start of the past tense → IV.
- تَ in front of II or III → V or VI.
- ٱ at the start and ن / ت / سْت inside → VII / VIII / X.
""",
    ),
    (
        'Negacije: مَا لَا لَن لَمْ',
        'Negation: ma la lan lam',
        """# Četiri „ne“

- **مَا** + prošlo vrijeme — *nije*: مَا كَانَ *nije bio*, مَا فَعَلُوا۟ *nisu učinili*. Isto مَا znači i „što / šta“ — smisao odlučuje.
- **لَا** + sadašnje vrijeme — *ne*: لَا يَعْلَمُونَ *ne znaju*. Uz zapovijed = zabrana: لَا تَقْرَبُوا۟ *ne približavajte se*. Uz imenicu = „nema“: لَآ إِلَٰهَ إِلَّا ٱللَّهُ.
- **لَن** + sadašnje (akuzativ) — *nikada neće*: لَن تَنَالُوا۟ *nećete postići*.
- **لَمْ** + sadašnje (skraćeno) — *nije* (prošlost!): لَمْ يَلِدْ *nije rodio*, أَلَمْ تَرَ *zar nisi vidio*.

# Zamka

لَمْ stoji uz oblik sadašnjeg vremena, ali znači prošlost. لَا يَعْلَمُ „ne zna“, لَمْ يَعْلَمْ „nije znao“.

# Ostalo

- **لَيْسَ** — glagol „nije“: لَيْسَ ٱلْبِرَّ *nije dobročinstvo*
- **غَيْر** — „ne-, drugi osim“: غَيْرِ ٱلْمَغْضُوبِ *ne onih na koje se srdi*
- **إِلَّا** — „osim“; uz negaciju daje „samo“: مَا … إِلَّا *ništa osim = samo*
""",
        """# Four ways to say “not”

- **مَا** + past — *did not*: مَا كَانَ *was not*, مَا فَعَلُوا۟ *they did not do*. The same مَا also means “what” — context decides.
- **لَا** + present — *does not*: لَا يَعْلَمُونَ *they do not know*. With a command = prohibition: لَا تَقْرَبُوا۟ *do not approach*. With a noun = “there is no”: لَآ إِلَٰهَ إِلَّا ٱللَّهُ.
- **لَن** + present (subjunctive) — *will never*: لَن تَنَالُوا۟ *you will never attain*.
- **لَمْ** + present (jussive) — *did not* (past!): لَمْ يَلِدْ *He did not beget*, أَلَمْ تَرَ *have you not seen*.

# The trap

لَمْ takes a present-tense form but means the past. لَا يَعْلَمُ “he does not know”, لَمْ يَعْلَمْ “he did not know”.

# Related

- **لَيْسَ** — the verb “is not”: لَيْسَ ٱلْبِرَّ *it is not righteousness*
- **غَيْر** — “not, other than”: غَيْرِ ٱلْمَغْضُوبِ *not of those who earned anger*
- **إِلَّا** — “except”; after a negation it means “only”: مَا … إِلَّا *nothing but = only*
""",
    ),
]


# ---------------------------------------------------------------------------
# Glosses CSV
# ---------------------------------------------------------------------------

CSV_FIELDS = ['lemma_id', 'key', 'arabic', 'translit', 'root', 'pos', 'freq', 'gloss_en', 'gloss_bs', 'reviewed']


def load_glosses() -> dict[str, dict[str, str]]:
    if not GLOSSES_CSV.exists():
        return {}
    with GLOSSES_CSV.open(encoding='utf-8', newline='') as f:
        return {row['key']: row for row in csv.DictReader(f)}


NOTES_CSV = DATA_DIR / 'notes.csv'


def load_notes() -> dict[str, tuple[str, str]]:
    """Hand-written usage notes per lemma (key → (bs, en)); particles and pronouns."""
    if not NOTES_CSV.exists():
        return {}
    with NOTES_CSV.open(encoding='utf-8', newline='') as f:
        return {r['key']: (r['note_bs'], r['note_en']) for r in csv.DictReader(f) if r['note_bs'] or r['note_en']}


def write_glosses(rows: list[dict[str, str]]) -> None:
    with GLOSSES_CSV.open('w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        w.writerows(rows)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--corpus', type=Path, help='morphology file (default: download into scripts/data/)')
    ap.add_argument('--max-rank', type=int, default=1000, help='last lemma rank taught from lists')
    args = ap.parse_args()

    global CORPUS_FILE
    if args.corpus:
        CORPUS_FILE = args.corpus
    else:
        download_corpus()

    segs = parse_corpus()
    total_words = len({(s.surah, s.ayah, s.word) for s in segs})
    lemmas = aggregate(segs)

    # Rank: frequency, then first occurrence — stable across runs.
    ranked = sorted(lemmas.values(), key=lambda l: (-l.freq, l.first))
    rank_of = {l.key: i + 1 for i, l in enumerate(ranked)}
    taught = [l for l in ranked if rank_of[l.key] <= args.max_rank or l.key in PARTICLE_VERBS]
    lemma_id = {l.key: i + 1 for i, l in enumerate(taught)}

    # ---- glosses -----------------------------------------------------------
    existing = load_glosses()
    csv_rows: list[dict[str, str]] = []
    missing = 0
    for l in taught:
        proper = l.dominant_pos == 'PN'
        row = existing.get(l.key)
        if row is None:
            row = {'gloss_en': '', 'gloss_bs': '', 'reviewed': '0'}
        if not row['gloss_en'] or not row['gloss_bs']:
            missing += 1
        csv_rows.append({
            'lemma_id': str(lemma_id[l.key]),
            'key': l.key,
            'arabic': to_arabic(l.bw),
            'translit': transliterate(l.bw, proper),
            'root': to_arabic(l.root) if l.root else '',
            'pos': l.dominant_pos,
            'freq': str(l.freq),
            'gloss_en': row['gloss_en'],
            'gloss_bs': row['gloss_bs'],
            'reviewed': row.get('reviewed') or '0',
        })
    # Rows for lemmas that have dropped out of the taught set are kept so a
    # reviewed gloss is never thrown away by a change of --max-rank.
    kept = [r for k, r in existing.items() if k not in lemma_id]
    write_glosses(csv_rows + kept)

    # ---- database ----------------------------------------------------------
    con = sqlite3.connect(DB)
    cur = con.cursor()
    ayah_rows = cur.execute('SELECT id, surah, ayah, arabic FROM ayah').fetchall()
    ayah_by_ref = {(s, a): (i, ar) for i, s, a, ar in ayah_rows}
    guidance_ids = {r[0] for r in cur.execute('SELECT ayah_id FROM guidance')}

    words_in_corpus: dict[tuple[int, int], int] = defaultdict(int)
    for s in segs:
        words_in_corpus[(s.surah, s.ayah)] = max(words_in_corpus[(s.surah, s.ayah)], s.word)
    tokens: dict[tuple[int, int], list[int]] = {}
    mismatched: list[str] = []
    for (s, a), n in words_in_corpus.items():
        ayah_id, arabic = ayah_by_ref[(s, a)]
        tm = token_map(arabic)
        if len(tm) != n:
            mismatched.append(f'{s}:{a} (db {len(tm)} words, corpus {n})')
            continue
        tokens[(s, a)] = tm
    if mismatched:
        print('word-count mismatches, skipped as examples: ' + ', '.join(mismatched))

    cur.executescript(
        '''
        DROP TABLE IF EXISTS lesson_item;
        DROP TABLE IF EXISTS lesson;
        DROP TABLE IF EXISTS lemma_example;
        DROP TABLE IF EXISTS lemma;
        DROP TABLE IF EXISTS vocab_meta;
        CREATE TABLE lemma (
          id INTEGER PRIMARY KEY,
          arabic TEXT NOT NULL,
          translit TEXT NOT NULL,
          root TEXT,
          pos TEXT NOT NULL,
          freq INTEGER NOT NULL,
          rank INTEGER NOT NULL,
          gloss_en TEXT NOT NULL,
          gloss_bs TEXT NOT NULL
        );
        CREATE TABLE lemma_example (
          lemma_id INTEGER NOT NULL REFERENCES lemma(id),
          ayah_id INTEGER NOT NULL REFERENCES ayah(id),
          word_index INTEGER NOT NULL,       -- 1-based, within ayah.arabic split on spaces
          PRIMARY KEY (lemma_id, ayah_id)
        );
        CREATE TABLE lesson (
          id INTEGER PRIMARY KEY,
          ordinal INTEGER NOT NULL UNIQUE,
          phase INTEGER NOT NULL,
          title_bs TEXT NOT NULL,
          title_en TEXT NOT NULL,
          body_bs TEXT,
          body_en TEXT
        );
        CREATE TABLE lesson_item (
          lesson_id INTEGER NOT NULL REFERENCES lesson(id),
          ordinal INTEGER NOT NULL,
          lemma_id INTEGER REFERENCES lemma(id),
          arabic TEXT, gloss_bs TEXT, gloss_en TEXT, note_bs TEXT, note_en TEXT,  -- glue items
          PRIMARY KEY (lesson_id, ordinal)
        );
        CREATE TABLE vocab_meta (
          total_tokens INTEGER NOT NULL,     -- words in the corpus (77,429)
          lemma_count INTEGER NOT NULL,      -- distinct lemmas in the corpus
          max_rank INTEGER NOT NULL          -- last rank taught from lists
        );
        '''
    )

    for row in csv_rows:
        l = lemmas[row['key']]
        cur.execute(
            'INSERT INTO lemma (id, arabic, translit, root, pos, freq, rank, gloss_en, gloss_bs) VALUES (?,?,?,?,?,?,?,?,?)',
            (int(row['lemma_id']), row['arabic'], row['translit'], row['root'] or None, row['pos'],
             l.freq, rank_of[l.key], row['gloss_en'], row['gloss_bs']),
        )

    # ---- examples ----------------------------------------------------------
    short = 0
    for l in taught:
        seen: set[tuple[int, int]] = set()
        cands = []
        for (s, a, w) in l.occurrences:
            if (s, a) in seen or (s, a) not in tokens:
                continue
            seen.add((s, a))
            ayah_id = ayah_by_ref[(s, a)][0]
            n = len(tokens[(s, a)])
            cands.append((n > LONG_AYAH_WORDS, ayah_id not in guidance_ids, n, (s, a, w)))
        cands.sort()
        picked = cands[:EXAMPLES_PER_LEMMA]
        if len(picked) < EXAMPLES_PER_LEMMA:
            short += 1
        for _, _, _, (s, a, w) in picked:
            cur.execute(
                'INSERT INTO lemma_example (lemma_id, ayah_id, word_index) VALUES (?,?,?)',
                (lemma_id[l.key], ayah_by_ref[(s, a)][0], tokens[(s, a)][w - 1]),
            )

    # ---- lessons -----------------------------------------------------------
    lesson_id = 0
    per_phase: Counter = Counter()

    def add_lesson(phase: int, title_bs: str, title_en: str, body_bs: str | None = None, body_en: str | None = None) -> int:
        nonlocal lesson_id
        lesson_id += 1
        per_phase[phase] += 1
        cur.execute(
            'INSERT INTO lesson (id, ordinal, phase, title_bs, title_en, body_bs, body_en) VALUES (?,?,?,?,?,?,?)',
            (lesson_id, lesson_id, phase, title_bs, title_en, body_bs, body_en),
        )
        return lesson_id

    for title_bs, title_en, intro_bs, intro_en, items in GLUE_LESSONS:
        lid = add_lesson(0, title_bs, title_en, intro_bs, intro_en)
        for i, (arabic, gloss_bs, gloss_en, note_bs, note_en) in enumerate(items, start=1):
            cur.execute(
                'INSERT INTO lesson_item (lesson_id, ordinal, lemma_id, arabic, gloss_bs, gloss_en, note_bs, note_en) VALUES (?,?,NULL,?,?,?,?,?)',
                (lid, i, arabic, gloss_bs, gloss_en, note_bs, note_en),
            )

    particles = [l for l in taught if l.dominant_pos not in CONTENT_POS or l.key in PARTICLE_VERBS]
    words = [l for l in taught if l not in particles]

    notes = load_notes()
    cum_freq = 0
    coverage_at: dict[int, float] = {}  # rank → % of all words covered by ranks 1..rank
    for l in ranked:
        cum_freq += l.freq
        coverage_at[rank_of[l.key]] = 100 * cum_freq / total_words

    def add_list_lessons(phase_for: callable, items: list[Lemma], name_bs: str, name_en: str) -> None:
        for n, start in enumerate(range(0, len(items), WORDS_PER_LESSON), start=1):
            chunk = items[start:start + WORDS_PER_LESSON]
            phase = phase_for(chunk)
            intro_bs, intro_en = PHASE_INTRO[phase]
            count = sum(l.freq for l in chunk)
            coverage = f'{coverage_at[max(rank_of[l.key] for l in chunk)]:.0f}'
            lid = add_lesson(
                phase, f'{name_bs} {n}', f'{name_en} {n}',
                intro_bs.format(count=f'{count:,}'.replace(',', '.'), coverage=coverage),
                intro_en.format(count=f'{count:,}', coverage=coverage),
            )
            for i, l in enumerate(chunk, start=1):
                note = notes.get(l.key)
                cur.execute(
                    'INSERT INTO lesson_item (lesson_id, ordinal, lemma_id, note_bs, note_en) VALUES (?,?,?,?,?)',
                    (lid, i, lemma_id[l.key], note[0] if note else None, note[1] if note else None),
                )

    add_list_lessons(lambda _c: 1, particles, 'Čestice', 'Particles')
    half = (len(words) + 1) // 2
    words_taught = 0

    def word_phase(chunk: list[Lemma]) -> int:
        nonlocal words_taught
        words_taught += len(chunk)
        return 2 if words_taught <= half else 3

    add_list_lessons(word_phase, words, 'Riječi', 'Words')

    for title_bs, title_en, body_bs, body_en in GRAMMAR_LESSONS:
        add_lesson(4, title_bs, title_en, body_bs.strip() + '\n', body_en.strip() + '\n')

    cur.execute('INSERT INTO vocab_meta (total_tokens, lemma_count, max_rank) VALUES (?,?,?)',
                (total_words, len(lemmas), args.max_rank))
    con.commit()
    con.execute('VACUUM')

    # ---- summary -----------------------------------------------------------
    def coverage(n: int) -> float:
        return 100 * sum(l.freq for l in ranked[:n]) / total_words

    n_lemmas = cur.execute('SELECT COUNT(*) FROM lemma').fetchone()[0]
    n_examples = cur.execute('SELECT COUNT(*) FROM lemma_example').fetchone()[0]
    n_lessons = cur.execute('SELECT COUNT(*) FROM lesson').fetchone()[0]
    with_notes = cur.execute('SELECT COUNT(*) FROM lesson_item WHERE lemma_id IS NOT NULL AND note_bs IS NOT NULL').fetchone()[0]
    con.close()
    print(f'corpus: {len(segs)} segments, {total_words} words, {len(lemmas)} lemmas')
    print(f'coverage of all words: rank 100 {coverage(100):.1f}%, 300 {coverage(300):.1f}%, '
          f'{args.max_rank} {coverage(args.max_rank):.1f}%')
    print(f'lemma table: {n_lemmas} rows (rank <= {args.max_rank}); {n_examples} examples, '
          f'{short} lemmas with fewer than {EXAMPLES_PER_LEMMA}')
    print('lessons: ' + ', '.join(f'phase {p}: {c}' for p, c in sorted(per_phase.items())) + f' — {n_lessons} total')
    print(f'notes: {with_notes} lemma cards carry a usage note from {NOTES_CSV.relative_to(ROOT)}')
    print(f'glosses: {len(csv_rows)} rows in {GLOSSES_CSV.relative_to(ROOT)}, {missing} without a gloss, '
          f'{sum(1 for r in csv_rows if r["reviewed"] == "1")} reviewed')
    print(f'{DB.relative_to(ROOT)}: {DB.stat().st_size / 1e6:.1f} MB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
