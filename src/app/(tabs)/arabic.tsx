import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useT } from '@/lib/i18n';
import { Theme, useTheme } from '@/lib/theme';

/** Placeholder until the lessons land — see the plan in README. */
export default function ArabicScreen() {
  const theme = useTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.center}>
      <Text style={styles.arabic}>تَزْكِيَة</Text>
      <Text style={styles.title}>{t('arabicSoon')}</Text>
      <Text style={styles.hint}>{t('arabicSoonHint')}</Text>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
      backgroundColor: theme.background,
    },
    arabic: { fontFamily: 'UthmanicHafs', fontSize: 44, lineHeight: 80, color: theme.gold },
    title: { fontSize: 17, fontWeight: '600', color: theme.text, textAlign: 'center', marginTop: 8 },
    hint: {
      fontSize: 14,
      lineHeight: 21,
      color: theme.textMuted,
      textAlign: 'center',
      marginTop: 10,
      maxWidth: 320,
    },
  });
}
