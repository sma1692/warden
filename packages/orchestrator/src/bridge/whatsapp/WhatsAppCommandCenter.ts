/**
 * WhatsAppCommandCenter — CEO command surface over WhatsApp (text + voice notes + reply buttons).
 *
 * Flow:
 *   1. "run standup" (typed or spoken) → triggers the daily standup (no auto-execute).
 *   2. A phone-friendly summary is sent, followed by [Approve] [Reject] [Details] buttons.
 *   3. Approve (button, "approve", or a bare "yes" while a plan is pending) → executes the sprint
 *      and replies with a completion summary.
 *   4. Anything else falls through to reminders, then the normal warden hierarchy routing.
 *
 * Webhook contract: every handler returns the reply text (sent by the webhook) or null when this
 * class already sent its own messages. All transport functions are injected so the class has no
 * import-time dependency on the WhatsApp client, transcription, or the control plane.
 */
import { randomBytes } from 'node:crypto';
import type {
  AgentRunRecord,
  BacklogItemRecord,
} from '../../engine/OrchestratorStore.js';
import type {
  ApproveSprintResult,
  StandupCoordinator,
  TriggerStandupResult,
} from '../../engine/StandupCoordinator.js';

// ── Inbound shapes (structurally identical to WhatsAppWebhook.ts) ────────────

export interface WhatsAppInboundText {
  from: string;
  text: string;
  messageId: string;
  timestamp: string;
}

export interface WhatsAppInboundAudio {
  from: string;
  messageId: string;
  audio: Buffer;
  mimeType: string;
}

