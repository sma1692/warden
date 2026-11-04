import React, { useEffect, useRef, useState } from 'react';
import {
  Brain,
  Camera,
  ChevronDown,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { apiClient } from '../api/client';
import { MarkdownRenderer } from './MarkdownRenderer';
import { AsyncButton } from './AsyncButton';
import { LlmKeyForm } from './LlmKeyForm';
import type {
  Agent,
  ApprovalGate,
  BrainStatusEvent,
  ChatMessage,
  ChatThread,
  InferenceStep,
  MediaAttachment,
} from '../types/warden';
import { formatRelativeTime } from '../utils/formatters';
import {
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
  /** One-shot composer prefill (e.g. from the home chat strip). Cleared via onDraftConsumed. */
  initialDraft?: string | null;
  onDraftConsumed?: () => void;
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
  initialDraft,
  onDraftConsumed,
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
    if (initialDraft) {
      setInputText(initialDraft);
      onDraftConsumed?.();
    }
  }, [initialDraft, onDraftConsumed]);

  useEffect(() => {
    if (!activeThread) return;
    let cancelled = false;
    apiClient.getChatMessages(activeThread.id).then(async (loaded) => {
      if (cancelled) return;
      setMessages(loaded);
      // Preload the latest agent message's brain trace (keep collapsed by default so the reply is immediately visible)
      const agentMsgs = loaded.filter((m) => m.sender_type === 'AGENT' && m.run_id);
      const latestAgentMsg = agentMsgs[agentMsgs.length - 1];
      if (latestAgentMsg && latestAgentMsg.run_id) {
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
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-145px)] min-h-[520px]">
      {/* LEFT SIDEBAR: CONVERSATIONS + COMPACT PENDING GATES */}
      <aside className="lg:col-span-3 xl:col-span-3 flex flex-col gap-3 min-h-0">
        {/* Conversations List */}
        <div className="flex-1 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-3.5 flex flex-col gap-3 shadow-xs min-h-0">
          <div className="flex items-center justify-between shrink-0">
            <h3 className="text-xs sm:text-sm font-bold text-[var(--surface-text)] flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-[var(--surface-accent-gold)]" />
              <span>Conversations</span>
            </h3>
            <AsyncButton
              type="button"
              action={handleCreateNewThread}
              spinnerClassName="h-3.5 w-3.5"
              className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-accent-gold)]/15 hover:bg-[var(--surface-accent-gold)]/25 border border-[var(--surface-accent-gold)]/40 px-2.5 py-1 text-xs font-semibold text-[var(--surface-text)] transition cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />
              <span>New</span>
            </AsyncButton>
          </div>

          <div className="space-y-2 overflow-y-auto flex-1 pr-1">
            {threads.map((thr) => {
              const isSelected = activeThread?.id === thr.id;
              return (
                <button
                  key={thr.id}
                  type="button"
                  onClick={() => onSelectThread(thr.id)}
                  className={`w-full text-left rounded-xl border p-2.5 transition cursor-pointer ${
                    isSelected
                      ? 'border-[var(--surface-accent-gold)] bg-[var(--surface-elevated)] shadow-xs'
                      : 'border-[var(--surface-border)] bg-[var(--surface-card)] hover:border-[var(--surface-accent-gold)]/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-[var(--surface-muted)] border border-[var(--surface-border)] px-1.5 py-0.5 text-[10px] font-mono font-semibold text-[var(--surface-text)]">
                      {thr.target_agent_id}
                    </span>
                    <span className="text-[10px] font-mono text-[var(--surface-text-secondary)]">
                      {formatRelativeTime(thr.updated_at)}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-[var(--surface-text)] mt-1.5 truncate">
                    {thr.title}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Only show Needs Your Reply if there is a highlighted gate or token cap gate */}
        {pendingGates.some((g) => g.id === highlightedGateId || g.gate_type === 'TOKEN_CAP_EXCEEDED') && (
          <div className="rounded-2xl border border-[var(--semantic-warning)]/40 bg-[var(--surface-panel)] p-3 shadow-xs space-y-2.5 shrink-0 max-h-[260px] overflow-y-auto">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[var(--semantic-warning)]" />
              <h3 className="text-xs font-bold text-[var(--surface-text)]">
                Action Required
              </h3>
            </div>
            {pendingGates
              .filter((g) => g.id === highlightedGateId || g.gate_type === 'TOKEN_CAP_EXCEEDED')
              .map((gate) => (
                <div
                  key={gate.id}
                  className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card)] p-2.5 space-y-2"
                >
                  <p className="text-xs text-[var(--surface-text)] leading-relaxed">{gate.prompt_text}</p>
                  {gate.gate_type === 'TOKEN_CAP_EXCEEDED' && (
                    <div className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] p-2">
                      <LlmKeyForm compact />
                    </div>
                  )}
                  <div className="space-y-1">
                    {gate.options_json.map((opt) => (
                      <AsyncButton
                        key={opt.id}
                        type="button"
                        action={() => onResolveGate(gate.id, opt.label, opt.id)}
                        className="w-full text-left rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] hover:bg-[var(--surface-muted)] px-2.5 py-1.5 text-xs font-semibold text-[var(--surface-text)] transition cursor-pointer"
                      >
                        {opt.label}
                      </AsyncButton>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </aside>

      {/* MAIN CHAT CANVAS */}
      <section
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={handleDrop}
        className={`lg:col-span-9 xl:col-span-9 rounded-2xl border bg-[var(--surface-panel)] flex flex-col justify-between shadow-sm relative overflow-hidden min-h-0 ${
          isDraggingOver ? 'border-[var(--surface-accent-gold)] ring-2 ring-[var(--surface-accent-gold)]/40' : 'border-[var(--surface-border)]'
        }`}
      >
        {/* Drag-and-Drop Overlay */}
        {isDraggingOver && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[var(--surface-bg)]/90 backdrop-blur-sm text-[var(--surface-text)]">
            <UploadCloud className="h-10 w-10 mb-2 animate-bounce text-[var(--surface-accent-gold)]" />
            <p className="text-sm font-bold text-[var(--surface-text)]">
              Drop screenshots, mockups, or files to attach
            </p>
          </div>
        )}

        {/* Chat Header */}
        <div className="border-b border-[var(--surface-border)] bg-[var(--surface-card)] px-4 py-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <span className="text-sm font-bold text-[var(--surface-text)] truncate">
            {activeThread?.title || 'Direct Channel'}
          </span>

          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--surface-text-secondary)] hidden sm:inline">
              Agent:
            </label>
            <select
              value={targetAgentSlug}
              onChange={(e) => setTargetAgentSlug(e.target.value)}
              className="rounded-xl bg-[var(--surface-panel)] border border-[var(--surface-border)] px-3 py-1.5 text-xs font-semibold text-[var(--surface-text)] focus:outline-none focus:border-[var(--surface-accent-gold)]"
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
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
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
                  className={`max-w-2xl rounded-2xl border p-3.5 space-y-2 ${
                    isCeo
                      ? 'bg-[var(--surface-elevated)] border-[var(--surface-accent-gold)]/50 text-[var(--surface-text)] shadow-xs'
                      : isSystem
                        ? 'bg-[var(--surface-accent)]/15 border-[var(--surface-accent)]/40 text-[var(--surface-text)] w-full'
                        : 'bg-[var(--surface-card)] border-[var(--surface-border)] text-[var(--surface-text)] shadow-xs'
                  }`}
                >
                  {/* Message Header */}
                  <div className="flex items-center justify-between gap-4 text-[11px] font-mono">
                    <span className="font-bold text-[var(--surface-text)]">
                      {isCeo
                        ? 'You'
                        : isSystem
                          ? `System (${msg.sender_agent_id || '@warden'})`
                          : `${msg.sender_agent_id || '@warden'}`}
                    </span>
                    <span className="text-[var(--surface-text-secondary)]">{formatRelativeTime(msg.created_at)}</span>
                  </div>

                  {/* Message Content & Compact Thinking Toggle */}
                  {(() => {
                    const { thought, cleanContent } = parseThoughtAndContent(msg.content);
                    const steps = msg.run_id ? runStepsMap[msg.run_id] : null;
                    const hasThinking = Boolean(thought) || Boolean(msg.run_id);
                    const isExpanded = Boolean(expandedThoughts[msg.id]);
                    const totalDurationMs =
                      steps?.reduce((sum, s) => sum + (s.duration_ms || 0), 0) || 0;
                    const durationText =
                      totalDurationMs > 0 ? `${(totalDurationMs / 1000).toFixed(1)}s` : '1.2s';

                    return (
                      <div className="space-y-2">
                        {/* Rich Markdown Renderer FIRST so the reply is always front and center */}
                        <div className="text-xs sm:text-sm leading-relaxed text-[var(--surface-text)]">
                          <MarkdownRenderer content={cleanContent} />
                        </div>

                        {/* Optional Subtle Reasoning Accordion below the reply */}
                        {!isCeo && hasThinking && (
                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={() => toggleThought(msg.id, msg.run_id)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] px-2.5 py-1 text-[11px] text-[var(--surface-text-secondary)] hover:text-[var(--surface-text)] transition cursor-pointer"
                            >
                              <Brain className="h-3 w-3 text-[var(--surface-accent-gold)]" />
                              <span>Thought for {durationText}</span>
                              {isExpanded ? (
                                <ChevronDown className="h-3 w-3" />
                              ) : (
                                <ChevronRight className="h-3 w-3" />
                              )}
                            </button>

                            {isExpanded && (
                              <div className="mt-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-2.5 text-[var(--surface-text-secondary)] text-[11px] space-y-1.5 max-h-48 overflow-y-auto">
                                {thought && (
                                  <div className="whitespace-pre-wrap leading-relaxed italic">
                                    {thought}
                                  </div>
                                )}
                                {steps && steps.length > 0 && (
                                  <div className="space-y-1">
                                    {steps.map((st, idx) => (
                                      <div
                                        key={st.id}
                                        className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-card)] p-2 text-[10px] font-mono text-[var(--surface-text)]"
                                      >
                                        <div className="flex items-center justify-between">
                                          <span className="font-semibold">
                                            Step {idx + 1}: {st.step_type}
                                          </span>
                                          <span className="text-[var(--surface-text-secondary)]">{st.duration_ms}ms</span>
                                        </div>
                                        {st.thinking_text && (
                                          <p className="mt-1 text-[var(--surface-text-secondary)] font-sans">
                                            {st.thinking_text}
                                          </p>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
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
                              <div className="p-3 flex items-center gap-2 text-xs font-mono text-[var(--surface-text)]">
                                <FileText className="h-4 w-4 shrink-0" />
                                <span className="truncate">{att.filename}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* COMPACT TYPING INDICATOR WHILE SENDING */}
          {isSending && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card)] px-4 py-3 shadow-xs flex items-center gap-2.5 text-xs text-[var(--surface-text)]">
                <Loader2 className="h-4 w-4 animate-spin text-[var(--surface-accent-gold)]" />
                <span className="font-semibold">{liveBrainStatus?.agent_slug || targetAgentSlug} is replying...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Clean Composer Footer */}
        <form
          onSubmit={handleSend}
          onPaste={handlePaste}
          className="border-t border-[var(--surface-border)] bg-[var(--surface-card)] p-3 space-y-2 shrink-0"
        >
          {/* Staged Attachments Bar */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pb-1">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-panel)] px-2.5 py-1.5 text-xs text-[var(--surface-text)]"
                >
                  {att.type.startsWith('image/') && att.public_url ? (
                    <img
                      src={att.public_url}
                      alt={att.filename}
                      className="h-6 w-6 rounded object-cover border border-[var(--surface-border)]"
                    />
                  ) : (
                    <ImageIcon className="h-4 w-4 text-[var(--surface-accent-gold)]" />
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

          <div className="flex items-center gap-2">
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
              className="shrink-0 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-panel)] hover:bg-[var(--surface-muted)] p-2.5 text-[var(--surface-text-secondary)] hover:text-[var(--surface-text)] transition cursor-pointer"
              title="Attach image or file"
            >
              <Paperclip className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-panel)] hover:bg-[var(--surface-muted)] p-2.5 text-[var(--surface-text-secondary)] hover:text-[var(--surface-text)] transition cursor-pointer sm:hidden"
              title="Camera / Photo Roll"
            >
              <Camera className="h-4 w-4" />
            </button>

            <div className="flex-1">
              <textarea
                rows={1}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(e);
                  }
                }}
                placeholder={`Message ${targetAgentSlug}...`}
                className="w-full rounded-xl bg-[var(--surface-panel)] border border-[var(--surface-border)] px-3.5 py-2.5 text-xs sm:text-sm text-[var(--surface-text)] placeholder:text-[var(--surface-text-secondary)] focus:outline-none focus:border-[var(--surface-accent-gold)] resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={isSending}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-[#C6A664] hover:bg-[#d4b675] disabled:opacity-50 px-4 py-2.5 text-xs sm:text-sm font-bold text-[#0A0F18] transition cursor-pointer"
            >
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              <span>{isSending ? 'Sending...' : 'Send'}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
