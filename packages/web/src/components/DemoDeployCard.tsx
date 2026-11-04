import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Gamepad2, Sparkles } from 'lucide-react';
import { apiClient, type DemoWorkspaceState } from '../api/client';

/**
 * Demo game release banner. Sits on the Home tab for demo-mode users:
 * shows "Just deployed! Latest release — check it out!" and a button that opens
 * the newly deployed game on their unique Cloudflare subdomain (or local build fallback).
 */
export const DemoDeployCard: React.FC<{ onError?: (message: string) => void }> = () => {
  const [state, setState] = useState<DemoWorkspaceState | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const remote = await apiClient.getDemoWorkspace().catch(() => null);
    setState(remote);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loaded && state && state.workspace.mode === 'full') return null;

  const ws = state?.workspace;
  const projectName = state?.deploy.project_name || 'demo-project';
  const gameUrl = ws?.deploy_url || '/demo-game/index.html';

  return (
    <div className="w-full rounded-2xl border border-[#C6A664]/45 bg-gradient-to-r from-[#162030] via-[#14161A] to-[#14161A] px-4 py-3 shadow-lg shadow-black/25">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#C6A664]/15 border border-[#C6A664]/40">
            <Gamepad2 className="h-4 w-4 text-[#D4B475]" />
          </span>
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-[#D4B475]">
              <Sparkles className="h-3 w-3" />
              <span>Just Deployed! • {projectName}</span>
            </span>
            <p className="truncate text-sm font-bold text-white">
              Just deployed! Latest release — check it out!
            </p>
          </div>
        </div>

        <a
          href={gameUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] px-4 py-2 text-xs font-bold text-[#0B121C] hover:brightness-110 transition cursor-pointer shadow-sm"
        >
          <span>Check Out Release</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
};
