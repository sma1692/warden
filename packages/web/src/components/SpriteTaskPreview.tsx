import React, { useState } from 'react';
import { ChevronDown, Palette } from 'lucide-react';
import { SpriteAtlasPreview } from './SpriteAtlasPreview';

const SHEETS = [
  { src: '/sprites/player-run.png', label: 'player-run.png — knight, 4f' },
  { src: '/sprites/coin-spin.png', label: 'coin-spin.png — pickup, 4f' },
  { src: '/sprites/slime-hop.png', label: 'slime-hop.png — enemy, 4f' },
];

/**
 * Expandable art proof for the @designer sprite task: atlas sheets plus the
 * live canvas render loop wired by @frontend_dev.
 */
export const SpriteTaskPreview: React.FC = () => {
  const [open, setOpen] = useState<boolean>(false);

  return (
    <div className="rounded-xl border border-[#C6A664]/30 bg-[#101216] p-2.5 space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 text-left cursor-pointer"
      >
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#D4B475]">
          <Palette className="h-3.5 w-3.5" />
          Generated art + live render — tap to {open ? 'hide' : 'replay'}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-[#D4B475] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="space-y-2">
          <SpriteAtlasPreview />
          <div className="grid grid-cols-3 gap-1.5">
            {SHEETS.map((s) => (
              <figure key={s.src} className="min-w-0">
                <img
                  src={s.src}
                  alt={s.label}
                  loading="lazy"
                  className="w-full rounded-lg border border-[#22262E]"
                  style={{ imageRendering: 'pixelated' }}
                />
                <figcaption className="mt-0.5 truncate text-[9px] font-mono text-slate-500">
                  {s.label}
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="text-[10px] text-slate-500">
            Atlas sheets by @designer • chroma-key + render loop wired by @frontend_dev
            (utils/spriteAtlas.ts).
          </p>
        </div>
      )}
    </div>
  );
};

export default SpriteTaskPreview;
