import { router } from 'expo-router';

import { LedgerEntry, TapListener } from './notification-types';
import { Settings } from './settings';
import { getSession, supabase } from './supabase';

/*
 * Web build. There are no local notifications in a browser, so scheduling
 * is a no-op and the ledger is always empty. Reminders come instead as Web
 * Push, sent by the send-reminders Edge Function from the delivery times
 * synced to the account: this side only has to get permission, register
 * the push subscription and keep it on the server.
 *
 * Push needs an account (the sender reads settings from user_state), a
 * service worker (registered in +html.tsx) and, on iPhone, the site added
 * to the home screen — Safari in a tab has no PushManager at all.
 * Same exports as notifications.ts so the screens don't know the difference.
 */

export type { LedgerEntry, LedgerKind, NotificationPayload } from './notification-types';

// The public half of the VAPID pair is public by nature (it ends up in every
// browser anyway), so the project's key is the default and .env only needs
// to override it for a different Supabase project.
const VAPID_PUBLIC_KEY =
  process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ||
  'BBIact1keqK1_Xy8jw9T98hG07NZZKDJ3U8exdW6xGlw-ZxoeH-aknCiw4Vs0zE6FiQPwxR3Wy7TARPFX3Xx5wQ';
const TABLE = 'push_subscriptions';

function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!VAPID_PUBLIC_KEY &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Store (or refresh) this browser's subscription under the signed-in user. */
async function saveSubscription(sub: PushSubscription): Promise<void> {
  if (!supabase) return;
  const session = await getSession();
  if (!session) return;
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;
  await supabase.from(TABLE).upsert(
    {
      user_id: session.user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Sarajevo',
      user_agent: navigator.userAgent.slice(0, 200),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  );
}

async function subscribe(): Promise<PushSubscription> {
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!) as BufferSource,
  });
}

// Only re-send the row when something about it changed since the last time
// this browser did; every foreground would otherwise write a row for nothing.
let savedEndpoint: string | null = null;

async function ensureSubscription(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const sub = await currentSubscription();
  if (!sub || sub.endpoint === savedEndpoint) return;
  await saveSubscription(sub);
  savedEndpoint = sub.endpoint;
}

export function configureNotificationHandling(): void {}
export async function ensureAndroidChannel(): Promise<void> {}

// A push opens the app on the right URL directly, so there are no taps to relay.
export function subscribeToTaps(_listener: TapListener): () => void {
  return () => {};
}
export function clearLastTap(): void {}

export function canScheduleExactAlarms(): boolean {
  return true;
}
export async function openExactAlarmSettings(): Promise<void> {}
export async function isExactAlarmPromptDismissed(): Promise<boolean> {
  return true;
}
export async function dismissExactAlarmPrompt(): Promise<void> {}

export function getManufacturer(): string {
  return '';
}
export function needsAutostartSetup(): boolean {
  return false;
}
export async function openAutostartSettings(): Promise<boolean> {
  return false;
}
export async function isAutostartPromptDismissed(): Promise<boolean> {
  return true;
}
export async function dismissAutostartPrompt(): Promise<void> {}
export async function openBatteryOptimizationSettings(): Promise<void> {}

/**
 * "Granted" means the browser allowed notifications and a subscription is
 * registered. Where push can't work at all (Safari in a tab, no VAPID key)
 * this says granted too, so the enable banner doesn't promise the impossible.
 */
export async function getPermissionGranted(): Promise<boolean> {
  if (!pushSupported()) return true;
  if (Notification.permission !== 'granted') return false;
  const sub = await currentSubscription().catch(() => null);
  if (sub) ensureSubscription().catch(() => {});
  return sub !== null;
}

/**
 * The enable button. Without an account there is nothing to subscribe to
 * — the sender reads the delivery times from the account — so it leads to
 * the sign-in screen first.
 */
export async function requestPermission(): Promise<boolean> {
  if (!pushSupported()) return true;
  if (!(await getSession())) {
    router.push('/account');
    return false;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  try {
    const sub = await subscribe();
    await saveSubscription(sub);
    savedEndpoint = sub.endpoint;
    return true;
  } catch {
    return false;
  }
}

/** On sign-out: this browser must stop receiving that account's reminders. */
export async function forgetPushSubscription(): Promise<void> {
  if (!pushSupported()) return;
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  if (supabase) await supabase.from(TABLE).delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe().catch(() => {});
  savedEndpoint = null;
}

export async function loadLedger(): Promise<LedgerEntry[]> {
  return [];
}
export function onLedgerChange(_listener: (ledger: LedgerEntry[]) => void): () => void {
  return () => {};
}
/** Nothing to schedule here; the foreground is a good moment to refresh the subscription row. */
export async function topUpSchedule(_settings: Settings): Promise<LedgerEntry[]> {
  ensureSubscription().catch(() => {});
  return [];
}
export async function rebuildSchedule(_settings: Settings): Promise<LedgerEntry[]> {
  return [];
}
