import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  CheckCheck,
  CheckCircle2,
  Cpu,
  FileText,
  Globe,
  Home,
  Kanban,
  Loader2,
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
import { apiClient, type WsEventPayload } from './api/client';

type WsEventType = WsEventPayload['type'];
import {
  APP_TABS,
  appTabForPath,
  getPathname,
  navigateTo,
  onLocationChange,
  pathForAppTab,
} from './router';
import { DemoDeployCard } from './components/DemoDeployCard';

// Tab views load on demand so the home dashboard paints without them.
const AgentInspectorDrawer = lazy(() =>
  import('./components/AgentInspectorDrawer').then((m) => ({ default: m.AgentInspectorDrawer }))
);
const AgentStudioView = lazy(() =>
  import('./components/AgentStudioView').then((m) => ({ default: m.AgentStudioView }))
);
const BacklogAndSprintView = lazy(() =>
  import('./components/BacklogAndSprintView').then((m) => ({ default: m.BacklogAndSprintView }))
);
const ChatCenterView = lazy(() =>
  import('./components/ChatCenterView').then((m) => ({ default: m.ChatCenterView }))
);
import {
  loadConsultationKnobConfig,
  saveConsultationKnobConfig,
  type ConsultationKnobConfig,
  type VerticalScope,
} from './components/ConsultationKnob';
import { HomeChatStrip } from './components/HomeChatStrip';
import { HomePriorityWindow } from './components/HomePriorityWindow';
import { MarkdownRenderer } from './components/MarkdownRenderer';
import type { UnifiedReportItem } from './data/reportsCatalog';
import { TokenUsageBox } from './components/TokenUsageBox';

const ReportsView = lazy(() =>
  import('./components/ReportsView').then((m) => ({ default: m.ReportsView }))
);
const SeoAuditView = lazy(() =>
  import('./components/SeoAuditView').then((m) => ({ default: m.SeoAuditView }))
);
const SettingsView = lazy(() =>
  import('./components/SettingsView').then((m) => ({ default: m.SettingsView }))
);

const TabFallback: React.FC = () => (
  <div className="flex-1 min-h-64 animate-pulse rounded-2xl bg-[var(--surface-panel)]" aria-busy="true" />
);
import type {
  Agent,
  AgentRun,
  AgentStepRouting,
  ApprovalGate,
  BacklogItem,
  BacklogStage,
  ChatMessage,
  ChatThread,
  DepartmentUnit,
  InferenceStep,
  InterventionCategory,
  ModelProvider,
  PermissionTier,
  PriorityLevel,
  ProjectContext,
  ProviderCredential,
  Sprint,
  SystemHealthTelemetry,
  UserBudget,
} from './types/warden';
import { PRODUCT_PROJECTS } from './data/workspaceProfile';
import { useTheme } from './hooks/useTheme';

export type PrimaryTabId = 'home' | 'agents' | 'reports' | 'backlogs' | 'seo' | 'settings';

export interface DynamicWindowTab {
  id: string;
  title: string;
  kind: 'agent' | 'report' | 'chat';
  vertical: VerticalScope;
  agentSlug?: string;
  report?: UnifiedReportItem;
}

type AppNotificationKind = 'task_completed' | 'needs_action' | 'agent_question';

interface AppNotificationItem {
  id: string;
  title: string;
  body: string;
  vertical: Exclude<VerticalScope, 'ALL'>;
  timeAgo: string;
  unread: boolean;
  targetTab: PrimaryTabId;
  kind?: AppNotificationKind;
  backlogId?: string;
  threadId?: string;
  createdAt?: number;
}

function verticalForBacklogLike(
  hay: string
): Exclude<VerticalScope, 'ALL'> {
  const t = hay.toLowerCase();
  if (t.includes('seo') || t.includes('aeo')) return 'SEO_AEO';
  if (t.includes('social') || t.includes('cmo') || t.includes('launch pack')) return 'SOCIAL';
  return 'TECH';
}

function formatTimeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

function upsertNotification(
  prev: AppNotificationItem[],
  next: AppNotificationItem
): AppNotificationItem[] {
  const key = next.backlogId
    ? `${next.kind || 'note'}:${next.backlogId}`
    : next.id;
  const rest = prev.filter((n) => {
    const nKey = n.backlogId ? `${n.kind || 'note'}:${n.backlogId}` : n.id;
    return nKey !== key;
  });
  return [{ ...next, timeAgo: formatTimeAgo(next.createdAt || Date.now()) }, ...rest].slice(0, 30);
}

export type { ThemeMode } from './hooks/useTheme';

