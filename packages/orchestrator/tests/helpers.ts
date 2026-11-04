/**
 * Shared fixtures for the offline smoke suite.
 *
 * Every test constructs its own in-memory store. Nothing touches Postgres,
 * Docker, or the network: WARDEN_SOURCE=md plus no connect call keeps all
 * persistence paths in their in-memory branches.
 */
process.env.WARDEN_SOURCE = 'md';

import { OrchestratorStore } from '../src/engine/OrchestratorStore.js';
import type {
  AgentRecord,
  AgentRunRecord,
} from '../src/engine/OrchestratorStore.js';

export function newTestStore(): OrchestratorStore {
  process.env.WARDEN_SOURCE = 'md';
  return new OrchestratorStore();
}

let agentSeq = 0;

type CreateAgentInput = Parameters<OrchestratorStore['createAgent']>[0];

export async function createTestAgent(
  store: OrchestratorStore,
  overrides: Partial<CreateAgentInput> = {}
): Promise<AgentRecord> {
  agentSeq += 1;
  return store.createAgent({
    slug: `@testdev${agentSeq}`,
    name: `Test Dev ${agentSeq}`,
    department: 'Tech',
    hierarchy_level: 2,
    init_prompt: 'smoke-test agent',
    ...overrides,
  });
}

export function createTestRun(
  store: OrchestratorStore,
  agent: AgentRecord,
  overrides: Partial<AgentRunRecord> = {}
): AgentRunRecord {
  return store.createRun({
    agent_id: agent.id,
    agent_slug: agent.slug,
    parent_run_id: null,
    chat_thread_id: null,
    sprint_id: null,
    backlog_item_id: null,
    trigger_type: 'CEO_CHAT',
    input_prompt: 'smoke-test run',
    output_summary: null,
    status: 'RUNNING',
    container_id: null,
    git_branch: null,
    git_commit_sha: null,
    preview_url: null,
    qa_passed: null,
    qa_screenshot_url: null,
    ...overrides,
  });
}

export function minutesAgo(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}
