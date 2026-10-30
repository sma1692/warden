import { randomUUID } from 'node:crypto';

export type TelegramAlertType =
  | 'QUESTION'
  | 'WAITING_FOR_CEO'
  | 'STANDUP_SIGN_OFF'
  | 'DEPLOY_PERMISSION'
  | 'EMPTY_BACKLOG_PING'
  | 'KILLED_24H_LIMIT'
  | 'STUCK_LOOP'
  | 'TOKEN_CAP'
  | 'ZOMBIE_NO_HEARTBEAT';

export interface TelegramAlertPayload {
  type: TelegramAlertType;
  agentSlug: string;
  projectScope?: string | null;
  department?: string | null;
  headline?: string;
  details?: string;
  threadId?: string | null;
  gateId?: string | null;
  runId?: string | null;
  sprintId?: string | null;
  recoveryBranch?: string | null;
  suggestedCount?: number;
}

export interface TelegramSentRecord {
  id: string;
  type: TelegramAlertType;
  agentSlug: string;
  projectScope: string | null;
  messageText: string;
  deepLinkUrl: string;
  threadId: string | null;
  gateId: string | null;
  runId: string | null;
  deliveredViaApi: boolean;
  telegramMessageId: number | null;
  error: string | null;
  createdAt: string;
}

export type TelegramBroadcastCallback = (event: string, data: unknown) => void;
export type TelegramDbPersistCallback = (record: TelegramSentRecord) => Promise<void>;

/**
 * 1-Way Telegram Push Pager (dynamocommando.md Sections 1.5, 4.5, 4.6, 5)
 *
 * Strictly outbound notifications via Telegram Bot API with an inline URL button
 * that deep-links the CEO directly into the DynamoCommando PWA / App.
 * Also maintains an in-memory + DB log so the Dashboard UI can display a live feed
 * of recent Telegram Pager pushes even when TELEGRAM_BOT_TOKEN is not configured.
 */
export class TelegramPushPager {
  private botToken: string;
  private ceoChatId: string;
  private publicAppUrl: string;
  private sentHistory: TelegramSentRecord[] = [];
  private maxHistorySize = 200;
  private onBroadcast?: TelegramBroadcastCallback;
  private onPersist?: TelegramDbPersistCallback;

  constructor(options?: {
    botToken?: string;
    ceoChatId?: string;
    publicAppUrl?: string;
    onBroadcast?: TelegramBroadcastCallback;
    onPersist?: TelegramDbPersistCallback;
  }) {
    this.botToken = options?.botToken ?? process.env.TELEGRAM_BOT_TOKEN ?? '';
    this.ceoChatId = options?.ceoChatId ?? process.env.TELEGRAM_CEO_CHAT_ID ?? '';
    this.publicAppUrl = (
      options?.publicAppUrl ??
      process.env.PUBLIC_APP_URL ??
      'https://app.example.com'
    ).replace(/\/+$/, '');
    this.onBroadcast = options?.onBroadcast;
    this.onPersist = options?.onPersist;
  }

  public setCallbacks(callbacks: {
    onBroadcast?: TelegramBroadcastCallback;
    onPersist?: TelegramDbPersistCallback;
  }): void {
    if (callbacks.onBroadcast) this.onBroadcast = callbacks.onBroadcast;
    if (callbacks.onPersist) this.onPersist = callbacks.onPersist;
  }

  /**
   * Builds the deep-link URL into the DynamoCommando PWA.
   */
  public buildDeepLink(params: {
    threadId?: string | null;
    gateId?: string | null;
    runId?: string | null;
    sprintId?: string | null;
  }): string {
    const query = new URLSearchParams();
    if (params.threadId) query.set('thread', params.threadId);
    if (params.gateId) query.set('gate', params.gateId);
    if (params.runId) query.set('run', params.runId);
    if (params.sprintId) query.set('sprint', params.sprintId);
    const qs = query.toString();
    return qs ? `${this.publicAppUrl}/?${qs}` : `${this.publicAppUrl}/`;
  }

