import type { ChatMessage, ChatThread, InferenceStep } from '../types/warden';

export type WsEventPayload = {
  type:
    | 'TELEMETRY_TICK'
    | 'AGENT_UPDATED'
    | 'RUN_UPDATED'
    | 'STEP_CREATED'
    | 'BRAIN_STATUS'
    | 'CHAT_MESSAGE'
    | 'GATE_CREATED'
    | 'GATE_RESOLVED'
    | 'STANDUP_UPDATED'
    | 'BACKLOG_UPDATED'
    | 'BUDGET_EXCEEDED';
  data: unknown;
};

export interface DemoWorkspaceInfo {
  user_id: string;
  mode: 'demo' | 'full';
  branch: string | null;
  pr_url: string | null;
  status: string;
  local_dir: string | null;
  deploy_url: string | null;
  deploy_status: string;
}

export interface DemoWorkspaceState {
  ok: boolean;
  workspace: DemoWorkspaceInfo;
  deploy: { project_name: string; cloudflare_configured: boolean };
}

export interface DemoDeployState {
  ok: boolean;
  result: {
    ok: boolean;
    status: string;
    projectName: string;
    primaryUrl: string | null;
    pagesDevUrl: string | null;
    fileCount: number;
    totalDurationMs: number;
    error: string | null;
  };
  workspace: DemoWorkspaceInfo;
}

export interface UserTokenTelemetry {
  range: 'today' | '7d' | '30d' | 'all';
  totalTokens: number;
  totalCostUsd: number;
  totalRuns: number;
  cachedHitPct: number;
  totalImageGenerations?: number;
  byVertical: {
    TECH: { tokens: number; costUsd: number; runs: number; sharePct: number };
    DESIGN?: { tokens: number; costUsd: number; runs: number; imageCount: number; sharePct: number };
    SEO_AEO: { tokens: number; costUsd: number; runs: number; sharePct: number };
    SOCIAL: { tokens: number; costUsd: number; runs: number; sharePct: number };
  };
}

export interface SeoAuditCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface SeoAuditReport {
  url: string;
  score: number;
  checks: SeoAuditCheck[];
}

export interface SlimRunStatus {
  id: string;
  agent_id: string;
  agent_slug: string;
  status: string;
  output_summary: string | null;
  started_at: string;
  ended_at: string | null;
  error: string | null;
  child_run_ids: string[];
}

export interface RunStatusResponse {
  run: SlimRunStatus;
  latestStep: InferenceStep | null;
  replyMessage: ChatMessage | null;
  waitingForCeo?: boolean;
  error?: string | null;
}

export interface ThreadStatusResponse {
  threadId: string;
  thread: ChatThread;
  runningRuns: SlimRunStatus[];
  latestRun: SlimRunStatus | null;
  latestStep: InferenceStep | null;
  lastReply: ChatMessage | null;
  pendingGates: unknown[];
}
