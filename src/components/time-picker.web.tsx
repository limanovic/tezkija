import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { unstable_createElement as createElement } from 'react-native-web';

import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

import type { TimePickerProps } from './time-picker';

export type { TimePickerEvent, TimePickerProps } from './time-picker';

/**
 * Web: the community picker has no web build, so a native <input type="time">
 * (the phone shows its own wheel) with an explicit confirm — a change event
 * fires on every keystroke on desktop, which is not "the user picked a time".
 */
export function TimePicker({ value, onChange }: TimePickerProps) {
  const theme = useTheme();
  const t = useT();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [text, setText] = useState(
    `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`,
  );

  const confirm = () => {
    const m = /^(\d{2}):(\d{2})$/.exec(text);
    if (!m) {
      onChange({ type: 'dismissed' });
      return;
    }
    const date = new Date(value);
    date.setHours(Number(m[1]), Number(m[2]), 0, 0);
    onChange({ type: 'set' }, date);
  };

  return (
    <View style={styles.row}>
      {createElement('input', {
        type: 'time',
        value: text,
        step: 60,
        autoFocus: true,
        onChange: (e: { target: { value: string } }) => setText(e.target.value),
        onKeyDown: (e: { key: string }) => {
          if (e.key === 'Enter') confirm();
        },
        style: styles.input,
      })}
      <Pressable style={styles.button} accessibilityRole="button" onPress={confirm}>
        <Text style={styles.buttonText}>{t('ok')}</Text>
      </Pressable>
      <Pressable
        style={styles.link}
        accessibilityRole="button"
        onPress={() => onChange({ type: 'dismissed' })}
      >
        <Text style={styles.linkText}>{t('cancel')}</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
    input: {
      fontSize: 18,
      padding: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: theme.border,
      backgroundColor: theme.background,
      color: theme.text,
      fontFamily: 'inherit',
    },
    button: {
      backgroundColor: theme.accent,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    buttonText: { color: theme.onAccent, fontWeight: '600', fontSize: 14 },
    link: { paddingHorizontal: 6, paddingVertical: 8 },
    linkText: { color: theme.textMuted, fontSize: 14 },
  });
}
