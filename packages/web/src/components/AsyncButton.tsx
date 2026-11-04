import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';

/**
 * Shared async-action button + toast primitives.
 *
 * Every button that hits an API uses AsyncButton: it disables itself, shows a
 * spinner while the promise settles, and routes failures to an error toaster
 * via onError. Two modes:
 * - click mode: pass `action`, the button owns the pending window;
 * - controlled mode (form submits): parent tracks pending with useAsyncState
 *   and passes `pending` to a type="submit" AsyncButton.
 */

/** What an action resolves to. Thrown errors are also caught and toasted. */
export type ActionOutcome = void | null | false | { ok: boolean; error?: string };

function outcomeError(outcome: ActionOutcome, fallback: string): string | null {
  if (outcome === null || outcome === false) return fallback;
  if (typeof outcome === 'object' && outcome.ok === false) {
    return outcome.error || fallback;
  }
  return null;
}

function thrownMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}

interface AsyncButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onError'> {
  /** Click-mode work. Resolving null/false/{ok:false} (or throwing) toasts onError. */
  action?: () => Promise<ActionOutcome>;
  /** Controlled pending flag for form-submit usage (see useAsyncState). */
  pending?: boolean;
  /** Called with the failure message; wire to a toast. */
  onError?: (message: string) => void;
  /** Called when the action resolves without an error. */
  onSuccess?: () => void;
  /** Message used when the failure carries none of its own. */
  fallbackError?: string;
  /** Spinner icon size. Defaults to h-4 w-4. */
  spinnerClassName?: string;
  /** Rendered instead of children while pending (icon-only buttons). */
  swapWhilePending?: React.ReactNode;
}

export const AsyncButton: React.FC<AsyncButtonProps> = ({
  action,
  pending: controlledPending,
  onError,
  onSuccess,
  fallbackError = 'Request failed. Please try again.',
  spinnerClassName = 'h-4 w-4',
  swapWhilePending,
  disabled,
  onClick,
  children,
  ...rest
}) => {
  const [selfPending, setSelfPending] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const pending = controlledPending ?? selfPending;

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    if (!action || e.defaultPrevented || pending) return;
    setSelfPending(true);
    try {
      const outcome = await action();
      const err = outcomeError(outcome, fallbackError);
      if (err) {
        onError?.(err);
      } else {
        onSuccess?.();
      }
    } catch (err) {
      onError?.(thrownMessage(err, fallbackError));
    } finally {
      if (mountedRef.current) setSelfPending(false);
    }
  };

  const swapping = pending && swapWhilePending !== undefined;
  return (
    <button
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending}
      onClick={action ? handleClick : onClick}
    >
      {swapping ? (
        swapWhilePending
      ) : (
        <>
          {pending && <Loader2 className={`${spinnerClassName} animate-spin`} />}
          {children}
        </>
      )}
    </button>
  );
};

/** Pending tracker for form submits: `void ops.track(doSave())`. */
export function useAsyncState(): {
  pending: boolean;
  track: <T>(promise: Promise<T>) => Promise<T>;
} {
  const [pending, setPending] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const track = useCallback(async <T,>(promise: Promise<T>): Promise<T> => {
    setPending(true);
    try {
      return await promise;
    } finally {
      if (mountedRef.current) setPending(false);
    }
  }, []);

  return { pending, track };
}

export interface ToastItem {
  id: number;
  tone: 'error' | 'info';
  message: string;
}

/** Minimal toast stack state with auto-dismiss. Render with ToastHost. */
export function useToasts(dismissMs: number = 5000): {
  toasts: ToastItem[];
  notify: (message: string, tone?: 'error' | 'info') => void;
  notifyError: (message: string) => void;
  dismiss: (id: number) => void;
} {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, tone: 'error' | 'info' = 'info') => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-2), { id, tone, message }]);
      timers.current.push(window.setTimeout(() => dismiss(id), dismissMs));
    },
    [dismiss, dismissMs]
  );

  const notifyError = useCallback((message: string) => notify(message, 'error'), [notify]);

  return { toasts, notify, notifyError, dismiss };
}

export const ToastHost: React.FC<{
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-5 right-4 z-[60] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs shadow-2xl backdrop-blur ${
            t.tone === 'error'
              ? 'border-red-400/50 bg-[#1D1216]/95 text-red-100'
              : 'border-[#C6A664]/50 bg-[#101216]/95 text-[#F5F0E6]'
          }`}
        >
          {t.tone === 'error' ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#D4B475]" />
          )}
          <span className="flex-1 leading-relaxed">{t.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss notification"
            className="shrink-0 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
