import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Bot,
  CheckCheck,
  Cpu,
  FileText,
  Globe,
  Home,
  Kanban,
  LogOut,
  MessageSquare,
  Moon,
  Plus,
  RefreshCw,
  Share2,
  ShieldCheck,
  Settings,
  Sparkles,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { apiClient } from './api/client';
import { AgentInspectorDrawer } from './components/AgentInspectorDrawer';
import { AgentStudioView } from './components/AgentStudioView';
import { BacklogAndSprintView } from './components/BacklogAndSprintView';
import { ChatCenterView } from './components/ChatCenterView';
import {
  loadConsultationKnobConfig,
  saveConsultationKnobConfig,
  type ConsultationKnobConfig,
  type VerticalScope,
} from './components/ConsultationKnob';
import { HomePriorityWindow } from './components/HomePriorityWindow';
import { MarkdownRenderer } from './components/MarkdownRenderer';
import { ReportsView, type UnifiedReportItem } from './components/ReportsView';
import { TokenUsageBox } from './components/TokenUsageBox';
import type {
  Agent,
  AgentStepRouting,
  ApprovalGate,
  BacklogItem,
  BacklogStage,
  ChatThread,
  DepartmentUnit,
  InterventionCategory,
  ModelProvider,
  PermissionTier,
  PriorityLevel,
  ProjectContext,
  ProviderCredential,
  Sprint,
  SystemHealthTelemetry,
} from './types/commando';
import {
  INITIAL_AGENTS,
  INITIAL_APPROVAL_GATES,
  INITIAL_BACKLOG_ITEMS,
  INITIAL_CHAT_THREADS,
  INITIAL_HEALTH_TELEMETRY,
  INITIAL_PROJECT_CONTEXTS,
  INITIAL_PROVIDER_CREDENTIALS,
  INITIAL_SPRINT,
} from './api/seedData';
import { PRODUCT_PROJECTS } from './data/workspaceProfile';

export type PrimaryTabId = 'home' | 'agents' | 'reports' | 'backlogs';

export interface DynamicWindowTab {
  id: string;
  title: string;
  kind: 'agent' | 'report' | 'chat';
  vertical: VerticalScope;
  agentSlug?: string;
  report?: UnifiedReportItem;
}

interface AppNotificationItem {
  id: string;
  title: string;
  body: string;
  vertical: Exclude<VerticalScope, 'ALL'>;
  timeAgo: string;
  unread: boolean;
  targetTab: PrimaryTabId;
}

const INITIAL_NOTIFICATIONS: AppNotificationItem[] = [
  {
    id: 'notif-1',
    title: 'NovaPulse Checkout Sync & Edge Bundle Gate',
    body: '@tech_lead queued architecture & deployment sign-off in Priority Window.',
    vertical: 'TECH',
    timeAgo: '4m ago',
    unread: true,
    targetTab: 'home',
  },
  {
    id: 'notif-2',
    title: 'AEO Citation Share Reached 34.8% (+9.2%)',
    body: '@aeo_lead completed Perplexity & ChatGPT Search citation audit and /llms.txt draft.',
    vertical: 'SEO_AEO',
    timeAgo: '14m ago',
    unread: true,
    targetTab: 'reports',
  },
  {
    id: 'notif-3',
    title: 'AI Checkout 9:16 Hook Hit 68.4% 3s Hold',
    body: '@social_lead requests approval on 5 short-form product cuts for peak US/EU slots.',
    vertical: 'SOCIAL',
    timeAgo: '26m ago',
    unread: true,
    targetTab: 'home',
  },
  {
    id: 'notif-4',
    title: 'Bottom-Heavy Token Firewall Saved 94.2%',
    body: 'Session consumed 11.1K net payload tokens vs 192.5K raw repo baseline.',
    vertical: 'TECH',
    timeAgo: '39m ago',
    unread: true,
    targetTab: 'reports',
  },
];

export type ThemeMode = 'light' | 'dark';

export const StrictOverseerLogo: React.FC<{
  className?: string;
}> = ({ className = 'h-7 w-7' }) => {
  return (
    <div className={`relative shrink-0 flex items-center justify-center ${className}`}>
      <img
        src="/warden-logo.png"
        alt="Warden Strict Overseer Logo Reference"
        className="h-full w-full object-contain rounded-lg"
        onError={(e) => {
          (e.target as HTMLElement).style.display = 'none';
        }}
      />
    </div>
  );
};

