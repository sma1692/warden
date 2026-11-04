// Onboarding preset data: suggested agents, human roster, and backlog drafts
// shown during the f1/1x/2x steps. Extracted from AuthOnboardingFlow.

export interface SuggestedAgentNode {
  slug: string;
  name: string;
  roleTitle: string;
  vertical: 'TECH' | 'SEO_AEO' | 'SOCIAL';
  level: -1 | 0 | 1 | 2;
  supervisorSlug: string | null;
  tokenCap: string;
  accepted: boolean;
  rationale: string;
}

export interface HumanTeamMember {
  id: string;
  humanName: string;
  humanRole: string;
  currentFocus: string;
  vertical: 'TECH' | 'SEO_AEO' | 'SOCIAL';
  pairedAiTwinSlug: string;
  pairedAiTwinRole: string;
  supervisorSlug: string;
}

export interface OnboardingBacklogDraft {
  id: string;
  title: string;
  vertical: 'TECH' | 'SEO_AEO' | 'SOCIAL';
  priority: 'P0' | 'P1';
  assignee: string;
  project: string;
  enabled: boolean;
}

export const INITIAL_SOLO_AGENTS: SuggestedAgentNode[] = [
  {
    slug: '@warden',
    name: 'Warden',
    roleTitle: 'Root Chief of Staff',
    vertical: 'TECH',
    level: -1,
    supervisorSlug: null,
    tokenCap: '<= 1.5K tok/turn',
    accepted: true,
    rationale: 'Routes executive directives across Tech, SEO/AEO, and Social Media.',
  },
  {
    slug: '@cto',
    name: 'CTO',
    roleTitle: 'Level 0 Head of Tech',
    vertical: 'TECH',
    level: 0,
    supervisorSlug: '@warden',
    tokenCap: '<= 4.0K tok/turn',
    accepted: true,
    rationale: 'Owns technical architecture, contract gates, and multi-repo orchestration.',
  },
  {
    slug: '@cbo',
    name: 'CBO',
    roleTitle: 'Level 0 Chief Business Officer',
    vertical: 'SEO_AEO',
    level: 0,
    supervisorSlug: '@warden',
    tokenCap: '<= 4.0K tok/turn',
    accepted: true,
    rationale: 'Owns revenue EV, AEO citation growth, and social distribution strategy.',
  },
  {
    slug: '@pm',
    name: 'Product Manager',
    roleTitle: 'Level 1 Backlog & Standup Lead',
    vertical: 'TECH',
    level: 1,
    supervisorSlug: '@cto',
    tokenCap: '<= 3.0K tok/turn',
    accepted: true,
    rationale: 'Collates worklist backlogs and runs the 12:00 PM IST daily standup.',
  },
  {
    slug: '@tech_lead',
    name: 'Tech Lead',
    roleTitle: 'Level 1 Architecture & Sharding Lead',
    vertical: 'TECH',
    level: 1,
    supervisorSlug: '@cto',
    tokenCap: '<= 3.5K tok/turn',
    accepted: true,
    rationale: 'Locks API contracts and shards disjoint file sets to Level 2 devs.',
  },
  {
    slug: '@frontend_dev',
    name: 'Frontend & Web App Dev',
    roleTitle: 'Level 2 React / SaaS UI Builder',
    vertical: 'TECH',
    level: 2,
    supervisorSlug: '@tech_lead',
    tokenCap: 'Mirror Sandbox',
    accepted: true,
    rationale: 'Executes NovaPulse web & mobile UI components inside .state/mirror/pulse-core.',
  },
  {
    slug: '@backend_dev',
    name: 'Backend & API Dev',
    roleTitle: 'Level 2 API, Billing & Support Builder',
    vertical: 'TECH',
    level: 2,
    supervisorSlug: '@tech_lead',
    tokenCap: 'Mirror Sandbox',
    accepted: true,
    rationale: 'Implements REST/WebSocket APIs, billing webhooks, and WhatsApp/Email support workflows in pulse-api & pulse-support.',
  },
  {
    slug: '@aeo_lead',
    name: 'SEO / AEO Lead',
    roleTitle: 'Level 1 Search & Answer Engine Lead',
    vertical: 'SEO_AEO',
    level: 1,
    supervisorSlug: '@cbo',
    tokenCap: '<= 2.5K tok/turn',
    accepted: true,
    rationale: 'Maximizes NovaPulse LLM citation share across Meta AI answers and Muse (pulse-seo).',
  },
  {
    slug: '@aeo_specialist',
    name: 'AEO Schema Specialist',
    roleTitle: 'Level 2 JSON-LD & llms.txt Specialist',
    vertical: 'SEO_AEO',
    level: 2,
    supervisorSlug: '@aeo_lead',
    tokenCap: '<= 2.0K tok/turn',
    accepted: true,
    rationale: 'Ships programmatic JSON-LD schemas, /llms.txt, and high-intent comparison clusters on novapulse.io.',
  },
  {
    slug: '@social_lead',
    name: 'Digital Marketing & Social Lead',
    roleTitle: 'Level 1 Viral Growth & Paid Funnel Lead',
    vertical: 'SOCIAL',
    level: 1,
    supervisorSlug: '@cbo',
    tokenCap: '<= 2.5K tok/turn',
    accepted: true,
    rationale: 'Owns founder X/LinkedIn threads, paid acquisition ROAS, and short-form video hook retention (pulse-social).',
  },
  {
    slug: '@social_creator',
    name: 'Content & Ad Creative Builder',
    roleTitle: 'Level 2 Short-Form Video & Campaign Creator',
    vertical: 'SOCIAL',
    level: 2,
    supervisorSlug: '@social_lead',
    tokenCap: '<= 2.0K tok/turn',
    accepted: true,
    rationale: 'Produces 9:16 product demo hooks, customer case-study reels, and X/LinkedIn launch threads.',
  },
];

