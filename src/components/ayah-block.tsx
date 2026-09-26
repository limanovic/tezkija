import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AyahRow, LanguageRow, SurahRow, TranslationMap } from '@/lib/db';
import { useT } from '@/lib/i18n';
import { displayArabic } from '@/lib/mushaf';
import { Settings } from '@/lib/settings';
import { Theme, useTheme } from '@/lib/theme';

type Props = {
  row: AyahRow;
  /** When set, a surah header is rendered above the ayah. */
  surahHeader?: SurahRow;
  /** Short label shown beside the reference — "To the Prophet". */
  badge?: string;
  settings: Settings;
  translations: TranslationMap;
  languages: Map<string, LanguageRow>;
  bookmarked?: boolean;
  /** When provided, a bookmark toggle appears next to the reference chip. */
  onToggleBookmark?: (ayahId: number) => void;
  /** Ticked as practised — the in-order reading moves past it. */
  done?: boolean;
  /** When provided, a practised toggle appears next to the reference chip. */
  onToggleDone?: (ayahId: number) => void;
  /**
   * 1-based index of the token to draw in the accent colour — the word a
   * vocabulary example is about. Indexes `row.arabic.split(' ')`, so pause
   * marks count as tokens too (the build script never points at one).
   */
  highlightWord?: number;
};

function AyahBlockInner({
  row,
  surahHeader,
  badge,
  settings,
  translations,
  languages,
  bookmarked,
  onToggleBookmark,
  done,
  onToggleDone,
  highlightWord,
}: Props) {
  const theme = useTheme();
  const t = useT();
  const styles = useMemo(
    () => makeStyles(theme, settings.textScale),
    [theme, settings.textScale],
  );

  return (
    <View>
      {surahHeader && (
        <View style={styles.surahHeader}>
          <Text style={styles.surahArabic}>{surahHeader.name_ar}</Text>
          <Text style={styles.surahName}>
            {surahHeader.name_en} · {surahHeader.name_meaning_en}
          </Text>
          <Text style={styles.surahMeta}>
            {surahHeader.revelation === 'Meccan' ? t('meccan') : t('medinan')} · {t('juz')}{' '}
            {row.juz}
          </Text>
        </View>
      )}
      <View style={styles.ayahBlock}>
        <View style={styles.chipRow}>
          <View style={styles.chips}>
            <View style={[styles.refChip, bookmarked && styles.refChipBookmarked]}>
              <Text style={[styles.refChipText, bookmarked && styles.refChipTextBookmarked]}>
                {row.surah}:{row.ayah}
              </Text>
            </View>
            {badge && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{badge}</Text>
              </View>
            )}
          </View>
          <View style={styles.chips}>
            {onToggleDone && (
              <Pressable
                hitSlop={10}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !!done }}
                onPress={() => onToggleDone(row.id)}
              >
                <Text style={[styles.bookmarkText, done && styles.doneTextActive]}>
                  {done ? `☑ ${t('practised')}` : `☐ ${t('practised')}`}
                </Text>
              </Pressable>
            )}
            {onToggleBookmark && (
              <Pressable hitSlop={10} onPress={() => onToggleBookmark(row.id)}>
                <Text style={[styles.bookmarkText, bookmarked && styles.bookmarkTextActive]}>
                  {bookmarked ? `★ ${t('bookmarked')}` : `☆ ${t('bookmark')}`}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
        {settings.showArabic && (
          <Text style={styles.arabic}>
            {highlightWord === undefined
              ? displayArabic(row.arabic)
              : displayArabic(row.arabic)
                  .split(' ')
                  .map((token, i) => (
                    <Text key={i} style={i + 1 === highlightWord ? styles.highlight : undefined}>
                      {i > 0 ? ' ' : ''}
                      {token}
                    </Text>
                  ))}{' '}
            {ayahMark(row.ayah)}
          </Text>
        )}
        {settings.translations.map((code) => {
          const text = translations[code]?.[row.id];
          if (!text) return null;
          const lang = languages.get(code);
          return (
            <View key={code} style={styles.translation}>
              <Text style={styles.translationLabel}>{lang?.native_name ?? code}</Text>
              <Text style={[styles.translationText, lang?.rtl === 1 && styles.rtlText]}>
                {text}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export const AyahBlock = memo(AyahBlockInner);

const ARABIC_INDIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/**
 * End-of-ayah marker as the mushaf prints it. The number is just Arabic-Indic
 * digits: Uthmanic Hafs composes them into the roundel itself, so prefixing
 * U+06DD (END OF AYAH) draws a second, empty one beside it.
 *
 * Only rendered alongside the Arabic — it belongs to that line.
 */
function ayahMark(ayah: number): string {
  return String(ayah)
    .split('')
    .map((d) => ARABIC_INDIC[Number(d)])
    .join('');
}

/**
 * Only the scripture itself scales — chips, labels and the surah header stay
 * put so the layout doesn't drift with the setting.
 */
function makeStyles(theme: Theme, scale: number) {
  const size = (n: number) => Math.round(n * scale);
  return StyleSheet.create({
    surahHeader: {
      alignItems: 'center',
      marginTop: 24,
      marginBottom: 8,
      paddingBottom: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    surahArabic: {
      fontFamily: 'UthmanicHafs',
      fontSize: 30,
      lineHeight: 52,
      color: theme.gold,
    },
    surahName: { fontSize: 15, fontWeight: '600', color: theme.text, marginTop: 2 },
    surahMeta: { fontSize: 13, color: theme.textMuted, marginTop: 3 },
    ayahBlock: { marginTop: 24 },
    chipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    chips: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    badge: {
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.gold,
    },
    badgeText: { color: theme.gold, fontSize: 12, fontWeight: '600' },
    refChip: {
      backgroundColor: theme.accentSoft,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    refChipBookmarked: { backgroundColor: theme.accent },
    refChipText: { color: theme.accent, fontSize: 13, fontWeight: '600' },
    refChipTextBookmarked: { color: theme.onAccent },
    bookmarkText: { color: theme.textMuted, fontSize: 13, fontWeight: '500' },
    bookmarkTextActive: { color: theme.gold },
    doneTextActive: { color: theme.accent },
    arabic: {
      fontFamily: 'UthmanicHafs',
      fontSize: size(28),
      lineHeight: size(56),
      color: theme.text,
      textAlign: 'right',
      writingDirection: 'rtl',
    },
    highlight: { color: theme.accent },
    translation: { marginTop: 12 },
    translationLabel: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: theme.textMuted,
      marginBottom: 4,
    },
    translationText: { fontSize: size(16), lineHeight: size(25), color: theme.text },
    rtlText: { textAlign: 'right', writingDirection: 'rtl' },
  });
}
