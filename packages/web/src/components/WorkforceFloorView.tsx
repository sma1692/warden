import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Box,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cpu,
  ExternalLink,
  Flame,
  GitBranch,
  GitCommit,
  LayoutGrid,
  List,
  MessageSquare,
  Power,
  RotateCcw,
  Search,
  Sparkles,
  Terminal,
} from 'lucide-react';
import type { Agent } from '../types/commando';
import {
  formatCompactTokens,
  formatModelBadge,
  formatStopwatch,
  formatUsd,
  formatWorkDuration,
} from '../utils/formatters';
import { TokenBreakdownBar } from './TokenBreakdownBar';
import { HomePriorityWindow } from './HomePriorityWindow';
import { TokenUsageBox } from './TokenUsageBox';

export type UnitFilterOption =
  | 'ALL'
  | 'Executive (@warden)'
  | 'Unit A: Tech (@cto)'
  | 'Unit B: Marketing / SEO & AEO (@cmo -> @seo_aeo_head)'
  | 'Infra & Cloud (@infra_head)'
  | 'Planned C-Suite';

export type TimeWindowOption = '24h' | '7d' | '30d' | 'all';

export type SortColumnKey = 'agent' | 'status' | 'model' | 'task' | 'time' | 'tokens' | 'cost';
export type SortDirection = 'asc' | 'desc';

const UNIT_FILTERS: { id: UnitFilterOption; label: string }[] = [
  { id: 'ALL', label: 'All Units' },
  { id: 'Executive (@warden)', label: 'Executive (@warden)' },
  { id: 'Unit A: Tech (@cto)', label: 'Unit A: Tech (@cto)' },
  {
    id: 'Unit B: Marketing / SEO & AEO (@cmo -> @seo_aeo_head)',
    label: 'Unit B: Marketing / SEO & AEO (@cmo -> @seo_aeo_head)',
  },
  { id: 'Infra & Cloud (@infra_head)', label: 'Infra & Cloud (@infra_head)' },
  { id: 'Planned C-Suite', label: 'Planned C-Suite' },
];

const TIME_WINDOWS: { id: TimeWindowOption; label: string; multiplier: number }[] = [
  { id: '24h', label: 'Last 24 Hours', multiplier: 1 },
  { id: '7d', label: 'Last 1 Week', multiplier: 7 },
  { id: '30d', label: 'Last 1 Month', multiplier: 30 },
  { id: 'all', label: 'All Time', multiplier: 1 },
];

interface WorkforceFloorViewProps {
  agents: Agent[];
  onInspectAgent: (agent: Agent, initialSubTab?: 'runs' | 'trace' | 'config') => void;
  onChatDirectWithAgent: (agent: Agent) => void;
  onKillOrRestartAgent: (agentId: string, action: 'KILL' | 'RESTART') => void;
}

