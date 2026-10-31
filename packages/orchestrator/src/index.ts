import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Auto-load root `.env` before initializing any orchestrator modules
(function loadRootEnv() {
  const parseEnvFile = (filePath: string) => {
    try {
      if (!fs.existsSync(filePath)) return false;
      const content = fs.readFileSync(filePath, "utf8");
      let foundAny = false;
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx <= 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined || process.env[key] === "") {
          process.env[key] = val;
          foundAny = true;
        }
      }
      return foundAny;
    } catch {
      return false;
    }
  };

  const startDirs = [
    process.cwd(),
    path.dirname(fileURLToPath(import.meta.url)),
  ];

  for (const startDir of startDirs) {
    let cur = startDir;
    for (let i = 0; i < 6; i++) {
      parseEnvFile(path.join(cur, ".env"));
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
})();

import { ControlPlaneServer } from "./server/ControlPlaneServer.js";

export * from "./engine/OrchestratorStore.js";
export * from "./engine/AgentRunner.js";
export * from "./engine/HierarchyRouter.js";
export * from "./engine/StandupCoordinator.js";
export * from "./watchdogs/HealthAndQuotaGuard.js";
export * from "./watchdogs/IdleBacklogMonitor.js";
export * from "./telegram/TelegramPushPager.js";
export * from "./server/ControlPlaneServer.js";
export {
  ModelRouter,
  modelRouter,
  CredentialPoolManager,
  ProviderHttpError,
  attachmentToMusePart,
  computeDeterministicTrigramEmbedding,
  normalizeVectorTo768,
  cosineSimilarity,
  parseFileEditDirectives,
  formatFileEditDirectives,
} from "./models/ModelRouter.js";
export type {
  GlobalRoutingProfile,
  StepRouteTarget,
  StepRoutingConfig,
  AgentModelRoutingConfig,
  ResolvedStepModelRoute,
  ProviderCredential,
  FailoverEvent,
  SupportedMultimodalMimeType,
  MultimodalAttachment,
  ToolParameterSchema,
  ToolDeclaration,
  ToolCallInvocation,
  ChatTurnMessage,
  MuseUsageMetadata,
  ModelGenerateRequest,
  ModelGenerateResponse,
  FileEditDirective,
} from "./models/ModelRouter.js";
export * from "./models/TokenTracker.js";
export * from "./models/ContextCompactor.js";
export {
  HybridMemoryEngine,
  hybridMemoryEngine,
  PINNED_EMBEDDING_PROVIDER,
  PINNED_EMBEDDING_MODEL_ID,
  computeKeywordMatchScore,
} from "./memory/HybridMemoryEngine.js";
export type {
  AgentProfileRecord,
  ChatMessageRecallRecord,
  CodeChunkRecord,
  RecordEpisodicMemoryInput,
  BuildAgentSystemPromptObjectParams,
  SqlQueryExecutor,
} from "./memory/HybridMemoryEngine.js";
export * from "./media/MediaUploadService.js";

export async function startOrchestrator(options?: {
  port?: number;
  host?: string;
  commandoRoot?: string;
}): Promise<ControlPlaneServer> {
  const server = new ControlPlaneServer({
    port: options?.port ?? Number(process.env.ORCHESTRATOR_PORT ?? process.env.PORT ?? 4000),
    host: options?.host ?? process.env.ORCHESTRATOR_HOST ?? "0.0.0.0",
    commandoRoot: options?.commandoRoot
  });

  await server.start();

  // 12:00 PM IST (06:30 UTC) Daily Standup Scheduler Check (every 60s)
  let lastStandupDate = "";
  const standupTimer = setInterval(() => {
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const todayKey = now.toISOString().slice(0, 10);

    if (utcHours === 6 && utcMinutes === 30 && lastStandupDate !== todayKey) {
      lastStandupDate = todayKey;
      void server.standupCoordinator.runDailyStandup("scheduled_12pm_ist").catch((err) => {
        console.error("[Orchestrator] Failed to run scheduled 12:00 PM IST standup:", err);
      });
    }
  }, 60_000);

  const shutdown = async (signal: string) => {
    console.log(`\n[Orchestrator] Received ${signal}. Shutting down gracefully...`);
    clearInterval(standupTimer);
    await server.stop();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  return server;
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/^file:\/\//, ""));

if (isMain) {
  startOrchestrator().catch((err) => {
    console.error("[Orchestrator] Fatal startup error:", err);
    process.exit(1);
  });
}
