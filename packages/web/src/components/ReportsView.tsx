import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Cpu,
  Flame,
  GitBranch,
  Globe,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Share2,
  Sparkles,
  Terminal,
  Users,
  Zap,
} from 'lucide-react';
import { apiClient } from '../api/client';
import type { UnifiedReportItem } from '../data/reportsCatalog';
import { useFollowedVertical } from '../hooks/useVerticalFilter';
import type { Agent, AgentRun, BacklogItem, InferenceStep } from '../types/warden';
import {
  formatCompactTokens,
  formatRelativeTime,
  formatStopwatch,
  formatUsd,
} from '../utils/formatters';
import type { VerticalScope } from './ConsultationKnob';
import { TokenBreakdownBar } from './TokenBreakdownBar';

interface ReportsViewProps {
  activeVertical?: VerticalScope;
  agents?: Agent[];
  runs?: AgentRun[];
  backlogItems?: BacklogItem[];
  focusedRunId?: string | null;
  focusedBacklogItemId?: string | null;
  onFocusConsumed?: () => void;
  liveBrainStatus?: {
    runId: string;
    agentSlug?: string;
    stepIndex?: number;
    totalSteps?: number;
    summary?: string;
    taskTitle?: string;
  } | null;
  onTriggerStandupNow?: () => Promise<void>;
  onOpenBacklog?: () => void;
  onOpenBacklogItem?: (itemId: string) => void;
  onOpenChatWithAgent?: (slug: string) => void;
  onInspectAgent?: (
    agent: Agent,
    subTab?: 'runs' | 'trace' | 'config',
    runId?: string | null
  ) => void;
  onOpenReportWindowTab?: (report: UnifiedReportItem) => void;
}

type StatusFilter = 'ALL' | 'RUNNING' | 'COMPLETED';

type AnnotatedStep = InferenceStep & {
  _agentSlug?: string;
  _runId?: string;
};

function sortAgentRuns(list: AgentRun[]): AgentRun[] {
  return [...list].sort((a, b) => {
    const aLive = a.status === 'RUNNING' || a.status === 'VERIFYING_QA' ? 1 : 0;
    const bLive = b.status === 'RUNNING' || b.status === 'VERIFYING_QA' ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;
    return (b.started_at || '').localeCompare(a.started_at || '');
  });
}

function safeRunDurationMs(r: AgentRun): number {
  const raw = Number(r.active_duration_ms || 0);
  if (Number.isFinite(raw) && raw > 0 && raw <= 3_600_000) return raw;
  const start = Date.parse(r.started_at || '');
  const end = Date.parse(r.ended_at || '');
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return Math.min(300_000, end - start);
  }
  return raw > 3_600_000 ? 18_400 : 0;
}

function classifyAgentVertical(
  agentIdOrSlug?: string | null,
  department?: string | null,
  promptOrTask?: string | null
): Exclude<VerticalScope, 'ALL'> {
  const p = (promptOrTask || '').toLowerCase();
  if (
    p.includes('seo') ||
    p.includes('aeo') ||
    p.includes('faq schema') ||
    p.includes('llms.txt')
  ) {
    return 'SEO_AEO';
  }
  if (
    p.includes('social') ||
    p.includes('visuals') ||
    p.includes('clips') ||
    p.includes('launch thread')
  ) {
    return 'SOCIAL';
  }
  const s = `${agentIdOrSlug || ''} ${department || ''}`.toLowerCase();
  if (s.includes('seo') || s.includes('aeo') || s.includes('cbo')) return 'SEO_AEO';
  if (s.includes('social') || s.includes('cmo') || s.includes('marketing')) return 'SOCIAL';
  return 'TECH';
}

const VERTICAL_BADGE_STYLE: Record<
  Exclude<VerticalScope, 'ALL'>,
  { label: string; className: string; icon: React.ReactNode }
> = {
  TECH: {
    label: 'Tech',
    className:
      'bg-[var(--surface-accent-gold)]/15 text-[var(--surface-accent-gold)] border-[var(--surface-accent-gold)]/35',
    icon: <Cpu className="h-3 w-3 text-[var(--surface-accent-gold)]" />,
  },
  SEO_AEO: {
    label: 'SEO / AEO',
    className:
      'bg-[var(--semantic-success)]/15 text-[var(--semantic-success)] border-[var(--semantic-success)]/35',
    icon: <Globe className="h-3 w-3 text-[var(--semantic-success)]" />,
  },
  SOCIAL: {
    label: 'Social',
    className:
      'bg-[var(--surface-accent)]/15 text-[var(--surface-accent)] border-[var(--surface-accent)]/35',
    icon: <Share2 className="h-3 w-3 text-[var(--surface-accent)]" />,
  },
};

