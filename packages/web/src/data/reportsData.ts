import type { StandupReport } from '../types/commando';

// Public demo data: generic standup reports for the example workspace
// (demo-game, example-api, infra-ops). Replace with your own reports.

export const INITIAL_STANDUP_REPORTS: StandupReport[] = [
  {
    id: 'standup_2026_w44',
    date: '2026-10-26',
    title: 'Daily Standup: Week 44 Sprint Lock',
    chair: '@cto',
    sprint_week: 'W44 (Oct 26 - Nov 1)',
    status: 'AWAITING_CEO_APPROVAL',
    needs_ceo_count: 3,
    total_commitments: 9,
    polled_agents: [
      '@cto',
      '@pm',
      '@pm:demo-game',
      '@tech_lead:demo-game',
      '@tech_lead:example-api',
      '@infra_head',
      '@seo_aeo_head',
    ],
    markdown_content: `# Daily Standup: Week 44 Sprint Lock

**Chair**: \`@cto\` · **Polled**: \`@pm\`, \`@pm:demo-game\`, \`@tech_lead:demo-game\`, \`@tech_lead:example-api\`, \`@infra_head\`, \`@seo_aeo_head\`

## 1. 🚨 [NEEDS_CEO] Human Intervention Queue

| ID | Priority | Project | Type | Requested By | Ask | Unblocks |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| \`DG-HI-01\` | \`P0\` | \`demo-game\` | \`QUESTION\` | \`@pm:demo-game\` | Confirm the production host for the web build: \`play.example.com\` or \`beta.example.com\`. | \`DG-101\` |
| \`API-HI-01\` | \`P0\` | \`example-api\` | \`API_KEY\` | \`@tech_lead:example-api\` | Add \`ANALYTICS_WRITE_KEY\` to \`.env\` so the event pipeline can ship funnel metrics. | \`API-104\` |
| \`OPS-HI-01\` | \`P1\` | \`infra-ops\` | \`DECISION\` | \`@infra_head\` | Approve a read-only multi-region cost scan before rightsizing the sandbox fleet. | \`OPS-102\` |

## 2. 🗓️ What is Decided for the Week

1. **\`demo-game\` (\`@pm:demo-game\`)**: Ship the loading-screen polish, lock 60fps on mobile, and publish the weekly build.
2. **\`example-api\` (\`@tech_lead:example-api\`)**: Finish the leaderboard endpoint contract and add rate limiting to session routes.
3. **\`infra-ops\` (\`@infra_head\`)**: Automate nightly database backups and add uptime monitoring dashboards.

## 3. 🔄 Moving Around Tasks

- \`DG-103\` (\`demo-game\`): \`TODO -> IN_PROGRESS\` (pulled forward to unblock the weekly build).
- \`API-102\` (\`example-api\`): \`INBOX -> TODO (P1)\` (triaged by \`@pm\`).
- \`OPS-105..106\` (\`infra-ops\`): \`INBOX -> TODO (P0)\` (backup and monitoring pillars).
`,
  },
  {
    id: 'standup_2026_w43',
    date: '2026-10-19',
    title: 'Daily Standup: Week 43 Retro & Carry-Over',
    chair: '@cto',
    sprint_week: 'W43 (Oct 19 - Oct 25)',
    status: 'APPROVED_EXECUTING',
    needs_ceo_count: 1,
    total_commitments: 7,
    polled_agents: ['@cto', '@pm', '@pm:demo-game', '@tech_lead:demo-game', '@infra_head'],
    markdown_content: `# Daily Standup: Week 43 Retro & Carry-Over

**Chair**: \`@cto\` · **Status**: Approved and executing

## Shipped

- \`demo-game\` shipped the progression system and the first funnel tracking events.
- \`example-api\` merged the session refresh fix and raised test coverage to 82%.
- \`infra-ops\` moved preview deploys to the shared sandbox pool.

## Carry-Over

- \`DG-105\` hardware playtest on a VR headset (needs CEO time).
- \`OPS-101\` DNS upsert automation (waiting on a scoped API token).
`,
  },
];

