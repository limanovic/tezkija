import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AyahBlock } from '@/components/ayah-block';
import {
  GuidanceRow,
  LanguageRow,
  SurahRow,
  TranslationMap,
  getLanguages,
  getSurahs,
  getTranslationsByIds,
} from '@/lib/db';
import { useT } from '@/lib/i18n';
import { formatReference, parsePassageKey, resolvePassage } from '@/lib/passage';
import { Settings, loadSettings } from '@/lib/settings';
import { Theme, useTheme } from '@/lib/theme';

type LoadedPassage = {
  rows: GuidanceRow[];
  reference: string;
  surahs: Map<number, SurahRow>;
  settings: Settings;
  translations: TranslationMap;
  languages: Map<string, LanguageRow>;
};

/** Exactly the passage a notification delivered (or a preview of the next one). */
export default function ReaderScreen() {
  const theme = useTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { key: rawKey } = useLocalSearchParams<{ key: string }>();
  const [passage, setPassage] = useState<LoadedPassage | null>(null);
  const [error, setError] = useState(false);

  const key = useMemo(() => (rawKey ? parsePassageKey(rawKey) : null), [rawKey]);

  useEffect(() => {
    if (!key) return;
    (async () => {
      const [rows, surahs, settings, languageRows] = await Promise.all([
        resolvePassage(key),
        getSurahs(),
        loadSettings(),
        getLanguages(),
      ]);
      const translations = await getTranslationsByIds(
        settings.translations,
        rows.map((r) => r.id),
      );
      const reference = await formatReference(rows);
      const languages = new Map(languageRows.map((l) => [l.code, l]));
      setPassage({ rows, reference, surahs, settings, translations, languages });
    })().catch(() => setError(true));
  }, [key]);

  if (!key || error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ? t('loadError') : t('badRef')}</Text>
      </View>
    );
  }
  if (!passage) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const { rows, reference, surahs, settings, translations, languages } = passage;

  return (
    <>
      <Stack.Screen options={{ title: reference }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {rows.map((row, i) => {
          const newSurah = i === 0 || rows[i - 1].surah !== row.surah;
          return (
            <AyahBlock
              key={row.id}
              row={row}
              surahHeader={newSurah ? surahs.get(row.surah) : undefined}
              badge={row.to_prophet ? t('toProphet') : undefined}
              settings={settings}
              translations={translations}
              languages={languages}
            />
          );
        })}

        {rows.length > 0 && (
          <View style={styles.actions}>
            <Pressable
              style={styles.primaryButton}
              onPress={() =>
                router.push({
                  pathname: '/guidance',
                  params: { start: String(rows[0].ordinal) },
                })
              }
            >
              <Text style={styles.primaryButtonText}>{t('continueAyah')}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    scroll: { flex: 1, backgroundColor: theme.background },
    content: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 64 },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.background,
    },
    errorText: { color: theme.textMuted, fontSize: 16, textAlign: 'center', padding: 32 },
    actions: { marginTop: 36, gap: 10 },
    primaryButton: {
      backgroundColor: theme.accent,
      borderRadius: 12,
      alignItems: 'center',
      paddingVertical: 15,
    },
    primaryButtonText: { color: theme.onAccent, fontSize: 16, fontWeight: '600' },
  });
}
