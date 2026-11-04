import React, { useState } from 'react';
import { ChevronDown, Crown, Gem, Medal, Sparkles, Trophy } from 'lucide-react';

const TIERS = [
  { icon: Medal, label: 'Bronze', color: '#CD7F32' },
  { icon: Trophy, label: 'Silver', color: '#9AA5B1' },
  { icon: Crown, label: 'Gold', color: '#E8B33D' },
  { icon: Gem, label: 'Mythic', color: '#7DD3FC' },
];

const FRAMES = ['idle', 'glow', 'unlock'];

const UNLOCK_SEQUENCE = [
  { icon: Medal, label: 'F1 Bronze', color: '#CD7F32' },
  { icon: Trophy, label: 'F2 Silver', color: '#9AA5B1' },
  { icon: Crown, label: 'F3 Gold', color: '#E8B33D' },
  { icon: Gem, label: 'F4 Mythic', color: '#7DD3FC' },
];

/**
 * Versioned output proof for the trophy art task: the 12-sprite ladder set
 * plus the 4-frame unlock animation. Before the team runs, it shows the
 * queued placeholder instead of a version.
 */
export const TrophyAssetPreview: React.FC<{ generated?: boolean }> = ({
  generated = false,
}) => {
  const [open, setOpen] = useState<boolean>(generated);

  if (!generated) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--surface-border-strong)] bg-[var(--surface-muted)] p-2.5 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--surface-accent-gold)]" />
        <span>Queued — approve to generate v1 (12 sprites + 4 unlock frames).</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#C6A664]/30 bg-[#101216] p-2.5 space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 text-left cursor-pointer"
      >
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#D4B475]">
          <Trophy className="h-3.5 w-3.5" />
          <span>Generated v1 — 12 sprites + unlock animation</span>
        </span>
        <ChevronDown
          className={`h-4 w-4 text-[#D4B475] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-1.5">
            {TIERS.flatMap((tier) =>
              FRAMES.map((frame) => {
                const Icon = tier.icon;
                return (
                  <div
                    key={`${tier.label}-${frame}`}
                    className="rounded-lg border border-[#22262E] bg-[#0B0D11] p-1.5 flex flex-col items-center gap-1"
                  >
                    <Icon className="h-5 w-5" style={{ color: tier.color }} />
                    <span className="text-[8px] font-mono text-slate-500">
                      {tier.label} {frame}
                    </span>
                  </div>
                );
              })
            )}
          </div>
          <div className="rounded-lg border border-[#22262E] bg-[#0B0D11] p-2">
            <div className="text-[9px] font-mono uppercase tracking-wider text-slate-500 mb-1.5">
              Unlock sequence
            </div>
            <div className="flex items-center justify-between gap-1">
              {UNLOCK_SEQUENCE.map((step, idx) => {
                const Icon = step.icon;
                return (
                  <React.Fragment key={step.label}>
                    <div className="flex flex-col items-center gap-1 flex-1">
                      <Icon className="h-6 w-6" style={{ color: step.color }} />
                      <span className="text-[8px] font-mono text-slate-400">{step.label}</span>
                    </div>
                    {idx < UNLOCK_SEQUENCE.length - 1 && (
                      <span className="text-slate-600 text-xs">→</span>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
          <p className="text-[10px] text-slate-500">
            v1 by @designer • atlas packed + animation wired by @frontend_dev.
          </p>
        </div>
      )}
    </div>
  );
};

export default TrophyAssetPreview;
