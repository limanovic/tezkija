import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AyahBlock } from '@/components/ayah-block';
import { Markdown } from '@/components/markdown';
import {
  LanguageRow,
  LemmaExampleRow,
  LemmaRow,
  LessonItem,
  LessonRow,
  TranslationMap,
  getExamplesForLemmas,
  getLanguages,
  getLemmasByIds,
  getLesson,
  getLessonItems,
  getLessons,
  getTranslationsByIds,
} from '@/lib/db';
import { UiStringKey, useT } from '@/lib/i18n';
import { displayArabic } from '@/lib/mushaf';
import { rebuildSchedule } from '@/lib/notifications';
import { Settings, loadSettings } from '@/lib/settings';
import { Theme, useTheme } from '@/lib/theme';
import {
  Progress,
  boxOf,
  finishLesson,
  lessonLanguages,
  lessonState,
  loadVocabState,
  markLessonOpened,
  repeatLesson,
  saveLessonCursor,
} from '@/lib/vocab';

type Loaded = {
  lesson: LessonRow | null; // null for an ad-hoc word list
  items: LessonItem[];
  examples: Map<number, LemmaExampleRow[]>;
  translations: TranslationMap;
  languages: Map<string, LanguageRow>;
  settings: Settings;
};

const POS_KEYS: Record<string, UiStringKey> = {
  N: 'posN',
  PN: 'posPN',
  ADJ: 'posADJ',
  V: 'posV',
  P: 'posP',
  PRON: 'posPRON',
  DEM: 'posDEM',
  REL: 'posREL',
  T: 'posT',
  LOC: 'posLOC',
  INTG: 'posINTG',
  NEG: 'posNEG',
  CONJ: 'posCONJ',
  COND: 'posCOND',
  SUB: 'posSUB',
  ACC: 'posACC',
};

