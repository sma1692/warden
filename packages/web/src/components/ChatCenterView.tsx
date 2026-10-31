import React, { useEffect, useRef, useState } from 'react';
import {
  BellRing,
  Brain,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Terminal,
  Trash2,
  UploadCloud,
  Wrench,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { MarkdownRenderer } from './MarkdownRenderer';
import type {
  Agent,
  ApprovalGate,
  BrainStatusEvent,
  ChatMessage,
  ChatThread,
  InferenceStep,
  MediaAttachment,
} from '../types/commando';
import { formatRelativeTime } from '../utils/formatters';
import {
  EXAMPLE_THREAD_ID,
  INFRA_PROJECT,
  MEDIA_BUCKET_URI,
  PRODUCT_PROJECTS,
} from '../data/workspaceProfile';

const DIRECT_AGENT_TARGETS = [
  { slug: '@warden', label: '⚡ @warden (Default Executive Router)' },
  { slug: '@cto', label: '🎙️ @cto (Level 0 Head of Tech — Wonder)' },
  { slug: '@cmo', label: '🎙️ @cmo (Level 0 Chief Marketing Officer)' },
  { slug: '@pm', label: '🎙️ @pm (Level 1 Product, Funnel & Backlog)' },
  { slug: '@seo_aeo_head', label: '🎙️ @seo_aeo_head (Level 1 Head of SEO & AEO)' },
  { slug: '@seo_content_dev', label: '🎙️ @seo_content_dev (Level 2 llms.txt & JSON-LD Dev)' },
  { slug: '@aeo_analyst', label: '🎙️ @aeo_analyst (Level 2 AI Citation & SERP Analyst)' },
  ...PRODUCT_PROJECTS.map((p) => ({
    slug: `@tech_lead:${p.slug}`,
    label: `🎙️ @tech_lead:${p.slug} (Level 1 ${p.label} Lead)`,
  })),
  ...PRODUCT_PROJECTS.flatMap((p) => [
    { slug: `@backend_dev:${p.slug}`, label: `🎙️ @backend_dev:${p.slug} (Level 2 ${p.label} Backend)` },
    { slug: `@frontend_dev:${p.slug}`, label: `🎙️ @frontend_dev:${p.slug} (Level 2 ${p.label} Frontend)` },
  ]),
  {
    slug: '@infra_head',
    label: `🎙️ @infra_head (Level 1 Cloud & FinOps${INFRA_PROJECT ? ` — ${INFRA_PROJECT.slug}` : ''})`,
  },
  { slug: '@infra_jr', label: '🎙️ @infra_jr (Level 2 Multi-Cloud Deploy Executor)' },
];

interface ChatCenterViewProps {
  agents: Agent[];
  threads: ChatThread[];
  gates: ApprovalGate[];
  selectedThreadId: string | null;
  highlightedGateId: string | null;
  preferredTargetAgentSlug: string | null;
  onSelectThread: (threadId: string) => void;
  onThreadCreated: (thread: ChatThread) => void;
  onResolveGate: (gateId: string, decisionLabel: string, optionId?: string) => Promise<void>;
  onInspectRunTrace: (runId: string, agentSlugOrId: string | null) => void;
}

export const ChatCenterView: React.FC<ChatCenterViewProps> = ({
  threads,
  gates,
  selectedThreadId,
  highlightedGateId,
  preferredTargetAgentSlug,
  onSelectThread,
  onThreadCreated,
  onResolveGate,
  onInspectRunTrace,
}) => {
  const activeThread =
    threads.find((t) => t.id === selectedThreadId) || threads[0] || null;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [targetAgentSlug, setTargetAgentSlug] = useState<string>(
    preferredTargetAgentSlug || activeThread?.target_agent_id || '@warden'
  );
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState<MediaAttachment[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [gateCustomInput, setGateCustomInput] = useState<Record<string, string>>({});
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
  const [runStepsMap, setRunStepsMap] = useState<Record<string, InferenceStep[]>>({});
  const [liveBrainStatus, setLiveBrainStatus] = useState<BrainStatusEvent | null>(null);
  const [liveBrainHistory, setLiveBrainHistory] = useState<BrainStatusEvent[]>([]);
  const [liveSteps, setLiveSteps] = useState<InferenceStep[]>([]);

  const toggleThought = async (msgId: string, runId: string | null) => {
    const willExpand = !expandedThoughts[msgId];
    setExpandedThoughts((prev) => ({ ...prev, [msgId]: willExpand }));
    if (willExpand && runId && !runStepsMap[runId]) {
      const steps = await apiClient.getInferenceSteps(runId);
      if (steps && steps.length > 0) {
        setRunStepsMap((prev) => ({ ...prev, [runId]: steps }));
      }
    }
  };

  useEffect(() => {
    const unsubscribe = apiClient.subscribe((evt) => {
      if (evt.type === 'BRAIN_STATUS' && evt.data) {
        const status = evt.data as BrainStatusEvent;
        setLiveBrainStatus(status);
        setLiveBrainHistory((prev) => [...prev.slice(-14), status]);
      } else if (evt.type === 'STEP_CREATED' && (evt.data as { step?: InferenceStep })?.step) {
        const step = (evt.data as { step: InferenceStep }).step;
        setLiveSteps((prev) => {
          if (prev.some((s) => s.id === step.id)) return prev;
          return [...prev, step];
        });
        if (step.run_id) {
          setRunStepsMap((prev) => {
            const existing = prev[step.run_id] || [];
            if (existing.some((s) => s.id === step.id)) return prev;
            return { ...prev, [step.run_id]: [...existing, step] };
          });
        }
      }
    });
    return unsubscribe;
  }, []);

  const parseThoughtAndContent = (raw: string) => {
    const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>/i);
    if (thinkMatch) {
      const thought = thinkMatch[1].trim();
      const cleanContent = raw.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
      return { thought, cleanContent };
    }
    return { thought: null, cleanContent: raw };
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const pendingGates = gates.filter((g) => g.status === 'PENDING');

  useEffect(() => {
    if (preferredTargetAgentSlug) {
      setTargetAgentSlug(preferredTargetAgentSlug);
    } else if (activeThread?.target_agent_id) {
      setTargetAgentSlug(activeThread.target_agent_id);
    }
  }, [preferredTargetAgentSlug, activeThread?.id, activeThread?.target_agent_id]);

  useEffect(() => {
    if (!activeThread) return;
    let cancelled = false;
    apiClient.getChatMessages(activeThread.id).then(async (loaded) => {
      if (cancelled) return;
      setMessages(loaded);
      // Preload and auto-expand the latest agent message's brain trace
      const agentMsgs = loaded.filter((m) => m.sender_type === 'AGENT' && m.run_id);
      const latestAgentMsg = agentMsgs[agentMsgs.length - 1];
      if (latestAgentMsg && latestAgentMsg.run_id) {
        setExpandedThoughts((prev) => ({ ...prev, [latestAgentMsg.id]: true }));
        const steps = await apiClient.getInferenceSteps(latestAgentMsg.run_id);
        if (!cancelled && steps && steps.length > 0) {
          setRunStepsMap((prev) => ({ ...prev, [latestAgentMsg.run_id!]: steps }));
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeThread?.id, gates]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isSending, liveSteps.length, liveBrainHistory.length]);

  const handleFilesSelected = async (fileList: FileList | File[]) => {
    const filesArray = Array.from(fileList);
    const converted: MediaAttachment[] = [];

    for (const file of filesArray) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });

      converted.push({
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: file.type || 'application/octet-stream',
        filename: file.name || `clipboard-${Date.now()}.png`,
        media_uri: `${MEDIA_BUCKET_URI}/uploads/${Date.now()}-${encodeURIComponent(file.name || 'capture.png')}`,
        public_url: dataUrl,
        base64_data: dataUrl,
        size_bytes: file.size,
      });
    }

    setAttachments((prev) => [...prev, ...converted]);
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    if (!e.clipboardData?.files?.length) return;
    e.preventDefault();
    await handleFilesSelected(e.clipboardData.files);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer?.files?.length) {
      await handleFilesSelected(e.dataTransfer.files);
    }
  };

  const handleCreateNewThread = async () => {
    const titlePrompt =
      targetAgentSlug === '@warden'
        ? 'Executive Directive Session'
        : `Direct Session with ${targetAgentSlug}`;
    const created = await apiClient.createChatThread({
      title: `${titlePrompt} (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
      target_agent_id: targetAgentSlug,
      project_scope: targetAgentSlug.includes(':')
        ? targetAgentSlug.split(':')[1]
        : 'ALL',
    });
    onThreadCreated(created);
    onSelectThread(created.id);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputText.trim() && attachments.length === 0) || !activeThread || isSending) {
      return;
    }
    setIsSending(true);
    const textToSend =
      inputText.trim() ||
      `Inspect ${attachments.length} attached multimodal file(s) (${attachments.map((a) => a.filename).join(', ')})`;
    const filesToSend = [...attachments];
    setInputText('');
    setAttachments([]);

    const tempCeoId = `msg_temp_ceo_${Date.now()}`;
    const optimisticCeoMsg: ChatMessage = {
      id: tempCeoId,
      thread_id: activeThread.id,
      sender_type: 'CEO',
      sender_agent_id: null,
      recipient_agent_id: targetAgentSlug,
      content: textToSend,
      attachments_json: filesToSend,
      run_id: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticCeoMsg]);

    setLiveSteps([]);
    setLiveBrainHistory([]);
    setLiveBrainStatus({
      thread_id: activeThread.id,
      run_id: 'pending',
      agent_id: targetAgentSlug,
      agent_slug: targetAgentSlug,
      phase: 'ROUTING',
      thought: `Analyzing directive for ${targetAgentSlug} using muse-wonder-1.0...`,
      completed_step: 'CEO message received & logged',
      next_action: `Clocking in ${targetAgentSlug} and warming context + procedural memory`,
      model_used: 'meta_muse/muse-wonder-1.0',
      timestamp: new Date().toISOString(),
    });

    try {
      const { ceoMessage, agentReply } = await apiClient.sendChatMessage({
        thread_id: activeThread.id,
        target_agent_id: targetAgentSlug,
        content: textToSend,
        attachments: filesToSend,
      });

      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempCeoId),
        ceoMessage,
        agentReply,
      ]);

      if (agentReply.run_id) {
        setExpandedThoughts((prev) => ({ ...prev, [agentReply.id]: true }));
        const steps = await apiClient.getInferenceSteps(agentReply.run_id);
        if (steps && steps.length > 0) {
          setRunStepsMap((prev) => ({ ...prev, [agentReply.run_id!]: steps }));
        }
      }
    } finally {
      setIsSending(false);
      setLiveBrainStatus(null);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[calc(100vh-140px)]">
      {/* LEFT SIDEBAR: NEEDS YOUR REPLY APPROVAL GATES + THREAD HISTORY */}
      <aside className="lg:col-span-4 xl:col-span-4 flex flex-col gap-4">
        {/* Pinned `🟡 Needs Your Reply` Approval Gate Queue */}
        <div className="rounded-2xl border border-[var(--semantic-warning)]/40 bg-[var(--surface-panel)] p-3.5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--semantic-warning)] animate-ping" />
              <h3 className="text-xs sm:text-sm font-bold text-[var(--semantic-warning)] font-mono">
                🟡 Needs Your Reply ({pendingGates.length})
              </h3>
            </div>
            <span className="rounded bg-[var(--semantic-warning)]/20 border border-[var(--semantic-warning)]/40 px-2 py-0.5 text-[10px] font-mono text-[var(--semantic-warning)]">
              Telegram Deep-Link Queue
            </span>
          </div>

          {pendingGates.length === 0 ? (
            <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card)] p-3 text-xs text-[var(--semantic-success)] flex items-center gap-2 font-mono">
              <CheckCircle2 className="h-4 w-4 text-[var(--semantic-success)] shrink-0" />
              <span>All approval gates &amp; department queues are clear!</span>
            </div>
          ) : (
            <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
              {pendingGates.map((gate) => {
                const isHighlighted = highlightedGateId === gate.id;
                const isIdleBacklogPing = gate.gate_type === 'EMPTY_BACKLOG_PING';

                return (
                  <div
                    key={gate.id}
                    className={`rounded-xl border p-3 space-y-2.5 transition ${
                      isHighlighted
                        ? 'border-gold-400 bg-gold-950/30 ring-2 ring-gold-500/30'
                        : isIdleBacklogPing
                          ? 'border-[var(--surface-accent)]/50 bg-[var(--surface-card)]'
                          : 'border-[var(--semantic-warning)]/35 bg-[var(--surface-card)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold ${
                            isIdleBacklogPing
                              ? 'bg-[var(--surface-accent)]/20 text-[var(--surface-accent)] border border-[var(--surface-accent)]/40'
                              : 'bg-[var(--semantic-warning)]/20 text-[var(--semantic-warning)] border border-[var(--semantic-warning)]/40'
                          }`}
                        >
                          {gate.gate_type}
                        </span>
                        <span className="font-mono text-xs font-bold text-gold-400">
                          {gate.agent_id}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-[var(--surface-text-secondary)]">
                        {formatRelativeTime(gate.created_at)}
                      </span>
                    </div>

                    <p className="text-xs text-[var(--surface-text)] leading-relaxed">{gate.prompt_text}</p>

                    {/* 1-Tap Option Buttons (Includes 1-Tap Approve All 3 on EMPTY_BACKLOG_PING) */}
                    <div className="space-y-1.5">
                      {gate.options_json.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => onResolveGate(gate.id, opt.label, opt.id)}
                          className={`w-full text-left rounded-lg border px-2.5 py-2 text-xs transition cursor-pointer ${
                            opt.recommended
                              ? 'bg-[var(--semantic-success)]/15 hover:bg-[var(--semantic-success)]/25 border-[var(--semantic-success)]/50 text-[var(--semantic-success)] font-semibold'
                              : 'bg-[var(--surface-panel)] hover:bg-[var(--surface-muted)] border-[var(--surface-border)] text-[var(--surface-text)]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span>{opt.label}</span>
                            {opt.priority && (
                              <span className="shrink-0 rounded bg-[var(--surface-muted)] border border-[var(--surface-border)] px-1.5 py-0.5 text-[10px] font-mono text-gold-400">
                                {opt.priority}
                              </span>
                            )}
                          </div>
                          {opt.description && (
                            <p className="text-[11px] text-[var(--surface-text-secondary)] mt-0.5 font-normal">
                              {opt.description}
                            </p>
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Custom Write-In Resolution */}
                    <div className="flex gap-1.5 pt-1">
                      <input
                        type="text"
                        value={gateCustomInput[gate.id] || ''}
                        onChange={(e) =>
                          setGateCustomInput((prev) => ({
                            ...prev,
                            [gate.id]: e.target.value,
                          }))
                        }
                        placeholder="Or type custom instruction / backlog spec..."
                        className="flex-1 rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] px-2.5 py-1 text-xs text-[var(--surface-text)] placeholder:text-[var(--surface-text-secondary)]/50"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const val = (gateCustomInput[gate.id] || '').trim();
                          if (!val) return;
                          onResolveGate(gate.id, val);
                        }}
                        className="rounded-lg bg-gold-500/20 hover:bg-gold-500/30 border border-gold-500/40 px-2.5 py-1 text-xs font-semibold text-gold-200 cursor-pointer"
                      >
                        Reply
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* PostgreSQL `chat_threads` History List */}
        <div className="flex-1 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-3.5 flex flex-col gap-3 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-xs sm:text-sm font-bold text-[var(--surface-text)] flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-gold-400" />
              <span>PostgreSQL Thread History (`chat_threads`)</span>
            </h3>
            <button
              type="button"
              onClick={handleCreateNewThread}
              className="inline-flex items-center gap-1 rounded-lg bg-gold-500/15 hover:bg-gold-500/25 border border-gold-500/40 px-2.5 py-1 text-xs font-semibold text-gold-200 transition cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>+ New Thread</span>
            </button>
          </div>

          <div className="space-y-2 overflow-y-auto max-h-[420px] pr-1">
            {threads.map((thr) => {
              const isSelected = activeThread?.id === thr.id;
              return (
                <button
                  key={thr.id}
                  type="button"
                  onClick={() => onSelectThread(thr.id)}
                  className={`w-full text-left rounded-xl border p-3 transition cursor-pointer ${
                    isSelected
                      ? 'border-gold-500/60 bg-gold-950/25 shadow-xs'
                      : 'border-[var(--surface-border)] bg-[var(--surface-card)] hover:border-gold-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-[var(--surface-muted)] border border-[var(--surface-border)] px-1.5 py-0.5 text-[10px] font-mono text-gold-400">
                      {thr.target_agent_id}
                    </span>
                    <span className="text-[10px] font-mono text-[var(--surface-text-secondary)]">
                      {formatRelativeTime(thr.updated_at)}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-[var(--surface-text)] mt-1.5 line-clamp-2">
                    {thr.title}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] font-mono text-[var(--surface-text-secondary)]">
                    <span>Mode: {thr.mode}</span>
                    {thr.project_scope && <span>Scope: {thr.project_scope}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {/* MAIN MULTIMODAL CHAT CANVAS */}
      <section
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={handleDrop}
        className={`lg:col-span-8 xl:col-span-8 rounded-2xl border bg-[var(--surface-panel)] flex flex-col justify-between shadow-2xl relative overflow-hidden ${
          isDraggingOver ? 'border-gold-400 ring-2 ring-gold-500/40' : 'border-[var(--surface-border)]'
        }`}
      >
        {/* Drag-and-Drop Overlay */}
        {isDraggingOver && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[var(--surface-bg)]/90 backdrop-blur-sm text-gold-300">
            <UploadCloud className="h-12 w-12 mb-2 animate-bounce text-gold-400" />
            <p className="text-sm font-bold text-[var(--surface-text)]">
              Drop screenshots, Figma mockups, architecture diagrams, videos, or PDFs
            </p>
            <p className="text-xs text-[var(--surface-text-secondary)] mt-1">
              Uploaded to {MEDIA_BUCKET_URI} &amp; passed natively to Meta Muse
            </p>
          </div>
        )}

        {/* Chat Header: Mode & Target Agent Selector */}
        <div className="border-b border-[var(--surface-border)] bg-[var(--surface-card)] p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs sm:text-sm font-bold text-[var(--surface-text)]">
                {activeThread?.title || 'Command Center Multimodal Session'}
              </span>
              <span className="rounded bg-[var(--semantic-success)]/15 border border-[var(--semantic-success)]/30 px-2 py-0.5 text-[10px] font-mono text-[var(--semantic-success)]">
                pgvector Semantic Recall Active
              </span>
            </div>
            <p className="text-[11px] text-[var(--surface-text-secondary)] mt-0.5">
              Switch between <code className="text-gold-400">@warden</code> (upward compression) or direct 1-on-1 granular agent mode at any turn.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-[11px] font-mono text-[var(--surface-text-secondary)] hidden sm:inline">
              Target Agent:
            </label>
            <select
              value={targetAgentSlug}
              onChange={(e) => setTargetAgentSlug(e.target.value)}
              className="rounded-xl bg-[var(--surface-panel)] border border-[var(--surface-border)] px-3 py-1.5 text-xs font-mono text-gold-400 focus:outline-none focus:border-gold-500"
            >
              {DIRECT_AGENT_TARGETS.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[540px]">
          {messages.map((msg) => {
            const isCeo = msg.sender_type === 'CEO';
            const isSystem = msg.sender_type === 'SYSTEM';

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  isCeo ? 'items-end' : isSystem ? 'items-center' : 'items-start'
                }`}
              >
                <div
                  className={`max-w-2xl rounded-2xl border p-3.5 space-y-2.5 ${
                    isCeo
                      ? 'bg-gold-950/20 border-gold-500/40 text-[var(--surface-text)]'
                      : isSystem
                        ? 'bg-[var(--surface-accent)]/15 border-[var(--surface-accent)]/40 text-[var(--surface-text)] w-full'
                        : 'bg-[var(--surface-card)] border-[var(--surface-border)] text-[var(--surface-text)]'
                  }`}
                >
                  {/* Message Header */}
                  <div className="flex items-center justify-between gap-4 text-[11px] font-mono">
                    <span
                      className={`font-bold ${
                        isCeo
                          ? 'text-gold-400'
                          : isSystem
                            ? 'text-[var(--surface-accent)]'
                            : 'text-[var(--semantic-success)]'
                      }`}
                    >
                      {isCeo
                        ? `👑 CEO -> ${msg.recipient_agent_id || targetAgentSlug}`
                        : isSystem
                          ? `⚡ SYSTEM WATCHDOG (${msg.sender_agent_id || '@warden'})`
                          : `🤖 ${msg.sender_agent_id || '@warden'}`}
                    </span>
                    <span className="text-[var(--surface-text-secondary)]">{formatRelativeTime(msg.created_at)}</span>
                  </div>

                  {/* Message Content & Inline Thinking Process */}
                  {(() => {
                    const { thought, cleanContent } = parseThoughtAndContent(msg.content);
                    const steps = msg.run_id ? runStepsMap[msg.run_id] : null;
                    const hasThinking = Boolean(thought) || Boolean(msg.run_id);
                    const isExpanded = Boolean(expandedThoughts[msg.id]);
                    const totalDurationMs =
                      steps?.reduce((sum, s) => sum + (s.duration_ms || 0), 0) || 0;
                    const durationText =
                      totalDurationMs > 0 ? `${(totalDurationMs / 1000).toFixed(1)}s` : '1.8s';

                    return (
                      <div className="space-y-2">
                        {/* Inline Thinking Process Accordion */}
                        {!isCeo && hasThinking && (
                          <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card)] overflow-hidden text-xs">
                            <button
                              type="button"
                              onClick={() => toggleThought(msg.id, msg.run_id)}
                              className="w-full flex items-center justify-between px-3 py-1.5 text-[var(--surface-text-secondary)] hover:text-[var(--surface-text)] hover:bg-[var(--surface-muted)] transition cursor-pointer"
                            >
                              <div className="flex items-center gap-2">
                                <Brain className="h-3.5 w-3.5 text-gold-400" />
                                <span className="font-mono text-[11px] font-semibold text-[var(--surface-text)]">
                                  Thought for {durationText}
                                </span>
                                {steps && steps.length > 0 && (
                                  <span className="text-[10px] text-[var(--surface-text-secondary)] font-mono">
                                    ({steps.length} step{steps.length > 1 ? 's' : ''})
                                  </span>
                                )}
                              </div>
                              {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5 text-[var(--surface-text-secondary)]" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-[var(--surface-text-secondary)]" />
                              )}
                            </button>

                            {isExpanded && (
                              <div className="px-3 pb-3 pt-1 border-t border-[var(--surface-border)] bg-[var(--surface-panel)] text-[var(--surface-text)] text-[11px] space-y-2 max-h-72 overflow-y-auto">
                                {thought && (
                                  <div className="text-[var(--surface-text-secondary)] whitespace-pre-wrap leading-relaxed border-l-2 border-gold-500/40 pl-2.5 py-0.5 font-sans italic">
                                    {thought}
                                  </div>
                                )}
                                {steps && steps.length > 0 ? (
                                  <div className="space-y-1.5 pt-1">
                                    {steps.map((st, idx) => {
                                      const nextStep = steps[idx + 1];
                                      return (
                                        <div
                                          key={st.id}
                                          className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)] p-2.5 space-y-1.5 font-mono text-[10px]"
                                        >
                                          <div className="flex items-center justify-between text-[var(--surface-text-secondary)]">
                                            <div className="flex items-center gap-1.5">
                                              {st.step_type === 'TOOL_CALL' ? (
                                                <Wrench className="h-3 w-3 text-[var(--semantic-warning)]" />
                                              ) : st.step_type === 'SUBAGENT_CALL' ? (
                                                <Terminal className="h-3 w-3 text-[var(--surface-accent)]" />
                                              ) : st.step_type === 'QA_CHECK' ? (
                                                <CheckCircle2 className="h-3 w-3 text-[var(--semantic-success)]" />
                                              ) : (
                                                <Sparkles className="h-3 w-3 text-gold-400" />
                                              )}
                                              <span className="font-bold text-[var(--surface-text)]">
                                                Step {idx + 1} •{' '}
                                                {st.step_type === 'TOOL_CALL'
                                                  ? `Tool: ${st.tool_name || 'execution'}`
                                                  : st.step_type === 'SUBAGENT_CALL'
                                                    ? `Delegation: ${st.tool_name || 'subagent'}`
                                                    : st.step_type === 'QA_CHECK'
                                                      ? `QA Gate: ${st.tool_name || 'verify'}`
                                                      : `Inference: ${st.model_used || 'meta_muse/muse-wonder-1.0'}`}
                                              </span>
                                            </div>
                                            <span className="text-gold-400 font-semibold">{st.duration_ms}ms</span>
                                          </div>
                                          {st.thinking_text && (
                                            <div className="text-[var(--surface-text)] bg-[var(--surface-panel)] border-l-2 border-gold-500/50 pl-2 py-1 rounded-r">
                                              <span className="text-gold-400 font-semibold not-italic">🧠 Thought: </span>
                                              <span className="italic">{st.thinking_text}</span>
                                            </div>
                                          )}
                                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5 text-[10px]">
                                            <div className="rounded bg-[var(--semantic-success)]/10 border border-[var(--semantic-success)]/30 px-2 py-1 text-[var(--semantic-success)]">
                                              <span className="font-bold text-[var(--semantic-success)]">✓ Step Done: </span>
                                              {st.step_type === 'SUBAGENT_CALL'
                                                ? `Routed & completed ${st.tool_name}`
                                                : st.step_type === 'TOOL_CALL'
                                                  ? `Executed ${st.tool_name}`
                                                  : st.step_type === 'QA_CHECK'
                                                    ? `Verified ${st.tool_name}`
                                                    : `Synthesized reasoning (${st.tokens_out || 0} tokens)`}
                                            </div>
                                            <div className="rounded bg-[var(--surface-accent-gold)]/10 border border-[var(--surface-accent-gold)]/30 px-2 py-1 text-[var(--surface-accent-gold)]">
                                              <span className="font-bold text-[var(--surface-accent-gold)]">→ Next Action: </span>
                                              {nextStep
                                                ? nextStep.step_type === 'SUBAGENT_CALL'
                                                  ? `Delegate to ${nextStep.tool_name}`
                                                  : nextStep.step_type === 'TOOL_CALL'
                                                    ? `Run tool ${nextStep.tool_name}`
                                                    : nextStep.step_type === 'QA_CHECK'
                                                      ? `Run QA check ${nextStep.tool_name}`
                                                      : `Run ${nextStep.model_used} inference`
                                                : 'Deliver final executive response to CEO'}
                                            </div>
                                          </div>
                                          {st.tool_args_json &&
                                            Object.keys(st.tool_args_json).length > 0 && (
                                              <div className="text-[var(--surface-text-secondary)] bg-[var(--surface-panel)] p-1.5 rounded overflow-x-auto">
                                                {JSON.stringify(st.tool_args_json)}
                                              </div>
                                            )}
                                          {st.tool_output_json?.stdout && (
                                            <div className="text-[var(--semantic-success)] bg-[var(--surface-panel)] p-1.5 rounded overflow-x-auto max-h-24">
                                              {st.tool_output_json.stdout}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  !thought && (
                                    <div className="text-[var(--surface-text-secondary)] text-[10px] font-mono py-1">
                                      Loading inference reasoning and execution trace...
                                    </div>
                                  )
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Rich Markdown Renderer */}
                        <div className="text-xs sm:text-sm leading-relaxed">
                          <MarkdownRenderer content={cleanContent} />
                        </div>
                      </div>
                    );
                  })()}

                  {/* Multimodal Attachments Preview */}
                  {msg.attachments_json && msg.attachments_json.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {msg.attachments_json.map((att) => {
                        const isImage = att.type.startsWith('image/');
                        return (
                          <div
                            key={att.id}
                            className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-panel)] overflow-hidden"
                          >
                            {isImage && att.public_url ? (
                              <img
                                src={att.public_url}
                                alt={att.filename}
                                className="w-full max-h-52 object-cover"
                              />
                            ) : (
                              <div className="p-3 flex items-center gap-2 text-xs font-mono text-gold-400">
                                <FileText className="h-4 w-4 shrink-0" />
                                <span className="truncate">{att.filename}</span>
                              </div>
                            )}
                            <div className="px-2.5 py-1.5 bg-[var(--surface-card)] border-t border-[var(--surface-border)] flex items-center justify-between text-[10px] font-mono text-[var(--surface-text-secondary)]">
                              <span className="truncate">{att.filename}</span>
                              <span className="text-gold-400">Muse fileData</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Interactive Footer: `[🔍 View Run & Brain Trace]` */}
                  {msg.run_id && (
                    <div className="pt-2 border-t border-[var(--surface-border)] flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono text-[var(--surface-text-secondary)]">
                        Run ID: <code className="text-[var(--surface-text)]">{msg.run_id}</code>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onInspectRunTrace(msg.run_id!, msg.sender_agent_id || targetAgentSlug)
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-accent-gold)]/15 hover:bg-[var(--surface-accent-gold)]/25 border border-[var(--surface-accent-gold)]/40 px-2.5 py-1 text-[11px] font-mono font-semibold text-[var(--surface-accent-gold)] transition cursor-pointer"
                      >
                        <Terminal className="h-3 w-3 text-[var(--surface-accent-gold)]" />
                        <span>🔍 View Run &amp; Brain Trace</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* LIVE STREAMING MUSE TRACE WHILE AGENT IS EXECUTING */}
          {isSending && (
            <div className="flex justify-start">
              <div className="max-w-3xl w-full rounded-2xl border border-gold-500/50 bg-[var(--surface-card)] p-4 shadow-xl shadow-gold-950/20 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--surface-border)] pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-gold-500" />
                    </span>
                    <Brain className="h-4 w-4 text-gold-400 animate-pulse" />
                    <span className="text-xs font-mono font-bold text-gold-400">
                      LIVE BRAIN TRACE • {liveBrainStatus?.agent_slug || targetAgentSlug}
                    </span>
                    <span className="rounded-md bg-gold-500/15 border border-gold-500/30 px-2 py-0.5 text-[10px] font-mono text-gold-400">
                      {liveBrainStatus?.phase || 'THINKING'}
                    </span>
                  </div>
                  <span className="rounded-md bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/30 px-2 py-0.5 text-[10px] font-mono font-semibold text-[var(--surface-accent-gold)]">
                    {liveBrainStatus?.model_used || 'meta_muse/muse-wonder-1.0'}
                  </span>
                </div>

                {/* Live 3-Pillar Status: Thought / Completed Step / Next Action */}
                <div className="space-y-2 text-xs font-mono">
                  <div className="rounded-xl border border-gold-500/30 bg-[var(--surface-panel)] p-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-gold-400 font-bold mb-1">
                      🧠 What the Agent Thought
                    </div>
                    <div className="text-[var(--surface-text)] italic leading-relaxed">
                      {liveBrainStatus?.thought ||
                        `Evaluating directive and reasoning through ${targetAgentSlug} context...`}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="rounded-xl border border-[var(--semantic-success)]/30 bg-[var(--semantic-success)]/10 p-2.5">
                      <div className="text-[10px] uppercase tracking-wider text-[var(--semantic-success)] font-bold mb-1">
                        ✓ Step Just Done
                      </div>
                      <div className="text-[var(--semantic-success)] text-[11px]">
                        {liveBrainStatus?.completed_step || 'Initialized agent run & context warmup'}
                      </div>
                    </div>

                    <div className="rounded-xl border border-[var(--surface-accent-gold)]/30 bg-[var(--surface-accent-gold)]/10 p-2.5">
                      <div className="text-[10px] uppercase tracking-wider text-[var(--surface-accent-gold)] font-bold mb-1">
                        → Doing Next
                      </div>
                      <div className="text-[var(--surface-accent-gold)] text-[11px]">
                        {liveBrainStatus?.next_action || 'Streaming Muse 3.1 Pro inference...'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Live Step Stream */}
                {(liveSteps.length > 0 || liveBrainHistory.length > 1) && (
                  <div className="border-t border-[var(--surface-border)] pt-2 space-y-1.5 max-h-48 overflow-y-auto">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--surface-text-secondary)]">
                      Live Execution Steps ({liveSteps.length || liveBrainHistory.length})
                    </div>
                    {liveSteps.map((st, idx) => (
                      <div
                        key={st.id}
                        className="flex items-center justify-between rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] px-2.5 py-1.5 text-[10px] font-mono text-[var(--surface-text)]"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <CheckCircle2 className="h-3 w-3 text-[var(--semantic-success)] shrink-0" />
                          <span className="font-semibold text-gold-400">Step {idx + 1}:</span>
                          <span className="truncate">
                            {st.step_type === 'SUBAGENT_CALL'
                              ? `Delegated ${st.tool_name}`
                              : st.step_type === 'TOOL_CALL'
                                ? `Tool ${st.tool_name}`
                                : st.step_type === 'QA_CHECK'
                                  ? `QA ${st.tool_name}`
                                  : `Inference (${st.model_used})`}
                          </span>
                        </div>
                        <span className="text-[var(--surface-text-secondary)] shrink-0 ml-2">{st.duration_ms}ms</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Multimodal Composer Footer */}
        <form
          onSubmit={handleSend}
          onPaste={handlePaste}
          className="border-t border-[var(--surface-border)] bg-[var(--surface-card)] p-3.5 space-y-2.5"
        >
          {/* Staged Multimodal Attachments Bar */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pb-1">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-2 rounded-xl border border-gold-500/40 bg-[var(--surface-panel)] px-2.5 py-1.5 text-xs font-mono text-gold-400"
                >
                  {att.type.startsWith('image/') && att.public_url ? (
                    <img
                      src={att.public_url}
                      alt={att.filename}
                      className="h-7 w-7 rounded object-cover border border-[var(--surface-border)]"
                    />
                  ) : (
                    <ImageIcon className="h-4 w-4 text-gold-400" />
                  )}
                  <span className="max-w-[160px] truncate">{att.filename}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((item) => item.id !== att.id))
                    }
                    className="text-[var(--surface-text-secondary)] hover:text-[var(--semantic-alert)] cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,application/pdf"
              onChange={(e) => e.target.files && handleFilesSelected(e.target.files)}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-panel)] hover:bg-[var(--surface-muted)] p-2.5 text-[var(--surface-text-secondary)] hover:text-gold-400 transition cursor-pointer"
              title="Attach UI bug screenshot, Figma mockup, diagram, video, or PDF (or Cmd+V paste)"
            >
              <Paperclip className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-panel)] hover:bg-[var(--surface-muted)] p-2.5 text-[var(--surface-text-secondary)] hover:text-gold-400 transition cursor-pointer sm:hidden"
              title="Camera / Photo Roll"
            >
              <Camera className="h-4 w-4" />
            </button>

            <div className="flex-1">
              <textarea
                rows={2}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(e);
                  }
                }}
                placeholder={`Message ${targetAgentSlug}... (Paste screenshots with Cmd+V or drag & drop files for Meta Muse)`}
                className="w-full rounded-xl bg-[var(--surface-panel)] border border-[var(--surface-border)] px-3.5 py-2 text-xs sm:text-sm text-[var(--surface-text)] placeholder:text-[var(--surface-text-secondary)] focus:outline-none focus:border-gold-500/60 resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={isSending}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-gold-500 hover:bg-gold-400 disabled:opacity-50 px-4 py-2.5 text-xs sm:text-sm font-bold text-navy-950 transition cursor-pointer"
            >
              <Send className="h-4 w-4" />
              <span>{isSending ? 'Routing...' : 'Send'}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-[var(--surface-text-secondary)]">
            <span className="flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-gold-400" />
              Multimodal Meta Muse (`{MEDIA_BUCKET_URI}` + inline base64) • Cmd+V Clipboard Paste Supported
            </span>
            <span className="flex items-center gap-1">
              <BellRing className="h-3 w-3 text-[var(--semantic-warning)]" />
              Deep-link ready: `/?thread={activeThread?.id || EXAMPLE_THREAD_ID}`
            </span>
          </div>
        </form>
      </section>
    </div>
  );
};
