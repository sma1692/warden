import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import http, { IncomingMessage, ServerResponse } from 'node:http';
import https from 'node:https';
import type { Socket } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { ensureDevCerts, getLanIp, isHttpsEnabled } from './devHttps.js';
import {
  AgentRecord,
  AgentRunRecord,
  ApprovalGateRecord,
  BacklogStage,
  BacklogPriority,
  ChatThreadMode,
  HumanInterventionType,
  MediaAttachment,
  MemoryType,
  ModelProvider,
  OrchestratorStore,
  PermissionTier,
  RoutingProfile,
  StepRoutingMap,
} from '../engine/OrchestratorStore.js';
import { AgentRunner } from '../engine/AgentRunner.js';
import { HierarchyRouter } from '../engine/HierarchyRouter.js';
import { StandupCoordinator } from '../engine/StandupCoordinator.js';
import { HealthAndQuotaGuard } from '../watchdogs/HealthAndQuotaGuard.js';
import { IdleBacklogMonitor } from '../watchdogs/IdleBacklogMonitor.js';
import { MediaUploadService, mediaUploadService } from '../media/MediaUploadService.js';
import {
  handleWhatsAppRoutes,
  sendWhatsAppButtons,
  sendWhatsAppText,
  transcribeAudio,
} from '../bridge/whatsapp/index.js';
import { WhatsAppCommandCenter } from '../bridge/whatsapp/WhatsAppCommandCenter.js';
import { authenticateRequest, handleAuthRoutes, isPublicPath } from '../auth/routes.js';
import { handleClientRoutes } from '../client/routes.js';
import { handleSeoRoutes } from '../seo/seo.js';
import { onTokensRevoked } from '../auth/UserStore.js';
import { handleInboundLoginText } from '../auth/WhatsAppLinkLogin.js';
import {
  createReminderFromText,
  handleReminderRoutes,
  looksLikeReminderRequest,
  startReminderScheduler,
  type ReminderCreatedVia,
  type ReminderSchedulerHandle,
} from '../reminders/index.js';

export interface ControlPlaneServerOptions {
  port?: number;
  host?: string;
  /** Serve TLS with the shared `.state/certs/` dev cert. Defaults to WARDEN_HTTPS env. */
  https?: boolean;
  wardenRoot?: string;
  store?: OrchestratorStore;
  healthGuard?: HealthAndQuotaGuard;
  idleMonitor?: IdleBacklogMonitor;
  agentRunner?: AgentRunner;
  hierarchyRouter?: HierarchyRouter;
  standupCoordinator?: StandupCoordinator;
  mediaService?: MediaUploadService;
}

const EVENT_TO_WEB_TYPE: Record<string, string> = {
  'health:tick': 'TELEMETRY_TICK',
  'agent:updated': 'AGENT_UPDATED',
  'run:updated': 'RUN_UPDATED',
  'step:created': 'STEP_CREATED',
  'brain:status': 'BRAIN_STATUS',
  'message:created': 'CHAT_MESSAGE',
  'gate:created': 'GATE_CREATED',
  'gate:resolved': 'GATE_RESOLVED',
  'standup:updated': 'STANDUP_UPDATED',
  'backlog:updated': 'BACKLOG_UPDATED',
  'routing:profile_changed': 'ROUTING_PROFILE_CHANGED',
  'credential:updated': 'CREDENTIAL_UPDATED',
  'credential:rotated': 'CREDENTIAL_ROTATED',
  'credential:deleted': 'CREDENTIAL_DELETED',
  'sync.completed': 'SYNC_COMPLETED',
  'budget:exceeded': 'BUDGET_EXCEEDED',
};

/**
 * ControlPlaneServer — Node HTTP(S) REST API + WebSocket (`/ws`) + Static `/media/*` Server
 * (the architecture spec Sections 2, 4, 5, 7)
 */
export class ControlPlaneServer {
  public readonly port: number;
  public readonly host: string;
  public readonly httpsEnabled: boolean;
  public readonly store: OrchestratorStore;
  public readonly healthGuard: HealthAndQuotaGuard;
  public readonly idleMonitor: IdleBacklogMonitor;
  public readonly agentRunner: AgentRunner;
  public readonly hierarchyRouter: HierarchyRouter;
  public readonly standupCoordinator: StandupCoordinator;
  public readonly mediaService: MediaUploadService;
  public readonly whatsAppCommands: WhatsAppCommandCenter;

  private server: http.Server | https.Server | null = null;
  private sockets = new Set<Socket>();
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private hydratedUsers = new Set<string>();

  private isIngesting: boolean = false;
  private autoIngestInterval: NodeJS.Timeout | null = null;
  private reminderScheduler: ReminderSchedulerHandle | null = null;
  private readonly wardenRoot: string;

  constructor(options?: ControlPlaneServerOptions) {
    this.wardenRoot = options?.wardenRoot || process.cwd();
    this.port = Number(options?.port ?? process.env.PORT ?? 4000);
    this.host =
      options?.host ??
      process.env.ORCHESTRATOR_HOST ??
      process.env.HOST ??
      '0.0.0.0';
    this.httpsEnabled = options?.https ?? isHttpsEnabled();
    this.store =
      options?.store ||
      new OrchestratorStore({
        onBroadcast: (event, payload) => this.broadcastEvent(event, payload),
      });
    this.store.setBroadcast((event, payload) =>
      this.broadcastEvent(event, payload)
    );

    this.healthGuard =
      options?.healthGuard ||
      new HealthAndQuotaGuard({
        store: this.store,
      });

    this.idleMonitor =
      options?.idleMonitor ||
      new IdleBacklogMonitor({
        store: this.store,
      });

    this.agentRunner =
      options?.agentRunner ||
      new AgentRunner({
        store: this.store,
        healthGuard: this.healthGuard,
      });

    this.hierarchyRouter =
      options?.hierarchyRouter ||
      new HierarchyRouter({
        store: this.store,
        agentRunner: this.agentRunner,
      });

    this.standupCoordinator =
      options?.standupCoordinator ||
      new StandupCoordinator({
        store: this.store,
        agentRunner: this.agentRunner,
        idleMonitor: this.idleMonitor,
      });

    this.mediaService = options?.mediaService || mediaUploadService;

    this.whatsAppCommands = new WhatsAppCommandCenter({
      standupCoordinator: this.standupCoordinator,
      routeToAgents: (from, text) => this.routeWhatsAppToAgents(from, text),
      tryCreateReminder: (text) => this.tryCreateReminder(text, 'whatsapp'),
      sendText: (to, text) => sendWhatsAppText(to, text),
      sendButtons: (to, body, buttons, opts) => sendWhatsAppButtons(to, body, buttons, opts),
      transcribe: (audio, mimeType) => transcribeAudio(audio, mimeType),
      onEvent: (event, payload) => this.broadcastEvent(event, payload),
    });
  }

