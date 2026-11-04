/**
 * Runtime enforcement of the Bottom-Heavy Token Pyramid.
 *
 * The hierarchy rules in AGENTS.md are not only prompt conventions. This module
 * is the single place the runtime checks them:
 *   - `capUpwardReply` trims every subagent reply to its tier's word cap before
 *     the reply enters the parent agent's context.
 *   - `canReadRawSource` blocks Root, Level 0, and Level 1 agents from reading raw
 *     source files. They must delegate reads to `reader_scout`.
 *   - `isInsideRoot` is the path-containment check used by every file tool.
 *
 * All functions are pure so they can be unit tested without a running store.
 */
import path from 'node:path';

export type AgentTier = 'ROOT' | 'L0' | 'L1' | 'L2_READ' | 'L2_WRITE';

const ROOT_AGENTS = new Set(['warden']);
const L0_AGENTS = new Set(['cto', 'cbo']);
const L1_AGENTS = new Set(['pm', 'tech_lead', 'infra_head', 'sec_lead', 'designer', 'pa']);
const L2_READ_AGENTS = new Set(['reader_scout']);

/** Upward reply word caps per tier, as documented in AGENTS.md section 1. */
export const UPWARD_WORD_CAPS: Record<AgentTier, number | null> = {
  ROOT: null, // warden replies to the human operator, not to a parent agent
  L0: 120,
  L1: 150,
  L2_READ: 150,
  L2_WRITE: 200,
};

/** Strips `@`, a project suffix (`pm:demo`), and whitespace from an agent id or slug. */
export function baseAgentId(idOrSlug: string): string {
  return String(idOrSlug || '')
    .trim()
    .replace(/^@/, '')
    .split(/[:\s]/)[0]
    .toLowerCase();
}

export function agentTier(idOrSlug: string): AgentTier {
  const base = baseAgentId(idOrSlug);
  if (ROOT_AGENTS.has(base)) return 'ROOT';
  if (L0_AGENTS.has(base)) return 'L0';
  if (L1_AGENTS.has(base)) return 'L1';
  if (L2_READ_AGENTS.has(base)) return 'L2_READ';
  return 'L2_WRITE';
}

export function upwardWordCap(idOrSlug: string): number | null {
  return UPWARD_WORD_CAPS[agentTier(idOrSlug)];
}

export interface CappedReply {
  text: string;
  truncated: boolean;
  originalWords: number;
  cap: number | null;
}

/**
 * Trims a subagent reply to its tier's upward word cap. When trimmed, a marker
 * names the run that holds the full output so the parent can fetch it on demand.
 */
export function capUpwardReply(text: string, fromAgent: string, runId?: string): CappedReply {
  const cap = upwardWordCap(fromAgent);
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (cap === null || words.length <= cap) {
    return { text: String(text || ''), truncated: false, originalWords: words.length, cap };
  }
  const where = runId ? ` Full output is stored on run ${runId}.` : '';
  return {
    text: `${words.slice(0, cap).join(' ')}\n\n[Trimmed from ${words.length} to ${cap} words by tier policy.${where}]`,
    truncated: true,
    originalWords: words.length,
    cap,
  };
}

/** Files that count as documentation, not raw source. Tier 1 and up may read these. */
const DOC_FILE = /(^|\/)(README|CHANGELOG|LICENSE|CONTRIBUTING)(\.[a-z]+)?$|\.(md|mdx|txt)$/i;

export function canReadRawSource(idOrSlug: string, relPath: string): boolean {
  const tier = agentTier(idOrSlug);
  if (tier === 'L2_READ' || tier === 'L2_WRITE') return true;
  return DOC_FILE.test(relPath);
}

/** True when `candidate` resolves to `root` itself or a path strictly inside it. */
export function isInsideRoot(root: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(root, candidate));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
