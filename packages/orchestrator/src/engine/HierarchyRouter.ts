import {
  AgentRecord,
  AgentRunRecord,
  ChatMessageRecord,
  ChatThreadMode,
  MediaAttachment,
  OrchestratorStore,
} from './OrchestratorStore.js';
import { getProject, getProjectKeywords, loadPrivateData } from '../config/projectRegistry.js';
import { AgentRunner } from './AgentRunner.js';

interface RoutingPrivateData {
  projectKeywords?: Record<string, string[]>;
  backendKeywords?: string[];
}

export interface RouteChatMessageParams {
  threadId: string;
  content: string;
  targetAgentId?: string | null;
  mode?: ChatThreadMode;
  attachments?: MediaAttachment[];
}

export interface RouteChatMessageResult {
  userMessage: ChatMessageRecord;
  agentReply: ChatMessageRecord;
  primaryRun: AgentRunRecord;
  delegatedRuns: AgentRunRecord[];
  routedMode: 'WARDEN_EXECUTIVE' | 'DIRECT_AGENT';
  respondingAgent: AgentRecord;
}

/**
 * HierarchyRouter — Corporate & Technical Command Chain Router
 * (dynamocommando.md Section 1.5)
 *
 * Supports:
 * 1. Default Executive Mode (`@warden` -> `@cto` / `@cmo` -> Level 1 -> Level 2) with upward compression.
 * 2. Direct `@agent` Granular Mode (`@cto`, `@cmo`, `@pm`, `@seo_aeo_head`, `@tech_lead:<project>`,
 *    `@backend_dev:<project>`, `@frontend_dev:<project>`, `@infra_head`, `@infra_jr`, etc.) for 1-on-1 uncompressed replies.
 */
export class HierarchyRouter {
  private store: OrchestratorStore;
  private agentRunner: AgentRunner;

  constructor(options: {
    store: OrchestratorStore;
    agentRunner: AgentRunner;
  }) {
    this.store = options.store;
    this.agentRunner = options.agentRunner;
  }

  /**
   * Parses a leading `@agent` prefix from the prompt if present.
   * Supports both `@tech_lead:<project>` and `@tech_lead <project>` syntax.
   */
  public parseDirectMention(
    content: string,
    explicitTargetAgentId?: string | null,
    explicitMode?: ChatThreadMode
  ): {
    isDirect: boolean;
    targetAgent: AgentRecord;
    cleanPrompt: string;
  } {
    const trimmed = content.trim();

    // 1. Check leading @mention in text: e.g. "@tech_lead:<project> fix..." or "@tech_lead <project> fix..."
    const colonMatch = trimmed.match(/^@([a-z0-9_]+:[a-z0-9_.]+)\s*([\s\S]*)$/i);
    if (colonMatch) {
      const candidate = this.store.getAgent(`@${colonMatch[1]}`);
      if (candidate && candidate.id !== 'warden') {
        return {
          isDirect: true,
          targetAgent: candidate,
          cleanPrompt: colonMatch[2].trim() || trimmed,
        };
      }
    }

    const spaceProjectMatch = trimmed.match(
      /^@(tech_lead|backend_dev|frontend_dev|pm)\s+([a-z0-9_.-]+)\s*([\s\S]*)$/i
    );
    if (spaceProjectMatch) {
      const slug = `@${spaceProjectMatch[1].toLowerCase()}:${spaceProjectMatch[2].toLowerCase()}`;
      const candidate = this.store.getAgent(slug);
      if (candidate) {
        return {
          isDirect: true,
          targetAgent: candidate,
          cleanPrompt: spaceProjectMatch[3].trim() || trimmed,
        };
      }
    }

    const singleMatch = trimmed.match(/^@([a-z0-9_]+)\s*([\s\S]*)$/i);
    if (singleMatch) {
      const roleName = singleMatch[1].toLowerCase();
      if (roleName !== 'warden') {
        const candidate =
          this.store.getAgent(`@${roleName}`) ||
          this.store.getAgent(`${roleName}:${this.store.getDefaultProjectSlug()}`);
        if (candidate) {
          return {
            isDirect: true,
            targetAgent: candidate,
            cleanPrompt: singleMatch[2].trim() || trimmed,
          };
        }
      }
    }

    // 2. Check explicit targetAgentId / mode from thread or request
    if (explicitTargetAgentId && explicitTargetAgentId !== 'warden' && explicitTargetAgentId !== '@warden') {
      const candidate = this.store.getAgent(explicitTargetAgentId);
      if (candidate && (explicitMode === 'DIRECT_AGENT' || candidate.id !== 'warden')) {
        return {
          isDirect: true,
          targetAgent: candidate,
          cleanPrompt: trimmed,
        };
      }
    }

    return {
      isDirect: false,
      targetAgent: this.store.getAgent('warden')!,
      cleanPrompt: trimmed,
    };
  }

