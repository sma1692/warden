import React, { useState } from 'react';
import {
  Activity,
  BellRing,
  Box,
  CheckCircle2,
  Cpu,
  Database,
  Flame,
  RefreshCw,
  Send,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import type { SystemHealthTelemetry } from '../types/commando';
import { formatCompactTokens, formatRelativeTime, formatUsd } from '../utils/formatters';

export interface HealthTelemetryBarProps {
  telemetry: SystemHealthTelemetry;
  pendingGatesCount: number;
  onSyncMdAndDb: () => Promise<void>;
  onTriggerStandup: () => void;
  onTestIdleWatchdog: () => void;
  onOpenPendingGates: () => void;
}

export const HealthTelemetryBar: React.FC<HealthTelemetryBarProps> = ({
  telemetry,
  pendingGatesCount,
  onSyncMdAndDb,
  onTriggerStandup,
  onTestIdleWatchdog,
  onOpenPendingGates,
}) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncConfirmed, setSyncConfirmed] = useState(true);

  const handleSyncClick = async () => {
    setIsSyncing(true);
    try {
      await onSyncMdAndDb();
      setSyncConfirmed(true);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--surface-border)] bg-[var(--surface-panel)]/95 backdrop-blur-md">
      <div className="mx-auto max-w-[1600px] px-3 sm:px-5 py-2.5 flex items-center justify-between gap-3 text-xs">
        {/* Brand & Telemetry Badges */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          <div className="flex items-center gap-2 pr-2 border-r border-[var(--surface-border)]">
            <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/40">
              <ShieldCheck className="h-4 w-4 text-[var(--surface-accent-gold)]" />
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--surface-accent-gold)] animate-ping" />
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--surface-accent-gold)]" />
            </div>
            <div>
              <div className="font-bold tracking-tight text-[var(--surface-text)] flex items-center gap-1.5">
                DYNAMO<span className="text-[var(--surface-accent-gold)]">COMMANDO</span>
                <span className="hidden md:inline-block rounded bg-[var(--surface-accent-gold)]/15 px-1.5 py-0.5 text-[10px] font-mono text-[var(--surface-accent-gold)] border border-[var(--surface-accent-gold)]/30 font-semibold">
                  Cloud + pgvector
                </span>
              </div>
              <div className="text-[10px] text-[var(--surface-text-secondary)] hidden sm:block">
                1-Man Unicorn Autonomous Workforce OS
              </div>
            </div>
          </div>

          {/* Heartbeat Status */}
          <div className="flex items-center gap-1.5 rounded-md bg-[var(--surface-accent-gold)]/10 border border-[var(--surface-accent-gold)]/30 px-2 py-1 text-[var(--surface-accent-gold)] font-mono text-[11px]">
            <Activity className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />
            <span>{telemetry.heartbeat_ok ? 'Heartbeat OK' : 'Heartbeat Degraded'}</span>
          </div>

          {/* Subagents Active */}
          <div className="flex items-center gap-1.5 rounded-md bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-1 text-[var(--surface-text-secondary)] font-mono text-[11px]">
            <Cpu className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />
            <span>
              Subagents:{' '}
              <strong className="text-[var(--surface-text)]">
                {telemetry.active_subagents} / {telemetry.max_subagents_pool}
              </strong>
            </span>
          </div>

          {/* Docker Sandboxes */}
          <div className="flex items-center gap-1.5 rounded-md bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-1 text-[var(--surface-text-secondary)] font-mono text-[11px]">
            <Box className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />
            <span>
              Docker:{' '}
              <strong className="text-[var(--surface-text)]">
                {telemetry.active_docker_sandboxes} Active
              </strong>
            </span>
          </div>

          {/* Tokens Today + Theoretical USD Burn */}
          <div className="flex items-center gap-1.5 rounded-md bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2.5 py-1 text-[var(--surface-text-secondary)] font-mono text-[11px]">
            <Flame className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />
            <span>
              Tokens:{' '}
              <strong className="text-[var(--surface-accent-gold)]">
                {formatCompactTokens(telemetry.total_tokens_today)}
              </strong>
            </span>
            <span className="text-[var(--surface-border-strong)]">|</span>
            <span>
              Burn:{' '}
              <strong className="text-[var(--surface-accent-gold)]">
                {formatUsd(telemetry.theoretical_usd_burn_today)}
              </strong>
            </span>
          </div>

          {/* Pinned pgvector 768-dim Embedding Indicator */}
          <div
            className="hidden xl:flex items-center gap-1.5 rounded-md bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-1 text-[var(--surface-accent-gold)] font-mono text-[10px]"
            title="Memory embeddings are pinned to 768-dim muse-embed-1.0 / muse-embed-1.0 so switching LLMs causes zero vector drift"
          >
            <Database className="h-3 w-3 text-[var(--surface-accent-gold)]" />
            <span>pgvector 768d Pinned</span>
          </div>

          {/* Telegram Pager Status */}
          <div className="hidden 2xl:flex items-center gap-1.5 rounded-md bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-1 text-[var(--surface-text-secondary)] font-mono text-[11px]">
            <Send className="h-3 w-3 text-[var(--surface-accent-gold)]" />
            <span>Telegram: {telemetry.telegram_pager_status}</span>
          </div>
        </div>

        {/* Right Action Triggers */}
        <div className="flex flex-wrap items-center gap-1.5 ml-auto">
          {pendingGatesCount > 0 && (
            <button
              type="button"
              onClick={onOpenPendingGates}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-accent)]/15 hover:bg-[var(--surface-accent)]/25 border border-[var(--surface-accent)]/40 px-2.5 py-1 text-[11px] font-semibold text-[var(--surface-accent)] transition cursor-pointer"
            >
              <span className="h-2 w-2 rounded-full bg-[var(--surface-accent)] animate-pulse" />
              <span>{pendingGatesCount} Needs Reply</span>
            </button>
          )}

          <button
            type="button"
            onClick={onTriggerStandup}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-accent-gold)]/15 hover:bg-[var(--surface-accent-gold)]/25 border border-[var(--surface-accent-gold)]/40 px-2.5 py-1 text-[11px] font-semibold text-[var(--surface-accent-gold)] transition cursor-pointer"
            title="Poll all Level 1 & Level 2 teams and synthesize 12:00 PM IST Daily Standup MoM"
          >
            <Zap className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />
            <span>🎙️ Standup</span>
          </button>

          <button
            type="button"
            onClick={onTestIdleWatchdog}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-accent)]/15 hover:bg-[var(--surface-accent)]/25 border border-[var(--surface-accent)]/40 px-2.5 py-1 text-[11px] font-semibold text-[var(--surface-accent)] transition cursor-pointer"
            title="Simulate Zero-Idle Department Watchdog (IdleBacklogMonitor) 3-spec proposal"
          >
            <BellRing className="h-3.5 w-3.5 text-[var(--surface-accent)]" />
            <span>🔔 Test Watchdog</span>
          </button>

          {syncConfirmed && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-md bg-[var(--surface-accent-gold)]/10 border border-[var(--surface-accent-gold)]/30 px-2 py-0.5 text-[10px] font-mono text-[var(--surface-accent-gold)]">
              <CheckCircle2 className="h-3 w-3 text-[var(--surface-accent-gold)]" />
              <span>IDE+DB ({formatRelativeTime(telemetry.last_md_db_sync_at)})</span>
            </span>
          )}

          <button
            type="button"
            onClick={() => void handleSyncClick()}
            disabled={isSyncing}
            title="Bi-directionally sync context/*.md, memory/*.md, worklist/*.md, and .claude/agents/*.md with PostgreSQL + pgvector"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-accent-gold)]/15 hover:bg-[var(--surface-accent-gold)]/25 border border-[var(--surface-accent-gold)]/40 px-2.5 py-1 text-[11px] font-semibold text-[var(--surface-accent-gold)] transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-[var(--surface-accent-gold)] ${
                isSyncing ? 'animate-spin' : ''
              }`}
            />
            <span>🔄 Sync MD ↔ DB</span>
          </button>
        </div>
      </div>
    </header>
  );
};

export default HealthTelemetryBar;
