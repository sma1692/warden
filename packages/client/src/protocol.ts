/**
 * Wire protocol between the Warden control plane and the client agent.
 * Mirrored by `packages/orchestrator/src/client/commandQueue.ts`; keep the
 * two in sync. The published client is dependency-free, so these types are
 * intentionally duplicated instead of imported.
 */

export type ClientCommand =
  | { id: string; kind: 'read_file'; path: string }
  | { id: string; kind: 'write_file'; path: string; content: string }
  | {
      id: string;
      kind: 'pushit';
      summary: string;
      bullets?: string[];
      targetBranch?: string;
      skipPush?: boolean;
    };

export interface CommandResult {
  id: string;
  ok: boolean;
  output?: string;
  error?: string;
}

export interface PollResponse {
  ok: boolean;
  commands?: ClientCommand[];
  error?: string;
}
