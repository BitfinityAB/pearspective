import { useState } from 'react';
import { NOTIFICATION_KINDS, type NotificationKind, type NotificationSettings } from '../../../shared/types';
import { dismissPermissionHint, hintDismissed, permissionState, type PermissionState } from '../notifications/permission';

const LABELS: Record<NotificationKind, [string, string]> = {
  ciFailed: ['CI failed', 'A check on your PR failed.'],
  ciPassed: ['CI passed', 'All checks on your PR passed after running.'],
  approved: ['Approved', 'Your PR was approved.'],
  changesRequested: ['Changes requested', 'A reviewer requested changes.'],
  readyToMerge: ['Ready to merge', 'Your PR became ready to merge.'],
  conflict: ['New conflict', 'Your PR got a merge conflict.'],
  newComment: ['New comment', 'Someone else commented on your PR.'],
  newThread: ['New review thread', 'Someone else opened a review thread.'],
  reviewRequested: ['Review requested', 'You or your team were asked to review.'],
};

export function NotificationSettingsSection({ settings, onSave }: { settings: NotificationSettings; onSave: (next: NotificationSettings) => Promise<void> | void }) {
  const [permission, setPermission] = useState<PermissionState>(permissionState);
  const [hintHidden, setHintHidden] = useState(hintDismissed);
  const save = (next: NotificationSettings) => void onSave(next);

  return (
    <section className="notify-settings" aria-label="Notifications">
      <label className="notify-master">
        <input type="checkbox" checked={settings.enabled} onChange={() => save({ ...settings, enabled: !settings.enabled })} />
        <span>Notify me about my pull requests</span>
      </label>
      <div className="notify-events">
        {NOTIFICATION_KINDS.map((kind) => (
          <label key={kind} title={LABELS[kind][1]}>
            <input type="checkbox" disabled={!settings.enabled} checked={settings.events[kind]} onChange={() => save({ ...settings, events: { ...settings.events, [kind]: !settings.events[kind] } })} />
            <span>{LABELS[kind][0]}</span>
          </label>
        ))}
      </div>
      <div className="notify-permission">
        <span className="muted small">Desktop notifications</span>
        {permission === 'unsupported' && <span className="small">Not supported in this browser</span>}
        {permission === 'granted' && <span className="small">Allowed</span>}
        {permission === 'denied' && <span className="small">Blocked in your browser settings</span>}
        {permission === 'default' && (
          <>
            <button type="button" className="btn" onClick={() => void Notification.requestPermission().then(setPermission)}>Allow desktop notifications</button>
            {!hintHidden && <button type="button" className="btn" onClick={() => { dismissPermissionHint(); setHintHidden(true); }}>Not now</button>}
          </>
        )}
      </div>
    </section>
  );
}
