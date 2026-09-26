import { useFonts } from 'expo-font';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { applyUiLanguage, useT } from '@/lib/i18n';
import {
  NotificationPayload,
  clearLastTap,
  configureNotificationHandling,
  rebuildSchedule,
  subscribeToTaps,
  topUpSchedule,
} from '@/lib/notifications';
import { loadSettings } from '@/lib/settings';
import { startSync } from '@/lib/sync';
import { setThemePreference, useTheme } from '@/lib/theme';

SplashScreen.preventAutoHideAsync();

configureNotificationHandling();

type Target = { pathname: '/reader' | '/lesson' | '/quiz'; params: Record<string, string> };

/**
 * Where a notification tap lands: a passage in the Reader, the lesson, or a
 * quiz over the words it carried. A word-of-the-day opens as lesson cards,
 * so the example ayah is there to read.
 */
function targetFor(data: NotificationPayload | undefined): Target | null {
  if (!data) return null;
  if (data.passageKey) return { pathname: '/reader', params: { key: JSON.stringify(data.passageKey) } };
  if (data.kind === 'lesson' && data.lessonId !== undefined) {
    return { pathname: '/lesson', params: { id: String(data.lessonId) } };
  }
  if ((data.kind === 'review' || data.kind === 'word') && data.lemmaIds?.length) {
    const lemmas = data.lemmaIds.join(',');
    return data.kind === 'review'
      ? { pathname: '/quiz', params: { lemmas } }
      : { pathname: '/lesson', params: { lemmas } };
  }
  return null;
}

export default function RootLayout() {
  const theme = useTheme();
  const t = useT();
  const [prefsReady, setPrefsReady] = useState(false);
  const [fontsLoaded] = useFonts({
    // The Madani mushaf typeface, paired with the Uthmani text in the database:
    // wasla, dagger alef and waqf marks are drawn as they are in print, and
    // U+06DD renders as the ornate ayah roundel.
    UthmanicHafs: require('../../assets/fonts/UthmanicHafs.otf'),
  });
  const ready = fontsLoaded && prefsReady;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  // Tapping a notification opens the Reader with the exact scheduled passage.
  // The tap is only *recorded* here: navigating before the Stack below has
  // mounted throws, and from inside the response listener that throw is a fatal
  // JS error — the "app closed" a tap produced whenever the notification
  // arrived before fonts and preferences had finished loading.
  const [pending, setPending] = useState<Target | null>(null);
  const handledResponse = useRef<string | null>(null);

  useEffect(
    () =>
      subscribeToTaps((id, data) => {
        // The cold-start tap is reported twice (see subscribeToTaps) — take it once.
        if (handledResponse.current === id) return;
        handledResponse.current = id;
        const target = targetFor(data);
        if (target) setPending(target);
      }),
    [],
  );

  useEffect(() => {
    if (!ready || !pending) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // `ready` means this component is rendering the Stack, not that the
    // navigator underneath it has finished mounting — the container becomes
    // navigable an effect later. Retry rather than assume.
    const go = () => {
      if (cancelled) return;
      try {
        router.push(pending);
        setPending(null);
      } catch {
        timer = setTimeout(go, 50);
      }
    };
    go();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [ready, pending]);

  // Once a tap has been acted on, forget it, or the next cold start would
  // reopen the Reader on the same stale passage.
  useEffect(() => {
    if (pending !== null || handledResponse.current === null) return;
    clearLastTap();
  }, [pending]);

  // Apply the saved theme and language preferences before the first frame is
  // shown — navigator headers keep the title they mount with, so the language
  // must be resolved before the Stack renders at all.
  useEffect(() => {
    loadSettings()
      .then((s) => {
        setThemePreference(s.theme);
        applyUiLanguage(s);
      })
      .catch(() => {})
      .finally(() => setPrefsReady(true));
  }, []);

  useEffect(() => {
    const topUp = () => loadSettings().then(topUpSchedule).catch(() => {});
    topUp();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') topUp();
    });
    return () => sub.remove();
  }, []);

  // Account sync. Screens re-read their own state through useSyncVersion;
  // the settings that live outside React state are re-applied here, and the
  // notification window rebuilt since the pulled cursor or times may differ.
  useEffect(
    () =>
      startSync((changed) => {
        loadSettings()
          .then((s) => {
            if (changed.includes('settings.v1')) {
              setThemePreference(s.theme);
              applyUiLanguage(s);
            }
            return rebuildSchedule(s);
          })
          .catch(() => {});
      }),
    [],
  );

  if (!ready) return null;

  return (
    <>
      {/* Without this the clock and icons stay light whatever the theme, which
          on the sand background is near-invisible. */}
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: theme.background },
          headerTitleStyle: { fontWeight: '600' },
        }}
      >
        {/* The tabs draw their own headers. */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="reader" options={{ title: '' }} />
        <Stack.Screen name="guidance" options={{ title: t('guidanceTitle') }} />
        <Stack.Screen name="surahs" options={{ title: t('surahs') }} />
        <Stack.Screen name="bookmarks" options={{ title: t('bookmarks') }} />
        <Stack.Screen name="settings" options={{ title: t('settings') }} />
        <Stack.Screen name="account" options={{ title: t('account') }} />
        <Stack.Screen name="lesson" options={{ title: '' }} />
        <Stack.Screen name="quiz" options={{ title: t('quiz') }} />
        <Stack.Screen name="progress" options={{ title: t('progressTitle') }} />
      </Stack>
    </>
  );
}
