/**
 * Demo link map: the glue between chats and backlog tasks.
 *
 * Chats create backlogs (origin thread) and running backlogs create chats
 * (spawned lead threads). This module holds the demo-story links plus the
 * scripted spawn tree each trophy task fans out into on approval.
 */

/** One node of a task's delegation tree. Children run under their parent. */
export interface DemoSpawnNode {
  agentSlug: string;
  summary: string;
  children?: DemoSpawnNode[];
}

/** Backlog task -> the earlier chat thread that created it. */
export const DEMO_ORIGIN_THREAD_BY_BACKLOG: Record<string, string> = {
  bl_lobby_bootstrap: 'thr_trophy_brief',
  bl_trophy_assets: 'thr_trophy_brief',
  bl_crash_patch: 'thr_trophy_brief',
  bl_trophy_seo: 'thr_trophy_brief',
  bl_trophy_social: 'thr_trophy_brief',
  bl_dj_101: 'thr_demo_game_loot',
  bl_sprite_401: 'thr_demo_game_loot',
  bl_mkt_201: 'thr_seo_aeo',
  bl_rw_302: 'thr_arcadehub_idle',
};

/** Scripted delegation tree per demo task, played out on approval. */
export const DEMO_SPAWN_TREE_BY_BACKLOG: Record<string, DemoSpawnNode> = {
  bl_lobby_bootstrap: {
    agentSlug: '@warden',
    summary: 'Approved by CEO. Routing the dungeon lobby & crest bootstrap to @cto for execution.',
    children: [
      {
        agentSlug: '@cto',
        summary: 'Dungeon entry flow first: custom SVG crest loader plus torchlit lobby before trophy relics land. Delegating to @tech_lead.',
        children: [
          {
            agentSlug: '@tech_lead',
            summary: 'Locking cartoon-dungeon theme contract. Spawning @designer for crest SVG and @frontend_dev for lobby UI.',
            children: [
              {
                agentSlug: '@frontend_dev',
                summary: 'Building the torchlit dungeon loading screen, custom SVG crest lockup, and Arena Lobby with Play button.',
              },
              {
                agentSlug: '@designer',
                summary: 'Crafting the vector Dungeon Shield & Runeblade crest emblem and Knight vs Slime hero preview.',
              },
            ],
          },
        ],
      },
    ],
  },
  bl_trophy_assets: {
    agentSlug: '@warden',
    summary: 'Approved by CEO. Routing dungeon trophy relic art set to @cto for execution.',
    children: [
      {
        agentSlug: '@cto',
        summary: 'Splitting dungeon relic sprite generation from game bundle integration. Delegating to @tech_lead.',
        children: [
          {
            agentSlug: '@tech_lead',
            summary: 'Locking cartoon-dungeon relic style. Spawning @designer for 12 dungeon sprites and @frontend_dev for the atlas.',
            children: [
              {
                agentSlug: '@designer',
                summary: 'Generating 12 dungeon trophy relic sprites (Buckler, Runeblade, Chalice, Soul Gem, Dragon Crown) via muse-image against ASSETS_MANIFEST.',
              },
              {
                agentSlug: '@frontend_dev',
                summary: 'Packing the dungeon sprite atlas, wiring 4 unlock animations, and styling the carved stone board.',
              },
            ],
          },
        ],
      },
    ],
  },
  bl_crash_patch: {
    agentSlug: '@warden',
    summary: 'Approved by CEO. Routing the arena crash hotfix to @cto.',
    children: [
      {
        agentSlug: '@cto',
        summary: 'Minimal-scope guard approved. @tech_lead owns the patch and proof.',
        children: [
          {
            agentSlug: '@tech_lead',
            summary: 'Assigning @frontend_dev: end-state guard plus Playwright regression.',
            children: [
              {
                agentSlug: '@frontend_dev',
                summary: 'Shipping the match-end guard with a regression test and the reporter auto-reply.',
              },
            ],
          },
        ],
      },
    ],
  },
  bl_trophy_seo: {
    agentSlug: '@warden',
    summary: 'Approved by CEO. Routing launch search coverage to @cmo.',
    children: [
      {
        agentSlug: '@cmo',
        summary: 'How-to intent first. @seo_aeo_head owns the trophy cluster.',
        children: [
          {
            agentSlug: '@seo_aeo_head',
            summary: 'Drafting 4 how-to guides. @seo_content_dev adds FAQ schema and ships.',
            children: [
              {
                agentSlug: '@seo_content_dev',
                summary: 'Publishing the trophy guide cluster with FAQPage schema.',
              },
            ],
          },
        ],
      },
    ],
  },
  bl_trophy_social: {
    agentSlug: '@warden',
    summary: 'Approved by CEO. Routing the launch pack to @cmo.',
    children: [
      {
        agentSlug: '@cmo',
        summary: 'Player-flex angle first. @social_lead owns the premiere.',
        children: [
          {
            agentSlug: '@social_lead',
            summary: 'Cutting 5 clips from the art set. @social_creator drafts the thread.',
            children: [
              {
                agentSlug: '@social_creator',
                summary: 'Scheduling the Reels + Shorts premiere and the launch thread.',
              },
            ],
          },
        ],
      },
    ],
  },
};

/** Backlog tasks originated by a thread (reverse of the origin map). */
export function tasksForThread(threadId: string): string[] {
  return Object.keys(DEMO_ORIGIN_THREAD_BY_BACKLOG).filter(
    (backlogId) => DEMO_ORIGIN_THREAD_BY_BACKLOG[backlogId] === threadId
  );
}

/** Lead-thread id prefix for runs spawned by approving a task. */
export function spawnThreadPrefix(backlogId: string): string {
  return `thr_spawn_${backlogId}_`;
}

/** Extract the backlog id from a spawned lead-thread id, if any. */
export function backlogIdFromSpawnThread(threadId: string): string | null {
  const match = threadId.match(/^thr_spawn_(.+?)_\d+$/);
  return match ? match[1] : null;
}

/** Flatten a spawn tree depth-first with depth levels for rendering. */
export function flattenSpawnTree(
  root: DemoSpawnNode
): { node: DemoSpawnNode; depth: number }[] {
  const out: { node: DemoSpawnNode; depth: number }[] = [];
  const walk = (node: DemoSpawnNode, depth: number) => {
    out.push({ node, depth });
    for (const child of node.children || []) walk(child, depth + 1);
  };
  walk(root, 0);
  return out;
}
