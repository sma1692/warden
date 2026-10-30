import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = fs.existsSync(path.join(process.cwd(), '.state'))
    ? process.cwd()
    : path.resolve(__dirname, '..');

const brainDir = path.join(os.homedir(), '.gemini/antigravity/brain');
const cacheDir = path.join(projectRoot, '.state', 'tokens');
const modelRegistryPath = path.join(projectRoot, '.state', 'model-registry.json');

if (!fs.existsSync(cacheDir)) {
    try { fs.mkdirSync(cacheDir, { recursive: true }); } catch {}
}

const DEFAULT_MODELS = {
    'gemini-2.5-pro': {
        provider: 'google',
        tier: 'tier1_architect',
        displayName: 'Gemini 2.5 Pro',
        contextWindow: 1048576,
        maxOutputTokens: 8192,
        supportsToolUse: true,
        supportsThinking: true,
        pricing: { inputPer1MUsd: 1.25, outputPer1MUsd: 10.0, cachedInputPer1MUsd: 0.60 }
    },
    'gemini-2.5-flash': {
        provider: 'google',
        tier: 'tier2_applier',
        displayName: 'Gemini 2.5 Flash',
        contextWindow: 1048576,
        maxOutputTokens: 8192,
        supportsToolUse: true,
        supportsThinking: true,
        pricing: { inputPer1MUsd: 0.15, outputPer1MUsd: 0.60, cachedInputPer1MUsd: 0.15 }
    },
    'gemini-2.5-flash-lite': {
        provider: 'google',
        tier: 'tier2_applier',
        displayName: 'Gemini 2.5 Flash-Lite',
        contextWindow: 1048576,
        maxOutputTokens: 8192,
        supportsToolUse: true,
        supportsThinking: false,
        pricing: { inputPer1MUsd: 0.075, outputPer1MUsd: 0.30, cachedInputPer1MUsd: 0.075 }
    },
    'gemini-1.5-pro': {
        provider: 'google',
        tier: 'tier1_architect',
        displayName: 'Gemini 1.5 Pro',
        contextWindow: 2097152,
        maxOutputTokens: 8192,
        supportsToolUse: true,
        supportsThinking: false,
        pricing: { inputPer1MUsd: 1.25, outputPer1MUsd: 5.0, cachedInputPer1MUsd: 0.60 }
    },
    'gemini-1.5-flash': {
        provider: 'google',
        tier: 'tier2_applier',
        displayName: 'Gemini 1.5 Flash',
        contextWindow: 1048576,
        maxOutputTokens: 8192,
        supportsToolUse: true,
        supportsThinking: false,
        pricing: { inputPer1MUsd: 0.075, outputPer1MUsd: 0.30, cachedInputPer1MUsd: 0.075 }
    },
    'claude-3-7-sonnet': {
        provider: 'anthropic',
        tier: 'tier1_architect',
        displayName: 'Claude 3.7 Sonnet',
        contextWindow: 200000,
        maxOutputTokens: 64000,
        supportsToolUse: true,
        supportsThinking: true,
        pricing: { inputPer1MUsd: 3.0, outputPer1MUsd: 15.0, cachedInputPer1MUsd: 0.30 }
    },
    'claude-3-5-sonnet': {
        provider: 'anthropic',
        tier: 'tier1_architect',
        displayName: 'Claude 3.5 Sonnet',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        supportsToolUse: true,
        supportsThinking: true,
        pricing: { inputPer1MUsd: 3.0, outputPer1MUsd: 15.0, cachedInputPer1MUsd: 0.30 }
    },
    'claude-3-5-haiku': {
        provider: 'anthropic',
        tier: 'tier2_applier',
        displayName: 'Claude 3.5 Haiku',
        contextWindow: 200000,
        maxOutputTokens: 8192,
        supportsToolUse: true,
        supportsThinking: false,
        pricing: { inputPer1MUsd: 0.80, outputPer1MUsd: 4.0, cachedInputPer1MUsd: 0.08 }
    },
    'gpt-4o': {
        provider: 'openai',
        tier: 'tier1_architect',
        displayName: 'GPT-4o',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        supportsToolUse: true,
        supportsThinking: false,
        pricing: { inputPer1MUsd: 2.50, outputPer1MUsd: 10.0, cachedInputPer1MUsd: 0.60 }
    },
    'gpt-4o-mini': {
        provider: 'openai',
        tier: 'tier2_applier',
        displayName: 'GPT-4o mini',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        supportsToolUse: true,
        supportsThinking: false,
        pricing: { inputPer1MUsd: 0.15, outputPer1MUsd: 0.60, cachedInputPer1MUsd: 0.075 }
    },
    'o1': {
        provider: 'openai',
        tier: 'tier1_architect',
        displayName: 'OpenAI o1',
        contextWindow: 200000,
        maxOutputTokens: 100000,
        supportsToolUse: true,
        supportsThinking: true,
        pricing: { inputPer1MUsd: 15.0, outputPer1MUsd: 60.0, cachedInputPer1MUsd: 7.50 }
    },
    'o1-mini': {
        provider: 'openai',
        tier: 'tier2_applier',
        displayName: 'OpenAI o1-mini',
        contextWindow: 128000,
        maxOutputTokens: 65536,
        supportsToolUse: true,
        supportsThinking: true,
        pricing: { inputPer1MUsd: 1.10, outputPer1MUsd: 4.40, cachedInputPer1MUsd: 0.55 }
    },
    'o3-mini': {
        provider: 'openai',
        tier: 'tier2_applier',
        displayName: 'OpenAI o3-mini',
        contextWindow: 200000,
        maxOutputTokens: 100000,
        supportsToolUse: true,
        supportsThinking: true,
        pricing: { inputPer1MUsd: 1.10, outputPer1MUsd: 4.40, cachedInputPer1MUsd: 0.55 }
    },
    'grok-2': {
        provider: 'xai',
        tier: 'tier1_architect',
        displayName: 'Grok 2',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        supportsToolUse: true,
        supportsThinking: false,
        pricing: { inputPer1MUsd: 2.0, outputPer1MUsd: 10.0, cachedInputPer1MUsd: 0.50 }
    },
    'grok-2-mini': {
        provider: 'xai',
        tier: 'tier2_applier',
        displayName: 'Grok 2 mini',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        supportsToolUse: true,
        supportsThinking: false,
        pricing: { inputPer1MUsd: 0.20, outputPer1MUsd: 1.0, cachedInputPer1MUsd: 0.05 }
    },
    'grok-beta': {
        provider: 'xai',
        tier: 'tier1_architect',
        displayName: 'Grok Beta',
        contextWindow: 131072,
        maxOutputTokens: 8192,
        supportsToolUse: true,
        supportsThinking: false,
        pricing: { inputPer1MUsd: 5.0, outputPer1MUsd: 15.0, cachedInputPer1MUsd: 1.25 }
    },
    'muse-pro': {
        provider: 'meta_muse',
        tier: 'tier1_architect',
        displayName: 'Meta Muse Pro',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        supportsToolUse: true,
        supportsThinking: true,
        pricing: { inputPer1MUsd: 1.0, outputPer1MUsd: 4.0, cachedInputPer1MUsd: 0.60 }
    },
    'meta-muse-pro': {
        provider: 'meta_muse',
        tier: 'tier1_architect',
        displayName: 'Meta Muse Pro',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        supportsToolUse: true,
        supportsThinking: true,
        pricing: { inputPer1MUsd: 1.0, outputPer1MUsd: 4.0, cachedInputPer1MUsd: 0.60 }
    },
    'muse-light': {
        provider: 'meta_muse',
        tier: 'tier2_applier',
        displayName: 'Meta Muse Light',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        supportsToolUse: true,
        supportsThinking: false,
        pricing: { inputPer1MUsd: 0.15, outputPer1MUsd: 0.60, cachedInputPer1MUsd: 0.05 }
    },
    'muse-flash': {
        provider: 'meta_muse',
        tier: 'tier2_applier',
        displayName: 'Meta Muse Flash',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        supportsToolUse: true,
        supportsThinking: false,
        pricing: { inputPer1MUsd: 0.15, outputPer1MUsd: 0.60, cachedInputPer1MUsd: 0.05 }
    },
    'muse-spark-1.3': {
        provider: 'meta_muse',
        tier: 'tier2_applier',
        displayName: 'Meta Muse Spark 1.3',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        supportsToolUse: true,
        supportsThinking: true,
        pricing: { inputPer1MUsd: 0.20, outputPer1MUsd: 0.80, cachedInputPer1MUsd: 0.05 }
    },
    'muse-wonder-1.0': {
        provider: 'meta_muse',
        tier: 'tier1_architect',
        displayName: 'Meta Muse Wonder 1.0',
        contextWindow: 128000,
        maxOutputTokens: 8192,
        supportsToolUse: true,
        supportsThinking: true,
        pricing: { inputPer1MUsd: 1.0, outputPer1MUsd: 4.0, cachedInputPer1MUsd: 0.25 }
    },
    'qwen2.5-coder:14b': {
        provider: 'ollama',
        tier: 'tier2_applier',
        displayName: 'Qwen 2.5 Coder 14B (Local)',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        supportsToolUse: true,
        supportsThinking: false,
        pricing: { inputPer1MUsd: 0.0, outputPer1MUsd: 0.0, cachedInputPer1MUsd: 0.0 }
    }
};

