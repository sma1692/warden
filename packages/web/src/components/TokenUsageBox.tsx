import React, { useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Cpu,
  Flame,
  Layers,
  Megaphone,
  Search,
  ShieldCheck,
  TrendingDown,
  Zap,
} from 'lucide-react';
import type { VerticalScope } from './ConsultationKnob';

interface TokenUsageBoxProps {
  tokensUsed?: number;
  activeVertical?: VerticalScope;
  onOpenTokenReport?: () => void;
}

export const TokenUsageBox: React.FC<TokenUsageBoxProps> = ({
  activeVertical = 'ALL',
  onOpenTokenReport,
}) => {
  const [dateFilter, setDateFilter] = useState('Today');

  const verticalBreakdown = [
    {
      id: 'TECH' as const,
      label: 'Tech Vertical',
      agentsList: '@warden, @cto, @pm, @tech_lead, @frontend_dev, @backend_dev, @infra_head, @sec_lead',
      netTokensLabel: '6.4K tok',
      rawTokensLabel: '118.0K raw',
      savingsPct: '94.6% saved',
      sharePct: 58,
      barColor: 'bg-[var(--surface-accent-gold)]',
      badgeStyle: 'bg-[var(--surface-accent-gold)]/15 text-[var(--surface-accent-gold)] border-[var(--surface-accent-gold)]/30',
      icon: <Cpu className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />,
    },
    {
      id: 'SEO_AEO' as const,
      label: 'SEO / AEO Vertical',
      agentsList: '@cbo, @aeo_lead, @aeo_specialist',
      netTokensLabel: '2.7K tok',
      rawTokensLabel: '44.5K raw',
      savingsPct: '93.9% saved',
      sharePct: 24,
      barColor: 'bg-[var(--surface-accent)]',
      badgeStyle: 'bg-[var(--surface-accent)]/15 text-[var(--surface-accent)] border-[var(--surface-accent)]/30',
      icon: <Search className="h-3.5 w-3.5 text-[var(--surface-accent)]" />,
    },
    {
      id: 'SOCIAL' as const,
      label: 'Social Media Vertical',
      agentsList: '@social_lead, @social_creator',
      netTokensLabel: '2.0K tok',
      rawTokensLabel: '29.0K raw',
      savingsPct: '93.1% saved',
      sharePct: 18,
      barColor: 'bg-[#8A94A6]',
      badgeStyle: 'bg-[var(--surface-elevated)] text-[var(--surface-text)] border-[var(--surface-border-strong)]',
      icon: <Megaphone className="h-3.5 w-3.5 text-[var(--surface-text-secondary)]" />,
    },
  ];

  const displayedVerticals =
    activeVertical === 'ALL'
      ? verticalBreakdown
      : verticalBreakdown.filter((v) => v.id === activeVertical);

  return (
    <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] shadow-xs flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header (sticky at top) */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 border-b border-[var(--surface-border)] p-4 sm:p-5 shrink-0 bg-[var(--surface-panel)] z-10">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/30 text-[var(--surface-accent-gold)]">
            <Flame className="h-5 w-5 text-[var(--surface-accent-gold)]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-bold text-[var(--surface-text)]">
                Token Consumption
              </h2>
              <span className="rounded-full bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/30 px-2.5 py-0.5 text-[10px] font-mono font-bold text-[var(--surface-accent-gold)]">
                ● Firewall Active (94.2% Saved)
              </span>
            </div>
            <p className="text-xs text-[var(--surface-text-secondary)] mt-0.5">
              Zero-file-read executive enforcement
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start xl:self-center">
          <div className="flex items-center bg-[var(--surface-muted)] rounded-lg p-1 border border-[var(--surface-border)] shrink-0">
            {['Today', '7D', '30D', 'All'].map((v) => (
              <button
                key={v}
                onClick={() => setDateFilter(v)}
                className={`px-2 py-1 text-[10px] font-semibold rounded-md transition cursor-pointer ${
                  dateFilter === v
                    ? 'bg-[var(--surface-panel)] text-[var(--surface-accent-gold)] shadow-xs font-bold'
                    : 'text-[var(--surface-text-secondary)] hover:text-[var(--surface-text)]'
                }`}
              >
                {v}
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

      {/* Scrollable Body */}
      <div className="flex-1 min-h-0 p-4 sm:p-5 overflow-y-auto space-y-4">
        {/* 4 Primary KPI Metric Boxes */}
        <div className="grid grid-cols-2 gap-3">
          {/* KPI 1: Net Payload Tokens */}
          <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-elevated)] p-3.5 flex flex-col justify-between shadow-xs">
            <div className="flex items-center justify-between text-xs text-[var(--surface-text-secondary)]">
              <span className="font-medium">Net Payload Tokens</span>
              <Flame className="h-4 w-4 text-[var(--surface-accent-gold)]" />
            </div>
            <div className="my-1.5 flex items-baseline gap-2 flex-wrap">
              <span className="text-xl sm:text-2xl font-black font-mono text-[var(--surface-accent-gold)]">
                ~11.1K tok
              </span>
              <span className="text-[11px] font-mono text-[var(--surface-text-muted)] line-through break-keep">
                191.5K raw
              </span>
            </div>
            <div className="text-[11px] text-[var(--surface-text-secondary)] flex items-center justify-between">
              <span>Session Net Payload</span>
              <span className="font-mono text-[var(--surface-accent-gold)] font-semibold">$0.017 est</span>
            </div>
          </div>

          {/* KPI 2: Cumulative Context Firewall Savings */}
          <div className="rounded-xl border border-[var(--surface-accent-gold)]/30 bg-[var(--surface-accent-gold)]/10 p-3.5 flex flex-col justify-between shadow-xs">
            <div className="flex items-center justify-between text-xs text-[var(--surface-accent-gold)]">
              <span className="font-medium">Context Firewall Savings</span>
              <TrendingDown className="h-4 w-4 text-[var(--surface-accent-gold)]" />
            </div>
            <div className="my-1.5 flex items-baseline gap-2 flex-wrap">
              <span className="text-xl sm:text-2xl font-black font-mono text-[var(--surface-accent-gold)]">
                94.2% saved
              </span>
              <span className="rounded bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/30 px-1.5 py-0.2 text-[10px] font-mono text-[var(--surface-accent-gold)] break-keep">
                -180.4K tok
              </span>
            </div>
            <div className="text-[11px] text-[var(--surface-text-secondary)]">
              40KB topology &amp; raw repos isolated to L2
            </div>
          </div>

          {/* KPI 3: Avg Turn Burn */}
          <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-elevated)] p-3.5 flex flex-col justify-between shadow-xs">
            <div className="flex items-center justify-between text-xs text-[var(--surface-text-secondary)]">
              <span className="font-medium">Avg Turn Burn</span>
              <Zap className="h-4 w-4 text-[var(--surface-accent-gold)]" />
            </div>
            <div className="my-1.5 flex items-baseline gap-2 flex-wrap">
              <span className="text-xl sm:text-2xl font-black font-mono text-[var(--surface-accent-gold)]">
                ~859 tok/turn
              </span>
              <span className="text-[10px] font-mono text-[var(--surface-accent-gold)] break-keep font-semibold">
                &lt; 1.5K cap
              </span>
            </div>
            <div className="text-[11px] text-[var(--surface-text-secondary)]">
              Upward return caps: L0 &le;120w • L1 &le;150w
            </div>
          </div>

          {/* KPI 4: Active Hierarchy */}
          <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-elevated)] p-3.5 flex flex-col justify-between shadow-xs">
            <div className="flex items-center justify-between text-xs text-[var(--surface-text-secondary)]">
              <span className="font-medium">Active Hierarchy</span>
              <Layers className="h-4 w-4 text-[var(--surface-accent)]" />
            </div>
            <div className="my-1.5">
              <div className="text-sm sm:text-base font-black font-mono text-[var(--surface-text)] leading-tight">
                Tech + SEO/AEO + Social
              </div>
              <div className="text-[11px] font-mono text-[var(--surface-accent-gold)] mt-0.5 flex-wrap font-semibold">
                13 Agents • 4 Pyramid Tiers
              </div>
            </div>
            <div className="text-[11px] text-[var(--surface-text-secondary)] flex items-center gap-1">
              <Activity className="h-3 w-3 text-[var(--surface-accent-gold)]" />
              <span>Zero-Read Chat Logging Active</span>
            </div>
          </div>
        </div>

        {/* Per-Vertical Token Breakdown Bars */}
        <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-elevated)] p-3.5 space-y-3 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-bold text-[var(--surface-text)] flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-[var(--surface-accent-gold)]" />
              <span>Per-Vertical Token Allocation &amp; Firewall Compression</span>
            </span>
            <span className="text-[11px] font-mono text-[var(--surface-text-secondary)]">
              Total Net: <strong className="text-[var(--surface-accent-gold)]">11,120 tok</strong> across 13 agents
            </span>
          </div>

          <div className="space-y-2.5">
            {displayedVerticals.map((v) => (
              <div key={v.id} className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-mono font-semibold ${v.badgeStyle}`}
                    >
                      {v.icon}
                      <span>{v.label}</span>
                    </span>
                    <span className="text-[11px] font-mono text-[var(--surface-text-muted)] truncate hidden xl:inline">
                      {v.agentsList}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="text-[var(--surface-accent-gold)] font-bold">{v.netTokensLabel}</span>
                    <span className="text-[var(--surface-text-muted)] text-[10px]">({v.rawTokensLabel})</span>
                    <span className="rounded bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/30 px-1.5 py-0.2 text-[10px] font-semibold text-[var(--surface-accent-gold)]">
                      {v.savingsPct}
                    </span>
                    <span className="text-[var(--surface-accent-gold)] font-bold w-9 text-right">
                      {v.sharePct}%
                    </span>
                  </div>
                </div>

                <div className="h-2 w-full rounded-full bg-[var(--surface-muted)] overflow-hidden border border-[var(--surface-border)]">
                  <div
                    className={`h-full rounded-full ${v.barColor} transition-all duration-500`}
                    style={{ width: `${v.sharePct}%` }}
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