export interface WhatsAppInboundButton {
  from: string;
  messageId: string;
  buttonId: string;
  title: string;
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface WhatsAppCommandButton {
  id: string;
  title: string;
}

export interface WhatsAppCommandCenterDeps {
  standupCoordinator: Pick<StandupCoordinator, 'triggerDailyStandup' | 'approveAndExecuteSprint'>;
  /** Existing hierarchy routing (warden thread per sender). */
  routeToAgents: (from: string, text: string) => Promise<string | null>;
  /** Existing reminder parsing; returns a confirmation or null when the text is not a reminder. */
  tryCreateReminder: (text: string) => Promise<string | null>;
  sendText: (to: string, text: string) => Promise<{ ok: boolean; error?: string }>;
  sendButtons: (
    to: string,
    body: string,
    buttons: WhatsAppCommandButton[],
    opts?: { header?: string; footer?: string }
  ) => Promise<{ ok: boolean; error?: string }>;
  transcribe: (
    audio: Buffer,
    mimeType: string
  ) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
  onEvent?: (event: 'standup:updated', payload: unknown) => void;
  /** How long an approval stays valid (default 2h). */
  approvalTtlMs?: number;
  /** Clock override for tests. */
  now?: () => number;
}

// ── Intent parsing ───────────────────────────────────────────────────────────

export type WhatsAppIntent =
  | 'standup'
  | 'approve'
  | 'reject'
  | 'affirm'
  | 'deny'
  | 'status'
  | 'help'
  | 'other';

/** Leading/trailing filler that never changes the meaning of a command. */
const LEADING_FILLER = /^(?:(?:hey|hi|hello|ok|okay|yo|warden|commando|please|pls|plz|kindly|can you|could you|would you|will you|lets)\s+)+/;
const TRAILING_FILLER = /(?:\s+(?:please|pls|plz|now|thanks|thank you|warden|for me|right now))+$/;

const PLAN_NOUN = '(?:\\s+(?:it|this|that|the plan|this plan|the sprint|this sprint|sprint|plan|sprint plan|the sprint plan))?';

const STANDUP_RE =
  /^(?:(?:run|start|do|kick off|kickoff|begin|trigger|launch|fire|hold)\s+)?(?:(?:the|a|todays|daily)\s+)*stand\s?-?\s?up(?:\s+(?:now|today|meeting))?$/;
const APPROVE_RE = new RegExp(
  `^(?:yes\\s+|yeah\\s+|yep\\s+)?(?:approve(?:d)?${PLAN_NOUN}|go ahead|go for it|execute${PLAN_NOUN}|ship it|lgtm)$`
);
const REJECT_RE = new RegExp(
  `^(?:no\\s+)?(?:reject(?:ed)?${PLAN_NOUN}|cancel${PLAN_NOUN}|dont execute${PLAN_NOUN}|do not execute${PLAN_NOUN}|dont run${PLAN_NOUN}|abort${PLAN_NOUN}|stop)$`
);
const AFFIRM_RE = /^(?:yes|y|yep|yeah|yup|sure|ok|okay|ya|haan|ha)$/;
const DENY_RE = /^(?:no|n|nope|nah|nahi)$/;
const STATUS_RE =
  /^(?:status|whats running|what is running|whats the status|what is the status|whats happening|any updates?|progress)$/;
const HELP_RE = /^(?:help|what can you do|commands|menu|what are the commands)$/;

/** Lowercases, folds apostrophes, strips punctuation/emoji, and trims filler words. */
function normalizeCommandText(text: string): string {
  let t = text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/'/g, '') // don't → dont, what's → whats, today's → todays
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Only strip filler when something meaningful remains ("ok" alone is an affirm).
  const lead = t.replace(LEADING_FILLER, '').trim();
  if (lead) t = lead;
  const trail = t.replace(TRAILING_FILLER, '').trim();
  if (trail) t = trail;
  return t;
}

/**
 * Deterministic, case-insensitive intent classifier for CEO WhatsApp commands.
 * Bare "yes"/"no" return `affirm`/`deny`; the caller decides whether a pending approval exists.
 */
export function parseWhatsAppIntent(text: string): WhatsAppIntent {
  const t = normalizeCommandText(text);
  if (!t) return 'other';
  if (STANDUP_RE.test(t)) return 'standup';
  // Reject before approve so "don't execute" never matches the execute branch.
  if (REJECT_RE.test(t)) return 'reject';
  if (APPROVE_RE.test(t)) return 'approve';
  if (AFFIRM_RE.test(t)) return 'affirm';
  if (DENY_RE.test(t)) return 'deny';
  if (STATUS_RE.test(t)) return 'status';
  if (HELP_RE.test(t)) return 'help';
  return 'other';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_APPROVAL_TTL_MS = 2 * 60 * 60 * 1000;
const SUMMARY_MAX_CHARS = 1500;
const DETAILS_CHUNK_CHARS = 3500;
const BUTTON_PREFIX = 'appr';

const EXPIRED_REPLY = '⌛ That approval has expired or was already used. Send *run standup* to start again.';
const NO_PENDING_REPLY = "There's no plan waiting for approval. Send *run standup* to start one.";
const BUSY_REPLY = "⏳ A standup is already running. I'll message you when it's done.";

const HELP_REPLY = [
  '*Commando on WhatsApp*',
  '• *run standup* — run today\'s standup and get a plan to approve',
  '• *approve* / *reject* — act on the pending sprint plan (or tap the buttons)',
  '• *status* — what is running and what is waiting on you',
  '• *remind me …* — set a reminder',
  '• Anything else goes to warden. Voice notes work too 🎙️',
].join('\n');

interface PendingApproval {
  token: string;
  sprintId: string;
  /** Sender digits only. */
  from: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
  standup: TriggerStandupResult;
}

type ApprovalAction = 'yes' | 'no' | 'details';

function digitsOnly(n: string): string {
  return String(n ?? '').replace(/\D/g, '');
}

/** Last 4 digits only — full numbers never reach the logs. */
function mask(n: string): string {
  const d = digitsOnly(n);
  return d.length <= 4 ? '****' : `***${d.slice(-4)}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function truncate(text: string, max: number): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function formatDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Splits long markdown on paragraph/line boundaries, hard-cutting only oversized lines. */
function chunkText(text: string, max: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of String(text ?? '').split('\n')) {
    let rest = line;
    while (rest.length > max) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      chunks.push(rest.slice(0, max));
      rest = rest.slice(max);
    }
    const candidate = current ? `${current}\n${rest}` : rest;
    if (candidate.length > max) {
      chunks.push(current);
      current = rest;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks.filter((c) => c.trim().length > 0);
}

function countBy<T>(items: T[], key: (item: T) => string): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item) || 'UNKNOWN';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([k, v]) => `${v} ${k.toLowerCase().replace(/_/g, ' ')}`)
    .join(', ');
}

function itemLine(item: BacklogItemRecord): string {
  const scope = item.project_slug ? ` _(${item.project_slug})_` : '';
  return `• [${item.priority}] ${truncate(item.title, 70)}${scope}`;
}

/** Phone-sized standup digest (<= ~1500 chars). */
export function formatStandupSummary(result: TriggerStandupResult): string {
  const { sprint, triagedItems = [], activeSprintItems = [], leadRuns = [] } = result;
  const needsCeo = activeSprintItems
    .concat(triagedItems)
    .filter((i, idx, all) => i.requires_human_intervention && all.findIndex((x) => x.id === i.id) === idx);

  const lines: string[] = [];
  lines.push(`📋 *Standup — ${sprint.date_ist}${sprint.week_label ? ` (${sprint.week_label})` : ''}*`);
  lines.push(`• Triaged from inbox: *${triagedItems.length}*`);
  lines.push(`• Active sprint items: *${activeSprintItems.length}*`);

  if (activeSprintItems.length) {
    lines.push('', '*Top sprint items*');
    for (const item of activeSprintItems.slice(0, 5)) lines.push(itemLine(item));
    if (activeSprintItems.length > 5) lines.push(`• …and ${activeSprintItems.length - 5} more`);
  }

  if (needsCeo.length) {
    lines.push('', `🚨 *Needs you (${needsCeo.length})*`);
    for (const item of needsCeo.slice(0, 5)) {
      const ask = item.intervention_prompt ? ` — ${truncate(item.intervention_prompt, 60)}` : '';
      lines.push(`• ${truncate(item.title, 60)}${ask}`);
    }
    if (needsCeo.length > 5) lines.push(`• …and ${needsCeo.length - 5} more`);
  }

  if (leadRuns.length) {
    const failed = leadRuns.filter((r) => /FAIL|ERROR/i.test(String(r.status ?? ''))).length;
    lines.push('', `🤖 Lead check-ins: *${leadRuns.length}*${failed ? ` (⚠️ ${failed} failed)` : ''}`);
  }

  let out = lines.join('\n');
  if (out.length > SUMMARY_MAX_CHARS) {
    out = `${out.slice(0, SUMMARY_MAX_CHARS - 30).replace(/\n[^\n]*$/, '')}\n• …tap *Details* for more`;
  }
  return out;
}

/** Completion digest after the sprint executes. */
export function formatExecutionSummary(result: ApproveSprintResult): string {
  const runs: AgentRunRecord[] = (result.executedRuns ?? []).filter(Boolean);
  const done = result.completedItems ?? [];
  const lines: string[] = [];
  lines.push(`✅ *Sprint ${result.sprint.status.toLowerCase()}* — ${result.sprint.date_ist}`);
  lines.push(`• Agent runs: *${runs.length}*${runs.length ? ` (${countBy(runs, (r) => String(r.status ?? ''))})` : ''}`);
  lines.push(`• Items completed: *${done.length}*`);
  if (done.length) {
    lines.push('', '*Completed*');
    for (const item of done.slice(0, 5)) lines.push(itemLine(item));
    if (done.length > 5) lines.push(`• …and ${done.length - 5} more`);
  }
  return lines.join('\n');
}

// ── Command center ───────────────────────────────────────────────────────────

export class WhatsAppCommandCenter {
  private deps: WhatsAppCommandCenterDeps;
  private approvalTtlMs: number;
  private now: () => number;
  private pending = new Map<string, PendingApproval>();
  /** Single-flight guard: only one standup or execution at a time. */
  private busy: 'standup' | 'execution' | null = null;

  constructor(deps: WhatsAppCommandCenterDeps) {
    this.deps = deps;
    this.approvalTtlMs = deps.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS;
    this.now = deps.now ?? (() => Date.now());
  }

  public async handleText(msg: WhatsAppInboundText): Promise<string | null> {
    const text = String(msg.text ?? '').trim();
    if (!text) return null;
    const intent = parseWhatsAppIntent(text);
    console.log(`[📱 WHATSAPP-CMD] from=${mask(msg.from)} intent=${intent}`);

    switch (intent) {
      case 'help':
        return HELP_REPLY;
      case 'status':
        return this.statusReply(msg.from);
      case 'standup':
        return this.runStandup(msg.from);
      case 'approve':
      case 'reject': {
        const approval = this.latestPendingFor(msg.from);
        if (!approval) return NO_PENDING_REPLY;
        return this.applyDecision(approval, intent === 'approve' ? 'yes' : 'no', msg.from);
      }
      case 'affirm':
      case 'deny': {
        // Bare yes/no only count as a decision while a plan is waiting on this sender.
        const approval = this.latestPendingFor(msg.from);
        if (approval) return this.applyDecision(approval, intent === 'affirm' ? 'yes' : 'no', msg.from);
        return this.fallThrough(msg.from, text);
      }
      default:
        return this.fallThrough(msg.from, text);
    }
  }

  public async handleAudio(msg: WhatsAppInboundAudio): Promise<string | null> {
    let result: Awaited<ReturnType<WhatsAppCommandCenterDeps['transcribe']>>;
    try {
      result = await this.deps.transcribe(msg.audio, msg.mimeType);
    } catch (err) {
      result = { ok: false, error: errorMessage(err) };
    }
    if (!result.ok || !result.text.trim()) {
      const reason = result.ok ? 'empty transcript' : result.error;
      console.warn(`[📱 WHATSAPP-CMD] transcription failed from=${mask(msg.from)}: ${reason}`);
      return `🎙️ I couldn't understand that voice note (${reason}). Please try again or type it.`;
    }
    const transcript = result.text.trim();
    await this.safeSendText(msg.from, `🎙️ Heard: "${transcript}"`);
    return this.handleText({
      from: msg.from,
      text: transcript,
      messageId: msg.messageId,
      timestamp: String(Math.floor(this.now() / 1000)),
    });
  }