let cachedRegistry = null;

export function loadModelRegistry() {
    if (cachedRegistry) return cachedRegistry;

    let registry = {
        _schema: 'warden.model-registry.v1',
        description: 'Auto-discovered and statically registered model endpoints, capabilities, and pricing metrics.',
        updatedAt: new Date().toISOString(),
        models: { ...DEFAULT_MODELS }
    };

    if (fs.existsSync(modelRegistryPath)) {
        try {
            const raw = fs.readFileSync(modelRegistryPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.models === 'object') {
                registry.models = { ...DEFAULT_MODELS, ...parsed.models };
                registry.updatedAt = parsed.updatedAt || registry.updatedAt;
            }
        } catch (_) {}
    } else {
        saveModelRegistry(registry);
    }

    cachedRegistry = registry;
    return registry;
}

export function saveModelRegistry(registry) {
    try {
        const dir = path.dirname(modelRegistryPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        registry.updatedAt = new Date().toISOString();
        fs.writeFileSync(modelRegistryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
        cachedRegistry = registry;
    } catch (_) {}
}

function formatDisplayName(id) {
    return id
        .split(/[-_:]/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

export function resolveModel(rawModelId, fallbackContext = {}) {
    const registry = loadModelRegistry();
    let norm = (rawModelId || '').toLowerCase().trim().replace(/^["']|["']$/g, '');

    // Canonical aliases
    const aliases = {
        'pro': process.env.COMMANDO_PRO_MODEL || 'gemini-2.5-pro',
        'flash': process.env.COMMANDO_DEFAULT_MODEL || 'gemini-2.5-flash',
        'gemini-pro': 'gemini-2.5-pro',
        'gemini-flash': 'gemini-2.5-flash',
        'claude-sonnet': 'claude-3-5-sonnet',
        'claude-haiku': 'claude-3-5-haiku',
        'haiku': 'claude-3-5-haiku',
        'sonnet': 'claude-3-5-sonnet',
        'gpt4': 'gpt-4o',
        'gpt-4': 'gpt-4o',
        'gpt4o': 'gpt-4o',
        'gpt4-mini': 'gpt-4o-mini',
        'gpt-4-mini': 'gpt-4o-mini',
        'grok': 'grok-2',
        'grok-mini': 'grok-2-mini',
        'muse': 'muse-pro',
        'local': process.env.LOCAL_LLM_MODEL || 'qwen2.5-coder:14b',
        'ollama': process.env.LOCAL_LLM_MODEL || 'qwen2.5-coder:14b'
    };

    if (aliases[norm]) {
        norm = aliases[norm];
    }

    // Fallback if empty or inherit
    if (!norm || norm === 'inherit') {
        const role = fallbackContext.role || '';
        const typeName = fallbackContext.typeName || '';
        const depth = fallbackContext.depth ?? 0;
        const isFlashShard = /flash|Apply pass/i.test(role) || typeName === 'pa' || typeName === 'frontend_dev' || typeName === 'backend_dev' || depth >= 2;
        norm = isFlashShard
            ? (process.env.COMMANDO_DEFAULT_MODEL || 'gemini-2.5-flash')
            : (process.env.COMMANDO_PRO_MODEL || 'gemini-2.5-pro');
    }

    // Direct lookup in registry
    if (registry.models[norm]) {
        return { id: norm, ...registry.models[norm] };
    }

    // Also check prefix/variant match
    for (const [key, val] of Object.entries(registry.models)) {
        if (norm.startsWith(key) || key.startsWith(norm)) {
            return { id: key, ...val };
        }
    }

    // Runtime Unknown-Model Auto-Discovery
    let provider = 'custom';
    if (/^(gpt|o1|o3|chatgpt|openai)/i.test(norm)) {
        provider = 'openai';
    } else if (/^(grok|xai)/i.test(norm)) {
        provider = 'xai';
    } else if (/^(muse|meta|llama)/i.test(norm)) {
        provider = 'meta_muse';
    } else if (/^(claude|anthropic)/i.test(norm)) {
        provider = 'anthropic';
    } else if (/^(gemini|google|vertex)/i.test(norm)) {
        provider = 'google';
    } else if (/^(qwen|mistral|deepseek|phi|codellama|ollama)/i.test(norm)) {
        provider = 'ollama';
    }

    const isTier2 = /mini|flash|light|spark|nano|haiku|coder|small|8b|14b|3b|1b|shard|fast|local/i.test(norm);
    const tier = isTier2 ? 'tier2_applier' : 'tier1_architect';

    let pricing;
    if (provider === 'ollama') {
        pricing = { inputPer1MUsd: 0.0, outputPer1MUsd: 0.0, cachedInputPer1MUsd: 0.0 };
    } else if (isTier2) {
        switch (provider) {
            case 'openai': pricing = { inputPer1MUsd: 0.15, outputPer1MUsd: 0.60, cachedInputPer1MUsd: 0.075 }; break;
            case 'xai': pricing = { inputPer1MUsd: 0.20, outputPer1MUsd: 1.00, cachedInputPer1MUsd: 0.05 }; break;
            case 'meta_muse': pricing = { inputPer1MUsd: 0.20, outputPer1MUsd: 0.80, cachedInputPer1MUsd: 0.05 }; break;
            case 'anthropic': pricing = { inputPer1MUsd: 0.80, outputPer1MUsd: 4.00, cachedInputPer1MUsd: 0.08 }; break;
            case 'google': pricing = { inputPer1MUsd: 0.15, outputPer1MUsd: 0.60, cachedInputPer1MUsd: 0.0375 }; break;
            default: pricing = { inputPer1MUsd: 0.15, outputPer1MUsd: 0.60, cachedInputPer1MUsd: 0.05 };
        }
    } else {
        switch (provider) {
            case 'openai': pricing = { inputPer1MUsd: 2.50, outputPer1MUsd: 10.00, cachedInputPer1MUsd: 0.60 }; break;
            case 'xai': pricing = { inputPer1MUsd: 2.00, outputPer1MUsd: 10.00, cachedInputPer1MUsd: 0.50 }; break;
            case 'meta_muse': pricing = { inputPer1MUsd: 1.00, outputPer1MUsd: 4.00, cachedInputPer1MUsd: 0.60 }; break;
            case 'anthropic': pricing = { inputPer1MUsd: 3.00, outputPer1MUsd: 15.00, cachedInputPer1MUsd: 0.30 }; break;
            case 'google': pricing = { inputPer1MUsd: 1.25, outputPer1MUsd: 10.00, cachedInputPer1MUsd: 0.60 }; break;
            default: pricing = { inputPer1MUsd: 1.00, outputPer1MUsd: 10.00, cachedInputPer1MUsd: 0.60 };
        }
    }

    const discoveredModel = {
        provider,
        tier,
        displayName: formatDisplayName(norm),
        contextWindow: 128000,
        maxOutputTokens: 8192,
        supportsToolUse: true,
        supportsThinking: /pro|think|reason|o1|o3|sonnet|wonder/i.test(norm),
        pricing,
        discoveredAt: new Date().toISOString(),
        autoDiscovered: true
    };

    registry.models[norm] = discoveredModel;
    saveModelRegistry(registry);
    console.log(`[ModelRegistry] Auto-discovered unknown model "${norm}" (${provider}, ${tier}) -> cached in .state/model-registry.json`);

    return { id: norm, ...discoveredModel };
}

// Pricing per 1M tokens (USD)
export function estimateCostUsd(modelOrType, roleOrCumTok, depthOrOutTok, maybeCumTok, maybeOutTok) {
    let modelEntry;
    let cumBilled;
    let outTok;

    if (typeof modelOrType === 'object' && modelOrType !== null) {
        modelEntry = modelOrType;
        cumBilled = Number(roleOrCumTok) || 0;
        outTok = Number(depthOrOutTok) || 0;
    } else if (typeof maybeCumTok === 'number') {
        const typeName = modelOrType;
        const role = roleOrCumTok;
        const depth = depthOrOutTok;
        cumBilled = maybeCumTok;
        outTok = maybeOutTok || 0;
        modelEntry = resolveModel('', { typeName, role, depth });
    } else {
        modelEntry = resolveModel(modelOrType, {});
        cumBilled = Number(roleOrCumTok) || 0;
        outTok = Number(depthOrOutTok) || 0;
    }

    const cumInputTokens = Math.max(0, cumBilled - outTok);
    const inputRate = modelEntry.pricing?.cachedInputPer1MUsd ?? (modelEntry.tier === 'tier1_architect' ? 0.60 : 0.15);
    const outputRate = modelEntry.pricing?.outputPer1MUsd ?? (modelEntry.tier === 'tier1_architect' ? 10.00 : 0.60);

    return (cumInputTokens / 1_000_000) * inputRate + (outTok / 1_000_000) * outputRate;
}

function cleanStr(val) {
    if (!val || typeof val !== 'string') return '';
    return val.replace(/^"|"$/g, '').trim();
}

function inferRoleFromLines(lines, fallbackType, fallbackRole) {
    let t = fallbackType;
    let r = fallbackRole;
    if (t && t !== 'subagent') return { typeName: t, role: r };

    const firstChunk = lines.slice(0, 6).join('\n');
    const rolePatterns = [
        { re: /\bfrontend_dev\b|Frontend/i, typeName: 'frontend_dev', role: 'Level 2 Frontend Developer' },
        { re: /\bbackend_dev\b|export-bundle|warden-config/i, typeName: 'backend_dev', role: 'Level 2 Backend Developer' },
        { re: /\btech_lead\b|Tech Lead/i, typeName: 'tech_lead', role: 'Level 1 Project Tech Lead' },
        { re: /\bpm\b|Product Manager|COLLATED_BACKLOG/i, typeName: 'pm', role: 'Level 1 Product Manager' },
        { re: /\bdesigner\b|UI\/UX|warden-product-and-demo-spec/i, typeName: 'designer', role: 'Level 1/2 Designer' },
        { re: /\bsec_lead\b/i, typeName: 'sec_lead', role: 'Level 1 Security Lead' },
        { re: /\binfra_head\b/i, typeName: 'infra_head', role: 'Level 1 Infra Head' },
        { re: /\bcbo\b/i, typeName: 'cbo', role: 'Level 0 Chief Business Officer' },
        { re: /\bcto\b/i, typeName: 'cto', role: 'Level 0 Head of Tech (CTO)' }
    ];
    for (const p of rolePatterns) {
        if (p.re.test(firstChunk)) {
            return { typeName: p.typeName, role: p.role };
        }
    }
    return { typeName: t || 'subagent', role: r || 'Subagent' };
}

const BASE_SYS_PROMPT_TOK = 3800;

export function parseTranscriptLines(lines, typeName, role) {
    let totalSteps = 0;
    let modelSteps = 0;
    let inputChars = 0;
    let outputChars = 0;
    let thinkingChars = 0;
    let toolCallChars = 0;
    let readFileCount = 0;
    let cumulativeContextChars = 0;
    let cumulativeBilledTokens = 0;
    let detectedModel = null;

    const invokeMetaQueue = [];
    const discoveredChildIds = [];
    const childMetaById = {};

    for (const line of lines) {
        let entry;
        try {
            entry = JSON.parse(line);
        } catch {
            continue;
        }
        totalSteps++;

        if (entry.model || entry.model_name) {
            detectedModel = cleanStr(entry.model || entry.model_name);
        }

        const contentLen = (entry.content || '').length;
        const thinkLen = (entry.thinking || '').length;
        const tcLen = entry.tool_calls ? JSON.stringify(entry.tool_calls).length : 0;
        const stepChars = contentLen + thinkLen + tcLen;

        if (entry.type === 'PLANNER_RESPONSE') {
            modelSteps++;
            outputChars += contentLen;
            thinkingChars += thinkLen;
            toolCallChars += tcLen;
            const turnInputTok = BASE_SYS_PROMPT_TOK + Math.round(cumulativeContextChars / 4);
            const turnOutputTok = Math.round(stepChars / 4);
            cumulativeBilledTokens += (turnInputTok + turnOutputTok);
            cumulativeContextChars += (contentLen + tcLen);
        } else {
            inputChars += contentLen;
            cumulativeContextChars += contentLen;
        }

        if (entry.tool_calls) {
            for (const tc of entry.tool_calls) {
                const fnName = tc.name || tc.function?.name || '';
                let tcArgs = tc.args || tc.arguments || tc.function?.arguments || {};
                if (typeof tcArgs === 'string') {
                    try { tcArgs = JSON.parse(tcArgs); } catch {}
                }
                if (fnName === 'view_file' || fnName === 'read_file') {
                    readFileCount++;
                }
                if (fnName === 'invoke_subagent') {
                    const subModel = cleanStr(tcArgs.Model || tcArgs.model || tcArgs.modelName || '');
                    invokeMetaQueue.push({
                        typeName: cleanStr(tcArgs.TypeName || tcArgs.typeName) || 'subagent',
                        role: cleanStr(tcArgs.Role || tcArgs.role) || 'Subagent',
                        model: subModel,
                        promptSnippet: cleanStr(tcArgs.Prompt || tcArgs.prompt).slice(0, 80).replace(/\s+/g, ' ')
                    });
                }
                if (fnName === 'send_message') {
                    const rec = cleanStr(tcArgs.Recipient || tcArgs.recipient);
                    if (rec && /^[0-9a-f-]{36}$/i.test(rec) && !discoveredChildIds.includes(rec)) {
                        discoveredChildIds.push(rec);
                    }
                }
            }
        }

        if (entry.content) {
            if (!detectedModel) {
                const modelMatch = entry.content.match(/\bModel:\s*["']?([a-zA-Z0-9_.:-]+)["']?/i) ||
                                   entry.content.match(/"model":\s*"([^"]+)"/i);
                if (modelMatch) {
                    detectedModel = cleanStr(modelMatch[1]);
                }
            }
            if (entry.content.includes('"conversationId":')) {
                const matches = [...entry.content.matchAll(/"conversationId":\s*"([0-9a-f-]+)"/g)];
                for (const m of matches) {
                    if (!discoveredChildIds.includes(m[1])) {
                        discoveredChildIds.push(m[1]);
                    }
                }
                const listMatches = [...entry.content.matchAll(/\{"role":"([^"]+)","type":"([^"]+)","conversationId":"([0-9a-f-]+)"/g)];
                for (const lm of listMatches) {
                    childMetaById[lm[3]] = { role: lm[1], typeName: lm[2] };
                }
            }
        }
    }

    const inferred = inferRoleFromLines(lines, typeName, role);
    const totalChars = inputChars + outputChars + thinkingChars + toolCallChars;
    const estTokens = Math.ceil(totalChars / 4);
    const inTokens = Math.ceil(inputChars / 4);
    const outTokens = Math.ceil((outputChars + thinkingChars + toolCallChars) / 4);
    const tokPerTurn = modelSteps > 0 ? Math.round(estTokens / modelSteps) : estTokens;

    return {
        typeName: inferred.typeName,
        role: inferred.role,
        detectedModel,
        totalSteps,
        modelSteps,
        estTokens,
        inTokens,
        outTokens,
        tokPerTurn,
        cumulativeBilledTokens,
        readFileCount,
        invokeMetaQueue,
        discoveredChildIds,
        childMetaById
    };
}

const args = process.argv.slice(2);
let sessionId = null;
let cliModel = null;

if (args.includes('--session')) {
    sessionId = args[args.indexOf('--session') + 1];
}
if (args.includes('--model')) {
    cliModel = args[args.indexOf('--model') + 1];
}

const visited = new Set();
const agentList = [];

export function walkAgent(convId, typeName = 'warden', role = 'CEO Office Chief of Staff (Root)', depth = 0, assignedModel = null) {
    if (visited.has(convId)) return;
    visited.add(convId);

    const fullPath = path.join(brainDir, convId, '.system_generated/logs/transcript_full.jsonl');
    const compactPath = path.join(brainDir, convId, '.system_generated/logs/transcript.jsonl');
    const tPath = fs.existsSync(fullPath) ? fullPath : compactPath;
    const cacheFile = path.join(cacheDir, `${convId}.json`);

    let parsed = null;

    if (fs.existsSync(tPath)) {
        try {
            const lines = fs.readFileSync(tPath, 'utf8').split('\n').filter(l => l.trim().length > 0);
            parsed = parseTranscriptLines(lines, typeName, role);
            try {
                fs.writeFileSync(cacheFile, JSON.stringify({
                    id: convId,
                    ...parsed
                }, null, 2));
            } catch {}
        } catch (e) {
            if (fs.existsSync(cacheFile)) {
                try {
                    parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                } catch {}
            }
        }
    } else if (fs.existsSync(cacheFile)) {
        try {
            parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        } catch {}
    }

    const finalType = parsed?.typeName || typeName;
    const finalRole = parsed?.role || role;
    const rawModelCandidate = cliModel || parsed?.detectedModel || assignedModel || '';
    const resolvedModel = resolveModel(rawModelCandidate, {
        typeName: finalType,
        role: finalRole,
        depth
    });

    if (!parsed) {
        agentList.push({
            id: convId,
            shortId: convId.substring(0, 8),
            typeName: finalType,
            role: finalRole,
            modelId: resolvedModel.id,
            modelName: resolvedModel.displayName || resolvedModel.id,
            depth,
            totalSteps: 0,
            modelSteps: 0,
            estTokens: 0,
            inTokens: 0,
            outTokens: 0,
            tokPerTurn: 0,
            cumulativeBilledTokens: 0,
            costUsd: 0,
            readFileCount: 0
        });
        return;
    }

    const costUsd = estimateCostUsd(resolvedModel, parsed.cumulativeBilledTokens, parsed.outTokens);

    agentList.push({
        id: convId,
        shortId: convId.substring(0, 8),
        typeName: finalType,
        role: finalRole,
        modelId: resolvedModel.id,
        modelName: resolvedModel.displayName || resolvedModel.id,
        depth,
        totalSteps: parsed.totalSteps,
        modelSteps: parsed.modelSteps,
        estTokens: parsed.estTokens,
        inTokens: parsed.inTokens,
        outTokens: parsed.outTokens,
        tokPerTurn: parsed.tokPerTurn,
        cumulativeBilledTokens: parsed.cumulativeBilledTokens,
        costUsd,
        readFileCount: parsed.readFileCount
    });

    (parsed.discoveredChildIds || []).forEach((childId, idx) => {
        const directMeta = (parsed.childMetaById || {})[childId];
        const queueMeta = (parsed.invokeMetaQueue || [])[idx];
        const nextType = directMeta?.typeName || queueMeta?.typeName || 'subagent';
        const nextRole = directMeta?.role || queueMeta?.role || `Worker #${idx + 1}`;
        const nextModel = directMeta?.model || queueMeta?.model || (queueMeta?.model === 'inherit' ? resolvedModel.id : null);
        walkAgent(childId, nextType, nextRole, depth + 1, nextModel);
    });
}

function runCli() {
    loadModelRegistry();

    if (!sessionId) {
        if (!fs.existsSync(brainDir)) {
            console.error("Brain directory not found:", brainDir);
            process.exit(1);
        }
        let sessions = [];
        try {
            sessions = fs.readdirSync(brainDir).filter(f => {
                try { return fs.statSync(path.join(brainDir, f)).isDirectory(); } catch { return false; }
            });
        } catch (e) {
            console.error("Unable to list sessions in brainDir:", e.message);
            process.exit(1);
        }
        if (sessions.length > 0) {
            sessions.sort((a, b) => fs.statSync(path.join(brainDir, b)).mtimeMs - fs.statSync(path.join(brainDir, a)).mtimeMs);
            sessionId = sessions[0];
        } else {
            console.error("No sessions found.");
            process.exit(1);
        }
    }

    walkAgent(sessionId, 'warden', 'CEO Office Chief of Staff (Root)', 0, cliModel);

    const totals = agentList.reduce((acc, a) => {
        acc.totalSteps += a.totalSteps;
        acc.modelSteps += a.modelSteps;
        acc.estTokens += a.estTokens;
        acc.inTokens += a.inTokens;
        acc.outTokens += a.outTokens;
        acc.cumulativeBilledTokens += a.cumulativeBilledTokens;
        acc.costUsd += a.costUsd;
        acc.readFileCount += a.readFileCount;
        return acc;
    }, { totalSteps: 0, modelSteps: 0, estTokens: 0, inTokens: 0, outTokens: 0, cumulativeBilledTokens: 0, costUsd: 0, readFileCount: 0 });

    const totalTokPerTurn = totals.modelSteps > 0 ? Math.round(totals.estTokens / totals.modelSteps) : totals.estTokens;

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const shortId = sessionId.substring(0, 8);
    const uniqueModels = [...new Set(agentList.map(a => a.modelName || a.modelId))];

    const tableRows = agentList.map(a => {
        const levelLabel = a.depth === 0 ? 'Root' : `L${a.depth - 1}`;
        const indentPrefix = a.depth > 0 ? `${'↳ '.repeat(a.depth)}` : '';
        return `| ${levelLabel} | ${indentPrefix}\`${a.typeName}\` (\`${a.shortId}\`) | ${a.role} | \`${a.modelId}\` | **~${a.cumulativeBilledTokens.toLocaleString()}** | **$${a.costUsd.toFixed(2)}** | ${a.modelSteps} (${a.totalSteps}) | ~${a.estTokens.toLocaleString()} | ~${a.inTokens.toLocaleString()} | ~${a.outTokens.toLocaleString()} | ~${a.tokPerTurn.toLocaleString()} | ${a.readFileCount} |`;
    }).join('\n');

    const totalRow = `| **TOTAL** | **${agentList.length} Agents** | **All Session Agents** | **-** | **~${totals.cumulativeBilledTokens.toLocaleString()}** | **$${totals.costUsd.toFixed(2)}** | **${totals.modelSteps} (${totals.totalSteps})** | **~${totals.estTokens.toLocaleString()}** | **~${totals.inTokens.toLocaleString()}** | **~${totals.outTokens.toLocaleString()}** | **~${totalTokPerTurn.toLocaleString()}** | **${totals.readFileCount}** |`;

    const reportMd = `# Token Consumption Report (Session: ${shortId})

**Date:** ${dateStr}  
**Total Agents Spawned:** ${agentList.length}  
**Models Active:** ${uniqueModels.join(', ')}  
**Total Cumulative Billed Tokens:** ~${totals.cumulativeBilledTokens.toLocaleString()} tokens  
**Estimated Session Cost (USD):** $${totals.costUsd.toFixed(2)}  
**Total New Tokens (Net Payload):** ~${totals.estTokens.toLocaleString()} tokens (Input/Tool: ~${totals.inTokens.toLocaleString()} | Thinking/Output: ~${totals.outTokens.toLocaleString()})  
**Total LLM Calls (Raw Events):** ${totals.modelSteps} (${totals.totalSteps})  
**Total Direct \`read_file\` Calls:** ${totals.readFileCount}

## Tabular Per-Agent & Total Token Breakdown

| Level | Agent (ID) | Role | Model | Total Cumulative Tok | Cost (USD) | LLM Calls (Events) | Total New Tok | Input + Tool Tok | Thinking + Output Tok | Avg Tok/Call | Files Read |
| :--- | :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${tableRows}
${totalRow}
`;

    const tokensDir = path.join(projectRoot, 'chats', 'tokens');
    if (!fs.existsSync(tokensDir)) {
        try { fs.mkdirSync(tokensDir, { recursive: true }); } catch {}
    }

    const fullReportPath = path.join(tokensDir, `${dateStr}-session-${shortId}-tokens.md`);
    try {
        fs.writeFileSync(fullReportPath, reportMd.trim() + '\n');
    } catch (_) {}

    const artifactReportPath = path.join(brainDir, sessionId, 'token-report.md');
    try {
        if (fs.existsSync(path.join(brainDir, sessionId))) {
            fs.writeFileSync(artifactReportPath, reportMd.trim() + '\n');
        }
    } catch (_) {}

    console.log(`Token Report (${shortId}): Total Cumulative Tok: ~${totals.cumulativeBilledTokens.toLocaleString()} | Cost (USD): $${totals.costUsd.toFixed(2)} | Total New Tok: ~${totals.estTokens.toLocaleString()} | Agents: ${agentList.length} | File: ${fullReportPath}`);
}

// Auto-run if executed as script
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    runCli();
}