  /**
   * Formats the outbound notification using the canonical DynamoCommando templates.
   */
  public formatMessage(payload: TelegramAlertPayload): string {
    const agent = payload.agentSlug.startsWith('@')
      ? payload.agentSlug
      : `@${payload.agentSlug}`;
    const scopeLabel = payload.projectScope || payload.department || 'Company';

    switch (payload.type) {
      case 'QUESTION':
      case 'WAITING_FOR_CEO': {
        const headline =
          payload.headline ||
          `🟡 [${agent}] Needs your input on ${scopeLabel} — tap to open App`;
        return payload.details ? `${headline}\n\n${payload.details}` : headline;
      }

      case 'STANDUP_SIGN_OFF': {
        const headline =
          payload.headline ||
          `📋 [12:00 PM IST Daily Standup] MoM & Sprint Plan ready for CEO sign-off`;
        return payload.details ? `${headline}\n\n${payload.details}` : headline;
      }

      case 'DEPLOY_PERMISSION': {
        const headline =
          payload.headline ||
          `🚀 [${agent}] Production deployment approval requested (${scopeLabel})`;
        return payload.details ? `${headline}\n\n${payload.details}` : headline;
      }

      case 'EMPTY_BACKLOG_PING': {
        const count = payload.suggestedCount ?? 3;
        const headline =
          payload.headline ||
          `🔔 [${agent}] Department Idle — Backlog Empty! ${count} suggested initiatives drafted. Tap to assign tasks.`;
        return payload.details ? `${headline}\n\n${payload.details}` : headline;
      }

      case 'KILLED_24H_LIMIT': {
        const branch =
          payload.recoveryBranch ||
          `wip/timeout-${payload.runId ? payload.runId.slice(0, 8) : 'run'}`;
        const headline =
          payload.headline ||
          `⚠️ [${agent}] Exceeded 24h max runtime and was terminated safely (saved to ${branch})`;
        return payload.details ? `${headline}\n\n${payload.details}` : headline;
      }

      case 'STUCK_LOOP': {
        const headline =
          payload.headline ||
          `🟠 [${agent}] Stuck in repetitive tool loop (3x identical failures) — circuit breaker tripped`;
        return payload.details ? `${headline}\n\n${payload.details}` : headline;
      }

      case 'TOKEN_CAP': {
        const headline =
          payload.headline ||
          `🛑 [${agent}] Reached per-run token cap (1,000,000 tokens) — paused for CEO review`;
        return payload.details ? `${headline}\n\n${payload.details}` : headline;
      }

      case 'ZOMBIE_NO_HEARTBEAT': {
        const headline =
          payload.headline ||
          `🔴 [${agent}] Unresponsive (no heartbeat > 3m) — flagged ZOMBIE_NO_HEARTBEAT`;
        return payload.details ? `${headline}\n\n${payload.details}` : headline;
      }

      default:
        return payload.headline || `🔔 [${agent}] Notification from DynamoCommando`;
    }
  }

