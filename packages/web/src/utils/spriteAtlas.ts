/**
 * Sprite atlas loader for the @designer-generated sheets.
 *
 * Each sheet is a PNG with magenta (#FF00FF) background. Frames are sampled
 * per the bounds below, chroma-keyed to transparent, and cached as canvases
 * so the render loop blits without per-frame keying cost.
 */

export interface FrameBounds {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface StripDef {
  src: string;
  frames: FrameBounds[];
}

export const SPRITE_STRIPS: Record<'knight' | 'coin' | 'slime', StripDef> = {
  knight: {
    src: '/sprites/player-run.png',
    frames: [
      { x0: 0.008, x1: 0.225, y0: 0.48, y1: 0.87 },
      { x0: 0.26, x1: 0.478, y0: 0.48, y1: 0.87 },
      { x0: 0.515, x1: 0.728, y0: 0.48, y1: 0.87 },
      { x0: 0.765, x1: 0.978, y0: 0.48, y1: 0.87 },
    ],
  },
  coin: {
    src: '/sprites/coin-spin.png',
    frames: [
      { x0: 0.005, x1: 0.225, y0: 0.145, y1: 0.43 },
      { x0: 0.255, x1: 0.48, y0: 0.145, y1: 0.43 },
      { x0: 0.505, x1: 0.73, y0: 0.145, y1: 0.43 },
      { x0: 0.755, x1: 0.98, y0: 0.145, y1: 0.43 },
    ],
  },
  slime: {
    src: '/sprites/slime-hop.png',
    frames: [
      { x0: 0.0, x1: 0.27, y0: 0.0, y1: 1.0 },
      { x0: 0.295, x1: 0.505, y0: 0.0, y1: 1.0 },
      { x0: 0.545, x1: 0.725, y0: 0.0, y1: 1.0 },
      { x0: 0.775, x1: 1.0, y0: 0.0, y1: 1.0 },
    ],
  },
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`sprite load failed: ${src}`));
    img.src = src;
  });
}

/** Magenta (with tolerance for soft pixel edges) becomes transparent. */
function chromaKeyFrame(
  img: HTMLImageElement,
  b: FrameBounds
): HTMLCanvasElement {
  const sx = Math.floor(b.x0 * img.naturalWidth);
  const sy = Math.floor(b.y0 * img.naturalHeight);
  const sw = Math.max(1, Math.floor((b.x1 - b.x0) * img.naturalWidth));
  const sh = Math.max(1, Math.floor((b.y1 - b.y0) * img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const bl = px[i + 2];
    if (r > 170 && g < 130 && bl > 170) px[i + 3] = 0;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

export type SpriteAtlas = Record<'knight' | 'coin' | 'slime', HTMLCanvasElement[]>;

export async function loadSpriteAtlas(): Promise<SpriteAtlas> {
  const entries = Object.entries(SPRITE_STRIPS) as [
    keyof SpriteAtlas,
    StripDef,
  ][];
  const atlas = {} as SpriteAtlas;
  for (const [key, def] of entries) {
    const img = await loadImage(def.src);
    atlas[key] = def.frames.map((b) => chromaKeyFrame(img, b));
  }
  return atlas;
}
