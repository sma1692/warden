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
      ctx.fillStyle = '#0B121C';
      ctx.fillRect(0, 0, W, H);
      // Ground strip + line.
      ctx.fillStyle = '#111A28';
      ctx.fillRect(0, GROUND_Y + 1, W, H - GROUND_Y - 1);
      ctx.fillStyle = '#C6A664';
      ctx.fillRect(0, GROUND_Y, W, 2);

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
      blit(knight, 84, GROUND_Y, 104);
      // Coin pickup spin, floating mid (sine bob).
      blit(coin, 240, GROUND_Y - 78, 44, Math.sin(t / 450) * 6);
      // Slime hop, right (frame-synced lift).
      const hopPhase = Math.floor(t / 260) % 4;
      blit(slime, 396, GROUND_Y, 64, hopPhase === 2 ? -16 : hopPhase === 1 || hopPhase === 3 ? -6 : 0);
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
