import {
  AgentRunRecord,
  ApprovalGateRecord,
  BacklogItemRecord,
  ChatThreadRecord,
  OrchestratorStore,
  SprintRecord,
  SprintTaskMovementEntry,
  SprintWeeklyPlanEntry,
} from './OrchestratorStore.js';
import { AgentRunner } from './AgentRunner.js';
import { TelegramPushPager } from '../telegram/TelegramPushPager.js';
import { IdleBacklogMonitor } from '../watchdogs/IdleBacklogMonitor.js';

export interface TriggerStandupResult {
  sprint: SprintRecord;
  triagedItems: BacklogItemRecord[];
  activeSprintItems: BacklogItemRecord[];
  gate: ApprovalGateRecord;
  thread: ChatThreadRecord;
  leadRuns: AgentRunRecord[];
}

export interface ApproveSprintResult {
  sprint: SprintRecord;
  executedRuns: AgentRunRecord[];
  completedItems: BacklogItemRecord[];
}

/**
 * StandupCoordinator — 12:00 PM IST Automated & On-Demand Daily Standup Engine
 * (dynamocommando.md Sections 1.5, 4.8, 5.3)
 *
 * 1. Polls `@pm`, each project's `@pm:<project>` / `@tech_lead:<project>`, `@infra_head`, and `@seo_aeo_head`.
 * 2. Triages raw `INBOX` items into `TODO` with assigned priority & executor agent.
 * 3. Synthesizes `mom_summary_md` in `sprints` (`AWAITING_CEO_APPROVAL`).
 * 4. Creates a `STANDUP_SIGN_OFF` ApprovalGate and fires a 1-way Telegram Push Pager alert.
 * 5. When the CEO taps [Approve & Execute Sprint], dispatches the assigned agents in parallel.
 */
export class StandupCoordinator {
  private store: OrchestratorStore;
  private agentRunner: AgentRunner;
  private telegramPager: TelegramPushPager;
  private idleMonitor?: IdleBacklogMonitor;

  constructor(options: {
    store: OrchestratorStore;
    agentRunner: AgentRunner;
    telegramPager: TelegramPushPager;
    idleMonitor?: IdleBacklogMonitor;
  }) {
    this.store = options.store;
    this.agentRunner = options.agentRunner;
    this.telegramPager = options.telegramPager;
    this.idleMonitor = options.idleMonitor;
  }

  /**
   * Alias for `triggerDailyStandup` used by the 12:00 PM IST cron scheduler.
   */
  public async runDailyStandup(_triggerSource?: string): Promise<TriggerStandupResult> {
    return this.triggerDailyStandup();
  }

