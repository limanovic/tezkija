import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { LemmaRow, LessonRow, getAllLemmas, getLessons, getVocabMeta } from '@/lib/db';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { makeListStyles } from '@/lib/ui-styles';
import {
  BOX_DAYS,
  LessonStates,
  Progress,
  boxCounts,
  coveragePercent,
  dueLemmaIds,
  loadVocabState,
} from '@/lib/vocab';

/** A review notification never carries more than this many words; neither does this button. */
const MAX_REVIEW = 30;

type Loaded = {
  lessons: LessonRow[];
  lemmas: LemmaRow[];
  totalTokens: number;
  progress: Progress;
  states: LessonStates;
};

/** Coverage, lessons learned, words due, and the Leitner boxes. */
export default function ProgressScreen() {
  const theme = useTheme();
  const t = useT();
  const styles = useMemo(() => makeListStyles(theme), [theme]);
  const [data, setData] = useState<Loaded | null>(null);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [lessons, lemmas, meta, vocab] = await Promise.all([
          getLessons(),
          getAllLemmas(),
          getVocabMeta(),
          loadVocabState(),
        ]);
        setData({
          lessons,
          lemmas,
          totalTokens: meta.total_tokens,
          progress: vocab.progress,
          states: vocab.states,
        });
      })().catch(() => {});
    }, []),
  );

  if (!data) return <View style={styles.screen} />;

  const { lessons, lemmas, totalTokens, progress, states } = data;
  const coverage = Math.round(coveragePercent(progress, lemmas, totalTokens));
  const done = lessons.filter((l) => states[String(l.id)] === 'done').length;
  const known = new Set(lemmas.map((l) => l.id));
  const due = dueLemmaIds(progress).filter((id) => known.has(id));
  const counts = boxCounts(progress);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('coverage', { p: coverage })}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('lessonsDone', { n: done, total: lessons.length })}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t('kindReview')}</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{due.length > 0 ? t('dueWords', { n: due.length }) : t('noDue')}</Text>
        </View>
        {due.length > 0 && (
          <Pressable
            style={styles.addRow}
            accessibilityRole="button"
            onPress={() =>
              router.push({ pathname: '/quiz', params: { lemmas: due.slice(0, MAX_REVIEW).join(',') } })
            }
          >
            <Text style={styles.addText}>{t('reviewDue')}</Text>
          </Pressable>
        )}
      </View>

      <Text style={styles.sectionTitle}>{t('progressTitle')}</Text>
      <Text style={styles.sectionHint}>{t('boxHint')}</Text>
      <View style={styles.card}>
        {counts.map((n, box) => (
          <View key={box} style={styles.row}>
            <Text style={styles.rowLabel}>{t('boxN', { n: box })}</Text>
            <View style={styles.rowRight}>
              <Text style={styles.rowSub}>{BOX_DAYS[box]} d</Text>
              <Text style={styles.rowValue}>{t('wordsCount', { n })}</Text>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