  public async handleButton(msg: WhatsAppInboundButton): Promise<string | null> {
    const parsed = this.parseButtonId(msg.buttonId);
    console.log(`[📱 WHATSAPP-CMD] button from=${mask(msg.from)} action=${parsed?.action ?? 'invalid'}`);
    if (!parsed) return EXPIRED_REPLY;

    this.prune();
    const approval = this.pending.get(parsed.token);
    if (!approval || approval.used || digitsOnly(msg.from) !== approval.from) {
      return EXPIRED_REPLY;
    }
    return this.applyDecision(approval, parsed.action, msg.from);
  }

  // ── Standup ────────────────────────────────────────────────────────────────

  private async runStandup(from: string): Promise<string | null> {
    if (this.busy) return BUSY_REPLY;
    this.busy = 'standup';
    try {
      await this.safeSendText(from, "📋 Running today's standup… this takes a minute or two.");
      const result = await this.deps.standupCoordinator.triggerDailyStandup({ autoExecute: false });
      this.emit(result.sprint);

      await this.safeSendText(from, formatStandupSummary(result));

      const approval = this.createApproval(from, result);
      await this.sendApprovalButtons(from, approval);
      return null;
    } catch (err) {
      console.warn(`[📱 WHATSAPP-CMD] standup failed: ${errorMessage(err)}`);
      return `⚠️ Standup failed: ${errorMessage(err)}`;
    } finally {
      this.busy = null;
    }
  }

