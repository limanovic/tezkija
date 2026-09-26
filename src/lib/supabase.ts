import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session, SupabaseClient, createClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * The Supabase client, or null when the build carries no project: accounts
 * and sync then simply don't exist, everything else keeps working from
 * AsyncStorage as before. Both values come from `.env` (see `.env.example`);
 * the anon key is public by design, row-level security does the guarding.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// The web export renders every page once in Node, where AsyncStorage (a
// localStorage wrapper there) has no window. Give the client no storage in
// that pass — it keeps the session in memory — so the render sees the same
// "configured" app the browser will hydrate.
const prerendering = Platform.OS === 'web' && typeof window === 'undefined';

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          storage: prerendering ? undefined : AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          // Password sign-in only: there is never a session in a URL to pick up.
          detectSessionInUrl: false,
        },
      })
    : null;

export function isSupabaseConfigured(): boolean {
  return supabase !== null;
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** The current session, kept in step with sign-in / sign-out. `undefined` until first resolved. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    if (!supabase) {
      setSession(null);
      return;
    }
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSession(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!cancelled) setSession(next);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);
  return session;
}

/**
 * Email + password. There is no sign-up in the app: the handful of accounts
 * are created by hand in the Supabase dashboard (Authentication → Users →
 * Add user, "Auto confirm" on), so no email ever has to be sent.
 */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}
