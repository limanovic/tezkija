import { LedgerEntry, TapListener } from './notification-types';
import { Settings } from './settings';

/*
 * Web build: no local notifications exist in a browser, so every scheduling
 * call is a no-op and the ledger is always empty. Reminders on the web are
 * a later phase (server-sent Web Push); until then the phone app carries
 * them and the web app is for reading and learning. Same exports as
 * notifications.ts so the screens don't know the difference.
 */

export type { LedgerEntry, LedgerKind, NotificationPayload } from './notification-types';

export function configureNotificationHandling(): void {}
export async function ensureAndroidChannel(): Promise<void> {}

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

// "Granted" so the enable-notifications banner stays away: there is nothing
// to enable here, and the banner would promise something the web can't do.
export async function getPermissionGranted(): Promise<boolean> {
  return true;
}
export async function requestPermission(): Promise<boolean> {
  return true;
}

export async function loadLedger(): Promise<LedgerEntry[]> {
  return [];
}
export function onLedgerChange(_listener: (ledger: LedgerEntry[]) => void): () => void {
  return () => {};
}
export async function topUpSchedule(_settings: Settings): Promise<LedgerEntry[]> {
  return [];
}
export async function rebuildSchedule(_settings: Settings): Promise<LedgerEntry[]> {
  return [];
}
