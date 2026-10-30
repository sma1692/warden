import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Globe,
  HelpCircle,
  Kanban,
  KeyRound,
  LayoutList,
  Plus,
  Search,
  Share2,
  ShieldAlert,
  Sparkles,
  Wand2,
  Wrench,
} from 'lucide-react';
import type {
  Agent,
  BacklogItem,
  BacklogStage,
  InterventionCategory,
  PriorityLevel,
  Sprint,
} from '../types/commando';
import type { VerticalScope } from './ConsultationKnob';
import {
  PRIMARY_PROJECT,
  PROJECT_CATALOG,
} from '../data/workspaceProfile';

const STAGES: { id: BacklogStage; label: string; shortLabel: string; accent: string }[] = [
  {
    id: 'INBOX',
    label: '📥 INBOX',
    shortLabel: 'INBOX',
    accent: 'border-[var(--surface-border)] text-[var(--text-main)] bg-[var(--surface-elevated)]',
  },
  {
    id: 'NEEDS_CEO',
    label: '🚨 NEEDS_CEO',
    shortLabel: 'NEEDS_CEO',
    accent: 'border-[var(--semantic-alert)]/60 text-[var(--semantic-alert)] bg-[var(--semantic-alert)]/10',
  },
  {
    id: 'TODO',
    label: '📋 TODO',
    shortLabel: 'TODO',
    accent: 'border-[var(--semantic-action)]/40 text-[var(--semantic-action)] bg-[var(--semantic-action)]/10',
  },
  {
    id: 'IN_PROGRESS',
    label: '🐳 IN_PROGRESS',
    shortLabel: 'IN_PROGRESS',
    accent: 'border-[var(--surface-accent)]/40 text-[var(--surface-accent)] bg-[var(--surface-accent)]/10',
  },
  {
    id: 'QA_REVIEW',
    label: '🧪 QA_REVIEW',
    shortLabel: 'QA_REVIEW',
    accent: 'border-[var(--semantic-warning)]/40 text-[var(--semantic-warning)] bg-[var(--semantic-warning)]/10',
  },
  {
    id: 'DONE',
    label: '✅ DONE',
    shortLabel: 'DONE',
    accent: 'border-[var(--semantic-success)]/40 text-[var(--semantic-success)] bg-[var(--semantic-success)]/10',
  },
];