export const INITIAL_HUMAN_ROSTER: HumanTeamMember[] = [
  {
    id: 'hum-1',
    humanName: 'Alex Rivera',
    humanRole: 'Founder & CEO (NovaPulse — Year 3 Post-Seed/Series A)',
    currentFocus: 'Product Strategy, Enterprise ARR Expansion & Multi-Vertical AI Governance',
    vertical: 'TECH',
    pairedAiTwinSlug: '@warden',
    pairedAiTwinRole: 'Root Chief of Staff + @cto / @cbo Executive Layer',
    supervisorSlug: 'CEO',
  },
  {
    id: 'hum-2',
    humanName: 'Maya Lin',
    humanRole: 'Lead Full-Stack Engineer',
    currentFocus: 'pulse-core & pulse-api v3 checkout orchestration and real-time analytics',
    vertical: 'TECH',
    pairedAiTwinSlug: '@tech_lead',
    pairedAiTwinRole: 'Level 1 Tech Lead + @frontend_dev / @backend_dev Twins',
    supervisorSlug: '@cto',
  },
  {
    id: 'hum-3',
    humanName: 'Liam Vance',
    humanRole: 'Infra & Cloud Lead',
    currentFocus: 'pulse-infra multi-region edge caching, zero-downtime CI/CD & SOC2 monitoring',
    vertical: 'TECH',
    pairedAiTwinSlug: '@infra_head',
    pairedAiTwinRole: 'Level 1 Cloud & Edge Infra Twin (reports to @cto)',
    supervisorSlug: '@cto',
  },
  {
    id: 'hum-4',
    humanName: 'Elena Rostova',
    humanRole: 'Head of SEO & AEO',
    currentFocus: 'pulse-seo programmatic comparison pages, /llms.txt & Meta AI citations',
    vertical: 'SEO_AEO',
    pairedAiTwinSlug: '@aeo_lead',
    pairedAiTwinRole: 'Level 1 SEO/AEO Lead + @aeo_specialist Twin',
    supervisorSlug: '@cbo',
  },
  {
    id: 'hum-5',
    humanName: 'Marcus Sterling',
    humanRole: 'Digital Marketing & Social Lead',
    currentFocus: 'pulse-social founder X/LinkedIn authority funnels & product launch campaigns',
    vertical: 'SOCIAL',
    pairedAiTwinSlug: '@social_lead',
    pairedAiTwinRole: 'Level 1 Digital Marketing & Social Lead Twin',
    supervisorSlug: '@cbo',
  },
  {
    id: 'hum-6',
    humanName: 'Chloe Park',
    humanRole: 'Content & Paid Campaigns Lead',
    currentFocus: 'pulse-social 9:16 product reels, YouTube shorts & paid acquisition creatives',
    vertical: 'SOCIAL',
    pairedAiTwinSlug: '@social_creator',
    pairedAiTwinRole: 'Level 2 Content & Ad Creative Twin (reports to @social_lead)',
    supervisorSlug: '@cbo',
  },
  {
    id: 'hum-7',
    humanName: 'Samir Patel',
    humanRole: 'Customer Support & Ops Lead',
    currentFocus: 'pulse-support 24/7 WhatsApp/Email AI concierge & enterprise SLA triage',
    vertical: 'TECH',
    pairedAiTwinSlug: '@support_lead',
    pairedAiTwinRole: 'Level 1 Customer Support & Concierge Twin (reports to @cbo)',
    supervisorSlug: '@cbo',
  },
];

export const INITIAL_BACKLOG_DRAFTS: OnboardingBacklogDraft[] = [
  {
    id: 'ob-1',
    title: 'Ship NovaPulse v3 One-Click Checkout & Real-Time Webhook Pipeline',
    vertical: 'TECH',
    priority: 'P0',
    assignee: '@tech_lead',
    project: 'pulse-core',
    enabled: true,
  },
  {
    id: 'ob-2',
    title: 'Automate Multi-Region Edge Failover & Daily Encrypted DB Snapshots',
    vertical: 'TECH',
    priority: 'P0',
    assignee: '@backend_dev',
    project: 'pulse-infra',
    enabled: true,
  },
  {
    id: 'ob-3',
    title: 'Publish /llms.txt & SoftwareApplication JSON-LD Schema on novapulse.io',
    vertical: 'SEO_AEO',
    priority: 'P0',
    assignee: '@aeo_lead',
    project: 'pulse-seo',
    enabled: true,
  },
  {
    id: 'ob-4',
    title: 'Launch 25 Programmatic High-Intent SaaS Comparison Landing Pages',
    vertical: 'SEO_AEO',
    priority: 'P1',
    assignee: '@aeo_specialist',
    project: 'pulse-seo',
    enabled: true,
  },
  {
    id: 'ob-5',
    title: 'Produce 5 Short-Form 9:16 Product Demo Hooks & Customer ROI Reels',
    vertical: 'SOCIAL',
    priority: 'P0',
    assignee: '@social_creator',
    project: 'pulse-social',
    enabled: true,
  },
  {
    id: 'ob-6',
    title: 'Deploy Automated WhatsApp & Email Tier-1 Support Concierge Deflection Flow',
    vertical: 'TECH',
    priority: 'P1',
    assignee: '@backend_dev',
    project: 'pulse-support',
    enabled: true,
  },
  {
    id: 'ob-7',
    title: 'Generate 8-bit sprite pack via @designer & wire into game-client',
    vertical: 'TECH',
    priority: 'P0',
    assignee: '@designer',
    project: 'pulse-core',
    enabled: true,
  },
];
