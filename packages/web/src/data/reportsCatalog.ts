import { INITIAL_STANDUP_REPORTS } from './reportsData';
import type { VerticalScope } from '../components/ConsultationKnob';

export interface UnifiedReportItem {
  id: string;
  title: string;
  subtitle: string;
  vertical: Exclude<VerticalScope, 'ALL'>;
  authorSlug: string;
  projectSlug: string;
  date: string;
  cadenceLabel: string;
  keyMetric: string;
  tokenBurnLabel: string;
  filePath: string;
  status: 'ACTION_NEEDED' | 'VERIFIED' | 'LIVE_AUDIT';
  markdownContent: string;
  isStandupMom?: boolean;
  /** Backlog tasks this report covers. Powers report <-> task jumps. */
  linkedBacklogIds?: string[];
}

export const UNIFIED_REPORTS_CATALOG: UnifiedReportItem[] = [
  {
    id: 'rep-standup-2026-10-27',
    title: 'Daily Standup MoM & CEO Intervention Queue',
    subtitle: 'Cross-vertical 12:00 PM IST rollup: Needs CEO queue, weekly sprint lock, and task movements.',
    vertical: 'TECH',
    authorSlug: '@pm',
    projectSlug: 'all-projects',
    date: '2026-10-27',
    cadenceLabel: '12:00 PM IST Daily',
    keyMetric: '3 Needs CEO • 94.2% Saved',
    tokenBurnLabel: '2.4K tok',
    filePath: 'standups/2026-10-27-standup.md',
    status: 'ACTION_NEEDED',
    markdownContent:
      INITIAL_STANDUP_REPORTS[0]?.markdown_content ||
      '# Daily Standup MoM — 2026-10-27\n\nAll Level 1 & Level 2 agents reported on schedule.',
    isStandupMom: true,
    linkedBacklogIds: ['bl_crash_patch'],
  },
  {
    id: 'rep-trophy-art-qa',
    title: 'Trophy art set QA: sprite atlas + unlock animations',
    subtitle: '12-sprite trophy ladder in the locked style, packed atlas, 4 unlock animations with frame proofs.',
    vertical: 'TECH',
    authorSlug: '@tech_lead',
    projectSlug: 'demo-project',
    date: '2026-10-27',
    cadenceLabel: 'Launch Gate',
    keyMetric: '12 sprites + 4 anims',
    tokenBurnLabel: '2.2K tok',
    filePath: 'reports/trophy-art-qa.md',
    status: 'ACTION_NEEDED',
    markdownContent: `# Trophy Art Set QA (Launch Gate)

## What shipped
- **12 trophy sprites** generated against \`ASSETS_MANIFEST.md\` in the locked neon-arcade style
- **Sprite atlas** packed into the demo game bundle (single draw call per ladder row)
- **4 unlock animations** (bronze to silver to gold to mythic) with per-frame timing proofs

## Verification
- Atlas loads in the game client render loop with zero missing frames
- Unlock sequence plays end to end in the Playwright capture

## Next gate
Approve the trophy asset task to spawn the art team run and attach the live preview here.`,
    linkedBacklogIds: ['bl_trophy_assets'],
  },
  {
    id: 'rep-trophy-seo-cluster',
    title: 'Trophy launch SEO cluster: 4 guides + FAQ schema',
    subtitle: 'How-to trophy guides with FAQPage schema so launch searches land on the demo game.',
    vertical: 'SEO_AEO',
    authorSlug: '@seo_aeo_head',
    projectSlug: 'demo-project',
    date: '2026-10-27',
    cadenceLabel: 'Launch Week',
    keyMetric: '4 guides + FAQ schema',
    tokenBurnLabel: '1.6K tok',
    filePath: 'reports/trophy-seo-cluster.md',
    status: 'VERIFIED',
    markdownContent: `# Trophy Launch SEO Cluster

## Coverage
- **4 how-to guides** (unlock every trophy, ladder rewards, mythic chase, season reset)
- **FAQPage schema** on each guide for answer-engine pickup
- Internal links wired from the launch notes hub

## Verification
- Schema validates with zero warnings; guides render the locked trophy art set

## Next gate
Approve the SEO task to publish the cluster on launch day.`,
    linkedBacklogIds: ['bl_trophy_seo'],
  },
  {
    id: 'rep-trophy-launch-pack',
    title: 'Trophy launch pack: 5 clips + announcement thread',
    subtitle: 'Player-flex clips cut from the new art set plus the launch thread, premiering on Reels + Shorts.',
    vertical: 'SOCIAL',
    authorSlug: '@social_lead',
    projectSlug: 'demo-project',
    date: '2026-10-27',
    cadenceLabel: 'Launch Week',
    keyMetric: '5 clips + thread',
    tokenBurnLabel: '1.4K tok',
    filePath: 'reports/trophy-launch-pack.md',
    status: 'VERIFIED',
    markdownContent: `# Trophy Launch Pack

## Contents
- **5 player-flex clips** cut from the new trophy art set (unlock moments, ladder climbs)
- **Announcement thread** drafted from the art frames with premiere scheduling
- Premiere order: Reels + Shorts first, X thread follows

## Verification
- All clips render the final locked sprites; thread links the playable preview

## Next gate
Approve the social task to schedule the premiere.`,
    linkedBacklogIds: ['bl_trophy_social'],
  },
];