const EXTRA_VERTICAL_BACKLOG_ITEMS: (BacklogItem & {
  vertical: Exclude<VerticalScope, 'ALL'>;
})[] = [
  {
    id: 'bl-aeo-llms-txt',
    title: 'Publish /llms.txt & /llms-full.txt for Perplexity & ChatGPT Search Citation',
    spec_md:
      'Generate structured markdown indexes referencing NovaPulse AI checkout, programmatic AEO schemas, and edge latency benchmarks.',
    stage: 'IN_PROGRESS',
    priority: 'P0',
    project_slug: 'pulse-seo',
    assigned_agent_id: '@aeo_lead',
    pm_owner_id: '@cbo',
    requires_human_intervention: false,
    intervention_type: 'NONE',
    intervention_prompt: null,
    required_env_keys: [],
    human_resolution: null,
    human_resolved_at: null,
    sprint_id: 'sprint-active',
    created_at: '12m ago',
    completed_at: null,
    vertical: 'SEO_AEO',
  },
  {
    id: 'bl-aeo-jsonld-schema',
    title: 'Inject SoftwareApplication + FAQPage JSON-LD Schema across NovaPulse Landing Routes',
    spec_md:
      'Add programmatic schema markup targeting zero-click AI Overviews for autonomous AI commerce & growth SaaS.',
    stage: 'TODO',
    priority: 'P0',
    project_slug: 'pulse-seo',
    assigned_agent_id: '@aeo_specialist',
    pm_owner_id: '@aeo_lead',
    requires_human_intervention: false,
    intervention_type: 'NONE',
    intervention_prompt: null,
    required_env_keys: [],
    human_resolution: null,
    human_resolved_at: null,
    sprint_id: 'sprint-active',
    created_at: '28m ago',
    completed_at: null,
    vertical: 'SEO_AEO',
  },
  {
    id: 'bl-aeo-comparative-pages',
    title: 'Approve Comparative Landing Copy: NovaPulse Edge Commerce vs Legacy Monoliths',
    spec_md:
      'High-intent comparison cluster targeting enterprise SaaS buyers searching for sub-15ms AI checkout & AEO automation.',
    stage: 'NEEDS_CEO',
    priority: 'P1',
    project_slug: 'pulse-seo',
    assigned_agent_id: '@aeo_lead',
    pm_owner_id: '@cbo',
    requires_human_intervention: true,
    intervention_type: 'DECISION',
    intervention_prompt: 'Approve tone & benchmark claims on public comparison page?',
    required_env_keys: [],
    human_resolution: null,
    human_resolved_at: null,
    sprint_id: 'sprint-active',
    created_at: '41m ago',
    completed_at: null,
    vertical: 'SEO_AEO',
  },
  {
    id: 'bl-social-demo-hook',
    title: 'Cut 5 Short-Form 9:16 Clips: 0.8s Live Revenue Ticker → Instant AI Checkout Hook',
    spec_md:
      'First 0.8s features the live conversion lift transition followed by one-click edge checkout demo for Reels/Shorts/X.',
    stage: 'IN_PROGRESS',
    priority: 'P0',
    project_slug: 'pulse-social',
    assigned_agent_id: '@social_creator',
    pm_owner_id: '@social_lead',
    requires_human_intervention: false,
    intervention_type: 'NONE',
    intervention_prompt: null,
    required_env_keys: [],
    human_resolution: null,
    human_resolved_at: null,
    sprint_id: 'sprint-active',
    created_at: '9m ago',
    completed_at: null,
    vertical: 'SOCIAL',
  },
  {
    id: 'bl-social-launch-trailer',
    title: 'Approve 60s NovaPulse 2.0 Enterprise Launch Trailer Hook & Voiceover',
    spec_md:
      'Final cut for NovaPulse 2.0 product launch showcasing AI Commerce Core, AEO Citation Engine, and Support Deflection.',
    stage: 'NEEDS_CEO',
    priority: 'P0',
    project_slug: 'pulse-social',
    assigned_agent_id: '@social_lead',
    pm_owner_id: '@cbo',
    requires_human_intervention: true,
    intervention_type: 'DECISION',
    intervention_prompt: 'Select Hook Variant A (Product-first) or Variant B (Founder VO) for final upload.',
    required_env_keys: [],
    human_resolution: null,
    human_resolved_at: null,
    sprint_id: 'sprint-active',
    created_at: '19m ago',
    completed_at: null,
    vertical: 'SOCIAL',
  },
  {
    id: 'bl-social-latency-thread',
    title: 'Publish Founder X / LinkedIn Thread: Sub-15ms Edge Checkout & Stripe Webhook Idempotency',
    spec_md:
      'Technical deep-dive thread highlighting Cloudflare Workers edge caching + Postgres row-level locking wins.',
    stage: 'QA_REVIEW',
    priority: 'P1',
    project_slug: 'pulse-core',
    assigned_agent_id: '@social_lead',
    pm_owner_id: '@cbo',
    requires_human_intervention: false,
    intervention_type: 'NONE',
    intervention_prompt: null,
    required_env_keys: [],
    human_resolution: null,
    human_resolved_at: null,
    sprint_id: 'sprint-active',
    created_at: '1h ago',
    completed_at: null,
    vertical: 'SOCIAL',
  },
];

const VERTICAL_BADGE_MAP: Record<
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