  /**
   * Sends a 1-way push notification via Telegram Bot API with an inline deep-link button,
   * records it in memory + DB, and broadcasts `telegram:sent` over WebSocket.
   */
  public async sendAlert(payload: TelegramAlertPayload): Promise<TelegramSentRecord> {
    const messageText = this.formatMessage(payload);
    const deepLinkUrl = this.buildDeepLink({
      threadId: payload.threadId,
      gateId: payload.gateId,
      runId: payload.runId,
      sprintId: payload.sprintId,
    });

    let deliveredViaApi = false;
    let telegramMessageId: number | null = null;
    let error: string | null = null;

    if (this.botToken && this.ceoChatId) {
      try {
        const endpoint = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.ceoChatId,
            text: messageText,
            disable_web_page_preview: true,
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: 'Open DynamoCommando App',
                    url: deepLinkUrl,
                  },
                ],
              ],
            },
          }),
        });

        if (response.ok) {
          const body = (await response.json()) as {
            ok?: boolean;
            result?: { message_id?: number };
          };
          deliveredViaApi = Boolean(body.ok);
          telegramMessageId = body.result?.message_id ?? null;
        } else {
          const errText = await response.text();
          error = `Telegram API HTTP ${response.status}: ${errText.slice(0, 240)}`;
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    } else {
      error = 'TELEGRAM_BOT_TOKEN or TELEGRAM_CEO_CHAT_ID not configured (logged to Dashboard feed)';
    }

    const record: TelegramSentRecord = {
      id: `tg_${randomUUID().slice(0, 12)}`,
      type: payload.type,
      agentSlug: payload.agentSlug.startsWith('@')
        ? payload.agentSlug
        : `@${payload.agentSlug}`,
      projectScope: payload.projectScope ?? payload.department ?? null,
      messageText,
      deepLinkUrl,
      threadId: payload.threadId ?? null,
      gateId: payload.gateId ?? null,
      runId: payload.runId ?? null,
      deliveredViaApi,
      telegramMessageId,
      error,
      createdAt: new Date().toISOString(),
    };

    this.sentHistory.unshift(record);
    if (this.sentHistory.length > this.maxHistorySize) {
      this.sentHistory.length = this.maxHistorySize;
    }

    if (this.onPersist) {
      try {
        await this.onPersist(record);
      } catch {
        // Ignore persistence errors so alerting never crashes the caller
      }
    }

    if (this.onBroadcast) {
      this.onBroadcast('telegram:sent', record);
    }

    return record;
  }

  /**
   * Convenience helpers for specific alert types.
   */
  public async notifyQuestionWaitingForCeo(params: {
    agentSlug: string;
    projectScope?: string | null;
    question: string;
    threadId?: string | null;
    gateId?: string | null;
    runId?: string | null;
  }): Promise<TelegramSentRecord> {
    const scope = params.projectScope || 'General';
    const agent = params.agentSlug.startsWith('@')
      ? params.agentSlug
      : `@${params.agentSlug}`;
    return this.sendAlert({
      type: 'WAITING_FOR_CEO',
      agentSlug: agent,
      projectScope: scope,
      headline: `🟡 [${agent}] Needs your input on ${scope} — tap to open App`,
      details: params.question,
      threadId: params.threadId,
      gateId: params.gateId,
      runId: params.runId,
    });
  }

  public async notifyStandupReady(params: {
    sprintId: string;
    dateIst: string;
    summaryPreview?: string;
    threadId?: string | null;
    gateId?: string | null;
  }): Promise<TelegramSentRecord> {
    return this.sendAlert({
      type: 'STANDUP_SIGN_OFF',
      agentSlug: '@cto',
      projectScope: 'Company-Wide',
      headline: `📋 [12:00 PM IST Daily Standup — ${params.dateIst}] MoM & Sprint Plan ready for CEO sign-off`,
      details: params.summaryPreview,
      sprintId: params.sprintId,
      threadId: params.threadId,
      gateId: params.gateId,
    });
  }

  public async notifyDeployPermission(params: {
    agentSlug?: string;
    projectScope: string;
    targetDesc: string;
    threadId?: string | null;
    gateId?: string | null;
    runId?: string | null;
  }): Promise<TelegramSentRecord> {
    const agent = params.agentSlug || '@infra_head';
    return this.sendAlert({
      type: 'DEPLOY_PERMISSION',
      agentSlug: agent,
      projectScope: params.projectScope,
      headline: `🚀 [${agent}] Production deployment approval requested`,
      details: params.targetDesc,
      threadId: params.threadId,
      gateId: params.gateId,
      runId: params.runId,
    });
  }

  public async notifyEmptyBacklog(params: {
    agentSlug: string;
    projectScope: string;
    suggestedTitles: string[];
    threadId?: string | null;
    gateId?: string | null;
  }): Promise<TelegramSentRecord> {
    const agent = params.agentSlug.startsWith('@')
      ? params.agentSlug
      : `@${params.agentSlug}`;
    const bulletList = params.suggestedTitles
      .map((t, idx) => `${idx + 1}. ${t}`)
      .join('\n');
    return this.sendAlert({
      type: 'EMPTY_BACKLOG_PING',
      agentSlug: agent,
      projectScope: params.projectScope,
      suggestedCount: params.suggestedTitles.length,
      headline: `🔔 [${agent}] Department Idle — Backlog Empty! ${params.suggestedTitles.length} suggested initiatives drafted. Tap to assign tasks.`,
      details: bulletList || undefined,
      threadId: params.threadId,
      gateId: params.gateId,
    });
  }

  public async notifyKilled24hLimit(params: {
    agentSlug: string;
    projectScope?: string | null;
    runId: string;
    recoveryBranch: string;
    threadId?: string | null;
  }): Promise<TelegramSentRecord> {
    const agent = params.agentSlug.startsWith('@')
      ? params.agentSlug
      : `@${params.agentSlug}`;
    return this.sendAlert({
      type: 'KILLED_24H_LIMIT',
      agentSlug: agent,
      projectScope: params.projectScope,
      runId: params.runId,
      recoveryBranch: params.recoveryBranch,
      threadId: params.threadId,
      headline: `⚠️ [${agent}] Exceeded 24h max runtime and was terminated safely (saved to ${params.recoveryBranch})`,
    });
  }

  public getRecentAlerts(limit = 50): TelegramSentRecord[] {
    return this.sentHistory.slice(0, limit);
  }
}
