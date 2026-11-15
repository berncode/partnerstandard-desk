import type { NotifySettings } from '@partner-desk/core';

/** What the dialog shows: the MAP's settings, the owner's timezone, and whether email can be sent at all. */
export interface NotificationSettingsData extends NotifySettings { timezone: string; mailConfigured: boolean }
export type NotificationSettingsView = { ok: true; settings: NotificationSettingsData } | { ok: false; message: string };
export type SaveSettingsResult = { ok: true; message: string } | { ok: false; message: string };
/** The owner-only server actions the dialog calls. */
export interface NotificationActions {
  load(mapId: string): Promise<NotificationSettingsView>;
  save(mapId: string, settings: NotifySettings): Promise<SaveSettingsResult>;
}