export interface AppProps {
  /** Signed-in shell: header button signs out. Gallery: returns to the screen browser. */
  onSignOut?: () => void;
  signOutLabel?: string;
}

export const App: React.FC<AppProps> = ({ onSignOut, signOutLabel = 'Sign out' }) => {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('warden_surface_theme');
      if (saved === 'light' || saved === 'dark') {
        return saved;
      }
    }
    return 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
      root.setAttribute('data-theme', 'dark');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
    }
    localStorage.setItem('warden_surface_theme', theme);
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', theme === 'dark' ? '#0B121C' : '#F7F3E8');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      showToast(
        `Switched to ${next === 'dark' ? 'Tactical Operator (Dark)' : 'Executive Calm (Light)'} theme`
      );
      return next;
    });
  };

  const [activeTab, setActiveTab] = useState<string>('home');
  const [dynamicTabs, setDynamicTabs] = useState<DynamicWindowTab[]>([]);
  const [activeVertical, setActiveVertical] = useState<VerticalScope>('ALL');
  const [knobConfig, setKnobConfig] = useState<ConsultationKnobConfig>(() =>
    loadConsultationKnobConfig()
  );

  // Notifications popover state
  const [notifications, setNotifications] =
    useState<AppNotificationItem[]>(INITIAL_NOTIFICATIONS);
  const [notifOpen, setNotifOpen] = useState<boolean>(false);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  // Core data state
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [projectContexts, setProjectContexts] = useState<ProjectContext[]>(
    INITIAL_PROJECT_CONTEXTS
  );
  const [threads, setThreads] = useState<ChatThread[]>(INITIAL_CHAT_THREADS);
  const [gates, setGates] = useState<ApprovalGate[]>(INITIAL_APPROVAL_GATES);
  const [sprint, setSprint] = useState<Sprint>(INITIAL_SPRINT);
  const [backlogItems, setBacklogItems] = useState<BacklogItem[]>(INITIAL_BACKLOG_ITEMS);
  const [telemetry, setTelemetry] = useState<SystemHealthTelemetry>(
    INITIAL_HEALTH_TELEMETRY
  );
  const [credentials, setCredentials] = useState<ProviderCredential[]>(
    INITIAL_PROVIDER_CREDENTIALS
  );

  // Chat Center selection & Agent Inspector state
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
    INITIAL_CHAT_THREADS[0]?.id || null
  );
  const [highlightedGateId, setHighlightedGateId] = useState<string | null>(null);
  const [preferredTargetAgentSlug, setPreferredTargetAgentSlug] = useState<string | null>(
    null
  );
  const [inspectedAgent, setInspectedAgent] = useState<Agent | null>(null);
  const [inspectorSubTab, setInspectorSubTab] = useState<'runs' | 'trace' | 'config'>(
    'runs'
  );
  const [inspectorRunId, setInspectorRunId] = useState<string | null>(null);

  // Toast notification banner
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const t = window.setTimeout(() => setToastMessage(null), 4000);
    return () => window.clearTimeout(t);
  }, [toastMessage]);

  const refreshAllData = useCallback(async () => {
    const [
      loadedAgents,
      loadedContexts,
      loadedThreads,
      loadedGates,
      loadedSprint,
      loadedBacklog,
      loadedTelemetry,
      loadedCredentials,
    ] = await Promise.all([
      apiClient.getAgents(),
      apiClient.getProjectContexts(),
      apiClient.getChatThreads(),
      apiClient.getApprovalGates(),
      apiClient.getSprint(),
      apiClient.getBacklogItems(),
      apiClient.getTelemetry(),
      apiClient.getProviderCredentials(),
    ]);
    setAgents(loadedAgents);
    setProjectContexts(loadedContexts);
    setThreads(loadedThreads);
    setGates(loadedGates);
    setSprint(loadedSprint);
    setBacklogItems(loadedBacklog);
    setTelemetry(loadedTelemetry);
    setCredentials(loadedCredentials);
  }, []);

  useEffect(() => {
    void refreshAllData();
    const unsubscribe = apiClient.subscribe(() => {
      void refreshAllData();
    });
    return unsubscribe;
  }, [refreshAllData]);

  const unreadNotifCount = useMemo(
    () => notifications.filter((n) => n.unread).length,
    [notifications]
  );



  const handleOpenAgentWindowTab = (agentOrSlug: Agent | string) => {
    const slug = typeof agentOrSlug === 'string' ? agentOrSlug : agentOrSlug.slug;
    const normalizedSlug = slug.startsWith('@') ? slug : `@${slug}`;
    const tabId = `win-agent-${normalizedSlug.replace('@', '')}`;
    const existing = dynamicTabs.find((t) => t.id === tabId);
    if (!existing) {
      setDynamicTabs((prev) => [
        ...prev,
        {
          id: tabId,
          title: normalizedSlug,
          kind: 'chat',
          vertical: activeVertical,
          agentSlug: normalizedSlug,
        },
      ]);
    }
    setPreferredTargetAgentSlug(normalizedSlug);
    const matchingThread = threads.find((t) => t.target_agent_id === normalizedSlug);
    if (matchingThread) {
      setSelectedThreadId(matchingThread.id);
    }
    setActiveTab(tabId);
  };

  const handleOpenReportWindowTab = (report: UnifiedReportItem) => {
    const tabId = `win-report-${report.id}`;
    const existing = dynamicTabs.find((t) => t.id === tabId);
    if (!existing) {
      setDynamicTabs((prev) => [
        ...prev,
        {
          id: tabId,
          title: report.title.slice(0, 24) + (report.title.length > 24 ? '…' : ''),
          kind: 'report',
          vertical: report.vertical,
          report,
        },
      ]);
    }
    setActiveTab(tabId);
  };

  const handleCloseDynamicTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDynamicTabs((prev) => prev.filter((t) => t.id !== tabId));
    if (activeTab === tabId) {
      setActiveTab('home');
    }
  };

  const handleInspectAgent = (
    agent: Agent,
    initialSubTab: 'runs' | 'trace' | 'config' = 'runs',
    initialRunId: string | null = null
  ) => {
    setInspectedAgent(agent);
    setInspectorSubTab(initialSubTab);
    setInspectorRunId(initialRunId);
  };

  const handleChatDirectWithAgent = (agent: Agent) => {
    handleOpenAgentWindowTab(agent);
    showToast(`Opened direct window tab for ${agent.slug}`);
  };

  const handleKillOrRestartAgent = async (
    agentId: string,
    action: 'KILL' | 'RESTART'
  ) => {
    const updated = await apiClient.killOrRestartAgent(agentId, action);
    await refreshAllData();
    if (updated) {
      showToast(
        action === 'KILL'
          ? `Terminated container for ${updated.slug} and saved branch checkpoint.`
          : `Restarted sandboxed worker for ${updated.slug}.`
      );
    }
  };

  const handleResolveGate = async (
    gateId: string,
    decisionLabel: string,
    optionId?: string
  ) => {
    const { gate } = await apiClient.resolveApprovalGate(gateId, decisionLabel, optionId);
    await refreshAllData();
    showToast(`Resolved ${gate.gate_type}: ${decisionLabel}`);
  };

  const handleInspectRunTraceFromChat = (
    runId: string,
    agentSlugOrId: string | null
  ) => {
    const targetAgent =
      agents.find((a) => a.slug === agentSlugOrId || a.id === agentSlugOrId) || agents[0];
    if (targetAgent) {
      handleInspectAgent(targetAgent, 'trace', runId);
    }
  };

  const handleTriggerStandup = async () => {
    await apiClient.triggerStandupNow();
    await refreshAllData();
    showToast('12:00 PM IST Standup Poll triggered across Tech, SEO/AEO, and Social Media.');
  };

  const handleApproveSprint = async (ceoNotes?: string) => {
    await apiClient.approveSprint(ceoNotes);
    await refreshAllData();
    showToast('Daily Sprint approved across all active verticals!');
  };

  const handleCreateBacklogItem = async (payload: {
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
  }) => {
    const created = await apiClient.createBacklogItem(payload);
    await refreshAllData();
    showToast(`Added "${created.title}" to ${created.stage}`);
  };

  const handleMoveBacklogItem = async (
    itemId: string,
    nextStage: BacklogStage,
    reason?: string
  ) => {
    const updated = await apiClient.moveBacklogItem(itemId, nextStage, reason);
    await refreshAllData();
    if (updated) {
      showToast(`Moved "${updated.title}" → ${nextStage}`);
    }
  };

  const handleUpdateBacklogItem = async (
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
  ) => {
    const updated = await apiClient.updateBacklogItem(itemId, patch);
    await refreshAllData();
    if (updated) {
      showToast(`Updated "${updated.title}"`);
    }
  };

  const handleResolveIntervention = async (
    itemId: string,
    payload: {
      resolution_text: string;
      env_values?: Record<string, string>;
      move_to_stage?: BacklogStage;
    }
  ) => {
    const resolved = await apiClient.resolveBacklogIntervention(itemId, payload);
    await refreshAllData();
    if (resolved) {
      showToast(`Unblocked "${resolved.title}" → moved to ${resolved.stage}`);
    }
  };

  const handleRunPmTriage = async () => {
    await apiClient.runPmInboxTriage();
    await refreshAllData();
    showToast(
      `${[...PRODUCT_PROJECTS.map((p) => p.pmSlug), '@pm'].join(', ')} triaged INBOX items into P0 TODO specs!`
    );
  };

  const handleCreateAgent = async (payload: {
    slug: string;
    name: string;
    role_title: string;
    department: DepartmentUnit;
    hierarchy_level: -1 | 0 | 1 | 2;
    parent_agent_id: string | null;
    project_scope: string | null;
    model_provider: ModelProvider;
    model_id: string;
    fallback_provider?: ModelProvider;
    fallback_model_id?: string;
    step_routing?: AgentStepRouting;
    init_prompt: string;
    allowed_repos: string[];
    permission_tier: PermissionTier;
    max_subagents: number;
    max_run_duration_ms: number;
    max_tokens_per_run: number;
  }) => {
    const created = await apiClient.createAgent(payload);
    await refreshAllData();
    showToast(`Provisioned agent ${created.slug} (${created.role_title})`);
  };

  const handleAddCredential = async (payload: {
    provider: ModelProvider;
    label: string;
    api_key_raw?: string;
    api_key_value?: string;
    env_key_name?: string;
    endpoint_url?: string;
    remaining_budget_usd?: number;
    rpm_limit?: number;
    priority_order: number;
    credit_pool_label?: string;
  }) => {
    const created = await apiClient.addProviderCredential(payload);
    await refreshAllData();
    showToast(`Added ${created.provider} credential "${created.label}"`);
  };

  const handleRotateCredentialFailover = async (credentialId: string) => {
    await apiClient.rotateOrTestCredentialFailover(credentialId);
    await refreshAllData();
    showToast('Verified 429 Quota Failover: Promoted backup key in <50ms');
  };

  const handleMarkAllNotificationsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })));
  };

  const pinnedTabs: {
    id: PrimaryTabId;
    label: string;
    icon: React.FC<{ className?: string }>;
    badge?: string;
  }[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'agents', label: 'Agents', icon: Users, badge: '13' },
    { id: 'reports', label: 'Reports', icon: FileText, badge: '7' },
    { id: 'backlogs', label: 'Backlogs', icon: Kanban, badge: `${backlogItems.length + 6}` },
  ];

  const activeDynamicTab = useMemo(
    () => dynamicTabs.find((t) => t.id === activeTab) || null,
    [dynamicTabs, activeTab]
  );

  return (
    <div className="h-screen overflow-hidden bg-[#F7F3E8] dark:bg-[#0B121C] text-[#0F1622] dark:text-[#F5F0E6] flex transition-colors duration-200">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed bottom-16 md:bottom-5 right-4 z-50 max-w-md rounded-xl border border-[#C6A664]/50 bg-[#FCF9F2]/95 dark:bg-[#0F1824]/95 px-4 py-2.5 text-xs font-medium text-[#0F1622] dark:text-[#F5F0E6] shadow-2xl flex items-center gap-2.5 backdrop-blur">
          <Sparkles className="h-4 w-4 text-[#C6A664] shrink-0" />
          <span className="flex-1">{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-[#5C5343] hover:text-[#0F1622] dark:text-[#8A94A6] dark:hover:text-[#F5F0E6]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* LEFT COMMAND SIDEBAR (PC) */}
      <aside className="hidden md:flex w-64 flex-col border-r border-[#C6A664]/30 dark:border-[#C6A664]/20 bg-[#FCF9F2]/95 dark:bg-[#0F1824]/95 backdrop-blur-md z-30">
        <div className="p-4 border-b border-[#C6A664]/30 dark:border-[#C6A664]/20 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="flex items-center gap-2.5 shrink-0 group cursor-pointer text-left select-none focus:outline-none"
            title="WARDEN — Autonomous Workforce OS (Strict Overseer)"
          >
            <div className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-[#C6A664]/10 dark:bg-[#C6A664]/15 border border-[#C6A664]/30 p-0.5 shadow-xs group-hover:border-[#C6A664] transition">
              <StrictOverseerLogo className="h-6 w-6" />
            </div>
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-1.5">
                <span className="font-sans text-xs sm:text-sm font-black tracking-widest text-[#0F1622] dark:text-[#F5F0E6] group-hover:text-[#C6A664] transition-colors">
                  WARDEN
                </span>
                <span className="hidden sm:inline-block rounded px-1.5 py-0.2 text-[9px] font-mono font-bold tracking-wider uppercase bg-[#C6A664]/15 dark:bg-[#C6A664]/20 text-[#C6A664] border border-[#C6A664]/30">
                  OS
                </span>
              </div>
            </div>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Primary Navigation */}
          <nav className="space-y-1">
            {pinnedTabs.map((tab) => {
              const Icon = tab.icon;
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition cursor-pointer ${
                    isSelected
                      ? 'bg-[#EFE9D8] dark:bg-[#162030] text-[#C6A664] border border-[#C6A664]/40'
                      : 'text-[#5C5343] dark:text-[#8A94A6] hover:bg-[#EFE9D8]/50 dark:hover:bg-[#162030]/50 hover:text-[#0F1622] dark:hover:text-[#F5F0E6]'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="flex-1 text-left">{tab.label}</span>
                  {tab.badge && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-mono ${
                        isSelected
                          ? 'bg-[#C6A664]/20 text-[#C6A664]'
                          : 'bg-[#EFE9D8] dark:bg-[#162030] text-[#5C5343] dark:text-[#8A94A6]'
                      }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Controls Section */}
          <div className="space-y-3 pt-4 border-t border-[#C6A664]/30 dark:border-[#C6A664]/20">
            <span className="text-xs font-bold text-[#5C5343] dark:text-[#8A94A6] uppercase tracking-wider px-2">Wing Filter</span>
            <div className="flex flex-col gap-1">
              {(
                [
                  { id: 'ALL', label: 'All Wings', icon: null },
                  { id: 'TECH', label: 'Tech', icon: <Cpu className="h-3 w-3 text-[#C6A664]" /> },
                  {
                    id: 'SEO_AEO',
                    label: 'SEO/AEO',
                    icon: <Globe className="h-3 w-3 text-[#C6A664]" />,
                  },
                  {
                    id: 'SOCIAL',
                    label: 'Social',
                    icon: <Share2 className="h-3 w-3 text-[#C6A664]" />,
                  },
                ] as { id: VerticalScope; label: string; icon: React.ReactNode }[]
              ).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setActiveVertical(v.id)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    activeVertical === v.id
                      ? 'bg-[#FCF9F2] dark:bg-[#162030] text-[#0F1622] dark:text-[#F5F0E6] border border-[#C6A664]/40 shadow-sm'
                      : 'text-[#5C5343] dark:text-[#8A94A6] hover:bg-[#EFE9D8]/50 dark:hover:bg-[#162030]/50 hover:text-[#0F1622] dark:hover:text-[#F5F0E6]'
                  }`}
                >
                  {v.icon}
                  <span>{v.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t border-[#C6A664]/30 dark:border-[#C6A664]/20">
            <span className="text-xs font-bold text-[#5C5343] dark:text-[#8A94A6] uppercase tracking-wider px-2">Settings</span>


            <div className="flex items-center gap-2 px-2">
              <button
                type="button"
                onClick={toggleTheme}
                title="Toggle Theme"
                className="flex-1 flex justify-center rounded-xl border border-[#C6A664]/30 dark:border-[#C6A664]/20 bg-[#FCF9F2] dark:bg-[#0F1824] hover:border-[#C6A664]/60 p-2 text-[#0F1622] dark:text-[#F5F0E6] hover:text-[#C6A664] transition cursor-pointer shadow-sm"
              >
                {theme === 'dark' ? (
                  <Sun className="h-4 w-4 text-[#C6A664]" />
                ) : (
                  <Moon className="h-4 w-4 text-[#C6A664]" />
                )}
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* MOBILE TOP BAR */}
        <header className="md:hidden flex items-center justify-between p-3 border-b border-[#C6A664]/30 dark:border-[#C6A664]/20 bg-[#FCF9F2]/95 dark:bg-[#0F1824]/95 backdrop-blur-md z-30">
          <div className="flex items-center gap-2">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-[#C6A664]/10 dark:bg-[#C6A664]/15 border border-[#C6A664]/30 p-0.5">
              <StrictOverseerLogo className="h-6 w-6" />
            </div>
            <span className="font-sans text-sm font-black tracking-widest text-[#0F1622] dark:text-[#F5F0E6]">
              WARDEN
            </span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={activeVertical}
              onChange={(e) => setActiveVertical(e.target.value as VerticalScope)}
              className="rounded-xl bg-[#EFE9D8] dark:bg-[#162030] border border-[#C6A664]/30 px-2 py-1 text-xs font-semibold text-[#0F1622] dark:text-[#F5F0E6] shadow-sm"
            >
              <option value="ALL">All Wings</option>
              <option value="TECH">Tech Wing</option>
              <option value="SEO_AEO">SEO/AEO</option>
              <option value="SOCIAL">Social</option>
            </select>
            <button
              type="button"
              onClick={toggleTheme}
              className="p-1.5 rounded-lg border border-[#C6A664]/30 dark:border-[#C6A664]/20 text-[#0F1622] dark:text-[#F5F0E6]"
            >
              {theme === 'dark' ? <Sun className="h-3 w-3 text-[#C6A664]" /> : <Moon className="h-3 w-3 text-[#C6A664]" />}
            </button>
            <button
                type="button"
                onClick={() => setNotifOpen(!notifOpen)}
                className="relative p-1.5 rounded-lg border border-[#C6A664]/30 dark:border-[#C6A664]/20 text-[#0F1622] dark:text-[#F5F0E6]"
              >
                <Bell className="h-3 w-3" />
                {unreadNotifCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-3 min-w-3 items-center justify-center rounded-full bg-[#C6A664] px-0.5 text-[8px] font-mono font-bold text-[#0F1622] shadow-xs">
                    {unreadNotifCount}
                  </span>
                )}
            </button>
          </div>
        </header>

        {/* TOP HEADER BAR (PC ONLY) */}
        <header className="hidden md:flex h-14 border-b border-[#C6A664]/30 dark:border-[#C6A664]/20 bg-[#FCF9F2]/95 dark:bg-[#0F1824]/95 backdrop-blur-md z-30 px-4 items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-bold text-[#0F1622] dark:text-[#F5F0E6] capitalize">
              {activeTab === 'home' ? 'Overview' : activeTab}
            </h1>
            <div className="flex items-center gap-1 pl-4 border-l border-[#C6A664]/30 dark:border-[#C6A664]/20">
              {dynamicTabs.map((dTab) => {
                const isSelected = activeTab === dTab.id;
                return (
                  <button
                    key={dTab.id}
                    type="button"
                    onClick={() => setActiveTab(dTab.id)}
                    className={`group relative inline-flex items-center gap-1.5 rounded-t-lg px-3 py-1.5 text-xs font-mono transition border-t border-x cursor-pointer ${
                      isSelected
                        ? 'bg-[#F7F3E8] dark:bg-[#0B121C] text-[#0F1622] dark:text-[#F5F0E6] border-[#C6A664]/40'
                        : 'bg-[#EFE9D8]/50 dark:bg-[#162030]/50 text-[#5C5343] dark:text-[#8A94A6] border-transparent hover:bg-[#EFE9D8] dark:hover:bg-[#162030]'
                    }`}
                  >
                    {dTab.kind === 'chat' ? (
                      <MessageSquare className="h-3 w-3 text-[#C6A664]" />
                    ) : (
                      <FileText className="h-3 w-3 text-[#C6A664]" />
                    )}
                    <span className="max-w-[150px] truncate">{dTab.title}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => handleCloseDynamicTab(dTab.id, e)}
                      className="ml-1 rounded p-0.5 hover:bg-[#C6A664]/20"
                    >
                      <X className="h-3 w-3" />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#C6A664]/15 border border-[#C6A664]/40 px-3 py-1.5 text-xs font-semibold text-[#C6A664] hover:bg-[#C6A664]/25 transition cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
                {signOutLabel}
              </button>
            )}
            
            {/* Notification Bell */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen(!notifOpen)}
                className="relative rounded-xl border border-[#C6A664]/30 dark:border-[#C6A664]/20 bg-[#FCF9F2] dark:bg-[#162030] p-2 hover:border-[#C6A664]/60 transition cursor-pointer"
              >
                <Bell className="h-4 w-4 text-[#0F1622] dark:text-[#F5F0E6]" />
                {unreadNotifCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#C6A664] px-1 text-[9px] font-mono font-bold text-[#0F1622] shadow-xs">
                    {unreadNotifCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                  <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border border-[#C6A664]/30 dark:border-[#C6A664]/20 bg-[#FCF9F2] dark:bg-[#0F1824] p-3.5 shadow-2xl z-50 space-y-2.5">
                    <div className="flex items-center justify-between border-b border-[#C6A664]/30 dark:border-[#C6A664]/20 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#0F1622] dark:text-[#F5F0E6]">Notifications</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleMarkAllNotificationsRead}
                        className="text-[10px] font-semibold text-[#C6A664] hover:underline"
                      >
                        Mark all read
                      </button>
                    </div>
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {notifications.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => {
                            setNotifications((prev) =>
                              prev.map((item) => (item.id === n.id ? { ...item, unread: false } : item))
                            );
                            setActiveTab(n.targetTab);
                            setNotifOpen(false);
                          }}
                          className={`rounded-xl border p-2.5 cursor-pointer ${
                            n.unread
                              ? 'border-[#C6A664]/50 bg-[#C6A664]/10'
                              : 'border-[#C6A664]/20 bg-[#EFE9D8]/40 dark:bg-[#162030]'
                          }`}
                        >
                          <div className="text-[10px] font-mono text-[#5C5343] dark:text-[#8A94A6] flex justify-between">
                            <span>{n.vertical}</span>
                            <span>{n.timeAgo}</span>
                          </div>
                          <div className="text-xs font-bold text-[#0F1622] dark:text-[#F5F0E6] mt-1">{n.title}</div>
                          <p className="text-[11px] text-[#5C5343] dark:text-[#8A94A6] mt-0.5">{n.body}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* WORKSPACE */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
          <div className="max-w-7xl mx-auto h-full min-h-0">
            {activeTab === 'home' && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 h-full min-h-0">
                <HomePriorityWindow
                  activeVertical={activeVertical}
                  knobConfig={knobConfig}
                  onOpenAgentTab={(slug) => handleOpenAgentWindowTab(slug)}
                  onOpenBacklogsTab={() => setActiveTab('backlogs')}
                  onDecisionRecorded={(summary) => showToast(summary)}
                />
                <TokenUsageBox
                  tokensUsed={telemetry.total_tokens_today || 11140}
                  activeVertical={activeVertical}
                  onOpenTokenReport={() => setActiveTab('reports')}
                />
              </div>
            )}
            {activeTab === 'agents' && (
              <AgentStudioView
                agents={agents}
                projectContexts={projectContexts}
                credentials={credentials}
                activeVertical={activeVertical}
                onCreateAgent={handleCreateAgent}
                onInspectAgent={(agent, subTab) => handleInspectAgent(agent, subTab)}
                onChatDirectWithAgent={handleChatDirectWithAgent}
                onKillOrRestartAgent={handleKillOrRestartAgent}
                onOpenAgentWindowTab={(agent) => handleOpenAgentWindowTab(agent)}
                onAddCredential={handleAddCredential}
                onRotateCredentialFailover={handleRotateCredentialFailover}
              />
            )}
            {activeTab === 'reports' && (
              <ReportsView
                activeVertical={activeVertical}
                onTriggerStandupNow={handleTriggerStandup}
                onOpenBacklog={() => setActiveTab('backlogs')}
                onOpenChatWithAgent={(slug) => handleOpenAgentWindowTab(slug)}
                onOpenReportWindowTab={(report) => handleOpenReportWindowTab(report)}
              />
            )}
            {activeTab === 'backlogs' && (
              <BacklogAndSprintView
                activeVertical={activeVertical}
                sprint={sprint}
                backlogItems={backlogItems}
                agents={agents}
                onApproveSprint={handleApproveSprint}
                onRunStandupPollNow={handleTriggerStandup}
                onCreateBacklogItem={handleCreateBacklogItem}
                onMoveBacklogItem={handleMoveBacklogItem}
                onUpdateBacklogItem={handleUpdateBacklogItem}
                onResolveIntervention={handleResolveIntervention}
                onRunPmTriage={handleRunPmTriage}
              />
            )}

            {activeDynamicTab && activeDynamicTab.kind === 'chat' && (
              <div className="space-y-3 h-full flex flex-col">
                <div className="flex items-center justify-between rounded-xl border border-[#C6A664]/25 bg-[#0F1824] px-4 py-2.5">
                  <div className="flex items-center gap-2 text-[#F5F0E6]">
                    <Bot className="h-4 w-4 text-[#C6A664]" />
                    <span className="text-xs font-bold">Direct Channel: {activeDynamicTab.agentSlug}</span>
                  </div>
                  <button onClick={() => setActiveTab('agents')} className="text-xs text-[#C6A664] hover:underline cursor-pointer">Back</button>
                </div>
                <div className="flex-1 min-h-0">
                  <ChatCenterView
                    agents={agents}
                    threads={threads}
                    gates={gates}
                    selectedThreadId={selectedThreadId}
                    highlightedGateId={highlightedGateId}
                    preferredTargetAgentSlug={activeDynamicTab.agentSlug || preferredTargetAgentSlug}
                    onSelectThread={(t) => { setSelectedThreadId(t); setHighlightedGateId(null); }}
                    onThreadCreated={(n) => { setThreads(p => [n, ...p]); setSelectedThreadId(n.id); }}
                    onResolveGate={handleResolveGate}
                    onInspectRunTrace={handleInspectRunTraceFromChat}
                  />
                </div>
              </div>
            )}

            {activeDynamicTab && activeDynamicTab.kind === 'report' && activeDynamicTab.report && (
              <div className="rounded-2xl border border-[#C6A664]/25 bg-[#0F1824] p-5 space-y-4">
                <div className="flex justify-between border-b border-[#C6A664]/25 pb-3 text-[#F5F0E6]">
                  <div>
                    <h2 className="text-base font-bold">{activeDynamicTab.report.title}</h2>
                  </div>
                  <button onClick={() => setActiveTab('reports')} className="text-xs text-[#C6A664] hover:underline cursor-pointer">Back</button>
                </div>
                <div className="text-[#8A94A6]">
                  <MarkdownRenderer content={activeDynamicTab.report.markdownContent} />
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      <AgentInspectorDrawer
        agent={inspectedAgent}
        initialSubTab={inspectorSubTab}
        initialRunId={inspectorRunId}
        onClose={() => setInspectedAgent(null)}
        onAgentUpdated={(updated) => {
          setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
          setInspectedAgent(updated);
          showToast(`Saved configuration for ${updated.slug}`);
        }}
      />

      {/* MOBILE BOTTOM NAVIGATION */}
      <nav className="fixed bottom-0 inset-x-0 z-30 flex md:hidden items-center justify-around border-t border-[#C6A664]/30 dark:border-[#C6A664]/20 bg-[#FCF9F2]/95 dark:bg-[#0B121C]/95 py-2 backdrop-blur-md">
        {pinnedTabs.map((tab) => {
          const Icon = tab.icon;
          const isSelected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex flex-col items-center gap-1 px-3 py-1 text-[10px] font-semibold transition cursor-pointer ${
                isSelected ? 'text-[#C6A664]' : 'text-[#5C5343] dark:text-[#8A94A6]'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{tab.label}</span>
              {tab.badge && (
                <span className="absolute -top-1 right-1 rounded-full px-1 text-[8px] bg-[#EFE9D8] dark:bg-[#162030] text-[#0F1622] dark:text-[#F5F0E6]">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
};

export default App;