export const ReportsView: React.FC<ReportsViewProps> = ({
  activeVertical = 'ALL',
  agents: externalAgents,
  runs: externalRuns,
  backlogItems = [],
  focusedRunId,
  focusedBacklogItemId,
  onFocusConsumed,
  liveBrainStatus: externalLiveBrainStatus,
  onOpenBacklogItem,
  onOpenChatWithAgent,
}) => {
  const [localVertical, setLocalVertical] = useFollowedVertical(activeVertical);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [runs, setRuns] = useState<AgentRun[]>(() =>
    sortAgentRuns(externalRuns || [])
  );
  const [agents, setAgents] = useState<Agent[]>(externalAgents || []);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(() => {
    const initial = sortAgentRuns(externalRuns || []);
    const firstLive = initial.find(
      (r) => r.status === 'RUNNING' || r.status === 'VERIFYING_QA'
    );
    return focusedRunId || firstLive?.id || initial[0]?.id || null;
  });
  const [steps, setSteps] = useState<AnnotatedStep[]>([]);
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
  const [liveBrainStatus, setLiveBrainStatus] = useState<{
    runId: string;
    agentSlug?: string;
    stepIndex?: number;
    totalSteps?: number;
    summary?: string;
    taskTitle?: string;
  } | null>(externalLiveBrainStatus || null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const traceInspectorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (externalAgents && externalAgents.length > 0) {
      setAgents(externalAgents);
    }
  }, [externalAgents]);

  useEffect(() => {
    if (externalLiveBrainStatus) {
      setLiveBrainStatus(externalLiveBrainStatus);
    }
  }, [externalLiveBrainStatus]);

  useEffect(() => {
    if (externalRuns && externalRuns.length > 0) {
      const sorted = sortAgentRuns(externalRuns);
      setRuns(sorted);
      setSelectedRunId((prev) => {
        if (prev && sorted.some((r) => r.id === prev)) {
          const current = sorted.find((r) => r.id === prev);
          if (current?.status === 'COMPLETED') {
            const liveInChain = sorted.find(
              (r) =>
                (r.parent_run_id === prev ||
                  (current.backlog_item_id &&
                    r.backlog_item_id === current.backlog_item_id)) &&
                (r.status === 'RUNNING' || r.status === 'VERIFYING_QA')
            );
            if (liveInChain) return liveInChain.id;
          }
          return prev;
        }
        const firstLive = sorted.find(
          (r) => r.status === 'RUNNING' || r.status === 'VERIFYING_QA'
        );
        return firstLive?.id || sorted[0]?.id || null;
      });
    }
  }, [externalRuns]);

  useEffect(() => {
    if (!focusedRunId && !focusedBacklogItemId) return;
    if (focusedRunId) {
      setSelectedRunId(focusedRunId);
      setStatusFilter('ALL');
      setLocalVertical('ALL');
      setSearchQuery('');
      onFocusConsumed?.();
      return;
    }
    if (focusedBacklogItemId && runs.length > 0) {
      const matchingChain = runs.filter(
        (r) => r.backlog_item_id === focusedBacklogItemId
      );
      const activeMatch =
        matchingChain.find(
          (r) => r.status === 'RUNNING' || r.status === 'VERIFYING_QA'
        ) || matchingChain[0];
      if (activeMatch) {
        setSelectedRunId(activeMatch.id);
        setStatusFilter('ALL');
        setLocalVertical('ALL');
        setSearchQuery('');
        onFocusConsumed?.();
      }
    }
  }, [focusedRunId, focusedBacklogItemId, runs, onFocusConsumed, setLocalVertical]);

  const agentByIdOrSlug = useCallback(
    (idOrSlug?: string | null): Agent | undefined => {
      if (!idOrSlug) return undefined;
      const clean = idOrSlug.replace(/^@/, '');
      return agents.find(
        (a) =>
          a.id === idOrSlug ||
          a.id === clean ||
          a.slug === idOrSlug ||
          a.slug === `@${clean}`
      );
    },
    [agents]
  );

  const getChainRunsForRun = useCallback(
    (targetRun: AgentRun | null | undefined, allRuns: AgentRun[]): AgentRun[] => {
      if (!targetRun) return [];
      if (targetRun.backlog_item_id) {
        return allRuns
          .filter((r) => r.backlog_item_id === targetRun.backlog_item_id)
          .sort((a, b) => (a.started_at || '').localeCompare(b.started_at || ''));
      }
      return [targetRun];
    },
    []
  );

  const loadActivity = useCallback(async () => {
    const [loadedRuns, loadedAgents] = await Promise.all([
      apiClient.getAgentRuns(),
      externalAgents && externalAgents.length > 0
        ? Promise.resolve(externalAgents)
        : apiClient.getAgents(),
    ]);
    const sorted = sortAgentRuns(loadedRuns);
    setRuns(sorted);
    setAgents(loadedAgents);
    setSelectedRunId((prev) => {
      if (prev) {
        const current = sorted.find((r) => r.id === prev);
        if (current) {
          // If the currently viewed run just completed and spawned a live child run,
          // advance automatically so the user sees the active subagent brain trace.
          if (current.status === 'COMPLETED') {
            const liveChild = sorted.find(
              (r) =>
                (r.parent_run_id === prev ||
                  (current.backlog_item_id &&
                    r.backlog_item_id === current.backlog_item_id)) &&
                (r.status === 'RUNNING' || r.status === 'VERIFYING_QA')
            );
            if (liveChild) return liveChild.id;
          }
          return prev;
        }
      }
      const firstLive = sorted.find(
        (r) => r.status === 'RUNNING' || r.status === 'VERIFYING_QA'
      );
      return firstLive?.id || sorted[0]?.id || null;
    });
  }, [externalAgents]);

  const loadStepsForSelected = useCallback(
    async (runId: string | null) => {
      if (!runId) {
        setSteps([]);
        return;
      }
      const targetRun = runs.find((r) => r.id === runId);
      const chainRuns =
        targetRun && targetRun.backlog_item_id
          ? runs
              .filter((r) => r.backlog_item_id === targetRun.backlog_item_id)
              .sort((a, b) =>
                (a.started_at || '').localeCompare(b.started_at || '')
              )
          : targetRun
            ? [targetRun]
            : [];

      const runsToLoad =
        chainRuns.length > 0
          ? chainRuns
          : [{ id: runId, agent_id: targetRun?.agent_id || 'warden' } as AgentRun];

      const stepLists = await Promise.all(
        runsToLoad.map(async (r) => {
          const rSteps = await apiClient.getInferenceSteps(r.id);
          const ag = agentByIdOrSlug(r.agent_id);
          const slug =
            ag?.slug ||
            (r.agent_id?.startsWith('@') ? r.agent_id : `@${r.agent_id}`);
          return rSteps
            .slice()
            .sort((a, b) => (a.step_index || 0) - (b.step_index || 0))
            .map((s) => ({
              ...s,
              _agentSlug: slug,
              _runId: r.id,
            }));
        })
      );

      const combinedSteps = stepLists.flat();
      setSteps(combinedSteps);
      setExpandedSteps((prev) => {
        const next = { ...prev };
        for (const s of combinedSteps) {
          if (next[s.id] === undefined) {
            next[s.id] = true;
          }
        }
        return next;
      });
    },
    [runs, agentByIdOrSlug]
  );

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  useEffect(() => {
    void loadStepsForSelected(selectedRunId);
  }, [selectedRunId, loadStepsForSelected]);

  useEffect(() => {
    const unsubscribe = apiClient.subscribe((evt) => {
      if (evt.type === 'BRAIN_STATUS' && evt.data) {
        const data = evt.data as {
          runId?: string;
          agentSlug?: string;
          stepIndex?: number;
          totalSteps?: number;
          summary?: string;
          taskTitle?: string;
        };
        if (data.runId) {
          setLiveBrainStatus({
            runId: data.runId,
            agentSlug: data.agentSlug,
            stepIndex: data.stepIndex,
            totalSteps: data.totalSteps,
            summary: data.summary,
            taskTitle: data.taskTitle,
          });
        }
      }
      if (
        evt.type === 'RUN_UPDATED' ||
        evt.type === 'STEP_CREATED' ||
        evt.type === 'AGENT_UPDATED' ||
        evt.type === 'BACKLOG_UPDATED'
      ) {
        void loadActivity();
        if (evt.type === 'STEP_CREATED' && evt.data) {
          const step = evt.data as InferenceStep;
          if (step.run_id && selectedRunId) {
            setExpandedSteps((prev) =>
              prev[step.id] !== undefined ? prev : { ...prev, [step.id]: true }
            );
            void loadStepsForSelected(selectedRunId);
          }
        } else if (evt.type === 'RUN_UPDATED' && evt.data) {
          if (selectedRunId) {
            void loadStepsForSelected(selectedRunId);
          }
        }
      }
    });
    return unsubscribe;
  }, [loadActivity, loadStepsForSelected, selectedRunId]);

  const liveRuns = useMemo(
    () =>
      runs.filter((r) => r.status === 'RUNNING' || r.status === 'VERIFYING_QA'),
    [runs]
  );

  const inProgressTasks = useMemo(
    () =>
      backlogItems.filter(
        (b) => b.stage === 'IN_PROGRESS' || b.stage === 'QA_REVIEW'
      ),
    [backlogItems]
  );

  const completedRunsCount = useMemo(
    () => runs.filter((r) => r.status === 'COMPLETED').length,
    [runs]
  );

  const filteredRuns = useMemo(() => {
    return runs.filter((run) => {
      const ag = agentByIdOrSlug(run.agent_id);
      const vertical = classifyAgentVertical(
        ag?.slug || run.agent_id,
        ag?.department,
        `${run.input_prompt || ''} ${run.output_summary || ''} ${run.backlog_item_id || ''}`
      );
      if (localVertical !== 'ALL' && vertical !== localVertical) {
        return false;
      }
      if (statusFilter === 'RUNNING') {
        if (run.status !== 'RUNNING' && run.status !== 'VERIFYING_QA') return false;
      } else if (statusFilter === 'COMPLETED') {
        if (run.status !== 'COMPLETED') return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const slug = (ag?.slug || run.agent_id || '').toLowerCase();
        const prompt = (run.input_prompt || '').toLowerCase();
        const summary = (run.output_summary || '').toLowerCase();
        return slug.includes(q) || prompt.includes(q) || summary.includes(q);
      }
      return true;
    });
  }, [runs, agentByIdOrSlug, localVertical, statusFilter, searchQuery]);

  const selectedRun = useMemo(
    () =>
      runs.find((r) => r.id === selectedRunId) ||
      filteredRuns[0] ||
      runs[0] ||
      null,
    [runs, filteredRuns, selectedRunId]
  );

  const selectedAgent = useMemo(
    () => (selectedRun ? agentByIdOrSlug(selectedRun.agent_id) : undefined),
    [selectedRun, agentByIdOrSlug]
  );

  const selectedBacklogItem = useMemo(() => {
    if (!selectedRun?.backlog_item_id) return undefined;
    return backlogItems.find((b) => b.id === selectedRun.backlog_item_id);
  }, [selectedRun, backlogItems]);

  const delegationChain = useMemo(
    () => getChainRunsForRun(selectedRun, runs),
    [selectedRun, runs, getChainRunsForRun]
  );

  const handleSelectRunAndInspect = useCallback((runId: string) => {
    setSelectedRunId(runId);
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      window.setTimeout(() => {
        traceInspectorRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 60);
    }
  }, []);

  // Real-time 1.5s polling while any run is active so the Brain Trace updates
  // live even if WebSocket frames are buffered or reconnected.
  useEffect(() => {
    const activeId = selectedRun?.id || selectedRunId;
    const hasLive =
      liveRuns.length > 0 ||
      selectedRun?.status === 'RUNNING' ||
      selectedRun?.status === 'VERIFYING_QA';
    if (!hasLive) return;

    const timer = window.setInterval(() => {
      void loadActivity();
      if (activeId) {
        void loadStepsForSelected(activeId);
      }
    }, 1500);

    return () => window.clearInterval(timer);
  }, [liveRuns.length, selectedRun?.id, selectedRun?.status, selectedRunId, loadActivity, loadStepsForSelected]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await loadActivity();
      if (selectedRunId) {
        await loadStepsForSelected(selectedRunId);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. Top Header & Live Activity Controls */}
      <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/35 p-2.5 text-[var(--surface-accent-gold)] shrink-0">
              <Activity
                className={`h-5 w-5 ${liveRuns.length > 0 ? 'animate-pulse' : ''}`}
              />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base sm:text-lg font-bold text-[var(--text-main)]">
                  Live Agent Activity &amp; Brain Trace
                </h1>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-mono font-bold ${
                    liveRuns.length > 0
                      ? 'bg-[var(--semantic-success)]/15 border-[var(--semantic-success)]/40 text-[var(--semantic-success)]'
                      : 'bg-[var(--surface-elevated)] border-[var(--surface-border)] text-[var(--text-muted)]'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      liveRuns.length > 0
                        ? 'bg-[var(--semantic-success)] animate-pulse'
                        : 'bg-[var(--text-muted)]'
                    }`}
                  />
                  <span>{liveRuns.length} Live Running</span>
                </span>
                <span className="rounded-full bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/30 px-2.5 py-0.5 text-[11px] font-mono text-[var(--surface-accent-gold)]">
                  {inProgressTasks.length} In-Progress Task{inProgressTasks.length === 1 ? '' : 's'}
                </span>
                <span className="rounded-full bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2.5 py-0.5 text-[11px] font-mono text-[var(--text-muted)]">
                  {completedRunsCount} Completed
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Click any running or completed agent below to inspect its real-time reasoning, tool calls, and step-by-step brain trace.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Status filter pills */}
            <div className="inline-flex items-center rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-border)] p-1 gap-1">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  { id: 'RUNNING', label: `Running (${liveRuns.length})` },
                  { id: 'COMPLETED', label: `Completed (${completedRunsCount})` },
                ] as { id: StatusFilter; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                    statusFilter === tab.id
                      ? 'bg-[var(--surface-accent-gold)]/15 text-[var(--surface-accent-gold)] border border-[var(--surface-accent-gold)]/40 shadow-xs'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

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
                placeholder="Filter agents or tasks..."
                className="rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-border)] pl-8 pr-3 py-1.5 text-xs text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--surface-accent-gold)] w-44 transition"
              />
            </div>

            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-border)] hover:border-[var(--surface-accent-gold)]/50 px-3 py-1.5 text-xs font-semibold text-[var(--text-main)] transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Live Running Agents Strip */}
        {liveRuns.length > 0 && (
          <div className="mt-4 pt-3.5 border-t border-[var(--surface-border)] space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono font-bold text-[var(--semantic-success)] flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[var(--semantic-success)] animate-pulse" />
                <span>LIVE RUNNING AGENTS — CLICK TO INSPECT BRAIN TRACE</span>
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
              {liveRuns.map((run) => {
                const ag = agentByIdOrSlug(run.agent_id);
                const slug = ag?.slug || `@${run.agent_id}`;
                const isSelected = selectedRun?.id === run.id;
                const liveStep =
                  liveBrainStatus && liveBrainStatus.runId === run.id
                    ? liveBrainStatus
                    : null;
                return (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => handleSelectRunAndInspect(run.id)}
                    className={`text-left rounded-xl border p-3 transition cursor-pointer ${
                      isSelected
                        ? 'border-[var(--semantic-success)] bg-[var(--semantic-success)]/10 ring-1 ring-[var(--semantic-success)]/40'
                        : 'border-[var(--semantic-success)]/40 bg-[var(--surface-elevated)] hover:border-[var(--semantic-success)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-[var(--surface-accent-gold)]">
                        {slug}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--semantic-success)]/20 border border-[var(--semantic-success)]/40 px-2 py-0.5 text-[10px] font-mono font-bold text-[var(--semantic-success)]">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>{run.status === 'VERIFYING_QA' ? 'VERIFYING QA' : 'RUNNING'}</span>
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-[var(--text-main)] mt-1.5 truncate">
                      {run.input_prompt}
                    </p>
                    <p className="text-[11px] font-mono text-[var(--text-muted)] mt-1 truncate">
                      {liveStep?.summary || run.output_summary || 'Executing brain trace steps...'}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 2. Split-Pane Activity Feed & Live Brain Trace Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left Column: Agent Runs & Task Activity List (5 cols) */}
        <div className="lg:col-span-5 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] overflow-hidden shadow-sm">
          <div className="border-b border-[var(--surface-border)] bg-[var(--surface-elevated)] px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)]">
              Agent Execution &amp; Past Activity ({filteredRuns.length})
            </span>
            <span className="text-[11px] font-mono text-[var(--surface-accent-gold)]">
              WebSocket Live
            </span>
          </div>

          <div className="divide-y divide-[var(--surface-border-subtle)] max-h-[680px] overflow-y-auto">
            {filteredRuns.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <Brain className="h-8 w-8 text-[var(--text-muted)] mx-auto opacity-60" />
                <p className="text-xs font-semibold text-[var(--text-main)]">
                  No agent runs recorded yet
                </p>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Approve a task in Needs Action on the Home page or message @warden to watch agents execute live here.
                </p>
              </div>
            ) : (
              filteredRuns.map((run, idx) => {
                const ag = agentByIdOrSlug(run.agent_id);
                const slug = ag?.slug || `@${run.agent_id}`;
                const vertical = classifyAgentVertical(
                  slug,
                  ag?.department,
                  `${run.input_prompt || ''} ${run.output_summary || ''} ${run.backlog_item_id || ''}`
                );
                const vBadge = VERTICAL_BADGE_STYLE[vertical];
                const isSelected = selectedRun?.id === run.id;
                const isLive =
                  run.status === 'RUNNING' || run.status === 'VERIFYING_QA';
                const prevRun = idx > 0 ? filteredRuns[idx - 1] : null;
                const prevIsLive =
                  prevRun &&
                  (prevRun.status === 'RUNNING' || prevRun.status === 'VERIFYING_QA');
                const showPastHeader =
                  !isLive && (idx === 0 || Boolean(prevIsLive));

                const taskChain = getChainRunsForRun(run, runs);
                const chainAgentSlugs = Array.from(
                  new Set(
                    (taskChain.length > 0 ? taskChain : [run]).map((r) => {
                      const chainAg = agentByIdOrSlug(r.agent_id);
                      return (
                        chainAg?.slug ||
                        (r.agent_id.startsWith('@') ? r.agent_id : `@${r.agent_id}`)
                      );
                    })
                  )
                );
                const chainRunsForStats = taskChain.length > 0 ? taskChain : [run];
                const chainTokens = chainRunsForStats.reduce(
                  (sum, r) =>
                    sum +
                    (r.tokens_in || 0) +
                    (r.tokens_thinking || 0) +
                    (r.tokens_out || 0),
                  0
                );
                const chainDurationMs = chainRunsForStats.reduce(
                  (sum, r) => sum + safeRunDurationMs(r),
                  0
                );
                const chainCostUsd = chainRunsForStats.reduce(
                  (sum, r) => sum + (r.cost_usd || 0),
                  0
                );

                return (
                  <React.Fragment key={run.id}>
                    {showPastHeader && (
                      <div className="bg-[var(--surface-elevated)]/80 px-4 py-2 flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                        <span>Past &amp; Completed Activity</span>
                        <span>Click any card to open Brain Trace</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleSelectRunAndInspect(run.id)}
                      className={`w-full text-left p-4 transition cursor-pointer block ${
                        isSelected
                          ? 'bg-[var(--surface-accent-gold)]/10 border-l-4 border-l-[var(--surface-accent-gold)]'
                          : 'hover:bg-[var(--surface-elevated)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold text-[var(--surface-accent-gold)]">
                            {slug}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${vBadge.className}`}
                          >
                            {vBadge.icon}
                            <span>{vBadge.label}</span>
                          </span>
                        </div>

                        {isLive ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--semantic-success)]/15 border border-[var(--semantic-success)]/40 px-2 py-0.5 text-[10px] font-mono font-bold text-[var(--semantic-success)]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[var(--semantic-success)] animate-pulse" />
                            <span>{run.status === 'VERIFYING_QA' ? 'QA CHECK' : 'RUNNING'}</span>
                          </span>
                        ) : run.status === 'COMPLETED' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/35 px-2 py-0.5 text-[10px] font-mono font-semibold text-[var(--surface-accent-gold)]">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>COMPLETED</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--semantic-alert)]/15 border border-[var(--semantic-alert)]/35 px-2 py-0.5 text-[10px] font-mono font-semibold text-[var(--semantic-alert)]">
                            <AlertTriangle className="h-3 w-3" />
                            <span>{run.status}</span>
                          </span>
                        )}
                      </div>

                      <h3 className="text-xs sm:text-sm font-bold text-[var(--text-main)] leading-snug line-clamp-2">
                        {run.input_prompt}
                      </h3>

                      {run.output_summary && (
                        <p className="text-[11px] text-[var(--text-muted)] mt-1 line-clamp-2">
                          {run.output_summary}
                        </p>
                      )}

                      {/* High-Level Analytics Badges */}
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-0.5 text-[10px] font-mono text-[var(--text-main)]">
                          <Users className="h-3 w-3 text-[var(--surface-accent-gold)] shrink-0" />
                          <span className="truncate max-w-[240px]">
                            {chainAgentSlugs.length}{' '}
                            {chainAgentSlugs.length === 1 ? 'agent' : 'agents'} (
                            {chainAgentSlugs.join(' → ')})
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-accent-gold)]/10 border border-[var(--surface-accent-gold)]/30 px-2 py-0.5 text-[10px] font-mono font-semibold text-[var(--surface-accent-gold)]">
                          <span>{formatCompactTokens(chainTokens)} tok</span>
                        </span>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-[var(--text-muted)]">
                        <div className="flex items-center gap-1.5">
                          <span>{formatRelativeTime(run.started_at)}</span>
                          <span>•</span>
                          <span>{formatStopwatch(chainDurationMs)}</span>
                          <span>•</span>
                          <span className="text-[var(--semantic-success)]">
                            {formatUsd(chainCostUsd)}
                          </span>
                        </div>
                        <span className="text-[var(--surface-accent-gold)] font-semibold">
                          Inspect Brain Trace →
                        </span>
                      </div>
                    </button>
                  </React.Fragment>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Live Brain & Terminal Trace Inspector (7 cols) */}
        <div
          ref={traceInspectorRef}
          className="lg:col-span-7 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] overflow-hidden shadow-sm"
        >
          {selectedRun ? (
            <>
              {/* Selected Run Header */}
              <div className="border-b border-[var(--surface-border)] bg-[var(--surface-elevated)] p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm sm:text-base font-bold text-[var(--surface-accent-gold)]">
                        {selectedAgent?.slug || `@${selectedRun.agent_id}`}
                      </span>
                      {selectedAgent?.role_title && (
                        <span className="text-xs text-[var(--text-muted)]">
                          ({selectedAgent.role_title})
                        </span>
                      )}
                      {selectedRun.status === 'RUNNING' ||
                      selectedRun.status === 'VERIFYING_QA' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--semantic-success)]/15 border border-[var(--semantic-success)]/40 px-2.5 py-0.5 text-[11px] font-mono font-bold text-[var(--semantic-success)]">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span>
                            {selectedRun.status === 'VERIFYING_QA'
                              ? 'LIVE • VERIFYING QA'
                              : 'LIVE • RUNNING'}
                          </span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/35 px-2.5 py-0.5 text-[11px] font-mono font-bold text-[var(--surface-accent-gold)]">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>{selectedRun.status}</span>
                        </span>
                      )}
                    </div>
                    <h2 className="text-sm sm:text-base font-bold text-[var(--text-main)] mt-1.5">
                      {selectedRun.input_prompt}
                    </h2>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {selectedBacklogItem && onOpenBacklogItem && (
                      <button
                        type="button"
                        onClick={() => onOpenBacklogItem(selectedBacklogItem.id)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--surface-panel)] border border-[var(--surface-border)] hover:border-[var(--surface-accent-gold)]/50 px-3 py-1.5 text-xs font-semibold text-[var(--text-main)] transition cursor-pointer"
                      >
                        <span>
                          Task (
                          {selectedBacklogItem.stage === 'DONE' ||
                          (delegationChain.length > 0 &&
                            delegationChain.every((r) => r.status === 'COMPLETED'))
                            ? 'DONE'
                            : selectedBacklogItem.stage}
                          )
                        </span>
                      </button>
                    )}
                    {onOpenChatWithAgent && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenChatWithAgent(
                            selectedAgent?.slug || `@${selectedRun.agent_id}`
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/40 hover:bg-[var(--surface-accent-gold)]/25 px-3 py-1.5 text-xs font-semibold text-[var(--surface-accent-gold)] transition cursor-pointer"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        <span>Chat with Agent</span>
                      </button>
                    )}
                  </div>
                </div>

                {delegationChain.length > 1 && (
                  <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-panel)] px-3 py-2 flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                    <span className="text-[var(--text-muted)] mr-1">Spawn Chain:</span>
                    {delegationChain.map((chainRun, idx) => {
                      const chainAgent = agentByIdOrSlug(chainRun.agent_id);
                      const chainSlug = chainAgent?.slug || `@${chainRun.agent_id}`;
                      const active = chainRun.id === selectedRun.id;
                      const running =
                        chainRun.status === 'RUNNING' ||
                        chainRun.status === 'VERIFYING_QA';
                      return (
                        <React.Fragment key={chainRun.id}>
                          {idx > 0 && (
                            <span className="text-[var(--text-muted)]">→</span>
                          )}
                          <button
                            type="button"
                            onClick={() => setSelectedRunId(chainRun.id)}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 transition cursor-pointer ${
                              active
                                ? 'border-[var(--surface-accent-gold)] bg-[var(--surface-accent-gold)]/20 text-[var(--surface-accent-gold)] font-bold'
                                : 'border-[var(--surface-border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
                            }`}
                          >
                            {running ? (
                              <span className="h-1.5 w-1.5 rounded-full bg-[var(--semantic-success)] animate-pulse" />
                            ) : (
                              <CheckCircle2 className="h-3 w-3 text-[var(--surface-accent-gold)]" />
                            )}
                            <span>{chainSlug}</span>
                          </button>
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}

                {/* Output Summary & Metadata */}
                {selectedRun.output_summary && (
                  <p className="text-xs text-[var(--text-muted)] bg-[var(--surface-panel)] rounded-xl p-3 border border-[var(--surface-border)]">
                    {selectedRun.output_summary}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[var(--text-muted)]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-[var(--surface-panel)] border border-[var(--surface-border)] px-2 py-0.5 text-[var(--surface-accent-gold)]">
                      Run #{selectedRun.id.slice(0, 14)}
                    </span>
                    {selectedRun.container_id && (
                      <span className="rounded bg-[var(--surface-panel)] border border-[var(--surface-border)] px-2 py-0.5">
                        🐳 {selectedRun.container_id}
                      </span>
                    )}
                    {selectedRun.git_branch && (
                      <span className="inline-flex items-center gap-1 rounded bg-[var(--surface-panel)] border border-[var(--surface-border)] px-2 py-0.5 text-[var(--semantic-success)]">
                        <GitBranch className="h-3 w-3" />
                        {selectedRun.git_branch}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      <strong className="text-[var(--text-main)]">
                        {formatStopwatch(
                          (delegationChain.length > 0
                            ? delegationChain
                            : [selectedRun]
                          ).reduce((sum, r) => sum + safeRunDurationMs(r), 0)
                        )}
                      </strong>
                    </span>
                    <span>
                      Cost:{' '}
                      <strong className="text-[var(--semantic-success)]">
                        {formatUsd(selectedRun.cost_usd || 0)}
                      </strong>
                    </span>
                  </div>
                </div>

                <TokenBreakdownBar
                  tokensIn={selectedRun.tokens_in || 0}
                  tokensCached={selectedRun.tokens_cached || 0}
                  tokensThinking={selectedRun.tokens_thinking || 0}
                  tokensOut={selectedRun.tokens_out || 0}
                  maxTokensQuota={selectedAgent?.max_tokens_per_run || 1_000_000}
                />
              </div>

              {/* Step-by-Step Brain & Terminal Trace Body */}
              <div className="p-4 sm:p-5 space-y-3 max-h-[540px] overflow-y-auto">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--surface-accent-gold)] flex items-center gap-1.5">
                    <Terminal className="h-3.5 w-3.5" />
                    <span>Step-by-Step Brain &amp; Terminal Trace ({steps.length})</span>
                  </span>
                  <span className="text-[11px] font-mono text-[var(--text-muted)]">
                    Auto-updates via WebSocket
                  </span>
                </div>

                {steps.map((step) => {
                  const isExpanded = expandedSteps[step.id] ?? true;
                  const stepTotalTokens =
                    (step.tokens_in || 0) +
                    (step.tokens_thinking || 0) +
                    (step.tokens_out || 0);
                  const isExpensiveStep = stepTotalTokens >= 50_000;

                  return (
                    <div
                      key={step.id}
                      className={`rounded-2xl border transition ${
                        isExpensiveStep
                          ? 'border-[var(--semantic-warning)]/50 bg-[var(--semantic-warning)]/5'
                          : 'border-[var(--surface-border)] bg-[var(--surface-elevated)]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSteps((prev) => ({
                            ...prev,
                            [step.id]: !isExpanded,
                          }))
                        }
                        className="w-full flex flex-wrap items-center justify-between gap-2 p-3.5 text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-[var(--surface-accent-gold)]" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
                          )}
                          <span className="rounded bg-[var(--surface-panel)] border border-[var(--surface-border)] px-2 py-0.5 text-[11px] font-mono font-bold text-[var(--surface-accent-gold)]">
                            {step._agentSlug ? `${step._agentSlug} • ` : ''}Step #{step.step_index} • {step.step_type}
                          </span>
                          {step.tool_name && (
                            <span className="rounded bg-[var(--surface-accent)]/15 border border-[var(--surface-accent)]/30 px-2 py-0.5 text-[11px] font-mono text-[var(--surface-accent)]">
                              🛠️ {step.tool_name}
                            </span>
                          )}
                          {isExpensiveStep && (
                            <span className="inline-flex items-center gap-1 rounded bg-[var(--semantic-warning)]/15 border border-[var(--semantic-warning)]/40 px-2 py-0.5 text-[10px] font-mono text-[var(--semantic-warning)] font-semibold">
                              <Flame className="h-3 w-3" />
                              {formatCompactTokens(stepTotalTokens)}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-[11px] font-mono text-[var(--text-muted)]">
                          <span>⏱️ {((step.duration_ms || 0) / 1000).toFixed(1)}s</span>
                          <span>
                            Think:{' '}
                            <strong className="text-[var(--surface-accent-gold)]">
                              {formatCompactTokens(step.tokens_thinking || 0)}
                            </strong>
                          </span>
                          <span>
                            Out:{' '}
                            <strong className="text-[var(--surface-accent)]">
                              {formatCompactTokens(step.tokens_out || 0)}
                            </strong>
                          </span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-[var(--surface-border)] p-4 space-y-3 text-xs">
                          {step.thinking_text && (
                            <div className="rounded-xl bg-[var(--surface-panel)] border border-[var(--surface-accent-gold)]/25 p-3 space-y-1">
                              <div className="text-[11px] font-mono font-semibold text-[var(--surface-accent-gold)] flex items-center gap-1.5">
                                <Sparkles className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />
                                <span>
                                  Internal Brain Reasoning ({step.model_used} •{' '}
                                  {formatCompactTokens(step.tokens_thinking || 0)} thinking tok)
                                </span>
                              </div>
                              <p className="text-[var(--text-main)] font-mono text-[11px] leading-relaxed">
                                {step.thinking_text}
                              </p>
                            </div>
                          )}

                          {step.message_text && (
                            <div className="text-[var(--text-main)] font-medium">
                              {step.message_text}
                            </div>
                          )}

                          {step.tool_args_json && (
                            <div className="space-y-1">
                              <div className="text-[11px] font-mono text-[var(--text-muted)] flex items-center gap-1">
                                <Code2 className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />
                                <span>Tool Arguments:</span>
                              </div>
                              <pre className="rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] p-2.5 text-[11px] font-mono text-[var(--text-main)] overflow-x-auto">
                                {JSON.stringify(step.tool_args_json, null, 2)}
                              </pre>
                            </div>
                          )}

                          {step.tool_output_json && (
                            <div className="space-y-2">
                              {step.tool_output_json.diff && (
                                <div className="space-y-1">
                                  <div className="text-[11px] font-mono text-[var(--semantic-success)]">
                                    Workspace Git Diff:
                                  </div>
                                  <pre className="rounded-lg bg-[var(--surface-panel)] border border-[var(--semantic-success)]/30 p-2.5 text-[11px] font-mono text-[var(--semantic-success)] overflow-x-auto">
                                    {step.tool_output_json.diff}
                                  </pre>
                                </div>
                              )}
                              {step.tool_output_json.stdout && (
                                <div className="space-y-1">
                                  <div className="text-[11px] font-mono text-[var(--text-muted)]">
                                    Execution Output (exit_code={step.tool_output_json.exit_code ?? 0}):
                                  </div>
                                  <pre className="rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] p-2.5 text-[11px] font-mono text-[var(--text-main)] overflow-x-auto">
                                    {step.tool_output_json.stdout}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {(selectedRun.status === 'RUNNING' ||
                  selectedRun.status === 'VERIFYING_QA') && (
                  <div className="rounded-2xl border border-[var(--semantic-success)]/40 bg-[var(--semantic-success)]/10 p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Loader2 className="h-4 w-4 text-[var(--semantic-success)] animate-spin shrink-0" />
                      <div>
                        <div className="text-xs font-bold text-[var(--semantic-success)]">
                          {liveBrainStatus?.runId === selectedRun.id && liveBrainStatus.stepIndex
                            ? `Executing Step #${liveBrainStatus.stepIndex} of ${liveBrainStatus.totalSteps || 4}...`
                            : 'Agent Brain Active — Streaming Next Execution Step...'}
                        </div>
                        <div className="text-[11px] font-mono text-[var(--text-muted)] mt-0.5">
                          {liveBrainStatus?.runId === selectedRun.id && liveBrainStatus.summary
                            ? liveBrainStatus.summary
                            : selectedRun.output_summary || 'Reasoning and running workspace tools'}
                        </div>
                      </div>
                    </div>
                    <Zap className="h-4 w-4 text-[var(--semantic-success)] animate-pulse shrink-0" />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p-10 text-center space-y-2">
              <Brain className="h-10 w-10 text-[var(--text-muted)] mx-auto opacity-50" />
              <h3 className="text-sm font-bold text-[var(--text-main)]">
                Select an Agent Run to Inspect Brain Trace
              </h3>
              <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto">
                When agents run tasks from Needs Action or chat directives, their live step-by-step reasoning and tool execution trace streams here in real time.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportsView;
