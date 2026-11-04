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

export const REPLY_STYLE = `Write like a helpful colleague in a chat, not like a report.
- Lead with the answer in plain words. Two to five short sentences is usually enough.
- No headings, no title lines, no ALL CAPS labels, no bold section names.
- Do not show internal ids, stage codes like NEEDS_CEO, priority codes like P0, or agent handles unless the user asks. Say "waiting on your approval" or "urgent" instead.
- Use a short list only when there are three or more separate items.
- When the user needs to act, tell them exactly where to click, using only the screen and button names from the product guide.
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