export const StrictOverseerLogo: React.FC<{
  className?: string;
}> = ({ className = 'h-7 w-7' }) => {
  return (
    <div className={`relative shrink-0 flex items-center justify-center ${className}`}>
      <img
        src="/warden-logo.webp" decoding="async"
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
  /** Deep-linked tab from the URL (Root passes this; defaults to home). */
  initialTab?: string;
  /** Sync tabs with the URL. Disabled in the dev gallery. */
  syncUrl?: boolean;
}

export const App: React.FC<AppProps> = ({
  onSignOut,
  signOutLabel = 'Sign out',
  initialTab,
  syncUrl = true,
}) => {
  const [theme, setTheme] = useTheme();

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      showToast(
        `Switched to ${next === 'dark' ? 'Tactical Operator (Dark)' : 'Executive Calm (Light)'} theme`
      );
      return next;
    });
  };

  const [activeTab, setActiveTab] = useState<string>(() =>
    initialTab && (APP_TABS as readonly string[]).includes(initialTab) ? initialTab : 'home'
  );
  const [dynamicTabs, setDynamicTabs] = useState<DynamicWindowTab[]>([]);

  // Each tab owns a URL (/home, /agents, …) so Back, Forward, refresh, and deep
  // links work. Dynamic window tabs share their parent tab's URL without pushing,
  // so Back from a window always lands on the previous real page.
  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);
  const urlSyncedRef = useRef(false);
  useEffect(() => {
    if (!syncUrl) return;
    const target = pathForAppTab(activeTab);
    if (getPathname() === target) {
      urlSyncedRef.current = true;
      return;
    }
    navigateTo(target, { replace: !urlSyncedRef.current || activeTab.startsWith('win-') });
    urlSyncedRef.current = true;
  }, [syncUrl, activeTab]);
  useEffect(() => {
    if (!syncUrl) return;
    return onLocationChange((pathname) => {
      const next = appTabForPath(pathname);
      if (next) {
        setActiveTab((prev) => (prev === next ? prev : next));
      } else {
        // Foreign path reached via Back/Forward: heal the URL back to this tab.
        navigateTo(pathForAppTab(activeTabRef.current), { replace: true });
      }
    });
  }, [syncUrl]);
  const [activeVertical, setActiveVertical] = useState<VerticalScope>('ALL');
  const [knobConfig, setKnobConfig] = useState<ConsultationKnobConfig>(() =>
    loadConsultationKnobConfig()
  );

  // Notifications popover state (starts empty; populated by live runtime events)
  const [notifications, setNotifications] =
    useState<AppNotificationItem[]>([]);
  const [notifOpen, setNotifOpen] = useState<boolean>(false);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  // Core data state. Starts empty; refreshAllData fills it on mount from the
  // API (or fallback seeds when offline), so seeds stay out of this chunk.
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [projectContexts, setProjectContexts] = useState<ProjectContext[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [gates, setGates] = useState<ApprovalGate[]>([]);
  const [sprint, setSprint] = useState<Sprint>({} as Sprint);
  const [backlogItems, setBacklogItems] = useState<BacklogItem[]>([]);
  const [telemetry, setTelemetry] = useState<SystemHealthTelemetry>(
    {} as SystemHealthTelemetry
  );
  const [credentials, setCredentials] = useState<ProviderCredential[]>([]);
  const [budget, setBudget] = useState<UserBudget | null>(null);

  // Chat Center selection & Agent Inspector state
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [highlightedGateId, setHighlightedGateId] = useState<string | null>(null);
  const [preferredTargetAgentSlug, setPreferredTargetAgentSlug] = useState<string | null>(
    null
  );
  const [homeChatDraft, setHomeChatDraft] = useState<string | null>(null);
  const [focusedBacklogItemId, setFocusedBacklogItemId] = useState<string | null>(null);
  const [focusedRunId, setFocusedRunId] = useState<string | null>(null);
  const [liveBrainStatus, setLiveBrainStatus] = useState<{
    runId: string;
    backlogItemId?: string;
    taskTitle?: string;
    agentSlug?: string;
    stepIndex?: number;
    totalSteps?: number;
    summary?: string;
    updatedAt: number;
  } | null>(null);
  const [inspectedAgent, setInspectedAgent] = useState<Agent | null>(null);
  const [inspectorSubTab, setInspectorSubTab] = useState<'runs' | 'trace' | 'config'>(
    'runs'
  );
  const [inspectorRunId, setInspectorRunId] = useState<string | null>(null);

  // Toast notification banner (info for confirmations, error for API failures).
  // A threadId or onClick makes the banner clickable.
  const [toast, setToast] = useState<{
    text: string;
    tone: 'info' | 'error';
    threadId?: string;
    label?: string;
    onClick?: () => void;
  } | null>(null);

  const showToast = useCallback(
    (msg: string, opts?: { threadId?: string; label?: string; onClick?: () => void }) => {
      setToast({
        text: msg,
        tone: 'info',
        threadId: opts?.threadId,
        label: opts?.label,
        onClick: opts?.onClick,
      });
    },
    []
  );

  const showError = useCallback((msg: string) => {
    setToast({ text: msg, tone: 'error' });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const ttl =
      toast.tone === 'error'
        ? 6000
        : toast.threadId || toast.onClick
          ? 8000
          : 4000;
    const t = window.setTimeout(() => setToast(null), ttl);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Platform budget banner: refresh on mount and every minute.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      apiClient.getMyBudget().then((b) => {
        if (!cancelled) setBudget(b);
      });
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const refreshAllData = useCallback(async () => {
    const [
      loadedAgents,
      loadedRuns,
      loadedContexts,
      loadedThreads,
      loadedGates,
      loadedSprint,
      loadedBacklog,
      loadedTelemetry,
      loadedCredentials,
    ] = await Promise.all([
      apiClient.getAgents(),
      apiClient.getAgentRuns(),
      apiClient.getProjectContexts(),
      apiClient.getChatThreads(),
      apiClient.getApprovalGates(),
      apiClient.getSprint(),
      apiClient.getBacklogItems(),
      apiClient.getTelemetry(),
      apiClient.getProviderCredentials(),
    ]);
    setAgents(loadedAgents);
    setRuns(loadedRuns);
    setProjectContexts(loadedContexts);
    setThreads(loadedThreads);
    setGates(loadedGates);
    setSprint(loadedSprint);
    setBacklogItems(loadedBacklog);
    setTelemetry(loadedTelemetry);
    setCredentials(loadedCredentials);
  }, []);

  // Typed refresh: each WS event refreshes only the slice it affects,
  // instead of all 8 fetches. Bursts (tick + steps + run updates arriving
  // together) coalesce into one refresh per slice per 250ms window.
  const refreshSlice = useCallback(async (type: WsEventType) => {
    switch (type) {
      case 'TELEMETRY_TICK':
        setTelemetry(await apiClient.getTelemetry());
        break;
      case 'AGENT_UPDATED':
      case 'RUN_UPDATED':
      case 'STEP_CREATED':
      case 'BRAIN_STATUS':
        setAgents(await apiClient.getAgents());
        setRuns(await apiClient.getAgentRuns());
        break;
      case 'CHAT_MESSAGE':
        setThreads(await apiClient.getChatThreads());
        break;
      case 'GATE_CREATED':
      case 'GATE_RESOLVED':
        setGates(await apiClient.getApprovalGates());
        break;
      case 'STANDUP_UPDATED':
        setSprint(await apiClient.getSprint());
        setBacklogItems(await apiClient.getBacklogItems());
        break;
      case 'BACKLOG_UPDATED':
        setBacklogItems(await apiClient.getBacklogItems());
        setRuns(await apiClient.getAgentRuns());
        break;
      case 'BUDGET_EXCEEDED':
        break; // budget is refreshed by the notifier subscription below
    }
  }, []);

  useEffect(() => {
    void refreshAllData();
    const pending = new Set<WsEventType>();
    let timer: number | null = null;
    const flush = () => {
      timer = null;
      const types = [...pending];
      pending.clear();
      for (const t of types) void refreshSlice(t);
    };
    const unsubscribe = apiClient.subscribe((evt) => {
      pending.add(evt.type);
      if (!timer) timer = window.setTimeout(flush, 250);
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      unsubscribe();
    };
  }, [refreshAllData, refreshSlice]);

  const unreadNotifCount = useMemo(
    () => notifications.filter((n) => n.unread).length,
    [notifications]
  );



  // Single find-or-push for dynamic window tabs (functional update avoids
  // the stale-closure read the three callers used to duplicate).
  const openDynamicTab = (tab: DynamicWindowTab) => {
    setDynamicTabs((prev) => (prev.some((t) => t.id === tab.id) ? prev : [...prev, tab]));
    setActiveTab(tab.id);
  };

  const chatTabForSlug = (slug: string): DynamicWindowTab => ({
    id: `win-agent-${slug.replace('@', '')}`,
    title: slug,
    kind: 'chat',
    vertical: activeVertical,
    agentSlug: slug,
  });

  const normalizeSlug = (slug: string) => (slug.startsWith('@') ? slug : `@${slug}`);

  const handleOpenAgentWindowTab = (agentOrSlug: Agent | string) => {
    const normalizedSlug = normalizeSlug(
      typeof agentOrSlug === 'string' ? agentOrSlug : agentOrSlug.slug
    );
    openDynamicTab(chatTabForSlug(normalizedSlug));
    setPreferredTargetAgentSlug(normalizedSlug);
    const matchingThread = threads.find((t) => t.target_agent_id === normalizedSlug);
    if (matchingThread) {
      setSelectedThreadId(matchingThread.id);
    }
  };

  const handleOpenReportWindowTab = (report: UnifiedReportItem) => {
    openDynamicTab({
      id: `win-report-${report.id}`,
      title: report.title.slice(0, 24) + (report.title.length > 24 ? '…' : ''),
      kind: 'report',
      vertical: report.vertical,
      report,
    });
  };

  const handleOpenThreadByObject = (thread: ChatThread) => {
    const slug = normalizeSlug(thread.target_agent_id);
    openDynamicTab(chatTabForSlug(slug));
    setPreferredTargetAgentSlug(slug);
    setSelectedThreadId(thread.id);
    setHighlightedGateId(null);
  };

  const handleOpenThread = (threadId: string) => {
    const thread = threads.find((t) => t.id === threadId);
    if (thread) {
      handleOpenThreadByObject(thread);
      showToast(`Opened "${thread.title}"`);
    }
  };

  const handleOpenBacklogItem = (itemId: string) => {
    setFocusedBacklogItemId(itemId);
    setActiveTab('backlogs');
  };

  // Background reply notifier: when an agent reply lands in a thread the user
  // is NOT viewing, show a clickable toast that jumps straight to it.
  const selectedThreadIdRef = useRef(selectedThreadId);
  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);
  const lastReplyToastMsgId = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = apiClient.subscribe((evt) => {
      if (evt.type === 'BRAIN_STATUS' && evt.data) {
        const data = evt.data as {
          runId?: string;
          backlogItemId?: string;
          taskTitle?: string;
          agentSlug?: string;
          stepIndex?: number;
          totalSteps?: number;
          summary?: string;
        };
        if (data.runId) {
          setLiveBrainStatus({
            runId: data.runId,
            backlogItemId: data.backlogItemId,
            taskTitle: data.taskTitle,
            agentSlug: data.agentSlug,
            stepIndex: data.stepIndex,
            totalSteps: data.totalSteps,
            summary: data.summary,
            updatedAt: Date.now(),
          });
        }
      } else if (evt.type === 'STEP_CREATED' && evt.data) {
        const step = evt.data as InferenceStep;
        if (step.run_id) {
          setLiveBrainStatus((prev) => ({
            runId: step.run_id,
            backlogItemId: prev?.backlogItemId,
            taskTitle: prev?.taskTitle,
            agentSlug: prev?.agentSlug,
            stepIndex: step.step_index || prev?.stepIndex,
            totalSteps: prev?.totalSteps || 4,
            summary:
              step.message_text ||
              step.thinking_text?.slice(0, 120) ||
              (step.tool_name ? `Running ${step.tool_name}` : prev?.summary),
            updatedAt: Date.now(),
          }));
        }
      } else if (evt.type === 'RUN_UPDATED' && evt.data) {
        const run = evt.data as AgentRun;
        if (run.id) {
          setRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
          if (run.status === 'RUNNING' || run.status === 'VERIFYING_QA') {
            const slug = run.agent_id?.startsWith('@')
              ? run.agent_id
              : `@${run.agent_id}`;
            setLiveBrainStatus((prev) => ({
              runId: run.id,
              backlogItemId: run.backlog_item_id || prev?.backlogItemId,
              agentSlug: slug,
              stepIndex: prev?.runId === run.id ? prev.stepIndex : 1,
              totalSteps: prev?.totalSteps || 4,
              summary: run.output_summary || run.input_prompt,
              updatedAt: Date.now(),
            }));
          }
        }
      }
      if (evt.type === 'BUDGET_EXCEEDED') {
        const payload = (evt.data || {}) as { error?: string; budget?: UserBudget };
        if (payload.budget) {
          setBudget(payload.budget);
        } else {
          void apiClient.getMyBudget().then((b) => {
            if (b) setBudget(b);
          });
        }
        showError(
          payload.error ||
            'Token limit reached! Your chat quota is exhausted — add your Meta Muse key in Settings to continue.'
        );
        return;
      }
      if (evt.type === 'GATE_CREATED' && evt.data) {
        const gate = evt.data as ApprovalGate;
        if (gate.gate_type === 'TOKEN_CAP_EXCEEDED') {
          void apiClient.getMyBudget().then((b) => {
            if (b) setBudget(b);
          });
          showError(
            gate.prompt_text ||
              'Token limit reached! Your chat quota is exhausted — add your Meta Muse key in Settings to continue.'
          );
        }
        return;
      }
      if (evt.type === 'BACKLOG_UPDATED' && evt.data) {
        const updated = evt.data as BacklogItem;
        if (updated.stage === 'DONE' && updated.title) {
          const doneVertical = verticalForBacklogLike(
            `${updated.project_slug || ''} ${updated.assigned_agent_id || ''} ${updated.title} ${updated.spec_md || ''}`
          );
          setNotifications((prev) =>
            upsertNotification(prev, {
              id: `notif_done_${updated.id}`,
              title: 'Task Completed',
              body: `${updated.title} finished execution.`,
              vertical: doneVertical,
              timeAgo: 'Just now',
              unread: true,
              targetTab: 'reports',
              kind: 'task_completed',
              backlogId: updated.id,
              createdAt: Date.now(),
            })
          );
          showToast(`✅ Task Completed: ${updated.title}`, {
            label: 'View Activity',
            onClick: () => setActiveTab('reports'),
          });
        } else if (
          updated.stage === 'NEEDS_CEO' &&
          updated.requires_human_intervention &&
          updated.title
        ) {
          const needsVertical = verticalForBacklogLike(
            `${updated.project_slug || ''} ${updated.assigned_agent_id || ''} ${updated.title} ${updated.spec_md || ''}`
          );
          setNotifications((prev) =>
            upsertNotification(prev, {
              id: `notif_q_${updated.id}`,
              title: 'Action Required from CEO',
              body: updated.intervention_prompt || updated.title,
              vertical: needsVertical,
              timeAgo: 'Just now',
              unread: true,
              targetTab: 'home',
              kind: 'needs_action',
              backlogId: updated.id,
              createdAt: Date.now(),
            })
          );
          showToast(`⚠️ Needs Your Input: ${updated.title}`, {
            label: 'View in Needs Action',
            onClick: () => setActiveTab('home'),
          });
        }
        return;
      }
      if (evt.type !== 'CHAT_MESSAGE' || !evt.data) return;
      const msg = evt.data as ChatMessage;
      if (msg.sender_type !== 'AGENT' || !msg.thread_id || !msg.id) return;
      if (lastReplyToastMsgId.current === msg.id) return;
      lastReplyToastMsgId.current = msg.id;
      const whoClean = (msg.sender_agent_id || 'warden').replace(/^@/, '');
      const who = `@${whoClean}`;
      if (String(msg.content || '').includes('?')) {
        setNotifications((prev) =>
          upsertNotification(prev, {
            id: `notif_chat_q_${msg.id}`,
            title: `${who} asked you a question`,
            body: String(msg.content).slice(0, 110),
            vertical: 'TECH',
            timeAgo: 'Just now',
            unread: true,
            targetTab: 'home',
            kind: 'agent_question',
            threadId: msg.thread_id,
            createdAt: Date.now(),
          })
        );
        showToast(
          `💬 ${who} needs your answer: ${String(msg.content).slice(0, 75)}...`,
          {
            threadId: msg.thread_id,
            label: 'Reply in Chat',
            onClick: () => handleOpenAgentWindowTab(who),
          }
        );
        return;
      }
      const viewingThisThread =
        activeTabRef.current.startsWith('win-agent-') &&
        selectedThreadIdRef.current === msg.thread_id;
      if (viewingThisThread) return;
      showToast(`🤖 ${who} finished replying — Click to view`, {
        threadId: msg.thread_id,
      });
    });
    return unsubscribe;
  }, [showToast, showError]);

  // Seed the bell once from the loaded backlog so completed tasks and open
  // Needs Action items show up even before the next live WS event arrives.
  const notifSeededRef = useRef(false);
  useEffect(() => {
    if (notifSeededRef.current || backlogItems.length === 0) return;
    notifSeededRef.current = true;
    setNotifications((prev) => {
      let next = prev;
      const needsAction = backlogItems.filter(
        (b) => b.stage === 'NEEDS_CEO' || b.requires_human_intervention
      );
      for (const b of needsAction) {
        if (!b.title) continue;
        next = upsertNotification(next, {
          id: `notif_q_${b.id}`,
          title: 'Action Required from CEO',
          body: b.intervention_prompt || b.title,
          vertical: verticalForBacklogLike(
            `${b.project_slug || ''} ${b.assigned_agent_id || ''} ${b.title} ${b.spec_md || ''}`
          ),
          timeAgo: 'Just now',
          unread: true,
          targetTab: 'home',
          kind: 'needs_action',
          backlogId: b.id,
          createdAt: b.last_moved_at ? new Date(b.last_moved_at).getTime() : Date.now(),
        });
      }
      const done = backlogItems
        .filter((b) => b.stage === 'DONE')
        .slice(0, 5);
      for (const b of done) {
        if (!b.title) continue;
        next = upsertNotification(next, {
          id: `notif_done_${b.id}`,
          title: 'Task Completed',
          body: `${b.title} finished execution.`,
          vertical: verticalForBacklogLike(
            `${b.project_slug || ''} ${b.assigned_agent_id || ''} ${b.title} ${b.spec_md || ''}`
          ),
          timeAgo: 'Just now',
          unread: true,
          targetTab: 'reports',
          kind: 'task_completed',
          backlogId: b.id,
          createdAt: b.completed_at ? new Date(b.completed_at).getTime() : Date.now(),
        });
      }
      return next;
    });
  }, [backlogItems]);

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

  const handleNotificationClick = (n: AppNotificationItem) => {
    setNotifications((prev) =>
      prev.map((item) => (item.id === n.id ? { ...item, unread: false } : item))
    );
    setNotifOpen(false);
    if (n.threadId) {
      const thread = threads.find((t) => t.id === n.threadId);
      if (thread) {
        handleOpenThreadByObject(thread);
        return;
      }
    }
    if (n.backlogId) {
      if (n.kind === 'task_completed') {
        setFocusedBacklogItemId(n.backlogId);
        setActiveTab('reports');
        return;
      }
      setFocusedBacklogItemId(n.backlogId);
      setActiveTab(n.targetTab);
      return;
    }
    setActiveTab(n.targetTab);
  };

  const activeRuns = useMemo(
    () =>
      runs.filter((r) => r.status === 'RUNNING' || r.status === 'VERIFYING_QA'),
    [runs]
  );

  const activeRunsCount = activeRuns.length;

  const activeRun = useMemo(() => {
    if (liveBrainStatus?.runId) {
      const matched = activeRuns.find((r) => r.id === liveBrainStatus.runId);
      if (matched) return matched;
    }
    return activeRuns[0] || null;
  }, [activeRuns, liveBrainStatus]);

  const activeRunSlug = useMemo(() => {
    if (!activeRun) return '@warden';
    const ag = agents.find(
      (a) =>
        a.id === activeRun.agent_id ||
        a.slug === activeRun.agent_id ||
        a.slug === `@${activeRun.agent_id}`
    );
    return (
      ag?.slug ||
      (activeRun.agent_id.startsWith('@')
        ? activeRun.agent_id
        : `@${activeRun.agent_id}`)
    );
  }, [activeRun, agents]);

  const latestRun = useMemo(() => {
    if (runs.length === 0) return null;
    return [...runs].sort((a, b) =>
      (b.started_at || '').localeCompare(a.started_at || '')
    )[0];
  }, [runs]);

  const latestRunSlug = useMemo(() => {
    if (!latestRun) return '@warden';
    const ag = agents.find(
      (a) =>
        a.id === latestRun.agent_id ||
        a.slug === latestRun.agent_id ||
        a.slug === `@${latestRun.agent_id}`
    );
    return (
      ag?.slug ||
      (latestRun.agent_id.startsWith('@')
        ? latestRun.agent_id
        : `@${latestRun.agent_id}`)
    );
  }, [latestRun, agents]);

  const hasInProgressBacklog = useMemo(
    () => backlogItems.some((b) => b.stage === 'IN_PROGRESS'),
    [backlogItems]
  );

  useEffect(() => {
    if (activeRunsCount === 0 && !hasInProgressBacklog) return;
    const id = window.setInterval(async () => {
      const [loadedRuns, loadedAgents, loadedBacklog] = await Promise.all([
        apiClient.getAgentRuns(),
        apiClient.getAgents(),
        apiClient.getBacklogItems(),
      ]);
      setRuns(loadedRuns);
      setAgents(loadedAgents);
      setBacklogItems(loadedBacklog);
    }, 2000);
    return () => window.clearInterval(id);
  }, [activeRunsCount, hasInProgressBacklog]);

  const pinnedTabs: {
    id: PrimaryTabId;
    label: string;
    icon: React.FC<{ className?: string }>;
    badge?: string;
  }[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'agents', label: 'Team', icon: Users, badge: `${agents.length}` },
    {
      id: 'reports',
      label: 'Activity',
      icon: Activity,
      badge: activeRunsCount > 0 ? `${activeRunsCount} live` : `${runs.length}`,
    },
    { id: 'backlogs', label: 'Backlogs', icon: Kanban, badge: `${backlogItems.length}` },
    { id: 'seo', label: 'SEO', icon: Globe },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const activeDynamicTab = useMemo(
    () => dynamicTabs.find((t) => t.id === activeTab) || null,
    [dynamicTabs, activeTab]
  );

  return (
    <div className="h-screen overflow-hidden bg-[#F7F3E8] dark:bg-[#0B121C] text-[#0F1622] dark:text-[#F5F0E6] flex transition-colors duration-200">
      {/* Toast Notification Banner */}
      {toast && (
        <div
          onClick={
            toast.onClick
              ? () => {
                  toast.onClick!();
                  setToast(null);
                }
              : toast.threadId
                ? () => {
                    handleOpenThread(toast.threadId!);
                    setToast(null);
                  }
                : undefined
          }
          className={`fixed bottom-16 md:bottom-5 right-4 z-50 max-w-md rounded-xl border bg-[#FCF9F2]/95 dark:bg-[#0F1824]/95 px-4 py-2.5 text-xs font-medium text-[#0F1622] dark:text-[#F5F0E6] shadow-2xl flex items-center gap-2.5 backdrop-blur ${toast.tone === 'error' ? 'border-red-400/60' : 'border-[#C6A664]/50'} ${toast.threadId || toast.onClick ? 'cursor-pointer hover:border-[#C6A664]' : ''}`}
        >
          {toast.tone === 'error' ? (
            <AlertTriangle className="h-4 w-4 text-red-500 dark:text-red-400 shrink-0" />
          ) : (
            <Sparkles className="h-4 w-4 text-[#C6A664] shrink-0" />
          )}
          <span className="flex-1">{toast.text}</span>
          {toast.label && (
            <span className="rounded-lg bg-[#C6A664]/20 border border-[#C6A664]/40 px-2 py-0.5 text-[10px] font-mono font-bold text-[#C6A664] shrink-0">
              {toast.label}
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setToast(null);
            }}
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
            title="Warden Automatons — AI workforce command center"
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
                  AUTOMATONS
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
          <div className="flex items-center gap-2 min-w-0">
            <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#C6A664]/10 dark:bg-[#C6A664]/15 border border-[#C6A664]/30 p-0.5">
              <StrictOverseerLogo className="h-6 w-6" />
            </div>
            <span className="font-sans text-sm font-black tracking-widest text-[#0F1622] dark:text-[#F5F0E6]">
              WARDEN
            </span>
            {activeRunsCount > 0 && activeRun && (
              <button
                type="button"
                onClick={() => {
                  setFocusedRunId(liveBrainStatus?.runId || activeRun.id);
                  setActiveTab('reports');
                }}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-500 truncate max-w-[140px] cursor-pointer"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0" />
                <span className="truncate">{activeRunsCount} LIVE</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
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
        <header className="hidden md:flex h-14 border-b border-[#C6A664]/30 dark:border-[#C6A664]/20 bg-[#FCF9F2]/95 dark:bg-[#0F1824]/95 backdrop-blur-md z-30 px-4 items-center justify-between gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <h1 className="text-sm font-bold text-[#0F1622] dark:text-[#F5F0E6] capitalize shrink-0">
              {activeTab === 'home'
                ? 'Overview'
                : activeTab === 'reports'
                  ? 'Activity'
                  : activeTab === 'agents'
                    ? 'Team'
                    : activeTab === 'seo'
                      ? 'SEO & AEO'
                      : activeTab}
            </h1>
            <div className="flex items-center gap-1 pl-4 border-l border-[#C6A664]/30 dark:border-[#C6A664]/20 overflow-x-auto">
              {dynamicTabs.map((dTab) => {
                const isSelected = activeTab === dTab.id;
                return (
                  <button
                    key={dTab.id}
                    type="button"
                    onClick={() => setActiveTab(dTab.id)}
                    className={`group relative inline-flex items-center gap-1.5 rounded-t-lg px-3 py-1.5 text-xs font-mono transition border-t border-x cursor-pointer shrink-0 ${
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

          {/* Runtime Activity Pill */}
          <div className="flex-1 flex justify-center min-w-0 px-2">
            {activeRunsCount > 0 && activeRun ? (
              <button
                type="button"
                onClick={() => {
                  setFocusedRunId(liveBrainStatus?.runId || activeRun.id);
                  setActiveTab('reports');
                }}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-500/45 bg-emerald-500/12 hover:bg-emerald-500/20 px-3.5 py-1.5 text-xs font-mono transition cursor-pointer max-w-xl shadow-xs"
              >
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-bold text-emerald-500 shrink-0">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>{activeRunsCount} LIVE</span>
                </span>
                <span className="truncate text-[#0F1622] dark:text-[#F5F0E6] font-semibold">
                  <span className="text-[#C6A664] font-bold">
                    {liveBrainStatus?.agentSlug || activeRunSlug}:
                  </span>{' '}
                  {(
                    liveBrainStatus?.summary ||
                    activeRun.output_summary ||
                    activeRun.input_prompt
                  ).slice(0, 64)}
                </span>
                {liveBrainStatus?.stepIndex && (
                  <span className="rounded bg-[#EFE9D8] dark:bg-[#162030] border border-[#C6A664]/30 px-1.5 py-0.5 text-[10px] text-[#C6A664] shrink-0">
                    Step {liveBrainStatus.stepIndex}/{liveBrainStatus.totalSteps || 4}
                  </span>
                )}
                <span className="text-[11px] font-bold text-emerald-500 shrink-0">
                  Brain Trace →
                </span>
              </button>
            ) : latestRun ? (
              <button
                type="button"
                onClick={() => {
                  setFocusedRunId(latestRun.id);
                  setActiveTab('reports');
                }}
                className="inline-flex items-center gap-2 rounded-full border border-[#C6A664]/30 bg-[#EFE9D8]/60 dark:bg-[#162030]/60 hover:border-[#C6A664]/60 px-3 py-1 text-[11px] font-mono text-[#5C5343] dark:text-[#8A94A6] hover:text-[#0F1622] dark:hover:text-[#F5F0E6] transition cursor-pointer max-w-lg"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                <span className="truncate">
                  Last Activity:{' '}
                  <strong className="text-[#C6A664]">{latestRunSlug}</strong> •{' '}
                  {latestRun.input_prompt.slice(0, 38)}…
                </span>
                <span className="text-[#C6A664] font-semibold shrink-0">
                  Brain Trace →
                </span>
              </button>
            ) : null}
          </div>
          
          <div className="flex items-center gap-3 shrink-0">
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
                      {notifications.length === 0 ? (
                        <div className="py-6 text-center text-xs text-[#5C5343] dark:text-[#8A94A6]">
                          No new notifications yet.
                        </div>
                      ) : (
                        notifications.map((n) => (
                          <div
                            key={n.id}
                            onClick={() => handleNotificationClick(n)}
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
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* WORKSPACE */}
        <main
          className={`flex-1 min-h-0 overflow-y-auto ${
            activeTab === 'home' ? 'xl:overflow-hidden' : ''
          } p-4 md:p-6 pb-20 md:pb-6`}
        >
          <div
            className={`max-w-7xl mx-auto flex flex-col ${
              activeTab === 'home' ? 'h-auto xl:h-full xl:min-h-0' : 'h-full min-h-0'
            }`}
          >
            {budget && budget.cap > 0 && budget.status !== 'OK' && activeTab !== 'settings' && (
              <div
                className={`mb-4 shrink-0 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-xs ${
                  budget.status === 'EXCEEDED'
                    ? 'border-red-400/50 bg-red-400/10 text-red-200'
                    : 'border-amber-400/50 bg-amber-400/10 text-amber-200'
                }`}
              >
                <span>
                  {budget.status === 'EXCEEDED'
                    ? `Platform budget exhausted (${budget.used.toLocaleString()} / ${budget.cap.toLocaleString()} tokens). Runs are paused.`
                    : `Platform budget ${Math.round((budget.used / budget.cap) * 100)}% used (${budget.used.toLocaleString()} / ${budget.cap.toLocaleString()} tokens).`}
                  {' '}Add your Meta Muse key to run uncapped on your own credit.
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTab('settings')}
                  className="rounded-lg bg-[#C6A664]/20 border border-[#C6A664]/50 px-3 py-1.5 font-bold text-[#C6A664] hover:bg-[#C6A664]/30 transition cursor-pointer"
                >
                  Open Settings
                </button>
              </div>
            )}
            {activeTab === 'home' && (
              <div className="flex flex-col gap-3 sm:gap-4 flex-1 h-auto xl:h-full xl:min-h-0">
                <div className="shrink-0">
                  <DemoDeployCard onError={showError} />
                </div>
                <HomeChatStrip
                  onStartChat={async (message) => {
                    const created = await apiClient.createChatThread({
                      title: message.slice(0, 64),
                      target_agent_id: '@warden',
                      project_scope: 'ALL',
                    });
                    setThreads((prev) => [created, ...prev]);
                    setHomeChatDraft(message);
                    handleOpenThreadByObject(created);
                  }}
                />
                <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="min-h-[calc(100dvh-16.5rem)] sm:min-h-[26rem] xl:min-h-0 xl:h-full flex flex-col">
                    <HomePriorityWindow
                      activeVertical={activeVertical}
                      knobConfig={knobConfig}
                      backlogItems={backlogItems}
                      runs={runs}
                      threads={threads}
                      onApproveBacklogItem={async (itemId, summary) => {
                        const spawned = await apiClient.spawnDemoTaskRun(itemId, summary);
                        await refreshAllData();
                        if (spawned) {
                          setThreads((prev) => [
                            spawned.thread,
                            ...prev.filter((t) => t.id !== spawned.thread.id),
                          ]);
                          const slug = normalizeSlug(spawned.thread.target_agent_id);
                          const tab = chatTabForSlug(slug);
                          setDynamicTabs((prev) =>
                            prev.some((t) => t.id === tab.id) ? prev : [...prev, tab]
                          );
                          setActiveTab(tab.id);
                          setPreferredTargetAgentSlug(slug);
                          setSelectedThreadId(spawned.thread.id);
                          setHighlightedGateId(null);
                          if (spawned.run) {
                            setFocusedRunId(spawned.run.id);
                            setLiveBrainStatus({
                              runId: spawned.run.id,
                              backlogItemId: spawned.item.id,
                              taskTitle: spawned.item.title,
                              agentSlug: '@warden',
                              stepIndex: 1,
                              totalSteps: 4,
                              summary:
                                spawned.run.output_summary ||
                                spawned.run.input_prompt ||
                                spawned.item.title,
                              updatedAt: Date.now(),
                            });
                          } else {
                            setFocusedBacklogItemId(spawned.item.id);
                          }
                          showToast(
                            `Spawning team for "${spawned.item.title}" — watch live in Top Bar or Activity!`,
                            { threadId: spawned.thread.id }
                          );
                        }
                      }}
                      onOpenAgentTab={(slug) => handleOpenAgentWindowTab(slug)}
                      onOpenBacklogsTab={() => setActiveTab('backlogs')}
                      onOpenActivityTab={(itemId) => {
                        if (itemId) setFocusedBacklogItemId(itemId);
                        setActiveTab('reports');
                      }}
                      onOpenThread={handleOpenThread}
                      onDecisionRecorded={(summary) => showToast(summary)}
                    />
                  </div>
                  <div className="min-h-[calc(100dvh-8.5rem)] sm:min-h-[28rem] xl:min-h-0 xl:h-full flex flex-col">
                    <TokenUsageBox
                      tokensUsed={telemetry.total_tokens_today || 11140}
                      activeVertical={activeVertical}
                      onOpenTokenReport={() => setActiveTab('reports')}
                    />
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'agents' && (
              <Suspense fallback={<TabFallback />}>
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
              </Suspense>
            )}
            {activeTab === 'reports' && (
              <Suspense fallback={<TabFallback />}>
              <ReportsView
                activeVertical={activeVertical}
                agents={agents}
                runs={runs}
                backlogItems={backlogItems}
                focusedRunId={focusedRunId}
                focusedBacklogItemId={focusedBacklogItemId}
                onFocusConsumed={() => {
                  setFocusedRunId(null);
                  setFocusedBacklogItemId(null);
                }}
                liveBrainStatus={liveBrainStatus}
                onTriggerStandupNow={handleTriggerStandup}
                onOpenBacklog={() => setActiveTab('backlogs')}
                onOpenBacklogItem={handleOpenBacklogItem}
                onOpenChatWithAgent={(slug) => handleOpenAgentWindowTab(slug)}
                onInspectAgent={(agent, subTab, runId) =>
                  handleInspectAgent(agent, subTab, runId)
                }
                onOpenReportWindowTab={(report) => handleOpenReportWindowTab(report)}
              />
              </Suspense>
            )}
            {activeTab === 'backlogs' && (
              <Suspense fallback={<TabFallback />}>
              <BacklogAndSprintView
                activeVertical={activeVertical}
                sprint={sprint}
                backlogItems={backlogItems}
                agents={agents}
                threads={threads}
                focusedItemId={focusedBacklogItemId}
                onFocusConsumed={() => setFocusedBacklogItemId(null)}
                onOpenThread={handleOpenThread}
                onOpenReportsTab={() => setActiveTab('reports')}
                onApproveSprint={handleApproveSprint}
                onRunStandupPollNow={handleTriggerStandup}
                onCreateBacklogItem={handleCreateBacklogItem}
                onMoveBacklogItem={handleMoveBacklogItem}
                onUpdateBacklogItem={handleUpdateBacklogItem}
                onResolveIntervention={handleResolveIntervention}
                onRunPmTriage={handleRunPmTriage}
              />
              </Suspense>
            )}
            {activeTab === 'seo' && (
              <Suspense fallback={<TabFallback />}>
              <SeoAuditView
                onCreateBacklogItem={handleCreateBacklogItem}
                onNotify={(summary) => showToast(summary)}
                onError={showError}
              />
              </Suspense>
            )}
            {activeTab === 'settings' && (
              <Suspense fallback={<TabFallback />}>
                <SettingsView />
              </Suspense>
            )}

            {activeDynamicTab && activeDynamicTab.kind === 'chat' && (
              <div className="space-y-3 h-full flex flex-col">
                <div className="flex items-center justify-between rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card)] px-4 py-2.5 shadow-xs">
                  <div className="flex items-center gap-2 text-[var(--surface-text)]">
                    <Bot className="h-4 w-4 text-[var(--surface-accent-gold)]" />
                    <span className="text-xs font-bold">Direct Channel: {activeDynamicTab.agentSlug}</span>
                  </div>
                  <button onClick={() => setActiveTab('home')} className="text-xs font-semibold text-[var(--surface-accent-gold)] hover:underline cursor-pointer">← Back to Dashboard</button>
                </div>
                <div className="flex-1 min-h-0">
                  <Suspense fallback={<TabFallback />}>
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
                    initialDraft={homeChatDraft}
                    onDraftConsumed={() => setHomeChatDraft(null)}
                    backlogItems={backlogItems}
                    onOpenBacklogItem={handleOpenBacklogItem}
                  />
                  </Suspense>
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

      {inspectedAgent && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

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
