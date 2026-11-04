import fs from 'node:fs/promises';
import path from 'node:path';
import type { ClientCommand, CommandResult } from './protocol.js';
import { assertReadable, resolveInside } from './jail.js';
import { runPushit } from './pushit.js';

const MAX_READ_BYTES = 256 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;

/** Executes one allowlisted command inside the workspace. Never throws. */
export async function executeCommand(
  workspace: string,
  cmd: ClientCommand
): Promise<CommandResult> {
  try {
    switch (cmd.kind) {
      case 'read_file': {
        assertReadable(cmd.path);
        const abs = resolveInside(workspace, cmd.path);
        const stat = await fs.stat(abs);
        if (!stat.isFile()) {
          return { id: cmd.id, ok: false, error: `not a file: ${cmd.path}` };
        }
        if (stat.size > MAX_READ_BYTES) {
          return { id: cmd.id, ok: false, error: `file too large: ${stat.size} bytes` };
        }
        return { id: cmd.id, ok: true, output: await fs.readFile(abs, 'utf8') };
      }
      case 'write_file': {
        const content = cmd.content ?? '';
        if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
          return { id: cmd.id, ok: false, error: 'content exceeds 1MB cap' };
        }
        const abs = resolveInside(workspace, cmd.path);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content, 'utf8');
        return { id: cmd.id, ok: true, output: `wrote ${content.length} chars to ${cmd.path}` };
      }
      case 'pushit': {
        const out = await runPushit({
          workspace,
          summary: cmd.summary,
          bullets: cmd.bullets,
          targetBranch: cmd.targetBranch,
          skipPush: cmd.skipPush,
        });
        if (!out.committed) {
          return { id: cmd.id, ok: true, output: 'nothing to commit' };
        }
        return {
          id: cmd.id,
          ok: true,
          output: `committed ${out.sha} on ${out.branch}${out.pushed ? ' (pushed)' : ''}: ${out.header}`,
        };
      }
      default:
        return {
          id: (cmd as { id?: string }).id ?? 'unknown',
          ok: false,
          error: `unknown command kind: ${(cmd as { kind?: string }).kind}`,
        };
    }
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
