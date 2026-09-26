import { Tabs, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { StepButton } from '@/components/step-button';
import { TimePicker, TimePickerEvent } from '@/components/time-picker';
import { LemmaRow, LessonRow, getAllLemmas, getLessonWordCounts, getLessons, getVocabMeta } from '@/lib/db';
import { UiStringKey, currentUiLanguage, useT } from '@/lib/i18n';
import { getPermissionGranted, rebuildSchedule, requestPermission } from '@/lib/notifications';
import {
  ArabicDelivery,
  ArabicDeliveryKind,
  COUNT_BOUNDS,
  Settings,
  loadSettings,
  saveSettings,
} from '@/lib/settings';
import { useSyncVersion } from '@/lib/sync';
import { Theme, useTheme } from '@/lib/theme';
import { makeListStyles } from '@/lib/ui-styles';
import { LessonStates, Progress, coveragePercent, lessonState, loadVocabState } from '@/lib/vocab';

/** Section heading for each lesson phase. */
const PHASE_KEYS: Record<number, UiStringKey> = {
  0: 'phaseGlue',
  1: 'phaseParticles',
  2: 'phaseWords',
  3: 'phaseWords2',
  4: 'phaseGrammar',
};

const KINDS: ArabicDeliveryKind[] = ['lesson', 'review', 'word'];
const KIND_KEYS: Record<ArabicDeliveryKind, UiStringKey> = {
  lesson: 'kindLesson',
  review: 'kindReview',
  word: 'kindWord',
};
const KIND_HINT_KEYS: Record<ArabicDeliveryKind, UiStringKey> = {
  lesson: 'kindLessonHint',
  review: 'kindReviewHint',
  word: 'kindWordHint',
};

function lessonTitle(lesson: LessonRow): string {
  return currentUiLanguage() === 'en' ? lesson.title_en : lesson.title_bs;
}

type Loaded = {
  lessons: LessonRow[];
  lemmas: LemmaRow[];
  totalTokens: number;
  wordCounts: Map<number, number>;
};

/** Arapski home: deliveries, the current lesson, progress, and every lesson by phase. */
export default function ArabicHomeScreen() {
  const theme = useTheme();
  const syncVersion = useSyncVersion();
  const t = useT();
  const styles = useMemo(() => makeListStyles(theme), [theme]);
  const local = useMemo(() => makeStyles(theme), [theme]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [granted, setGranted] = useState<boolean | null>(null);
  const [picker, setPicker] = useState<'add' | 'edit' | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [progress, setProgress] = useState<Progress>({});
  const [cursor, setCursor] = useState(1);
  const [states, setStates] = useState<LessonStates>({});

  useEffect(() => {
    getPermissionGranted().then(setGranted);
  }, []);

  // Static content once; user state on every focus, since lessons and quizzes
  // change it while other screens are open.
  useEffect(() => {
    (async () => {
      const [lessons, lemmas, meta, counts] = await Promise.all([
        getLessons(),
        getAllLemmas(),
        getVocabMeta(),
        getLessonWordCounts(),
      ]);
      setData({ lessons, lemmas, totalTokens: meta.total_tokens, wordCounts: counts });
    })().catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [loaded, vocab] = await Promise.all([loadSettings(), loadVocabState()]);
        setSettings(loaded);
        setProgress(vocab.progress);
        setCursor(vocab.cursor);
        setStates(vocab.states);
      })().catch(() => {});
      // An account sync that pulled new state re-runs this; nothing else changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [syncVersion]),
  );

  /** Persist a settings change and rebuild the notification window with it. */
  const apply = useCallback((next: Settings) => {
    setSettings(next);
    (async () => {
      const normalized = await saveSettings(next);
      await rebuildSchedule(normalized);
    })().catch(() => {});
  }, []);

  const onEnableNotifications = useCallback(async () => {
    const ok = await requestPermission();
    setGranted(ok);
    if (!ok) {
      Linking.openSettings();
      return;
    }
    if (settings) apply(settings);
  }, [settings, apply]);

  const onTimePicked = useCallback(
    async (event: TimePickerEvent, date?: Date) => {
      const mode = picker;
      setPicker(null);
      if (event.type !== 'set' || !date || !settings) return;
      const hh = String(date.getHours()).padStart(2, '0');
      const mm = String(date.getMinutes()).padStart(2, '0');
      const time = `${hh}:${mm}`;
      if (settings.arabicDeliveries.some((d) => d.time === time)) {
        setEditing(time);
        return;
      }
      const last = settings.arabicDeliveries[settings.arabicDeliveries.length - 1];
      const arabicDeliveries =
        mode === 'add'
          ? [...settings.arabicDeliveries, { ...(last ?? { kind: 'lesson', count: 5 }), time }]
          : settings.arabicDeliveries.map((d) => (d.time === editing ? { ...d, time } : d));
      arabicDeliveries.sort((a, b) => a.time.localeCompare(b.time));
      apply({ ...settings, arabicDeliveries });
      setEditing(time);
    },
    [picker, editing, settings, apply],
  );

  const header = (
    <Tabs.Screen
      options={{
        title: t('tabArabic'),
        headerRight: () => (
          <Pressable
            style={styles.headerButton}
            accessibilityLabel={t('settings')}
            accessibilityRole="button"
            onPress={() => router.push('/settings')}
          >
            <Text style={styles.headerButtonText}>⚙</Text>
          </Pressable>
        ),
      }}
    />
  );

  if (!settings || !data) return <View style={styles.screen}>{header}</View>;

  const edited = settings.arabicDeliveries.find((d) => d.time === editing) ?? null;
  const updateDelivery = (time: string, patch: Partial<ArabicDelivery>) => {
    const arabicDeliveries = settings.arabicDeliveries.map((d) =>
      d.time === time ? { ...d, ...patch } : d,
    );
    apply({ ...settings, arabicDeliveries });
  };
  const amountLabel = (d: ArabicDelivery) =>
    d.kind === 'lesson'
      ? t(KIND_KEYS[d.kind])
      : `${t(KIND_KEYS[d.kind])} · ${t('wordsCount', { n: d.count })}`;
  const pickerValue = (time: string | null) => {
    const [hh, mm] = time ? time.split(':').map(Number) : [9, 0];
    return new Date(2000, 0, 1, hh, mm);
  };

  const current = data.lessons.find((l) => l.id === cursor) ?? data.lessons[0];
  const coverage = Math.round(coveragePercent(progress, data.lemmas, data.totalTokens));
  const phases = [...new Set(data.lessons.map((l) => l.phase))].sort((a, b) => a - b);
  const statusKey = (id: number): UiStringKey => {
    const s = lessonState(states, id);
    return s === 'done' ? 'statusDone' : s === 'learning' ? 'statusLearning' : 'statusNew';
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {header}
      {granted === false && settings.arabicDeliveries.length > 0 && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{t('notifOff')}</Text>
          <Pressable style={styles.bannerButton} onPress={onEnableNotifications}>
            <Text style={styles.bannerButtonText}>{t('enableNotifs')}</Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.sectionTitle}>{t('arabicWird')}</Text>
      <Text style={styles.sectionHint}>{t('arabicWirdHint')}</Text>
      <View style={styles.card}>
        {settings.arabicDeliveries.length === 0 && (
          <View style={styles.row}>
            <Text style={styles.rowValue}>{t('noTimes')}</Text>
          </View>
        )}
        {settings.arabicDeliveries.map((delivery) => (
          <Pressable
            key={delivery.time}
            style={styles.row}
            accessibilityRole="button"
            accessibilityLabel={`${delivery.time}, ${amountLabel(delivery)}`}
            onPress={() => setEditing(delivery.time)}
          >
            <Text style={styles.timeText}>{delivery.time}</Text>
            <View style={styles.rowRight}>
              <Text style={styles.rowValue}>{amountLabel(delivery)}</Text>
              <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">
                ›
              </Text>
            </View>
          </Pressable>
        ))}
        <Pressable style={styles.addRow} accessibilityRole="button" onPress={() => setPicker('add')}>
          <Text style={styles.addText}>+ {t('addTime')}</Text>
        </Pressable>
        {picker === 'add' && (
          <TimePicker value={pickerValue(null)} onChange={onTimePicked} />
        )}
      </View>

      <Text style={styles.sectionTitle}>{t('todaysLesson')}</Text>
      <Text style={styles.sectionHint}>{t('arabicIntro')}</Text>
      {current && (
        <Pressable
          style={styles.continueCard}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/lesson', params: { id: String(current.id) } })}
        >
          <View style={local.cardText}>
            <Text style={styles.continueLabel}>
              {t('lessonN', { n: current.ordinal })} · {lessonTitle(current)}
            </Text>
            <Text style={styles.continueSub}>
              {t(PHASE_KEYS[current.phase] ?? 'phaseWords')}
              {(data.wordCounts.get(current.id) ?? 0) > 0 &&
                ` · ${t('wordsCount', { n: data.wordCounts.get(current.id) ?? 0 })}`}
              {' · '}
              {t('open')}
            </Text>
          </View>
          <Text style={[styles.chevron, styles.chevronOnAccent]} accessibilityElementsHidden importantForAccessibility="no">
            ›
          </Text>
        </Pressable>
      )}
      <View style={styles.card}>
        <Pressable style={styles.row} accessibilityRole="button" onPress={() => router.push('/progress')}>
          <View style={local.cardText}>
            <Text style={styles.rowLabel}>{t('progressTitle')}</Text>
            <Text style={styles.rowSub}>{t('coverage', { p: coverage })}</Text>
          </View>
          <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">
            ›
          </Text>
        </Pressable>
      </View>

      {phases.map((phase) => (
        <View key={phase}>
          <Text style={styles.sectionTitle}>{t(PHASE_KEYS[phase] ?? 'phaseWords')}</Text>
          <View style={styles.card}>
            {data.lessons
              .filter((l) => l.phase === phase)
              .map((lesson) => {
                const state = lessonState(states, lesson.id);
                return (
                  <Pressable
                    key={lesson.id}
                    style={styles.row}
                    accessibilityRole="button"
                    onPress={() =>
                      router.push({ pathname: '/lesson', params: { id: String(lesson.id) } })
                    }
                  >
                    <View style={local.cardText}>
                      <Text style={styles.rowLabel}>
                        {lesson.ordinal}. {lessonTitle(lesson)}
                      </Text>
                      <Text style={styles.rowSub}>
                        {t(statusKey(lesson.id))}
                        {lesson.id === cursor && ` · ${t('cursorHere')}`}
                      </Text>
                    </View>
                    <View style={styles.rowRight}>
                      <View
                        style={[
                          local.dot,
                          state === 'done' && local.dotDone,
                          state === 'learning' && local.dotLearning,
                        ]}
                      />
                      <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">
                        ›
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
          </View>
        </View>
      ))}

      <Modal
        visible={edited !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setEditing(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setEditing(null)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            {edited && (
              <>
                <Text style={styles.modalTitle}>{t('delivery')}</Text>
                <Pressable style={styles.row} accessibilityRole="button" onPress={() => setPicker('edit')}>
                  <Text style={styles.rowLabel}>{t('time')}</Text>
                  <View style={styles.rowRight}>
                    <Text style={styles.timeText}>{edited.time}</Text>
                    <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">
                      ›
                    </Text>
                  </View>
                </Pressable>
                {picker === 'edit' && (
                  <TimePicker value={pickerValue(edited.time)} onChange={onTimePicked} />
                )}
                <View style={styles.segmented}>
                  {KINDS.map((kind) => (
                    <Pressable
                      key={kind}
                      style={[styles.segment, edited.kind === kind && styles.segmentActive]}
                      onPress={() => edited.kind !== kind && updateDelivery(edited.time, { kind })}
                    >
                      <Text style={[styles.segmentText, edited.kind === kind && styles.segmentTextActive]}>
                        {t(KIND_KEYS[kind])}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.hint}>{t(KIND_HINT_KEYS[edited.kind])}</Text>
                {edited.kind !== 'lesson' && (
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>{t('amount')}</Text>
                    <View style={styles.stepper}>
                      <StepButton
                        label={t('decrease')}
                        glyph="−"
                        disabled={edited.count <= COUNT_BOUNDS.min}
                        style={[styles.stepButton, edited.count <= COUNT_BOUNDS.min && styles.stepButtonDisabled]}
                        textStyle={styles.stepButtonText}
                        onStep={() =>
                          edited.count > COUNT_BOUNDS.min &&
                          updateDelivery(edited.time, { count: edited.count - 1 })
                        }
                      />
                      <Text style={styles.stepValue}>{edited.count}</Text>
                      <StepButton
                        label={t('increase')}
                        glyph="+"
                        disabled={edited.count >= COUNT_BOUNDS.max}
                        style={[styles.stepButton, edited.count >= COUNT_BOUNDS.max && styles.stepButtonDisabled]}
                        textStyle={styles.stepButtonText}
                        onStep={() =>
                          edited.count < COUNT_BOUNDS.max &&
                          updateDelivery(edited.time, { count: edited.count + 1 })
                        }
                      />
                    </View>
                  </View>
                )}
                <Pressable
                  style={[styles.row, styles.removeRow]}
                  accessibilityRole="button"
                  onPress={() => {
                    setEditing(null);
                    apply({
                      ...settings,
                      arabicDeliveries: settings.arabicDeliveries.filter((d) => d.time !== edited.time),
                    });
                  }}
                >
                  <Text style={styles.removeText}>{t('remove')}</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    cardText: { flex: 1, paddingRight: 8 },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      backgroundColor: theme.background,
    },
    dotLearning: { backgroundColor: theme.gold, borderColor: theme.gold },
    dotDone: { backgroundColor: theme.accent, borderColor: theme.accent },
  });
}
