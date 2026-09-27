import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, CellRendererProps, FlatList, StyleSheet, View, ViewToken } from 'react-native';

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
import { rebuildSchedule } from '@/lib/notifications';
import { Settings, loadSettings } from '@/lib/settings';
import { Theme, useTheme } from '@/lib/theme';
import { loadDone, toggleDone } from '@/lib/wird';

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
  const [done, setDone] = useState<Set<number>>(new Set());
  const [title, setTitle] = useState(() => t('guidanceTitle'));
  const list = useRef<FlatList<GuidanceRow>>(null);
  const lastVisible = useRef(startOrdinal);
  const lastSaved = useRef(0);
  // Rows are variable-height, and FlatList cannot scroll to a row it has not
  // measured — with rows above the target unmeasured it lands at the top of
  // the list. So no scrolling at all: the list opens holding only the rows
  // from the start ayah on, and the rows before it arrive in chunks as the
  // reader scrolls up, maintainVisibleContentPosition holding the view still
  // while they are inserted above. Opens instantly at any position.
  // A chunk small enough to render in one batch (maxToRenderPerBatch below):
  // rows rendered in the same transaction as the insert are measured with
  // it, so the native position-hold sees the whole shift at once and there
  // is no second re-layout to drift on.
  const EARLIER_CHUNK = 8;
  const [from, setFrom] = useState(startOrdinal);

  // maintainVisibleContentPosition holds the view through an insert. Two
  // things it cannot do are handled here from the positions every row
  // reports on layout: when the content is still too short at the moment of
  // the insert the native scroll gets clamped, so once the content has grown
  // the first visible row (the anchor) is put back where it was; and while
  // an insert settles, viewability may briefly report whatever row is on top
  // mid-shuffle, so the anchor's identity, the title and the remembered
  // position are frozen until the hold has landed or the reader touches the
  // list.
  const cellY = useRef(new Map<string, number>());
  const scrollY = useRef(0);
  const anchor = useRef<{ key: string; screenY: number } | null>(null);
  const inserting = useRef(false);
  const scrolledSinceInsert = useRef(false);
  const insertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The row viewability last reported, applied to the title and remembered
  // position — deferred while an insert settles, since mid-shuffle reports
  // are not real positions.
  const lastFirst = useRef<GuidanceRow | null>(null);
  const applyFirst = useRef<(row: GuidanceRow) => void>(() => {});
  const settle = useCallback(() => {
    inserting.current = false;
    if (insertTimer.current) clearTimeout(insertTimer.current);
    insertTimer.current = null;
    if (lastFirst.current) applyFirst.current(lastFirst.current);
  }, []);
  // One insert at a time: the next only once this one has settled.
  const loadEarlier = useCallback(() => {
    if (inserting.current) return;
    inserting.current = true;
    scrolledSinceInsert.current = false;
    insertTimer.current = setTimeout(settle, 2000); // never stay stuck
    setFrom((f) => Math.max(1, f - EARLIER_CHUNK));
  }, [settle]);
  const expectedOffset = useCallback(() => {
    const a = anchor.current;
    const y = a ? cellY.current.get(a.key) : undefined;
    return a && y !== undefined ? y - a.screenY : null;
  }, []);
  const hold = useCallback(() => {
    const expected = expectedOffset();
    if (expected === null || Math.abs(expected - scrollY.current) < 1) return;
    scrollY.current = expected;
    list.current?.scrollToOffset({ offset: expected, animated: false });
  }, [expectedOffset]);
  const onCellLayout = useCallback(
    (key: string, y: number) => {
      cellY.current.set(key, y);
      // The start ayah is the anchor from its first layout on — before the
      // first viewability report, which the first insert can beat.
      if (!anchor.current && key === String(startOrdinal)) {
        anchor.current = { key, screenY: y - scrollY.current };
      }
    },
    [startOrdinal],
  );
  const Cell = useMemo(() => makeCell(onCellLayout), [onCellLayout]);
  const setAnchor = useCallback((key: string) => {
    if (inserting.current && anchor.current) return; // identity frozen
    const y = cellY.current.get(key);
    if (y !== undefined) anchor.current = { key, screenY: y - scrollY.current };
  }, []);
  const onScroll = useCallback(
    (y: number) => {
      scrollY.current = y;
      if (inserting.current) {
        scrolledSinceInsert.current = true;
        const expected = expectedOffset();
        if (expected !== null && Math.abs(expected - y) <= 2) settle(); // landed
        return;
      }
      const a = anchor.current;
      const ay = a ? cellY.current.get(a.key) : undefined;
      if (a && ay !== undefined) a.screenY = ay - y;
    },
    [settle, expectedOffset],
  );
  // Content grew: if the native hold's scroll was clamped, apply it again —
  // but only once its scroll event is in, or the two would add up.
  const onContentSizeChange = useCallback(() => {
    if (inserting.current && !scrolledSinceInsert.current) return;
    hold();
  }, [hold]);

  useEffect(() => {
    (async () => {
      const [rows, settings, languageRows, surahs, bookmarks, ticked] = await Promise.all([
        getAllGuidance(),
        loadSettings(),
        getLanguages(),
        getSurahs(),
        loadBookmarks(),
        loadDone(),
      ]);
      setDone(ticked);
      const translations = await getTranslationsByIds(
        settings.translations,
        rows.map((r) => r.id),
      );
      setBookmarkedIds(new Set(bookmarks.map((b) => b.ayahId)));
      const startRow = rows[startOrdinal - 1];
      const startName = startRow && surahs.get(startRow.surah)?.name_en;
      if (startRow && startName) setTitle(`${startName} · ${startRow.surah}:${startRow.ayah}`);
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
  }, [startOrdinal]);

  const onToggleBookmark = useCallback((ayahId: number) => {
    toggleBookmark(ayahId)
      .then((next) => setBookmarkedIds(new Set(next.map((b) => b.ayahId))))
      .catch(() => {});
  }, []);

  // A tick or untick may move the cursor; pending in-order reminders hold the old ayah.
  const onToggleDone = useCallback((ordinal: number) => {
    (async () => {
      const result = await toggleDone(ordinal);
      setDone(result.done);
      await rebuildSchedule(await loadSettings());
    })().catch(() => {});
  }, []);

  const surahsRef = useRef<Map<number, SurahRow>>(new Map());
  if (data) surahsRef.current = data.surahs;
  const setAnchorRef = useRef(setAnchor);
  setAnchorRef.current = setAnchor;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<GuidanceRow>[] }) => {
      const first = viewableItems[0]?.item;
      if (!first) return;
      setAnchorRef.current(String(first.ordinal));
      lastFirst.current = first;
      if (!inserting.current) applyFirst.current(first);
    },
  );
  applyFirst.current = (first: GuidanceRow) => {
    lastVisible.current = first.ordinal;
    const name = surahsRef.current.get(first.surah)?.name_en;
    setTitle((prev) => (name ? `${name} · ${first.surah}:${first.ayah}` : prev));
    // Throttle position writes to one every 2s of scrolling.
    const now = Date.now();
    if (now - lastSaved.current > 2000) {
      lastSaved.current = now;
      saveLastPosition(first.ordinal).catch(() => {});
    }
  };

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
        data={from > 1 ? rows.slice(from - 1) : rows}
        keyExtractor={(row) => String(row.ordinal)}
        initialNumToRender={8}
        CellRendererComponent={Cell}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        maxToRenderPerBatch={16}
        onStartReached={from > 1 ? loadEarlier : undefined}
        onStartReachedThreshold={1}
        onScroll={(e) => onScroll(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        onScrollBeginDrag={settle}
        onContentSizeChange={onContentSizeChange}
        renderItem={({ item }) => {
          const prev = rows[item.ordinal - 2];
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
              done={done.has(item.ordinal)}
              onToggleDone={() => onToggleDone(item.ordinal)}
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

/** A real native view per row, reporting its position to the anchor hold. */
function makeCell(onCellLayout: (key: string, y: number) => void) {
  return function Cell({ children, cellKey, onLayout, style }: CellRendererProps<GuidanceRow>) {
    return (
      <View
        style={style}
        collapsable={false}
        onLayout={(e) => {
          onCellLayout(cellKey, e.nativeEvent.layout.y);
          onLayout?.(e);
        }}
      >
        {children}
      </View>
    );
  };
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    list: { flex: 1, backgroundColor: theme.background },
    content: { paddingHorizontal: 24, paddingBottom: 64 },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.background,
    },
  });
}
