import { useEffect } from 'react';
import type { ToastModel } from '../notifications/useNotifications';

const VISIBLE = 3;
const LIFETIME_MS = 8_000;

function Toast({ toast, onOpen, onDismiss }: { toast: ToastModel; onOpen: (toast: ToastModel) => void; onDismiss: (key: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.key), LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [toast.key, onDismiss]);
  return (
    <div className="toast">
      <button type="button" className="toast-body" onClick={() => onOpen(toast)}>
        <b>{toast.title}</b>
        <span>{toast.body}</span>
      </button>
      <button type="button" className="icon-btn ghost" aria-label="Dismiss" onClick={() => onDismiss(toast.key)}>×</button>
    </div>
  );
}

export function Toasts({ toasts, onOpen, onDismiss }: { toasts: ToastModel[]; onOpen: (toast: ToastModel) => void; onDismiss: (key: string) => void }) {
  const hidden = Math.max(0, toasts.length - VISIBLE);
  return (
    <div className="toasts" aria-live="polite">
      {hidden > 0 && <span className="toast-more">+{hidden} more</span>}
      {toasts.slice(-VISIBLE).map((toast) => <Toast key={toast.key} toast={toast} onOpen={onOpen} onDismiss={onDismiss} />)}
    </div>
  );
}
