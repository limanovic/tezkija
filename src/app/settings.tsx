import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';

import { LanguageRow, getLanguages } from '@/lib/db';
import { applyUiLanguage, useT } from '@/lib/i18n';
import {
  needsAutostartSetup,
  openAutostartSettings,
  openBatteryOptimizationSettings,
  openExactAlarmSettings,
  rebuildSchedule,
} from '@/lib/notifications';
import { TextSizeControl } from '@/components/text-size-control';
import {
  Settings,
  TRANSLATION_CODES,
  UiLanguage,
  loadSettings,
  notificationLanguages,
  saveSettings,
} from '@/lib/settings';
import { setThemePreference, useTheme } from '@/lib/theme';
import { makeListStyles } from '@/lib/ui-styles';

const FEEDBACK_EMAIL = 'office@adiv.dev';

/**
 * Hand off to the mail app with the subject and device details prefilled, so a
 * report arrives with enough context to act on without a back-and-forth.
 * No in-app form: that would need a backend, and email already reaches me.
 */
function openFeedbackMail(): void {
  const version = Constants.expoConfig?.version ?? '?';
  const subject = encodeURIComponent(`Tezkija feedback (v${version})`);
  const body = encodeURIComponent(
    `\n\n—\nApp ${version} · ${Platform.OS} ${Platform.Version}`,
  );
  Linking.openURL(`mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`).catch(() => {});
}

/** Toggle `code` in an ordered list, keeping the order of the rest. */
function toggled(list: string[], code: string, on: boolean): string[] {
  return on ? (list.includes(code) ? list : [...list, code]) : list.filter((c) => c !== code);
}

