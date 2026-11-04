import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Cpu,
  Eye,
  HelpCircle,
  Megaphone,
  MessageSquare,
  MessageSquarePlus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import {
  loadConsultationKnobConfig,
  type ConsultationKnobConfig,
  type ConsultationLevel,
  type VerticalScope,
} from './ConsultationKnob';
import type { BacklogItem, ChatThread } from '../types/warden';
import { DEMO_ORIGIN_THREAD_BY_BACKLOG, spawnThreadPrefix } from '../data/demoLinks';
import { TrophyAssetPreview } from './TrophyAssetPreview';
import { ErrorBoundary } from './ErrorBoundary';

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
  decisiveTitle: string;
  decisiveSummary: string;
  decisiveCtaLabel: string;
  questionTitle: string;
  questionPrompt: string;
  principleTag: string;
  options: PriorityQuestionOption[];
  coArchitectFollowUp: string;
  coArchitectPills: string[];
}

const PRIORITY_ITEMS: PriorityDecisionItem[] = [
  {
    id: 'prio_tech_lobby_bootstrap',
    vertical: 'TECH',
    verticalLabel: 'Tech',
    projectSlug: 'demo-project',
    agentSlug: '@frontend_dev',
    agentRole: 'Frontend Dev + game team',
    priority: 'P0',
    impactBadge: 'Entry flow unblocked',
    decisiveTitle: 'Lobby bootstrap: loading screen + logo + Play',
    decisiveSummary:
      '@tech_lead scoped the entry flow: branded loading screen with the proper logo, then a lobby with a Play button. Pure agentic build, no art generation.',
    decisiveCtaLabel: 'Approve',
    questionTitle: 'Lobby scope for launch',
    questionPrompt:
      'How much lobby should ship before the trophy launch?',
    principleTag: 'Entry scope',
    options: [
      {
        id: 'opt_lobby_play_only',
        label: 'A. Loading + lobby + Play',
        summary: 'Branded loader, logo lockup, lobby with one Play button. Ships today.',
        recommended: true,
      },
      {
        id: 'opt_lobby_presence',
        label: 'B. Plus presence',
        summary: 'Adds live player counts and lobby presence. One extra day.',
      },
      {
        id: 'opt_lobby_matchmaking',
        label: 'C. Plus matchmaking',
        summary: 'Full queue + party invites. Slips the trophy launch.',
      },
    ],
    coArchitectFollowUp: 'Where should the logo lockup live?',
    coArchitectPills: [
      'Shared game-client header',
      'Loader only, lobby stays clean',
      'Loader + lobby + PWA icon',
    ],
  },
  {
    id: 'prio_tech_trophy_assets',
    vertical: 'TECH',
    verticalLabel: 'Tech',
    projectSlug: 'demo-project',
    agentSlug: '@tech_lead',
    agentRole: 'Tech Lead + game team',
    priority: 'P0',
    impactBadge: 'Trophy launch unblocked',
    decisiveTitle: 'Trophy asset batch: 12 sprites + 4 animations',
    decisiveSummary:
      '@tech_lead generated the trophy ladder art set from ASSETS_MANIFEST. Ready to merge into the demo game.',
    decisiveCtaLabel: 'Approve',
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
    decisiveTitle: 'Hotfix: game crashes after the final move',
    decisiveSummary:
      'Support case reproduced: the arena crashes on match end. Patch ready with Playwright proof. One approval ships it.',
    decisiveCtaLabel: 'Approve',
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
    decisiveTitle: 'Trophy launch pack: 5 visuals + launch thread',
    decisiveSummary:
      '@social_lead cut the trophy launch visuals and the announcement thread from the new art set. Ready to post.',
    decisiveCtaLabel: 'Approve',
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
    decisiveTitle: 'Trophy launch SEO cluster: 4 pages + FAQ schema',
    decisiveSummary:
      '@seo_aeo_head drafted the trophy guide cluster with FAQ schema so launch searches land on us.',
    decisiveCtaLabel: 'Approve',
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

function findMatchingBacklogItem(
  item: PriorityDecisionItem,
  backlogItems?: BacklogItem[]
): BacklogItem | undefined {
  if (!backlogItems || backlogItems.length === 0) return undefined;
  return backlogItems.find((b) => {
    const t = (b.title || '').toLowerCase();
    const id = (b.id || '').toLowerCase();
    if (item.id === 'prio_tech_lobby_bootstrap') {
      return (
        id.includes('lobby_bootstrap') ||
        t.includes('lobby with play') ||
        t.includes('lobby bootstrap')
      );
    }
    if (item.id === 'prio_tech_trophy_assets') {
      return (
        id.includes('trophy_assets') ||
        t.includes('trophy system art') ||
        t.includes('trophy asset')
      );
    }
    if (item.id === 'prio_tech_crash_patch') {
      return id.includes('crash_patch') || t.includes('crashes after the final move');
    }
    if (item.id === 'prio_social_trophy_launch') {
      return (
        id.includes('trophy_social') ||
        t.includes('social visuals') ||
        t.includes('trophy launch pack')
      );
    }
    if (item.id === 'prio_seo_trophy_cluster') {
      return id.includes('trophy_seo') || t.includes('seo cluster');
    }
    return false;
  });
}

interface HomePriorityWindowProps {
  activeVertical?: VerticalScope;
  knobConfig?: ConsultationKnobConfig;
  backlogItems?: BacklogItem[];
  threads?: ChatThread[];
  onApproveBacklogItem?: (itemId: string, summary: string) => Promise<void> | void;
  onOpenAgentTab?: (agentSlug: string) => void;
  onOpenBacklogsTab?: () => void;
  onOpenActivityTab?: () => void;
  onOpenThread?: (threadId: string) => void;
  onDecisionRecorded?: (summary: string) => void;
}

const HomePriorityWindowView: React.FC<HomePriorityWindowProps> = ({
  activeVertical = 'ALL',
  knobConfig: externalKnobConfig,
  backlogItems,
  threads,
  onApproveBacklogItem,
  onOpenAgentTab,
  onOpenBacklogsTab,
  onOpenActivityTab,
  onOpenThread,
  onDecisionRecorded,
}) => {
  const [knobConfig, setKnobConfig] = useState<ConsultationKnobConfig>(() =>
    externalKnobConfig || loadConsultationKnobConfig()
  );

  const [selectedOptionById, setSelectedOptionById] = useState<Record<string, string>>({
    prio_tech_lobby_bootstrap: 'opt_lobby_play_only',
    prio_tech_trophy_assets: 'opt_neon_arcade',
    prio_tech_crash_patch: 'opt_guard_test',
    prio_social_trophy_launch: 'opt_player_flex',
    prio_seo_trophy_cluster: 'opt_how_to',
  });

  const [selectedCoPillById, setSelectedCoPillById] = useState<Record<string, string>>({
    prio_tech_lobby_bootstrap: 'Shared game-client header',
    prio_tech_trophy_assets: 'Sprite atlas in the game bundle',
    prio_tech_crash_patch: 'Auto-reply with the fix + deploy link',
    prio_social_trophy_launch: 'Reels + Shorts first',
    prio_seo_trophy_cluster: 'All four on launch day',
  });

  const [customNoteById, setCustomNoteById] = useState<Record<string, string>>({});

  const [resolvedById, setResolvedById] = useState<
    Record<string, { decisionText: string; resolvedAt: string; levelUsed: ConsultationLevel; running: boolean }>
  >({});

  // Modal state: clicking a card opens the deeper details modal
  const [activeModalItemId, setActiveModalItemId] = useState<string | null>(null);
  // Tracks which approved item the user explicitly chose to re-decide.
  const [editingDecisionId, setEditingDecisionId] = useState<string | null>(null);

  useEffect(() => {
    setEditingDecisionId(null);
  }, [activeModalItemId]);

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

  const activeModalItem = useMemo(
    () => PRIORITY_ITEMS.find((i) => i.id === activeModalItemId) || null,
    [activeModalItemId]
  );

  const getResolvedState = (item: PriorityDecisionItem) => {
    const matched = findMatchingBacklogItem(item, backlogItems);
    if (matched && matched.stage === 'DONE') {
      return {
        decisionText:
          matched.last_movement_note ||
          matched.human_resolution ||
          `Approved "${item.decisiveTitle}"`,
        resolvedAt: matched.completed_at
          ? new Date(matched.completed_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'Completed',
        levelUsed: 1 as ConsultationLevel,
        running: false,
      };
    }
    if (
      matched &&
      (matched.stage === 'IN_PROGRESS' || matched.stage === 'QA_REVIEW')
    ) {
      return {
        decisionText:
          matched.last_movement_note ||
          matched.human_resolution ||
          `Approved "${item.decisiveTitle}"`,
        resolvedAt: 'Running',
        levelUsed: 1 as ConsultationLevel,
        running: true,
      };
    }
    if (resolvedById[item.id]) {
      return resolvedById[item.id];
    }
    return undefined;
  };

  const handleResolveItem = (item: PriorityDecisionItem, level: ConsultationLevel) => {
    let summary = '';
    if (level === 1) {
      summary = `Approved "${item.decisiveTitle}"`;
    } else {
      const chosenOpt =
        item.options.find((o) => o.id === selectedOptionById[item.id]) ||
        item.options[0];
      const coPill = level === 3 ? ` + [${selectedCoPillById[item.id]}]` : '';
      const note = customNoteById[item.id]?.trim()
        ? ` — CEO Note: "${customNoteById[item.id].trim()}"`
        : '';
      summary = `Approved ${chosenOpt.label}${coPill}${note}`;
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
        running: true,
      },
    }));
    const matchedBacklogItem = findMatchingBacklogItem(item, backlogItems);
    if (onApproveBacklogItem) {
      void onApproveBacklogItem(matchedBacklogItem ? matchedBacklogItem.id : item.id, summary);
    }
    onDecisionRecorded?.(`${item.agentSlug}: ${summary}`);
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
    <>
      <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] text-[var(--surface-text)] shadow-xl flex flex-col h-full min-h-0 overflow-hidden">
        {/* Top Window Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--surface-border)] px-4 py-3.5 shrink-0 bg-[var(--surface-elevated)] z-10">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/30 text-[var(--surface-accent-gold)] motion-safe:animate-pulse">
              <AlertTriangle className="h-4 w-4 text-[var(--surface-accent-gold)]" />
            </div>
            <h2 className="text-sm sm:text-base font-bold text-[var(--surface-text)]">
              NEEDS ACTION
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {Object.keys(resolvedById).length > 0 && (
              <button
                type="button"
                onClick={() => setResolvedById({})}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] hover:bg-[var(--surface-elevated)] px-2.5 py-1 text-[11px] font-mono text-[var(--surface-text)] transition cursor-pointer"
              >
                <RotateCcw className="h-3 w-3 text-[var(--surface-accent)]" />
                <span>Reset ({Object.keys(resolvedById).length})</span>
              </button>
            )}
            {onOpenBacklogsTab && (
              <button
                type="button"
                onClick={onOpenBacklogsTab}
                className="inline-flex items-center gap-1 rounded-xl border border-[var(--surface-accent)]/30 bg-[var(--surface-accent)]/10 hover:bg-[var(--surface-accent)]/20 px-2.5 py-1 text-xs font-semibold text-[var(--surface-accent)] transition cursor-pointer"
              >
                <span>Full Queue</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Compact Priority Cards List (shows 3-4+ tasks cleanly in viewport) */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3.5 sm:p-4 space-y-2.5">
          {visibleItems.map((item) => {
            const resolved = getResolvedState(item);

            return (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => setActiveModalItemId(item.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setActiveModalItemId(item.id);
                  }
                }}
                className={`group rounded-xl border px-4 py-3.5 transition flex items-center justify-between gap-3 cursor-pointer ${
                  resolved
                    ? 'border-[var(--surface-accent-gold)]/40 bg-[var(--surface-accent-gold)]/5'
                    : 'border-[var(--surface-border)] bg-[var(--surface-card)] hover:border-[var(--surface-accent-gold)]/60 shadow-xs'
                }`}
              >
                <span className="min-w-0 flex-1 text-xs sm:text-sm font-semibold text-[var(--surface-text)] group-hover:text-[var(--surface-accent-gold)] transition-colors truncate">
                  {item.decisiveTitle}
                </span>

                {resolved ? (
                  resolved.running ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveModalItemId(item.id);
                      }}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--semantic-success)]/50 bg-[var(--semantic-success)]/15 hover:bg-[var(--semantic-success)]/25 px-3 py-1.5 text-xs font-bold text-[var(--semantic-success)] transition cursor-pointer"
                    >
                      <span className="h-2 w-2 rounded-full bg-[var(--semantic-success)] animate-pulse" />
                      <span>Running • View</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveModalItemId(item.id);
                      }}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--surface-accent-gold)]/40 bg-[var(--surface-accent-gold)]/15 hover:bg-[var(--surface-accent-gold)]/25 px-3 py-1.5 text-xs font-bold text-[var(--surface-accent-gold)] transition cursor-pointer"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Completed • View</span>
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveModalItemId(item.id);
                    }}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--surface-accent-gold)]/60 bg-[var(--surface-accent-gold)]/35 hover:bg-[var(--surface-accent-gold)]/50 px-3.5 py-1.5 text-xs font-bold text-[var(--surface-text)] shadow-xs transition cursor-pointer"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span>View</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Deeper Details Modal when a Needs Action card is clicked */}
      {activeModalItem && (() => {
        const vLevel: ConsultationLevel =
          knobConfig.perVerticalLevel[activeModalItem.vertical] || knobConfig.globalLevel;
        const vStyle = getVerticalBadgeStyle(activeModalItem.vertical);
        const resolved = getResolvedState(activeModalItem);
        const selectedOptId =
          selectedOptionById[activeModalItem.id] || activeModalItem.options[0].id;
        const selectedCoPill =
          selectedCoPillById[activeModalItem.id] || activeModalItem.coArchitectPills[0];
        const isEditingDecision = editingDecisionId === activeModalItem.id;
        const showResolvedState = Boolean(resolved) && !isEditingDecision;
        const matchedBacklog = findMatchingBacklogItem(activeModalItem, backlogItems);
        const originThreadId = matchedBacklog
          ? DEMO_ORIGIN_THREAD_BY_BACKLOG[matchedBacklog.id]
          : undefined;
        const originThread = originThreadId
          ? threads?.find((t) => t.id === originThreadId)
          : undefined;
        const spawnedThread =
          matchedBacklog && threads
            ? threads.find((t) => t.id.startsWith(spawnThreadPrefix(matchedBacklog.id)))
            : undefined;
        const isLocked = Boolean(resolved?.running) || matchedBacklog?.stage === 'DONE';
        const chosenOpt =
          activeModalItem.options.find((o) => o.id === selectedOptId) ||
          activeModalItem.options[0];

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
            role="dialog"
            aria-modal="true"
            aria-label={activeModalItem.decisiveTitle}
            onClick={() => setActiveModalItemId(null)}
          >
            <div
              className="w-full max-w-xl rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] text-[var(--surface-text)] p-5 sm:p-6 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-start justify-between gap-3 border-b border-[var(--surface-border)] pb-3">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-[var(--surface-accent)]/15 border border-[var(--surface-accent)]/30 px-1.5 py-0.5 text-[10px] font-mono font-bold text-[var(--surface-accent)]">
                      {activeModalItem.priority}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-mono font-semibold ${vStyle.pill}`}
                    >
                      {vStyle.icon}
                      <span>{activeModalItem.verticalLabel}</span>
                    </span>
                    <span className="rounded bg-[var(--surface-muted)] border border-[var(--surface-border)] px-2 py-0.5 text-[10px] font-mono text-[var(--surface-text-secondary)]">
                      {activeModalItem.projectSlug}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveModalItemId(null);
                        onOpenAgentTab?.(activeModalItem.agentSlug);
                      }}
                      className="rounded bg-[var(--surface-accent)]/10 border border-[var(--surface-accent)]/30 hover:bg-[var(--surface-accent)]/20 px-2 py-0.5 text-[10px] font-mono font-bold text-[var(--surface-accent)] transition cursor-pointer"
                    >
                      {activeModalItem.agentSlug}
                    </button>
                    <span className="rounded-full bg-[var(--surface-accent-gold)]/10 border border-[var(--surface-accent-gold)]/30 px-2 py-0.5 text-[10px] font-mono text-[var(--surface-accent-gold)] font-medium">
                      {activeModalItem.impactBadge}
                    </span>
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-[var(--surface-text)]">
                    {activeModalItem.decisiveTitle}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveModalItemId(null)}
                  className="rounded-lg p-1 text-[var(--surface-text-muted)] hover:text-[var(--surface-text)] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Summary */}
              <p className="text-xs sm:text-sm text-[var(--surface-text-secondary)] leading-relaxed">
                {activeModalItem.decisiveSummary}
              </p>

              {/* Origin chat + linked backlog task */}
              {(originThreadId || matchedBacklog) && (
                <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3 space-y-2">
                  {originThreadId && (
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-[var(--surface-text-secondary)]">
                        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-[var(--surface-accent)]" />
                        <span className="font-semibold text-[var(--surface-text)]">Origin chat:</span>
                        <span className="truncate">
                          {originThread?.title || originThreadId}
                        </span>
                      </div>
                      {onOpenThread && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveModalItemId(null);
                            onOpenThread(originThreadId);
                          }}
                          className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-[var(--surface-accent)]/40 bg-[var(--surface-accent)]/10 hover:bg-[var(--surface-accent)]/20 px-2.5 py-1 text-[11px] font-semibold text-[var(--surface-accent)] transition cursor-pointer"
                        >
                          <span>Open chat</span>
                          <ArrowUpRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )}
                  {matchedBacklog && (
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-[var(--surface-text-secondary)]">
                        <span className="font-semibold text-[var(--surface-text)]">Task:</span>
                        <span className="truncate">{matchedBacklog.title}</span>
                        <span className="shrink-0 rounded bg-[var(--surface-panel)] border border-[var(--surface-border)] px-1.5 py-0.5 text-[10px] font-mono">
                          {matchedBacklog.stage}
                        </span>
                      </div>
                      {onOpenBacklogsTab && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveModalItemId(null);
                            onOpenBacklogsTab();
                          }}
                          className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] hover:bg-[var(--surface-elevated)] px-2.5 py-1 text-[11px] font-semibold text-[var(--surface-text-secondary)] hover:text-[var(--surface-text)] transition cursor-pointer"
                        >
                          <span>Backlogs</span>
                          <ArrowUpRight className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Generated output for the trophy art task */}
              {matchedBacklog?.id === 'bl_trophy_assets' && (
                <TrophyAssetPreview
                  generated={
                    Boolean(resolved?.running) ||
                    matchedBacklog.stage === 'IN_PROGRESS' ||
                    matchedBacklog.stage === 'QA_REVIEW' ||
                    matchedBacklog.stage === 'DONE'
                  }
                />
              )}

              {/* Approved items show their decision; the question flow returns only via Change decision */}
              {showResolvedState && resolved ? (
                <div className="rounded-xl border border-[var(--surface-accent-gold)]/40 bg-[var(--surface-accent-gold)]/10 p-4 space-y-2.5">
                  <div className="flex items-center gap-2 text-sm font-bold text-[var(--surface-accent-gold)]">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{resolved.running ? 'Running' : 'Approved'} ({resolved.resolvedAt})</span>
                  </div>
                  <p className="text-xs sm:text-sm text-[var(--surface-text)] leading-relaxed">
                    {resolved.decisionText}
                  </p>
                  <div className="text-xs text-[var(--surface-text-secondary)]">
                    <span className="font-semibold text-[var(--surface-text)]">
                      {chosenOpt.label}
                    </span>
                    {' — '}
                    {chosenOpt.summary}
                  </div>
                  {isLocked ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-mono text-[var(--surface-text-secondary)]">
                        {resolved.running ? 'Team spawned — executing, no further approval needed.' : 'Task complete.'}
                      </span>
                      {onOpenActivityTab && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveModalItemId(null);
                            onOpenActivityTab();
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--surface-accent-gold)]/40 bg-[var(--surface-accent-gold)]/15 hover:bg-[var(--surface-accent-gold)]/25 px-3 py-1.5 text-xs font-semibold text-[var(--surface-accent-gold)] transition cursor-pointer"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>{resolved.running ? 'Watch Live Brain Trace' : 'View Activity Trace'}</span>
                        </button>
                      )}
                      {resolved.running && spawnedThread && onOpenThread && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveModalItemId(null);
                            onOpenThread(spawnedThread.id);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--semantic-success)]/40 bg-[var(--semantic-success)]/10 hover:bg-[var(--semantic-success)]/20 px-3 py-1.5 text-xs font-semibold text-[var(--semantic-success)] transition cursor-pointer"
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          <span>Open run chat</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingDecisionId(activeModalItem.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] px-3 py-1.5 text-xs font-semibold text-[var(--surface-text-secondary)] hover:text-[var(--surface-text)] transition cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Change decision</span>
                    </button>
                  )}
                </div>
              ) : (
              <>
              {/* Options & Co-Design Details */}
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--surface-accent-gold)]">
                    <HelpCircle className="h-3.5 w-3.5 text-[var(--surface-accent-gold)] shrink-0" />
                    <span>{activeModalItem.questionTitle}</span>
                  </div>
                  <span className="rounded bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/30 px-2 py-0.5 text-[10px] font-mono text-[var(--surface-accent-gold)]">
                    {activeModalItem.principleTag}
                  </span>
                </div>
                <p className="text-xs text-[var(--surface-text-secondary)]">
                  {activeModalItem.questionPrompt}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {activeModalItem.options.map((opt) => {
                    const isSelected = selectedOptId === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() =>
                          setSelectedOptionById((prev) => ({
                            ...prev,
                            [activeModalItem.id]: opt.id,
                          }))
                        }
                        className={`rounded-xl border p-2.5 text-left transition cursor-pointer flex flex-col justify-between gap-1.5 ${
                          isSelected
                            ? 'border-[var(--surface-accent)] bg-[var(--surface-accent)]/10 shadow-xs ring-1 ring-[var(--surface-accent)]/50'
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

                {vLevel === 3 && (
                  <div className="rounded-xl border border-[var(--surface-accent-gold)]/35 bg-[var(--surface-accent-gold)]/10 p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold text-[var(--surface-accent-gold)]">
                      <Sparkles className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />
                      <span>{activeModalItem.coArchitectFollowUp}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {activeModalItem.coArchitectPills.map((pill) => {
                        const active = selectedCoPill === pill;
                        return (
                          <button
                            key={pill}
                            type="button"
                            onClick={() =>
                              setSelectedCoPillById((prev) => ({
                                ...prev,
                                [activeModalItem.id]: pill,
                              }))
                            }
                            className={`rounded-lg border px-2.5 py-1 text-[11px] font-mono transition cursor-pointer ${
                              active
                                ? 'border-[var(--surface-accent)] bg-[var(--surface-accent)] text-white font-semibold shadow-xs'
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

                <div className="relative">
                  <MessageSquarePlus className="h-3.5 w-3.5 text-[var(--surface-text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={customNoteById[activeModalItem.id] || ''}
                    onChange={(e) =>
                      setCustomNoteById((prev) => ({
                        ...prev,
                        [activeModalItem.id]: e.target.value,
                      }))
                    }
                    placeholder={`Add custom note for ${activeModalItem.agentSlug} (optional)...`}
                    className="w-full rounded-xl bg-[var(--surface-muted)] border border-[var(--surface-border)] pl-8 pr-3 py-2 text-xs text-[var(--surface-text)] placeholder:text-[var(--surface-text-muted)] focus:outline-none focus:border-[var(--surface-accent)]"
                  />
                </div>
              </div>
              </>
              )}

              {/* Modal Footer */}
              <div className="flex items-center justify-between gap-3 pt-2 border-t border-[var(--surface-border)]">
                {resolved ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--surface-accent-gold)]">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{resolved.decisionText} ({resolved.resolvedAt})</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-[var(--surface-text-muted)]">
                    Assigned by {activeModalItem.agentSlug} ({activeModalItem.agentRole})
                  </span>
                )}
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => setActiveModalItemId(null)}
                    className="rounded-xl border border-[var(--surface-border)] px-3.5 py-2 text-xs font-semibold text-[var(--surface-text-secondary)] hover:text-[var(--surface-text)] cursor-pointer"
                  >
                    Close
                  </button>
                  {!showResolvedState && (
                    <button
                      type="button"
                      onClick={() => {
                        handleResolveItem(activeModalItem, vLevel);
                        setEditingDecisionId(null);
                        setActiveModalItemId(null);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--surface-accent-gold)] hover:brightness-110 text-black px-4 py-2 text-xs font-bold shadow-md transition cursor-pointer"
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>{resolved ? 'Update Approval' : 'Approve & spawn team'}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
};
export const HomePriorityWindow: React.FC<HomePriorityWindowProps> = (props) => (
  <ErrorBoundary section="Needs Action">
    <HomePriorityWindowView {...props} />
  </ErrorBoundary>
);
export default HomePriorityWindow;