function inferVerticalForItem(
  item: BacklogItem & { vertical?: Exclude<VerticalScope, 'ALL'> }
): Exclude<VerticalScope, 'ALL'> {
  if (item.vertical) return item.vertical;
  const assignee = (item.assigned_agent_id || '').toLowerCase();
  const title = item.title.toLowerCase();
  if (
    assignee.includes('aeo') ||
    assignee.includes('seo') ||
    title.includes('seo') ||
    title.includes('aeo') ||
    title.includes('json-ld') ||
    title.includes('llms.txt')
  ) {
    return 'SEO_AEO';
  }
  if (
    assignee.includes('social') ||
    title.includes('tiktok') ||
    title.includes('reel') ||
    title.includes('linkedin') ||
    title.includes('trailer')
  ) {
    return 'SOCIAL';
  }
  return 'TECH';
}

interface BacklogAndSprintViewProps {
  activeVertical?: VerticalScope;
  sprint: Sprint;
  backlogItems: BacklogItem[];
  agents?: Agent[];
  onApproveSprint: (ceoNotes?: string) => Promise<void>;
  onRunStandupPollNow?: () => Promise<void>;
  onCreateBacklogItem: (payload: {
    title: string;
    spec_md: string;
    stage: BacklogStage;
    priority: PriorityLevel;
    project_slug: string;
    assigned_agent_id: string | null;
    pm_owner_id?: string | null;
    requires_human_intervention?: boolean;
    intervention_type?: InterventionCategory | null;
    intervention_prompt?: string | null;
    required_env_keys?: string[];
  }) => Promise<void>;
  onMoveBacklogItem: (itemId: string, nextStage: BacklogStage, reason?: string) => Promise<void>;
  onUpdateBacklogItem?: (
    itemId: string,
    patch: {
      stage?: BacklogStage;
      priority?: PriorityLevel;
      assigned_agent_id?: string | null;
      pm_owner_id?: string | null;
      requires_human_intervention?: boolean;
      intervention_type?: InterventionCategory | null;
      intervention_prompt?: string | null;
      required_env_keys?: string[];
      reason?: string;
    }
  ) => Promise<void>;
  onResolveIntervention?: (
    itemId: string,
    payload: {
      resolution_text: string;
      env_values?: Record<string, string>;
      move_to_stage?: BacklogStage;
    }
  ) => Promise<void>;
  onRunPmTriage: () => Promise<void>;
}

