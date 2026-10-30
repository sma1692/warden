import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Cpu,
  HelpCircle,
  Megaphone,
  MessageSquarePlus,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  loadConsultationKnobConfig,
  type ConsultationKnobConfig,
  type ConsultationLevel,
  type VerticalScope,
} from './ConsultationKnob';

export interface PriorityQuestionOption {
  id: string;
  label: string;
  summary: string;
  recommended?: boolean;
}

export interface PriorityDecisionItem {
  id: string;
  vertical: 'TECH' | 'SEO_AEO' | 'SOCIAL';
  verticalLabel: string;
  projectSlug: string;
  agentSlug: string;
  agentRole: string;
  priority: 'P0' | 'P1';
  impactBadge: string;
  // Level 1 (Decisive / Autopilot) high-level execution approval
  decisiveTitle: string;
  decisiveSummary: string;
  decisiveCtaLabel: string;
  // Level 2 & 3 (Contract Gate & Interactive Co-Architect) question & options
  questionTitle: string;
  questionPrompt: string;
  principleTag: string;
  options: PriorityQuestionOption[];
  // Extra Level 3 deep co-design principle question
  coArchitectFollowUp: string;
  coArchitectPills: string[];
}

const PRIORITY_ITEMS: PriorityDecisionItem[] = [
  {
    id: 'prio_tech_pulse_core',
    vertical: 'TECH',
    verticalLabel: 'Tech',
    projectSlug: 'pulse-core',
    agentSlug: '@cto',
    agentRole: 'Head of Tech + @tech_lead',
    priority: 'P0',
    impactBadge: '$180K Enterprise ARR Gate',
    decisiveTitle: 'Approve Prod Deploy: pulse-core v3 Checkout & Real-Time Event Bus',
    decisiveSummary:
      '@cto selected Authoritative REST + WebSocket relay (pulse-api) with Dedicated Worker Pool queue processing (<25ms P99 latency). Ready to push to origin/main.',
    decisiveCtaLabel: 'Approve Prod Deploy',
    questionTitle:
      'Architecture Principle: pulse-core Real-Time Event Streaming vs Edge Polling',
    questionPrompt:
      'Before we lock contracts/pulse-core-v3.md, how should we balance deterministic billing state authority vs edge latency for enterprise checkout webhooks?',
    principleTag: 'API & Latency Principle',
    options: [
      {
        id: 'opt_ws_relay',
        label: 'A. Authoritative WebSocket + Idempotent Outbox Relay (pulse-api)',
        summary:
          'Server-authoritative transactional outbox on pulse-api with <25ms P99 latency and zero duplicate webhook deliveries.',
        recommended: true,
      },
      {
        id: 'opt_edge_sse',
        label: 'B. Multi-Region Edge SSE Stream',
        summary:
          'Server-Sent Events pushed from Cloudflare Workers edge cache with eventual consistency reconciliation.',
      },
      {
        id: 'opt_hybrid_queue',
        label: 'C. Hybrid Queue + Snapshot Rollback',
        summary:
          'Ephemeral Redis Streams edge state with asynchronous Postgres ledger settlement.',
      },
    ],
    coArchitectFollowUp:
      'Level 3 Co-Architect Principle: Where should customer invoice PDF & telemetry aggregation run during peak checkout?',
    coArchitectPills: [
      'Dedicated Worker Pool (Zero Main-Thread Jank)',
      'Streaming Edge Function Pipeline',
      'Pre-computed Materialized View after 1st Event',
    ],
  },
  {
    id: 'prio_aeo_citations',
    vertical: 'SEO_AEO',
    verticalLabel: 'SEO/AEO',
    projectSlug: 'pulse-seo',
    agentSlug: '@aeo_lead',
    agentRole: 'Head of SEO/AEO + @cbo',
    priority: 'P0',
    impactBadge: '+2,400 Daily Organic Views',
    decisiveTitle: 'Approve AEO Schema Patch: SoftwareApplication JSON-LD & /llms.txt Citation Graph',
    decisiveSummary:
      '@aeo_lead prepared entity-first SoftwareApplication + FAQPage JSON-LD and /llms.txt endpoints on novapulse.io targeting Perplexity, ChatGPT Search, and Google AI Overviews.',
    decisiveCtaLabel: 'Approve AEO Schema Patch',
    questionTitle:
      'Citation Targeting Principle for LLM Answer Engines (Perplexity, ChatGPT, AI Overviews)',
    questionPrompt:
      'Which primary citation & entity authority principle should guide our programmatic SEO/AEO rollout across novapulse.io commerce and support automation search intents?',
    principleTag: 'AEO Entity & Citation Principle',
    options: [
      {
        id: 'opt_entity_llms_txt',
        label: 'A. Entity-First JSON-LD Graph + /llms.txt Canonical Feed',
        summary:
          'Structured SoftwareApplication + FAQPage schema paired with machine-readable /llms.txt benchmark tables for direct LLM grounding.',
        recommended: true,
      },
      {
        id: 'opt_comparison_clusters',
        label: 'B. Zero-Click SaaS Comparison & Category Authority Pages',
        summary:
          'Publish high-intent "Best AI Commerce & Support Platforms 2026" answer blocks with verified ROI tables.',
      },
      {
        id: 'opt_devlog_backlinks',
        label: 'C. Technical Benchmark Citation Syndication',
        summary:
          'Syndicate sub-25ms checkout latency & AI support deflection benchmarks to GitHub Discussions and HackerNews for high-DR seed citations.',
      },
    ],
    coArchitectFollowUp:
      'Level 3 Co-Architect Principle: How should @aeo_specialist gate programmatic landing page updates?',
    coArchitectPills: [
      'Auto-deploy Schema + Stage Copy in contracts/aeo.md',
      '100% Autonomous Publish on High-Confidence Keywords',
      'Require @cbo EV Sign-Off per Cluster',
    ],
  },
  {
    id: 'prio_social_cadence',
    vertical: 'SOCIAL',
    verticalLabel: 'Social Media',
    projectSlug: 'pulse-social',
    agentSlug: '@social_lead',
    agentRole: 'Social Growth Lead + @social_creator',
    priority: 'P1',
    impactBadge: '3.8x Hook Retention Target',
    decisiveTitle: 'Approve Weekly Social Batch: 5 Product Demo Reels + 4 Founder Growth Threads',
    decisiveSummary:
      '@social_lead queued a 60/40 Technical Founder Log + High-Converting Product Demo clip schedule across X, LinkedIn, Reels, and Shorts for NovaPulse.',
    decisiveCtaLabel: 'Approve 7-Day Social Batch',
    questionTitle:
      'Brand Voice & Hook Cadence Principle for Founder X/LinkedIn + Product Reels',
    questionPrompt:
      'What core narrative identity and first-2-second hook principle should @social_creator enforce across this week’s multi-channel NovaPulse distribution?',
    principleTag: 'Brand Voice & Hook Principle',
    options: [
      {
        id: 'opt_founder_eng_logs',
        label: 'A. Raw Founder Engineering Logs + Live ROI Metrics (60/40 Split)',
        summary:
          'Pair hard engineering proof (sub-25ms checkout API, 78% AI ticket deflection) on X/LinkedIn with 15s product demo Reels.',
        recommended: true,
      },
      {
        id: 'opt_viral_gameplay',
        label: 'B. High-Velocity 15s Customer Transformation & ROI Hooks',
        summary:
          'Maximize top-of-funnel SaaS buyer impressions with before/after conversion lift visuals and instant interactive demo links.',
      },
      {
        id: 'opt_build_in_public',
        label: 'C. AI Workforce "Autonomous SaaS" Build-in-Public Series',
        summary:
          'Showcase NovaPulse multi-agent orchestration + live token firewall savings to attract enterprise founders.',
      },
    ],
    coArchitectFollowUp:
      'Level 3 Co-Architect Principle: What opening hook style should @social_creator use in the first 1.8 seconds?',
    coArchitectPills: [
      'Hard Metric Callout ("94.2% Token Cut / +38% Checkout Lift")',
      'Visual Live Dashboard Cold Open (Zero Text Delay)',
      'Contrarian SaaS Architecture Question Hook',
    ],
  },
];

