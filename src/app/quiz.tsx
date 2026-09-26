import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { LemmaRow, getLemmasByIds, getLessonItems } from '@/lib/db';
import { useT } from '@/lib/i18n';
import { displayArabic } from '@/lib/mushaf';
import { rebuildSchedule } from '@/lib/notifications';
import { Settings, loadSettings } from '@/lib/settings';
import { Theme, useTheme } from '@/lib/theme';
import { Progress, answer, lessonLanguages, loadProgress, quizOrder, saveProgress } from '@/lib/vocab';

function parseIds(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * Flashcards over a lesson's words (`lesson`) or an explicit list (`lemmas`,
 * from a review notification). Arabic on the front, tap to flip, then "Znam"
 * or "Ne znam" moves the word through the Leitner boxes.
 */
export default function QuizScreen() {
  const theme = useTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const params = useLocalSearchParams<{ lesson?: string; lemmas?: string }>();
  const lessonId = params.lesson ? Number(params.lesson) : NaN;
  const lemmaIds = useMemo(() => parseIds(params.lemmas), [params.lemmas]);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [deck, setDeck] = useState<LemmaRow[] | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<LemmaRow[]>([]);
  const [unknown, setUnknown] = useState<LemmaRow[]>([]);
  const progress = useRef<Progress>({});
  const answered = useRef(false);

  useEffect(() => {
    (async () => {
      const [loadedSettings, loadedProgress] = await Promise.all([loadSettings(), loadProgress()]);
      progress.current = loadedProgress;
      setSettings(loadedSettings);
      let lemmas: LemmaRow[];
      if (Number.isInteger(lessonId)) {
        const items = await getLessonItems(lessonId);
        lemmas = quizOrder(items, loadedProgress).map((i) => i.lemma!);
      } else {
        lemmas = await getLemmasByIds(lemmaIds);
      }
      setDeck(lemmas);
    })().catch(() => setDeck([]));
  }, [lessonId, lemmaIds]);

  // Pending review/word notifications were picked against the old boxes.
  useEffect(
    () => () => {
      if (answered.current) loadSettings().then(rebuildSchedule).catch(() => {});
    },
    [],
  );

  const onAnswer = useCallback(
    (isKnown: boolean) => {
      const card = deck?.[index];
      if (!card) return;
      answered.current = true;
      progress.current = answer(progress.current, card.id, isKnown);
      saveProgress(progress.current).catch(() => {});
      (isKnown ? setKnown : setUnknown)((list) => [...list, card]);
      setFlipped(false);
      setIndex((i) => i + 1);
    },
    [deck, index],
  );

  const restart = useCallback((cards: LemmaRow[]) => {
    setDeck(cards);
    setIndex(0);
    setFlipped(false);
    setKnown([]);
    setUnknown([]);
  }, []);

  if (!deck || !settings) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  if (deck.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{t('nothingToQuiz')}</Text>
      </View>
    );
  }

  const langs = lessonLanguages(settings);
  const card = deck[index];

  if (!card) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: t('quiz') }} />
        <Text style={styles.summaryTitle}>{t('quizDone')}</Text>
        <Text style={styles.muted}>
          {t('quizSummary', { known: known.length, unknown: unknown.length })}
        </Text>
        <View style={styles.actions}>
          {unknown.length > 0 && (
            <Pressable style={styles.primaryButton} accessibilityRole="button" onPress={() => restart(unknown)}>
              <Text style={styles.primaryButtonText}>{t('repeatUnknown')}</Text>
            </Pressable>
          )}
          <Pressable style={styles.secondaryButton} accessibilityRole="button" onPress={() => router.back()}>
            <Text style={styles.secondaryButtonText}>{t('back')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const size = (n: number) => Math.round(n * settings.textScale);
  const glosses = langs.map((code) => (code === 'en' ? card.gloss_en : card.gloss_bs));
  const primary = glosses[0];

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: `${t('quiz')} · ${index + 1}/${deck.length}` }} />
      <Pressable
        style={styles.card}
        accessibilityRole="button"
        accessibilityLabel={flipped ? primary : displayArabic(card.arabic)}
        onPress={() => setFlipped((f) => !f)}
      >
        <Text style={[styles.arabic, { fontSize: size(56), lineHeight: size(96) }]}>
          {displayArabic(card.arabic)}
        </Text>
        {settings.showTranslit && <Text style={styles.translit}>{card.translit}</Text>}
        {flipped ? (
          <View style={styles.back}>
            {glosses.map((g, i) => (
              <Text key={langs[i]} style={i === 0 ? styles.gloss : styles.glossSecondary}>
                {g}
              </Text>
            ))}
            {card.root && (
              <Text style={styles.meta}>
                {t('root')} {card.root}
              </Text>
            )}
          </View>
        ) : (
          <Text style={styles.hint}>{t('tapToFlip')}</Text>
        )}
      </Pressable>
      {flipped && (
        <View style={styles.answers}>
          <Pressable style={[styles.answer, styles.answerNo]} accessibilityRole="button" onPress={() => onAnswer(false)}>
            <Text style={styles.answerNoText}>{t('dontKnow')}</Text>
          </Pressable>
          <Pressable style={[styles.answer, styles.answerYes]} accessibilityRole="button" onPress={() => onAnswer(true)}>
            <Text style={styles.answerYesText}>{t('know')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background, padding: 20 },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.background,
      padding: 32,
    },
    muted: { color: theme.textMuted, fontSize: 16, textAlign: 'center', marginTop: 8 },
    card: {
      flex: 1,
      backgroundColor: theme.surface,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    arabic: { fontFamily: 'UthmanicHafs', color: theme.text, textAlign: 'center' },
    translit: { fontSize: 17, color: theme.textMuted, marginTop: 4 },
    hint: { fontSize: 13, color: theme.textMuted, marginTop: 28 },
    back: { alignItems: 'center', marginTop: 24 },
    gloss: { fontSize: 24, fontWeight: '600', color: theme.text, textAlign: 'center' },
    glossSecondary: { fontSize: 16, color: theme.textMuted, marginTop: 4, textAlign: 'center' },
    meta: { fontSize: 14, color: theme.textMuted, marginTop: 12 },
    answers: { flexDirection: 'row', gap: 12, marginTop: 16 },
    answer: { flex: 1, borderRadius: 12, alignItems: 'center', paddingVertical: 16 },
    answerNo: { backgroundColor: theme.accentSoft },
    answerNoText: { color: theme.danger, fontSize: 16, fontWeight: '600' },
    answerYes: { backgroundColor: theme.accent },
    answerYesText: { color: theme.onAccent, fontSize: 16, fontWeight: '600' },
    summaryTitle: { fontSize: 22, fontWeight: '700', color: theme.text },
    actions: { marginTop: 28, gap: 10, alignSelf: 'stretch' },
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
  });
}
