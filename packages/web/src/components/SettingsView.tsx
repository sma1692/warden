import React, { useEffect, useState } from 'react';
import { CreditCard, Gauge, Loader2 } from 'lucide-react';
import { apiClient } from '../api/client';
import type { UserBudget } from '../types/warden';
import { LlmKeyForm } from './LlmKeyForm';

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Settings tab: platform budget usage, BYOK key management, and the
 * purchase-credits placeholder (v1: coming soon, no checkout wired).
 */
export const SettingsView: React.FC = () => {
  const [budget, setBudget] = useState<UserBudget | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getMyBudget()
      .then((b) => {
        if (!cancelled) setBudget(b);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pct =
    budget && budget.cap > 0 ? Math.min(100, Math.round((budget.used / budget.cap) * 100)) : 0;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 sm:p-5 space-y-3 shadow-sm">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-[#C6A664]" />
          <h2 className="text-sm font-bold text-[var(--surface-text)]">Platform budget</h2>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-[var(--surface-text-secondary)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Loading usage…</span>
          </div>
        ) : !budget ? (
          <p className="text-xs text-[var(--surface-text-secondary)]">
            Usage is unavailable while the server is unreachable.
          </p>
        ) : budget.cap === 0 ? (
          <p className="text-xs text-[var(--surface-text-secondary)]">
            Unlimited platform budget on your plan ({fmt(budget.used)} tokens used).
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono text-[var(--surface-text)]">
                {fmt(budget.used)} / {fmt(budget.cap)} tokens
              </span>
              <span
                className={`font-bold ${
                  budget.status === 'EXCEEDED'
                    ? 'text-red-400'
                    : budget.status === 'WARNING_80_PCT'
                      ? 'text-amber-400'
                      : 'text-[var(--semantic-success)]'
                }`}
              >
                {budget.status === 'EXCEEDED'
                  ? 'Exhausted'
                  : budget.status === 'WARNING_80_PCT'
                    ? `${pct}% used`
                    : `${pct}% used`}
              </span>
            </div>
            <div className="h-2 rounded-full bg-[var(--surface-border)] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  budget.status === 'EXCEEDED'
                    ? 'bg-red-400'
                    : budget.status === 'WARNING_80_PCT'
                      ? 'bg-amber-400'
                      : 'bg-[#C6A664]'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-[11px] text-[var(--surface-text-secondary)]">
              {budget.remaining !== null ? `${fmt(budget.remaining)} tokens left` : 'Unlimited'} ·{' '}
              {budget.mode} plan · ${budget.costUsd.toFixed(2)} platform spend. Add your own key
              below to run uncapped on your Meta credit.
            </p>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 sm:p-5 space-y-3 shadow-sm">
        <LlmKeyForm />
      </div>

      <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 sm:p-5 space-y-2 shadow-sm opacity-75">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-[#C6A664]" />
          <h2 className="text-sm font-bold text-[var(--surface-text)]">Purchase credits</h2>
        </div>
        <p className="text-xs text-[var(--surface-text-secondary)]">
          Top up your platform budget directly — coming soon. Until then, add your own Meta Muse
          key above for uncapped runs.
        </p>
        <button
          type="button"
          disabled
          title="Coming soon"
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card)] px-4 py-2 text-xs font-bold text-[var(--surface-text-secondary)] cursor-not-allowed"
        >
          Purchase credits (coming soon)
        </button>
      </div>
    </div>
  );
};