interface HomePriorityWindowProps {
  activeVertical?: VerticalScope;
  knobConfig?: ConsultationKnobConfig;
  onOpenAgentTab?: (agentSlug: string) => void;
  onOpenBacklogsTab?: () => void;
  onDecisionRecorded?: (summary: string) => void;
}

export const HomePriorityWindow: React.FC<HomePriorityWindowProps> = ({
  activeVertical = 'ALL',
  knobConfig: externalKnobConfig,
  onOpenAgentTab,
  onOpenBacklogsTab,
  onDecisionRecorded,
}) => {
  const [knobConfig, setKnobConfig] = useState<ConsultationKnobConfig>(() =>
    externalKnobConfig || loadConsultationKnobConfig()
  );

  // Selected option per item
  const [selectedOptionById, setSelectedOptionById] = useState<Record<string, string>>({
    prio_tech_pulse_core: 'opt_ws_relay',
    prio_aeo_citations: 'opt_entity_llms_txt',
    prio_social_cadence: 'opt_founder_eng_logs',
  });

  // Selected Level 3 co-architect pill per item
  const [selectedCoPillById, setSelectedCoPillById] = useState<Record<string, string>>({
    prio_tech_pulse_core: 'Dedicated Worker Pool (Zero Main-Thread Jank)',
    prio_aeo_citations: 'Auto-deploy Schema + Stage Copy in contracts/aeo.md',
    prio_social_cadence: 'Hard Metric Callout ("94.2% Token Cut / +38% Checkout Lift")',
  });

  // Custom CEO guidance text per item
  const [customNoteById, setCustomNoteById] = useState<Record<string, string>>({});

  // Resolved state per item
  const [resolvedById, setResolvedById] = useState<
    Record<string, { decisionText: string; resolvedAt: string; levelUsed: ConsultationLevel }>
  >({});

  useEffect(() => {
    if (externalKnobConfig) {
      setKnobConfig(externalKnobConfig);
    }
  }, [externalKnobConfig]);

  useEffect(() => {
    const onKnobChange = (e: Event) => {
      const custom = e as CustomEvent<ConsultationKnobConfig>;
      if (custom.detail) {
        setKnobConfig(custom.detail);
      }
    };
    window.addEventListener('commando:consultation-knob-change', onKnobChange);
    return () =>
      window.removeEventListener('commando:consultation-knob-change', onKnobChange);
  }, []);

  const visibleItems = useMemo(() => {
    if (activeVertical === 'ALL') return PRIORITY_ITEMS;
    return PRIORITY_ITEMS.filter((item) => item.vertical === activeVertical);
  }, [activeVertical]);

  const pendingCount = useMemo(
    () => visibleItems.filter((i) => !resolvedById[i.id]).length,
    [visibleItems, resolvedById]
  );

  const handleResolveItem = (item: PriorityDecisionItem, level: ConsultationLevel) => {
    let summary = '';
    if (level === 1) {
      summary = `${item.decisiveCtaLabel} approved in Autopilot Mode`;
    } else {
      const chosenOpt =
        item.options.find((o) => o.id === selectedOptionById[item.id]) ||
        item.options[0];
      const coPill = level === 3 ? ` + [${selectedCoPillById[item.id]}]` : '';
      const note = customNoteById[item.id]?.trim()
        ? ` — CEO Note: "${customNoteById[item.id].trim()}"`
        : '';
      summary = `Locked ${chosenOpt.label}${coPill}${note}`;
    }

    setResolvedById((prev) => ({
      ...prev,
      [item.id]: {
        decisionText: summary,
        resolvedAt: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
        levelUsed: level,
      },
    }));
    onDecisionRecorded?.(`${item.agentSlug} (${item.verticalLabel}): ${summary}`);
  };

  const getVerticalBadgeStyle = (vertical: 'TECH' | 'SEO_AEO' | 'SOCIAL') => {
    if (vertical === 'TECH') {
      return {
        pill: 'bg-[var(--surface-accent-gold)]/15 text-[var(--surface-accent-gold)] border-[var(--surface-accent-gold)]/30',
        icon: <Cpu className="h-3 w-3 text-[var(--surface-accent-gold)]" />,
      };
    }
    if (vertical === 'SEO_AEO') {
      return {
        pill: 'bg-[var(--surface-accent)]/15 text-[var(--surface-accent)] border-[var(--surface-accent)]/30',
        icon: <Search className="h-3 w-3 text-[var(--surface-accent)]" />,
      };
    }
    return {
      pill: 'bg-[var(--surface-elevated)] text-[var(--surface-text)] border-[var(--surface-border-strong)]',
      icon: <Megaphone className="h-3 w-3 text-[var(--surface-text-secondary)]" />,
    };
  };

  return (
    <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] text-[var(--surface-text)] shadow-xl flex flex-col h-full min-h-0 overflow-hidden">
      {/* Top Window Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--surface-border)] p-4 sm:p-5 shrink-0 bg-[var(--surface-elevated)] z-10">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/30 text-[var(--surface-accent-gold)] shadow-inner">
            <AlertTriangle className="h-5 w-5 text-[var(--surface-accent-gold)]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-bold text-[var(--surface-text)]">
                Top Priority `[NEEDS_CEO]` Decision &amp; Co-Design Window
              </h2>
              <span className="rounded-full bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/30 px-2.5 py-0.5 text-[11px] font-mono font-bold text-[var(--surface-accent-gold)]">
                {pendingCount} Active {pendingCount === 1 ? 'Item' : 'Items'}
              </span>
            </div>
            <p className="text-xs text-[var(--surface-text-secondary)] mt-0.5">
              Live across <strong className="text-[var(--surface-accent-gold)]">Tech</strong>,{' '}
              <strong className="text-[var(--surface-accent)]">SEO/AEO</strong>, and{' '}
              <strong className="text-[var(--surface-text)]">Social Media</strong>.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center">
          {Object.keys(resolvedById).length > 0 && (
            <button
              type="button"
              onClick={() => setResolvedById({})}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] hover:bg-[var(--surface-elevated)] px-2.5 py-1.5 text-[11px] font-mono text-[var(--surface-text)] transition cursor-pointer"
            >
              <RotateCcw className="h-3 w-3 text-[var(--surface-accent)]" />
              <span>Reopen All ({Object.keys(resolvedById).length})</span>
            </button>
          )}
          {onOpenBacklogsTab && (
            <button
              type="button"
              onClick={onOpenBacklogsTab}
              className="inline-flex items-center gap-1 rounded-xl border border-[var(--surface-accent)]/30 bg-[var(--surface-accent)]/10 hover:bg-[var(--surface-accent)]/20 px-3 py-1.5 text-xs font-semibold text-[var(--surface-accent)] transition cursor-pointer"
            >
              <span>Full Queue</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Priority Cards List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4">
        {visibleItems.map((item) => {
          const vLevel: ConsultationLevel = knobConfig.perVerticalLevel[item.vertical] || knobConfig.globalLevel;
          const qCount = knobConfig.questionsPerVertical[item.vertical] ?? 2;
          const vStyle = getVerticalBadgeStyle(item.vertical);
          const resolved = resolvedById[item.id];
          const selectedOptId = selectedOptionById[item.id] || item.options[0].id;
          const selectedCoPill =
            selectedCoPillById[item.id] || item.coArchitectPills[0];

          return (
            <div
              key={item.id}
              className={`rounded-2xl border p-4 transition ${
                resolved
                  ? 'border-[var(--surface-accent-gold)]/40 bg-[var(--surface-accent-gold)]/5'
                  : vLevel === 1
                    ? 'border-[var(--surface-border)] bg-[var(--surface-card)] hover:border-[var(--surface-accent)]/50'
                    : 'border-[var(--surface-accent-gold)]/40 bg-[var(--surface-card)] hover:border-[var(--surface-accent-gold)]/60 shadow-sm'
              }`}
            >
              {/* Card Top Metadata Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[var(--surface-border)]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-[var(--surface-accent)]/15 border border-[var(--surface-accent)]/30 px-1.5 py-0.5 text-[10px] font-mono font-bold text-[var(--surface-accent)]">
                    {item.priority}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-mono font-semibold ${vStyle.pill}`}
                  >
                    {vStyle.icon}
                    <span>{item.verticalLabel}</span>
                  </span>
                  <span className="rounded bg-[var(--surface-muted)] border border-[var(--surface-border)] px-2 py-0.5 text-[10px] font-mono text-[var(--surface-text-secondary)]">
                    {item.projectSlug}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenAgentTab?.(item.agentSlug)}
                    className="rounded bg-[var(--surface-accent)]/10 border border-[var(--surface-accent)]/30 hover:bg-[var(--surface-accent)]/20 px-2 py-0.5 text-[10px] font-mono font-bold text-[var(--surface-accent)] transition cursor-pointer"
                  >
                    {item.agentSlug}
                  </button>
                  <span className="text-[11px] text-[var(--surface-text-muted)] hidden sm:inline">
                    ({item.agentRole})
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-[var(--surface-accent-gold)]/10 border border-[var(--surface-accent-gold)]/30 px-2 py-0.5 text-[10px] font-mono text-[var(--surface-accent-gold)] font-medium">
                    {item.impactBadge}
                  </span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-mono font-bold border ${
                      vLevel === 1
                        ? 'bg-[var(--surface-elevated)] text-[var(--surface-text)] border-[var(--surface-border-strong)]'
                        : vLevel === 2
                          ? 'bg-[var(--surface-accent)]/15 text-[var(--surface-accent)] border-[var(--surface-accent)]/40'
                          : 'bg-[var(--surface-accent-gold)]/20 text-[var(--surface-accent-gold)] border-[var(--surface-accent-gold)]/50'
                    }`}
                  >
                    {vLevel === 1
                      ? 'L1 • Autopilot'
                      : vLevel === 2
                        ? `L2 • Contract (${qCount} Qs)`
                        : `L3 • Co-Architect (${qCount} Qs)`}
                  </span>
                </div>
              </div>

              {/* Resolved State */}
              {resolved ? (
                <div className="pt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 text-[var(--surface-accent-gold)] font-medium">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>
                      <strong>Dispatched to {item.agentSlug}:</strong> {resolved.decisionText}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-[var(--surface-text-muted)] shrink-0">
                    Resolved at {resolved.resolvedAt} (L{resolved.levelUsed})
                  </span>
                </div>
              ) : vLevel === 1 ? (
                /* LEVEL 1: DECISIVE / AUTOPILOT HIGH-LEVEL APPROVAL ROW */
                <div className="pt-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-[var(--surface-text)]">
                      <Zap className="h-4 w-4 text-[var(--surface-accent-gold)] shrink-0" />
                      <span>{item.decisiveTitle}</span>
                    </div>
                    <p className="text-xs text-[var(--surface-text-secondary)] leading-relaxed">
                      {item.decisiveSummary}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleResolveItem(item, 1)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--surface-accent-gold)] hover:brightness-110 text-black px-4 py-2 text-xs font-bold shadow-md transition cursor-pointer"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      <span>{item.decisiveCtaLabel}</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* LEVEL 2 & LEVEL 3: ACTIVE CO-DESIGN & PRINCIPLE QUESTION MODE */
                <div className="pt-3 space-y-3">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-[var(--surface-accent-gold)]">
                        <HelpCircle className="h-4 w-4 text-[var(--surface-accent-gold)] shrink-0" />
                        <span>{item.questionTitle}</span>
                      </div>
                      <span className="rounded bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/30 px-2 py-0.5 text-[10px] font-mono text-[var(--surface-accent-gold)]">
                        {item.principleTag}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--surface-text-secondary)] leading-relaxed">
                      {item.questionPrompt}
                    </p>
                  </div>

                  {/* Interactive Approach / Principle Option Pills */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    {item.options.map((opt) => {
                      const isSelected = selectedOptId === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() =>
                            setSelectedOptionById((prev) => ({
                              ...prev,
                              [item.id]: opt.id,
                            }))
                          }
                          className={`rounded-xl border p-2.5 text-left transition cursor-pointer flex flex-col justify-between gap-1.5 ${
                            isSelected
                              ? 'border-[var(--surface-accent)] bg-[var(--surface-accent)]/10 shadow-sm ring-1 ring-[var(--surface-accent)]/50'
                              : 'border-[var(--surface-border)] bg-[var(--surface-muted)] hover:border-[var(--surface-border-strong)]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-1.5">
                            <span
                              className={`text-xs font-bold leading-snug ${
                                isSelected ? 'text-[var(--surface-accent)]' : 'text-[var(--surface-text)]'
                              }`}
                            >
                              {opt.label}
                            </span>
                            {opt.recommended && (
                              <span className="shrink-0 rounded bg-[var(--surface-accent-gold)]/20 border border-[var(--surface-accent-gold)]/40 px-1.5 py-0.2 text-[9px] font-mono font-bold text-[var(--surface-accent-gold)]">
                                Rec
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-[var(--surface-text-secondary)] leading-relaxed">
                            {opt.summary}
                          </p>
                        </button>
                      );
                    })}
                  </div>

                  {/* Extra Level 3 Deep Co-Architect Principle Sub-Question */}
                  {vLevel === 3 && (
                    <div className="rounded-xl border border-[var(--surface-accent-gold)]/35 bg-[var(--surface-accent-gold)]/10 p-3 space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold text-[var(--surface-accent-gold)]">
                        <Sparkles className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />
                        <span>{item.coArchitectFollowUp}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {item.coArchitectPills.map((pill) => {
                          const active = selectedCoPill === pill;
                          return (
                            <button
                              key={pill}
                              type="button"
                              onClick={() =>
                                setSelectedCoPillById((prev) => ({
                                  ...prev,
                                  [item.id]: pill,
                                }))
                              }
                              className={`rounded-lg border px-2.5 py-1 text-[11px] font-mono transition cursor-pointer ${
                                active
                                  ? 'border-[var(--surface-accent)] bg-[var(--surface-accent)] text-white font-semibold shadow-sm'
                                  : 'border-[var(--surface-border)] bg-[var(--surface-panel)] text-[var(--surface-text-secondary)] hover:text-[var(--surface-text)]'
                              }`}
                            >
                              {pill}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Interactive CEO Principle Reply Input + Dispatch Button */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                    <div className="relative flex-1">
                      <MessageSquarePlus className="h-3.5 w-3.5 text-[var(--surface-text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={customNoteById[item.id] || ''}
                        onChange={(e) =>
                          setCustomNoteById((prev) => ({
                            ...prev,
                            [item.id]: e.target.value,
                          }))
                        }
                        placeholder={`Add custom principle or constraint for ${item.agentSlug} (optional)...`}
                        className="w-full rounded-xl bg-[var(--surface-muted)] border border-[var(--surface-border)] pl-8 pr-3 py-2 text-xs text-[var(--surface-text)] placeholder:text-[var(--surface-text-muted)] focus:outline-none focus:border-[var(--surface-accent)]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleResolveItem(item, vLevel)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[var(--surface-accent)] hover:bg-[var(--surface-accent-hover)] px-4 py-2 text-xs font-bold text-white shadow-md transition cursor-pointer shrink-0"
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>Lock Principle &amp; Dispatch</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
export default HomePriorityWindow;
