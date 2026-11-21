import type { NotificationSettings } from '../../../shared/types';

export const PERMISSION_HINT_KEY = 'pearspective.permissionHintDismissed';
export type PermissionState = NotificationPermission | 'unsupported';

export const permissionState = (): PermissionState => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

export function hintDismissed(): boolean {
  try { return localStorage.getItem(PERMISSION_HINT_KEY) === '1'; } catch { return false; }
}

export function dismissPermissionHint(): void {
  try { localStorage.setItem(PERMISSION_HINT_KEY, '1'); } catch { /* storage blocked: the hint simply returns next time */ }
}

/** The header points at the permission row until the viewer has decided. */
export const permissionHintVisible = (settings: NotificationSettings): boolean =>
  settings.enabled && permissionState() === 'default' && !hintDismissed();
