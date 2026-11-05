import React, { useState } from 'react';
import { ChevronDown, Sparkles, Trophy } from 'lucide-react';
import { SpriteAtlasPreview } from './SpriteAtlasPreview';

interface DungeonRelicTier {
  id: 'bronze' | 'silver' | 'gold' | 'mythic';
  label: string;
  subtitle: string;
  spoilsReq: string;
  color: string;
  glow: string;
}

const TIERS: DungeonRelicTier[] = [
  {
    id: 'bronze',
    label: 'Iron Buckler',
    subtitle: 'Crypt Guard Relic',
    spoilsReq: '0 Spoils',
    color: '#CD7F32',
    glow: 'rgba(205, 127, 50, 0.35)',
  },
  {
    id: 'silver',
    label: 'Runeblade',
    subtitle: 'Knight Dual-Swords',
    spoilsReq: '300 Spoils',
    color: '#CBD5E1',
    glow: 'rgba(203, 213, 225, 0.35)',
  },
  {
    id: 'gold',
    label: 'Crypt Chalice',
    subtitle: 'Ruby Vault Goblet',
    spoilsReq: '1,000 Spoils',
    color: '#F59E0B',
    glow: 'rgba(245, 158, 11, 0.45)',
  },
  {
    id: 'mythic',
    label: 'Dragon Crown',
    subtitle: 'Mythic Boss Relic',
    spoilsReq: '2,000 Spoils',
    color: '#38BDF8',
    glow: 'rgba(56, 189, 248, 0.5)',
  },
];

const FRAMES: Array<'idle' | 'glow' | 'unlock'> = ['idle', 'glow', 'unlock'];
const FRAME_LABELS: Record<'idle' | 'glow' | 'unlock', string> = {
  idle: 'vault-idle',
  glow: 'rune-glow',
  unlock: 'relic-claim',
};

const DUNGEON_SPRITE_SHEETS = [
  { src: '/sprites/player-run.png', label: 'knight-run.png (4f)' },
  { src: '/sprites/coin-spin.png', label: 'relic-coin.png (4f)' },
  { src: '/sprites/slime-hop.png', label: 'crypt-slime.png (4f)' },
];

