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
  INITIAL_STANDUP_REPORTS,
  REPORT_NEEDS_CEO_CARDS,
  REPORT_TASK_MOVEMENTS,
  REPORT_WEEKLY_PLAN,
} from '../data/reportsData';
import type { VerticalScope } from './ConsultationKnob';
import { MarkdownRenderer } from './MarkdownRenderer';

export interface UnifiedReportItem {
  id: string;
  title: string;
  subtitle: string;
  vertical: Exclude<VerticalScope, 'ALL'>;
  authorSlug: string;
  projectSlug: string;
  date: string;
  cadenceLabel: string;
  keyMetric: string;
  tokenBurnLabel: string;
  filePath: string;
  status: 'ACTION_NEEDED' | 'VERIFIED' | 'LIVE_AUDIT';
  markdownContent: string;
  isStandupMom?: boolean;
}

interface ReportsViewProps {
  activeVertical?: VerticalScope;
  onTriggerStandupNow: () => Promise<void>;
  onOpenBacklog?: () => void;
  onOpenChatWithAgent?: (slug: string) => void;
  onOpenReportWindowTab?: (report: UnifiedReportItem) => void;
}

export type ReportSubTab = 'full_mom' | 'needs_ceo' | 'weekly_plan' | 'movements' | 'raw';

