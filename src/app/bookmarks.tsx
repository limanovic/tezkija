import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Bookmark, loadBookmarks, removeBookmark } from '@/lib/bookmarks';
import { GuidanceRow, SurahRow, getGuidanceByAyahIds, getSurahs } from '@/lib/db';
import { useT } from '@/lib/i18n';
import { displayArabic } from '@/lib/mushaf';
import { Theme, useTheme } from '@/lib/theme';

type Item = Bookmark & { row?: GuidanceRow; surah?: SurahRow };

export default function BookmarksScreen() {
  const theme = useTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [items, setItems] = useState<Item[] | null>(null);

  const reload = useCallback(() => {
    (async () => {
      const bookmarks = await loadBookmarks();
      const [rows, surahs] = await Promise.all([
        getGuidanceByAyahIds(bookmarks.map((b) => b.ayahId)),
        getSurahs(),
      ]);
      const byId = new Map(rows.map((r) => [r.id, r]));
      setItems(
        bookmarks.map((b) => {
          const row = byId.get(b.ayahId);
          return { ...b, row, surah: row ? surahs.get(row.surah) : undefined };
        }),
      );
    })().catch(() => setItems([]));
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const onRemove = (ayahId: number) => {
    removeBookmark(ayahId).catch(() => {});
    setItems((prev) => (prev ? prev.filter((i) => i.ayahId !== ayahId) : prev));
  };

  if (items && items.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>{t('noBookmarks')}</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={items ?? []}
      keyExtractor={(item) => String(item.ayahId)}
      renderItem={({ item }) => (
        <Pressable
          style={styles.row}
          disabled={!item.row}
          onPress={() =>
            item.row &&
            router.push({ pathname: '/guidance', params: { start: String(item.row.ordinal) } })
          }
        >
          <View style={styles.rowMain}>
            <Text style={styles.reference}>
              {item.row && item.surah
                ? `${item.surah.name_en} ${item.row.surah}:${item.row.ayah}`
                : t('ayahN', { n: item.ayahId })}
            </Text>
            {item.row && (
              <Text style={styles.snippet} numberOfLines={1}>
                {displayArabic(item.row.arabic)}
              </Text>
            )}
            <Text style={styles.date}>{new Date(item.createdAt).toLocaleDateString()}</Text>
          </View>
          <Pressable hitSlop={10} onPress={() => onRemove(item.ayahId)}>
            <Text style={styles.removeText}>{t('remove')}</Text>
          </Pressable>
        </Pressable>
      )}
    />
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    list: { flex: 1, backgroundColor: theme.background },
    content: { paddingHorizontal: 20, paddingVertical: 8 },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.background,
    },
    emptyText: { color: theme.textMuted, fontSize: 15, textAlign: 'center', padding: 40, lineHeight: 22 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    rowMain: { flex: 1, marginRight: 12 },
    reference: { fontSize: 16, fontWeight: '600', color: theme.text },
    snippet: {
      fontFamily: 'UthmanicHafs',
      fontSize: 16,
      color: theme.textMuted,
      marginTop: 2,
      textAlign: 'left',
    },
    date: { fontSize: 12, color: theme.textMuted, marginTop: 2 },
    removeText: { color: theme.danger, fontSize: 14, fontWeight: '500' },
  });
}
