#!/usr/bin/env node
/**
 * DynamoCommando Bi-Directional Markdown <-> Database Sync CLI (`scripts/sync-md-db.ts`)
 *
 * Usage:
 *   node scripts/sync-md-db.ts                       # Bi-directional sync (Disk -> DB -> Disk)
 *   node scripts/sync-md-db.ts --direction=disk-to-db
 *   node scripts/sync-md-db.ts --direction=db-to-disk
 *   node scripts/sync-md-db.ts --direction=both
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dbStore,
  syncBiDirectional,
  syncDbToDisk,
  syncDiskToDb,
} from '../packages/db/src/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..');

async function main() {
  const args = process.argv.slice(2);
  const dirArg = args.find((a) => a.startsWith('--direction='))?.split('=')[1] || 'both';
  const writeNewBacklogFiles = args.includes('--write-new-backlog');

  console.log('====================================================================');
  console.log(` DynamoCommando — Bi-Directional IDE Markdown <-> DB Sync (${dirArg})`);
  console.log('====================================================================');

  const { mode } = await dbStore.init();
  console.log(` • Storage Mode       : ${mode.toUpperCase()} (${dbStore.getSnapshotPath()})`);
  console.log(` • Active Routing     : ${dbStore.getStatus().activeRoutingProfile}`);

  if (dirArg === 'disk-to-db') {
    const res = await syncDiskToDb({ workspaceRoot: WORKSPACE_ROOT, writeNewBacklogFiles });
    console.log(
      ` • Disk -> DB Synced  : ${res.projectContextsSynced} contexts, ${res.agentMemoriesSynced} memories, ${res.backlogItemsSynced} backlog items, ${res.sprintsSynced} sprints, ${res.chatThreadsSynced} chat threads, ${res.chatMessagesSynced} chat messages, ${res.contractsSynced} contracts`
    );
  } else if (dirArg === 'db-to-disk') {
    const res = await syncDbToDisk({ workspaceRoot: WORKSPACE_ROOT, writeNewBacklogFiles });
    console.log(
      ` • DB -> Disk Updated : ${res.contextFilesUpdated} context files, ${res.memoryFilesUpdated} memory files, ${res.backlogFilesUpdated} backlog files, ${res.standupFilesUpdated} standup files, ${res.contractFilesUpdated} contract files`
    );
  } else {
    const res = await syncBiDirectional({ workspaceRoot: WORKSPACE_ROOT, writeNewBacklogFiles });
    console.log(
      ` • Disk -> DB Synced  : ${res.diskToDb.projectContextsSynced} contexts, ${res.diskToDb.agentMemoriesSynced} memories, ${res.diskToDb.backlogItemsSynced} backlog items, ${res.diskToDb.sprintsSynced} sprints, ${res.diskToDb.chatThreadsSynced} chat threads, ${res.diskToDb.chatMessagesSynced} chat messages, ${res.diskToDb.contractsSynced} contracts`
    );
    console.log(
      ` • DB -> Disk Updated : ${res.dbToDisk.contextFilesUpdated} context files, ${res.dbToDisk.memoryFilesUpdated} memory files, ${res.dbToDisk.backlogFilesUpdated} backlog files, ${res.dbToDisk.standupFilesUpdated} standup files, ${res.dbToDisk.contractFilesUpdated} contract files`
    );
  }

  const status = dbStore.getStatus();
  console.log(
    ` • DB Table Counts    : ${status.counts.agents} agents, ${status.counts.project_contexts} contexts, ${status.counts.chat_threads} threads, ${status.counts.chat_messages} messages, ${status.counts.agent_memories} memories, ${status.counts.backlog_items} backlog items, ${status.counts.contracts} contracts`
  );
  console.log('====================================================================\n');

  await dbStore.close();
}

main().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