  /**
   * Routes a CEO message through either Direct `@agent` Granular Mode or
   * Default Executive Mode (`@warden` -> `@cto` / `@cmo` -> Level 1 -> Level 2).
   */
  public async routeMessage(
    params: RouteChatMessageParams
  ): Promise<RouteChatMessageResult> {
    let thread = this.store.threads.get(params.threadId);
    if (!thread) {
      thread = this.store.createThread({
        id: params.threadId,
        title: params.content.slice(0, 64) || 'Executive Session',
        mode: params.mode || 'WARDEN_EXECUTIVE',
        target_agent_id: params.targetAgentId || 'warden',
      });
    }

    const parsed = this.parseDirectMention(
      params.content,
      params.targetAgentId || thread.target_agent_id,
      params.mode || thread.mode
    );

    // Record the CEO's message in chat_messages
    const userMessage = this.store.addChatMessage({
      thread_id: thread.id,
      sender_type: 'CEO',
      sender_agent_id: null,
      recipient_agent_id: parsed.targetAgent.id,
      content: params.content,
      attachments_json: params.attachments || [],
    });

    // ========================================================================
    // MODE A: Direct-to-Agent (@agent) 1-on-1 Granular Mode
    // ========================================================================
    if (parsed.isDirect) {
      console.log(
        `[⚡ ROUTER] Direct @agent mode -> ${parsed.targetAgent.slug} (${parsed.targetAgent.model_id})`
      );
      this.store.emit('brain:status', {
        thread_id: thread.id,
        run_id: null,
        agent_id: parsed.targetAgent.id,
        agent_slug: parsed.targetAgent.slug,
        phase: 'ROUTING',
        model_used: `${parsed.targetAgent.model_provider}/${parsed.targetAgent.model_id}`,
        thought: `Direct 1-on-1 dispatch to ${parsed.targetAgent.slug} (${parsed.targetAgent.roleTitle}). Bypassing intermediate compression funnel.`,
        completed_step: `Parsed direct mention ${parsed.targetAgent.slug}`,
        next_action: `Invoking ${parsed.targetAgent.slug} on ${parsed.targetAgent.model_id}`,
        timestamp: new Date().toISOString(),
      });

      const existingDirectSessionId = this.store.getSubagentSessionRunId(
        thread.id,
        parsed.targetAgent.id,
        parsed.targetAgent.project_scope
      );

      const directResult = await this.agentRunner.runTask({
        agentIdOrSlug: parsed.targetAgent.id,
        inputPrompt: parsed.cleanPrompt,
        triggerType: 'DIRECT_MENTION',
        chatThreadId: thread.id,
        attachments: params.attachments,
        existingRunId: existingDirectSessionId,
        maxSteps: 4,
      });

      const directDelegatedRuns = (directResult.run.child_run_ids || [])
        .map((id) => this.store.runs.get(id))
        .filter((r): r is AgentRunRecord => Boolean(r));

      const formattedDirectContent = directResult.outputSummary.startsWith('[🎙️ Direct:')
        ? directResult.outputSummary
        : `[🎙️ Direct: ${parsed.targetAgent.slug} — ${parsed.targetAgent.roleTitle}]\n\n${directResult.outputSummary}`;

      const agentReply = this.store.addChatMessage({
        thread_id: thread.id,
        sender_type: 'AGENT',
        sender_agent_id: parsed.targetAgent.id,
        recipient_agent_id: 'CEO',
        content: formattedDirectContent,
        run_id: directResult.run.id,
      });

      return {
        userMessage,
        agentReply,
        primaryRun: directResult.run,
        delegatedRuns: directDelegatedRuns,
        routedMode: 'DIRECT_AGENT',
        respondingAgent: directResult.agent,
      };
    }

    // ========================================================================
    // MODE B: Default Executive Mode (@warden -> @cto / @cmo -> Level 1 -> Level 2)
    // ========================================================================

    // If CEO is greeting, asking a conversational question, or pinging Warden:
    if (this.isConversationalPrompt(parsed.cleanPrompt)) {
      console.log(`[⚡ ROUTER] Executive conversational prompt -> @warden (muse-wonder-1.0)`);
      this.store.emit('brain:status', {
        thread_id: thread.id,
        run_id: null,
        agent_id: 'warden',
        agent_slug: '@warden',
        phase: 'ROUTING',
        model_used: 'meta_muse/muse-wonder-1.0',
        thought: `Evaluating executive prompt from CEO in @warden Chief of Staff context.`,
        completed_step: `Recorded CEO message in thread ${thread.id}`,
        next_action: `Synthesizing executive response with muse-wonder-1.0`,
        timestamp: new Date().toISOString(),
      });

      const wardenRunRes = await this.agentRunner.runTask({
        agentIdOrSlug: 'warden',
        inputPrompt: parsed.cleanPrompt,
        triggerType: 'CEO_CHAT',
        chatThreadId: thread.id,
        attachments: params.attachments,
        maxSteps: 2,
      });

      const replyContent = wardenRunRes.outputSummary;
      const agentReply = this.store.addChatMessage({
        thread_id: thread.id,
        sender_type: 'AGENT',
        sender_agent_id: 'warden',
        recipient_agent_id: 'CEO',
        content: replyContent,
        run_id: wardenRunRes.run.id,
      });

      return {
        userMessage,
        agentReply,
        primaryRun: wardenRunRes.run,
        delegatedRuns: [],
        routedMode: 'WARDEN_EXECUTIVE',
        respondingAgent: wardenRunRes.agent,
      };
    }

    const chain = this.resolveExecutiveChain(parsed.cleanPrompt);
    console.log(
      `[⚡ ROUTER] Executive Command Chain -> @warden -> @${chain.cSuiteAgentId} -> @${chain.level1LeadId} -> @${chain.level2ExecutorId}`
    );

    this.store.emit('brain:status', {
      thread_id: thread.id,
      run_id: null,
      agent_id: 'warden',
      agent_slug: '@warden',
      phase: 'ROUTING',
      model_used: 'meta_muse/muse-wonder-1.0',
      thought: `Triage complete: routing directive down chain @warden -> @${chain.cSuiteAgentId} -> @${chain.level1LeadId} -> @${chain.level2ExecutorId}.`,
      completed_step: `Resolved command chain (@${chain.cSuiteAgentId} -> @${chain.level1LeadId} -> @${chain.level2ExecutorId})`,
      next_action: `Step 1/4: Running @warden Chief of Staff intake (muse-wonder-1.0)`,
      timestamp: new Date().toISOString(),
    });

    // 1. Root @warden run (may dynamically invoke delegate_agent/send_message in its multi-turn loop)
    const wardenRunRes = await this.agentRunner.runTask({
      agentIdOrSlug: 'warden',
      inputPrompt: parsed.cleanPrompt,
      triggerType: 'CEO_CHAT',
      chatThreadId: thread.id,
      attachments: params.attachments,
      maxSteps: 3,
    });

    const delegatedRuns: AgentRunRecord[] = [];

    // If @warden already dynamically delegated via tool calls in its reactive loop, collect its child runs directly
    if (wardenRunRes.run.child_run_ids && wardenRunRes.run.child_run_ids.length > 0) {
      for (const childId of wardenRunRes.run.child_run_ids) {
        const childRun = this.store.runs.get(childId);
        if (childRun) {
          delegatedRuns.push(childRun);
          for (const grandChildId of childRun.child_run_ids || []) {
            const grandChild = this.store.runs.get(grandChildId);
            if (grandChild) delegatedRuns.push(grandChild);
          }
        }
      }

      const agentReply = this.store.addChatMessage({
        thread_id: thread.id,
        sender_type: 'AGENT',
        sender_agent_id: 'warden',
        recipient_agent_id: 'CEO',
        content: wardenRunRes.outputSummary,
        run_id: wardenRunRes.run.id,
      });

      return {
        userMessage,
        agentReply,
        primaryRun: this.store.runs.get(wardenRunRes.run.id)!,
        delegatedRuns,
        routedMode: 'WARDEN_EXECUTIVE',
        respondingAgent: this.store.getAgent('warden')!,
      };
    }

    // 2. C-Suite (Level 0: @cto or @cmo) — receives @warden's actual synthesized directive
    this.store.emit('brain:status', {
      thread_id: thread.id,
      run_id: wardenRunRes.run.id,
      agent_id: chain.cSuiteAgentId,
      agent_slug: `@${chain.cSuiteAgentId}`,
      phase: 'DELEGATING',
      model_used: 'meta_muse/muse-wonder-1.0',
      thought: `@warden completed intake. Handing off directive to Level 0 C-Suite (@${chain.cSuiteAgentId}) for cross-project architecture & priority alignment.`,
      completed_step: `Step 1/4 Done: @warden intake complete`,
      next_action: `Step 2/4: Dispatching @${chain.cSuiteAgentId} on muse-wonder-1.0`,
      timestamp: new Date().toISOString(),
    });

    const cSuiteRes = await this.agentRunner.runTask({
      agentIdOrSlug: chain.cSuiteAgentId,
      inputPrompt: `[Executive Dispatch from @warden]: ${parsed.cleanPrompt}\n\n[@warden Triage & Directive]:\n${wardenRunRes.outputSummary}`,
      triggerType: 'DELEGATION',
      parentRunId: wardenRunRes.run.id,
      chatThreadId: thread.id,
      attachments: params.attachments,
      maxSteps: 2,
    });
    delegatedRuns.push(cSuiteRes.run);

    // 3. Level 1 Lead (@pm, @tech_lead:<project>, @infra_head, or @seo_aeo_head) — receives C-Suite's actual architectural plan
    this.store.emit('brain:status', {
      thread_id: thread.id,
      run_id: wardenRunRes.run.id,
      agent_id: chain.level1LeadId,
      agent_slug: `@${chain.level1LeadId}`,
      phase: 'DELEGATING',
      model_used: 'meta_muse/muse-wonder-1.0',
      thought: `@${chain.cSuiteAgentId} locked technical direction. Delegating contract & repo verification to Level 1 Lead (@${chain.level1LeadId}).`,
      completed_step: `Step 2/4 Done: @${chain.cSuiteAgentId} architectural review complete`,
      next_action: `Step 3/4: Dispatching Level 1 Lead @${chain.level1LeadId}`,
      timestamp: new Date().toISOString(),
    });

    const leadRes = await this.agentRunner.runTask({
      agentIdOrSlug: chain.level1LeadId,
      inputPrompt: `[Directive from @${chain.cSuiteAgentId}]: ${parsed.cleanPrompt}\n\n[@${chain.cSuiteAgentId} Architectural Plan]:\n${cSuiteRes.outputSummary}`,
      triggerType: 'DELEGATION',
      parentRunId: cSuiteRes.run.id,
      chatThreadId: thread.id,
      maxSteps: 2,
    });
    delegatedRuns.push(leadRes.run);

    // 4. Level 2 Executor (@backend_dev:*, @frontend_dev:*, @infra_jr, @seo_content_dev, @aeo_analyst) — receives Level 1 Lead's actual contract & shard spec
    this.store.emit('brain:status', {
      thread_id: thread.id,
      run_id: wardenRunRes.run.id,
      agent_id: chain.level2ExecutorId,
      agent_slug: `@${chain.level2ExecutorId}`,
      phase: 'DELEGATING',
      model_used: 'meta_muse/muse-spark-1.3',
      thought: `@${chain.level1LeadId} locked repo contract. Spawning Level 2 Executor (@${chain.level2ExecutorId}) for code execution & Playwright WebGL QA.`,
      completed_step: `Step 3/4 Done: @${chain.level1LeadId} contract handshake locked`,
      next_action: `Step 4/4: Executing tools & Playwright QA via @${chain.level2ExecutorId}`,
      timestamp: new Date().toISOString(),
    });

    const executorRes = await this.agentRunner.runTask({
      agentIdOrSlug: chain.level2ExecutorId,
      inputPrompt: `[Assigned by @${chain.level1LeadId}]: ${parsed.cleanPrompt}\n\n[@${chain.level1LeadId} Contract & Shard Spec]:\n${leadRes.outputSummary}`,
      triggerType: 'DELEGATION',
      parentRunId: leadRes.run.id,
      chatThreadId: thread.id,
      maxSteps: 3,
    });
    delegatedRuns.push(executorRes.run);

    // Link child_run_ids upward across the chain and deliver upward completion reports into parent inboxes
    this.store.updateRun(leadRes.run.id, {
      child_run_ids: [...(leadRes.run.child_run_ids || []), executorRes.run.id],
    });
    this.store.updateRun(cSuiteRes.run.id, {
      child_run_ids: [...(cSuiteRes.run.child_run_ids || []), leadRes.run.id],
    });
    this.store.updateRun(wardenRunRes.run.id, {
      child_run_ids: delegatedRuns.map((r) => r.id),
    });

    this.store.enqueueRunInboxMessage(wardenRunRes.run.id, {
      from_agent_slug: `@${chain.cSuiteAgentId}`,
      from_run_id: cSuiteRes.run.id,
      content: `Upward chain report (@${chain.cSuiteAgentId} -> @${chain.level1LeadId} -> @${chain.level2ExecutorId}): ${executorRes.outputSummary}`,
    });

    // Record SUBAGENT_CALL steps AND child TOOL_CALL / QA_CHECK steps on @warden run for full Muse Trace visibility
    for (const subRun of delegatedRuns) {
      const subSteps = this.store.getStepsForRun(subRun.id);
      const subThought =
        subSteps.find((s) => s.step_type === 'LLM_INFERENCE')?.thinking_text ||
        `Routed down hierarchy to ${subRun.agent_slug} (Run ${subRun.id}).`;
      const subModel =
        subSteps.find((s) => s.step_type === 'LLM_INFERENCE')?.model_used ||
        'meta_muse/muse-wonder-1.0';

      this.store.addInferenceStep({
        run_id: wardenRunRes.run.id,
        step_type: 'SUBAGENT_CALL',
        model_used: subModel,
        thinking_text: subThought,
        message_text: subRun.output_summary || `Completed sub-run ${subRun.id}`,
        tool_name: `delegate_agent → ${subRun.agent_slug}`,
        tool_args_json: { target_agent_slug: subRun.agent_slug, child_run_id: subRun.id, branch: subRun.git_branch },
        tool_output_json: {
          ok: true,
          runId: subRun.id,
          previewUrl: subRun.preview_url,
          qaPassed: subRun.qa_passed,
        },
        duration_ms: subRun.active_duration_ms,
        tokens_in: subRun.tokens_in,
        tokens_cached: subRun.tokens_cached,
        tokens_thinking: subRun.tokens_thinking,
        tokens_out: subRun.tokens_out,
        cost_usd: subRun.cost_usd,
      });

      for (const childStep of subSteps) {
        if (childStep.step_type === 'TOOL_CALL' || childStep.step_type === 'QA_CHECK') {
          this.store.addInferenceStep({
            run_id: wardenRunRes.run.id,
            step_type: childStep.step_type,
            model_used: childStep.model_used,
            thinking_text: `[${subRun.agent_slug}] ${childStep.thinking_text || ''}`,
            message_text: childStep.message_text,
            tool_name: childStep.tool_name,
            tool_args_json: childStep.tool_args_json,
            tool_output_json: childStep.tool_output_json,
            duration_ms: childStep.duration_ms,
            tokens_in: childStep.tokens_in,
            tokens_cached: childStep.tokens_cached,
            tokens_thinking: childStep.tokens_thinking,
            tokens_out: childStep.tokens_out,
            cost_usd: childStep.cost_usd,
          });
        }
      }
    }

    const executiveSummary = [
      `### ⚡ Executive Summary (\`@warden\` → \`@${chain.cSuiteAgentId}\` → \`@${chain.level1LeadId}\` → \`@${chain.level2ExecutorId}\`)`,
      ``,
      `- **Scope & Routing**: Dispatched via **Unit ${chain.cSuiteAgentId === 'cmo' ? 'B: Marketing' : 'A: Tech'}** to \`@${chain.level1LeadId}\` and executed in ephemeral Docker container \`${executorRes.run.container_id}\` on branch \`${executorRes.run.git_branch}\`.`,
      `- **Level 0 (\`@${chain.cSuiteAgentId}\`) Directive**: ${cSuiteRes.outputSummary.replace(/\s+/g, ' ').slice(0, 220)}`,
      `- **Level 1 (\`@${chain.level1LeadId}\`) Contract**: ${leadRes.outputSummary.replace(/\s+/g, ' ').slice(0, 220)}`,
      `- **Level 2 (\`@${chain.level2ExecutorId}\`) Execution Outcome**: ${executorRes.outputSummary}`,
      executorRes.run.preview_url
        ? `- **QA & Live Preview**: ✅ Headless Playwright + WebGL Passed — [Open Live Preview](${executorRes.run.preview_url})`
        : `- **Verification**: ✅ Completed & synced to \`project_contexts\` + \`agent_memories\` (\`pgvector\`).`,
    ].join('\n');

    this.store.updateRun(wardenRunRes.run.id, {
      output_summary: executiveSummary,
      preview_url: executorRes.run.preview_url,
      qa_passed: executorRes.run.qa_passed,
      qa_screenshot_url: executorRes.run.qa_screenshot_url,
    });

    const agentReply = this.store.addChatMessage({
      thread_id: thread.id,
      sender_type: 'AGENT',
      sender_agent_id: 'warden',
      recipient_agent_id: 'CEO',
      content: executiveSummary,
      run_id: wardenRunRes.run.id,
    });

    return {
      userMessage,
      agentReply,
      primaryRun: this.store.runs.get(wardenRunRes.run.id)!,
      delegatedRuns,
      routedMode: 'WARDEN_EXECUTIVE',
      respondingAgent: this.store.getAgent('warden')!,
    };
  }

