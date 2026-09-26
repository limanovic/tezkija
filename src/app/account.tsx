import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useT } from '@/lib/i18n';
import { isSupabaseConfigured, signInWithPassword, signOut, useSession } from '@/lib/supabase';
import { loadLastSyncedAt, syncAll } from '@/lib/sync';
import { useTheme } from '@/lib/theme';
import { makeListStyles } from '@/lib/ui-styles';

/**
 * Sign in with email and password, and see the account you're signed in
 * as. No sign-up here: accounts are made in the Supabase dashboard.
 */

export default function AccountScreen() {
  const theme = useTheme();
  const t = useT();
  const styles = useMemo(() => makeListStyles(theme), [theme]);
  const local = useMemo(() => makeStyles(theme), [theme]);
  const session = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (session) loadLastSyncedAt().then(setLastSynced);
  }, [session, syncing]);

  const onSignIn = useCallback(async () => {
    const address = email.trim().toLowerCase();
    if (!address || !password) {
      setError(t('authError'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(address, password);
      // The auth listener in lib/sync runs the first sync; the session hook
      // switches this screen to the signed-in view.
      setPassword('');
    } catch {
      setError(t('authError'));
    } finally {
      setBusy(false);
    }
  }, [email, password, t]);

  const onSyncNow = useCallback(async () => {
    setSyncing(true);
    try {
      await syncAll();
    } catch {
      // Shown through the unchanged "last synced" line.
    } finally {
      setSyncing(false);
    }
  }, []);

  const onSignOut = useCallback(async () => {
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  }, []);

  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      style={[styles.bannerButton, local.button, disabled && local.buttonDisabled]}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={styles.bannerButtonText}>{label}</Text>
    </Pressable>
  );

  let body;
  if (!isSupabaseConfigured()) {
    body = <Text style={styles.hint}>{t('accountsUnavailable')}</Text>;
  } else if (session === undefined) {
    body = <ActivityIndicator color={theme.accent} style={local.spinner} />;
  } else if (session) {
    body = (
      <>
        <View style={styles.row}>
          <View style={local.grow}>
            <Text style={styles.rowSub}>{t('signedInAs')}</Text>
            <Text style={styles.rowLabel}>{session.user.email}</Text>
          </View>
        </View>
        <View style={styles.row}>
          <Text style={[styles.rowValue, local.grow]}>
            {syncing
              ? t('syncing')
              : lastSynced
                ? t('lastSynced', { time: new Date(lastSynced).toLocaleString() })
                : t('neverSynced')}
          </Text>
          {button(t('syncNow'), onSyncNow, syncing)}
        </View>
        <Text style={styles.hint}>{t('syncHint')}</Text>
        <Pressable style={local.link} accessibilityRole="button" disabled={busy} onPress={onSignOut}>
          <Text style={local.linkText}>{t('signOut')}</Text>
        </Pressable>
      </>
    );
  } else {
    body = (
      <>
        <Text style={styles.hint}>{t('accountHint')}</Text>
        <Text style={styles.rowSub}>{t('email')}</Text>
        <TextInput
          style={local.input}
          value={email}
          onChangeText={setEmail}
          placeholderTextColor={theme.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="next"
          editable={!busy}
        />
        <Text style={styles.rowSub}>{t('password')}</Text>
        <TextInput
          style={local.input}
          value={password}
          onChangeText={setPassword}
          placeholderTextColor={theme.textMuted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={onSignIn}
          editable={!busy}
        />
        {error && <Text style={local.error}>{error}</Text>}
        {button(t('signIn'), onSignIn, busy)}
      </>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: t('account') }} />
      <Text style={styles.sectionTitle}>{t('account')}</Text>
      <View style={[styles.card, local.card]}>{body}</View>
    </ScrollView>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    card: { paddingVertical: 14 },
    grow: { flex: 1 },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      backgroundColor: theme.background,
      color: theme.text,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      marginTop: 6,
      marginBottom: 12,
    },
    button: { marginTop: 0, alignSelf: 'flex-start' },
    buttonDisabled: { opacity: 0.5 },
    link: { paddingVertical: 8, marginTop: 8 },
    linkText: { color: theme.accent, fontSize: 15, fontWeight: '500' },
    error: { color: theme.danger, fontSize: 13, marginBottom: 10 },
    spinner: { paddingVertical: 20 },
  });
}
