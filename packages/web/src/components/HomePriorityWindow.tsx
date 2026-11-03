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
    id: 'prio_tech_trophy_assets',
    vertical: 'TECH',
    verticalLabel: 'Tech',
    projectSlug: 'demo-project',
    agentSlug: '@tech_lead',
    agentRole: 'Tech Lead + game team',
    priority: 'P0',
    impactBadge: 'Trophy launch unblocked',
    decisiveTitle: 'Approve trophy asset batch: 12 sprites + 4 animations',
    decisiveSummary:
      '@tech_lead generated the trophy ladder art set from ASSETS_MANIFEST. Ready to merge into the demo game.',
    decisiveCtaLabel: 'Approve asset batch',
    questionTitle: 'Art style lock for the trophy ladder',
    questionPrompt:
      'Which style should the trophy art set lock to before agents animate it?',
    principleTag: 'Art direction',
    options: [
      {
        id: 'opt_neon_arcade',
        label: 'A. Neon arcade',
        summary: 'Bold glow sprites that read well in gameplay clips and reels.',
        recommended: true,
      },
      {
        id: 'opt_flat_vector',
        label: 'B. Flat vector',
        summary: 'Clean minimal icons, fastest to animate, matches the video style.',
      },
      {
        id: 'opt_pixel_retro',
        label: 'C. Pixel retro',
        summary: '16-bit nostalgia set. Distinctive but slowest to animate.',
      },
    ],
    coArchitectFollowUp: 'Where should the animated trophy frames live?',
    coArchitectPills: [
      'Sprite atlas in the game bundle',
      'Lazy-loaded animation pack',
      'CDN-hosted seasonal skins',
    ],
  },
  {
    id: 'prio_tech_crash_patch',
    vertical: 'TECH',
    verticalLabel: 'Tech',
    projectSlug: 'demo-project',
    agentSlug: '@frontend_dev',
    agentRole: 'Frontend Dev + support triage',
    priority: 'P0',
    impactBadge: 'Support case → hotfix',
    decisiveTitle: 'Approve hotfix: game crashes after the final move',
    decisiveSummary:
      'Support case reproduced: the arena crashes on match end. Patch ready with Playwright proof. One approval ships it.',
    decisiveCtaLabel: 'Approve hotfix',
    questionTitle: 'Hotfix scope',
    questionPrompt:
      'How much should this hotfix touch before the trophy launch?',
    principleTag: 'Fix scope',
    options: [
      {
        id: 'opt_guard_test',
        label: 'A. Guard + regression test',
        summary: 'Minimal end-state guard with a Playwright test. Ships today.',
        recommended: true,
      },
      {
        id: 'opt_endstate_refactor',
        label: 'B. End-state refactor',
        summary: 'Rework match-end flow fully. Safer long term, slips the launch.',
      },
      {
        id: 'opt_rollback_queue',
        label: 'C. Roll back + queue',
        summary: 'Revert to the last stable build and queue the fix for next sprint.',
      },
    ],
    coArchitectFollowUp: 'Should the crash replay go back to the reporter?',
    coArchitectPills: [
      'Auto-reply with the fix + deploy link',
      'Human support reply first',
      'Silent fix, note in changelog',
    ],
  },
  {
    id: 'prio_social_trophy_launch',
    vertical: 'SOCIAL',
    verticalLabel: 'Social Media',
    projectSlug: 'demo-project',
    agentSlug: '@social_lead',
    agentRole: 'Social Growth Lead',
    priority: 'P1',
    impactBadge: 'Trophy launch week',
    decisiveTitle: 'Approve trophy launch pack: 5 visuals + launch thread',
    decisiveSummary:
      '@social_lead cut the trophy launch visuals and the announcement thread from the new art set. Ready to post.',
    decisiveCtaLabel: 'Approve launch pack',
    questionTitle: 'Launch angle',
    questionPrompt:
      'Which angle should the trophy launch lead with?',
    principleTag: 'Launch narrative',
    options: [
      {
        id: 'opt_player_flex',
        label: 'A. Player flex clips',
        summary: 'Trophy unlock moments from real matches. Highest share rate.',
        recommended: true,
      },
      {
        id: 'opt_dev_diary',
        label: 'B. Dev diary',
        summary: 'How the art set was made, start to finish. Builds trust.',
      },
      {
        id: 'opt_season_countdown',
        label: 'C. Season countdown',
        summary: 'Daily teaser ladder into launch day. Slowest burn.',
      },
    ],
    coArchitectFollowUp: 'Which channel gets the premiere?',
    coArchitectPills: [
      'Reels + Shorts first',
      'X thread first',
      'All channels at once',
    ],
  },
  {
    id: 'prio_seo_trophy_cluster',
    vertical: 'SEO_AEO',
    verticalLabel: 'SEO/AEO',
    projectSlug: 'demo-project',
    agentSlug: '@seo_aeo_head',
    agentRole: 'SEO/AEO Lead',
    priority: 'P1',
    impactBadge: 'Launch search coverage',
    decisiveTitle: 'Approve trophy launch SEO cluster: 4 pages + FAQ schema',
    decisiveSummary:
      '@seo_aeo_head drafted the trophy guide cluster with FAQ schema so launch searches land on us.',
    decisiveCtaLabel: 'Approve SEO cluster',
    questionTitle: 'Keyword focus',
    questionPrompt:
      'Which search intent should the trophy cluster lead with?',
    principleTag: 'Search intent',
    options: [
      {
        id: 'opt_how_to',
        label: 'A. How-to trophy guides',
        summary: '"How to unlock every trophy" guides. Highest intent traffic.',
        recommended: true,
      },
      {
        id: 'opt_tier_lists',
        label: 'B. Tier lists + rankings',
        summary: 'Trophy tier lists. Strong shares, thinner intent.',
      },
      {
        id: 'opt_update_notes',
        label: 'C. Update notes hub',
        summary: 'Canonical launch notes page. Defensive coverage.',
      },
    ],
    coArchitectFollowUp: 'How fast should the cluster publish?',
    coArchitectPills: [
      'All four on launch day',
      'One per day through launch week',
      'Drip over two weeks',
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
    prio_tech_trophy_assets: 'opt_neon_arcade',
    prio_tech_crash_patch: 'opt_guard_test',
    prio_social_trophy_launch: 'opt_player_flex',
    prio_seo_trophy_cluster: 'opt_how_to',
  });

  // Selected Level 3 co-architect pill per item
  const [selectedCoPillById, setSelectedCoPillById] = useState<Record<string, string>>({
    prio_tech_trophy_assets: 'Sprite atlas in the game bundle',
    prio_tech_crash_patch: 'Auto-reply with the fix + deploy link',
    prio_social_trophy_launch: 'Reels + Shorts first',
    prio_seo_trophy_cluster: 'All four on launch day',
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
    window.addEventListener('warden:consultation-knob-change', onKnobChange);
    return () =>
      window.removeEventListener('warden:consultation-knob-change', onKnobChange);
  }, []);

  const visibleItems = useMemo(() => {
    if (activeVertical === 'ALL') return PRIORITY_ITEMS;
    return PRIORITY_ITEMS.filter((item) => item.vertical === activeVertical);
  }, [activeVertical]);

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
            <h2 className="text-base sm:text-lg font-bold text-[var(--surface-text)]">
              NEEDS ACTION
            </h2>
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