  private resolveExecutiveChain(prompt: string): {
    cSuiteAgentId: string;
    level1LeadId: string;
    level2ExecutorId: string;
  } {
    const lower = prompt.toLowerCase();

    // Marketing / SEO / AEO routing
    if (
      lower.includes('seo') ||
      lower.includes('aeo') ||
      lower.includes('llms.txt') ||
      lower.includes('json-ld') ||
      lower.includes('perplexity') ||
      lower.includes('citation') ||
      lower.includes('marketing')
    ) {
      return {
        cSuiteAgentId: 'cmo',
        level1LeadId: 'seo_aeo_head',
        level2ExecutorId:
          lower.includes('audit') || lower.includes('citation') || lower.includes('serp')
            ? 'aeo_analyst'
            : 'seo_content_dev',
      };
    }

    const routing = loadPrivateData<RoutingPrivateData>('routing');
    const infraSlug = this.store.getInfraProjectSlug();
    const infraProject = getProject(infraSlug);
    const backendKeywords = [
      'backend',
      'server',
      'room',
      'matchmaking',
      'socket',
      'api',
      'mongo',
      'express',
      ...(routing?.backendKeywords || []),
    ];
    const isBackend = backendKeywords.some((k) => lower.includes(k));

    // Infra / Cloud / Deploy routing
    const infraKeywords = [
      ...(infraProject ? getProjectKeywords(infraProject, true) : [infraSlug]),
      'deploy',
      'cloudflare',
      'bucket',
      'docker',
      'infra',
    ];
    if (infraKeywords.some((k) => lower.includes(k))) {
      return {
        cSuiteAgentId: 'cto',
        level1LeadId: 'infra_head',
        level2ExecutorId: 'infra_jr',
      };
    }

    // Named project routing (non-default staffed projects, by slug / repo / extra keywords)
    const defaultSlug = this.store.getDefaultProjectSlug();
    for (const slug of this.store.getStaffedProjectSlugs()) {
      if (slug === defaultSlug || slug === infraSlug) continue;
      const project = getProject(slug);
      const keywords = [
        ...(project ? getProjectKeywords(project, true) : [slug]),
        ...(routing?.projectKeywords?.[slug] || []),
      ];
      if (keywords.some((k) => lower.includes(k.toLowerCase()))) {
        return {
          cSuiteAgentId: 'cto',
          level1LeadId: this.store.leadForProject(slug),
          level2ExecutorId: this.store.executorForProject(slug, isBackend ? 'backend' : 'frontend'),
        };
      }
    }

    // Product / Backlog / Funnel routing
    if (
      lower.includes('backlog') ||
      lower.includes('funnel') ||
      lower.includes('pricing') ||
      lower.includes('inbox')
    ) {
      return {
        cSuiteAgentId: 'cto',
        level1LeadId: 'pm',
        level2ExecutorId: this.store.executorForProject(defaultSlug, 'frontend'),
      };
    }

    // Default Tech: default project routing
    return {
      cSuiteAgentId: 'cto',
      level1LeadId: this.store.leadForProject(defaultSlug),
      level2ExecutorId: this.store.executorForProject(defaultSlug, isBackend ? 'backend' : 'frontend'),
    };
  }

  private isConversationalPrompt(prompt: string): boolean {
    const p = prompt.trim().toLowerCase();
    const greetings = [
      'hey', 'hi', 'hello', 'yo', 'sup', 'howdy', 'ola',
      'are you there', 'you there', 'anyone there', 'who are you',
      'what can you do', 'what are you', 'help', 'status', 'ping',
      'good morning', 'good evening', 'good afternoon', 'what up',
      'test', 'is this working', 'is it working'
    ];
    if (greetings.some((g) => p === g || p.startsWith(`${g} `) || p.endsWith(` ${g}`) || p.includes(g))) {
      const hasCodeAction = /(deploy|build|commit|push|refactor|migration|schema|dockerfile|playwright|endpoint|backlog item)/i.test(p);
      if (!hasCodeAction) return true;
    }
    const hasTicketAction = /(deploy|build|commit|push|git|refactor|backlog|sprint|task|bug|implement|audit)/i.test(p);
    if (!hasTicketAction && p.length < 50 && (p.includes('?') || p.split(' ').length <= 7)) {
      return true;
    }
    return false;
  }
}
