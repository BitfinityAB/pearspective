import { useSyncExternalStore } from 'react';
import type { NotificationSettings } from '../../../shared/types';

export const PERMISSION_HINT_KEY = 'pearspective.permissionHintDismissed';
export type PermissionState = NotificationPermission | 'unsupported';

export const permissionState = (): PermissionState => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

export function hintDismissed(): boolean {
  try { return localStorage.getItem(PERMISSION_HINT_KEY) === '1'; } catch { return false; }
}

// Lets the header dot react to a decision made in the settings panel.
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const emitChange = () => listeners.forEach((listener) => listener());

export function dismissPermissionHint(): void {
  try { localStorage.setItem(PERMISSION_HINT_KEY, '1'); } catch { /* storage blocked: the hint simply returns next time */ }
  emitChange();
}

/** Resolves to the browser's answer, or re-reads the real state if the request throws. */
export async function requestDesktopPermission(): Promise<PermissionState> {
  let state: PermissionState;
  try { state = await Notification.requestPermission(); } catch { state = permissionState(); }
  emitChange();
  return state;
}

/** The header points at the permission row until the viewer has decided. */
export const permissionHintVisible = (settings: NotificationSettings): boolean =>
  settings.enabled && permissionState() === 'default' && !hintDismissed();

export const usePermissionHint = (settings: NotificationSettings): boolean =>
  useSyncExternalStore(subscribe, () => permissionHintVisible(settings));
