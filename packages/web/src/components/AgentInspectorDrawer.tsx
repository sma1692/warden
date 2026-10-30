import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Database,
  ExternalLink,
  Flame,
  GitBranch,
  Pin,
  Plus,
  Save,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import { apiClient } from '../api/client';
import {
  PROVIDER_MODELS,
  type Agent,
  type AgentMemory,
  type AgentRun,
  type InferenceStep,
  type MemoryType,
  type ModelProvider,
  type PermissionTier,
} from '../types/commando';
import {
  formatCompactTokens,
  formatRelativeTime,
  formatStopwatch,
  formatUsd,
} from '../utils/formatters';
import { TokenBreakdownBar } from './TokenBreakdownBar';

interface AgentInspectorDrawerProps {
  agent: Agent | null;
  initialSubTab?: 'runs' | 'trace' | 'config';
  initialRunId?: string | null;
  onClose: () => void;
  onAgentUpdated: (updated: Agent) => void;
}

export const AgentInspectorDrawer: React.FC<AgentInspectorDrawerProps> = ({
  agent,
  initialSubTab = 'runs',
  initialRunId = null,
  onClose,
  onAgentUpdated,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'runs' | 'trace' | 'config'>(initialSubTab);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRunId);
  const [steps, setSteps] = useState<InferenceStep[]>([]);
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
  const [memories, setMemories] = useState<AgentMemory[]>([]);

  // Brain config editor state
  const [initPrompt, setInitPrompt] = useState('');
  const [modelProvider, setModelProvider] = useState<ModelProvider>('vertex');
  const [modelId, setModelId] = useState('');
  const [fallbackProvider, setFallbackProvider] = useState<ModelProvider>('meta_muse');
  const [fallbackModelId, setFallbackModelId] = useState('muse-spark-1.3');
  const [planningModel, setPlanningModel] = useState('vertex:gemini-2.5-pro');
  const [toolLoopModel, setToolLoopModel] = useState('vertex:gemini-2.0-flash');
  const [compactionModel, setCompactionModel] = useState('ollama:qwen2.5-coder:32b');
  const [permissionTier, setPermissionTier] = useState<PermissionTier>('full_overdrive');
  const [maxSubagents, setMaxSubagents] = useState(4);
  const [maxRunDurationHours, setMaxRunDurationHours] = useState(24);
  const [maxTokensPerRun, setMaxTokensPerRun] = useState(1_000_000);
  const [configSavedBanner, setConfigSavedBanner] = useState(false);

  // New memory form state
  const [newMemType, setNewMemType] = useState<MemoryType>('PINNED_PREFERENCE');
  const [newMemContent, setNewMemContent] = useState('');
  const [newMemPinned, setNewMemPinned] = useState(true);

  useEffect(() => {
    setActiveSubTab(initialSubTab);
  }, [initialSubTab]);

  useEffect(() => {
    if (!agent) return;
    setInitPrompt(agent.init_prompt);
    setModelProvider(agent.model_provider);
    setModelId(agent.model_id);
    setFallbackProvider(agent.fallback_provider || 'meta_muse');
    setFallbackModelId(agent.fallback_model_id || 'muse-spark-1.3');
    setPlanningModel(
      agent.step_routing?.planning_model || `${agent.model_provider}:${agent.model_id}`
    );
    setToolLoopModel(
      agent.step_routing?.tool_loop_model ||
        (agent.model_provider === 'meta_muse'
          ? 'meta_muse:muse-spark-1.3'
          : 'vertex:gemini-2.0-flash')
    );
    setCompactionModel(
      agent.step_routing?.compaction_model ||
        (agent.model_provider === 'meta_muse'
          ? 'meta_muse:muse-glimmer-30b'
          : 'ollama:qwen2.5-coder:32b')
    );
    setPermissionTier(agent.permission_tier);
    setMaxSubagents(agent.max_subagents);
    setMaxRunDurationHours(Math.max(1, Math.round(agent.max_run_duration_ms / 3_600_000)));
    setMaxTokensPerRun(agent.max_tokens_per_run);

    let cancelled = false;
    apiClient.getAgentRuns(agent.id).then((agentRuns) => {
      if (cancelled) return;
      setRuns(agentRuns);
      const targetRunId =
        initialRunId || agent.current_run_id || (agentRuns[0] ? agentRuns[0].id : null);
      setSelectedRunId(targetRunId);
    });

    apiClient.getAgentMemories(agent.id).then((mems) => {
      if (!cancelled) setMemories(mems);
    });

    return () => {
      cancelled = true;
    };
  }, [agent, initialRunId]);

  useEffect(() => {
    if (!selectedRunId) {
      setSteps([]);
      return;
    }
    let cancelled = false;
    apiClient.getInferenceSteps(selectedRunId).then((loadedSteps) => {
      if (cancelled) return;
      setSteps(loadedSteps);
      const initialExpanded: Record<string, boolean> = {};
      for (const s of loadedSteps) {
        initialExpanded[s.id] = true;
      }
      setExpandedSteps(initialExpanded);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  if (!agent) return null;

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated = await apiClient.updateAgentBrainConfig(agent.id, {
      init_prompt: initPrompt,
      model_provider: modelProvider,
      model_id: modelId,
      fallback_provider: fallbackProvider,
      fallback_model_id: fallbackModelId,
      step_routing: {
        planning_model: planningModel,
        tool_loop_model: toolLoopModel,
        compaction_model: compactionModel,
      },
      permission_tier: permissionTier,
      max_subagents: Number(maxSubagents),
      max_run_duration_ms: Number(maxRunDurationHours) * 3_600_000,
      max_tokens_per_run: Number(maxTokensPerRun),
    });
    if (updated) {
      onAgentUpdated(updated);
      setConfigSavedBanner(true);
      window.setTimeout(() => setConfigSavedBanner(false), 2500);
    }
  };

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemContent.trim()) return;
    const created = await apiClient.addAgentMemory({
      agent_id: agent.id,
      project_scope: agent.project_scope,
      memory_type: newMemType,
      content: newMemContent.trim(),
      is_pinned: newMemPinned,
    });
    setMemories((prev) => [created, ...prev]);
    setNewMemContent('');
  };

  const handleTogglePin = async (memId: string) => {
    const updated = await apiClient.toggleMemoryPin(memId);
    if (updated) {
      setMemories((prev) => prev.map((m) => (m.id === memId ? updated : m)));
    }
  };

  const selectedRun = runs.find((r) => r.id === selectedRunId) || runs[0] || null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
      <div className="relative flex h-full w-full max-w-3xl flex-col border-l border-[var(--surface-border)] bg-[var(--surface-bg)] text-[var(--text-main)] shadow-2xl">
        {/* Drawer Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--surface-border)] px-5 py-4 bg-[var(--surface-panel)]">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-base font-bold text-[var(--surface-accent-gold)]">{agent.slug}</span>
              <span className="rounded bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-0.5 text-xs font-mono text-[var(--text-muted)]">
                Level {agent.hierarchy_level}
              </span>
              <span className="rounded bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/30 px-2 py-0.5 text-xs font-mono text-[var(--surface-accent-gold)]">
                {agent.model_provider}:{agent.model_id}
              </span>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-1">{agent.role_title}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--surface-border)] bg-[var(--surface-elevated)] p-1.5 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Sub-tab Navigation */}
        <div className="flex border-b border-[var(--surface-border)] bg-[var(--surface-elevated)] px-5 pt-2 gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveSubTab('runs')}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
              activeSubTab === 'runs'
                ? 'border-[var(--surface-accent-gold)] text-[var(--surface-accent-gold)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            <Clock className="h-3.5 w-3.5" />
            <span>A. Timesheet &amp; Runs Log ({runs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('trace')}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
              activeSubTab === 'trace'
                ? 'border-[var(--surface-accent-gold)] text-[var(--surface-accent-gold)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            <Terminal className="h-3.5 w-3.5" />
            <span>B. Step-by-Step Brain &amp; Terminal Trace</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('config')}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
              activeSubTab === 'config'
                ? 'border-[var(--surface-accent-gold)] text-[var(--surface-accent-gold)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            <Brain className="h-3.5 w-3.5" />
            <span>C. Brain Config, Quotas &amp; Hybrid Memory (pgvector)</span>
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* SUB-TAB A: TIMESHEET & RUNS LOG */}
          {activeSubTab === 'runs' && (
            <div className="space-y-4">
              {runs.length === 0 ? (
                <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-6 text-center text-xs text-[var(--text-muted)]">
                  No execution runs logged yet for {agent.slug}.
                </div>
              ) : (
                runs.map((run) => (
                  <div
                    key={run.id}
                    className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 space-y-3 hover:border-[var(--surface-border-strong)] transition"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-bold text-[var(--surface-accent-gold)]">
                            Run #{run.id}
                          </span>
                          <span className="rounded bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-0.5 text-[10px] font-mono text-[var(--text-muted)]">
                            {run.trigger_type}
                          </span>
                          <span className="text-[11px] text-[var(--text-muted)] font-mono">
                            {formatRelativeTime(run.started_at)}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-main)] font-medium mt-1">
                          {run.input_prompt}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        {run.qa_passed && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--semantic-success)]/15 border border-[var(--semantic-success)]/40 px-2.5 py-0.5 text-[11px] font-mono text-[var(--semantic-success)]">
                            <CheckCircle2 className="h-3 w-3 text-[var(--semantic-success)]" />
                            ✅ Build + Playwright WebGL Passed
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-[var(--text-muted)] bg-[var(--surface-muted)] rounded-lg p-2.5 border border-[var(--surface-border)]">
                      {run.output_summary}
                    </p>

                    {/* Container, Git Branch, Duration & Cost */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[var(--text-muted)]">
                      <div className="flex flex-wrap items-center gap-2">
                        {run.container_id && (
                          <span className="rounded bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-0.5 text-[var(--surface-accent-gold)]">
                            🐳 {run.container_id}
                          </span>
                        )}
                        {run.git_branch && (
                          <span className="inline-flex items-center gap-1 rounded bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-0.5 text-[var(--semantic-success)]">
                            <GitBranch className="h-3 w-3" />
                            {run.git_branch} ({run.git_commit_sha || 'HEAD'})
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        <span>
                          Active Duration:{' '}
                          <strong className="text-[var(--text-main)]">
                            {formatStopwatch(run.active_duration_ms)}
                          </strong>
                        </span>
                        <span>
                          Cost:{' '}
                          <strong className="text-[var(--semantic-success)]">{formatUsd(run.cost_usd)}</strong>
                        </span>
                      </div>
                    </div>

                    {/* Run Token Breakdown Bar */}
                    <TokenBreakdownBar
                      tokensIn={run.tokens_in}
                      tokensCached={run.tokens_cached}
                      tokensThinking={run.tokens_thinking}
                      tokensOut={run.tokens_out}
                      maxTokensQuota={agent.max_tokens_per_run}
                    />

                    {/* Embedded Headless Playwright WebGL QA Screenshot Preview */}
                    {run.qa_screenshot_url && (
                      <div className="space-y-1.5 pt-1">
                        <div className="text-[11px] font-mono text-[var(--text-muted)] flex items-center justify-between">
                          <span>📸 Headless Playwright + WebGL Verification Screenshot:</span>
                          <span className="text-[var(--semantic-success)]">console.error = 0</span>
                        </div>
                        <div className="overflow-hidden rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)]">
                          <img
                            src={run.qa_screenshot_url}
                            alt={`QA Screenshot for ${run.id}`}
                            className="w-full max-h-56 object-cover"
                          />
                        </div>
                      </div>
                    )}

                    {/* Action Footer: Live Preview & Drill into Step Trace */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--surface-border)]">
                      {run.preview_url ? (
                        <a
                          href={run.preview_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-accent-gold)]/15 hover:bg-[var(--surface-accent-gold)]/25 border border-[var(--surface-accent-gold)]/40 px-3 py-1.5 text-xs font-mono font-semibold text-[var(--surface-accent-gold)] transition"
                        >
                          <ExternalLink className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />
                          <span>🌐 Open Live Preview ({run.preview_url.replace('https://', '')})</span>
                        </a>
                      ) : (
                        <span className="text-[11px] font-mono text-[var(--text-muted)]">
                          Backend / Headless Container Run
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRunId(run.id);
                          setActiveSubTab('trace');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-accent)]/15 hover:bg-[var(--surface-accent)]/25 border border-[var(--surface-accent)]/40 px-3 py-1.5 text-xs font-medium text-[var(--surface-accent)] transition cursor-pointer"
                      >
                        <Terminal className="h-3.5 w-3.5 text-[var(--surface-accent)]" />
                        <span>Inspect Step-by-Step Brain Trace</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* SUB-TAB B: STEP-BY-STEP BRAIN & TERMINAL TRACE */}
          {activeSubTab === 'trace' && (
            <div className="space-y-4">
              {/* Run Selector Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-[var(--text-muted)]">Inspecting Run:</span>
                  <select
                    value={selectedRun?.id || ''}
                    onChange={(e) => setSelectedRunId(e.target.value)}
                    className="rounded-lg bg-[var(--surface-muted)] border border-[var(--surface-border)] px-2.5 py-1 text-xs font-mono text-[var(--surface-accent-gold)] focus:outline-none"
                  >
                    {runs.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id} — {r.trigger_type} ({formatStopwatch(r.active_duration_ms)})
                      </option>
                    ))}
                  </select>
                </div>

                {selectedRun?.preview_url && (
                  <a
                    href={selectedRun.preview_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/40 px-2.5 py-1 text-xs font-mono text-[var(--surface-accent-gold)]"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span>🌐 Open Live Preview</span>
                  </a>
                )}
              </div>

              {/* Steps List */}
              <div className="space-y-3">
                {steps.map((step) => {
                  const isExpanded = !!expandedSteps[step.id];
                  const stepTotalTokens =
                    step.tokens_in + step.tokens_thinking + step.tokens_out;
                  const isExpensiveStep = stepTotalTokens >= 50_000;

                  return (
                    <div
                      key={step.id}
                      className={`rounded-2xl border transition ${
                        isExpensiveStep
                          ? 'border-[var(--semantic-warning)]/50 bg-[var(--semantic-warning)]/5'
                          : 'border-[var(--surface-border)] bg-[var(--surface-panel)]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSteps((prev) => ({
                            ...prev,
                            [step.id]: !prev[step.id],
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
                          <span className="rounded bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-0.5 text-[11px] font-mono font-bold text-[var(--surface-accent-gold)]">
                            Step #{step.step_index} • {step.step_type}
                          </span>
                          {step.tool_name && (
                            <span className="rounded bg-[var(--surface-accent)]/15 border border-[var(--surface-accent)]/30 px-2 py-0.5 text-[11px] font-mono text-[var(--surface-accent)]">
                              🛠️ {step.tool_name}
                            </span>
                          )}
                          {isExpensiveStep && (
                            <span className="inline-flex items-center gap-1 rounded bg-[var(--semantic-warning)]/15 border border-[var(--semantic-warning)]/40 px-2 py-0.5 text-[10px] font-mono text-[var(--semantic-warning)] font-semibold">
                              <Flame className="h-3 w-3 text-[var(--semantic-warning)]" />
                              High Token Step ({formatCompactTokens(stepTotalTokens)})
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-[11px] font-mono text-[var(--text-muted)]">
                          <span>⏱️ {(step.duration_ms / 1000).toFixed(2)}s</span>
                          <span>
                            In: <strong className="text-[var(--surface-text-secondary)]">{formatCompactTokens(step.tokens_in)}</strong>
                          </span>
                          <span>
                            Think:{' '}
                            <strong className="text-[var(--surface-accent-gold)]">
                              {formatCompactTokens(step.tokens_thinking)}
                            </strong>
                          </span>
                          <span>
                            Out:{' '}
                            <strong className="text-[var(--surface-accent)]">
                              {formatCompactTokens(step.tokens_out)}
                            </strong>
                          </span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-[var(--surface-border)] p-4 space-y-3 text-xs">
                          {/* Internal Reasoning (Argon High / Gemini 2.5 Pro thinking_text) */}
                          {step.thinking_text && (
                            <div className="rounded-xl bg-[var(--surface-elevated)] border border-[var(--surface-accent-gold)]/25 p-3 space-y-1">
                              <div className="text-[11px] font-mono font-semibold text-[var(--surface-accent-gold)] flex items-center gap-1.5">
                                <Sparkles className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />
                                <span>
                                  Internal Reasoning Trace ({step.model_used} •{' '}
                                  {formatCompactTokens(step.tokens_thinking)} thinking tokens)
                                </span>
                              </div>
                              <p className="text-[var(--text-main)] font-mono text-[11px] leading-relaxed">
                                {step.thinking_text}
                              </p>
                            </div>
                          )}

                          {/* Agent Message / Action Summary */}
                          {step.message_text && (
                            <div className="text-[var(--text-main)]">{step.message_text}</div>
                          )}

                          {/* Tool Call Arguments */}
                          {step.tool_args_json && (
                            <div className="space-y-1">
                              <div className="text-[11px] font-mono text-[var(--text-muted)] flex items-center gap-1">
                                <Code2 className="h-3.5 w-3.5 text-[var(--surface-accent-gold)]" />
                                <span>Tool Arguments (`tool_args_json`):</span>
                              </div>
                              <pre className="rounded-lg bg-[var(--surface-muted)] border border-[var(--surface-border)] p-2.5 text-[11px] font-mono text-[var(--text-main)] overflow-x-auto">
                                {JSON.stringify(step.tool_args_json, null, 2)}
                              </pre>
                            </div>
                          )}

                          {/* Tool Output: Diff & Stdout/Stderr */}
                          {step.tool_output_json && (
                            <div className="space-y-2">
                              {step.tool_output_json.diff && (
                                <div className="space-y-1">
                                  <div className="text-[11px] font-mono text-[var(--semantic-success)]">
                                    Container Git Diff (`tool_output_json.diff`):
                                  </div>
                                  <pre className="rounded-lg bg-[var(--surface-muted)] border border-[var(--semantic-success)]/30 p-2.5 text-[11px] font-mono text-[var(--semantic-success)] overflow-x-auto">
                                    {step.tool_output_json.diff}
                                  </pre>
                                </div>
                              )}

                              {step.tool_output_json.stdout && (
                                <div className="space-y-1">
                                  <div className="text-[11px] font-mono text-[var(--text-muted)]">
                                    Container Shell Output (`stdout` • exit_code={step.tool_output_json.exit_code ?? 0}):
                                  </div>
                                  <pre className="rounded-lg bg-[var(--surface-muted)] border border-[var(--surface-border)] p-2.5 text-[11px] font-mono text-[var(--text-main)] overflow-x-auto">
                                    {step.tool_output_json.stdout}
                                  </pre>
                                </div>
                              )}

                              {step.tool_output_json.stderr && (
                                <div className="space-y-1">
                                  <div className="text-[11px] font-mono text-[var(--semantic-alert)] flex items-center gap-1">
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                    <span>stderr:</span>
                                  </div>
                                  <pre className="rounded-lg bg-[var(--semantic-alert)]/10 border border-[var(--semantic-alert)]/40 p-2.5 text-[11px] font-mono text-[var(--semantic-alert)] overflow-x-auto">
                                    {step.tool_output_json.stderr}
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
              </div>
            </div>
          )}

          {/* SUB-TAB C: BRAIN CONFIG, QUOTAS & HYBRID MEMORY (pgvector) */}
          {activeSubTab === 'config' && (
            <div className="space-y-6">
              {/* Brain Config Form */}
              <form
                onSubmit={handleSaveConfig}
                className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                    <Brain className="h-4 w-4 text-[var(--surface-accent-gold)]" />
                    <span>
                      Plug-and-Play Multi-Provider Brain, Failover &amp; Per-Step Routing
                    </span>
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/40 px-2.5 py-1 text-[10px] font-mono text-[var(--surface-accent-gold)]">
                      📌 pgvector 768-dim Pinned: text-embedding-005 / nomic-embed-text (Zero Vector Drift)
                    </span>
                    {configSavedBanner && (
                      <span className="rounded-md bg-[var(--semantic-success)]/15 border border-[var(--semantic-success)]/40 px-2.5 py-1 text-xs font-mono text-[var(--semantic-success)]">
                        ✓ Saved to PostgreSQL `agents` + `.claude/agents/`
                      </span>
                    )}
                  </div>
                </div>

                {/* Primary Model + Permission Tier */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <label className="block text-[var(--text-muted)] font-mono mb-1">
                      Primary Provider (`model_provider`)
                    </label>
                    <select
                      value={modelProvider}
                      onChange={(e) => {
                        const nextProv = e.target.value as ModelProvider;
                        setModelProvider(nextProv);
                        setModelId(PROVIDER_MODELS[nextProv][0]);
                      }}
                      className="w-full rounded-lg bg-[var(--surface-muted)] border border-[var(--surface-border)] px-3 py-2 text-[var(--text-main)] font-mono"
                    >
                      <option value="vertex">vertex (GCP Vertex AI Gemini 2.5)</option>
                      <option value="meta_muse">meta_muse (Meta Muse API v1)</option>
                      <option value="anthropic">anthropic (Claude Sonnet 4 / 3.7)</option>
                      <option value="openai">openai (GPT-4.1 / Mini / o3)</option>
                      <option value="ollama">ollama (GCP L4 GPU Self-Hosted)</option>
                      <option value="huggingface">huggingface (Dedicated vLLM)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[var(--text-muted)] font-mono mb-1">
                      Primary Model ID (`model_id`)
                    </label>
                    <select
                      value={modelId}
                      onChange={(e) => setModelId(e.target.value)}
                      className="w-full rounded-lg bg-[var(--surface-muted)] border border-[var(--surface-border)] px-3 py-2 text-[var(--text-main)] font-mono"
                    >
                      {PROVIDER_MODELS[modelProvider].map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                      {!PROVIDER_MODELS[modelProvider].includes(modelId) && modelId && (
                        <option value={modelId}>{modelId}</option>
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[var(--text-muted)] font-mono mb-1">
                      Permission Tier (`permission_tier`)
                    </label>
                    <select
                      value={permissionTier}
                      onChange={(e) => setPermissionTier(e.target.value as PermissionTier)}
                      className="w-full rounded-lg bg-[var(--surface-muted)] border border-[var(--surface-border)] px-3 py-2 text-[var(--text-main)] font-mono"
                    >
                      <option value="full_overdrive">full_overdrive (Zero Prompts in Container)</option>
                      <option value="standard_autonomous">standard_autonomous</option>
                      <option value="strict_gate">strict_gate (Prod Deploy Gate)</option>
                    </select>
                  </div>
                </div>

                {/* Automatic Failover / Fallback Model */}
                <div className="rounded-xl bg-[var(--surface-muted)]/70 border border-[var(--surface-border)] p-3 space-y-2.5">
                  <div className="text-[11px] font-mono font-semibold text-[var(--surface-accent-gold)]">
                    🛡️ Automatic Credit/Rate-Limit Failover Model (`429 / 503 / Quota Exhausted`)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-[var(--text-muted)] font-mono mb-1">
                        Fallback Provider (`fallback_provider`)
                      </label>
                      <select
                        value={fallbackProvider}
                        onChange={(e) => {
                          const nextProv = e.target.value as ModelProvider;
                          setFallbackProvider(nextProv);
                          setFallbackModelId(PROVIDER_MODELS[nextProv][0]);
                        }}
                        className="w-full rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] px-3 py-1.5 text-[var(--text-main)] font-mono"
                      >
                        <option value="vertex">vertex (GCP Vertex AI)</option>
                        <option value="meta_muse">meta_muse (Meta Muse API)</option>
                        <option value="anthropic">anthropic (Claude Sonnet)</option>
                        <option value="openai">openai (GPT-4.1 / o3)</option>
                        <option value="ollama">ollama (GCP GPU Ollama)</option>
                        <option value="huggingface">huggingface (vLLM)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[var(--text-muted)] font-mono mb-1">
                        Fallback Model ID (`fallback_model_id`)
                      </label>
                      <select
                        value={fallbackModelId}
                        onChange={(e) => setFallbackModelId(e.target.value)}
                        className="w-full rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] px-3 py-1.5 text-[var(--text-main)] font-mono"
                      >
                        {PROVIDER_MODELS[fallbackProvider].map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Per-Step Intra-Run Routing */}
                <div className="rounded-xl bg-[var(--surface-muted)]/70 border border-[var(--surface-border)] p-3 space-y-2.5">
                  <div className="text-[11px] font-mono font-semibold text-[var(--surface-accent)]">
                    ⚡ Per-Step Intra-Run Model Routing (`planning` vs `tool_loop` vs `60K compaction`)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block text-[var(--text-muted)] font-mono mb-1">
                        1. Planning &amp; Spec Step
                      </label>
                      <input
                        type="text"
                        value={planningModel}
                        onChange={(e) => setPlanningModel(e.target.value)}
                        className="w-full rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] px-2.5 py-1.5 text-[var(--text-main)] font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[var(--text-muted)] font-mono mb-1">
                        2. Fast Tool-Call Loop Step
                      </label>
                      <input
                        type="text"
                        value={toolLoopModel}
                        onChange={(e) => setToolLoopModel(e.target.value)}
                        className="w-full rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] px-2.5 py-1.5 text-[var(--text-main)] font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[var(--text-muted)] font-mono mb-1">
                        3. 60K Rolling Compaction Step
                      </label>
                      <input
                        type="text"
                        value={compactionModel}
                        onChange={(e) => setCompactionModel(e.target.value)}
                        className="w-full rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] px-2.5 py-1.5 text-[var(--text-main)] font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <label className="block text-[var(--text-muted)] font-mono mb-1">
                      Max Concurrent Subagents (`max_subagents`)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={12}
                      value={maxSubagents}
                      onChange={(e) => setMaxSubagents(Number(e.target.value))}
                      className="w-full rounded-lg bg-[var(--surface-muted)] border border-[var(--surface-border)] px-3 py-2 text-[var(--text-main)] font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[var(--text-muted)] font-mono mb-1">
                      Hard Kill Timeout Hours (`max_run_duration_ms`)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={72}
                      value={maxRunDurationHours}
                      onChange={(e) => setMaxRunDurationHours(Number(e.target.value))}
                      className="w-full rounded-lg bg-[var(--surface-muted)] border border-[var(--surface-border)] px-3 py-2 text-[var(--text-main)] font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[var(--text-muted)] font-mono mb-1">
                      Max Tokens / Run (`max_tokens_per_run`)
                    </label>
                    <input
                      type="number"
                      step={100000}
                      min={100000}
                      value={maxTokensPerRun}
                      onChange={(e) => setMaxTokensPerRun(Number(e.target.value))}
                      className="w-full rounded-lg bg-[var(--surface-muted)] border border-[var(--surface-border)] px-3 py-2 text-[var(--text-main)] font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-[var(--text-muted)] font-mono mb-1">
                    System Initialization Prompt (`init_prompt` — Injected Deterministically on Every Run)
                  </label>
                  <textarea
                    rows={4}
                    value={initPrompt}
                    onChange={(e) => setInitPrompt(e.target.value)}
                    className="w-full rounded-xl bg-[var(--surface-muted)] border border-[var(--surface-border)] p-3 text-xs font-mono text-[var(--text-main)] focus:outline-none focus:border-[var(--surface-accent-gold)]"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--surface-accent-gold)] hover:brightness-110 px-4 py-2 text-xs font-bold text-black transition cursor-pointer"
                  >
                    <Save className="h-3.5 w-3.5" />
                    <span>Save Brain Config</span>
                  </button>
                </div>
              </form>

              {/* Hybrid Memory (`agent_memories` + `pgvector`) */}
              <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                    <Database className="h-4 w-4 text-[var(--surface-accent-gold)]" />
                    <span>Hybrid Agent Memory (`PostgreSQL + pgvector HNSW`)</span>
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Pinned memories load deterministically into every prompt; unpinned episodic memories are recalled semantically via <code className="text-[var(--surface-accent-gold)]">text-embedding-005</code> cosine similarity.
                  </p>
                </div>

                {/* Add Memory Form */}
                <form onSubmit={handleAddMemory} className="space-y-2.5 rounded-xl bg-[var(--surface-muted)] border border-[var(--surface-border)] p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <select
                      value={newMemType}
                      onChange={(e) => setNewMemType(e.target.value as MemoryType)}
                      className="rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] px-2.5 py-1.5 font-mono text-xs text-[var(--surface-accent-gold)]"
                    >
                      <option value="PINNED_PREFERENCE">PINNED_PREFERENCE</option>
                      <option value="CEO_DECISION">CEO_DECISION</option>
                      <option value="REPO_GOTCHA">REPO_GOTCHA</option>
                      <option value="EPISODIC_LESSON">EPISODIC_LESSON</option>
                    </select>

                    <label className="inline-flex items-center gap-1.5 text-[var(--text-main)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newMemPinned}
                        onChange={(e) => setNewMemPinned(e.target.checked)}
                        className="rounded border-[var(--surface-border)]"
                      />
                      <span>Always Pin into System Prompt</span>
                    </label>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newMemContent}
                      onChange={(e) => setNewMemContent(e.target.value)}
                      placeholder="Add standing rule, repo gotcha, or CEO decision to pgvector memory..."
                      className="flex-1 rounded-lg bg-[var(--surface-panel)] border border-[var(--surface-border)] px-3 py-1.5 text-xs text-[var(--text-main)]"
                    />
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 rounded-lg bg-[var(--surface-accent)]/15 hover:bg-[var(--surface-accent)]/25 border border-[var(--surface-accent)]/40 px-3 py-1.5 text-xs font-semibold text-[var(--surface-accent)] cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add Memory</span>
                    </button>
                  </div>
                </form>

                {/* Memory List */}
                <div className="space-y-2">
                  {memories.map((mem) => (
                    <div
                      key={mem.id}
                      className="flex items-start justify-between gap-3 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)]/60 p-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="rounded bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/30 px-2 py-0.5 text-[10px] font-mono text-[var(--surface-accent-gold)]">
                            {mem.memory_type}
                          </span>
                          {mem.is_pinned ? (
                            <span className="rounded bg-[var(--surface-accent-gold)]/15 border border-[var(--surface-accent-gold)]/30 px-2 py-0.5 text-[10px] font-mono text-[var(--surface-accent-gold)]">
                              📌 Pinned (Deterministic SQL)
                            </span>
                          ) : (
                            <span className="rounded bg-[var(--surface-elevated)] border border-[var(--surface-border)] px-2 py-0.5 text-[10px] font-mono text-[var(--surface-text-secondary)]">
                              🧭 pgvector Recall (sim: {(mem.similarity_score || 0.94).toFixed(2)})
                            </span>
                          )}
                          <span className="text-[10px] font-mono text-[var(--text-muted)]">
                            {formatRelativeTime(mem.created_at)}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-main)]">{mem.content}</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleTogglePin(mem.id)}
                        className={`shrink-0 rounded-lg border p-1.5 transition cursor-pointer ${
                          mem.is_pinned
                            ? 'border-[var(--surface-accent-gold)]/50 bg-[var(--surface-accent-gold)]/20 text-[var(--surface-accent-gold)]'
                            : 'border-[var(--surface-border)] bg-[var(--surface-panel)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
                        }`}
                        title="Toggle deterministic pin"
                      >
                        <Pin className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
