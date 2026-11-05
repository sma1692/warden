import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Cpu,
  DollarSign,
  Flame,
  Megaphone,
  Palette,
  Search,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { apiClient, type UserTokenTelemetry } from '../api/client';
import { formatUsdAdaptive } from '../utils/formatters';
import type { VerticalScope } from './ConsultationKnob';

interface TokenUsageBoxProps {
  tokensUsed?: number;
  activeVertical?: VerticalScope;
  onOpenTokenReport?: () => void;
}

const FILTER_OPTIONS: { label: string; key: UserTokenTelemetry['range'] }[] = [
  { label: 'Today', key: 'today' },
  { label: '7D', key: '7d' },
  { label: '30D', key: '30d' },
  { label: 'All', key: 'all' },
];



export const TokenUsageBox: React.FC<TokenUsageBoxProps> = ({
  activeVertical = 'ALL',
  onOpenTokenReport,
}) => {
  const [dateFilter, setDateFilter] = useState<string>('Today');
  const [telemetry, setTelemetry] = useState<UserTokenTelemetry | null>(null);

  const rangeKey: UserTokenTelemetry['range'] =
    FILTER_OPTIONS.find((f) => f.label === dateFilter)?.key || 'today';

  const fetchTokenData = useCallback(async () => {
    const res = await apiClient.getTokenTelemetry(rangeKey);
    if (res) {
      setTelemetry(res);
    }
  }, [rangeKey]);

  useEffect(() => {
    void fetchTokenData();
    // Token totals only move on telemetry ticks, run activity, and budget events.
    const unsubscribe = apiClient.subscribe((evt) => {
      if (
        evt.type === 'TELEMETRY_TICK' ||
        evt.type === 'RUN_UPDATED' ||
        evt.type === 'STEP_CREATED' ||
        evt.type === 'BUDGET_EXCEEDED'
      ) {
        void fetchTokenData();
      }
    });
    return unsubscribe;
  }, [fetchTokenData]);

  const totalTokens = telemetry?.totalTokens ?? 0;
  const totalCostUsd = telemetry?.totalCostUsd ?? 0;
  const totalRuns = telemetry?.totalRuns ?? 0;
  const cachedHitPct = telemetry?.cachedHitPct ?? 0;

  const techData = telemetry?.byVertical?.TECH ?? { tokens: 0, costUsd: 0, runs: 0, sharePct: 0 };
  const designData = telemetry?.byVertical?.DESIGN ?? {
    tokens: 0,
    costUsd: 0,
    runs: 0,
    imageCount: 0,
    sharePct: 0,
  };
  const seoData = telemetry?.byVertical?.SEO_AEO ?? { tokens: 0, costUsd: 0, runs: 0, sharePct: 0 };
  const socialData = telemetry?.byVertical?.SOCIAL ?? { tokens: 0, costUsd: 0, runs: 0, sharePct: 0 };
  const totalImageGenerations = telemetry?.totalImageGenerations ?? designData.imageCount ?? 0;

  const verticalBreakdown = [
    {
      id: 'TECH' as const,
      label: 'Tech',
      tokens: techData.tokens,
      costUsd: techData.costUsd,
      runs: techData.runs,
      imageCount: undefined as number | undefined,
      sharePct: techData.sharePct,
      barColor: 'bg-[#8A6820] dark:bg-[var(--surface-accent-gold)]',
      badgeStyle:
        'bg-[#8A6820]/15 text-[#4A360D] border-[#8A6820]/40 dark:bg-[var(--surface-accent-gold)]/15 dark:text-[var(--surface-accent-gold)] dark:border-[var(--surface-accent-gold)]/30',
      icon: <Cpu className="h-3.5 w-3.5 text-[#5A4212] dark:text-[var(--surface-accent-gold)]" />,
    },
    {
      id: 'DESIGN' as const,
      label: 'Designer',
      tokens: designData.tokens,
      costUsd: designData.costUsd,
      runs: designData.runs,
      imageCount: designData.imageCount,
      sharePct: designData.sharePct,
      barColor: 'bg-[#B45309] dark:bg-amber-400',
      badgeStyle:
        'bg-[#B45309]/15 text-[#5C2B06] border-[#B45309]/40 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/35',
      icon: <Palette className="h-3.5 w-3.5 text-[#78350F] dark:text-amber-300" />,
    },
    {
      id: 'SEO_AEO' as const,
      label: 'SEO / AEO',
      tokens: seoData.tokens,
      costUsd: seoData.costUsd,
      runs: seoData.runs,
      imageCount: undefined as number | undefined,
      sharePct: seoData.sharePct,
      barColor: 'bg-[#6E541E] dark:bg-[var(--surface-accent)]',
      badgeStyle:
        'bg-[#6E541E]/15 text-[#3D2E0E] border-[#6E541E]/40 dark:bg-[var(--surface-accent)]/15 dark:text-[var(--surface-accent)] dark:border-[var(--surface-accent)]/30',
      icon: <Search className="h-3.5 w-3.5 text-[#4A360D] dark:text-[var(--surface-accent)]" />,
    },
    {
      id: 'SOCIAL' as const,
      label: 'Social',
      tokens: socialData.tokens,
      costUsd: socialData.costUsd,
      runs: socialData.runs,
      imageCount: undefined as number | undefined,
      sharePct: socialData.sharePct,
      barColor: 'bg-[#4A5568] dark:bg-[#8A94A6]',
      badgeStyle:
        'bg-[#0F1622]/10 text-[#0F1622] border-[#0F1622]/30 dark:bg-[var(--surface-elevated)] dark:text-[var(--surface-text)] dark:border-[var(--surface-border-strong)]',
      icon: <Megaphone className="h-3.5 w-3.5 text-[#0F1622] dark:text-[var(--surface-text-secondary)]" />,
    },
  ];

  const displayedVerticals =
    activeVertical === 'ALL'
      ? verticalBreakdown
      : verticalBreakdown.filter((v) =>
          activeVertical === 'TECH' ? v.id === 'TECH' || v.id === 'DESIGN' : v.id === activeVertical
        );

  return (
    <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] shadow-xs flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[var(--surface-border)] px-4 py-3.5 shrink-0 bg-[var(--surface-elevated)] z-10">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/30 text-[var(--surface-accent-gold)]">
            <Flame className="h-4 w-4 text-[var(--surface-accent-gold)]" />
          </div>
          <h2 className="text-sm sm:text-base font-bold text-[var(--surface-text)]">
            Token Consumption
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-[var(--surface-muted)] rounded-lg p-1 border border-[var(--surface-border)] shrink-0">
            {FILTER_OPTIONS.map((v) => (
              <button
                key={v.label}
                type="button"
                onClick={() => setDateFilter(v.label)}
                className={`px-2 py-1 text-[10px] font-semibold rounded-md transition cursor-pointer ${
                  dateFilter === v.label
                    ? 'bg-[var(--surface-panel)] text-[var(--surface-accent-gold)] shadow-xs font-bold'
                    : 'text-[var(--surface-text-secondary)] hover:text-[var(--surface-text)]'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          {onOpenTokenReport && (
            <button
              type="button"
              onClick={onOpenTokenReport}
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--surface-accent-gold)]/40 bg-[var(--surface-accent-gold)]/15 hover:bg-[var(--surface-accent-gold)]/25 px-2.5 py-1.5 text-[10px] font-semibold text-[var(--surface-accent-gold)] transition cursor-pointer"
            >
              <span>Full Audit</span>
              <ArrowUpRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 p-3.5 sm:p-4 overflow-y-auto flex flex-col justify-between gap-3.5">
        {/* Top Section — 4 Clean 2x2 KPI Boxes */}
        <div className="grid grid-cols-2 gap-3 sm:gap-2.5 shrink-0">
          {/* KPI 1: Total Tokens Consumed */}
          <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-elevated)] p-3.5 sm:p-2.5 flex flex-col justify-between shadow-xs">
            <div className="flex items-center justify-between text-xs sm:text-[11px] text-[var(--surface-text-secondary)]">
              <span className="font-medium truncate">Tokens Consumed</span>
              <Flame className="h-4 w-4 sm:h-3.5 sm:w-3.5 text-[var(--surface-accent-gold)] shrink-0" />
            </div>
            <div className="mt-2 sm:mt-1 flex items-baseline gap-1.5">
              <span className="text-xl sm:text-lg font-black font-mono text-[var(--surface-accent-gold)]">
                {totalTokens.toLocaleString()}
              </span>
              <span className="text-[11px] sm:text-[10px] font-mono text-[var(--surface-text-secondary)]">
                tok
              </span>
            </div>
          </div>

          {/* KPI 2: Total Cost Incurred ($) */}
          <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-elevated)] p-3.5 sm:p-2.5 flex flex-col justify-between shadow-xs">
            <div className="flex items-center justify-between text-xs sm:text-[11px] text-[var(--surface-text-secondary)]">
              <span className="font-medium truncate">Cost Incurred ($)</span>
              <DollarSign className="h-4 w-4 sm:h-3.5 sm:w-3.5 text-[var(--surface-accent-gold)] shrink-0" />
            </div>
            <div className="mt-2 sm:mt-1 flex items-baseline gap-1.5">
              <span className="text-xl sm:text-lg font-black font-mono text-[var(--surface-accent-gold)]">
                {formatUsdAdaptive(totalCostUsd)}
              </span>
              <span className="text-[11px] sm:text-[10px] font-mono text-[var(--surface-text-secondary)]">
                USD
              </span>
            </div>
          </div>

          {/* KPI 3: Agent Runs */}
          <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-elevated)] p-3.5 sm:p-2.5 flex flex-col justify-between shadow-xs">
            <div className="flex items-center justify-between text-xs sm:text-[11px] text-[var(--surface-text-secondary)]">
              <span className="font-medium truncate">Agent Runs</span>
              <Activity className="h-4 w-4 sm:h-3.5 sm:w-3.5 text-[var(--surface-accent-gold)] shrink-0" />
            </div>
            <div className="mt-2 sm:mt-1 flex items-baseline gap-1.5">
              <span className="text-xl sm:text-lg font-black font-mono text-[var(--surface-text)]">
                {totalRuns.toLocaleString()}
              </span>
              <span className="text-[11px] sm:text-[10px] font-mono text-[var(--surface-text-secondary)]">
                runs
              </span>
            </div>
          </div>

          {/* KPI 4: Cache Hit Rate */}
          <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-elevated)] p-3.5 sm:p-2.5 flex flex-col justify-between shadow-xs">
            <div className="flex items-center justify-between text-xs sm:text-[11px] text-[var(--surface-text-secondary)]">
              <span className="font-medium truncate">Cache Hit Rate</span>
              <Zap className="h-4 w-4 sm:h-3.5 sm:w-3.5 text-[var(--semantic-success)] shrink-0" />
            </div>
            <div className="mt-2 sm:mt-1 flex items-baseline gap-1.5">
              <span className="text-xl sm:text-lg font-black font-mono text-[var(--semantic-success)]">
                {cachedHitPct}%
              </span>
              <span className="text-[11px] sm:text-[10px] font-mono text-[var(--surface-text-secondary)]">
                saved
              </span>
            </div>
          </div>
        </div>

        {/* Bottom Section — Per-Vertical Token Spend */}
        <div className="flex-1 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-elevated)] p-4 flex flex-col justify-between gap-3 shadow-xs">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-bold text-[var(--surface-text)] flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />
              <span>Per-Vertical Spend</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-md border border-[#B45309]/40 bg-[#B45309]/15 px-2 py-0.5 text-[10px] font-mono font-semibold text-[#5C2B06] dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-300">
              <Palette className="h-3 w-3 text-[#78350F] dark:text-amber-300" />
              <span>
                {totalImageGenerations.toLocaleString()} img-gen{' '}
                {totalImageGenerations === 1 ? 'change' : 'changes'}
              </span>
            </span>
          </div>

          <div className="flex-1 flex flex-col justify-around gap-3">
            {displayedVerticals.map((v) => (
              <div key={v.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-mono font-semibold ${v.badgeStyle}`}
                  >
                    {v.icon}
                    <span>{v.label}</span>
                  </span>

                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="text-[#2C2519] dark:text-[var(--surface-text-secondary)] font-medium">
                      {v.tokens.toLocaleString()} tok • {formatUsdAdaptive(v.costUsd)} ({v.runs} run{v.runs === 1 ? '' : 's'}
                      {v.imageCount !== undefined ? ` • ${v.imageCount} img` : ''})
                    </span>
                    <span className="text-[#4A360D] dark:text-[var(--surface-accent-gold)] font-bold w-9 text-right">
                      {v.sharePct}%
                    </span>
                  </div>
                </div>

                <div className="h-2.5 sm:h-2 w-full rounded-full bg-[var(--surface-muted)] overflow-hidden border border-[var(--surface-border)]">
                  <div
                    className={`h-full rounded-full ${v.barColor} transition-all duration-500`}
                    style={{ width: `${Math.min(100, Math.max(0, v.sharePct))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TokenUsageBox;