const DungeonRelicSvg: React.FC<{
  tier: DungeonRelicTier['id'];
  frame: 'idle' | 'glow' | 'unlock';
  size?: number;
}> = ({ tier, frame, size = 34 }) => {
  const isGlow = frame === 'glow' || frame === 'unlock';
  const isUnlock = frame === 'unlock';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={isUnlock ? 'animate-bounce' : isGlow ? 'animate-pulse' : ''}
    >
      {/* Dungeon Stone Arch & Pedestal Backdrop */}
      <rect
        x="4"
        y="4"
        width="40"
        height="40"
        rx="8"
        fill="#111520"
        stroke={
          tier === 'bronze'
            ? '#CD7F32'
            : tier === 'silver'
              ? '#94A3B8'
              : tier === 'gold'
                ? '#F59E0B'
                : '#38BDF8'
        }
        strokeWidth={isUnlock ? '2.5' : '1.5'}
        strokeDasharray={isGlow && !isUnlock ? '4 2' : undefined}
      />
      {/* Dungeon stone altar base */}
      <path d="M10 40H38L35 36H13L10 40Z" fill="#1E293B" stroke="#475569" strokeWidth="1" />
      {isUnlock && (
        <path
          d="M24 2L25.5 7M8 8L12 12M40 8L36 12M6 24H10M42 24H38"
          stroke="#FDE047"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}

      {tier === 'bronze' && (
        <g>
          {/* Cartoon Dungeon Iron-Bound Crypt Buckler Shield */}
          <path
            d="M24 8L36 13V22.5C36 30.5 30.8 35.2 24 37.5C17.2 35.2 12 30.5 12 22.5V13L24 8Z"
            fill="#9A5822"
            stroke="#FDBA74"
            strokeWidth="2"
          />
          <path
            d="M24 11L33 15V22C33 28 29 32 24 34C19 32 15 28 15 22V15L24 11Z"
            fill="#CD7F32"
          />
          <circle cx="24" cy="22" r="4.5" fill="#FDE68A" stroke="#78350F" strokeWidth="1.5" />
          <circle cx="17.5" cy="16.5" r="1.3" fill="#FDE68A" />
          <circle cx="30.5" cy="16.5" r="1.3" fill="#FDE68A" />
          <circle cx="17.5" cy="27.5" r="1.3" fill="#FDE68A" />
          <circle cx="30.5" cy="27.5" r="1.3" fill="#FDE68A" />
        </g>
      )}

      {tier === 'silver' && (
        <g>
          {/* Cartoon Dungeon Crossed Silver Runeblades & Knight Crest */}
          <path
            d="M12 34L35 11M35 11H29M35 11V17"
            stroke="#E2E8F0"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M36 34L13 11M13 11H19M13 11V17"
            stroke="#94A3B8"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M24 12L31 16V24C31 29 28 32.5 24 34C20 32.5 17 29 17 24V16L24 12Z"
            fill="#334155"
            stroke="#F8FAFC"
            strokeWidth="2"
          />
          <path d="M24 16L27 22L24 28L21 22L24 16Z" fill="#38BDF8" />
        </g>
      )}

      {tier === 'gold' && (
        <g>
          {/* Cartoon Dungeon Golden Crypt Chalice with Ruby Bloodstone */}
          <path
            d="M15 10H33V18C33 23.5 29 27 24 27C19 27 15 23.5 15 18V10Z"
            fill="#F59E0B"
            stroke="#FEF08A"
            strokeWidth="2"
          />
          <path
            d="M15 12H11C11 17 13 20 16 20M33 12H37C37 17 35 20 32 20"
            stroke="#FBBF24"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path d="M24 27V34M17 35H31" stroke="#FBBF24" strokeWidth="3" strokeLinecap="round" />
          <polygon points="24,14 28,18 24,22 20,18" fill="#EF4444" stroke="#FCA5A5" strokeWidth="1" />
        </g>
      )}

      {tier === 'mythic' && (
        <g>
          {/* Cartoon Dungeon Mythic Horned Dragon Relic Crown */}
          <path
            d="M10 16L15 8L20 17L24 9L28 17L33 8L38 16L35 31H13L10 16Z"
            fill="#0284C7"
            stroke="#7DD3FC"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <polygon points="24,16 28,22 24,28 20,22" fill="#F43F5E" stroke="#FDA4AF" strokeWidth="1.2" />
          <circle cx="16" cy="23" r="2" fill="#FDE047" />
          <circle cx="32" cy="23" r="2" fill="#FDE047" />
          <path d="M13 34H35" stroke="#38BDF8" strokeWidth="3" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
};

/**
 * Versioned output proof for the Dungeon Relic Vault task (our game's in-game
 * trophy progression system): live animated dungeon crypt canvas, 12-sprite
 * dungeon relic sheet, and 4-tier Relic Spoils progression ladder.
 */
export const TrophyAssetPreview: React.FC<{ generated?: boolean }> = ({
  generated = false,
}) => {
  const [open, setOpen] = useState<boolean>(generated);

  if (!generated) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--surface-border-strong)] bg-[var(--surface-muted)] p-2.5 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--surface-accent-gold)]" />
        <span>
          Queued — approve to generate v1 of the <strong>Dungeon Relic Vault</strong> (our in-game trophy system: 12 cartoon-dungeon relic &amp; knight sprites + 4 unlock animations).
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#C6A664]/30 bg-[#101216] p-2.5 space-y-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 text-left cursor-pointer"
      >
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#D4B475]">
          <Trophy className="h-3.5 w-3.5" />
          <span>Generated v1 — Dungeon Relic Vault (In-Game Trophy System): 12 Sprites + 4 Animations</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 text-[#D4B475] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="space-y-2.5">
          {/* Live animated dungeon crypt & relic altar canvas */}
          <SpriteAtlasPreview />

          <div className="rounded-lg border border-[#22262E] bg-[#0B0D11] p-2">
            <div className="text-[9px] font-mono uppercase tracking-wider text-[#D4B475] mb-1.5">
              Dungeon Relic Vault Progression (In-Game Trophy Ladder • +30 Relic Spoils / Win)
            </div>
            <div className="flex items-center justify-between gap-1">
              {TIERS.map((tier, idx) => (
                <React.Fragment key={tier.id}>
                  <div className="flex flex-col items-center gap-0.5 flex-1">
                    <DungeonRelicSvg tier={tier.id} frame="unlock" size={34} />
                    <span className="text-[8px] font-mono text-slate-200 font-semibold text-center">
                      {tier.label}
                    </span>
                    <span className="text-[7px] font-mono text-amber-400/80">
                      {tier.spoilsReq}
                    </span>
                  </div>
                  {idx < TIERS.length - 1 && (
                    <span className="text-[#C6A664] text-xs font-bold">→</span>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {TIERS.flatMap((tier) =>
              FRAMES.map((frame) => (
                <div
                  key={`${tier.id}-${frame}`}
                  className="rounded-lg border border-[#22262E] bg-[#0B0D11] p-1.5 flex flex-col items-center gap-1"
                  style={{
                    boxShadow: frame === 'unlock' ? `0 0 12px ${tier.glow}` : undefined,
                  }}
                >
                  <DungeonRelicSvg tier={tier.id} frame={frame} size={32} />
                  <span className="text-[8px] font-mono text-slate-400 text-center leading-tight">
                    {tier.label} • {FRAME_LABELS[frame]}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {DUNGEON_SPRITE_SHEETS.map((s) => (
              <figure
                key={s.src}
                className="min-w-0 rounded-lg border border-[#22262E] bg-[#0B0D11] p-1"
              >
                <img
                  src={s.src}
                  alt={s.label}
                  loading="lazy"
                  className="w-full rounded border border-[#1B1F27]"
                  style={{ imageRendering: 'pixelated' }}
                />
                <figcaption className="mt-1 truncate text-[8px] font-mono text-slate-400 text-center">
                  {s.label}
                </figcaption>
              </figure>
            ))}
          </div>

          <p className="text-[10px] text-slate-400">
            Dungeon Relic Vault (our game&apos;s trophy system) sprite atlas by @designer • chroma-key + live crypt loop wired by @frontend_dev.
          </p>
        </div>
      )}
    </div>
  );
};

export default TrophyAssetPreview;