  /**
   * Triggers the 12:00 PM IST Daily Standup.
   */
  public async triggerDailyStandup(options?: {
    dateIst?: string;
    autoExecute?: boolean;
  }): Promise<TriggerStandupResult> {
    const dateIst =
      options?.dateIst || new Date().toISOString().slice(0, 10);
    const sprintId = `spr_${dateIst.replace(/-/g, '_')}`;

    // 1. Triage INBOX items into TODO via per-project PMs (@pm:<project>, @infra_head, @pm)
    const triagedItems: BacklogItemRecord[] = [];
    const movements: SprintTaskMovementEntry[] = [];
    const nowIso = new Date().toISOString();

    for (const item of this.store.backlogItems.values()) {
      if (item.stage === 'INBOX') {
        const assigned = this.inferExecutorForBacklogItem(item);
        const pmOwner = item.pm_owner_id || this.store.pmForProject(item.project_slug, 'pm');
        const updated = this.store.updateBacklogItem(item.id, {
          stage: 'TODO',
          priority: item.priority || 'P1',
          pm_owner_id: pmOwner,
          assigned_agent_id: assigned,
          sprint_id: sprintId,
          target_week: '2026-W43',
          moved_by_agent_id: pmOwner,
          movement_reason: `Triaged INBOX -> TODO for Week 2026-W43 by @${pmOwner}`,
        });
        if (updated) {
          triagedItems.push(updated);
          movements.push({
            id: `mv_${item.id}`,
            backlog_item_id: updated.id,
            title: updated.title,
            project_slug: updated.project_slug,
            from_stage: 'INBOX',
            to_stage: 'TODO',
            from_priority: item.priority,
            to_priority: updated.priority,
            moved_by_agent_id: pmOwner,
            reason: `Triaged INBOX -> TODO for Week 2026-W43 by @${pmOwner}`,
            moved_at: nowIso,
          });
        }
      } else if (item.stage === 'TODO' && !item.sprint_id) {
        this.store.updateBacklogItem(item.id, { sprint_id: sprintId, target_week: '2026-W43' });
      }
    }

    const activeSprintItems = Array.from(this.store.backlogItems.values()).filter(
      (b) => b.stage === 'TODO' || b.stage === 'IN_PROGRESS'
    );
    const humanInterventionItems = Array.from(this.store.backlogItems.values()).filter(
      (b) => b.stage === 'NEEDS_CEO' || b.requires_human_intervention
    );

    // 2. Poll Project PMs & Senior Leads (@pm:<project>, @pm, @tech_lead:<project>, @infra_head, @seo_aeo_head)
    const staffedProjects = this.store
      .getStaffedProjectSlugs()
      .filter((slug) => slug !== this.store.getInfraProjectSlug());
    const projectPmIds = staffedProjects
      .map((slug) => `pm:${slug}`)
      .filter((id) => this.store.agents.has(id));
    const projectLeadIds = staffedProjects
      .map((slug) => `tech_lead:${slug}`)
      .filter((id) => this.store.agents.has(id));
    const polledLeadIds = [
      ...projectPmIds,
      'pm',
      ...projectLeadIds,
      'infra_head',
      'seo_aeo_head',
    ].filter((id) => this.store.agents.has(id));
    const defaultLeadId = this.store.leadForProject(this.store.getDefaultProjectSlug());

    const thread = this.store.createThread({
      title: `📋 12:00 PM IST Standup & Weekly Plan — ${dateIst}`,
      mode: 'STANDUP',
      target_agent_id: 'cto',
      project_scope: null,
      status: 'WAITING_FOR_CEO',
    });

    const leadRuns: AgentRunRecord[] = [];
    for (const leadId of polledLeadIds) {
      const leadRes = await this.agentRunner.runTask({
        agentIdOrSlug: leadId,
        inputPrompt: `12:00 PM IST Pre-Standup Poll (${dateIst}): Report what is decided for the week (P0/P1/P2), task movements across stages, and any NEEDS_CEO human intervention tasks (questions, API keys, manual actions).`,
        triggerType: 'DAILY_STANDUP',
        chatThreadId: thread.id,
        sprintId,
        maxSteps: 1,
      });
      leadRuns.push(leadRes.run);
    }

    // 3. Build Weekly Plan (weekly_plan_json) & Task Movements (task_movements_json)
    const weeklyPlan: SprintWeeklyPlanEntry[] = activeSprintItems.map((item) => ({
      backlog_item_id: item.id,
      title: item.title,
      project_slug: item.project_slug,
      pm_owner_id: item.pm_owner_id || 'pm',
      assigned_agent_id: item.assigned_agent_id || defaultLeadId,
      priority: item.priority,
      stage: item.stage,
      target_week: item.target_week || '2026-W43',
    }));

    for (const hi of humanInterventionItems) {
      movements.push({
        id: `mv_hi_${hi.id}`,
        backlog_item_id: hi.id,
        title: hi.title,
        project_slug: hi.project_slug,
        from_stage: 'TODO',
        to_stage: 'NEEDS_CEO',
        from_priority: hi.priority,
        to_priority: hi.priority,
        moved_by_agent_id: hi.requested_by_agent_id || hi.pm_owner_id || 'pm',
        reason: hi.last_movement_note || `Flagged for CEO intervention (${hi.intervention_type || 'QUESTION'})`,
        moved_at: hi.last_moved_at || nowIso,
      });
    }

    const infraSlug = this.store.getInfraProjectSlug();
    const infraTasks = activeSprintItems.filter((i) => i.project_slug === infraSlug);
    const marketingTasks = activeSprintItems.filter(
      (i) => i.project_slug === 'marketing' || i.project_slug === 'product'
    );

    const formatTaskLines = (items: BacklogItemRecord[]) =>
      items.length > 0
        ? items
            .map(
              (t) =>
                `- **[${t.priority}]** ${t.title} → PM: \`@${t.pm_owner_id || 'pm'}\` | Exec: \`@${t.assigned_agent_id || defaultLeadId}\``
            )
            .join('\n')
        : `- *Queue clear — ready for next initiatives*`;

    const formatInterventionLines = (items: BacklogItemRecord[]) =>
      items.length > 0
        ? items
            .map(
              (t) =>
                `- **[${t.priority} | ${t.intervention_type || 'QUESTION'}]** (${t.project_slug}) ${t.title} — *${t.intervention_prompt || 'Requires CEO input'}*`
            )
            .join('\n')
        : `- *0 pending human intervention tasks*`;

    const projectSections = staffedProjects.flatMap((slug, idx) => [
      `### ${3 + idx}. 🗓️ What is Decided for the Week — ${slug} (\`@${this.store.pmForProject(slug, 'pm')}\` + \`@${this.store.leadForProject(slug)}\`)`,
      formatTaskLines(activeSprintItems.filter((i) => i.project_slug === slug)),
      ``,
    ]);
    const nextSection = 3 + staffedProjects.length;
    const scopeNames = [...staffedProjects, infraSlug, 'Marketing'].join(', ');

    const momSummaryMd = [
      `# 📋 12:00 PM IST Standup: Weekly Plan & Task Movements (${dateIst} — Week 2026-W43)`,
      `**Chaired by**: \`@cto\` | **Project PMs**: ${[...projectPmIds, 'pm'].map((id) => `\`@${id}\``).join(', ')} | **Leads**: ${[...projectLeadIds, 'infra_head', 'seo_aeo_head'].map((id) => `\`@${id}\``).join(', ')}`,
      ``,
      `### 1. 🚨 Human / CEO Intervention Tasks in Backlogs (\`NEEDS_CEO\`: ${humanInterventionItems.length})`,
      formatInterventionLines(humanInterventionItems),
      ``,
      `### 2. 🔄 Moving Around Tasks (Board & Priority Transitions)`,
      `- Triaged **${triagedItems.length}** raw \`INBOX\` item(s) into prioritized \`TODO\` specs for Week \`2026-W43\`.`,
      `- Active weekly sprint commitments: **${activeSprintItems.length}** task(s) across ${scopeNames}.`,
      ...movements.slice(0, 8).map(
        (m) =>
          `- \`${m.backlog_item_id}\` (${m.project_slug}): \`${m.from_stage} -> ${m.to_stage}\` by \`@${m.moved_by_agent_id}\` — ${m.reason}`
      ),
      ``,
      ...projectSections,
      `### ${nextSection}. 🗓️ What is Decided for the Week — Multi-Cloud & Infra (\`@infra_head\` + \`@infra_jr\`)`,
      formatTaskLines(infraTasks),
      ``,
      `### ${nextSection + 1}. 🗓️ What is Decided for the Week — Marketing, SEO & AEO (\`@seo_aeo_head\`)`,
      formatTaskLines(marketingTasks),
    ].join('\n');

    const sprint: SprintRecord = {
      id: sprintId,
      date_ist: dateIst,
      week_label: '2026-W43',
      status: 'AWAITING_CEO_APPROVAL',
      mom_summary_md: momSummaryMd,
      weekly_plan_json: weeklyPlan,
      task_movements_json: movements,
      approved_at: null,
      ceo_notes: null,
      created_at: new Date().toISOString(),
    };
    this.store.sprints.set(sprint.id, sprint);

    this.store.addChatMessage({
      thread_id: thread.id,
      sender_type: 'AGENT',
      sender_agent_id: 'cto',
      recipient_agent_id: 'CEO',
      content: momSummaryMd,
    });

    // 4. Create STANDUP_SIGN_OFF ApprovalGate
    const gate = this.store.createApprovalGate({
      run_id: leadRuns[0]?.id ?? null,
      thread_id: thread.id,
      sprint_id: sprint.id,
      agent_id: 'cto',
      department: 'Tech',
      project_scope: null,
      gate_type: 'STANDUP_SIGN_OFF',
      prompt_text: `12:00 PM IST Daily Standup (${dateIst}) ready for CEO sign-off (${activeSprintItems.length} sprint tasks queued).`,
      options_json: {
        choices: ['APPROVE_AND_EXECUTE_SPRINT', 'HOLD_FOR_EDITS'],
        sprint_id: sprint.id,
      },
      telegram_notified_at: new Date().toISOString(),
    });

    // 5. Fire Telegram Push Pager alert
    await this.telegramPager.notifyStandupReady({
      sprintId: sprint.id,
      dateIst,
      summaryPreview: `${activeSprintItems.length} prioritized tasks across ${scopeNames} ready for parallel execution.`,
      threadId: thread.id,
      gateId: gate.id,
    });

    if (options?.autoExecute) {
      await this.approveAndExecuteSprint(sprint.id, 'Auto-approved via standup trigger');
    }

    return {
      sprint: this.store.sprints.get(sprint.id)!,
      triagedItems,
      activeSprintItems,
      gate,
      thread,
      leadRuns,
    };
  }

  /**
   * Called when the CEO taps [Approve & Execute Sprint] in the Dashboard.
   * Dispatches all assigned agents in parallel across their ephemeral Docker sandboxes.
   */
  public async approveAndExecuteSprint(
    sprintId: string,
    ceoNotes?: string | null
  ): Promise<ApproveSprintResult> {
    let sprint = this.store.sprints.get(sprintId);
    if (!sprint) {
      const dateIst = new Date().toISOString().slice(0, 10);
      sprint = {
        id: sprintId,
        date_ist: dateIst,
        status: 'AWAITING_CEO_APPROVAL',
        mom_summary_md: `# Sprint ${sprintId}`,
        approved_at: null,
        ceo_notes: null,
        created_at: new Date().toISOString(),
      };
      this.store.sprints.set(sprintId, sprint);
    }

    sprint.status = 'EXECUTING';
    sprint.approved_at = new Date().toISOString();
    sprint.ceo_notes = ceoNotes ?? null;
    this.store.sprints.set(sprint.id, sprint);

    // Resolve any pending STANDUP_SIGN_OFF gate for this sprint
    for (const gate of this.store.approvalGates.values()) {
      if (
        gate.status === 'PENDING' &&
        gate.gate_type === 'STANDUP_SIGN_OFF' &&
        (gate.sprint_id === sprintId ||
          gate.options_json?.sprint_id === sprintId)
      ) {
        this.store.resolveApprovalGate(
          gate.id,
          ceoNotes || 'APPROVED_AND_EXECUTING'
        );
      }
    }

    // Find all TODO / IN_PROGRESS backlog items for this sprint (or active queue)
    const tasksToRun = Array.from(this.store.backlogItems.values()).filter(
      (item) =>
        (item.sprint_id === sprintId || !item.sprint_id) &&
        (item.stage === 'TODO' || item.stage === 'IN_PROGRESS')
    );

    // Move items to IN_PROGRESS
    for (const task of tasksToRun) {
      this.store.updateBacklogItem(task.id, {
        stage: 'IN_PROGRESS',
        sprint_id: sprint.id,
      });
    }

    // Dispatch assigned agents in parallel
    const runPromises = tasksToRun.map(async (task) => {
      const assignedId =
        task.assigned_agent_id || this.inferExecutorForBacklogItem(task);
      const res = await this.agentRunner.runTask({
        agentIdOrSlug: assignedId,
        inputPrompt: `[Sprint ${sprint.id} — ${task.priority}] ${task.title}\n\n${task.spec_md}`,
        triggerType: 'DAILY_STANDUP',
        sprintId: sprint.id,
        backlogItemId: task.id,
      });

      this.store.updateBacklogItem(task.id, {
        stage: 'DONE',
      });

      return res.run;
    });

    const executedRuns = await Promise.all(runPromises);
    const completedItems = tasksToRun
      .map((t) => this.store.backlogItems.get(t.id)!)
      .filter(Boolean);

    sprint.status = 'COMPLETED';
    this.store.sprints.set(sprint.id, sprint);

    if (this.idleMonitor && completedItems.length > 0) {
      const touchedScopes = new Set(completedItems.map((i) => i.project_slug));
      for (const scope of touchedScopes) {
        await this.idleMonitor.onBacklogItemCompleted(scope);
      }
    }

    return {
      sprint,
      executedRuns,
      completedItems,
    };
  }

  private inferExecutorForBacklogItem(item: BacklogItemRecord): string {
    if (item.assigned_agent_id && item.assigned_agent_id !== 'pm') {
      return item.assigned_agent_id;
    }
    const text = `${item.title} ${item.spec_md}`.toLowerCase();
    if (item.project_slug === this.store.getInfraProjectSlug() || text.includes('deploy') || text.includes('gcs')) {
      return 'infra_jr';
    }
    if (item.project_slug === 'marketing' || text.includes('llms.txt') || text.includes('seo')) {
      return 'seo_content_dev';
    }
    const slug = this.store.getStaffedProjectSlugs().includes(item.project_slug)
      ? item.project_slug
      : this.store.getDefaultProjectSlug();
    const isBackend =
      text.includes('server') ||
      text.includes('room') ||
      text.includes('api') ||
      text.includes('rest') ||
      text.includes('mongo');
    return this.store.executorForProject(slug, isBackend ? 'backend' : 'frontend');
  }
}
