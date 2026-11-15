import { z } from 'zod';
import type { ActivityStatus } from './types';

/** The kinds of email a person can unsubscribe from, one by one (spec §5.1). Reconnect emails are transactional. */
export const NOTIFICATION_TYPES = ['nudges', 'digest', 'partner_alerts', 'momentum'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const DUE_SOON_CHOICES = [1, 3, 7] as const;
export type DueSoonDays = (typeof DUE_SOON_CHOICES)[number];
export const PARTNER_ALERT_MODES = ['instant', 'daily', 'off'] as const;
export type PartnerAlerts = (typeof PARTNER_ALERT_MODES)[number];

/** A plan's notification settings (spec §2.4): stored on its `plans` row; only its owner changes them. */
export interface NotifySettings { dueSoonDays: DueSoonDays; partnerDigest: boolean; partnerAlerts: PartnerAlerts }
export const DEFAULT_SETTINGS: NotifySettings = { dueSoonDays: 3, partnerDigest: false, partnerAlerts: 'instant' };

export const notifySettingsSchema = z.object({
  dueSoonDays: z.union([z.literal(1), z.literal(3), z.literal(7)]),
  partnerDigest: z.boolean(),
  partnerAlerts: z.enum(PARTNER_ALERT_MODES),
}).strict();

/** How "Unsubscribe from …", the unsubscribe page and the settings name each kind. */
export const TYPE_LABEL: Record<NotificationType, string> = {
  nudges: 'reminders about your activities',
  digest: 'the weekly digest',
  partner_alerts: 'partner activity alerts',
  momentum: 'momentum warnings',
};

/** A status inside a sentence: "… is now in progress". */
export const STATUS_PHRASE: Record<ActivityStatus, string> = {
  not_started: 'not started', in_progress: 'in progress', blocked: 'blocked', done: 'done', na: 'not applicable',
};
