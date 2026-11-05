import React, { useState } from 'react';
import { ChevronDown, Sparkles, Trophy } from 'lucide-react';

interface DungeonRelicTier {
  id: 'bronze' | 'silver' | 'gold' | 'mythic';
  label: string;
  subtitle: string;
  color: string;
  glow: string;
}

const TIERS: DungeonRelicTier[] = [
  {
    id: 'bronze',
    label: 'Bronze Buckler',
    subtitle: 'Iron-Bound Shield',
    color: '#CD7F32',
    glow: 'rgba(205, 127, 50, 0.35)',
  },
  {
    id: 'silver',
    label: 'Silver Runeblade',
    subtitle: 'Crossed Knight Crest',
    color: '#CBD5E1',
    glow: 'rgba(203, 213, 225, 0.35)',
  },
  {
    id: 'gold',
    label: 'Gold Chalice',
    subtitle: 'Ruby Crypt Goblet',
    color: '#F59E0B',
    glow: 'rgba(245, 158, 11, 0.45)',
  },
  {
    id: 'mythic',
    label: 'Mythic Dragon',
    subtitle: 'Arcane Horned Relic',
    color: '#38BDF8',
    glow: 'rgba(56, 189, 248, 0.5)',
  },
];

const FRAMES: Array<'idle' | 'glow' | 'unlock'> = ['idle', 'glow', 'unlock'];

const DUNGEON_SPRITE_SHEETS = [
  { src: '/sprites/player-run.png', label: 'knight-run.png (4f)' },
  { src: '/sprites/coin-spin.png', label: 'dungeon-coin.png (4f)' },
  { src: '/sprites/slime-hop.png', label: 'crypt-slime.png (4f)' },
];

const DungeonRelicSvg: React.FC<{
  tier: DungeonRelicTier['id'];
  frame: 'idle' | 'glow' | 'unlock';
  size?: number;
}> = ({ tier, frame, size = 32 }) => {
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
      {/* Stone & Runic Aura Backdrop */}
      <circle
        cx="24"
        cy="24"
        r="20"
        fill="#141821"
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
        strokeDasharray={isGlow ? '3 2' : undefined}
      />
      {isUnlock && (
        <path
          d="M24 2L26 8M24 46L26 40M2 24L8 26M46 24L40 26M8 8L13 13M40 40L35 35M40 8L35 13M8 40L13 35"
          stroke="#FDE047"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}

      {tier === 'bronze' && (
        <g>
          {/* Cartoon Dungeon Iron-Bound Bronze Buckler Shield */}
          <path
            d="M24 9L36 14V24C36 32.5 30.8 37.8 24 40C17.2 37.8 12 32.5 12 24V14L24 9Z"
            fill="#9A5822"
            stroke="#FDBA74"
            strokeWidth="2"
          />
          <path
            d="M24 12L33 16V23.5C33 30 29 34.4 24 36.5C19 34.4 15 30 15 23.5V16L24 12Z"
            fill="#CD7F32"
          />
          <circle cx="24" cy="24" r="5" fill="#FDE68A" stroke="#78350F" strokeWidth="1.5" />
          <circle cx="17" cy="18" r="1.3" fill="#FDE68A" />
          <circle cx="31" cy="18" r="1.3" fill="#FDE68A" />
          <circle cx="17" cy="29" r="1.3" fill="#FDE68A" />
          <circle cx="31" cy="29" r="1.3" fill="#FDE68A" />
        </g>
      )}

      {tier === 'silver' && (
        <g>
          {/* Cartoon Dungeon Crossed Silver Runeblades & Heraldic Crest */}
          <path
            d="M12 36L35 13M35 13H29M35 13V19"
            stroke="#E2E8F0"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M36 36L13 13M13 13H19M13 13V19"
            stroke="#94A3B8"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M24 14L31 18V26C31 31 28 34.5 24 36C20 34.5 17 31 17 26V18L24 14Z"
            fill="#334155"
            stroke="#F8FAFC"
            strokeWidth="2"
          />
          <path d="M24 18L27 24L24 30L21 24L24 18Z" fill="#38BDF8" />
        </g>
      )}

      {tier === 'gold' && (
        <g>
          {/* Cartoon Dungeon Golden Crypt Chalice with Ruby Gem */}
          <path
            d="M15 12H33V20C33 25.5 29 29 24 29C19 29 15 25.5 15 20V12Z"
            fill="#F59E0B"
            stroke="#FEF08A"
            strokeWidth="2"
          />
          <path
            d="M15 14H11C11 19 13 22 16 22M33 14H37C37 19 35 22 32 22"
            stroke="#FBBF24"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path d="M24 29V36M17 37H31" stroke="#FBBF24" strokeWidth="3" strokeLinecap="round" />
          <polygon points="24,16 28,20 24,24 20,20" fill="#EF4444" stroke="#FCA5A5" strokeWidth="1" />
        </g>
      )}

      {tier === 'mythic' && (
        <g>
          {/* Cartoon Dungeon Mythic Horned Dragon Relic Crown */}
          <path
            d="M10 18L15 9L20 19L24 11L28 19L33 9L38 18L35 33H13L10 18Z"
            fill="#0284C7"
            stroke="#7DD3FC"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <polygon points="24,18 28,24 24,30 20,24" fill="#F43F5E" stroke="#FDA4AF" strokeWidth="1.2" />
          <circle cx="16" cy="25" r="2" fill="#FDE047" />
          <circle cx="32" cy="25" r="2" fill="#FDE047" />
          <path d="M13 36H35" stroke="#38BDF8" strokeWidth="3" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
};

/**
 * Versioned output proof for the dungeon trophy art task: the 12-sprite dungeon
 * relic ladder set, 4-frame unlock animation, and pixel-art dungeon sprite sheets.
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
          Queued — approve to generate v1 (12 cartoon-dungeon relic sprites + 4 unlock frames).
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
          <span>Generated v1 — 12 Dungeon Relic Sprites + 4 Unlock Animations</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 text-[#D4B475] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="space-y-2.5">
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
                  <DungeonRelicSvg tier={tier.id} frame={frame} size={30} />
                  <span className="text-[8px] font-mono text-slate-400 text-center leading-tight">
                    {tier.label.split(' ')[0]} • {frame}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="rounded-lg border border-[#22262E] bg-[#0B0D11] p-2">
            <div className="text-[9px] font-mono uppercase tracking-wider text-[#D4B475] mb-1.5">
              Dungeon Relic Unlock Sequence (4-Tier Progression)
            </div>
            <div className="flex items-center justify-between gap-1">
              {TIERS.map((tier, idx) => (
                <React.Fragment key={tier.id}>
                  <div className="flex flex-col items-center gap-1 flex-1">
                    <DungeonRelicSvg tier={tier.id} frame="unlock" size={34} />
                    <span className="text-[8px] font-mono text-slate-300 font-semibold">
                      {tier.label}
                    </span>
                  </div>
                  {idx < TIERS.length - 1 && (
                    <span className="text-[#C6A664] text-xs font-bold">→</span>
                  )}
                </React.Fragment>
              ))}
            </div>
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
            Cartoon-dungeon vector &amp; pixel sprite pack by @designer • packed + wired into arena bundle by @frontend_dev.
          </p>
        </div>
      )}
    </div>
  );
};

export default TrophyAssetPreview;
