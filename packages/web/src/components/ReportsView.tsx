import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  ExternalLink,
  FileCode,
  FileText,
  Globe,
  Key,
  Layers,
  Play,
  RefreshCw,
  ScrollText,
  Search,
  Share2,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import {
  REPORT_NEEDS_CEO_CARDS,
  REPORT_TASK_MOVEMENTS,
  REPORT_WEEKLY_PLAN,
} from '../data/reportsData';
import {
  UNIFIED_REPORTS_CATALOG,
  type UnifiedReportItem,
} from '../data/reportsCatalog';
import type { VerticalScope } from './ConsultationKnob';
import { MarkdownRenderer } from './MarkdownRenderer';
import { useFollowedVertical } from '../hooks/useVerticalFilter';
import type { BacklogItem } from '../types/warden';

interface ReportsViewProps {
  activeVertical?: VerticalScope;
  backlogItems?: BacklogItem[];
  onTriggerStandupNow: () => Promise<void>;
  onOpenBacklog?: () => void;
  onOpenBacklogItem?: (itemId: string) => void;
  onOpenChatWithAgent?: (slug: string) => void;
  onOpenReportWindowTab?: (report: UnifiedReportItem) => void;
}

export type ReportSubTab = 'full_mom' | 'needs_ceo' | 'weekly_plan' | 'movements' | 'raw';

const VERTICAL_BADGE_STYLE: Record<
  Exclude<VerticalScope, 'ALL'>,
  { label: string; className: string; icon: React.ReactNode }
> = {
  TECH: {
    label: 'Tech',
    className: 'bg-[var(--semantic-action)]/15 text-[var(--semantic-action)] border-[var(--semantic-action)]/35',
    icon: <Cpu className="h-3 w-3 text-[var(--semantic-action)]" />,
  },
  SEO_AEO: {
    label: 'SEO / AEO',
    className: 'bg-[var(--semantic-success)]/15 text-[var(--semantic-success)] border-[var(--semantic-success)]/35',
    icon: <Globe className="h-3 w-3 text-[var(--semantic-success)]" />,
  },
  SOCIAL: {
    label: 'Social Media',
    className: 'bg-[var(--semantic-warning)]/15 text-[var(--semantic-warning)] border-[var(--semantic-warning)]/35',
    icon: <Share2 className="h-3 w-3 text-[var(--semantic-warning)]" />,
  },
};

