import { useCallback, useEffect, useRef, useState } from 'react';
import { describeItem, SUMMARY_THRESHOLD } from '../../../shared/notifications';
import type { NotificationBatch, Snapshot } from '../../../shared/types';

/** Shared by every tab of this browser, so a batch is shown once. */
export const LAST_NOTIFICATION_KEY = 'pearspective.lastNotification';

export interface ToastModel { key: string; prId: string | null; title: string; body: string }

function readLast(): string | null {
  try { return localStorage.getItem(LAST_NOTIFICATION_KEY); } catch { return null; }
}
function writeLast(id: string): void {
  try { localStorage.setItem(LAST_NOTIFICATION_KEY, id); } catch { /* storage blocked: tabs may then repeat a batch */ }
}

function messagesOf(batch: NotificationBatch): ToastModel[] {
  if (batch.items.length > SUMMARY_THRESHOLD) {
    return [{ key: batch.id, prId: null, title: `${batch.items.length} of your PRs changed`, body: batch.items.map((item) => `${item.repo} #${item.number}`).join(', ') }];
  }
  return batch.items.map((item) => ({ key: `${batch.id}:${item.prId}`, prId: item.prId, title: `${item.repo} #${item.number}`, body: describeItem(item) }));
}

export function useNotifications(snapshot: Snapshot | null, handlers: { onOpenPr: (prId: string) => void; onOpenMine: () => void }) {
  const [toasts, setToasts] = useState<ToastModel[]>([]);
  const baselineTaken = useRef(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const open = useCallback((toast: ToastModel) => {
    setToasts((current) => current.filter((candidate) => candidate.key !== toast.key));
    if (toast.prId) handlersRef.current.onOpenPr(toast.prId);
    else handlersRef.current.onOpenMine();
  }, []);
  const dismiss = useCallback((key: string) => setToasts((current) => current.filter((toast) => toast.key !== key)), []);

  const batch = snapshot?.notification ?? null;
  useEffect(() => {
    if (!snapshot) return;
    const last = readLast();
    // Whatever is current when the page loads was already shown or is stale.
    if (!baselineTaken.current) {
      baselineTaken.current = true;
      if (batch && (!last || batch.id > last)) writeLast(batch.id);
      return;
    }
    if (!batch || (last && batch.id <= last)) return;
    writeLast(batch.id);
    const messages = messagesOf(batch);
    if (document.visibilityState === 'visible') {
      setToasts((current) => [...current, ...messages]);
      return;
    }
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    for (const message of messages) {
      const notification = new Notification(message.title, { body: message.body, tag: message.prId ?? 'pearspective-summary' });
      notification.onclick = () => {
        window.focus();
        open(message);
        notification.close();
      };
    }
  }, [snapshot === null, batch?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return { toasts, dismiss, open };
}