export const BacklogAndSprintView: React.FC<BacklogAndSprintViewProps> = ({
  activeVertical = 'ALL',
  sprint,
  backlogItems,
  onApproveSprint,
  onCreateBacklogItem,
  onMoveBacklogItem,
  onResolveIntervention,
  onRunPmTriage,
}) => {
  const [localVertical, setLocalVertical] = useState<VerticalScope>(activeVertical);
  const [projectFilter, setProjectFilter] = useState<string>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<'ALL' | PriorityLevel>('ALL');
  const [stageFilter, setStageFilter] = useState<'ALL' | BacklogStage>('ALL');
  const [onlyNeedsCeo, setOnlyNeedsCeo] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [pcDisplayMode, setPcDisplayMode] = useState<'table' | 'kanban'>('table');
  const [showAddModal, setShowAddModal] = useState<boolean>(false);

  // Local state for extra vertical items stage changes
  const [extraItems, setExtraItems] = useState(EXTRA_VERTICAL_BACKLOG_ITEMS);
  const [resolutionTextById, setResolutionTextById] = useState<Record<string, string>>({});

  // Quick-add form state
  const [newTitle, setNewTitle] = useState('');
  const [newSpec, setNewSpec] = useState('');
  const [newStage, setNewStage] = useState<BacklogStage>('TODO');
  const [newPriority, setNewPriority] = useState<PriorityLevel>('P0');
  const [newProject, setNewProject] = useState<string>(PRIMARY_PROJECT.slug);
  const [newAssignee, setNewAssignee] = useState<string>('@pm');

  useEffect(() => {
    setLocalVertical(activeVertical);
  }, [activeVertical]);

  const combinedItems = useMemo(() => {
    const existingIds = new Set(backlogItems.map((i) => i.id));
    const merged = [
      ...backlogItems.map((item) => ({
        ...item,
        vertical: inferVerticalForItem(item),
      })),
      ...extraItems.filter((e) => !existingIds.has(e.id)),
    ];
    return merged;
  }, [backlogItems, extraItems]);

  const filteredItems = useMemo(() => {
    return combinedItems.filter((item) => {
      if (localVertical !== 'ALL' && item.vertical !== localVertical) {
        return false;
      }
      if (projectFilter !== 'ALL' && item.project_slug !== projectFilter) {
        return false;
      }
      if (priorityFilter !== 'ALL' && item.priority !== priorityFilter) {
        return false;
      }
      if (stageFilter !== 'ALL' && item.stage !== stageFilter) {
        return false;
      }
      if (
        onlyNeedsCeo &&
        item.stage !== 'NEEDS_CEO' &&
        !(item.requires_human_intervention && !item.human_resolved_at)
      ) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          item.title.toLowerCase().includes(q) ||
          item.spec_md.toLowerCase().includes(q) ||
          item.project_slug.toLowerCase().includes(q) ||
          (item.assigned_agent_id || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [
    combinedItems,
    localVertical,
    projectFilter,
    priorityFilter,
    stageFilter,
    onlyNeedsCeo,
    searchQuery,
  ]);

  const handleStageChange = async (itemId: string, nextStage: BacklogStage) => {
    const isExtra = extraItems.some((e) => e.id === itemId);
    if (isExtra) {
      setExtraItems((prev) =>
        prev.map((item) => (item.id === itemId ? { ...item, stage: nextStage } : item))
      );
      return;
    }
    await onMoveBacklogItem(itemId, nextStage, 'Updated from Backlog View');
  };

  const handleQuickResolve = async (itemId: string) => {
    const note = resolutionTextById[itemId]?.trim() || 'Approved by CEO';
    const isExtra = extraItems.some((e) => e.id === itemId);
    if (isExtra) {
      setExtraItems((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? {
                ...item,
                stage: 'TODO',
                requires_human_intervention: false,
                human_resolution_note: note,
                human_resolved_at: 'Just now',
              }
            : item
        )
      );
      return;
    }
    if (onResolveIntervention) {
      await onResolveIntervention(itemId, {
        resolution_text: note,
        move_to_stage: 'TODO',
      });
    } else {
      await onMoveBacklogItem(itemId, 'TODO', note);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    await onCreateBacklogItem({
      title: newTitle.trim(),
      spec_md: newSpec.trim() || 'Created from Unified Backlog table.',
      stage: newStage,
      priority: newPriority,
      project_slug: newProject,
      assigned_agent_id: newAssignee,
      pm_owner_id: '@pm',
    });
    setNewTitle('');
    setNewSpec('');
    setShowAddModal(false);
  };

  const needsCeoCount = useMemo(
    () =>
      combinedItems.filter(
        (i) => i.stage === 'NEEDS_CEO' || (i.requires_human_intervention && !i.human_resolved_at)
      ).length,
    [combinedItems]
  );

  return (
    <div className="space-y-4">
      {/* 1. Top Header & Controls Bar */}
      <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 sm:p-5 shadow-sm space-y-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-[var(--surface-accent)]/15 border border-[var(--surface-accent)]/35 p-2.5 text-[var(--surface-accent)] shrink-0">
              <Kanban className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base sm:text-lg font-bold text-[var(--text-main)]">
                  Collated Backlogs &amp; Sprint Execution
                </h1>
                <span className="rounded-full bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-0.5 text-[10px] font-mono text-[var(--text-main)]">
                  {filteredItems.length} Tasks
                </span>
                {needsCeoCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setOnlyNeedsCeo(!onlyNeedsCeo)}
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-mono font-bold transition cursor-pointer ${
                      onlyNeedsCeo
                        ? 'bg-[var(--semantic-alert)] text-white border-[var(--semantic-alert)]'
                        : 'bg-[var(--semantic-alert)]/15 text-[var(--semantic-alert)] border-[var(--semantic-alert)]/40 hover:bg-[var(--semantic-alert)]/25'
                    }`}
                  >
                    🚨 {needsCeoCount} NEEDS_CEO
                  </button>
                )}
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Unified backlog across Tech, SEO/AEO, and Social Media verticals with 1-tap stage transitions.
              </p>
            </div>
          </div>

          {/* Right Action Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Vertical Selector */}
            <div className="inline-flex items-center rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-border)] p-1 gap-1">
              {(
                [
                  { id: 'ALL', label: 'All Verticals' },
                  { id: 'TECH', label: 'Tech' },
                  { id: 'SEO_AEO', label: 'SEO / AEO' },
                  { id: 'SOCIAL', label: 'Social' },
                ] as { id: VerticalScope; label: string }[]
              ).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setLocalVertical(v.id)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                    localVertical === v.id
                      ? 'bg-[var(--surface-accent)]/15 text-[var(--surface-accent)] border border-[var(--surface-accent)]/40 shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void onRunPmTriage()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/35 hover:bg-[var(--surface-accent-gold)]/25 px-3 py-1.5 text-xs font-semibold text-[var(--surface-accent-gold)] transition cursor-pointer"
            >
              <Wand2 className="h-3.5 w-3.5" />
              <span>PM Auto-Triage</span>
            </button>

            {sprint.status === 'AWAITING_CEO_APPROVAL' && (
              <button
                type="button"
                onClick={() => void onApproveSprint('Approved from Unified Backlog')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--semantic-success)]/15 border border-[var(--semantic-success)]/40 hover:bg-[var(--semantic-success)]/25 px-3 py-1.5 text-xs font-semibold text-[var(--semantic-success)] transition cursor-pointer"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Approve Sprint</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowAddModal(!showAddModal)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--surface-accent)] hover:bg-[var(--surface-accent-hover)] text-white px-3 py-1.5 text-xs font-bold transition cursor-pointer shadow-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Task</span>
            </button>
          </div>
        </div>

        {/* Secondary Filter Row */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--surface-border)]">
          <div className="flex flex-wrap items-center gap-2">
            {/* Project Filter */}
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              aria-label="Filter by Project"
              className="rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2.5 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-[var(--surface-accent)]"
            >
              <option value="ALL">All Projects ({PROJECT_CATALOG.length})</option>
              {PROJECT_CATALOG.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.label} ({p.slug})
                </option>
              ))}
            </select>

            {/* Stage Filter */}
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value as 'ALL' | BacklogStage)}
              aria-label="Filter by Stage"
              className="rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2.5 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-[var(--surface-accent)]"
            >
              <option value="ALL">All Stages</option>
              {STAGES.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.label}
                </option>
              ))}
            </select>

            {/* Priority Filter */}
            <div className="inline-flex items-center rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-border)] p-0.5">
              {(['ALL', 'P0', 'P1', 'P2'] as const).map((prio) => (
                <button
                  key={prio}
                  type="button"
                  onClick={() => setPriorityFilter(prio)}
                  className={`rounded-lg px-2 py-1 text-[10px] font-mono font-semibold transition cursor-pointer ${
                    priorityFilter === prio
                      ? 'bg-[var(--surface-panel)] text-[var(--surface-accent)] shadow-xs border border-[var(--surface-border)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                >
                  {prio}
                </button>
              ))}
            </div>

            {/* Search input */}
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search specs, agents, repos..."
                className="rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-border)] pl-8 pr-3 py-1.5 text-xs text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--surface-accent)] w-48 sm:w-60 transition"
              />
            </div>
          </div>

          {/* PC View Switcher: Table (Default) vs Kanban */}
          <div className="hidden md:inline-flex items-center rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-border)] p-1 gap-1">
            <button
              type="button"
              onClick={() => setPcDisplayMode('table')}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                pcDisplayMode === 'table'
                  ? 'bg-[var(--surface-accent)]/15 text-[var(--surface-accent)] border border-[var(--surface-accent)]/40 shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              <LayoutList className="h-3.5 w-3.5" />
              <span>Table</span>
            </button>
            <button
              type="button"
              onClick={() => setPcDisplayMode('kanban')}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                pcDisplayMode === 'kanban'
                  ? 'bg-[var(--surface-accent)]/15 text-[var(--surface-accent)] border border-[var(--surface-accent)]/40 shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              <Kanban className="h-3.5 w-3.5" />
              <span>Kanban</span>
            </button>
          </div>
        </div>

        {/* Collapsible Quick-Add Task Composer */}
        {showAddModal && (
          <form
            onSubmit={handleCreateSubmit}
            className="rounded-xl border border-[var(--surface-accent)]/30 bg-[var(--surface-elevated)] p-3.5 space-y-3 mt-2 shadow-xs"
          >
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Task title (e.g., Ship /llms.txt or Optimize shred filter)..."
                className="sm:col-span-2 rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-[var(--surface-accent)]"
              />
              <select
                value={newProject}
                onChange={(e) => setNewProject(e.target.value)}
                aria-label="New Task Project"
                className="rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] px-2.5 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-[var(--surface-accent)]"
              >
                {PROJECT_CATALOG.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value as PriorityLevel)}
                  aria-label="New Task Priority"
                  className="rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] px-2.5 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-[var(--surface-accent)]"
                >
                  <option value="P0">P0</option>
                  <option value="P1">P1</option>
                  <option value="P2">P2</option>
                </select>
                <select
                  value={newStage}
                  onChange={(e) => setNewStage(e.target.value as BacklogStage)}
                  aria-label="New Task Stage"
                  className="flex-1 rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] px-2.5 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-[var(--surface-accent)]"
                >
                  {STAGES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.shortLabel}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-2">
              <input
                type="text"
                value={newSpec}
                onChange={(e) => setNewSpec(e.target.value)}
                placeholder="Brief markdown specification or acceptance criteria..."
                className="flex-1 w-full rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-[var(--surface-accent)]"
              />
              <input
                type="text"
                value={newAssignee}
                onChange={(e) => setNewAssignee(e.target.value)}
                placeholder="Assignee (@tech_lead, @aeo_lead...)"
                className="w-full sm:w-44 rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] px-3 py-1.5 text-xs font-mono text-[var(--surface-accent)] focus:outline-none focus:border-[var(--surface-accent)]"
              />
              <button
                type="submit"
                className="w-full sm:w-auto rounded-lg bg-[var(--surface-accent)] hover:bg-[var(--surface-accent-hover)] px-4 py-1.5 text-xs font-bold text-white transition cursor-pointer shadow-xs"
              >
                Add to Backlog
              </button>
            </div>
          </form>
        )}
      </div>

      {/* 2A. MOBILE VIEW (< md): Responsive Cards */}
      <div className="md:hidden space-y-2.5">
        {filteredItems.map((item) => {
          const vBadge = VERTICAL_BADGE_MAP[item.vertical];
          const needsCeo =
            item.stage === 'NEEDS_CEO' ||
            (item.requires_human_intervention && !item.human_resolved_at);
          return (
            <div
              key={item.id}
              className={`rounded-2xl border p-3.5 space-y-2.5 shadow-xs ${
                needsCeo
                  ? 'border-[var(--semantic-alert)]/50 bg-[var(--surface-panel)]'
                  : 'border-[var(--surface-border)] bg-[var(--surface-panel)]'
              }`}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold ${
                      item.priority === 'P0'
                        ? 'bg-[var(--semantic-alert)]/15 text-[var(--semantic-alert)] border border-[var(--semantic-alert)]/40'
                        : item.priority === 'P1'
                        ? 'bg-[var(--semantic-warning)]/15 text-[var(--semantic-warning)] border border-[var(--semantic-warning)]/40'
                        : 'bg-[var(--surface-elevated)] text-[var(--text-muted)] border border-[var(--surface-border)]'
                    }`}
                  >
                    {item.priority}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${vBadge.className}`}
                  >
                    {vBadge.icon}
                    <span>{vBadge.label}</span>
                  </span>
                  <span className="text-[10px] font-mono uppercase text-[var(--text-muted)]">
                    {item.project_slug}
                  </span>
                </div>

                <select
                  value={item.stage}
                  onChange={(e) =>
                    void handleStageChange(item.id, e.target.value as BacklogStage)
                  }
                  aria-label="Task Stage"
                  className="rounded-lg bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-1 text-[10px] font-mono text-[var(--text-main)]"
                >
                  {STAGES.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.shortLabel}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <h3 className="text-xs font-bold text-[var(--text-main)] leading-snug">
                  {item.title}
                </h3>
                <p className="text-[11px] text-[var(--text-muted)] mt-1 line-clamp-2">
                  {item.spec_md}
                </p>
              </div>

              {needsCeo && (
                <div className="rounded-xl border border-[var(--semantic-alert)]/40 bg-[var(--surface-elevated)] p-2.5 space-y-2">
                  <div className="text-[11px] text-[var(--semantic-alert)] font-medium">
                    🚨 {item.intervention_prompt || 'CEO decision or key required to unblock.'}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={resolutionTextById[item.id] || ''}
                      onChange={(e) =>
                        setResolutionTextById((prev) => ({
                          ...prev,
                          [item.id]: e.target.value,
                        }))
                      }
                      placeholder="Enter CEO decision / note..."
                      className="flex-1 rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] px-2.5 py-1 text-[11px] text-[var(--text-main)]"
                    />
                    <button
                      type="button"
                      onClick={() => void handleQuickResolve(item.id)}
                      className="rounded-lg bg-[var(--semantic-success)] text-white px-2.5 py-1 text-[11px] font-bold"
                    >
                      Unblock
                    </button>
                  </div>
                </div>
              )}

              <div className="pt-2 border-t border-[var(--surface-border-subtle)] flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)]">
                <span>
                  Assigned: <strong className="text-[var(--surface-accent)]">{item.assigned_agent_id || '@pm'}</strong>
                </span>
                <span>{item.last_moved_at || item.created_at}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 2B. PC VIEW (>= md): Tabular View (or Kanban when toggled) */}
      {pcDisplayMode === 'table' ? (
        <div className="hidden md:block rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--surface-border)] bg-[var(--surface-elevated)] text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                  <th className="py-2.5 px-4">Priority</th>
                  <th className="py-2.5 px-3">Task &amp; Specification</th>
                  <th className="py-2.5 px-3">Vertical</th>
                  <th className="py-2.5 px-3">Project</th>
                  <th className="py-2.5 px-3">Assigned</th>
                  <th className="py-2.5 px-3">Stage</th>
                  <th className="py-2.5 px-4 text-right">Action / Unblock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--surface-border-subtle)] text-xs">
                {filteredItems.map((item) => {
                  const vBadge = VERTICAL_BADGE_MAP[item.vertical];
                  const needsCeo =
                    item.stage === 'NEEDS_CEO' ||
                    (item.requires_human_intervention && !item.human_resolved_at);
                  return (
                    <tr
                      key={item.id}
                      className={`transition ${
                        needsCeo
                          ? 'bg-[var(--semantic-alert)]/5 hover:bg-[var(--semantic-alert)]/10'
                          : 'hover:bg-[var(--surface-elevated)]/60'
                      }`}
                    >
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-mono font-bold ${
                            item.priority === 'P0'
                              ? 'bg-[var(--semantic-alert)]/15 text-[var(--semantic-alert)] border border-[var(--semantic-alert)]/40'
                              : item.priority === 'P1'
                              ? 'bg-[var(--semantic-warning)]/15 text-[var(--semantic-warning)] border border-[var(--semantic-warning)]/40'
                              : 'bg-[var(--surface-elevated)] text-[var(--text-muted)] border border-[var(--surface-border)]'
                          }`}
                        >
                          {item.priority}
                        </span>
                      </td>

                      <td className="py-3 px-3 max-w-md">
                        <div className="font-bold text-[var(--text-main)] leading-snug">
                          {item.title}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] line-clamp-1 mt-0.5">
                          {item.spec_md}
                        </div>
                        {needsCeo && item.intervention_prompt && (
                          <div className="text-[11px] text-[var(--semantic-alert)] font-medium mt-1">
                            🚨 {item.intervention_prompt}
                          </div>
                        )}
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
                        <span className="rounded bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-0.5 text-[11px] font-mono text-[var(--text-main)] uppercase">
                          {item.project_slug}
                        </span>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap font-mono text-xs text-[var(--surface-accent)] font-semibold">
                        {item.assigned_agent_id || '@pm'}
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <select
                          value={item.stage}
                          onChange={(e) =>
                            void handleStageChange(item.id, e.target.value as BacklogStage)
                          }
                          aria-label={`Change stage for ${item.title}`}
                          className="rounded-lg bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2.5 py-1 text-[11px] font-mono text-[var(--text-main)] focus:outline-none focus:border-[var(--surface-accent)] cursor-pointer"
                        >
                          {STAGES.map((st) => (
                            <option key={st.id} value={st.id}>
                              {st.shortLabel}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap text-right">
                        {needsCeo ? (
                          <div className="inline-flex items-center gap-1.5">
                            <input
                              type="text"
                              value={resolutionTextById[item.id] || ''}
                              onChange={(e) =>
                                setResolutionTextById((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              placeholder="CEO note / key..."
                              className="rounded-lg bg-[var(--surface-elevated)] border border-[var(--semantic-alert)]/40 px-2 py-1 text-[11px] text-[var(--text-main)] w-36 focus:outline-none focus:border-[var(--semantic-alert)]"
                            />
                            <button
                              type="button"
                              onClick={() => void handleQuickResolve(item.id)}
                              className="rounded-lg bg-[var(--semantic-success)] hover:bg-[var(--semantic-success)]/90 text-white px-2.5 py-1 text-[11px] font-bold transition cursor-pointer shadow-xs"
                            >
                              Approve
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] font-mono text-[var(--text-muted)]">
                            {item.last_moved_at || item.created_at}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="hidden md:grid md:grid-cols-3 xl:grid-cols-6 gap-3">
          {STAGES.map((stage) => {
            const stageItems = filteredItems.filter((i) => i.stage === stage.id);
            return (
              <div
                key={stage.id}
                className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-3 flex flex-col gap-2.5 min-h-[420px] shadow-xs"
              >
                <div className="flex items-center justify-between border-b border-[var(--surface-border)] pb-2">
                  <span className="text-xs font-bold font-mono text-[var(--text-main)]">
                    {stage.shortLabel}
                  </span>
                  <span className="rounded-full bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-0.5 text-[10px] font-mono text-[var(--surface-accent)] font-semibold">
                    {stageItems.length}
                  </span>
                </div>
                <div className="space-y-2.5 flex-1 overflow-y-auto">
                  {stageItems.map((item) => {
                    const vBadge = VERTICAL_BADGE_MAP[item.vertical];
                    return (
                      <div
                        key={item.id}
                        className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-elevated)] p-2.5 space-y-2 hover:border-[var(--surface-border-strong)] transition shadow-xs"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[10px] font-mono font-bold text-[var(--semantic-alert)]">
                            {item.priority}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${vBadge.className}`}
                          >
                            {vBadge.label}
                          </span>
                        </div>
                        <div className="text-xs font-bold text-[var(--text-main)] leading-snug">
                          {item.title}
                        </div>
                        <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)]">
                          <span className="text-[var(--surface-accent)] font-semibold">{item.assigned_agent_id}</span>
                          <span>{item.project_slug}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
