import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View, ViewToken } from 'react-native';

import { AyahBlock } from '@/components/ayah-block';
import { loadBookmarks, saveLastPosition, toggleBookmark } from '@/lib/bookmarks';
import {
  GuidanceRow,
  LanguageRow,
  SurahRow,
  TOTAL_GUIDANCE,
  TranslationMap,
  getAllGuidance,
  getLanguages,
  getSurahs,
  getTranslationsByIds,
} from '@/lib/db';
import { useT } from '@/lib/i18n';
import { Settings, loadSettings } from '@/lib/settings';
import { Theme, useTheme } from '@/lib/theme';

type Loaded = {
  rows: GuidanceRow[];
  translations: TranslationMap;
  settings: Settings;
  languages: Map<string, LanguageRow>;
  surahs: Map<number, SurahRow>;
};

/**
 * The whole guidance set as one scroll, grouped under surah headers. 340 rows
 * is small enough to load at once — no paging. `start` is the ordinal to open
 * at; the position last scrolled to is remembered for "Continue reading".
 */
export default function GuidanceScreen() {
  const theme = useTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { start } = useLocalSearchParams<{ start?: string }>();
  const startOrdinal = Math.min(TOTAL_GUIDANCE, Math.max(1, Number(start) || 1));

  const [data, setData] = useState<Loaded | null>(null);
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<number>>(new Set());
  const [title, setTitle] = useState(() => t('guidanceTitle'));
  const list = useRef<FlatList<GuidanceRow>>(null);
  const lastVisible = useRef(startOrdinal);
  const lastSaved = useRef(0);

  useEffect(() => {
    (async () => {
      const [rows, settings, languageRows, surahs, bookmarks] = await Promise.all([
        getAllGuidance(),
        loadSettings(),
        getLanguages(),
        getSurahs(),
        loadBookmarks(),
      ]);
      const translations = await getTranslationsByIds(
        settings.translations,
        rows.map((r) => r.id),
      );
      setBookmarkedIds(new Set(bookmarks.map((b) => b.ayahId)));
      setData({
        rows,
        translations,
        settings,
        languages: new Map(languageRows.map((l) => [l.code, l])),
        surahs,
      });
    })().catch(() => {});
    // Persist the final position when the screen closes.
    return () => {
      saveLastPosition(lastVisible.current).catch(() => {});
    };
  }, []);

  const onToggleBookmark = useCallback((ayahId: number) => {
    toggleBookmark(ayahId)
      .then((next) => setBookmarkedIds(new Set(next.map((b) => b.ayahId))))
      .catch(() => {});
  }, []);

  const surahsRef = useRef<Map<number, SurahRow>>(new Map());
  if (data) surahsRef.current = data.surahs;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<GuidanceRow>[] }) => {
      const first = viewableItems[0]?.item;
      if (!first) return;
      lastVisible.current = first.ordinal;
      const name = surahsRef.current.get(first.surah)?.name_en;
      setTitle((prev) => (name ? `${name} · ${first.surah}:${first.ayah}` : prev));
      // Throttle position writes to one every 2s of scrolling.
      const now = Date.now();
      if (now - lastSaved.current > 2000) {
        lastSaved.current = now;
        saveLastPosition(first.ordinal).catch(() => {});
      }
    },
  );

  if (!data) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: t('guidanceTitle') }} />
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const { rows, translations, settings, languages, surahs } = data;

  return (
    <>
      <Stack.Screen options={{ title }} />
      <FlatList
        ref={list}
        style={styles.list}
        contentContainerStyle={styles.content}
        data={rows}
        keyExtractor={(row) => String(row.ordinal)}
        initialScrollIndex={startOrdinal - 1}
        initialNumToRender={12}
        // Rows are variable-height so there is no getItemLayout; when the
        // initial index is past what has rendered, wait and retry once.
        onScrollToIndexFailed={({ index }) => {
          setTimeout(() => list.current?.scrollToIndex({ index, animated: false }), 100);
        }}
        renderItem={({ item, index }) => {
          const prev = rows[index - 1];
          const newSurah = !prev || prev.surah !== item.surah;
          return (
            <AyahBlock
              row={item}
              surahHeader={newSurah ? surahs.get(item.surah) : undefined}
              badge={item.to_prophet ? t('toProphet') : undefined}
              settings={settings}
              translations={translations}
              languages={languages}
              bookmarked={bookmarkedIds.has(item.id)}
              onToggleBookmark={onToggleBookmark}
            />
          );
        }}
        onViewableItemsChanged={onViewableItemsChanged.current}
        viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
        showsVerticalScrollIndicator={false}
      />
    </>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    list: { flex: 1, backgroundColor: theme.background },
    content: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 64 },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.background,
    },
  });
}