/** Parse "1,2,3" into ids; anything malformed is dropped. */
function parseIds(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * One lesson: ten cards, each a word with its meaning and two ayahs, or a
 * grammar text. Also the screen a word-of-the-day notification opens, with
 * `lemmas` instead of `id`.
 */
export default function LessonScreen() {
  const theme = useTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { id: rawId, lemmas: rawLemmas } = useLocalSearchParams<{ id?: string; lemmas?: string }>();
  const lessonId = rawId ? Number(rawId) : NaN;
  const lemmaIds = useMemo(() => parseIds(rawLemmas), [rawLemmas]);
  const [data, setData] = useState<Loaded | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const [cursor, setCursor] = useState(1);
  const [state, setState] = useState<'new' | 'learning' | 'done'>('new');
  const [error, setError] = useState(false);

  const refreshState = useCallback(async () => {
    const vocab = await loadVocabState();
    setProgress(vocab.progress);
    setCursor(vocab.cursor);
    if (Number.isInteger(lessonId)) setState(lessonState(vocab.states, lessonId));
  }, [lessonId]);

  useEffect(() => {
    (async () => {
      const settings = await loadSettings();
      let lesson: LessonRow | null = null;
      let items: LessonItem[];
      if (Number.isInteger(lessonId)) {
        lesson = await getLesson(lessonId);
        if (!lesson) throw new Error('no such lesson');
        items = await getLessonItems(lessonId);
        await markLessonOpened(lessonId);
      } else {
        const rows = await getLemmasByIds(lemmaIds);
        items = rows.map((lemma, i) => ({
          ordinal: i + 1,
          lemma,
          arabic: null,
          gloss_bs: null,
          gloss_en: null,
          note_bs: null,
          note_en: null,
        }));
      }
      const ids = items.map((i) => i.lemma?.id).filter((x): x is number => x !== undefined);
      const [examples, languageRows] = await Promise.all([getExamplesForLemmas(ids), getLanguages()]);
      const ayahIds = [...examples.values()].flat().map((e) => e.id);
      const translations = await getTranslationsByIds(lessonLanguages(settings), ayahIds);
      setData({
        lesson,
        items,
        examples,
        translations,
        languages: new Map(languageRows.map((l) => [l.code, l])),
        settings,
      });
      await refreshState();
    })().catch(() => setError(true));
  }, [lessonId, lemmaIds, refreshState]);

  const onFinish = useCallback(async () => {
    if (!data?.lesson) return;
    await finishLesson(await getLessons(), data.lesson.id);
    // Pending "lesson" notifications carry the old lesson — requeue them.
    await rebuildSchedule(await loadSettings());
    router.back();
  }, [data]);

  const onRepeat = useCallback(async () => {
    if (!data?.lesson) return;
    await repeatLesson(data.lesson.id, data.items);
    await rebuildSchedule(await loadSettings());
    await refreshState();
  }, [data, refreshState]);

  const onSetCursor = useCallback(async () => {
    if (!data?.lesson) return;
    await saveLessonCursor(data.lesson.id);
    await rebuildSchedule(await loadSettings());
    await refreshState();
  }, [data, refreshState]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{t('loadError')}</Text>
      </View>
    );
  }
  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const { lesson, items, examples, translations, languages, settings: saved } = data;
  const langs = lessonLanguages(saved);
  // Example ayahs follow the lesson languages, whatever the reading setting.
  const settings: Settings = { ...saved, translations: langs };
  const en = langs[0] === 'en';
  const title = lesson
    ? `${t('lessonN', { n: lesson.ordinal })} · ${en ? lesson.title_en : lesson.title_bs}`
    : t('words');
  const bodies = lesson
    ? langs
        .map((code) => ({ code, text: code === 'en' ? lesson.body_en : lesson.body_bs }))
        .filter((b): b is { code: 'bs' | 'en'; text: string } => !!b.text)
    : [];
  const quizIds = items.map((i) => i.lemma?.id).filter((x): x is number => x !== undefined);
  const hasProgress = quizIds.some((id) => boxOf(progress, id) > 0);

  return (
    <>
      <Stack.Screen options={{ title }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{title}</Text>
        {lesson && (
          <Text style={styles.subtitle}>
            {t(state === 'done' ? 'statusDone' : state === 'learning' ? 'statusLearning' : 'statusNew')}
            {lesson.id === cursor && ` · ${t('cursorHere')}`}
          </Text>
        )}

        {bodies.map((b) => (
          <View key={b.code} style={styles.body}>
            {langs.length > 1 && (
              <Text style={styles.langLabel}>{t(b.code === 'en' ? 'langEn' : 'langBs')}</Text>
            )}
            <Markdown text={b.text} scale={settings.textScale} />
          </View>
        ))}

        {items.map((item) => (
          <WordCard
            key={item.ordinal}
            item={item}
            box={item.lemma ? boxOf(progress, item.lemma.id) : null}
            examples={item.lemma ? examples.get(item.lemma.id) ?? [] : []}
            langs={langs}
            settings={settings}
            translations={translations}
            languages={languages}
            styles={styles}
          />
        ))}

        <View style={styles.actions}>
          {quizIds.length > 0 && (
            <Pressable
              style={styles.primaryButton}
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: '/quiz',
                  params: lesson ? { lesson: String(lesson.id) } : { lemmas: quizIds.join(',') },
                })
              }
            >
              <Text style={styles.primaryButtonText}>{t('quiz')}</Text>
            </Pressable>
          )}
          {lesson && state !== 'done' && (
            <Pressable style={styles.secondaryButton} accessibilityRole="button" onPress={onFinish}>
              <Text style={styles.secondaryButtonText}>{t('finishLesson')}</Text>
            </Pressable>
          )}
          {lesson && (state === 'done' || hasProgress) && (
            <Pressable style={styles.linkRow} accessibilityRole="button" onPress={onRepeat}>
              <Text style={styles.linkText}>{t('repeatLesson')}</Text>
            </Pressable>
          )}
          {lesson && lesson.id !== cursor && (
            <Pressable style={styles.linkRow} accessibilityRole="button" onPress={onSetCursor}>
              <Text style={styles.linkText}>{t('setCursorHere')}</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </>
  );
}

