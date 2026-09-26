import { PassageKey } from './passage';
import { ArabicDeliveryKind } from './settings';

/** Shared by the native scheduler (notifications.ts) and the web stub (notifications.web.ts). */

export type LedgerKind = 'guidance' | ArabicDeliveryKind;

/**
 * Payload a notification carries and the Reader / lesson / quiz screens open
 * from. Guidance: a passage key. Arapski: the lesson id, or the lemma ids.
 */
export type NotificationPayload = {
  kind?: LedgerKind; // absent on entries written before Arapski existed
  passageKey?: PassageKey;
  lessonId?: number;
  lemmaIds?: number[];
};

export type LedgerEntry = NotificationPayload & {
  notificationId: string;
  dateISO: string; // 'YYYY-MM-DD' local calendar day
  time: string; // 'HH:mm'
  // Written by versions that advanced the cursor as occurrences elapsed. The
  // cursor now moves only when an ayah is ticked, so this is ignored.
  nextCursor?: number;
};

/** A tapped notification: its id (to take each tap once) and what it carried. */
export type TapListener = (id: string, payload: NotificationPayload | undefined) => void;
