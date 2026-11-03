import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Gamepad2, Loader2, Rocket } from 'lucide-react';
import { apiClient, type DemoWorkspaceState } from '../api/client';

const STATUS_LABEL: Record<string, string> = {
  NOT_DEPLOYED: 'Not deployed yet',
  NOT_CONFIGURED: 'Waiting on Cloudflare creds',
  BUILDING: 'Building…',
  DEPLOYING: 'Deploying…',
  ACTIVE: 'Live',
  FAILED: 'Deploy failed',
};

/**
 * Demo game deploy card. Sits on the Home tab for demo-mode users: shows the
 * per-user Tic-Tac-Toe Arena folder state, the Cloudflare project name, and a
 * one-click deploy. Renders nothing for full-mode users or before onboarding
 * provisions a demo workspace.
 */
export const DemoDeployCard: React.FC = () => {
  const [state, setState] = useState<DemoWorkspaceState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const remote = await apiClient.getDemoWorkspace().catch(() => null);
    setState(remote);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onDeploy = useCallback(async () => {
    setDeploying(true);
    setError(null);
    try {
      const res = await apiClient.deployDemo();
      if (!res) {
        setError('Deploy request failed. Is the API running?');
      } else if (!res.ok) {
        setError(res.result.error || `Deploy ended as ${res.result.status}.`);
      }
      await refresh();
    } finally {
      setDeploying(false);
    }
  }, [refresh]);

  if (!loaded || !state || state.workspace.mode !== 'demo') return null;
  const ws = state.workspace;
  const live = ws.deploy_status === 'ACTIVE' && ws.deploy_url;

  return (
    <div className="w-full rounded-2xl border border-[#C6A664]/40 bg-gradient-to-r from-[#162030] via-[#14161A] to-[#14161A] px-4 py-3 shadow-lg shadow-black/30">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#C6A664]/15 border border-[#C6A664]/40">
          <Gamepad2 className="h-4 w-4 text-[#D4B475]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-mono uppercase tracking-wider text-[#D4B475]">
            Demo project • Tic-Tac-Toe Arena • {state.deploy.project_name}
          </span>
          <span className="block truncate text-sm font-bold text-white">
            {STATUS_LABEL[ws.deploy_status] || ws.deploy_status}
            {!state.deploy.cloudflare_configured && ws.deploy_status !== 'ACTIVE'
              ? ' — local folder ready'
              : ''}
          </span>
          <span className="block truncate text-xs text-slate-400">
            {live ? (
              <a
                href={ws.deploy_url as string}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[#D4B475] hover:underline"
              >
                {(ws.deploy_url as string).replace(/^https?:\/\//, '')}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              'Your own copy of the game scaffold. Deploy it to your subdomain when ready.'
            )}
          </span>
        </span>
        <button
          type="button"
          onClick={() => void onDeploy()}
          disabled={deploying}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[#C6A664] px-3 py-2 text-xs font-bold text-[#162030] hover:bg-[#D4B475] disabled:opacity-50 transition"
        >
          {deploying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
          {live ? 'Redeploy' : 'Deploy'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
};