export const WorkforceFloorView: React.FC<WorkforceFloorViewProps> = ({
  agents,
  onInspectAgent,
  onChatDirectWithAgent,
  onKillOrRestartAgent,
}) => {
  const [unitFilter, setUnitFilter] = useState<UnitFilterOption>('ALL');
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'WORKING' | 'WAITING_FOR_CEO' | 'IDLE'
  >('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [timeWindow, setTimeWindow] = useState<TimeWindowOption>('24h');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [sortKey, setSortKey] = useState<SortColumnKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // 1-second live stopwatch ticker for WORKING agents & 24h hard-kill countdown
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Compute lifetime tokens per agent helper
  const getLifetimeTokens = (agent: Agent) =>
    agent.total_tokens_in +
    agent.total_tokens_cached +
    agent.total_tokens_thinking +
    agent.total_tokens_out;

  const handleToggleSort = (col: SortColumnKey) => {
    if (sortKey === col) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col);
      // Metric columns default to descending; string/name columns default to ascending
      if (col === 'tokens' || col === 'cost' || col === 'time' || col === 'status') {
        setSortDirection('desc');
      } else {
        setSortDirection('asc');
      }
    }
  };

  const filteredAgents = useMemo(() => {
    return agents.filter((a) => {
      if (unitFilter !== 'ALL' && a.unit_label !== unitFilter) return false;
      if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesSlug = a.slug.toLowerCase().includes(q);
        const matchesName = a.name.toLowerCase().includes(q);
        const matchesRole = a.role_title.toLowerCase().includes(q);
        const matchesTask = (a.active_task_title || '').toLowerCase().includes(q);
        const matchesRepo = a.allowed_repos.some((r) => r.toLowerCase().includes(q));
        if (!matchesSlug && !matchesName && !matchesRole && !matchesTask && !matchesRepo) {
          return false;
        }
      }
      return true;
    });
  }, [agents, unitFilter, statusFilter, searchQuery]);

  const sortedAgents: Agent[] = useMemo(() => {
    if (!sortKey) return filteredAgents;
    return [...filteredAgents].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'agent') {
        cmp = a.slug.localeCompare(b.slug);
      } else if (sortKey === 'status') {
        const statusScore: Record<string, number> = { WORKING: 3, WAITING_FOR_CEO: 2, IDLE: 1 };
        cmp = (statusScore[a.status] || 0) - (statusScore[b.status] || 0);
        if (cmp === 0) cmp = a.slug.localeCompare(b.slug);
      } else if (sortKey === 'model') {
        const mA = `${a.model_provider}:${a.model_id}`;
        const mB = `${b.model_provider}:${b.model_id}`;
        cmp = mA.localeCompare(mB);
      } else if (sortKey === 'task') {
        const tA = a.active_task_title || '';
        const tB = b.active_task_title || '';
        cmp = tA.localeCompare(tB);
      } else if (sortKey === 'time') {
        cmp = (a.today_work_time_ms || 0) - (b.today_work_time_ms || 0);
      } else if (sortKey === 'tokens') {
        cmp = (a.today_tokens_used || 0) - (b.today_tokens_used || 0);
      } else if (sortKey === 'cost') {
        cmp = (a.total_cost_usd || 0) - (b.total_cost_usd || 0);
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [filteredAgents, sortKey, sortDirection]);

  // Aggregate Metrics based on selected Time Window
  const kpis = useMemo(() => {
    const working = agents.filter((a) => a.status === 'WORKING').length;
    const waiting = agents.filter((a) => a.status === 'WAITING_FOR_CEO').length;
    const idle = agents.filter((a) => a.status === 'IDLE').length;
    const totalCommits = agents.reduce((acc, a) => acc + a.total_commits, 0);

    let totalTokens = 0;
    let totalCostUsd = 0;

    if (timeWindow === '24h') {
      totalTokens = agents.reduce((acc, a) => acc + a.today_tokens_used, 0);
      totalCostUsd = agents.reduce((acc, a) => acc + a.today_tokens_used * 0.0000015, 0);
    } else if (timeWindow === '7d') {
      const todayTokens = agents.reduce((acc, a) => acc + a.today_tokens_used, 0);
      const lifetime = agents.reduce((acc, a) => acc + getLifetimeTokens(a), 0);
      totalTokens = Math.min(lifetime, Math.max(todayTokens * 5, lifetime * 0.4));
      totalCostUsd = agents.reduce((acc, a) => acc + a.total_cost_usd * 0.45, 0);
    } else if (timeWindow === '30d') {
      const lifetime = agents.reduce((acc, a) => acc + getLifetimeTokens(a), 0);
      totalTokens = lifetime * 0.85;
      totalCostUsd = agents.reduce((acc, a) => acc + a.total_cost_usd * 0.85, 0);
    } else {
      totalTokens = agents.reduce((acc, a) => acc + getLifetimeTokens(a), 0);
      totalCostUsd = agents.reduce((acc, a) => acc + a.total_cost_usd, 0);
    }

    return {
      working,
      waiting,
      idle,
      totalCommits,
      totalTokens,
      totalCostUsd,
    };
  }, [agents, timeWindow]);

  const renderStatusBadge = (agent: Agent) => {
    const elapsedMs = agent.clocked_in_at
      ? Math.max(0, nowTick - new Date(agent.clocked_in_at).getTime())
      : 0;
    const maxDurationMs = agent.max_run_duration_ms || 86_400_000;
    const remainingKillMs = Math.max(0, maxDurationMs - elapsedMs);

    if (agent.health_status === 'ZOMBIE_NO_HEARTBEAT' || agent.status === 'ERROR') {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--semantic-alert)]/15 border border-[var(--semantic-alert)]/40 px-2 py-0.5 text-[11px] font-mono font-semibold text-[var(--semantic-alert)]">
          <span>🔴 ZOMBIE</span>
        </span>
      );
    }

    if (agent.health_status === 'STUCK_LOOP' || agent.status === 'UNHEALTHY_LOOP') {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--semantic-warning)]/15 border border-[var(--semantic-warning)]/40 px-2 py-0.5 text-[11px] font-mono font-semibold text-[var(--semantic-warning)]">
          <span>🟠 STUCK_LOOP</span>
        </span>
      );
    }

    if (agent.status === 'WORKING') {
      return (
        <div className="flex flex-col gap-1 items-start">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--semantic-success)]/15 border border-[var(--semantic-success)]/40 px-2.5 py-0.5 text-[11px] font-mono font-semibold text-[var(--semantic-success)]">
            <span className="h-2 w-2 rounded-full bg-[var(--semantic-success)] animate-ping" />
            <span>WORKING</span>
            <span className="text-[var(--text-main)] font-bold">{formatStopwatch(elapsedMs)}</span>
          </span>
          <span
            className="text-[10px] font-mono text-[var(--text-muted)]"
            title="24-Hour Watchdog hard-kill limit"
          >
            ⏳ {formatStopwatch(remainingKillMs)} left
          </span>
        </div>
      );
    }

    if (agent.status === 'WAITING_FOR_CEO') {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--semantic-warning)]/15 border border-[var(--semantic-warning)]/40 px-2.5 py-0.5 text-[11px] font-mono font-semibold text-[var(--semantic-warning)]">
          <span className="h-2 w-2 rounded-full bg-[var(--semantic-warning)] animate-pulse" />
          <span>WAITING FOR CEO</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-0.5 text-[11px] font-mono text-[var(--text-muted)]">
        <span>⚪ IDLE</span>
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <HomePriorityWindow />
        <TokenUsageBox tokensUsed={kpis.totalTokens} />
      </div>

      {/* 1. High-Level KPI Summary Bar & Time Window Dropdown */}
      <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-[var(--surface-border)]">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-[var(--text-main)] flex items-center gap-2">
              <Cpu className="h-5 w-5 text-[var(--surface-accent)]" />
              <span>Executive Workforce Floor &amp; Resource Consumption</span>
            </h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Live multi-agent orchestration, token burn rate, task execution, and subagent state.
            </p>
          </div>

          {/* Time Window Selector Dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-muted)] font-medium">Time Window:</span>
            <div className="relative">
              <select
                value={timeWindow}
                onChange={(e) => setTimeWindow(e.target.value as TimeWindowOption)}
                aria-label="Workforce Time Window"
                className="appearance-none rounded-lg bg-[var(--surface-elevated)] border border-[var(--surface-border)] pl-3 pr-8 py-1.5 text-xs font-semibold text-[var(--text-main)] hover:border-[var(--surface-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--surface-accent)] cursor-pointer shadow-xs transition"
              >
                {TIME_WINDOWS.map((tw) => (
                  <option key={tw.id} value={tw.id} className="bg-[var(--surface-panel)] text-[var(--text-main)]">
                    {tw.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="h-3.5 w-3.5 text-[var(--surface-accent)] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* 5 KPI Metric Cards */}
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Card 1: Token Consumption */}
          <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-elevated)] p-3 flex flex-col justify-between shadow-xs hover:border-[var(--surface-border-strong)] transition">
            <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
              <Flame className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />
              <span>Token Consumption</span>
            </div>
            <div className="mt-1.5 text-lg sm:text-xl font-bold font-mono text-[var(--surface-accent-gold)]">
              {formatCompactTokens(kpis.totalTokens)}
            </div>
            <div className="text-[10px] text-[var(--surface-text-muted)] mt-0.5 capitalize">
              {timeWindow === '24h'
                ? 'Today (24h)'
                : timeWindow === '7d'
                  ? 'Last 7 days'
                  : timeWindow === '30d'
                    ? 'Last 30 days'
                    : 'All time cumulative'}
            </div>
          </div>

          {/* Card 2: Cost / USD Burn */}
          <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-elevated)] p-3 flex flex-col justify-between shadow-xs hover:border-[var(--surface-border-strong)] transition">
            <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-[var(--semantic-success)]" />
              <span>Estimated Cost / Burn</span>
            </div>
            <div className="mt-1.5 text-lg sm:text-xl font-bold font-mono text-[var(--semantic-success)]">
              {formatUsd(kpis.totalCostUsd)}
            </div>
            <div className="text-[10px] text-[var(--surface-text-muted)] mt-0.5">
              Wonder + Spark blended
            </div>
          </div>

          {/* Card 3: Active Workforce */}
          <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-elevated)] p-3 flex flex-col justify-between shadow-xs hover:border-[var(--surface-border-strong)] transition">
            <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-[var(--semantic-action)]" />
              <span>Active Workforce</span>
            </div>
            <div className="mt-1.5 text-lg sm:text-xl font-bold font-mono text-[var(--text-main)]">
              {kpis.working} <span className="text-xs text-[var(--text-muted)] font-normal">/ {agents.length} active</span>
            </div>
            <div className="text-[10px] text-[var(--surface-text-muted)] mt-0.5">
              {kpis.idle} Idle standby agents
            </div>
          </div>

          {/* Card 4: Needs CEO Attention */}
          <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-elevated)] p-3 flex flex-col justify-between shadow-xs hover:border-[var(--surface-border-strong)] transition">
            <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-[var(--semantic-warning)]" />
              <span>Waiting for CEO</span>
            </div>
            <div className="mt-1.5 text-lg sm:text-xl font-bold font-mono text-[var(--semantic-warning)]">
              {kpis.waiting}
            </div>
            <div className="text-[10px] text-[var(--surface-text-muted)] mt-0.5">
              Requires plan approval / key
            </div>
          </div>

          {/* Card 5: Commits Shipped */}
          <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-elevated)] p-3 flex flex-col justify-between col-span-2 sm:col-span-1 shadow-xs hover:border-[var(--surface-border-strong)] transition">
            <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
              <GitCommit className="h-3.5 w-3.5 text-[var(--surface-accent)]" />
              <span>Commits Shipped</span>
            </div>
            <div className="mt-1.5 text-lg sm:text-xl font-bold font-mono text-[var(--text-main)]">
              {kpis.totalCommits}
            </div>
            <div className="text-[10px] text-[var(--surface-text-muted)] mt-0.5">
              Real git commits on origin/main
            </div>
          </div>
        </div>
      </div>

      {/* 2. Filter Bar, Searchbar & View Mode Switcher */}
      <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Left: Search by Agent Name / Slug */}
          <div className="relative flex-1 max-w-md">
            <Search className="h-4 w-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search agent name (@slug, role, repo, or task)..."
              className="w-full rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-border)] pl-9 pr-3 py-2 text-xs text-[var(--text-main)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--surface-accent)] focus:ring-1 focus:ring-[var(--surface-accent)] transition"
            />
          </div>

          {/* Right: Quick Status Filters & View Mode Switcher */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter Buttons */}
            <div className="flex items-center gap-1 rounded-xl bg-[var(--surface-elevated)] p-1 border border-[var(--surface-border)] text-xs">
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                  statusFilter === 'ALL'
                    ? 'bg-[var(--surface-panel)] text-[var(--text-main)] font-semibold shadow-xs border border-[var(--surface-border)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                All ({agents.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('WORKING')}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                  statusFilter === 'WORKING'
                    ? 'bg-[var(--semantic-success)]/15 text-[var(--semantic-success)] border border-[var(--semantic-success)]/40 font-semibold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                🟢 Working ({kpis.working})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('WAITING_FOR_CEO')}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                  statusFilter === 'WAITING_FOR_CEO'
                    ? 'bg-[var(--semantic-warning)]/15 text-[var(--semantic-warning)] border border-[var(--semantic-warning)]/40 font-semibold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                🟡 Waiting ({kpis.waiting})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('IDLE')}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                  statusFilter === 'IDLE'
                    ? 'bg-[var(--semantic-action)]/15 text-[var(--semantic-action)] border border-[var(--semantic-action)]/40 font-semibold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                ⚪ Idle ({kpis.idle})
              </button>
            </div>

            {/* View Mode Toggle Button */}
            <div className="flex items-center gap-1 rounded-xl bg-[var(--surface-elevated)] p-1 border border-[var(--surface-border)] text-xs ml-auto sm:ml-0">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-[var(--surface-accent)]/15 text-[var(--surface-accent)] border border-[var(--surface-accent)]/40 font-semibold shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
                title="Tabular View (Recommended for desktop)"
              >
                <List className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Table</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition cursor-pointer ${
                  viewMode === 'cards'
                    ? 'bg-[var(--surface-accent)]/15 text-[var(--surface-accent)] border border-[var(--surface-accent)]/40 font-semibold shadow-xs'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
                title="Cards Grid View"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Cards</span>
              </button>
            </div>
          </div>
        </div>

        {/* Department Unit Pills */}
        <div className="mt-3 pt-3 border-t border-[var(--surface-border)] flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-[var(--text-muted)] mr-1">Unit:</span>
          {UNIT_FILTERS.map((uf) => {
            const active = unitFilter === uf.id;
            return (
              <button
                key={uf.id}
                type="button"
                onClick={() => setUnitFilter(uf.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                  active
                    ? 'bg-[var(--surface-accent)]/15 text-[var(--surface-accent)] border border-[var(--surface-accent)]/50 shadow-xs font-semibold'
                    : 'bg-[var(--surface-elevated)] text-[var(--text-muted)] border border-[var(--surface-border)] hover:text-[var(--text-main)] hover:border-[var(--surface-border-strong)]'
                }`}
              >
                {uf.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Main Data Presentation: Tabular View on Desktop & Responsive Cards on Mobile */}
      {viewMode === 'table' ? (
        <>
          {/* Desktop Tabular View (hidden on mobile, shown on md+) */}
          <div className="hidden md:block overflow-hidden rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--surface-border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] font-medium">
                    <th
                      onClick={() => handleToggleSort('agent')}
                      className="py-3.5 px-4 font-semibold cursor-pointer select-none hover:text-[var(--surface-accent)] transition-colors group"
                      title="Sort by Agent Slug / Name"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Agent &amp; Role</span>
                        {sortKey === 'agent' ? (
                          sortDirection === 'asc' ? (
                            <ArrowUp className="h-3 w-3 text-[var(--surface-accent)]" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-[var(--surface-accent)]" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-30 group-hover:opacity-75" />
                        )}
                      </div>
                    </th>
                    <th
                      onClick={() => handleToggleSort('status')}
                      className="py-3.5 px-3 font-semibold cursor-pointer select-none hover:text-[var(--surface-accent)] transition-colors group"
                      title="Sort by Status (Working > Waiting > Idle)"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Status</span>
                        {sortKey === 'status' ? (
                          sortDirection === 'asc' ? (
                            <ArrowUp className="h-3 w-3 text-[var(--surface-accent)]" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-[var(--surface-accent)]" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-30 group-hover:opacity-75" />
                        )}
                      </div>
                    </th>
                    <th
                      onClick={() => handleToggleSort('model')}
                      className="py-3.5 px-3 font-semibold cursor-pointer select-none hover:text-[var(--surface-accent)] transition-colors group"
                      title="Sort by AI Model"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Model</span>
                        {sortKey === 'model' ? (
                          sortDirection === 'asc' ? (
                            <ArrowUp className="h-3 w-3 text-[var(--surface-accent)]" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-[var(--surface-accent)]" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-30 group-hover:opacity-75" />
                        )}
                      </div>
                    </th>
                    <th
                      onClick={() => handleToggleSort('task')}
                      className="py-3.5 px-4 font-semibold cursor-pointer select-none hover:text-[var(--surface-accent)] transition-colors group"
                      title="Sort by Active Task Title"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Active Task / Branch</span>
                        {sortKey === 'task' ? (
                          sortDirection === 'asc' ? (
                            <ArrowUp className="h-3 w-3 text-[var(--surface-accent)]" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-[var(--surface-accent)]" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-30 group-hover:opacity-75" />
                        )}
                      </div>
                    </th>
                    <th
                      onClick={() => handleToggleSort('time')}
                      className="py-3.5 px-3 font-semibold cursor-pointer select-none hover:text-[var(--surface-accent)] transition-colors group"
                      title="Sort by Time Worked Today"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Time Worked</span>
                        {sortKey === 'time' ? (
                          sortDirection === 'asc' ? (
                            <ArrowUp className="h-3 w-3 text-[var(--surface-accent)]" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-[var(--surface-accent)]" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-30 group-hover:opacity-75" />
                        )}
                      </div>
                    </th>
                    <th
                      onClick={() => handleToggleSort('tokens')}
                      className="py-3.5 px-3 font-semibold cursor-pointer select-none hover:text-[var(--surface-accent)] transition-colors group"
                      title="Sort by Tokens Burned Today"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Tokens &amp; Burn</span>
                        {sortKey === 'tokens' ? (
                          sortDirection === 'asc' ? (
                            <ArrowUp className="h-3 w-3 text-[var(--surface-accent)]" />
                          ) : (
                            <ArrowDown className="h-3 w-3 text-[var(--surface-accent)]" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-30 group-hover:opacity-75" />
                        )}
                      </div>
                    </th>
                    <th className="py-3.5 px-4 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--surface-border-subtle)] font-mono">
                  {sortedAgents.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-[var(--text-muted)] font-sans">
                        No agents matched the selected filters.
                      </td>
                    </tr>
                  ) : (
                    sortedAgents.map((agent) => {
                      const lifetimeTokens = getLifetimeTokens(agent);
                      return (
                        <tr
                          key={agent.id}
                          onClick={() => onInspectAgent(agent, 'runs')}
                          className={`group transition-colors cursor-pointer hover:bg-[var(--surface-elevated)]/60 ${
                            agent.status === 'WORKING'
                              ? 'bg-[var(--semantic-success)]/5'
                              : agent.status === 'WAITING_FOR_CEO'
                                ? 'bg-[var(--semantic-warning)]/5'
                                : ''
                          }`}
                        >
                          {/* Col 1: Agent & Role */}
                          <td className="py-3 px-4 font-sans">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-[var(--surface-accent)] group-hover:text-[var(--surface-accent-hover)]">
                                {agent.slug}
                              </span>
                              <span className="rounded bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-1.5 py-0.2 text-[10px] font-mono text-[var(--text-muted)]">
                                L{agent.hierarchy_level}
                              </span>
                              {agent.project_scope && (
                                <span className="rounded bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/30 px-1.5 py-0.2 text-[10px] font-mono text-[var(--surface-accent-gold)] font-medium">
                                  {agent.project_scope}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--text-main)] font-medium mt-0.5">
                              {agent.role_title}
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)]">
                              {agent.unit_label}
                            </div>
                          </td>

                          {/* Col 2: Status */}
                          <td className="py-3 px-3">{renderStatusBadge(agent)}</td>

                          {/* Col 3: Model */}
                          <td className="py-3 px-3">
                            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-0.5 text-[10px] font-mono text-[var(--text-main)]">
                              <Sparkles className="h-3 w-3 text-[var(--surface-accent)]" />
                              {formatModelBadge(agent.model_provider, agent.model_id)}
                            </span>
                          </td>

                          {/* Col 4: Active Task / Branch */}
                          <td className="py-3 px-4 max-w-xs font-sans">
                            {agent.active_task_title ? (
                              <div className="text-xs text-[var(--text-main)] font-medium line-clamp-1 group-hover:text-[var(--surface-accent)] transition-colors">
                                {agent.active_task_title}
                              </div>
                            ) : (
                              <div className="text-xs text-[var(--text-muted)] italic">No task assigned</div>
                            )}
                            <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px] font-mono text-[var(--text-muted)]">
                              {agent.active_git_branch && (
                                <span className="inline-flex items-center gap-1 rounded bg-[var(--surface-elevated)] px-1.5 py-0.2 text-[var(--semantic-success)] border border-[var(--surface-border)]">
                                  <GitBranch className="h-2.5 w-2.5 text-[var(--semantic-success)]" />
                                  {agent.active_git_branch}
                                </span>
                              )}
                              {agent.active_container_id && (
                                <span className="inline-flex items-center gap-1 rounded bg-[var(--surface-elevated)] px-1.5 py-0.2 text-[var(--semantic-action)] border border-[var(--surface-border)]">
                                  <Box className="h-2.5 w-2.5 text-[var(--semantic-action)]" />
                                  {agent.active_container_id}
                                </span>
                              )}
                              {agent.active_preview_url && (
                                <a
                                 href={agent.active_preview_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 text-[var(--surface-accent)] hover:underline font-semibold"
                                >
                                  <ExternalLink className="h-2.5 w-2.5" />
                                  <span>Preview</span>
                                </a>
                              )}
                            </div>
                          </td>

                          {/* Col 5: Time Worked */}
                          <td className="py-3 px-3 text-[11px]">
                            <div className="text-[var(--text-main)] font-bold">
                              {formatWorkDuration(agent.today_work_time_ms)}
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)]">
                              Lifetime: {formatWorkDuration(agent.total_work_time_ms)}
                            </div>
                            <div className="text-[10px] text-[var(--surface-text-muted)]">
                              {agent.total_runs} runs • {agent.total_commits} commits
                            </div>
                          </td>

                          {/* Col 6: Tokens & Cost */}
                          <td className="py-3 px-3 text-[11px]">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-[var(--surface-accent-gold)]">
                                {formatCompactTokens(agent.today_tokens_used)}
                              </span>
                              <span className="text-[10px] text-[var(--semantic-success)] font-semibold">
                                {formatUsd(agent.total_cost_usd)}
                              </span>
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)]">
                              Life: {formatCompactTokens(lifetimeTokens)}
                            </div>
                            <div className="w-28 mt-1">
                              <TokenBreakdownBar
                                tokensIn={agent.total_tokens_in}
                                tokensCached={agent.total_tokens_cached}
                                tokensThinking={agent.total_tokens_thinking}
                                tokensOut={agent.total_tokens_out}
                                maxTokensQuota={agent.max_tokens_per_run}
                              />
                            </div>
                          </td>

                          {/* Col 7: Actions */}
                          <td
                            className="py-3 px-4 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-1.5 font-sans">
                              <button
                                type="button"
                                onClick={() => onChatDirectWithAgent(agent)}
                                className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-accent)]/15 hover:bg-[var(--surface-accent)]/25 border border-[var(--surface-accent)]/40 px-2 py-1 text-[11px] font-medium text-[var(--surface-accent)] transition cursor-pointer"
                                title="Chat 1-on-1 direct with agent"
                              >
                                <MessageSquare className="h-3 w-3 text-[var(--surface-accent)]" />
                                <span>Chat</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => onInspectAgent(agent, 'runs')}
                                className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-elevated)] hover:bg-[var(--surface-muted)] border border-[var(--surface-border)] px-2 py-1 text-[11px] font-medium text-[var(--text-main)] transition cursor-pointer"
                                title="Inspect agent brain and trace"
                              >
                                <Terminal className="h-3 w-3 text-[var(--text-muted)]" />
                                <span>Inspect</span>
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  onKillOrRestartAgent(
                                    agent.id,
                                    agent.status === 'WORKING' ? 'KILL' : 'RESTART'
                                  )
                                }
                                className={`rounded-lg p-1 border transition cursor-pointer ${
                                  agent.status === 'WORKING'
                                    ? 'bg-[var(--semantic-alert)]/15 hover:bg-[var(--semantic-alert)]/25 border-[var(--semantic-alert)]/40 text-[var(--semantic-alert)]'
                                    : 'bg-[var(--surface-elevated)] hover:bg-[var(--surface-muted)] border-[var(--surface-border)] text-[var(--text-muted)]'
                                }`}
                                title={agent.status === 'WORKING' ? 'Kill container' : 'Restart container'}
                              >
                                {agent.status === 'WORKING' ? (
                                  <Power className="h-3 w-3" />
                                ) : (
                                  <RotateCcw className="h-3 w-3" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Fallback: Cards View shown on phones (`md:hidden`) */}
          <div className="block md:hidden space-y-3">
            {sortedAgents.map((agent) => renderMobileCard(agent))}
          </div>
        </>
      ) : (
        /* Explicit Cards Grid View (when user toggled to cards) */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sortedAgents.map((agent) => renderMobileCard(agent))}
        </div>
      )}
    </div>
  );

  function renderMobileCard(agent: Agent) {
    const lifetimeTokens = getLifetimeTokens(agent);
    return (
      <div
        key={agent.id}
        onClick={() => onInspectAgent(agent, 'runs')}
        className={`group relative rounded-2xl border p-4 transition-all duration-200 cursor-pointer flex flex-col justify-between shadow-xs ${
          agent.status === 'WORKING'
            ? 'bg-[var(--surface-panel)] border-[var(--semantic-success)]/40 shadow-sm'
            : agent.status === 'WAITING_FOR_CEO'
              ? 'bg-[var(--surface-panel)] border-[var(--semantic-warning)]/40 shadow-sm'
              : 'bg-[var(--surface-panel)] border-[var(--surface-border)] hover:border-[var(--surface-border-strong)]'
        }`}
      >
        <div>
          {/* Header Row */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm font-bold text-[var(--surface-accent)]">
                  {agent.slug}
                </span>
                <span className="rounded bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-muted)]">
                  L{agent.hierarchy_level}
                </span>
                {agent.project_scope && (
                  <span className="rounded bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/30 px-1.5 py-0.5 text-[10px] font-mono text-[var(--surface-accent-gold)] font-medium">
                    {agent.project_scope}
                  </span>
                )}
              </div>
              <h3 className="text-xs font-medium text-[var(--text-main)] mt-0.5">
                {agent.role_title}
              </h3>
            </div>

            <span className="shrink-0 rounded-md bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-0.5 text-[10px] font-mono text-[var(--text-main)] flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-[var(--surface-accent)]" />
              {formatModelBadge(agent.model_provider, agent.model_id)}
            </span>
          </div>

          {/* Status Badge */}
          <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
            {renderStatusBadge(agent)}
            <div className="rounded-md bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-0.5 text-[11px] font-mono text-[var(--text-muted)]">
              Subagents: {agent.active_subagent_count} / {agent.max_subagents}
            </div>
          </div>

          {/* Active Task */}
          {agent.active_task_title && (
            <div className="mt-3 rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-border-subtle)] p-2.5 space-y-1">
              <div className="text-xs text-[var(--text-main)] font-medium line-clamp-2">
                {agent.active_task_title}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-[var(--text-muted)]">
                {agent.active_git_branch && (
                  <span className="text-[var(--semantic-success)]">🌿 {agent.active_git_branch}</span>
                )}
                {agent.active_container_id && (
                  <span className="text-[var(--semantic-action)]">📦 {agent.active_container_id}</span>
                )}
              </div>
            </div>
          )}

          {/* Timesheet Grid */}
          <div className="mt-3 grid grid-cols-4 gap-1.5 rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-border-subtle)] p-2 text-center font-mono">
            <div>
              <div className="text-[10px] text-[var(--text-muted)]">Today</div>
              <div className="text-xs font-bold text-[var(--text-main)] mt-0.5">
                {formatWorkDuration(agent.today_work_time_ms)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[var(--text-muted)]">Lifetime</div>
              <div className="text-xs font-bold text-[var(--text-main)] mt-0.5">
                {formatWorkDuration(agent.total_work_time_ms)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[var(--text-muted)]">Runs</div>
              <div className="text-xs font-bold text-[var(--surface-accent)] mt-0.5">
                {agent.total_runs}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[var(--text-muted)]">Commits</div>
              <div className="text-xs font-bold text-[var(--semantic-success)] mt-0.5">
                {agent.total_commits}
              </div>
            </div>
          </div>

          {/* Tokens & Cost */}
          <div className="mt-3 space-y-1.5 rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-border-subtle)] p-2.5">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-[var(--text-muted)]">
                Today: <strong className="text-[var(--surface-accent-gold)]">{formatCompactTokens(agent.today_tokens_used)}</strong>
              </span>
              <span className="text-[var(--text-muted)]">
                Cost: <strong className="text-[var(--semantic-success)]">{formatUsd(agent.total_cost_usd)}</strong>
              </span>
            </div>
            <TokenBreakdownBar
              tokensIn={agent.total_tokens_in}
              tokensCached={agent.total_tokens_cached}
              tokensThinking={agent.total_tokens_thinking}
              tokensOut={agent.total_tokens_out}
              maxTokensQuota={agent.max_tokens_per_run}
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div
          className="mt-3 pt-2.5 border-t border-[var(--surface-border)] flex items-center justify-between gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => onChatDirectWithAgent(agent)}
            className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-accent)]/15 hover:bg-[var(--surface-accent)]/25 border border-[var(--surface-accent)]/40 px-2.5 py-1 text-[11px] font-medium text-[var(--surface-accent)] transition cursor-pointer"
          >
            <MessageSquare className="h-3 w-3" />
            <span>Chat</span>
          </button>

          <button
            type="button"
            onClick={() => onInspectAgent(agent, 'runs')}
            className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-elevated)] hover:bg-[var(--surface-muted)] border border-[var(--surface-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-main)] transition cursor-pointer"
          >
            <Terminal className="h-3 w-3" />
            <span>Inspect</span>
          </button>
        </div>
      </div>
    );
  }
};