export const UNIFIED_REPORTS_CATALOG: UnifiedReportItem[] = [
  {
    id: 'rep-standup-2026-10-27',
    title: 'Daily Standup MoM & CEO Intervention Queue',
    subtitle: 'Cross-vertical 12:00 PM IST rollup: Needs CEO queue, weekly sprint lock, and task movements.',
    vertical: 'TECH',
    authorSlug: '@pm',
    projectSlug: 'all-projects',
    date: '2026-10-27',
    cadenceLabel: '12:00 PM IST Daily',
    keyMetric: '3 Needs CEO • 94.2% Saved',
    tokenBurnLabel: '2.4K tok',
    filePath: 'standups/2026-10-27-standup.md',
    status: 'ACTION_NEEDED',
    markdownContent:
      INITIAL_STANDUP_REPORTS[0]?.markdown_content ||
      '# Daily Standup MoM — 2026-10-27\n\nAll Level 1 & Level 2 agents reported on schedule.',
    isStandupMom: true,
  },
  {
    id: 'rep-token-firewall-audit',
    title: 'Bottom-Heavy Token Firewall Consumption Audit',
    subtitle: 'Net payload tokens vs raw repo file reads prevented across Root, Level 0, Level 1, and Level 2.',
    vertical: 'TECH',
    authorSlug: '@warden',
    projectSlug: 'warden',
    date: '2026-10-27',
    cadenceLabel: 'Per-Session Auto',
    keyMetric: '11.1K net vs 192K raw',
    tokenBurnLabel: '1.1K tok',
    filePath: 'standups/token-report-2026-10-27.md',
    status: 'VERIFIED',
    markdownContent: `# Token Firewall Consumption Audit (2026-10-27)

## Executive Telemetry Summary
- **Net Payload Consumed**: \`11,140 tokens\` across 13 turns (\`~857 tok/turn\`)
- **Context Firewall Savings**: \`94.2%\` (\`181.4K tokens\` saved by keeping source reads in Level 2 mirrors)
- **Root (\`warden\`) Turn Average**: \`920 tok/turn\` (Budget cap: \`<= 1,500 tok/turn\`)
- **Level 0 (\`cto\` / \`cbo\`) Turn Average**: \`2,640 tok/turn\` (Budget cap: \`<= 4,000 tok/turn\`)

## Per-Vertical Breakdown
- **Tech Vertical**: \`5.8K tok\` across \`@cto\`, \`@pm\`, \`@tech_lead\`, \`@frontend_dev\`, \`@backend_dev\`
- **SEO / AEO Vertical**: \`2.9K tok\` across \`@cbo\`, \`@aeo_lead\`, \`@aeo_specialist\`
- **Social Media Vertical**: \`2.4K tok\` across \`@social_lead\`, \`@social_creator\``,
  },
  {
    id: 'rep-pulse-checkout-latency',
    title: 'NovaPulse Checkout WebSocket Sync & Edge Build Audit',
    subtitle: 'Deterministic cart state checksums, multi-region edge rollout, and Stripe webhook idempotency readiness.',
    vertical: 'TECH',
    authorSlug: '@tech_lead',
    projectSlug: 'pulse-core',
    date: '2026-10-27',
    cadenceLabel: 'Sprint Milestone',
    keyMetric: '14ms RTT • 99.98% uptime',
    tokenBurnLabel: '3.1K tok',
    filePath: 'context/pulse-core/pulse-api.md',
    status: 'LIVE_AUDIT',
    markdownContent: `# NovaPulse Checkout & Multi-Region Edge Technical Audit

## Key Telemetry
- **Active Storefront Traffic**: \`~14,200 sessions/day\` across North America & EU edge PoPs (\`~1,850 checkouts/day\`)
- **Cart State Sync Tick**: \`20Hz\` authoritative state sync with \`14ms\` median RTT
- **Edge Bundle Optimization**: Reduced initial storefront JS hydration footprint by \`38%\` on mobile Safari
- **Next Gate**: Approve Cloudflare Workers edge bundle and enterprise SLA failover verification.`,
  },
  {
    id: 'rep-aeo-citation-share',
    title: 'LLM Citation Share & Answer Engine Visibility Audit',
    subtitle: 'Share-of-voice tracking across Meta AI answers and Muse for AI Commerce & Growth SaaS queries.',
    vertical: 'SEO_AEO',
    authorSlug: '@aeo_lead',
    projectSlug: 'pulse-seo',
    date: '2026-10-27',
    cadenceLabel: 'Weekly AEO Audit',
    keyMetric: '34.8% Citation Share (+9.2%)',
    tokenBurnLabel: '1.9K tok',
    filePath: 'reports/aeo-citation-audit-2026-10.md',
    status: 'ACTION_NEEDED',
    markdownContent: `# Answer Engine Optimization (AEO) Citation Audit

## LLM Citation Share by Engine
- **Perplexity AI**: \`41.2%\` citation rate on *"best AI commerce growth engine"* and *"automated AEO schema SaaS"*
- **Meta AI answers**: \`32.5%\` direct link inclusion when querying AI-native storefront optimization platforms
- **Meta AI summaries**: \`30.7%\` structured card presence via \`SoftwareApplication\` JSON-LD schema

## Recommended High-EV Actions
- Publish \`/llms.txt\` and \`/llms-full.txt\` on \`novapulse.io\` and \`docs.novapulse.io\`
- Expand FAQ schema blocks comparing instant edge storefront hydration vs legacy monolithic commerce stacks`,
  },
  {
    id: 'rep-seo-jsonld-clusters',
    title: 'Programmatic JSON-LD Schema & High-Intent Keyword Clusters',
    subtitle: 'Structured data validation and zero-click SERP snippet optimization across NovaPulse product & comparison pages.',
    vertical: 'SEO_AEO',
    authorSlug: '@aeo_specialist',
    projectSlug: 'pulse-seo',
    date: '2026-10-26',
    cadenceLabel: 'Bi-Weekly Crawl',
    keyMetric: '100% Schema Valid • +420 clicks/wk',
    tokenBurnLabel: '2.1K tok',
    filePath: 'reports/seo-jsonld-clusters.md',
    status: 'VERIFIED',
    markdownContent: `# Programmatic JSON-LD & Keyword Cluster Report

## Schema Validation Status
- **\`Product\` + \`SoftwareApplication\` JSON-LD**: Validated across 14 static routes with zero warnings
- **Top Converting Queries**: *"autonomous AI commerce checkout"*, *"programmatic AEO llms.txt generator"*, *"sub-15ms headless storefront"*
- **Core Web Vitals**: LCP \`1.1s\` on Cloudflare Pages edge cache`,
  },
  {
    id: 'rep-social-hook-retention',
    title: 'Short-Form Product Demo Hook Retention & Viral Velocity Report',
    subtitle: '3-second thumb-stop rate and completion telemetry across X, Reels, Shorts, and LinkedIn product cuts.',
    vertical: 'SOCIAL',
    authorSlug: '@social_lead',
    projectSlug: 'pulse-social',
    date: '2026-10-27',
    cadenceLabel: '48h Creative Loop',
    keyMetric: '68.4% 3s Hold • +18.4K views',
    tokenBurnLabel: '1.7K tok',
    filePath: 'reports/social-hook-retention.md',
    status: 'ACTION_NEEDED',
    markdownContent: `# Short-Form Video Hook Retention Report

## Creative Variant Performance
- **Hook Variant A (0.8s Live Revenue Ticker Morph → Instant AI Checkout)**: \`68.4%\` 3-second hold rate, \`41.2%\` full-watch completion
- **Hook Variant B (Split-Screen Legacy Storefront vs NovaPulse Edge)**: \`61.9%\` 3-second hold rate, \`3.8%\` link click-through rate
- **Action Needed**: Approve batch scheduling of 5 new product demo clips for peak US/EU SaaS buyer hours`,
  },
  {
    id: 'rep-social-founder-funnel',
    title: 'Founder X / LinkedIn Build-in-Public Growth & Demo Funnel Report',
    subtitle: 'Technical build-in-public thread impressions, community signups, and enterprise inbound metrics.',
    vertical: 'SOCIAL',
    authorSlug: '@social_creator',
    projectSlug: 'pulse-social',
    date: '2026-10-26',
    cadenceLabel: 'Weekly Funnel',
    keyMetric: '4.6% Engagement • 310 clicks',
    tokenBurnLabel: '1.5K tok',
    filePath: 'reports/founder-social-funnel.md',
    status: 'VERIFIED',
    markdownContent: `# Founder X & LinkedIn Build-in-Public Funnel

## Channel Highlights
- **X (Twitter) Engineering Threads**: Sub-15ms edge checkout & webhook idempotency thread reached \`24.5K impressions\` (\`4.9%\` engagement)
- **LinkedIn Executive Posts**: Autonomous Workforce OS & AI Commerce architecture post drove \`310 outbound clicks\`
- **Next Scheduled Post**: Behind-the-scenes showcase of Autonomous Support Deflection in \`pulse-support\``,
  },
];

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
  onTriggerStandupNow,
  onOpenBacklog,
  onOpenChatWithAgent,
  onOpenReportWindowTab,
}) => {
  const [localVertical, setLocalVertical] = useState<VerticalScope>(activeVertical);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReportId, setSelectedReportId] = useState<string>(
    UNIFIED_REPORTS_CATALOG[0].id
  );
  const [activeSubTab, setActiveSubTab] = useState<ReportSubTab>('full_mom');
  const [copied, setCopied] = useState(false);
  const [isPolling, setIsPolling] = useState(false);

  useEffect(() => {
    setLocalVertical(activeVertical);
  }, [activeVertical]);

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