  // ── Approvals ──────────────────────────────────────────────────────────────

  private createApproval(from: string, standup: TriggerStandupResult): PendingApproval {
    this.prune();
    const now = this.now();
    const approval: PendingApproval = {
      token: randomBytes(6).toString('base64url').slice(0, 8),
      sprintId: standup.sprint.id,
      from: digitsOnly(from),
      createdAt: now,
      expiresAt: now + this.approvalTtlMs,
      used: false,
      standup,
    };
    this.pending.set(approval.token, approval);
    return approval;
  }

  private async sendApprovalButtons(to: string, approval: PendingApproval): Promise<void> {
    const t = approval.token;
    const res = await this.deps
      .sendButtons(
        to,
        'Execute this sprint plan?',
        [
          { id: `${BUTTON_PREFIX}:${t}:yes`, title: '✅ Approve' },
          { id: `${BUTTON_PREFIX}:${t}:no`, title: '❌ Reject' },
          { id: `${BUTTON_PREFIX}:${t}:details`, title: '📄 Details' },
        ],
        { footer: `Expires in ${formatDuration(approval.expiresAt - this.now())}` }
      )
      .catch((err: unknown) => ({ ok: false, error: errorMessage(err) }));
    if (!res.ok) {
      // Buttons are a convenience: text "approve"/"reject" still works against the same record.
      await this.safeSendText(to, 'Reply *approve* to execute this sprint plan or *reject* to cancel.');
    }
  }

