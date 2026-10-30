/**
 * @commando/db — DynamoCommando Database & Vector Layer (PostgreSQL 16 + pgvector + Drizzle ORM)
 *
 * Exports:
 * - Schema definitions & TypeScript row interfaces for all 13 DynamoCommando tables (`schema.ts`)
 * - Seed roster for all 19 corporate & technical hierarchy agents, provider credentials, & routing profiles (`seed-agents.ts`)
 * - PostgreSQL + pgvector client & deterministic 768-dim embedding helpers (`client.ts`)
 * - Dual-mode DatabaseStore (`dbStore`, `db`) supporting live PostgreSQL + pgvector and local JSON fallback (`store.ts`)
 * - Bi-Directional IDE Markdown <-> DB sync engine (`sync.ts`)
 */

export * from './schema.ts';
export * from './seed-agents.ts';
export * from './client.ts';
export * from './store.ts';
export * from './sync.ts';
