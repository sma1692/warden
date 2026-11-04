import React, { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, Trash2 } from 'lucide-react';
import { apiClient } from '../api/client';
import type { LlmKeyStatus } from '../types/warden';

interface LlmKeyFormProps {
  /** Gate-card embedding: tighter spacing, no section heading. */
  compact?: boolean;
  /** Fired after a successful save so parents can refresh. */
  onSaved?: () => void;
}

/**
 * BYOK form: shows masked key status, saves (server-validates) or deletes
 * the operator's own Meta Muse key. Shared by Settings and the
 * TOKEN_CAP_EXCEEDED gate card.
 */
export const LlmKeyForm: React.FC<LlmKeyFormProps> = ({ compact = false, onSaved }) => {
  const [status, setStatus] = useState<LlmKeyStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [apiKey, setApiKey] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getLlmKeyStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    const key = apiKey.trim();
    if (!key) {
      setMessage({ tone: 'error', text: 'Paste your Meta Muse API key first.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiClient.saveLlmKey(key);
      if (res.ok) {
        setStatus(res.key);
        setApiKey('');
        setMessage({ tone: 'ok', text: 'Key saved and verified — runs now bill to your key.' });
        onSaved?.();
      } else {
        setMessage({ tone: 'error', text: res.error });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiClient.deleteLlmKey();
      if (res.ok) {
        setStatus({ has_key: false, key_hint: null, validated_at: null });
        setMessage({ tone: 'ok', text: 'Key removed — runs use the platform budget again.' });
        onSaved?.();
      } else {
        setMessage({ tone: 'error', text: res.error });
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--surface-text-secondary)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>Checking key status…</span>
      </div>
    );
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      {!compact && (
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-[#C6A664]" />
          <h3 className="text-sm font-bold text-[var(--surface-text)]">Your Meta Muse API key</h3>
        </div>
      )}
      {status?.has_key ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--semantic-success)]/40 bg-[var(--semantic-success)]/10 px-3 py-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--semantic-success)]">
            <CheckCircle2 className="h-4 w-4" />
            <span className="font-mono">{status.key_hint}</span>
            <span className="font-normal opacity-80">— runs bill to your key</span>
          </span>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[11px] text-[var(--surface-text-secondary)] hover:text-red-400 underline underline-offset-2 cursor-pointer disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" />
            Remove
          </button>
        </div>
      ) : (
        <p className="text-xs text-[var(--surface-text-secondary)] leading-relaxed">
          No key saved — runs use the shared platform budget until it runs out. Get a key at{' '}
          <span className="font-mono">dev.meta.ai</span>.
        </p>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSave();
          }}
          placeholder={status?.has_key ? 'Paste a new key to replace…' : 'Paste Meta Muse API key…'}
          aria-label="Meta Muse API key"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 rounded-xl bg-[var(--surface-panel)] border border-[var(--surface-border)] px-3 py-2 text-xs font-mono text-[var(--surface-text)] placeholder:text-[var(--surface-text-secondary)]/50 focus:outline-none focus:border-[#C6A664]/60"
        />
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={busy}
          className="inline-flex items-center justify-center gap-2 rounded-xl btn-gold-cta px-4 py-2 text-xs font-bold transition cursor-pointer disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <span>{status?.has_key ? 'Replace key' : 'Save key'}</span>
        </button>
      </div>
      {message && (
        <p
          className={`text-xs ${
            message.tone === 'ok'
              ? 'text-[var(--semantic-success)]'
              : 'text-red-400 dark:text-red-300'
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
};