function WordCard({
  item,
  box,
  examples,
  langs,
  settings,
  translations,
  languages,
  styles,
}: {
  item: LessonItem;
  box: number | null;
  examples: LemmaExampleRow[];
  langs: ('bs' | 'en')[];
  settings: Settings;
  translations: TranslationMap;
  languages: Map<string, LanguageRow>;
  styles: ReturnType<typeof makeStyles>;
}) {
  const t = useT();
  const lemma: LemmaRow | null = item.lemma;
  const arabic = lemma ? lemma.arabic : item.arabic ?? '';
  const glossIn = (code: 'bs' | 'en') =>
    lemma ? (code === 'en' ? lemma.gloss_en : lemma.gloss_bs) : (code === 'en' ? item.gloss_en : item.gloss_bs) ?? '';
  const noteIn = (code: 'bs' | 'en') => (code === 'en' ? item.note_en : item.note_bs);
  const size = (n: number) => Math.round(n * settings.textScale);
  const multi = langs.length > 1;
  const langLabel = (code: 'bs' | 'en') => t(code === 'en' ? 'langEn' : 'langBs');

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={[styles.headword, { fontSize: size(40), lineHeight: size(72) }]}>
          {displayArabic(arabic)}
        </Text>
        {box !== null && (
          <View style={styles.boxChip}>
            <Text style={styles.boxChipText}>{t('boxN', { n: box })}</Text>
          </View>
        )}
      </View>
      {lemma && settings.showTranslit && <Text style={styles.translit}>{lemma.translit}</Text>}
      {langs.map((code, i) => (
        <Text key={code} style={i === 0 ? styles.gloss : styles.glossSecondary}>
          {multi && <Text style={styles.glossLang}>{langLabel(code)} · </Text>}
          {glossIn(code)}
        </Text>
      ))}
      {lemma && (
        <Text style={styles.meta}>
          {t(POS_KEYS[lemma.pos] ?? 'posOther')}
          {lemma.root && ` · ${t('root')} ${lemma.root}`}
          {` · ${t('rankLine', { rank: lemma.rank, n: lemma.freq })}`}
        </Text>
      )}
      {langs.map((code) => {
        const note = noteIn(code);
        if (!note) return null;
        return (
          <View key={code} style={styles.noteBlock}>
            {multi && <Text style={styles.langLabel}>{langLabel(code)}</Text>}
            <Text style={styles.note}>{note}</Text>
          </View>
        );
      })}
      {examples.length > 0 && (
        <View style={styles.examples}>
          {examples.map((ex) => (
            <AyahBlock
              key={ex.id}
              row={ex}
              settings={settings}
              translations={translations}
              languages={languages}
              highlightWord={ex.word_index}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    scroll: { flex: 1, backgroundColor: theme.background },
    content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 64 },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.background,
    },
    errorText: { color: theme.textMuted, fontSize: 16, textAlign: 'center', padding: 32 },
    title: { fontSize: 22, fontWeight: '700', color: theme.text },
    subtitle: { fontSize: 13, color: theme.textMuted, marginTop: 4, marginBottom: 8 },
    card: {
      backgroundColor: theme.surface,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      paddingHorizontal: 18,
      paddingVertical: 14,
      marginTop: 14,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headword: {
      flex: 1,
      fontFamily: 'UthmanicHafs',
      color: theme.text,
      textAlign: 'right',
      writingDirection: 'rtl',
    },
    boxChip: {
      backgroundColor: theme.accentSoft,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 2,
      marginLeft: 8,
    },
    boxChipText: { color: theme.accent, fontSize: 12, fontWeight: '600' },
    translit: { fontSize: 15, color: theme.textMuted, textAlign: 'right', marginTop: -6 },
    gloss: { fontSize: 19, fontWeight: '600', color: theme.text, marginTop: 8 },
    glossSecondary: { fontSize: 17, fontWeight: '500', color: theme.text, marginTop: 4 },
    glossLang: { fontSize: 12, fontWeight: '700', color: theme.textMuted, letterSpacing: 0.5 },
    meta: { fontSize: 13, color: theme.textMuted, marginTop: 8 },
    noteBlock: { marginTop: 12 },
    note: { fontSize: 15, lineHeight: 23, color: theme.text },
    body: { marginTop: 8 },
    langLabel: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: theme.textMuted,
      marginBottom: 4,
    },
    examples: {
      marginTop: 4,
      paddingTop: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
    },
    actions: { marginTop: 28, gap: 10 },
    primaryButton: {
      backgroundColor: theme.accent,
      borderRadius: 12,
      alignItems: 'center',
      paddingVertical: 15,
    },
    primaryButtonText: { color: theme.onAccent, fontSize: 16, fontWeight: '600' },
    secondaryButton: {
      backgroundColor: theme.accentSoft,
      borderRadius: 12,
      alignItems: 'center',
      paddingVertical: 15,
    },
    secondaryButtonText: { color: theme.accent, fontSize: 16, fontWeight: '600' },
    linkRow: { paddingVertical: 10, alignSelf: 'center' },
    linkText: { color: theme.accent, fontSize: 15, fontWeight: '600' },
  });
}