  private async applyDecision(
    approval: PendingApproval,
    action: ApprovalAction,
    from: string
  ): Promise<string | null> {
    if (action === 'details') {
      const md = approval.standup.sprint.mom_summary_md || '_No standup notes recorded._';
      for (const chunk of chunkText(md, DETAILS_CHUNK_CHARS)) {
        await this.safeSendText(from, chunk);
      }
      await this.sendApprovalButtons(from, approval);
      return null;
    }

    if (action === 'no') {
      approval.used = true;
      return '❌ Sprint plan rejected. Nothing was executed.';
    }

    if (this.busy) return BUSY_REPLY;
    approval.used = true;
    this.busy = 'execution';
    try {
      await this.safeSendText(from, '▶️ Approved. Executing the sprint…');
      const result = await this.deps.standupCoordinator.approveAndExecuteSprint(
        approval.sprintId,
        'Approved via WhatsApp by CEO'
      );
      this.emit(result.sprint);
      return formatExecutionSummary(result);
    } catch (err) {
      console.warn(`[📱 WHATSAPP-CMD] execution failed for ${approval.sprintId}: ${errorMessage(err)}`);
      return `⚠️ Execution failed: ${errorMessage(err)}`;
    } finally {
      this.busy = null;
    }
  }

  private parseButtonId(id: string): { token: string; action: ApprovalAction } | null {
    const m = /^appr:([A-Za-z0-9_-]{8}):(yes|no|details)$/.exec(String(id ?? '').trim());
    return m ? { token: m[1], action: m[2] as ApprovalAction } : null;
  }

  /** Most recent unused, unexpired approval owned by this sender. */
  private latestPendingFor(from: string): PendingApproval | null {
    this.prune();
    const sender = digitsOnly(from);
    let latest: PendingApproval | null = null;
    for (const a of this.pending.values()) {
      if (a.used || a.from !== sender) continue;
      if (!latest || a.createdAt >= latest.createdAt) latest = a;
    }
    return latest;
  }

  /** Drops expired and used approvals. */
  private prune(): void {
    const now = this.now();
    for (const [token, a] of this.pending) {
      if (a.used || a.expiresAt <= now) this.pending.delete(token);
    }
  }

  // ── Misc ───────────────────────────────────────────────────────────────────

  private statusReply(from: string): string {
    const lines = ['*Commando status*'];
    if (this.busy === 'standup') lines.push('• ⏳ A standup is running');
    else if (this.busy === 'execution') lines.push('• ▶️ A sprint is executing');
    else lines.push('• Nothing is running');

    const approval = this.latestPendingFor(from);
    if (approval) {
      lines.push(
        `• 📝 Sprint plan *${approval.sprintId}* is waiting for approval (${formatDuration(approval.expiresAt - this.now())} left)`
      );
    } else {
      lines.push('• No plan waiting for approval');
    }
    return lines.join('\n');
  }

  private async fallThrough(from: string, text: string): Promise<string | null> {
    const reminder = await this.deps.tryCreateReminder(text);
    if (reminder) return reminder;
    return this.deps.routeToAgents(from, text);
  }

  private async safeSendText(to: string, text: string): Promise<void> {
    try {
      const res = await this.deps.sendText(to, text);
      if (!res.ok) console.warn(`[📱 WHATSAPP-CMD] send to ${mask(to)} failed: ${res.error ?? 'unknown'}`);
    } catch (err) {
      console.warn(`[📱 WHATSAPP-CMD] send to ${mask(to)} threw: ${errorMessage(err)}`);
    }
  }

  private emit(payload: unknown): void {
    try {
      this.deps.onEvent?.('standup:updated', payload);
    } catch (err) {
      console.warn(`[📱 WHATSAPP-CMD] onEvent failed: ${errorMessage(err)}`);
    }
  }
}