export default function SettingsScreen() {
  const theme = useTheme();
  const t = useT();
  const styles = useMemo(() => makeListStyles(theme), [theme]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [languages, setLanguages] = useState<LanguageRow[]>([]);

  useEffect(() => {
    loadSettings().then(setSettings);
    getLanguages().then(setLanguages);
  }, []);

  /** Persist a settings change and rebuild the notification window with it. */
  const apply = useCallback((next: Settings) => {
    setSettings(next);
    setThemePreference(next.theme);
    applyUiLanguage(next);
    (async () => {
      const normalized = await saveSettings(next);
      await rebuildSchedule(normalized);
    })().catch(() => {});
  }, []);

  /**
   * Persist without touching the notification schedule — for settings the
   * scheduled passages don't bake in. The slider would otherwise cancel and
   * rebuild every pending notification on each step of a drag. Theme and
   * showArabic belong here too: neither reaches the notification body.
   */
  const persist = useCallback((next: Settings) => {
    setSettings(next);
    // The theme store is what components actually render from; AsyncStorage
    // alone only takes effect on the next launch.
    setThemePreference(next.theme);
    saveSettings(next).catch(() => {});
  }, []);

  if (!settings) return <View style={styles.screen} />;

  const languageByCode = new Map(languages.map((l) => [l.code, l]));
  // Something must stay visible: block removing the last displayed text.
  const canRemoveTranslation = settings.showArabic || settings.translations.length > 1;

  // Effective list, whether explicit or following the reading text. Arabic is
  // a valid pick here: for some it's the whole point of the notification.
  const notifLangs = notificationLanguages(settings);
  const notifFollowsReading = settings.notificationLanguages === null;

  const languageRow = (
    code: string,
    on: boolean,
    disabled: boolean,
    onChange: (value: boolean) => void,
  ) => {
    const lang = languageByCode.get(code);
    return (
      <View key={code} style={styles.row}>
        <View>
          <Text style={styles.rowLabel}>{lang?.native_name ?? code}</Text>
          {lang && code !== 'ar' && <Text style={styles.rowSub}>{lang.translator}</Text>}
        </View>
        <Switch
          value={on}
          disabled={disabled}
          trackColor={{ true: theme.accent }}
          onValueChange={onChange}
        />
      </View>
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: t('settings') }} />

      <Text style={styles.sectionTitle}>{t('appearance')}</Text>
      <View style={styles.card}>
        <View style={styles.segmented}>
          {(['system', 'light', 'dark'] as const).map((pref) => (
            <Pressable
              key={pref}
              style={[styles.segment, settings.theme === pref && styles.segmentActive]}
              onPress={() => settings.theme !== pref && persist({ ...settings, theme: pref })}
            >
              <Text
                style={[styles.segmentText, settings.theme === pref && styles.segmentTextActive]}
              >
                {pref === 'system' ? t('system') : pref === 'light' ? t('light') : t('dark')}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t('textTitle')}</Text>
      <View style={styles.card}>
        {/* Dragging is meaningless without seeing the result, so the sample
            renders at the live scale in whatever the reader will show. */}
        <TextSizeControl
          scale={settings.textScale}
          showArabic={settings.showArabic}
          showTranslation={settings.translations.length > 0}
          onCommit={(textScale) => persist({ ...settings, textScale })}
        />
        {languageRow(
          'ar',
          settings.showArabic,
          // Never allow removing the last displayed text.
          settings.showArabic && settings.translations.length === 0,
          (value) => persist({ ...settings, showArabic: value }),
        )}
        {TRANSLATION_CODES.map((code) =>
          languageRow(
            code,
            settings.translations.includes(code),
            settings.translations.includes(code) && !canRemoveTranslation,
            (value) =>
              apply({ ...settings, translations: toggled(settings.translations, code, value) }),
          ),
        )}
      </View>

      <Text style={styles.sectionTitle}>{t('notifLangTitle')}</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('sameAsReading')}</Text>
          <Switch
            value={notifFollowsReading}
            trackColor={{ true: theme.accent }}
            // Switching off freezes the current effective list as the explicit
            // one, so nothing changes until the user edits it.
            onValueChange={(value) =>
              apply({ ...settings, notificationLanguages: value ? null : notifLangs })
            }
          />
        </View>
        {!notifFollowsReading &&
          ['ar', ...TRANSLATION_CODES].map((code) =>
            languageRow(
              code,
              notifLangs.includes(code),
              // Removing the last one would leave the body empty.
              notifLangs.includes(code) && notifLangs.length === 1,
              (value) =>
                apply({ ...settings, notificationLanguages: toggled(notifLangs, code, value) }),
            ),
          )}
      </View>

      {/* Permanent escape hatch. The home-screen offer can be dismissed, and
          battery optimisation is invisible to the app entirely, so both system
          screens stay reachable from here regardless of state. */}
      {Platform.OS === 'android' && (
        <>
          <Text style={styles.sectionTitle}>{t('deliveryTroubles')}</Text>
          <View style={styles.card}>
            {needsAutostartSetup() && (
              <Pressable style={styles.row} accessibilityRole="button" onPress={openAutostartSettings}>
                <Text style={styles.rowLabel}>{t('allowAutostart')}</Text>
                <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">
                  ›
                </Text>
              </Pressable>
            )}
            <Pressable style={styles.row} accessibilityRole="button" onPress={openExactAlarmSettings}>
              <Text style={styles.rowLabel}>{t('allowExactAlarms')}</Text>
              <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">
                ›
              </Text>
            </Pressable>
            <Pressable
              style={styles.row}
              accessibilityRole="button"
              onPress={openBatteryOptimizationSettings}
            >
              <Text style={styles.rowLabel}>{t('ignoreBatteryOpt')}</Text>
              <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">
                ›
              </Text>
            </Pressable>
          </View>
        </>
      )}

      <Text style={styles.sectionTitle}>{t('appLanguage')}</Text>
      <View style={styles.card}>
        <View style={styles.segmented}>
          {(['auto', ...TRANSLATION_CODES] as UiLanguage[]).map((code) => (
            <Pressable
              key={code}
              style={[styles.segment, settings.uiLanguage === code && styles.segmentActive]}
              onPress={() =>
                settings.uiLanguage !== code && apply({ ...settings, uiLanguage: code })
              }
            >
              <Text
                style={[
                  styles.segmentText,
                  settings.uiLanguage === code && styles.segmentTextActive,
                ]}
              >
                {code === 'auto' ? t('automatic') : languageByCode.get(code)?.native_name ?? code}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t('feedback')}</Text>
      <View style={styles.card}>
        <Pressable style={styles.row} accessibilityRole="button" onPress={openFeedbackMail}>
          <Text style={styles.rowLabel}>{t('sendFeedback')}</Text>
          <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">
            ›
          </Text>
        </Pressable>
        <Text style={styles.hint}>{t('feedbackHint')}</Text>
      </View>
    </ScrollView>
  );
}