export const ReportsView: React.FC<ReportsViewProps> = ({
  activeVertical = 'ALL',
  backlogItems,
  onTriggerStandupNow,
  onOpenBacklog,
  onOpenBacklogItem,
  onOpenChatWithAgent,
  onOpenReportWindowTab,
}) => {
  const [localVertical, setLocalVertical] = useFollowedVertical(activeVertical);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReportId, setSelectedReportId] = useState<string>(
    UNIFIED_REPORTS_CATALOG[0].id
  );
  const [activeSubTab, setActiveSubTab] = useState<ReportSubTab>('full_mom');
  const [copied, setCopied] = useState(false);
  const [isPolling, setIsPolling] = useState(false);

  const filteredReports = useMemo(() => {
    return UNIFIED_REPORTS_CATALOG.filter((item) => {
      if (localVertical !== 'ALL' && item.vertical !== localVertical) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          item.title.toLowerCase().includes(q) ||
          item.subtitle.toLowerCase().includes(q) ||
          item.authorSlug.toLowerCase().includes(q) ||
          item.projectSlug.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [localVertical, searchQuery]);

  const activeReport = useMemo(() => {
    return (
      filteredReports.find((r) => r.id === selectedReportId) ||
      filteredReports[0] ||
      UNIFIED_REPORTS_CATALOG[0]
    );
  }, [filteredReports, selectedReportId]);

  const handleCopyMarkdown = async () => {
    if (!activeReport) return;
    await navigator.clipboard.writeText(activeReport.markdownContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleTriggerPoll = async () => {
    setIsPolling(true);
    try {
      await onTriggerStandupNow();
    } finally {
      setIsPolling(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. Top Header & Vertical Filter Bar */}
      <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-[var(--surface-accent)]/15 border border-[var(--surface-accent)]/35 p-2.5 text-[var(--surface-accent)] shrink-0">
              <ScrollText className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base sm:text-lg font-bold text-[var(--text-main)]">
                  Executive Reports, Audits &amp; Standup MoMs
                </h1>
                <span className="rounded-full bg-[var(--semantic-success)]/15 border border-[var(--semantic-success)]/30 px-2 py-0.5 text-[10px] font-mono text-[var(--semantic-success)]">
                  {filteredReports.length} Reports
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Cross-vertical deliverables across Tech, SEO/AEO, and Social Media with compressed token provenance.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Vertical filter pills */}
            <div className="inline-flex items-center rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-border)] p-1 gap-1">
              {(
                [
                  { id: 'ALL', label: 'All Verticals' },
                  { id: 'TECH', label: 'Tech' },
                  { id: 'SEO_AEO', label: 'SEO / AEO' },
                  { id: 'SOCIAL', label: 'Social' },
                ] as { id: VerticalScope; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setLocalVertical(tab.id)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                    localVertical === tab.id
                      ? 'bg-[var(--surface-accent)]/15 text-[var(--surface-accent)] border border-[var(--surface-accent)]/40 shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="h-3.5 w-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter reports..."
                className="rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-border)] pl-8 pr-3 py-1.5 text-xs text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--surface-accent)] w-44 transition"
              />
            </div>

            <button
              type="button"
              onClick={handleTriggerPoll}
              disabled={isPolling}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--surface-accent)]/15 border border-[var(--surface-accent)]/40 hover:bg-[var(--surface-accent)]/25 px-3 py-1.5 text-xs font-semibold text-[var(--surface-accent)] transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isPolling ? 'animate-spin' : ''}`} />
              <span>{isPolling ? 'Polling...' : 'Run Standup Poll'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2A. MOBILE VIEW (< md): Responsive Report Cards */}
      <div className="md:hidden space-y-2.5">
        {filteredReports.map((report) => {
          const vBadge = VERTICAL_BADGE_STYLE[report.vertical];
          const isSelected = report.id === activeReport?.id;
          return (
            <div
              key={report.id}
              onClick={() => setSelectedReportId(report.id)}
              className={`rounded-2xl border p-3.5 transition cursor-pointer shadow-xs ${
                isSelected
                  ? 'border-[var(--surface-accent)]/60 bg-[var(--surface-panel)] ring-1 ring-[var(--surface-accent)]/30 shadow-sm'
                  : 'border-[var(--surface-border)] bg-[var(--surface-panel)] hover:border-[var(--surface-border-strong)]'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${vBadge.className}`}
                >
                  {vBadge.icon}
                  <span>{vBadge.label}</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-main)]">
                    {report.tokenBurnLabel}
                  </span>
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">{report.date}</span>
                </div>
              </div>

              <h3 className="text-xs font-bold text-[var(--text-main)] leading-snug">
                {report.title}
              </h3>
              <p className="text-[11px] text-[var(--text-muted)] mt-1 line-clamp-2">
                {report.subtitle}
              </p>

              <div className="mt-2.5 pt-2 border-t border-[var(--surface-border-subtle)] flex items-center justify-between gap-2 text-[10px]">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[var(--surface-accent)] font-semibold">
                    {report.authorSlug}
                  </span>
                  <span className="text-[var(--text-muted)]">•</span>
                  <span className="text-[var(--semantic-success)] font-mono">{report.keyMetric}</span>
                </div>
                {onOpenReportWindowTab && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenReportWindowTab(report);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-1 text-[10px] font-semibold text-[var(--text-main)] hover:text-[var(--surface-accent)] transition cursor-pointer"
                  >
                    <span>Tab</span>
                    <ArrowUpRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 2B. PC VIEW (>= md): Clean Tabular Report Directory */}
      <div className="hidden md:block rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--surface-border)] bg-[var(--surface-elevated)] text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                <th className="py-2.5 px-4">Report Title</th>
                <th className="py-2.5 px-3">Vertical</th>
                <th className="py-2.5 px-3">Author</th>
                <th className="py-2.5 px-3">Key Telemetry</th>
                <th className="py-2.5 px-3">Tokens</th>
                <th className="py-2.5 px-3">Date / Cadence</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--surface-border-subtle)] text-xs">
              {filteredReports.map((report) => {
                const vBadge = VERTICAL_BADGE_STYLE[report.vertical];
                const isSelected = report.id === activeReport?.id;
                return (
                  <tr
                    key={report.id}
                    onClick={() => setSelectedReportId(report.id)}
                    className={`transition cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--surface-accent)]/5 hover:bg-[var(--surface-accent)]/10'
                        : 'hover:bg-[var(--surface-elevated)]/60'
                    }`}
                  >
                    <td className="py-3 px-4 max-w-md">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full shrink-0 ${
                            report.status === 'ACTION_NEEDED'
                              ? 'bg-[var(--semantic-warning)]'
                              : 'bg-[var(--semantic-success)]'
                          }`}
                        />
                        <span className="font-bold text-[var(--text-main)] truncate">
                          {report.title}
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)] truncate mt-0.5 pl-4">
                        {report.subtitle}
                      </div>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${vBadge.className}`}
                      >
                        {vBadge.icon}
                        <span>{vBadge.label}</span>
                      </span>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenChatWithAgent?.(report.authorSlug);
                        }}
                        className="font-mono text-xs text-[var(--surface-accent)] hover:underline cursor-pointer"
                      >
                        {report.authorSlug}
                      </button>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span className="rounded-lg bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-1 text-[11px] font-mono text-[var(--semantic-success)] font-semibold">
                        {report.keyMetric}
                      </span>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap font-mono text-[11px] text-[var(--text-main)]">
                      {report.tokenBurnLabel}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="text-[11px] font-mono text-[var(--text-main)]">{report.date}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">{report.cadenceLabel}</div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedReportId(report.id);
                          }}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition cursor-pointer ${
                            isSelected
                              ? 'bg-[var(--surface-accent)]/15 text-[var(--surface-accent)] border-[var(--surface-accent)]/40'
                              : 'bg-[var(--surface-elevated)] text-[var(--text-main)] border-[var(--surface-border)] hover:border-[var(--surface-border-strong)]'
                          }`}
                        >
                          Inspect
                        </button>
                        {onOpenReportWindowTab && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenReportWindowTab(report);
                            }}
                            title="Open report in dedicated top window tab"
                            className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-elevated)] border border-[var(--surface-border)] hover:border-[var(--surface-accent)] px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--surface-accent)] transition cursor-pointer"
                          >
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Active Report Reader Panel */}
      {activeReport && (
        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--surface-border)]">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    VERTICAL_BADGE_STYLE[activeReport.vertical].className
                  }`}
                >
                  {VERTICAL_BADGE_STYLE[activeReport.vertical].icon}
                  <span>{VERTICAL_BADGE_STYLE[activeReport.vertical].label}</span>
                </span>
                <span className="text-xs font-mono text-[var(--surface-accent)]">{activeReport.filePath}</span>
                <span className="rounded bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-0.5 text-[10px] font-mono text-[var(--text-muted)]">
                  {activeReport.tokenBurnLabel}
                </span>
              </div>
              <h2 className="text-sm sm:text-base font-bold text-[var(--text-main)] mt-1">
                {activeReport.title}
              </h2>
              {(activeReport.linkedBacklogIds || []).length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap mt-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                    Linked tasks:
                  </span>
                  {(activeReport.linkedBacklogIds || []).map((taskId) => {
                    const task = (backlogItems || []).find((b) => b.id === taskId);
                    return (
                      <button
                        key={taskId}
                        type="button"
                        onClick={() => {
                          if (onOpenBacklogItem) onOpenBacklogItem(taskId);
                          else onOpenBacklog?.();
                        }}
                        title={task?.title || taskId}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--surface-accent)]/40 bg-[var(--surface-accent)]/10 hover:bg-[var(--surface-accent)]/20 px-2 py-1 text-[11px] font-semibold text-[var(--surface-accent)] transition cursor-pointer max-w-[260px]"
                      >
                        <span className="truncate">{task?.title || taskId}</span>
                        {task && (
                          <span className="shrink-0 font-mono text-[10px] opacity-80">
                            {task.stage}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {activeReport.isStandupMom && (
                <div className="flex items-center gap-1 rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-border)] p-1">
                  {(
                    [
                      { id: 'full_mom', label: 'Rendered MoM' },
                      { id: 'needs_ceo', label: `Needs CEO (${REPORT_NEEDS_CEO_CARDS.length})` },
                      { id: 'weekly_plan', label: 'Weekly Plan' },
                      { id: 'movements', label: 'Movements' },
                      { id: 'raw', label: 'Raw MD' },
                    ] as { id: ReportSubTab; label: string }[]
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveSubTab(tab.id)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                        activeSubTab === tab.id
                          ? 'bg-[var(--surface-accent)]/15 text-[var(--surface-accent)] border border-[var(--surface-accent)]/40 shadow-xs'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={handleCopyMarkdown}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-border)] hover:bg-[var(--surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--text-main)] transition cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[var(--semantic-success)]" />
                    <span className="text-[var(--semantic-success)] font-semibold">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                    <span>Copy MD</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Reader Body */}
          {!activeReport.isStandupMom || activeSubTab === 'full_mom' ? (
            <div className="rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-border-subtle)] p-4 sm:p-5 text-[var(--text-main)]">
              <MarkdownRenderer content={activeReport.markdownContent} />
            </div>
          ) : activeSubTab === 'needs_ceo' ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
              {REPORT_NEEDS_CEO_CARDS.map((card) => (
                <div
                  key={card.id}
                  className="rounded-xl border border-[var(--semantic-alert)]/35 bg-[var(--surface-elevated)] p-4 flex flex-col justify-between gap-3 shadow-xs"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-md bg-[var(--semantic-alert)]/15 border border-[var(--semantic-alert)]/40 px-2 py-0.5 text-[10px] font-mono font-bold text-[var(--semantic-alert)]">
                        {card.priority} • {card.project}
                      </span>
                      <span className="text-[11px] font-mono text-[var(--surface-accent)] font-semibold">{card.requester}</span>
                    </div>
                    <h3 className="text-xs font-bold text-[var(--text-main)]">{card.id} ({card.type})</h3>
                    <p className="text-xs text-[var(--text-muted)]">{card.desc}</p>
                    <div className="rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] p-2 text-[11px] font-mono text-[var(--semantic-warning)] flex items-center gap-1.5">
                      <Key className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">Unblocks {card.unblocks}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-[var(--surface-border-subtle)]">
                    {onOpenBacklog && (
                      <button
                        type="button"
                        onClick={onOpenBacklog}
                        className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-[var(--semantic-alert)]/15 border border-[var(--semantic-alert)]/40 hover:bg-[var(--semantic-alert)]/25 px-2.5 py-1.5 text-[11px] font-semibold text-[var(--semantic-alert)] transition cursor-pointer"
                      >
                        <span>Resolve in Backlog</span>
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                    {onOpenChatWithAgent && (
                      <button
                        type="button"
                        onClick={() => onOpenChatWithAgent(card.requester)}
                        className="inline-flex items-center justify-center gap-1 rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] hover:bg-[var(--surface-muted)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-main)] transition cursor-pointer"
                      >
                        <span>Ping {card.requester}</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : activeSubTab === 'weekly_plan' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {REPORT_WEEKLY_PLAN.map((proj) => (
                <div
                  key={proj.project}
                  className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-elevated)] p-4 space-y-2.5 shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--text-main)] uppercase font-mono">
                      {proj.project}
                    </span>
                    <span className="text-[11px] font-mono text-[var(--surface-accent)] font-semibold">{proj.owner}</span>
                  </div>
                  <p className="text-xs text-[var(--semantic-success)] font-medium">{proj.title}</p>
                  <ul className="space-y-1">
                    {proj.tasks.map((item: string, idx: number) => (
                      <li key={idx} className="text-xs text-[var(--text-main)] flex items-start gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-[var(--semantic-action)] shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : activeSubTab === 'movements' ? (
            <div className="space-y-2">
              {REPORT_TASK_MOVEMENTS.map((mov) => (
                <div
                  key={mov.id}
                  className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-elevated)] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono uppercase text-[var(--surface-accent)] font-semibold">
                        {mov.project}
                      </span>
                      <span className="text-xs font-bold text-[var(--text-main)]">{mov.id}</span>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">{mov.reason}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 font-mono text-[10px]">
                    <span className="rounded bg-[var(--surface-panel)] border border-[var(--surface-border)] px-2 py-0.5 text-[var(--text-main)]">
                      {mov.movement}
                    </span>
                    <span className="rounded bg-[var(--semantic-success)]/15 border border-[var(--semantic-success)]/40 px-2 py-0.5 text-[var(--semantic-success)] font-semibold">
                      {mov.priority}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <pre className="rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-border)] p-4 text-xs font-mono text-[var(--text-main)] overflow-x-auto whitespace-pre-wrap">
              {activeReport.markdownContent}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};