export interface ReportNeedsCeoCard {
  id: string;
  priority: string;
  project: string;
  type: string;
  requester: string;
  desc: string;
  unblocks: string;
}

export interface ReportWeeklyPlanEntry {
  project: string;
  title: string;
  owner: string;
  tasks: string[];
}

export interface ReportTaskMovement {
  id: string;
  project: string;
  movement: string;
  priority: string;
  movedBy?: string;
  reason: string;
}

export const REPORT_NEEDS_CEO_CARDS: ReportNeedsCeoCard[] = [
  {
    id: 'DG-HI-01',
    priority: 'P0',
    project: 'demo-game',
    type: 'QUESTION',
    requester: '@pm:demo-game',
    desc: 'Production Host: Confirm whether the web build deploys to play.example.com or beta.example.com.',
    unblocks: 'DG-101',
  },
  {
    id: 'API-HI-01',
    priority: 'P0',
    project: 'example-api',
    type: 'API_KEY',
    requester: '@tech_lead:example-api',
    desc: 'Add ANALYTICS_WRITE_KEY to .env / Credential Vault so the event pipeline can ship funnel metrics.',
    unblocks: 'API-104',
  },
  {
    id: 'DG-HI-02',
    priority: 'P1',
    project: 'demo-game',
    type: 'MANUAL_ACTION',
    requester: '@pm:demo-game',
    desc: 'Hardware Playtest: Run the current build on a VR headset and drop a bug list in the backlog.',
    unblocks: 'DG-105',
  },
  {
    id: 'OPS-HI-01',
    priority: 'P1',
    project: 'infra-ops',
    type: 'DECISION',
    requester: '@infra_head',
    desc: 'Approve a read-only multi-region cost scan before rightsizing the sandbox fleet.',
    unblocks: 'OPS-102',
  },
];

export const REPORT_WEEKLY_PLAN: ReportWeeklyPlanEntry[] = [
  {
    project: 'demo-game',
    title: 'Weekly Build & Performance',
    owner: '@pm:demo-game',
    tasks: [
      'DG-101: Production host cutover and smoke test',
      'DG-103: Loading-screen polish and asset preloading',
      'DG-104: Lock 60fps on mid-range mobile',
    ],
  },
  {
    project: 'example-api',
    title: 'Leaderboard & Session Hardening',
    owner: '@tech_lead:example-api',
    tasks: [
      'API-102: Leaderboard endpoint contract and implementation',
      'API-103: Rate limiting on session routes',
      'API-104: Analytics event pipeline',
    ],
  },
  {
    project: 'infra-ops',
    title: 'Backup & Monitoring Pillars',
    owner: '@infra_head',
    tasks: [
      'OPS-105: Nightly database backups with retention policy',
      'OPS-106: Uptime monitoring and health dashboards',
    ],
  },
  {
    project: 'marketing',
    title: 'SEO & AI Citation Baseline',
    owner: '@seo_aeo_head',
    tasks: [
      'MKT-101: Publish llms.txt and JSON-LD for the landing page',
      'MKT-102: Weekly AI citation share-of-voice probe',
    ],
  },
];

export const REPORT_TASK_MOVEMENTS: ReportTaskMovement[] = [
  {
    id: 'DG-103',
    project: 'demo-game',
    movement: 'TODO → IN_PROGRESS',
    priority: 'P1 → P0',
    movedBy: '@pm:demo-game',
    reason: 'Pulled forward to unblock the weekly build.',
  },
  {
    id: 'API-102',
    project: 'example-api',
    movement: 'INBOX → TODO',
    priority: '→ P1',
    movedBy: '@pm',
    reason: 'Triaged from the inbox after the leaderboard contract was agreed.',
  },
  {
    id: 'OPS-105..106',
    project: 'infra-ops',
    movement: 'INBOX → TODO',
    priority: '→ P0',
    movedBy: '@infra_head',
    reason: 'Added backup and monitoring pillars to the infra roadmap.',
  },
];
