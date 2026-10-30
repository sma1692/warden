#!/usr/bin/env node
/**
 * COMMANDO — Programmatic Vertex AI / Gemini Orchestrator & 12:00 PM IST Standup Runner
 *
 * Bypasses IDE UI permission prompts by running the Commando agent hierarchy
 * (`warden`, `cto`, `pm`, `tech_lead`, `infra_head`, `backend_dev`, `frontend_dev`, `infra_jr`)
 * directly against Google Cloud Vertex AI (or Gemini API) with native Node.js tool execution.
 *
 * Usage:
 *   node scripts/commando-vertex.mjs standup [--auto-execute]
 *   node scripts/commando-vertex.mjs daemon [--interval=8h] [--auto-execute]
 *   node scripts/commando-vertex.mjs chat [@agent] [project]
 *   node scripts/commando-vertex.mjs ask "@infra_head" "What is the status of the infra repo?"
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── 1. Load .env if present (zero external dependency required) ──────────────
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}
loadEnvFile(path.join(ROOT, '.env'));

// ── 2. Configuration & Model Routing ─────────────────────────────────────────
const CONFIG = {
  project: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID || '',
  location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
  apiKey: process.env.GEMINI_API_KEY || process.env.VERTEX_API_KEY || '',
  proModel: process.env.COMMANDO_PRO_MODEL || 'gemini-2.5-pro',
  defaultModel: process.env.COMMANDO_DEFAULT_MODEL || 'gemini-2.5-flash',
  standupTimeIst: process.env.STANDUP_TIME_IST || '12:00',
};

// ── 2b. Project Registry (projects.yaml + optional private-data/vertex/config.json) ──
function loadProjectSlugs() {
  // Minimal parser for the `projects:` map in projects.yaml (zero dependencies).
  const file = path.join(ROOT, 'projects.yaml');
  if (!fs.existsSync(file)) return [];
  const out = [];
  let inProjects = false;
  let current = null;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\S/.test(raw)) {
      inProjects = /^projects:\s*$/.test(raw);
      current = null;
      continue;
    }
    if (!inProjects) continue;
    const key = raw.match(/^  (['"]?)([^'"\s:#][^'":#]*)\1:\s*$/);
    if (key) {
      current = { slug: key[2].trim(), department: 'tech' };
      out.push(current);
      continue;
    }
    const dept = raw.match(/^    department:\s*['"]?([^'"#\s]+)/);
    if (dept && current) current.department = dept[1];
  }
  return out;
}

function loadVertexConfig() {
  const projects = loadProjectSlugs();
  const tech = projects.filter((p) => p.department !== 'infra').map((p) => p.slug);
  const infra = projects.filter((p) => p.department === 'infra').map((p) => p.slug);
  const fallback = {
    defaultProject: process.env.COMMANDO_DEFAULT_PROJECT || tech[0] || 'my-project',
    infraProject: process.env.COMMANDO_INFRA_PROJECT || infra[0] || 'infra',
    knownProjects: projects.map((p) => p.slug),
    pmContextProjects: projects.map((p) => p.slug),
    standupLeads: null,
  };
  const privateFile = path.join(ROOT, 'private-data', 'vertex', 'config.json');
  if (!fs.existsSync(privateFile)) return fallback;
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(privateFile, 'utf8')) };
  } catch (err) {
    console.warn(`[commando-vertex] Ignoring invalid ${privateFile}: ${err.message}`);
    return fallback;
  }
}
const VERTEX_CFG = loadVertexConfig();

function fillTemplate(text, vars) {
  return String(text).replace(/\$\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

function getStandupLeads() {
  if (Array.isArray(VERTEX_CFG.standupLeads) && VERTEX_CFG.standupLeads.length) return VERTEX_CFG.standupLeads;
  const leads = [
    {
      agent: 'pm',
      project: '',
      prompt:
        'We are in the 12:00 PM IST Daily Standup (${dateStr}).\n' +
        '1. Review worklist/inbox.md and worklist/todo/.\n' +
        `2. Provide your concise Standup update: (a) Inbox items ready to triage into P0/P1/P2 specs, (b) Recommended top priorities across ${VERTEX_CFG.knownProjects.join(', ') || 'all projects'} for today's sprint, and (c) Any business/GTM questions for the CEO.`,
    },
  ];
  for (const slug of VERTEX_CFG.knownProjects) {
    const isInfra = slug === VERTEX_CFG.infraProject;
    leads.push({
      agent: isInfra ? 'infra_head' : 'tech_lead',
      project: slug,
      prompt:
        'We are in the 12:00 PM IST Daily Standup (${dateStr}).\n' +
        'Live Git Snapshot:\n${gitSnapshot}\n\n' +
        `Provide your concise ${slug} ${isInfra ? 'Infra Head' : 'Tech Lead'} standup report: (a) What shipped/changed across its repos, (b) Proposed tasks for today, and (c) Any cross-team dependencies.`,
    });
  }
  return leads;
}

// ── 3. File & Repo Helpers ───────────────────────────────────────────────────
function readSafe(relOrAbsPath, maxChars = 24000) {
  const full = path.isAbsolute(relOrAbsPath) ? relOrAbsPath : path.join(ROOT, relOrAbsPath);
  if (!fs.existsSync(full)) return '';
  const text = fs.readFileSync(full, 'utf8');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;
}

function getTodayDateIst() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now); // YYYY-MM-DD in IST
}

function getIstTimeHHMM() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return fmt.format(now); // HH:MM in IST
}

const SESSION_ID = `vertex-${Date.now().toString(36).slice(-5)}`;
function getSessionChatPath() {
  const dateStr = getTodayDateIst();
  const chatDir = path.join(ROOT, 'chats');
  fs.mkdirSync(chatDir, { recursive: true });
  return path.join(chatDir, `${dateStr}-session-${SESSION_ID}.md`);
}

function appendSessionLog(sender, recipient, message) {
  const chatFile = getSessionChatPath();
  if (!fs.existsSync(chatFile)) {
    fs.writeFileSync(
      chatFile,
      `# Commando Session Log — ${getTodayDateIst()} (${SESSION_ID})\n\n` +
        `> **Runner**: \`scripts/commando-vertex.mjs\`\n\n---\n\n`,
      'utf8'
    );
  }
  const ts = new Date().toISOString();
  const entry = `### [${ts}] \`${sender}\` -> \`${recipient}\`\n\n${message.trim()}\n\n---\n\n`;
  fs.appendFileSync(chatFile, entry, 'utf8');
}

function getRepoGitSnapshot() {
  const topoPath = path.join(ROOT, '.state/topology-cache.json');
  if (!fs.existsSync(topoPath)) return 'No .state/topology-cache.json found.';
  const topo = JSON.parse(fs.readFileSync(topoPath, 'utf8'));
  const lines = [];
  for (const [projName, proj] of Object.entries(topo.projects || {})) {
    lines.push(`## Project: ${projName}`);
    for (const folder of proj.folders || []) {
      const p = folder.path;
      if (!fs.existsSync(p)) {
        lines.push(`- ${folder.name} (${p}): [PATH NOT FOUND]`);
        continue;
      }
      try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: p, encoding: 'utf8' }).trim();
        const status = execSync('git status --short', { cwd: p, encoding: 'utf8' }).trim();
        const lastCommit = execSync('git log -n 2 --oneline', { cwd: p, encoding: 'utf8' }).trim();
        lines.push(
          `- **${folder.name}** (\`${p}\`, role: \`${folder.role}\`, branch: \`${branch}\`):\n` +
            `  - Dirty files: ${status ? `\n\`\`\`\n${status}\n\`\`\`` : 'Clean'}\n` +
            `  - Recent commits:\n\`\`\`\n${lastCommit}\n\`\`\``
        );
      } catch {
        lines.push(`- **${folder.name}** (\`${p}\`): [Not a git repo or git error]`);
      }
    }
  }
  return lines.join('\n');
}

// ── 4. Agent Hierarchy Registry & Context Loader ─────────────────────────────
function buildAgentProfile(agentName, projectScope = '') {
  const normalized = agentName.replace(/^@/, '').toLowerCase();
  const proj = projectScope || (normalized.includes('infra') ? VERTEX_CFG.infraProject : VERTEX_CFG.defaultProject);

  const baseRules =
    `You are operating inside COMMANDO (${ROOT}), the Founder/CEO's enterprise agent command center.\n` +
    `Current IST Date/Time: ${getTodayDateIst()} ${getIstTimeHHMM()} IST.\n` +
    `You have autonomous tools (read_file, write_file, edit_file, list_tree, run_command) with zero UI prompts.\n` +
    `Always keep your memory file (memory/*.md) and repo context file (context/*.md) updated when you make changes.\n`;

  switch (normalized) {
    case 'warden':
      return {
        name: 'warden',
        role: 'CEO Office Chief of Staff (Root)',
        model: CONFIG.proModel,
        systemInstruction:
          baseRules +
          readSafe('AGENTS.md', 16000) +
          '\n\n## CTO Executive Context:\n' +
          readSafe('context/cto.md', 10000),
      };

    case 'cto':
      return {
        name: 'cto',
        role: 'Level 0 Head of Tech (Argon High / Pro)',
        model: CONFIG.proModel,
        systemInstruction:
          baseRules +
          readSafe('.claude/agents/cto.md', 8000) +
          '\n\n## CTO Context (context/cto.md):\n' +
          readSafe('context/cto.md', 12000) +
          '\n\n## CTO Procedural Memory (memory/cto.md):\n' +
          readSafe('memory/cto.md', 8000),
      };

    case 'cbo':
      return {
        name: 'cbo',
        role: 'Level 0 Chief Business Officer (Argon High / Pro)',
        model: CONFIG.proModel,
        systemInstruction:
          baseRules +
          readSafe('.claude/agents/cbo.md', 8000) +
          '\n\n## CBO Executive Context (context/cbo.md):\n' +
          readSafe('context/cbo.md', 12000) +
          '\n\n## CBO Procedural Memory (memory/cbo.md):\n' +
          readSafe('memory/cbo.md', 8000) +
          '\n\n## Collated Master Backlog (worklist/COLLATED_BACKLOG.md):\n' +
          readSafe('worklist/COLLATED_BACKLOG.md', 16000),
      };

    case 'pm':
      return {
        name: 'pm',
        role: 'Level 1 Product Manager (Backlog, Inbox & GTM)',
        model: CONFIG.defaultModel,
        systemInstruction:
          baseRules +
          readSafe('.claude/agents/pm.md', 8000) +
          '\n\n## PM Procedural Memory (memory/pm.md):\n' +
          readSafe('memory/pm.md', 8000) +
          '\n\n## CEO Raw Backlog Inbox (worklist/inbox.md):\n' +
          readSafe('worklist/inbox.md', 8000) +
          '\n\n## Project Contexts:\n' +
          VERTEX_CFG.pmContextProjects.map((slug) => readSafe(`context/${slug}.md`, 8000)).join('\n'),
      };

    case 'tech_lead':
      return {
        name: `tech_lead (${proj})`,
        role: `Level 1 Project Tech Lead — ${proj}`,
        model: CONFIG.defaultModel,
        systemInstruction:
          baseRules +
          readSafe('.claude/agents/tech_lead.md', 8000) +
          `\n\n## Tech Lead Memory (memory/${proj}/tech_lead.md):\n` +
          readSafe(`memory/${proj}/tech_lead.md`, 8000) +
          `\n\n## Project Context (context/${proj}.md):\n` +
          readSafe(`context/${proj}.md`, 12000),
      };

    case 'infra_head':
      return {
        name: 'infra_head',
        role: `Level 1 Head of Infrastructure (${VERTEX_CFG.infraProject} & Cloud Ops)`,
        model: CONFIG.defaultModel,
        systemInstruction:
          baseRules +
          readSafe('.claude/agents/infra_head.md', 8000) +
          '\n\n## Infra Head Memory (memory/infra_head.md):\n' +
          readSafe('memory/infra_head.md', 8000) +
          `\n\n## Infra Project Context (context/${VERTEX_CFG.infraProject}.md):\n` +
          readSafe(`context/${VERTEX_CFG.infraProject}.md`, 10000) +
          `\n\n## Repo Technical Context (context/${VERTEX_CFG.infraProject}/${VERTEX_CFG.infraProject}.md):\n` +
          readSafe(`context/${VERTEX_CFG.infraProject}/${VERTEX_CFG.infraProject}.md`, 12000),
      };

    case 'infra_jr':
      return {
        name: 'infra_jr',
        role: `Level 2 Infrastructure & DevOps Engineer (${VERTEX_CFG.infraProject})`,
        model: CONFIG.defaultModel,
        systemInstruction:
          baseRules +
          readSafe('.claude/agents/infra_jr.md', 8000) +
          '\n\n## Infra Jr Memory (memory/infra_jr.md):\n' +
          readSafe('memory/infra_jr.md', 8000) +
          `\n\n## Repo Technical Context (context/${VERTEX_CFG.infraProject}/${VERTEX_CFG.infraProject}.md):\n` +
          readSafe(`context/${VERTEX_CFG.infraProject}/${VERTEX_CFG.infraProject}.md`, 14000),
      };

    case 'backend_dev':
      return {
        name: `backend_dev (${proj})`,
        role: `Level 2 Backend Developer — ${proj}`,
        model: CONFIG.defaultModel,
        systemInstruction:
          baseRules +
          readSafe('.claude/agents/backend_dev.md', 8000) +
          `\n\n## Backend Dev Memory (memory/${proj}/backend_dev.md):\n` +
          readSafe(`memory/${proj}/backend_dev.md`, 8000) +
          `\n\n## Project Context (context/${proj}.md):\n` +
          readSafe(`context/${proj}.md`, 10000),
      };

    case 'frontend_dev':
      return {
        name: `frontend_dev (${proj})`,
        role: `Level 2 Frontend Developer — ${proj}`,
        model: CONFIG.defaultModel,
        systemInstruction:
          baseRules +
          readSafe('.claude/agents/frontend_dev.md', 8000) +
          `\n\n## Frontend Dev Memory (memory/${proj}/frontend_dev.md):\n` +
          readSafe(`memory/${proj}/frontend_dev.md`, 8000) +
          `\n\n## Project Context (context/${proj}.md):\n` +
          readSafe(`context/${proj}.md`, 10000),
      };

    default:
      throw new Error(
        `Unknown agent "${agentName}". Valid agents: @warden, @cto, @pm, @tech_lead <project>, @infra_head, @backend_dev <project>, @frontend_dev <project>, @infra_jr`
      );
  }
}

// ── 5. Autonomous Tool Declarations & Executor (Zero Permission Prompts) ─────
const TOOL_DECLARATIONS = [
  {
    name: 'read_file',
    description: 'Read a file from Commando or any project repository on disk.',
    parameters: {
      type: 'OBJECT',
      properties: {
        filePath: { type: 'STRING', description: 'Absolute path or path relative to Commando root.' },
        startLine: { type: 'INTEGER', description: 'Optional 1-based start line.' },
        endLine: { type: 'INTEGER', description: 'Optional 1-based end line.' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file on disk (creates parent directories automatically).',
    parameters: {
      type: 'OBJECT',
      properties: {
        filePath: { type: 'STRING', description: 'Absolute path or path relative to Commando root.' },
        content: { type: 'STRING', description: 'Full file content to write.' },
      },
      required: ['filePath', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace an exact target string in an existing file with replacement content.',
    parameters: {
      type: 'OBJECT',
      properties: {
        filePath: { type: 'STRING', description: 'Absolute path or path relative to Commando root.' },
        target: { type: 'STRING', description: 'Exact string to find.' },
        replacement: { type: 'STRING', description: 'Replacement string.' },
      },
      required: ['filePath', 'target', 'replacement'],
    },
  },
  {
    name: 'list_tree',
    description: 'List directory contents up to a specified depth.',
    parameters: {
      type: 'OBJECT',
      properties: {
        dirPath: { type: 'STRING', description: 'Absolute or Commando-relative directory path.' },
        maxDepth: { type: 'INTEGER', description: 'Max recursion depth (default 2).' },
      },
      required: ['dirPath'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command in a specified working directory (git, npm, node, build, deploy).',
    parameters: {
      type: 'OBJECT',
      properties: {
        cwd: { type: 'STRING', description: 'Working directory (absolute or relative to Commando root).' },
        command: { type: 'STRING', description: 'Shell command to execute.' },
      },
      required: ['cwd', 'command'],
    },
  },
];

function executeToolCall(call) {
  const args = call.args || {};
  try {
    if (call.name === 'read_file') {
      const full = path.isAbsolute(args.filePath) ? args.filePath : path.join(ROOT, args.filePath);
      if (!fs.existsSync(full)) return { error: `File not found: ${full}` };
      const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
      const s = Math.max(1, args.startLine || 1);
      const e = Math.min(lines.length, args.endLine || Math.min(lines.length, s + 400));
      return {
        filePath: full,
        totalLines: lines.length,
        content: lines
          .slice(s - 1, e)
          .map((l, idx) => `${s + idx}: ${l}`)
          .join('\n'),
      };
    }

    if (call.name === 'write_file') {
      const full = path.isAbsolute(args.filePath) ? args.filePath : path.join(ROOT, args.filePath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, args.content, 'utf8');
      return { ok: true, filePath: full, bytesWritten: Buffer.byteLength(args.content, 'utf8') };
    }

    if (call.name === 'edit_file') {
      const full = path.isAbsolute(args.filePath) ? args.filePath : path.join(ROOT, args.filePath);
      if (!fs.existsSync(full)) return { error: `File not found: ${full}` };
      const content = fs.readFileSync(full, 'utf8');
      if (!content.includes(args.target)) {
        return { error: `Target string not found in ${full}` };
      }
      const updated = content.replace(args.target, args.replacement);
      fs.writeFileSync(full, updated, 'utf8');
      return { ok: true, filePath: full };
    }

    if (call.name === 'list_tree') {
      const full = path.isAbsolute(args.dirPath) ? args.dirPath : path.join(ROOT, args.dirPath);
      const depth = args.maxDepth || 2;
      const out = execSync(`node "${path.join(ROOT, 'scripts/repo-tool.mjs')}" tree "${full}" ${depth}`, {
        encoding: 'utf8',
      });
      return { tree: out.slice(0, 16000) };
    }

    if (call.name === 'run_command') {
      const cwd = path.isAbsolute(args.cwd) ? args.cwd : path.join(ROOT, args.cwd || '.');
      const output = execSync(args.command, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000,
      });
      return { ok: true, cwd, output: output.slice(0, 16000) };
    }

    return { error: `Unknown tool: ${call.name}` };
  } catch (err) {
    return {
      error: err.message,
      stdout: err.stdout ? String(err.stdout).slice(0, 4000) : undefined,
      stderr: err.stderr ? String(err.stderr).slice(0, 4000) : undefined,
    };
  }
}

// ── 6. Vertex AI & Gemini REST Client with Automatic Tool Loop ───────────────
function getVertexAccessToken() {
  if (process.env.VERTEX_ACCESS_TOKEN) return process.env.VERTEX_ACCESS_TOKEN;
  try {
    return execSync('gcloud auth application-default print-access-token 2>/dev/null || gcloud auth print-access-token', {
      encoding: 'utf8',
    }).trim();
  } catch {
    throw new Error(
      'Vertex AI credentials not found. Set GEMINI_API_KEY / VERTEX_API_KEY in .env, OR set GOOGLE_CLOUD_PROJECT and run `gcloud auth application-default login`.'
    );
  }
}

async function callModelGenerate({ model, systemInstruction, contents, enableTools = true }) {
  let url = '';
  const headers = { 'Content-Type': 'application/json' };

  // TOKEN SAVING OPTIMIZATION: Compress multimodal contexts (images) to save tokens, 
  // particularly for designer / UI iteration tasks that span multiple turns.
  const optimizedContents = contents.map(turn => {
    if (!turn.parts) return turn;
    return {
      ...turn,
      parts: turn.parts.map(part => {
        if (part.inlineData && part.inlineData.mimeType.startsWith('image/')) {
           // We cap base64 image string length to avoid blowing up the context window.
           // Images exceeding ~2MB base64 are stripped from historical context.
           if (part.inlineData.data.length > 2000000) {
             console.warn(`[Token Optimizer] Stripping large image from context to save tokens.`);
             return { text: '[LARGE IMAGE COMPRESSED/REDACTED FOR TOKEN OPTIMIZATION]' };
           }
        }
        return part;
      })
    };
  });

  if (CONFIG.apiKey) {
    // Direct Gemini / Vertex Express API Key endpoint
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${CONFIG.apiKey}`;
  } else if (CONFIG.project) {
    // Google Cloud Vertex AI Regional / Global Endpoint
    const token = getVertexAccessToken();
    headers.Authorization = `Bearer ${token}`;
    const host =
      CONFIG.location === 'global'
        ? 'aiplatform.googleapis.com'
        : `${CONFIG.location}-aiplatform.googleapis.com`;
    url = `https://${host}/v1/projects/${CONFIG.project}/locations/${CONFIG.location}/publishers/google/models/${model}:generateContent`;
  } else {
    throw new Error(
      'Missing credentials in .env: set either GEMINI_API_KEY (or VERTEX_API_KEY) OR GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION.'
    );
  }

  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: optimizedContents,
    generationConfig: {
      temperature: 0.2,
    },
  };

  if (enableTools) {
    body.tools = [{ functionDeclarations: TOOL_DECLARATIONS }];
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Model API error (${res.status}): ${errText}`);
  }

  return res.json();
}

async function runAgentTurn(profile, conversationContents, { maxToolSteps = 12, enableTools = true } = {}) {
  for (let step = 0; step < maxToolSteps; step++) {
    const data = await callModelGenerate({
      model: profile.model,
      systemInstruction: profile.systemInstruction,
      contents: conversationContents,
      enableTools,
    });

    const candidate = data.candidates?.[0];
    const content = candidate?.content;
    if (!content?.parts?.length) {
      return '[No response from model]';
    }

    conversationContents.push(content);

    const functionCalls = content.parts.filter((p) => p.functionCall).map((p) => p.functionCall);
    if (functionCalls.length === 0) {
      const text = content.parts
        .filter((p) => p.text)
        .map((p) => p.text)
        .join('\n');
      return text;
    }

    const responseParts = [];
    for (const fc of functionCalls) {
      console.log(`  🔧 [${profile.name}] -> ${fc.name}(${JSON.stringify(fc.args || {}).slice(0, 100)})`);
      const result = executeToolCall(fc);
      responseParts.push({
        functionResponse: {
          name: fc.name,
          response: result,
        },
      });
    }

    conversationContents.push({
      role: 'user',
      parts: responseParts,
    });
  }

  return '[Reached max tool iterations]';
}

// ── 7. Daily 12:00 PM IST Standup Orchestrator ───────────────────────────────
async function runDailyStandup({ autoExecute = false } = {}) {
  const dateStr = getTodayDateIst();
  const standupFile = path.join(ROOT, 'standups', `${dateStr}-standup.md`);
  fs.mkdirSync(path.dirname(standupFile), { recursive: true });

  console.log(`\n================================================================`);
  console.log(`🚀 COMMANDO DAILY STANDUP — ${dateStr} (${getIstTimeHHMM()} IST)`);
  console.log(`================================================================\n`);

  const gitSnapshot = getRepoGitSnapshot();

  // Step 1: Poll Level 1 Senior Leads in parallel (pm, tech_lead per project, infra_head)
  console.log(`📡 Stage 1: Polling Level 1 Senior Leads (${VERTEX_CFG.standupLeadsLabel || 'pm, tech_leads, infra_head'})...`);

  const leads = getStandupLeads().map(({ agent, project, prompt }) => ({
    profile: buildAgentProfile(agent, project || ''),
    prompt: fillTemplate(prompt, { dateStr, gitSnapshot }),
  }));

  const reports = await Promise.all(
    leads.map(async ({ profile, prompt }) => {
      appendSessionLog('cto', profile.name, prompt);
      const reply = await runAgentTurn(profile, [{ role: 'user', parts: [{ text: prompt }] }], {
        enableTools: false,
      });
      appendSessionLog(profile.name, 'cto', reply);
      console.log(`  ✅ Received standup report from ${profile.name}`);
      return `### Report from ${profile.name} (${profile.role}):\n${reply}`;
    })
  );

  // Step 2: CTO synthesizes MoM & Sprint Plan into standups/<YYYY-MM-DD>-standup.md
  console.log(`\n🧠 Stage 2: CTO (Pro / Argon High) synthesizing MoM & Daily Sprint Plan...`);
  const ctoProfile = buildAgentProfile('cto');
  const templateText = readSafe('standups/TEMPLATE.md', 6000);
  const ctoPrompt =
    `Synthesize the 12:00 PM IST Daily Standup Minutes of Meeting (MoM) & Sprint Execution Plan for ${dateStr}.\n\n` +
    `Follow this exact Markdown template structure:\n\`\`\`markdown\n${templateText}\n\`\`\`\n\n` +
    `Here are the reports from your Level 1 leads:\n\n${reports.join('\n\n---\n\n')}\n\n` +
    `Output ONLY the complete markdown content for standups/${dateStr}-standup.md.`;

  appendSessionLog('warden', 'cto', ctoPrompt);
  const momMarkdown = await runAgentTurn(ctoProfile, [{ role: 'user', parts: [{ text: ctoPrompt }] }], {
    enableTools: false,
  });
  appendSessionLog('cto', 'warden', momMarkdown);

  fs.writeFileSync(standupFile, momMarkdown, 'utf8');
  console.log(`\n📝 Standup MoM written to: ${standupFile}\n`);
  console.log(momMarkdown);

  // Step 3: CEO Approval Gate
  let approved = autoExecute;
  let ceoNotes = 'Approved as proposed.';
  if (!autoExecute && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      '\n👔 [CEO Approval Gate] Execute today\'s sprint plan now? (y / n / or type custom instructions): '
    );
    rl.close();
    const clean = answer.trim();
    if (!clean || clean.toLowerCase() === 'n' || clean.toLowerCase() === 'no') {
      console.log('\n⏸️  Standup saved in AWAITING_CEO_APPROVAL state. Run again or edit standups/ when ready.\n');
      return;
    }
    approved = true;
    if (clean.toLowerCase() !== 'y' && clean.toLowerCase() !== 'yes') {
      ceoNotes = clean;
    }
  }

  if (approved) {
    console.log(`\n⚡ Stage 3: Executing Approved Sprint Plan (${ceoNotes})...`);
    const execPrompt =
      `The CEO approved today's Standup Sprint Plan (${dateStr}) with note: "${ceoNotes}".\n` +
      `Use your tools (read_file, write_file, edit_file, run_command) to execute the top priority items in the Sprint Plan, update context/ and memory/ files, and update ${standupFile} status to APPROVED_EXECUTING / DEPLOYED_AND_PUSHED.`;
    appendSessionLog('CEO', 'cto', execPrompt);
    const execSummary = await runAgentTurn(
      ctoProfile,
      [
        { role: 'user', parts: [{ text: ctoPrompt }] },
        { role: 'model', parts: [{ text: momMarkdown }] },
        { role: 'user', parts: [{ text: execPrompt }] },
      ],
      { enableTools: true, maxToolSteps: 20 }
    );
    appendSessionLog('cto', 'CEO', execSummary);
    console.log(`\n✅ Sprint Execution Complete:\n\n${execSummary}\n`);
  }
}

// ── 8. Interactive Direct-to-Agent (@agent) CLI REPL ─────────────────────────
async function runInteractiveChat(initialAgent = '@warden', initialProject = '') {
  let currentAgent = initialAgent;
  let currentProject = initialProject;
  let profile = buildAgentProfile(currentAgent, currentProject);
  let history = [];

  console.log(`\n================================================================`);
  console.log(`🎙️  COMMANDO DIRECT-TO-AGENT CLI (Vertex AI / Gemini Autonomous)`);
  console.log(`================================================================`);
  console.log(`Active Agent : @${profile.name} — ${profile.role} [Model: ${profile.model}]`);
  console.log(`Session Log  : ${getSessionChatPath()}`);
  console.log(`Switch Agent : Type "@cto", "@pm", "@infra_head", "@infra_jr", "@tech_lead <project>", "@backend_dev <project>", etc.`);
  console.log(`Standup      : Type "/standup" to run the 12:00 PM IST Daily Standup.`);
  console.log(`Exit         : Type "exit" or Ctrl+C.\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  while (true) {
    const input = (await rl.question(`\n[CEO -> @${profile.name}] > `)).trim();
    if (!input) continue;
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') break;

    if (input.toLowerCase() === '/standup' || input.toLowerCase() === 'standup') {
      await runDailyStandup({ autoExecute: false });
      continue;
    }

    // Check if user is switching or addressing an @agent directly
    if (input.startsWith('@')) {
      const tokens = input.split(/\s+/);
      const targetAgent = tokens[0];
      const knownProjects = VERTEX_CFG.knownProjects.map((p) => p.toLowerCase());
      let targetProj = currentProject;
      let restIdx = 1;
      if (tokens[1] && knownProjects.includes(tokens[1].toLowerCase())) {
        targetProj = tokens[1].toLowerCase();
        restIdx = 2;
      }
      try {
        profile = buildAgentProfile(targetAgent, targetProj);
        currentAgent = targetAgent;
        currentProject = targetProj;
        history = [];
        console.log(`\n🔄 Switched direct channel to @${profile.name} (${profile.role}) [Model: ${profile.model}]`);
      } catch (err) {
        console.error(`\n❌ ${err.message}`);
        continue;
      }

      const remainingPrompt = tokens.slice(restIdx).join(' ').trim();
      if (!remainingPrompt) continue;

      appendSessionLog('CEO', profile.name, remainingPrompt);
      history.push({ role: 'user', parts: [{ text: remainingPrompt }] });
    } else {
      appendSessionLog('CEO', profile.name, input);
      history.push({ role: 'user', parts: [{ text: input }] });
    }

    try {
      const reply = await runAgentTurn(profile, history, { enableTools: true });
      appendSessionLog(profile.name, 'CEO', reply);
      console.log(`\n[🎙️ @${profile.name}]:\n${reply}`);
    } catch (err) {
      console.error(`\n❌ Error: ${err.message}`);
    }
  }

  rl.close();
}

// ── 9. Background Daemon Mode (12:00 PM IST Daily or 8-Hour Standup Loop) ────
async function runDaemon({ interval8h = false, autoExecute = false } = {}) {
  const triggerTimes = interval8h ? ['04:00', '12:00', '20:00'] : [CONFIG.standupTimeIst];
  console.log(`\n⏰ COMMANDO STANDUP DAEMON ACTIVE`);
  console.log(`   Schedule (IST) : ${triggerTimes.join(', ')} Asia/Kolkata`);
  console.log(`   Auto-Execute   : ${autoExecute ? 'ENABLED' : 'HUMAN-GATE'}`);
  console.log(`   Press Ctrl+C to stop.\n`);

  let lastTriggeredKey = '';

  const tick = async () => {
    const today = getTodayDateIst();
    const hhmm = getIstTimeHHMM();
    const key = `${today}_${hhmm}`;
    if (triggerTimes.includes(hhmm) && lastTriggeredKey !== key) {
      lastTriggeredKey = key;
      try {
        await runDailyStandup({ autoExecute });
      } catch (err) {
        console.error(`[Daemon Standup Error]: ${err.message}`);
      }
    }
  };

  await tick();
  setInterval(tick, 30000);
}

// ── 10. CLI Entrypoint ───────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const subcommand = (args[0] || 'help').toLowerCase();
  const autoExecute = args.includes('--auto-execute');
  const interval8h = args.includes('--interval=8h');

  if (subcommand === 'standup') {
    await runDailyStandup({ autoExecute });
    return;
  }

  if (subcommand === 'daemon') {
    await runDaemon({ interval8h, autoExecute });
    return;
  }

  if (subcommand === 'chat') {
    const agentArg = args[1] && !args[1].startsWith('--') ? args[1] : '@warden';
    const projArg = args[2] && !args[2].startsWith('--') ? args[2] : '';
    await runInteractiveChat(agentArg, projArg);
    return;
  }

  if (subcommand === 'ask') {
    const agentArg = args[1] || '@warden';
    const promptText = args.slice(2).join(' ').trim();
    if (!promptText) {
      console.error('Usage: node scripts/commando-vertex.mjs ask "@agent" "Your question or instruction"');
      process.exit(1);
    }
    const profile = buildAgentProfile(agentArg);
    appendSessionLog('CEO', profile.name, promptText);
    const reply = await runAgentTurn(profile, [{ role: 'user', parts: [{ text: promptText }] }], {
      enableTools: true,
    });
    appendSessionLog(profile.name, 'CEO', reply);
    console.log(`\n[🎙️ @${profile.name}]:\n${reply}\n`);
    return;
  }

  console.log(`
COMMANDO — Programmatic Vertex AI / Gemini Orchestrator

Commands:
  npm run standup                            Run the 12:00 PM IST Daily Standup (with CEO approval prompt)
  npm run standup:auto                       Run the Daily Standup and auto-execute the sprint plan
  npm run daemon                             Start the 12:00 PM IST daily standup background scheduler
  npm run chat                               Interactive CLI chat with @warden (switchable to any @agent)
  npm run chat -- @infra_head                Direct 1-on-1 granular chat with @infra_head
  npm run chat -- @backend_dev <project>     Direct 1-on-1 granular chat with a project's @backend_dev
  node scripts/commando-vertex.mjs ask "@cto" "What is our top technical priority today?"

Environment (.env):
  GOOGLE_CLOUD_PROJECT=your-gcp-project-id   (Uses Vertex AI via gcloud ADC)
  GOOGLE_CLOUD_LOCATION=us-central1
  # OR:
  GEMINI_API_KEY=your-api-key                (Uses Gemini API directly)
`);
}

main().catch((err) => {
  console.error(`\n[Commando Fatal]: ${err.message}`);
  process.exit(1);
});
