import React, { useEffect, useRef, useState } from 'react';
import { loadSpriteAtlas, type SpriteAtlas } from '../utils/spriteAtlas';

const W = 480;
const H = 240;
const GROUND_Y = 200;

/**
 * Live render loop for the @designer sprite pack: knight run cycle, spinning
 * coin pickup, and hopping slime, all bottom-anchored on a ground line.
 * Honors prefers-reduced-motion with a static first frame.
 */
export const SpriteAtlasPreview: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState<boolean>(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    let atlas: SpriteAtlas | null = null;
    let raf = 0;
    let cancelled = false;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const draw = (t: number) => {
      if (!atlas) return;
      ctx.clearRect(0, 0, W, H);
      // Dungeon crypt stone backdrop
      ctx.fillStyle = '#0B0E17';
      ctx.fillRect(0, 0, W, H);

      // Subtle stone brick rows in the crypt background
      ctx.strokeStyle = '#171C2B';
      ctx.lineWidth = 2;
      for (let row = 0; row < 5; row++) {
        const y = 24 + row * 34;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        const offset = (row % 2) * 32;
        for (let col = offset; col < W; col += 64) {
          ctx.beginPath();
          ctx.moveTo(col, y - 34);
          ctx.lineTo(col, y);
          ctx.stroke();
        }
      }

      // Flickering wall torches (left & right pillars)
      const flicker = Math.sin(t / 110) * 2;
      for (const tx of [36, 444]) {
        // Torch glow aura
        const grad = ctx.createRadialGradient(tx, 68, 2, tx, 68, 34 + flicker);
        grad.addColorStop(0, 'rgba(251, 191, 36, 0.38)');
        grad.addColorStop(1, 'rgba(251, 191, 36, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(tx - 38, 30, 76, 76);
        // Torch bracket & flame
        ctx.fillStyle = '#78350F';
        ctx.fillRect(tx - 3, 72, 6, 18);
        ctx.fillStyle = '#F59E0B';
        ctx.fillRect(tx - 5, 60 + Math.round(flicker * 0.4), 10, 12);
        ctx.fillStyle = '#FEF08A';
        ctx.fillRect(tx - 3, 63 + Math.round(flicker * 0.4), 6, 7);
      }

      // Center Dungeon Relic Pedestal (In-Game Trophy Altar)
      ctx.fillStyle = '#1E2436';
      ctx.fillRect(212, GROUND_Y - 26, 56, 26);
      ctx.fillStyle = '#C6A664';
      ctx.fillRect(206, GROUND_Y - 30, 68, 4);
      ctx.fillRect(202, GROUND_Y - 4, 76, 4);

      // Dungeon floor slabs + gold rune trim
      ctx.fillStyle = '#131826';
      ctx.fillRect(0, GROUND_Y + 1, W, H - GROUND_Y - 1);
      ctx.fillStyle = '#C6A664';
      ctx.fillRect(0, GROUND_Y, W, 2);

      // Top HUD label inside canvas
      ctx.fillStyle = '#D4B475';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('DUNGEON RELIC VAULT (TROPHY ALTAR) • LIVE SPRITE ATLAS', 14, 16);

      const knight = atlas.knight[(Math.floor(t / 125) % 4 + 4) % 4];
      const coin = atlas.coin[(Math.floor(t / 170) % 4 + 4) % 4];
      const slime = atlas.slime[(Math.floor(t / 260) % 4 + 4) % 4];

      const blit = (
        frame: HTMLCanvasElement,
        x: number,
        baseY: number,
        targetH: number,
        bobY = 0
      ) => {
        const scale = targetH / frame.height;
        const dw = frame.width * scale;
        ctx.drawImage(frame, x - dw / 2, baseY - targetH + bobY, dw, targetH);
      };

      // Knight run cycle, left.
      blit(knight, 92, GROUND_Y, 104);
      // Relic Coin spin hovering above the Dungeon Relic Altar pedestal, center.
      blit(coin, 240, GROUND_Y - 52, 46, Math.sin(t / 350) * 6);
      // Slime hop, right (frame-synced lift).
      const hopPhase = Math.floor(t / 260) % 4;
      blit(slime, 388, GROUND_Y, 64, hopPhase === 2 ? -16 : hopPhase === 1 || hopPhase === 3 ? -6 : 0);
    };

    void loadSpriteAtlas()
      .then((a) => {
        if (cancelled) return;
        atlas = a;
        if (reduced) {
          draw(0);
          return;
        }
        const loop = (t: number) => {
          draw(t);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  if (failed) {
    return (
      <p className="text-xs text-slate-400">
        Sprite sheets are still generating — open the atlas sheets below.
      </p>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      aria-label="Live sprite render: running knight, spinning coin, hopping slime"
      className="w-full rounded-xl border border-[#22262E]"
      style={{ imageRendering: 'pixelated', aspectRatio: '2 / 1' }}
    />
  );
};

export default SpriteAtlasPreview;