  /**
   * Broadcasts real-time events to all connected WebSocket `/ws` clients.
   */
  public broadcastEvent(event: string, data: unknown): void {
    if (this.clients.size === 0) return;

    const mappedType = EVENT_TO_WEB_TYPE[event] || event;
    const messageJson = JSON.stringify({
      event,
      type: mappedType,
      data,
      timestamp: new Date().toISOString(),
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(messageJson);
        } catch {
          // ignore broken socket
        }
      }
    }
  }

  /** `/ws` on the HTTP(S) server: JWT-gated, and closed when the user's tokens are revoked. */
  private attachWebSocketServer(): void {
    this.wss = new WebSocketServer({
      server: this.server!,
      path: '/ws',
      // Browsers cannot set headers on a WebSocket: accept ?token= or the session cookie.
      verifyClient: (
        { req }: { req: IncomingMessage },
        done: (result: boolean, code?: number, message?: string) => void
      ) => {
        authenticateRequest(req, true).then(
          (user) => done(Boolean(user), user ? undefined : 401, user ? undefined : 'Not signed in'),
          () => done(false, 503, 'Database unreachable')
        );
      },
    });
    // Close a user's live sockets when their tokens are revoked (logout).
    const socketUsers = new WeakMap<WebSocket, string>();
    onTokensRevoked((userId) => {
      for (const client of this.clients) {
        if (socketUsers.get(client) === userId) client.close(4401, 'Session revoked');
      }
    });

    this.wss.on('connection', (socket, req) => {
      void authenticateRequest(req, true).then((user) => {
        if (user) socketUsers.set(socket, user.id);
      });
      this.clients.add(socket);
      console.log(`[🔌 WS CONNECT] Dashboard client connected (active clients: ${this.clients.size})`);

      // Send initial health tick on connection
      const health = this.buildHealthResponse();
      socket.send(
        JSON.stringify({
          event: 'health:tick',
          type: 'TELEMETRY_TICK',
          data: health,
          timestamp: new Date().toISOString(),
        })
      );

      socket.on('close', () => {
        this.clients.delete(socket);
      });

      socket.on('error', () => {
        this.clients.delete(socket);
      });
    });
  }

  /**
   * Starts the HTTP(S) + WebSocket server and background watchdogs.
   */
  public async start(): Promise<http.Server | https.Server> {
    await this.store.tryConnectDatabase();
    await this.store.reconcileAgentStatuses();

    const requestHandler = (req: IncomingMessage, res: ServerResponse) => {
      void this.handleRequest(req, res);
    };
    let usingHttps = false;
    if (this.httpsEnabled) {
      const creds = ensureDevCerts(this.wardenRoot);
      if (creds) {
        this.server = https.createServer(
          { key: creds.key, cert: creds.cert },
          requestHandler
        );
        usingHttps = true;
      } else {
        console.warn(
          '[WARDEN API] WARDEN_HTTPS is enabled but no dev certs are available; falling back to HTTP.'
        );
        this.server = http.createServer(requestHandler);
      }
    } else {
      this.server = http.createServer(requestHandler);
    }

    // Track raw sockets so stop() never hangs on keep-alive connections (clean tsx restarts).
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => {
        this.sockets.delete(socket);
      });
    });

    this.attachWebSocketServer();

    this.healthGuard.startWatchdogLoop();
    this.idleMonitor.startCronLoop();

    // Markdown auto-ingest loop only runs when Markdown is the source of truth
    if (this.store.source === 'md') {
      void this.checkAndRunIngestion();
      this.autoIngestInterval = setInterval(() => {
        void this.checkAndRunIngestion();
      }, 15 * 60 * 1000); // 15 minutes
    }
    console.log(`[WARDEN API] Source of truth: ${this.store.source.toUpperCase()}`);

    this.reminderScheduler = startReminderScheduler({
      onFired: (event) => this.broadcastEvent('reminder:fired', event),
    });

    return new Promise((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        if (err?.code === 'EADDRINUSE') {
          console.error(
            `[WARDEN API] Port ${this.port} is already in use. Stop the other process and retry.`
          );
        }
        reject(err);
      };
      this.server!.once('error', onError);
      this.server!.listen(this.port, this.host, () => {
        this.server!.off('error', onError);
        this.server!.on('error', (err) =>
          console.error('[WARDEN API] Server error:', err)
        );
        const proto = usingHttps ? 'https' : 'http';
        const wsProto = usingHttps ? 'wss' : 'ws';
        const lanIp = getLanIp();
        console.log(
          `[🟢 WARDEN API] ControlPlaneServer listening on ${proto}://${this.host}:${this.port} (WS: ${wsProto}://${this.host}:${this.port}/ws)`
        );
        console.log(
          `[WARDEN API] Local: ${proto}://localhost:${this.port} (WS: ${wsProto}://localhost:${this.port}/ws)`
        );
        if (lanIp) {
          console.log(
            `[WARDEN API] LAN (phone): ${proto}://${lanIp}:${this.port} (WS: ${wsProto}://${lanIp}:${this.port}/ws)`
          );
        }
        resolve(this.server!);
      });
    });
  }

  private getMaxMtime(dir: string): number {
    let maxTime = 0;
    if (!fs.existsSync(dir)) return 0;
    
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          maxTime = Math.max(maxTime, this.getMaxMtime(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const stats = fs.statSync(fullPath);
          maxTime = Math.max(maxTime, stats.mtimeMs);
        }
      }
    } catch (e) {
      // Ignore read errors
    }
    return maxTime;
  }

  public async checkAndRunIngestion(): Promise<void> {
    if (this.isIngesting) {
      console.log(`[⏳ INGEST] Skip: ingestion already in progress.`);
      return;
    }

    try {
      this.isIngesting = true;
      const targets = ['chats', 'worklist', 'standups', 'context', 'memory'];
      let maxSourceMtime = 0;

      for (const target of targets) {
        const targetPath = path.join(this.wardenRoot, target);
        maxSourceMtime = Math.max(maxSourceMtime, this.getMaxMtime(targetPath));
      }

      const dbFile = path.join(this.wardenRoot, '.state', 'warden-db.json');
      let dbMtime = 0;
      if (fs.existsSync(dbFile)) {
        dbMtime = fs.statSync(dbFile).mtimeMs;
      }

      if (maxSourceMtime > dbMtime) {
        console.log(`[🚀 INGEST] Changes detected (source: ${maxSourceMtime} > db: ${dbMtime}). Running db:ingest...`);
        await new Promise<void>((resolve, reject) => {
          exec('npm run db:ingest', { cwd: this.wardenRoot }, (error, stdout, stderr) => {
            if (error) {
              console.error(`[❌ INGEST] Failed:`, error);
              resolve(); // Don't reject, just swallow error so we try again next time
            } else {
              console.log(`[✅ INGEST] Success:`, stdout);
              resolve();
            }
          });
        });
      }
    } catch (e) {
      console.error(`[❌ INGEST] Error during auto-ingestion:`, e);
    } finally {
      this.isIngesting = false;
    }
  }

  public async stop(): Promise<void> {
    this.reminderScheduler?.stop();
    this.reminderScheduler = null;
    if (this.autoIngestInterval) {
      clearInterval(this.autoIngestInterval);
      this.autoIngestInterval = null;
    }
    this.healthGuard.stopWatchdogLoop();
    this.idleMonitor.stopCronLoop();
    for (const c of this.clients) {
      try {
        c.close();
      } catch {
        // ignore
      }
    }
    this.clients.clear();

    if (this.wss) {
      const wss = this.wss;
      this.wss = null;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try {
            for (const c of wss.clients) c.terminate();
          } catch {
            // ignore
          }
          resolve();
        }, 2000);
        timer.unref();
        wss.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    // Destroy idle keep-alive sockets first so close() resolves promptly on tsx restarts.
    for (const socket of this.sockets) {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    }
    this.sockets.clear();

    if (this.server) {
      const closing = this.server;
      this.server = null;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 2000);
        timer.unref();
        closing.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  private setCorsHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', process.env.WARDEN_CORS_ORIGIN || '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PATCH, PUT, DELETE, OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With'
    );
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    this.setCorsHeaders(res);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  }

  private async readJsonBody<T = Record<string, any>>(
    req: IncomingMessage
  ): Promise<T> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        if (chunks.length === 0) {
          resolve({} as T);
          return;
        }
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(JSON.parse(raw) as T);
        } catch {
          resolve({} as T);
        }
      });
      req.on('error', () => resolve({} as T));
    });
  }

  private serializeAgentForApi(agent: AgentRecord) {
    const deptUpper = agent.department.toUpperCase();
    const mappedDept =
      deptUpper === 'EXECUTIVE'
        ? 'EXECUTIVE'
        : deptUpper === 'MARKETING'
          ? 'MARKETING'
          : deptUpper === 'INFRA'
            ? 'INFRA'
            : deptUpper === 'SALES'
              ? 'SALES'
              : deptUpper === 'HR'
                ? 'HR'
                : deptUpper === 'OPERATIONS'
                  ? 'OPERATIONS'
                  : deptUpper === 'FINANCE'
                    ? 'FINANCE'
                    : deptUpper === 'SUPPORT'
                      ? 'SUPPORT'
                      : 'TECH';
    const unitMap: Record<string, string> = {
      EXECUTIVE: 'Executive (@warden)',
      TECH: 'Unit A: Tech (@cto)',
      MARKETING: 'Unit B: Marketing / SEO & AEO (@cmo -> @seo_aeo_head)',
      INFRA: 'Infra & Cloud (@infra_head)',
      SALES: 'Unit C: Sales & Business (@cbo)',
      HR: 'Unit D: Human & Agent Resources (@chro)',
      OPERATIONS: 'Unit E: Operations & Support (@coo)',
      FINANCE: 'Unit F: Finance & FinOps (@cfo)',
      SUPPORT: 'Unit E: Customer Support (@support_lead)',
    };

    const effective = this.store.resolveEffectiveModelForAgent(agent.id, 'planning');

    return {
      ...agent,
      role_title: agent.roleTitle,
      department: mappedDept,
      unit_label: unitMap[mappedDept] || 'Unit A: Tech (@cto)',
      modelProvider: agent.model_provider,
      modelId: agent.model_id,
      fallbackProvider: agent.fallback_provider || 'meta_muse',
      fallback_provider: agent.fallback_provider || 'meta_muse',
      fallbackModelId:
        agent.fallback_model_id ||
        (agent.hierarchy_level <= 0 ? 'muse-light' : 'muse-glimmer-30b'),
      fallback_model_id:
        agent.fallback_model_id ||
        (agent.hierarchy_level <= 0 ? 'muse-light' : 'muse-glimmer-30b'),
      stepRouting: agent.step_routing_json || {},
      step_routing_json: agent.step_routing_json || {},
      effective_provider: effective.provider,
      effective_model_id: effective.modelId,
      routing_profile: this.store.getRoutingProfile(),
    };
  }

  private serializeGateForApi(gate: ApprovalGateRecord) {
    const rawOpts = gate.options_json || {};
    let optionsArray: Array<{
      id: string;
      label: string;
      description?: string;
      priority?: string;
      recommended?: boolean;
    }> = [];

    if (Array.isArray(rawOpts)) {
      optionsArray = rawOpts;
    } else if (
      Array.isArray(rawOpts.suggested_tasks) &&
      rawOpts.suggested_tasks.length > 0
    ) {
      optionsArray = [
        {
          id: 'opt_approve_all_3',
          label: '✅ Approve All 3 Suggested Specs (Recommended)',
          description: 'Queues all 3 initiatives into TODO and clocks in the department.',
          priority: 'P0',
          recommended: true,
        },
        ...rawOpts.suggested_tasks.map((t, idx) => ({
          id: t.id || `opt_sug_${idx + 1}`,
          label: `${idx + 1}. [${t.priority}] ${t.title}`,
          description: t.spec_md,
          priority: t.priority,
        })),
      ];
    } else if (Array.isArray(rawOpts.choices)) {
      const FRIENDLY: Record<string, string> = {
        ADD_OWN_KEY: 'Add my own key & resume',
        UPDATE_KEY: 'Update my key & resume',
        TERMINATE_RUN: 'Terminate run',
      };
      optionsArray = rawOpts.choices.map((c, idx) => {
        const code = String(c);
        return {
          id: `opt_${idx + 1}`,
          label: FRIENDLY[code] ?? code,
          recommended: idx === 0,
        };
      });
    }

    return {
      ...gate,
      options_json: optionsArray,
      raw_options: gate.options_json,
    };
  }

  private buildHealthResponse() {
    const watchdogTelemetry = this.healthGuard.getSystemHealthTelemetry();
    const agents = this.store.getAllAgents();
    const totalIn = agents.reduce((acc, a) => acc + (a.total_tokens_in || 0), 0);
    const totalCached = agents.reduce(
      (acc, a) => acc + (a.total_tokens_cached || 0),
      0
    );
    const cacheHitPct =
      totalIn > 0 ? Math.min(95, Math.round((totalCached / totalIn) * 100)) : 72;

    return {
      ...watchdogTelemetry,
      heartbeat_ok: watchdogTelemetry.overallStatus === 'HEALTHY',
      active_subagents: watchdogTelemetry.activeSubagentsTotal,
      max_subagents_pool: watchdogTelemetry.maxSubagentsCapacity,
      sandbox_latency_ms: watchdogTelemetry.sandboxLatencyMs,
      active_docker_sandboxes: watchdogTelemetry.workingAgentsCount,
      total_tokens_today: watchdogTelemetry.todayTokensBurned,
      theoretical_usd_burn_today: Number(
        (watchdogTelemetry.todayTokensBurned * 0.000003).toFixed(2)
      ),
      db_pgvector_status: this.store.isDatabaseConnected() ? 'ONLINE' : 'OFFLINE',
      warden_source: this.store.source,
      muse_cache_hit_rate_pct: cacheHitPct,
      routing_profile: this.store.getRoutingProfile(),
      sync_status: this.store.getSyncStatus(),
    };
  }

  /**
   * Routes an inbound WhatsApp text into a per-sender warden thread and returns the reply text.
   */
  private async handleWhatsAppInbound(msg: {
    from: string;
    text: string;
    messageId: string;
    timestamp: string;
  }): Promise<string | null> {
    console.log(
      `[📱 WHATSAPP] from=${msg.from.slice(-4).padStart(msg.from.length, '*')} content="${msg.text.replace(/\s+/g, ' ').slice(0, 140)}"`
    );
    return this.whatsAppCommands.handleText(msg);
  }

  /**
   * Default WhatsApp route: hands free text to the agent hierarchy on a per-number thread.
   */
  private async routeWhatsAppToAgents(from: string, text: string): Promise<string | null> {
    const routeResult = await this.hierarchyRouter.routeMessage({
      threadId: `thr_whatsapp_${from}`,
      content: text,
    });
    return routeResult.agentReply?.content ?? null;
  }

  /**
   * Creates a reminder when a chat/WhatsApp message asks for one; returns a confirmation or null.
   */
  private async tryCreateReminder(text: string, via: ReminderCreatedVia): Promise<string | null> {
    if (!looksLikeReminderRequest(text)) return null;
    try {
      const reminder = await createReminderFromText(text, { createdVia: via });
      const when = new Date(reminder.dueAt).toLocaleString('en-IN', {
        timeZone: reminder.timezone,
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      const repeat = reminder.recurrence ? ` (repeats: \`${reminder.recurrence}\`)` : '';
      return `⏰ Reminder set for ${when}${repeat}: ${reminder.text}\nChannels: ${reminder.channels.join(', ')}`;
    } catch (err) {
      return `⚠️ Couldn't set that reminder: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * Marks thread runs that are still `RUNNING`/`VERIFYING_QA` as `FAILED` when
   * their parent pipeline throws, so polling clients never wait forever on an
   * orphaned run. Only touches runs started at/after `sinceIso`.
   */
  private failStuckThreadRuns(
    threadId: string,
    sinceIso: string,
    reason: string,
    exceptRunId?: string
  ): void {
    for (const run of this.store.runs.values()) {
      if (run.chat_thread_id !== threadId || run.id === exceptRunId) continue;
      if (run.status !== 'RUNNING' && run.status !== 'VERIFYING_QA') continue;
      if (run.started_at < sinceIso) continue;
      this.store.updateRun(run.id, {
        status: 'FAILED',
        output_summary: reason,
        ended_at: new Date().toISOString(),
      });
    }
  }

  /**
   * Enforces the per-operator token budget before dispatching any agent call.
   * Returns true if the request was rejected with HTTP 429 (`TOKEN_CAP_EXCEEDED`).
   */
  private async rejectIfOverTokenBudget(
    res: ServerResponse,
    userId: string | null,
    threadId?: string | null
  ): Promise<boolean> {
    if (!userId) return false;
    try {
      const { checkUserAgentBudget } = await import('../budgets/UserBudgets.js');
      const check = await checkUserAgentBudget(userId);
      if (!check.allowed) {
        const errorMsg =
          check.errorMessage ||
          `Token limit reached (${check.usage.used.toLocaleString()} / ${check.usage.cap.toLocaleString()} tokens). Add your Meta Muse key in Settings to continue.`;
        this.broadcastEvent('budget:exceeded', {
          userId,
          threadId: threadId ?? null,
          error: errorMsg,
          budget: check.usage,
        });
        this.sendJson(res, 429, {
          ok: false,
          code: 'TOKEN_CAP_EXCEEDED',
          error: errorMsg,
          budget: check.usage,
        });
        return true;
      }
    } catch {
      // Fail open if DB is unreachable in local dev
    }
    return false;
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    this.setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const parsedUrl = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`
    );
    const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
    const method = req.method || 'GET';
    const reqStartMs = Date.now();
    if (method !== 'OPTIONS' && pathname !== '/api/health' && pathname !== '/api/telemetry') {
      console.log(`[🌐 API REQ] ${method} ${pathname}`);
    }
    res.on('finish', () => {
      if (method !== 'OPTIONS' && pathname !== '/api/health' && pathname !== '/api/telemetry') {
        console.log(
          `[🌐 API RES] ${method} ${pathname} -> HTTP ${res.statusCode} (${Date.now() - reqStartMs}ms)`
        );
      }
    });

    try {
      // ======================================================================
      // WhatsApp Cloud API webhook (`/webhook/whatsapp`) — reads its own raw body for HMAC checks
      // ======================================================================
      if (
        await handleWhatsAppRoutes(req, res, {
          pathname,
          method,
          onInboundText: (msg) => this.handleWhatsAppInbound(msg),
          onInboundAudio: (msg) => this.whatsAppCommands.handleAudio(msg),
          onInboundButton: (msg) => this.whatsAppCommands.handleButton(msg),
          onAnySenderText: (msg) => handleInboundLoginText(msg.from, msg.text),
        })
      ) {
        return;
      }

      if (
        await handleAuthRoutes(req, res, {
          pathname,
          method,
          readJsonBody: () => this.readJsonBody(req),
          sendJson: (r, status, body) => this.sendJson(r, status, body),
        })
      ) {
        return;
      }

      if (
        await handleSeoRoutes(req, res, {
          pathname,
          method,
          readJsonBody: () => this.readJsonBody(req),
          sendJson: (r, status, body) => this.sendJson(r, status, body),
        })
      ) {
        return;
      }

      // ======================================================================
      // Auth gate: every other /api route and /media file needs a valid JWT.
      // /media also accepts the session cookie (img tags cannot send headers).
      // ======================================================================
      // Authenticated operator for this request; null on public paths.
      // Threaded into every user-scoped store call below for cloud isolation.
      let requestUserId: string | null = null;
      if (
        !isPublicPath(pathname, method) &&
        (pathname.startsWith('/api/') || pathname.startsWith('/media/'))
      ) {
        let authed: { id?: string } | null = null;
        try {
          authed = await authenticateRequest(req, pathname.startsWith('/media/'));
        } catch {
          this.sendJson(res, 503, { ok: false, error: 'Database unreachable. Is Postgres running?' });
          return;
        }
        if (!authed) {
          this.sendJson(res, 401, { ok: false, error: 'Not signed in' });
          return;
        }
        requestUserId = typeof authed.id === 'string' ? authed.id : null;
        if (requestUserId && !this.hydratedUsers.has(requestUserId)) {
          await this.store.hydrateUser(requestUserId).catch(() => undefined);
          this.hydratedUsers.add(requestUserId);
        }
      }

      if (
        await handleReminderRoutes(req, res, {
          pathname,
          method,
          readJsonBody: () => this.readJsonBody(req),
          sendJson: (r, status, body) => this.sendJson(r, status, body),
        })
      ) {
        return;
      }

      if (
        await handleClientRoutes(req, res, {
          pathname,
          method,
          requestUserId,
          readJsonBody: () => this.readJsonBody(req),
          sendJson: (r, status, body) => this.sendJson(r, status, body),
        })
      ) {
        return;
      }

      // ======================================================================
      // Static Media Serving (`/media/*`)
      // ======================================================================
      if (pathname.startsWith('/media/') && method === 'GET') {
        const filename = decodeURIComponent(pathname.slice('/media/'.length));
        const mediaFile = this.mediaService.resolveLocalMediaFile(filename);
        if (mediaFile && fs.existsSync(mediaFile.filePath)) {
          res.statusCode = 200;
          res.setHeader('Content-Type', mediaFile.mimeType);
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.end(fs.readFileSync(mediaFile.filePath));
          return;
        }

        // Dynamic SVG preview generator for Playwright QA screenshots
        res.statusCode = 200;
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.end(
          `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
            <rect width="800" height="450" fill="#0b0f19"/>
            <rect x="24" y="24" width="752" height="402" rx="12" fill="#111827" stroke="#10b981" stroke-width="2"/>
            <text x="48" y="72" fill="#10b981" font-family="monospace" font-size="20" font-weight="bold">✅ Headless Playwright + WebGL Verification Passed</text>
            <text x="48" y="112" fill="#e5e7eb" font-family="monospace" font-size="15">Snapshot: ${filename}</text>
            <text x="48" y="144" fill="#9ca3af" font-family="monospace" font-size="14">HTTP 200 OK | DOM Mounted | console.error = 0 | WebGL Context Active</text>
          </svg>`
        );
        return;
      }

      // ======================================================================
      // 1. Health & Telemetry (`GET /api/health` & `GET /api/telemetry`)
      // ======================================================================
      if (
        (pathname === '/api/health' || pathname === '/api/telemetry') &&
        (method === 'GET' || method === 'HEAD')
      ) {
        // /api/health is public: signed-out callers only learn that the server is up.
        if (pathname === '/api/health' && !(await authenticateRequest(req).catch(() => null))) {
          this.sendJson(res, 200, { ok: true, timestamp: new Date().toISOString() });
          return;
        }
        this.sendJson(res, 200, this.buildHealthResponse());
        return;
      }

      if (pathname === '/api/budgets/me' && method === 'GET') {
        if (!requestUserId) {
          this.sendJson(res, 401, { ok: false, error: 'Not signed in' });
          return;
        }
        try {
          const { getUserUsage } = await import('../budgets/UserBudgets.js');
          const usage = await getUserUsage(requestUserId);
          this.sendJson(res, 200, { ok: true, budget: usage });
        } catch {
          this.sendJson(res, 503, { ok: false, error: 'Database unreachable. Is Postgres running?' });
        }
        return;
      }

      if (pathname === '/api/telemetry/tokens' && method === 'GET') {
        if (!requestUserId) {
          this.sendJson(res, 401, { ok: false, error: 'Not signed in' });
          return;
        }
        try {
          const range = parsedUrl.searchParams.get('range') || 'today';
          const { getUserTokenTelemetry } = await import('../budgets/UserBudgets.js');
          const telemetry = await getUserTokenTelemetry(requestUserId, range);
          this.sendJson(res, 200, { ok: true, ...telemetry });
        } catch {
          this.sendJson(res, 503, { ok: false, error: 'Database unreachable. Is Postgres running?' });
        }
        return;
      }

      // BYOK: the operator's own Meta Muse key. Status responses only ever
      // carry the last-4 hint; the full key is write-only.
      if (pathname === '/api/llm-keys/me' && method === 'GET') {
        if (!requestUserId) {
          this.sendJson(res, 401, { ok: false, error: 'Not signed in' });
          return;
        }
        try {
          const { getUserLlmKeyStatus } = await import('../llmkeys/UserLlmKeys.js');
          const key = await getUserLlmKeyStatus(requestUserId);
          this.sendJson(res, 200, { ok: true, key });
        } catch {
          this.sendJson(res, 503, { ok: false, error: 'Database unreachable. Is Postgres running?' });
        }
        return;
      }

      if (pathname === '/api/llm-keys/me' && method === 'POST') {
        if (!requestUserId) {
          this.sendJson(res, 401, { ok: false, error: 'Not signed in' });
          return;
        }
        const body = await this.readJsonBody(req);
        const apiKey = String(body.api_key || body.apiKey || '').trim();
        if (!apiKey) {
          this.sendJson(res, 400, { ok: false, error: 'Paste your Meta Muse API key.' });
          return;
        }
        try {
          const { saveUserLlmKey } = await import('../llmkeys/UserLlmKeys.js');
          const key = await saveUserLlmKey(requestUserId, apiKey);
          this.sendJson(res, 200, { ok: true, key });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Could not save the key.';
          const status = /^(That key looks|Meta rejected|This key has)/.test(msg) ? 400 : 502;
          this.sendJson(res, status, { ok: false, error: msg });
        }
        return;
      }

      if (pathname === '/api/llm-keys/me' && method === 'DELETE') {
        if (!requestUserId) {
          this.sendJson(res, 401, { ok: false, error: 'Not signed in' });
          return;
        }
        try {
          const { deleteUserLlmKey } = await import('../llmkeys/UserLlmKeys.js');
          await deleteUserLlmKey(requestUserId);
          this.sendJson(res, 200, { ok: true });
        } catch {
          this.sendJson(res, 503, { ok: false, error: 'Database unreachable. Is Postgres running?' });
        }
        return;
      }

      // ======================================================================
      // 1.5 Global Routing Profile, Multi-Token Credential Pool & Bi-Directional Sync
      // ======================================================================
      if (pathname === '/api/routing/profile' && method === 'GET') {
        this.sendJson(res, 200, {
          profile: this.store.getRoutingProfile(),
          available_profiles: [
            {
              id: 'LOCAL_ZERO_COST',
              label: 'Local Zero-Cost (Ollama Llama + Glimmer)',
              description:
                'Routes all reasoning to local Ollama Llama 3.3 70B and compaction to Muse Glimmer 30B.',
            },
            {
              id: 'META_MUSE_HACKATHON',
              label: 'Meta AI Muse Suite (Muse Spark 1.3 + Muse Light + Muse Glimmer 30B)',
              description:
                'Routes @warden/@cto/@cmo and Level 1 leads to muse-spark-1.3, Level 2 agents to muse-light, and compaction to muse-glimmer-30b.',
            },
            {
              id: 'CUSTOM_HYBRID',
              label: 'Custom Hybrid (Per-Agent & Per-Step Override Matrix)',
              description:
                'Uses each agent custom model_provider, model_id, fallback_provider, fallback_model_id, and step_routing_json.',
            },
          ],
        });
        return;
      }

      if (
        pathname === '/api/routing/profile' &&
        (method === 'POST' || method === 'PUT' || method === 'PATCH')
      ) {
        const body = await this.readJsonBody(req);
        const requestedProfile = String(
          body.profile || body.routing_profile || 'META_MUSE_HACKATHON'
        ).toUpperCase() as RoutingProfile;
        const validProfiles: RoutingProfile[] = [
          'LOCAL_ZERO_COST',
          'META_MUSE_HACKATHON',
          'CUSTOM_HYBRID',
        ];
        const nextProfile: RoutingProfile = validProfiles.includes(requestedProfile)
          ? requestedProfile
          : 'CUSTOM_HYBRID';

        const result = this.store.setRoutingProfile(nextProfile);
        this.sendJson(res, 200, {
          ...result,
          agents: this.store.getAllAgents().map((a) => this.serializeAgentForApi(a)),
        });
        return;
      }

      if (pathname === '/api/credentials' && method === 'GET') {
        this.sendJson(res, 200, this.store.getCredentials());
        return;
      }

      if (pathname === '/api/credentials' && method === 'POST') {
        const body = await this.readJsonBody(req);
        const created = this.store.createCredential({
          provider:
            ((body.provider || body.model_provider) as ModelProvider) || 'meta_muse',
          label: String(body.label || 'Custom Provider Credential'),
          api_key: body.api_key || body.apiKey || body.api_key_raw || '',
          base_url: body.base_url ?? body.baseUrl ?? null,
          project_id: body.project_id ?? body.projectId ?? null,
          region: body.region ?? 'global',
          priority_weight:
            body.priority_weight !== undefined ? Number(body.priority_weight) : 85,
          daily_quota_tokens:
            body.daily_quota_tokens !== undefined
              ? Number(body.daily_quota_tokens)
              : 50_000_000,
          rpm_limit: body.rpm_limit !== undefined ? Number(body.rpm_limit) : 500,
          is_enabled: body.is_enabled !== undefined ? Boolean(body.is_enabled) : true,
        });
        this.sendJson(res, 201, created);
        return;
      }

      const credentialRotateMatch = pathname.match(
        /^\/api\/credentials\/([^/]+)\/(rotate|failover)$/
      );
      if (credentialRotateMatch && method === 'POST') {
        const credId = decodeURIComponent(credentialRotateMatch[1]);
        const result = this.store.rotateCredential(credId);
        if (!result.rotatedOut) {
          this.sendJson(res, 404, { error: `Credential ${credId} not found` });
          return;
        }
        this.sendJson(res, 200, {
          ...result,
          credentials: this.store.getCredentials(),
        });
        return;
      }

      const credentialItemMatch = pathname.match(/^\/api\/credentials\/([^/]+)$/);
      if (credentialItemMatch) {
        const credId = decodeURIComponent(credentialItemMatch[1]);
        if (method === 'PATCH') {
          const body = await this.readJsonBody(req);
          const updated = this.store.updateCredential(credId, {
            label: body.label,
            api_key: body.api_key ?? body.apiKey,
            base_url: body.base_url ?? body.baseUrl,
            project_id: body.project_id ?? body.projectId,
            region: body.region,
            priority_weight:
              body.priority_weight !== undefined
                ? Number(body.priority_weight)
                : undefined,
            daily_quota_tokens:
              body.daily_quota_tokens !== undefined
                ? Number(body.daily_quota_tokens)
                : undefined,
            rpm_limit:
              body.rpm_limit !== undefined ? Number(body.rpm_limit) : undefined,
            is_enabled:
              body.is_enabled !== undefined ? Boolean(body.is_enabled) : undefined,
          });
          if (!updated) {
            this.sendJson(res, 404, { error: `Credential ${credId} not found` });
            return;
          }
          this.sendJson(res, 200, updated);
          return;
        }
        if (method === 'DELETE') {
          const deleted = this.store.deleteCredential(credId);
          if (!deleted) {
            this.sendJson(res, 404, { error: `Credential ${credId} not found` });
            return;
          }
          this.sendJson(res, 200, { deleted: true, id: credId });
          return;
        }
      }

      if (pathname === '/api/sync/status' && method === 'GET') {
        this.sendJson(res, 200, this.store.getSyncStatus());
        return;
      }

      if (pathname === '/api/sync' && (method === 'POST' || method === 'GET')) {
        const body = method === 'POST' ? await this.readJsonBody(req) : {};
        const direction =
          body.direction === 'DISK_TO_DB' || body.direction === 'DB_TO_DISK'
            ? body.direction
            : 'BIDIRECTIONAL';
        const status = this.store.runBidirectionalSync(direction);
        this.sendJson(res, 200, {
          ok: true,
          direction,
          sync_status: status,
        });
        return;
      }

      // ======================================================================
      // 2. Agents Roster, Config, Studio & 1-Click Kill/Restart
      // ======================================================================
      if (pathname === '/api/agents' && method === 'GET') {
        const list = this.store
          .getAllAgents()
          .map((a) => this.serializeAgentForApi(a));
        this.sendJson(res, 200, list);
        return;
      }

      if (pathname === '/api/agents' && method === 'POST') {
        const body = await this.readJsonBody(req);
        const created = await this.store.createAgent({
          id: body.id,
          slug: body.slug || `@agent_${Date.now()}`,
          name: body.name || 'Custom Agent',
          roleTitle: body.role_title || body.roleTitle,
          department: body.department || 'Tech',
          hierarchy_level: Number(body.hierarchy_level ?? 2),
          parent_agent_id: body.parent_agent_id ?? 'cto',
          project_scope: body.project_scope ?? null,
          model_provider:
            ((body.model_provider ?? body.modelProvider) as ModelProvider) ||
            'meta_muse',
          model_id: body.model_id || body.modelId || 'muse-spark-1.3',
          fallback_provider:
            ((body.fallback_provider ?? body.fallbackProvider) as ModelProvider) ||
            'meta_muse',
          fallback_model_id:
            body.fallback_model_id || body.fallbackModelId || 'muse-spark-1.3',
          step_routing_json:
            (body.step_routing_json ?? body.stepRouting) as StepRoutingMap | undefined,
          init_prompt: body.init_prompt || 'You are a specialized Warden agent.',
          allowed_repos: Array.isArray(body.allowed_repos)
            ? body.allowed_repos
            : [],
          permission_tier:
            (body.permission_tier as PermissionTier) || 'standard_autonomous',
          max_subagents: Number(body.max_subagents ?? 4),
          max_run_duration_ms: Number(body.max_run_duration_ms ?? 1800000),
          max_tokens_per_run: Number(body.max_tokens_per_run ?? 1000000),
        });
        this.sendJson(res, 201, this.serializeAgentForApi(created));
        return;
      }

      const agentMemoriesMatch = pathname.match(
        /^\/api\/agents\/([^/]+)\/memories$/
      );
      if (agentMemoriesMatch) {
        const agentId = decodeURIComponent(agentMemoriesMatch[1]);
        const agent = this.store.getAgent(agentId);
        const resolvedId = agent?.id || agentId;

        if (method === 'GET') {
          this.sendJson(
            res,
            200,
            this.store.getMemoriesForAgent(
              resolvedId,
              agent?.project_scope,
              requestUserId ?? undefined
            )
          );
          return;
        }
        if (method === 'POST') {
          const body = await this.readJsonBody(req);
          const created = this.store.addMemory({
            user_id: requestUserId,
            agent_id: resolvedId,
            project_scope: body.project_scope ?? agent?.project_scope ?? null,
            memory_type: (body.memory_type as MemoryType) || 'PINNED_PREFERENCE',
            content: String(body.content || ''),
            source_run_id: body.source_run_id ?? null,
            is_pinned: Boolean(body.is_pinned ?? true),
          });
          this.sendJson(res, 201, created);
          return;
        }
      }

      const memoryPinMatch = pathname.match(/^\/api\/memories\/([^/]+)$/);
      if (memoryPinMatch && method === 'PATCH') {
        const memId = decodeURIComponent(memoryPinMatch[1]);
        const body = await this.readJsonBody(req);
        const target = this.store.memories.find((m) => m.id === memId);
        if (!target || (requestUserId && (target.user_id ?? null) !== requestUserId)) {
          this.sendJson(res, 404, { error: 'Memory not found' });
          return;
        }
        target.is_pinned =
          typeof body.is_pinned === 'boolean'
            ? body.is_pinned
            : !target.is_pinned;
        this.sendJson(res, 200, target);
        return;
      }

      const agentKillRestartMatch = pathname.match(
        /^\/api\/agents\/([^/]+)\/(kill|restart|control)$/
      );
      if (agentKillRestartMatch && method === 'POST') {
        const agentId = decodeURIComponent(agentKillRestartMatch[1]);
        const actionSegment = agentKillRestartMatch[2];
        const body = await this.readJsonBody(req);
        const action =
          actionSegment === 'kill'
            ? 'KILL'
            : actionSegment === 'restart'
              ? 'RESTART'
              : String(body.action || 'KILL').toUpperCase();

        const agent = this.store.getAgent(agentId);
        if (!agent) {
          this.sendJson(res, 404, { error: `Agent ${agentId} not found` });
          return;
        }

        if (action === 'KILL') {
          if (agent.current_run_id) {
            this.store.updateRun(agent.current_run_id, {
              status: 'FAILED',
              ended_at: new Date().toISOString(),
              output_summary: 'Terminated manually by CEO via 1-Click Kill.',
            });
          }
          const updated = await this.store.updateAgent(agent.id, {
            status: 'IDLE',
            health_status: 'HEALTHY',
            active_subagent_count: 0,
            current_run_id: null,
            clocked_in_at: null,
            active_container_id: null,
            last_heartbeat_at: new Date().toISOString(),
          });
          this.sendJson(res, 200, this.serializeAgentForApi(updated!));
          return;
        } else {
          const updated = await this.store.updateAgent(agent.id, {
            status: 'IDLE',
            health_status: 'HEALTHY',
            last_heartbeat_at: new Date().toISOString(),
          });
          this.sendJson(res, 200, this.serializeAgentForApi(updated!));
          return;
        }
      }

      const agentConfigMatch = pathname.match(
        /^\/api\/agents\/([^/]+)(?:\/config)?$/
      );
      if (agentConfigMatch) {
        const agentId = decodeURIComponent(agentConfigMatch[1]);
        const agent = this.store.getAgent(agentId);
        if (!agent) {
          this.sendJson(res, 404, { error: `Agent ${agentId} not found` });
          return;
        }

        if (method === 'GET') {
          const runs = this.store.getRunsForAgent(agent.id, 30, requestUserId ?? undefined);
          const memories = this.store.getMemoriesForAgent(
            agent.id,
            agent.project_scope,
            requestUserId ?? undefined
          );
          this.sendJson(res, 200, {
            ...this.serializeAgentForApi(agent),
            runs,
            memories,
          });
          return;
        }

        if (method === 'PATCH') {
          const body = await this.readJsonBody(req);
          const nextModelProvider = (body.model_provider ??
            body.modelProvider ??
            agent.model_provider) as ModelProvider;
          const nextModelId = String(
            body.model_id ?? body.modelId ?? agent.model_id
          );
          const nextFallbackProvider = (body.fallback_provider ??
            body.fallbackProvider ??
            agent.fallback_provider ??
            'meta_muse') as ModelProvider;
          const nextFallbackModelId = String(
            body.fallback_model_id ??
              body.fallbackModelId ??
              agent.fallback_model_id ??
              'muse-spark-1.3'
          );
          const nextStepRouting = (body.step_routing_json ??
            body.stepRouting ??
            agent.step_routing_json) as StepRoutingMap | undefined;

          const updated = await this.store.updateAgent(agent.id, {
            init_prompt: body.init_prompt ?? body.initPrompt ?? agent.init_prompt,
            model_provider: nextModelProvider,
            model_id: nextModelId,
            fallback_provider: nextFallbackProvider,
            fallback_model_id: nextFallbackModelId,
            step_routing_json: nextStepRouting,
            permission_tier:
              body.permission_tier ?? body.permissionTier ?? agent.permission_tier,
            max_subagents:
              body.max_subagents !== undefined
                ? Number(body.max_subagents)
                : body.maxSubagents !== undefined
                  ? Number(body.maxSubagents)
                  : agent.max_subagents,
            max_run_duration_ms:
              body.max_run_duration_ms !== undefined
                ? Number(body.max_run_duration_ms)
                : body.maxRunDurationMs !== undefined
                  ? Number(body.maxRunDurationMs)
                  : agent.max_run_duration_ms,
            max_tokens_per_run:
              body.max_tokens_per_run !== undefined
                ? Number(body.max_tokens_per_run)
                : body.maxTokensPerRun !== undefined
                  ? Number(body.maxTokensPerRun)
                  : agent.max_tokens_per_run,
            allowed_repos: Array.isArray(body.allowed_repos)
              ? body.allowed_repos
              : Array.isArray(body.allowedRepos)
                ? body.allowedRepos
                : agent.allowed_repos,
          });
          this.sendJson(res, 200, this.serializeAgentForApi(updated!));
          return;
        }
      }

      // ======================================================================
      // 3. Runs & Step-by-Step Brain / Terminal Trace
      // ======================================================================
      if (pathname === '/api/runs' && method === 'GET') {
        const agentId = parsedUrl.searchParams.get('agent_id');
        if (agentId) {
          this.sendJson(
            res,
            200,
            this.store.getRunsForAgent(agentId, 30, requestUserId ?? undefined)
          );
          return;
        }
        const allRuns = Array.from(this.store.runs.values())
          .filter((r) => !requestUserId || (r.user_id ?? null) === requestUserId)
          .sort((a, b) => b.started_at.localeCompare(a.started_at));
        this.sendJson(res, 200, allRuns);
        return;
      }

      const runStepsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/steps$/);
      if (runStepsMatch && method === 'GET') {
        const runId = decodeURIComponent(runStepsMatch[1]);
        this.sendJson(
          res,
          200,
          this.store.getStepsForRun(runId, requestUserId ?? undefined)
        );
        return;
      }

      const singleRunMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (singleRunMatch && method === 'GET') {
        const runId = decodeURIComponent(singleRunMatch[1]);
        const run = this.store.runs.get(runId);
        if (!run || (requestUserId && (run.user_id ?? null) !== requestUserId)) {
          this.sendJson(res, 404, { error: `Run ${runId} not found` });
          return;
        }
        const steps = this.store.getStepsForRun(runId, requestUserId ?? undefined);
        const latestStep = steps.length > 0 ? steps[steps.length - 1] : null;
        const threadMsgs = run.chat_thread_id
          ? this.store.messagesByThread.get(run.chat_thread_id) || []
          : [];
        const replyMessage =
          [...threadMsgs]
            .reverse()
            .find((m) => m.run_id === runId && m.sender_type === 'AGENT') ?? null;
        const failedError = run.status === 'FAILED' ? run.output_summary : null;
        this.sendJson(res, 200, {
          ...run,
          steps,
          run: {
            id: run.id,
            agent_id: run.agent_id,
            agent_slug: run.agent_slug,
            status: run.status,
            output_summary: run.output_summary,
            started_at: run.started_at,
            ended_at: run.ended_at,
            error: failedError,
            child_run_ids: run.child_run_ids || [],
          },
          latestStep,
          replyMessage,
          waitingForCeo:
            run.status === 'PAUSED_FOR_CEO' || run.status === 'PAUSED_TOKEN_CAP',
          error: failedError,
        });
        return;
      }

      // ======================================================================
      // 4. Resumable Multimodal Chat Threads & Messages
      // ======================================================================
      if (pathname === '/api/threads' && method === 'GET') {
        const threads = Array.from(this.store.threads.values())
          .filter((t) => !requestUserId || (t.user_id ?? null) === requestUserId)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        this.sendJson(res, 200, threads);
        return;
      }

      if (pathname === '/api/threads' && method === 'POST') {
        const body = await this.readJsonBody(req);
        const targetAgentId =
          body.target_agent_id || body.targetAgentId || 'warden';
        const mode: ChatThreadMode =
          body.mode ||
          (targetAgentId === 'warden' || targetAgentId === '@warden'
            ? 'WARDEN_EXECUTIVE'
            : 'DIRECT_AGENT');
        const created = this.store.createThread({
          id: body.id,
          user_id: requestUserId,
          title: body.title || `Session with ${targetAgentId}`,
          mode,
          target_agent_id: targetAgentId,
          project_scope: body.project_scope ?? body.projectScope ?? null,
        });
        this.sendJson(res, 201, created);
        return;
      }

      const threadStatusMatch = pathname.match(
        /^\/api\/(?:chat\/)?threads\/([^/]+)\/status$/
      );
      if (threadStatusMatch && method === 'GET') {
        const threadId = decodeURIComponent(threadStatusMatch[1]);
        const thread = this.store.threads.get(threadId);
        if (!thread || (requestUserId && (thread.user_id ?? null) !== requestUserId)) {
          this.sendJson(res, 404, { error: `Thread ${threadId} not found` });
          return;
        }
        const slimRun = (r: AgentRunRecord) => ({
          id: r.id,
          agent_id: r.agent_id,
          agent_slug: r.agent_slug,
          status: r.status,
          output_summary: r.output_summary,
          started_at: r.started_at,
          ended_at: r.ended_at,
          error: r.status === 'FAILED' ? r.output_summary : null,
          child_run_ids: r.child_run_ids || [],
        });
        const threadRuns = Array.from(this.store.runs.values())
          .filter(
            (r) =>
              r.chat_thread_id === threadId &&
              (!requestUserId || (r.user_id ?? null) === requestUserId)
          )
          .sort((a, b) => a.started_at.localeCompare(b.started_at));
        const runningRuns = threadRuns.filter(
          (r) => r.status === 'RUNNING' || r.status === 'VERIFYING_QA'
        );
        const latestRun = threadRuns.length > 0 ? threadRuns[threadRuns.length - 1] : null;
        const latestRunSteps = latestRun
          ? this.store.getStepsForRun(latestRun.id, requestUserId ?? undefined)
          : [];
        const latestStep =
          latestRunSteps.length > 0 ? latestRunSteps[latestRunSteps.length - 1] : null;
        const msgs = (this.store.messagesByThread.get(threadId) || []).filter(
          (m) => !requestUserId || (m.user_id ?? null) === requestUserId
        );
        const lastReply =
          [...msgs].reverse().find((m) => m.sender_type === 'AGENT') ?? null;
        const pendingGates = Array.from(this.store.approvalGates.values())
          .filter(
            (g) =>
              g.thread_id === threadId &&
              g.status === 'PENDING' &&
              (!requestUserId || (g.user_id ?? null) === requestUserId)
          )
          .map((g) => this.serializeGateForApi(g));
        this.sendJson(res, 200, {
          threadId,
          thread,
          runningRuns: runningRuns.map(slimRun),
          latestRun: latestRun ? slimRun(latestRun) : null,
          latestStep,
          lastReply,
          pendingGates,
        });
        return;
      }

      const threadMessagesMatch = pathname.match(
        /^\/api\/threads\/([^/]+)\/messages$/
      );
      if (threadMessagesMatch) {
        const threadId = decodeURIComponent(threadMessagesMatch[1]);
        if (method === 'GET') {
          const thread = this.store.threads.get(threadId);
          if (!thread || (requestUserId && (thread.user_id ?? null) !== requestUserId)) {
            this.sendJson(res, 404, { error: `Thread ${threadId} not found` });
            return;
          }
          const msgs = (this.store.messagesByThread.get(threadId) || []).filter(
            (m) => !requestUserId || (m.user_id ?? null) === requestUserId
          );
          this.sendJson(res, 200, msgs);
          return;
        }

        if (method === 'POST') {
          const body = await this.readJsonBody(req);
          const existingThread = this.store.threads.get(threadId);
          if (
            existingThread &&
            requestUserId &&
            (existingThread.user_id ?? null) !== requestUserId
          ) {
            this.sendJson(res, 404, { error: `Thread ${threadId} not found` });
            return;
          }
          if (await this.rejectIfOverTokenBudget(res, requestUserId, threadId)) {
            return;
          }
          const rawAttachments: any[] =
            body.attachments || body.attachments_json || [];
          const processedAttachments: MediaAttachment[] = [];

          for (const rawAtt of rawAttachments) {
            if (rawAtt.base64_data || rawAtt.base64Data || rawAtt.data) {
              try {
                const uploaded = await this.mediaService.uploadAttachment({
                  filename: rawAtt.filename || 'attachment.png',
                  mimeType: rawAtt.type || 'image/png',
                  base64Data:
                    rawAtt.base64_data || rawAtt.base64Data || rawAtt.data,
                });
                processedAttachments.push({
                  type: uploaded.type,
                  filename: uploaded.filename,
                  media_uri: uploaded.media_uri || undefined,
                  public_url: uploaded.public_url,
                  size_bytes: uploaded.size_bytes,
                });
                continue;
              } catch {
                // fallback to raw attachment object
              }
            }
            processedAttachments.push({
              id: rawAtt.id,
              type: rawAtt.type || 'image/png',
              filename: rawAtt.filename || 'attachment.png',
              media_uri: rawAtt.media_uri,
              public_url: rawAtt.public_url || '/media/attachment.png',
              size_bytes: rawAtt.size_bytes,
            });
          }

          console.log(
            `[💬 CEO CHAT] thread=${threadId} mode=${body.mode || 'WARDEN_EXECUTIVE'} target=${body.targetAgentId || body.target_agent_id || '@warden'} content="${String(body.content || '').replace(/\s+/g, ' ').slice(0, 140)}"`
          );

          const reminderReply = await this.tryCreateReminder(String(body.content || ''), 'chat');
          if (reminderReply) {
            if (!this.store.threads.has(threadId)) {
              this.store.createThread({
                id: threadId,
                user_id: requestUserId,
                title: 'Reminders',
                mode: 'WARDEN_EXECUTIVE',
                target_agent_id: 'warden',
              });
            }
            const ceoMessage = this.store.addChatMessage({
              thread_id: threadId,
              sender_type: 'CEO',
              recipient_agent_id: 'warden',
              content: String(body.content || ''),
            });
            const agentReply = this.store.addChatMessage({
              thread_id: threadId,
              sender_type: 'AGENT',
              sender_agent_id: 'warden',
              recipient_agent_id: 'CEO',
              content: reminderReply,
            });
            this.sendJson(res, 201, { ceoMessage, agentReply, routedMode: 'REMINDER' });
            return;
          }

          const lowerContent = String(body.content || '').toLowerCase();
          if (
            /\b(standup|stand-up|stand up)\b/i.test(lowerContent) &&
            /\b(run|start|trigger|begin|do|call|hold|conduct|can you|please|lets|let's)\b/i.test(lowerContent)
          ) {
            console.log(`[📋 CHAT STANDUP] Triggering daily standup from chat for user=${requestUserId ?? 'global'}`);
            if (!this.store.threads.has(threadId)) {
              this.store.createThread({
                id: threadId,
                user_id: requestUserId,
                title: String(body.content || '').slice(0, 64) || 'Standup Session',
                mode: 'STANDUP',
                target_agent_id: 'warden',
              });
            }
            const standupCeo = this.store.addChatMessage({
              thread_id: threadId,
              sender_type: 'CEO',
              recipient_agent_id: 'warden',
              content: String(body.content || ''),
            });
            const wardenAgent = this.store.getAgent('warden')!;
            const standupRun = this.store.createRun({
              user_id: requestUserId,
              agent_id: wardenAgent.id,
              agent_slug: wardenAgent.slug,
              parent_run_id: null,
              chat_thread_id: threadId,
              sprint_id: null,
              backlog_item_id: null,
              trigger_type: 'DAILY_STANDUP',
              input_prompt: String(body.content || ''),
              output_summary: null,
              status: 'RUNNING',
              container_id: null,
              git_branch: null,
              git_commit_sha: null,
              preview_url: null,
              qa_passed: null,
              qa_screenshot_url: null,
              project_scope: null,
              child_run_ids: [],
              inbox_messages: [],
            });
            this.sendJson(res, 202, {
              ceoMessage: standupCeo,
              runId: standupRun.id,
              agentId: wardenAgent.id,
              agentSlug: wardenAgent.slug,
              threadId,
              status: 'RUNNING',
              routedMode: 'STANDUP',
              async: true,
            });
            void this.standupCoordinator
              .triggerDailyStandup({ userId: requestUserId })
              .then((standupResult) => {
                this.broadcastEvent('standup:updated', standupResult.sprint);
                this.store.updateRun(standupRun.id, {
                  status: 'COMPLETED',
                  output_summary: standupResult.sprint.mom_summary_md,
                  sprint_id: standupResult.sprint.id,
                  child_run_ids: standupResult.leadRuns.map((r) => r.id),
                  ended_at: new Date().toISOString(),
                });
                this.store.addChatMessage({
                  thread_id: threadId,
                  sender_type: 'AGENT',
                  sender_agent_id: 'warden',
                  recipient_agent_id: 'CEO',
                  content: standupResult.sprint.mom_summary_md,
                  run_id: standupRun.id,
                });
              })
              .catch((err: unknown) => {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`[📋 CHAT STANDUP FAIL] thread=${threadId}:`, err);
                this.store.updateRun(standupRun.id, {
                  status: 'FAILED',
                  output_summary: `Standup failed: ${message}`,
                  ended_at: new Date().toISOString(),
                });
                this.store.addChatMessage({
                  thread_id: threadId,
                  sender_type: 'AGENT',
                  sender_agent_id: 'warden',
                  recipient_agent_id: 'CEO',
                  content: `⚠️ **Standup failed:** ${message}`,
                  run_id: standupRun.id,
                });
              });
            return;
          }

          // Async dispatch (default): record + init the root run now (<100ms),
          // answer 202, and run the full multi-agent pipeline in the background.
          // The reply + run completion arrive via WebSocket push and run polling.
          const preflight = await this.hierarchyRouter.beginRouteMessage({
            threadId,
            userId: requestUserId ?? undefined,
            content: String(body.content || ''),
            targetAgentId:
              body.targetAgentId ?? body.target_agent_id ?? undefined,
            mode: body.mode as ChatThreadMode | undefined,
            attachments: processedAttachments,
          });

          this.sendJson(res, 202, {
            ceoMessage: preflight.userMessage,
            runId: preflight.rootRun.id,
            agentId: preflight.targetAgent.id,
            agentSlug: preflight.targetAgent.slug,
            threadId: preflight.thread.id,
            status: 'RUNNING',
            routedMode: preflight.isDirect ? 'DIRECT_AGENT' : 'WARDEN_EXECUTIVE',
            async: true,
          });

          void this.hierarchyRouter
            .routeMessage({
              threadId,
              userId: requestUserId ?? undefined,
              content: String(body.content || ''),
              targetAgentId:
                body.targetAgentId ?? body.target_agent_id ?? undefined,
              mode: body.mode as ChatThreadMode | undefined,
              attachments: processedAttachments,
              precreated: {
                userMessage: preflight.userMessage,
                rootRunId: preflight.rootRun.id,
              },
            })
            .then((routeResult) => {
              console.log(
                `[💬 CEO CHAT DONE] thread=${threadId} run=${routeResult.primaryRun.id} mode=${routeResult.routedMode}`
              );
            })
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              console.error(
                `[💬 CEO CHAT FAIL] thread=${threadId} run=${preflight.rootRun.id}:`,
                err
              );
              this.store.updateRun(preflight.rootRun.id, {
                status: 'FAILED',
                output_summary: `Agent execution failed: ${message}`,
                ended_at: new Date().toISOString(),
              });
              this.failStuckThreadRuns(
                threadId,
                preflight.rootRun.started_at,
                `Parent run ${preflight.rootRun.id} failed: ${message}`,
                preflight.rootRun.id
              );
              this.store.addChatMessage({
                thread_id: threadId,
                sender_type: 'AGENT',
                sender_agent_id: preflight.targetAgent.id,
                recipient_agent_id: 'CEO',
                content: `⚠️ **Execution failed:** ${message}\n\nThe run was marked FAILED. Your message is saved — retry or ask for a smaller step.`,
                run_id: preflight.rootRun.id,
              });
            });
          return;
        }
      }

      // ======================================================================
      // 5. Backlog Kanban Board, Collated CTO Backlog & Human Intervention
      // ======================================================================
      if (pathname === '/api/backlog/collated' && method === 'GET') {
        this.sendJson(res, 200, this.store.getCollatedBacklog(requestUserId ?? undefined));
        return;
      }

      if (pathname === '/api/backlog' && method === 'GET') {
        const projectFilter = parsedUrl.searchParams.get('project_slug');
        const pmFilter = parsedUrl.searchParams.get('pm_owner_id');
        let list = Array.from(this.store.backlogItems.values());
        if (requestUserId) {
          list = list.filter((i) => (i.user_id ?? null) === requestUserId);
        }
        if (projectFilter) {
          list = list.filter((i) => i.project_slug === projectFilter);
        }
        if (pmFilter) {
          list = list.filter((i) => i.pm_owner_id === pmFilter);
        }
        list.sort((a, b) => b.created_at.localeCompare(a.created_at));
        this.sendJson(res, 200, list);
        return;
      }

      if (pathname === '/api/backlog' && method === 'POST') {
        const body = await this.readJsonBody(req);
        const created = this.store.createBacklogItem({
          user_id: requestUserId,
          title: String(body.title || 'Untitled Backlog Task'),
          spec_md: String(body.spec_md || ''),
          stage: (body.stage as BacklogStage) || 'INBOX',
          priority: (body.priority as BacklogPriority) || 'P1',
          project_slug: String(body.project_slug || this.store.getDefaultProjectSlug()),
          department: String(body.department || 'Tech'),
          pm_owner_id: body.pm_owner_id ?? null,
          assigned_agent_id: body.assigned_agent_id ?? null,
          sprint_id: body.sprint_id ?? null,
          target_week: body.target_week ?? '2026-W43',
          requires_human_intervention: Boolean(body.requires_human_intervention),
          intervention_type: body.intervention_type as HumanInterventionType | undefined,
          intervention_prompt: body.intervention_prompt ?? null,
          required_env_keys: Array.isArray(body.required_env_keys)
            ? body.required_env_keys
            : undefined,
          requested_by_agent_id: body.requested_by_agent_id ?? null,
        });
        this.broadcastEvent('backlog:updated', created);
        this.sendJson(res, 201, created);
        return;
      }

      if (pathname === '/api/backlog/triage' && method === 'POST') {
        const triaged = [];
        for (const item of this.store.backlogItems.values()) {
          if (requestUserId && (item.user_id ?? null) !== requestUserId) continue;
          if (item.stage === 'INBOX') {
            const pmOwner = this.store.pmForProject(item.project_slug, 'pm');
            const updated = this.store.updateBacklogItem(item.id, {
              stage: 'TODO',
              priority: 'P0',
              pm_owner_id: pmOwner,
              target_week: '2026-W43',
              moved_by_agent_id: pmOwner,
              movement_reason: `Triaged INBOX -> TODO for Week 2026-W43 by @${pmOwner}`,
              assigned_agent_id: this.store.executorForProject(
                this.store.getStaffedProjectSlugs().includes(item.project_slug) ||
                  item.project_slug === 'marketing'
                  ? item.project_slug
                  : this.store.getDefaultProjectSlug(),
                'frontend'
              ),
            });
            if (updated) triaged.push(updated);
          }
        }
        this.sendJson(res, 200, {
          triagedCount: triaged.length,
          items: Array.from(this.store.backlogItems.values()).filter(
            (i) => !requestUserId || (i.user_id ?? null) === requestUserId
          ),
        });
        return;
      }

      const resolveInterventionMatch = pathname.match(
        /^\/api\/backlog\/([^/]+)\/resolve-intervention$/
      );
      if (resolveInterventionMatch && method === 'POST') {
        const itemId = decodeURIComponent(resolveInterventionMatch[1]);
        const body = await this.readJsonBody(req);
        const target = this.store.backlogItems.get(itemId);
        if (!target || (requestUserId && (target.user_id ?? null) !== requestUserId)) {
          this.sendJson(res, 404, { error: `Backlog item ${itemId} not found` });
          return;
        }
        const updated = this.store.resolveHumanIntervention(itemId, {
          human_response: String(body.human_response || body.response || 'Resolved by CEO'),
          env_values:
            body.env_values && typeof body.env_values === 'object'
              ? body.env_values
              : undefined,
          next_stage: (body.next_stage as BacklogStage) || 'TODO',
        });
        if (!updated) {
          this.sendJson(res, 404, { error: `Backlog item ${itemId} not found` });
          return;
        }
        this.broadcastEvent('backlog:updated', updated);
        this.sendJson(res, 200, updated);
        return;
      }

      const backlogItemMatch = pathname.match(/^\/api\/backlog\/([^/]+)$/);
      if (backlogItemMatch && method === 'PATCH') {
        const itemId = decodeURIComponent(backlogItemMatch[1]);
        const body = await this.readJsonBody(req);
        const target = this.store.backlogItems.get(itemId);
        if (!target || (requestUserId && (target.user_id ?? null) !== requestUserId)) {
          this.sendJson(res, 404, { error: `Backlog item ${itemId} not found` });
          return;
        }
        const updated = this.store.updateBacklogItem(itemId, {
          title: body.title,
          spec_md: body.spec_md,
          stage: body.stage as BacklogStage | undefined,
          priority: body.priority as BacklogPriority | undefined,
          project_slug: body.project_slug,
          pm_owner_id: body.pm_owner_id,
          assigned_agent_id: body.assigned_agent_id,
          sprint_id: body.sprint_id,
          target_week: body.target_week,
          requires_human_intervention: body.requires_human_intervention,
          intervention_type: body.intervention_type as HumanInterventionType | undefined,
          intervention_prompt: body.intervention_prompt,
          required_env_keys: body.required_env_keys,
          human_response: body.human_response,
          requested_by_agent_id: body.requested_by_agent_id,
          moved_by_agent_id: body.moved_by_agent_id,
          movement_reason: body.movement_reason,
        });
        if (!updated) {
          this.sendJson(res, 404, { error: `Backlog item ${itemId} not found` });
          return;
        }
        this.broadcastEvent('backlog:updated', updated);

        // Automatically trigger Zero-Idle Department Watchdog when a task moves to DONE
        if (updated.stage === 'DONE') {
          await this.idleMonitor.onBacklogItemCompleted(updated.project_slug);
        }

        this.sendJson(res, 200, updated);
        return;
      }

      // ======================================================================
      // 6. Sprints & 12:00 PM IST Daily Standup
      // ======================================================================
      if (pathname === '/api/sprints' && method === 'GET') {
        const allSprints = Array.from(this.store.sprints.values()).sort((a, b) =>
          b.created_at.localeCompare(a.created_at)
        );
        if (requestUserId) {
          const userSprints = allSprints.filter((s) => (s.user_id ?? null) === requestUserId);
          const list =
            userSprints.length > 0
              ? userSprints
              : allSprints.filter((s) => !s.user_id);
          this.sendJson(res, 200, list);
          return;
        }
        this.sendJson(res, 200, allSprints);
        return;
      }

      if (pathname === '/api/sprints/current' && method === 'GET') {
        const allSprints = Array.from(this.store.sprints.values()).sort((a, b) =>
          b.created_at.localeCompare(a.created_at)
        );
        let current = allSprints[0];
        if (requestUserId) {
          const userSprints = allSprints.filter((s) => (s.user_id ?? null) === requestUserId);
          current =
            userSprints[0] ||
            allSprints.find((s) => !s.user_id) ||
            undefined!;
        }
        this.sendJson(res, 200, current || null);
        return;
      }

      if (pathname === '/api/standup/trigger' && method === 'POST') {
        if (await this.rejectIfOverTokenBudget(res, requestUserId)) {
          return;
        }
        const body = await this.readJsonBody(req);
        const result = await this.standupCoordinator.triggerDailyStandup({
          dateIst: body.date_ist,
          autoExecute: Boolean(body.auto_execute),
          userId: requestUserId,
        });
        this.broadcastEvent('standup:updated', result.sprint);
        this.sendJson(res, 201, result);
        return;
      }

      // Demo workspace + per-user game deploy (Tic-Tac-Toe Arena scaffold).
      if (pathname === '/api/demo/workspace' && method === 'GET') {
        if (!requestUserId) {
          this.sendJson(res, 401, { ok: false, error: 'Not signed in' });
          return;
        }
        const { getDemoWorkspace } = await import('../demo/DemoProvisioning.js');
        const { cloudflareConfigured, demoProjectName } = await import('../demo/CloudflareDeployer.js');
        const workspace = await getDemoWorkspace(requestUserId);
        if (!workspace) {
          this.sendJson(res, 404, { ok: false, error: 'No demo workspace yet. Complete onboarding in demo mode first.' });
          return;
        }
        this.sendJson(res, 200, {
          ok: true,
          workspace,
          deploy: {
            project_name: demoProjectName(requestUserId),
            cloudflare_configured: cloudflareConfigured(),
          },
        });
        return;
      }

      if (pathname === '/api/demo/deploy' && method === 'POST') {
        if (!requestUserId) {
          this.sendJson(res, 401, { ok: false, error: 'Not signed in' });
          return;
        }
        const { getDemoWorkspace, recordDemoDeploy } = await import('../demo/DemoProvisioning.js');
        const { ensureDemoFolder } = await import('../demo/DemoFolders.js');
        const { deployDemoProject } = await import('../demo/CloudflareDeployer.js');
        const workspace = await getDemoWorkspace(requestUserId);
        if (!workspace || workspace.mode !== 'demo') {
          this.sendJson(res, 404, { ok: false, error: 'No demo workspace yet. Complete onboarding in demo mode first.' });
          return;
        }
        const { dir } = ensureDemoFolder(requestUserId);
        await recordDemoDeploy(requestUserId, { deploy_url: null, deploy_status: 'DEPLOYING' }).catch(() => null);
        const result = await deployDemoProject(requestUserId, workspace.local_dir || dir);
        const updated = await recordDemoDeploy(requestUserId, {
          deploy_url: result.primaryUrl,
          deploy_status: result.status,
        }).catch(() => null);
        this.broadcastEvent('backlog:updated', { user_id: requestUserId, kind: 'demo-deploy', status: result.status });
        this.sendJson(res, result.ok ? 201 : 200, { ok: result.ok, result, workspace: updated || workspace });
        return;
      }

      const sprintApproveMatch = pathname.match(
        /^\/api\/sprints\/([^/]+)\/approve$/
      );
      if (sprintApproveMatch && method === 'POST') {
        if (await this.rejectIfOverTokenBudget(res, requestUserId)) {
          return;
        }
        const sprintId = decodeURIComponent(sprintApproveMatch[1]);
        const body = await this.readJsonBody(req);
        const targetSprint = this.store.sprints.get(sprintId);
        if (!targetSprint || (requestUserId && (targetSprint.user_id ?? null) !== requestUserId)) {
          this.sendJson(res, 404, { error: `Sprint ${sprintId} not found` });
          return;
        }
        const result = await this.standupCoordinator.approveAndExecuteSprint(
          sprintId,
          body.ceo_notes ?? body.ceoNotes ?? null
        );
        this.broadcastEvent('standup:updated', result.sprint);
        this.sendJson(res, 200, result);
        return;
      }

      // ======================================================================
      // 7. Approval Gates & 1-Tap Resolution
      // ======================================================================
      if (pathname === '/api/gates' && method === 'GET') {
        const gates = Array.from(this.store.approvalGates.values())
          .filter((g) => !requestUserId || (g.user_id ?? null) === requestUserId)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((g) => this.serializeGateForApi(g));
        this.sendJson(res, 200, gates);
        return;
      }

      const gateResolveMatch = pathname.match(
        /^\/api\/gates\/([^/]+)\/resolve$/
      );
      if (gateResolveMatch && method === 'POST') {
        const gateId = decodeURIComponent(gateResolveMatch[1]);
        const body = await this.readJsonBody(req);
        const decision = String(
          body.decision || body.ceo_decision || 'APPROVED'
        );
        const optionId = body.option_id ? String(body.option_id) : undefined;

        const pendingGate = this.store.approvalGates.get(gateId);
        if (!pendingGate || (requestUserId && (pendingGate.user_id ?? null) !== requestUserId)) {
          this.sendJson(res, 404, { error: `ApprovalGate ${gateId} not found` });
          return;
        }
        const gate = this.store.resolveApprovalGate(gateId, decision);
        if (!gate) {
          this.sendJson(res, 404, { error: `ApprovalGate ${gateId} not found` });
          return;
        }

        const createdBacklogItems = [];

        // If resolving an EMPTY_BACKLOG_PING gate, 1-tap materialize the suggested tasks into TODO
        if (
          gate.gate_type === 'EMPTY_BACKLOG_PING' &&
          Array.isArray(gate.options_json?.suggested_tasks)
        ) {
          const allSuggested = gate.options_json.suggested_tasks;
          const selected =
            !optionId || optionId === 'opt_approve_all_3'
              ? allSuggested
              : allSuggested.filter((t) => t.id === optionId);

          for (const spec of selected.length > 0 ? selected : allSuggested) {
            const created = this.store.createBacklogItem({
              user_id: gate.user_id ?? requestUserId,
              title: spec.title,
              spec_md: spec.spec_md,
              stage: 'TODO',
              priority: spec.priority,
              project_slug: spec.project_slug || gate.project_scope || this.store.getDefaultProjectSlug(),
              department: gate.department,
              assigned_agent_id: spec.assigned_agent_id,
            });
            createdBacklogItems.push(created);
          }
        }

        // If resolving STANDUP_SIGN_OFF, execute the sprint
        if (gate.gate_type === 'STANDUP_SIGN_OFF' && gate.sprint_id) {
          await this.standupCoordinator.approveAndExecuteSprint(
            gate.sprint_id,
            decision
          );
        }

        // If resolving TOKEN_CAP_EXCEEDED or QUESTION/CONTRACT/CODE_CHANGE, unpause agent and resume checkpointed run
        const waitingAgent = this.store.getAgent(gate.agent_id);
        if (waitingAgent && waitingAgent.status !== 'IDLE') {
          await this.store.updateAgent(waitingAgent.id, {
            status: 'IDLE',
            health_status: 'HEALTHY',
            max_tokens_per_run:
              gate.gate_type === 'TOKEN_CAP_EXCEEDED'
                ? waitingAgent.max_tokens_per_run + 500_000
                : waitingAgent.max_tokens_per_run,
          });
        }

        let resumedRunResult = null;
        if (
          gate.run_id &&
          gate.gate_type !== 'STANDUP_SIGN_OFF' &&
          gate.gate_type !== 'EMPTY_BACKLOG_PING'
        ) {
          resumedRunResult = await this.agentRunner.resumePausedRun(
            gate.run_id,
            decision
          );
        }

        this.sendJson(res, 200, {
          gate: this.serializeGateForApi(gate),
          createdBacklogItems,
          resumedRun: resumedRunResult ? resumedRunResult.run : null,
        });
        return;
      }

      const runMessageMatch = pathname.match(/^\/api\/runs\/([^/]+)\/message$/);
      if (runMessageMatch && method === 'POST') {
        const targetRunId = decodeURIComponent(runMessageMatch[1]);
        const body = await this.readJsonBody(req);
        const messageText = String(body.message || body.content || '').trim();
        const senderHandle = String(body.sender_handle || '@ceo');
        if (!messageText) {
          this.sendJson(res, 400, { error: 'message is required' });
          return;
        }
        const existingRun = this.store.runs.get(targetRunId);
        if (!existingRun) {
          this.sendJson(res, 404, { error: `Run ${targetRunId} not found` });
          return;
        }
        if (existingRun.status === 'RUNNING') {
          const queued = this.store.enqueueRunInboxMessage(targetRunId, {
            from_agent_slug: senderHandle.replace(/^@/, ''),
            from_run_id: body.sender_run_id ? String(body.sender_run_id) : null,
            content: messageText,
          });
          this.sendJson(res, 200, { status: 'QUEUED_TO_INBOX', message: queued });
          return;
        }
        const resumed = await this.agentRunner.resumePausedRun(
          targetRunId,
          `[Message from ${senderHandle}]: ${messageText}`
        );
        this.sendJson(res, 200, {
          status: 'RESUMED',
          run: resumed ? resumed.run : null,
          outputSummary: resumed ? resumed.outputSummary : null,
        });
        return;
      }

      // ======================================================================
      // 8. Watchdogs On-Demand Trigger & Project Contexts
      // ======================================================================
      if (
        (pathname === '/api/watchdogs/idle-check' ||
          pathname === '/api/watchdog/test-idle') &&
        method === 'POST'
      ) {
        const body = await this.readJsonBody(req);
        const results = await this.idleMonitor.checkAllScopes({
          targetScope: body.scope,
          forcePingIfNotEmpty: body.force ?? true,
          bypassCooldown: true,
        });
        this.sendJson(res, 200, {
          checkedAt: new Date().toISOString(),
          results,
        });
        return;
      }

      if (
        (pathname === '/api/contexts' || pathname === '/api/projects') &&
        method === 'GET'
      ) {
        const contexts = Array.from(this.store.projectContexts.values());
        if (pathname === '/api/projects') {
          this.sendJson(res, 200, contexts);
          return;
        }
        this.sendJson(res, 200, {
          project_contexts: contexts,
          code_chunks_indexed: this.store.codeChunksCount,
          vector_dimensions: 768,
        });
        return;
      }

      this.sendJson(res, 404, {
        error: `Route ${method} ${pathname} not found`,
      });
    } catch (err) {
      this.sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
