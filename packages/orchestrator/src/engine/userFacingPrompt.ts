/**
 * Prompt blocks for agents that reply directly to the human user (chat and
 * direct @agent mentions).
 *
 * - `loadAgentProductGuide` reads the "Agent quick reference" section of
 *   docs/PRODUCT_GUIDE.md so agents name real screens and buttons.
 * - `REPLY_STYLE` keeps replies conversational instead of report-like.
 * - `formatOpenItemsForPrompt` lists what is waiting on the user as plain
 *   reference data, with no headings or codes the model would copy verbatim.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const GUIDE_PATH = fileURLToPath(new URL('../../../../docs/PRODUCT_GUIDE.md', import.meta.url));
const START = '<!-- agent-guide:start -->';
const END = '<!-- agent-guide:end -->';

const FALLBACK_GUIDE =
  'You are part of Warden. Tabs: Home, Team, Reports, Backlogs, SEO, Settings. ' +
  'Things waiting on the user are in the NEEDS ACTION panel on Home (click the card, then "Approve & spawn team") ' +
  'and in the NEEDS_CEO column on Backlogs ("Approve & unblock"). Never invent screen names.';

let cachedGuide: string | null = null;

/** Extracts the text between the agent-guide markers. Exported for tests. */
export function extractAgentGuide(markdown: string): string | null {
  const start = markdown.indexOf(START);
  const end = markdown.indexOf(END);
  if (start === -1 || end === -1 || end <= start) return null;
  const body = markdown.slice(start + START.length, end).trim();
  return body.length > 0 ? body : null;
}

export function loadAgentProductGuide(): string {
  if (cachedGuide !== null) return cachedGuide;
  try {
    cachedGuide = extractAgentGuide(fs.readFileSync(GUIDE_PATH, 'utf8')) ?? FALLBACK_GUIDE;
  } catch {
    cachedGuide = FALLBACK_GUIDE;
  }
  return cachedGuide;
}

export const REPLY_STYLE = `Write like a helpful colleague in a chat, not like a report or a help page.
- Answer what the user actually asked, in the context of the conversation so far. Greetings get a short, friendly reply.
- Lead with the answer in plain words. Two to four short sentences is usually enough.
- No headings, no title lines, no ALL CAPS labels, no bold section names.
- Do not show internal ids, stage codes like NEEDS_CEO, priority codes like P0, or agent handles unless the user asks. Say "waiting on your approval" or "urgent" instead.
- Give screen directions only when the user asks how or where to do something, or when they must act. Never recite the product guide.
- Mention tasks waiting on the user when they ask what is going on, or once if it is urgent and you have not mentioned it yet in this chat. Do not repeat it in every reply.
- Use a short list only when there are three or more separate items.
- If you need a decision, end with one plain question.
- Never say something is done, fixed, or deployed unless a tool result confirms it.`;

const PRIORITY_WORDS: Record<string, string> = {
  P0: 'urgent',
  P1: 'high priority',
  P2: 'normal priority',
  P3: 'low priority',
};

export interface OpenItemInput {
  id: string;
  title: string;
  priority?: string | null;
  summary?: string | null;
}

export interface PendingGateInput {
  agent_id: string;
  prompt_text: string;
}

const oneLine = (s: string, max: number) => {
  const flat = String(s || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Lists open items as plain reference data for the system prompt. */
export function formatOpenItemsForPrompt(
  items: OpenItemInput[],
  gates: PendingGateInput[] = []
): string {
  const lines: string[] = [
    '',
    'Reference data, not reply text. Do not copy these lines, ids, or codes into your reply.',
  ];
  if (items.length === 0) {
    lines.push('Nothing is waiting on the user right now.');
  } else {
    lines.push(`Tasks waiting on the user's approval: ${items.length}.`);
    for (const item of items) {
      const priority = PRIORITY_WORDS[String(item.priority || '').toUpperCase()] || 'normal priority';
      const summary = item.summary ? ` ${oneLine(item.summary, 180)}` : '';
      lines.push(`- "${item.title}" (${priority}).${summary} [task id for tools only: ${item.id}]`);
    }
  }
  if (gates.length > 0) {
    lines.push(`Questions from agents waiting on the user: ${gates.length}.`);
    for (const gate of gates) {
      lines.push(`- From ${gate.agent_id}: ${oneLine(gate.prompt_text, 180)}`);
    }
  }
  return lines.join('\n');
}

/** Full block appended to the system prompt of an agent replying to the user. */
export function buildUserFacingBlock(openItems: string): string {
  return [
    '',
    '# Product guide',
    loadAgentProductGuide(),
    '',
    '# How to reply',
    REPLY_STYLE,
    '',
    '# What is waiting on the user',
    openItems.trim(),
  ].join('\n');
}

export interface ThreadMessageInput {
  sender_type: 'CEO' | 'AGENT' | 'SYSTEM' | string;
  sender_agent_id?: string | null;
  content: string;
}

export interface ThreadHistory {
  /** Prior turns, oldest first, ready to prepend before the current user message. */
  turns: { role: 'user' | 'assistant'; content: string }[];
  /** User messages right before the current one that never got a reply. */
  unansweredUserMessages: string[];
}

/**
 * Builds recent chat history for a reply run so the agent sees the
 * conversation, not just the latest message. Drops the current message
 * (already recorded in the thread) and system notices.
 */
export function buildThreadHistory(
  messages: ThreadMessageInput[],
  currentPrompt: string,
  options: { maxTurns?: number; maxCharsPerTurn?: number } = {}
): ThreadHistory {
  const maxTurns = options.maxTurns ?? 12;
  const maxChars = options.maxCharsPerTurn ?? 1200;
  const relevant = messages.filter((m) => m.sender_type === 'CEO' || m.sender_type === 'AGENT');

  // Remove the current message: the last user message with the same text.
  const current = currentPrompt.trim();
  for (let i = relevant.length - 1; i >= 0; i--) {
    if (relevant[i].sender_type === 'CEO' && relevant[i].content.trim() === current) {
      relevant.splice(i, 1);
      break;
    }
  }

  const unanswered: string[] = [];
  for (let i = relevant.length - 1; i >= 0 && relevant[i].sender_type === 'CEO'; i--) {
    unanswered.unshift(relevant[i].content.trim());
  }

  const turns = relevant.slice(-maxTurns).map((m) => {
    const text = m.content.length > maxChars ? `${m.content.slice(0, maxChars - 1)}…` : m.content;
    return m.sender_type === 'CEO'
      ? { role: 'user' as const, content: text }
      : { role: 'assistant' as const, content: text };
  });
  return { turns, unansweredUserMessages: unanswered };
}

/** System note telling the agent to pick up messages that never got a reply. */
export function unansweredNote(unanswered: string[]): string {
  if (unanswered.length === 0) return '';
  const list = unanswered.map((m) => `"${oneLine(m, 120)}"`).join(', ');
  return `\n\nNote: the user's previous ${unanswered.length === 1 ? 'message' : `${unanswered.length} messages`} (${list}) never got a reply because of an error or restart on our side. Briefly say sorry for the missed reply, then answer ${unanswered.length === 1 ? 'it' : 'them'} together with the new message. Do not explain where replies appear in the app.`;
}
