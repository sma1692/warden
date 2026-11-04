import React, { useCallback, useEffect, useState } from 'react';
import {
  Clock,
  ExternalLink,
  Gamepad2,
  Globe,
  Radio,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { apiClient } from '../api/client';

export interface DemoDeployStateInfo {
  version: string;
  versionNumber: number;
  updatedAt: string;
  formattedTimestamp: string;
  subdomain: string;
  url: string;
}

const STORAGE_KEY = 'warden_demo_deploy_info';
const CHANNEL_NAME = 'warden_demo_deploy_channel';

export const DemoHome: React.FC = () => {
  const [deployInfo, setDeployInfo] = useState<DemoDeployStateInfo>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) return JSON.parse(stored);
      } catch {
        // ignore
      }
    }
    const initialDate = new Date();
    return {
      version: 'v1',
      versionNumber: 1,
      updatedAt: initialDate.toISOString(),
      formattedTimestamp: initialDate.toLocaleString(),
      subdomain: 'demo-arena',
      url: 'https://demo-arena.warden.autos',
    };
  });

  const [recentlyUpdated, setRecentlyUpdated] = useState(false);
  const [deployCount, setDeployCount] = useState(0);

  // Sync with deployment events from Warden dashboard
  useEffect(() => {
    const handleUpdate = (data: Partial<DemoDeployStateInfo>) => {
      setDeployInfo((prev) => {
        const next: DemoDeployStateInfo = {
          version: data.version || prev.version,
          versionNumber: data.versionNumber || prev.versionNumber,
          updatedAt: data.updatedAt || new Date().toISOString(),
          formattedTimestamp: data.formattedTimestamp || new Date().toLocaleString(),
          subdomain: data.subdomain || prev.subdomain,
          url: data.url || prev.url,
        };
        return next;
      });
      setRecentlyUpdated(true);
      setDeployCount((c) => c + 1);
      setTimeout(() => setRecentlyUpdated(false), 4000);
    };

    // 1. BroadcastChannel listener (inter-tab / dashboard sync)
    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel(CHANNEL_NAME);
      bc.onmessage = (event) => {
        if (event.data) {
          handleUpdate(event.data);
        }
      };
    }

    // 2. Storage event listener (across browser tabs)
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue);
          handleUpdate(parsed);
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener('storage', onStorage);

    // 3. In-window custom event listener
    const onCustomEvent = (event: Event) => {
      const customEvt = event as CustomEvent<DemoDeployStateInfo>;
      if (customEvt.detail) {
        handleUpdate(customEvt.detail);
      }
    };
    window.addEventListener('warden:demo-deployed', onCustomEvent);

    // 4. WebSocket subscription via apiClient
    const unsubscribe = apiClient.subscribe((wsEvt) => {
      if (wsEvt.type === 'BACKLOG_UPDATED') {
        const payload = wsEvt.data as any;
        if (payload?.kind === 'demo-deploy') {
          void apiClient.getDemoWorkspace().then((remote) => {
            if (remote) {
              const sub =
                remote.deploy.project_name?.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase() ||
                'demo-arena';
              const nextVer = `v${(deployInfo.versionNumber || 1) + 1}`;
              const now = new Date();
              handleUpdate({
                version: nextVer,
                versionNumber: (deployInfo.versionNumber || 1) + 1,
                updatedAt: now.toISOString(),
                formattedTimestamp: now.toLocaleString(),
                subdomain: sub,
                url: `https://${sub}.warden.autos`,
              });
            }
          });
        }
      }
    });

    return () => {
      if (bc) bc.close();
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('warden:demo-deployed', onCustomEvent);
      unsubscribe();
    };
  }, [deployInfo.versionNumber]);

  return (
    <div className="min-h-screen bg-[#090A0C] text-slate-100 flex flex-col items-center p-4 sm:p-8 font-sans">
      {/* Top Navigation */}
      <header className="w-full max-w-4xl flex items-center justify-between py-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#C6A664]/15 border border-[#C6A664]/40 text-[#D4B475]">
            <Globe className="h-4 w-4" />
          </span>
          <div>
            <h1 className="text-base font-bold text-white tracking-tight">Warden Demo Arena</h1>
            <p className="text-[11px] font-mono text-[#D4B475]">{deployInfo.url}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#22C55E]/15 border border-[#22C55E]/40 px-2.5 py-1 text-xs font-mono font-bold text-[#22C55E]">
            <Radio className="h-3 w-3 animate-pulse" />
            <span>LIVE</span>
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="w-full max-w-4xl mt-6 flex flex-col gap-6">
        {/* Visible Version & Timestamp Update Banner */}
        <section
          data-testid="demo-home-version-banner"
          className={`w-full rounded-2xl border-2 transition-all duration-500 p-5 shadow-2xl ${
            recentlyUpdated
              ? 'border-[#22C55E] bg-gradient-to-r from-[#14532D]/60 via-[#162030] to-[#14161A] shadow-green-900/50 scale-[1.01]'
              : 'border-[#C6A664]/50 bg-gradient-to-r from-[#162030] via-[#14161A] to-[#14161A] shadow-black/40'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#C6A664]/20 text-[#D4B475]">
                <Sparkles className="h-4 w-4" />
              </span>
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#D4B475]">
                Warden Deployment Status
              </span>
            </div>

            <span className="inline-flex items-center gap-1.5 rounded-lg bg-black/40 border border-slate-700 px-2.5 py-1 text-xs font-mono text-slate-300">
              <Clock className="h-3 w-3 text-slate-400" />
              <span>{deployInfo.formattedTimestamp}</span>
            </span>
          </div>

          {/* Visibly updating message with version number and update timestamp */}
          <div className="mt-3">
            <h2
              id="demo-deployed-version-message"
              className="text-xl sm:text-2xl font-black tracking-tight text-white flex flex-wrap items-center gap-2"
            >
              <span>Deployed Version:</span>
              <span className="rounded-lg bg-[#D4B475]/20 border border-[#D4B475]/50 px-2.5 py-0.5 text-[#D4B475] font-mono">
                {deployInfo.version}
              </span>
              <span className="text-slate-400 text-sm font-normal">
                (Updated: {deployInfo.formattedTimestamp})
              </span>
            </h2>

            <p className="mt-2 text-sm text-slate-300 leading-relaxed">
              New release deployed via Warden dashboard. Verified on Cloudflare edge routing at{' '}
              <a
                href={deployInfo.url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[#D4B475] underline hover:text-white transition"
              >
                {deployInfo.url}
              </a>
              .
            </p>
          </div>

          {recentlyUpdated && (
            <div className="mt-3 inline-flex items-center gap-2 text-xs font-mono font-semibold text-[#22C55E] bg-[#22C55E]/10 border border-[#22C55E]/30 rounded-lg px-3 py-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Deployment detected! Version updated to {deployInfo.version}.</span>
            </div>
          )}
        </section>

        {/* Demo Content / Game Arena View */}
        <section className="w-full rounded-2xl border border-slate-800 bg-[#121418] p-6 shadow-xl">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800 border border-slate-700 text-[#D4B475]">
                <Gamepad2 className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-base font-bold text-white">Tic-Tac-Toe Arena Release</h3>
                <p className="text-xs text-slate-400">Deployed single-player & multiplayer web runtime</p>
              </div>
            </div>

            <a
              href="/demo-game/index.html"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#D4B475] px-3.5 py-2 text-xs font-bold text-[#0B121C] hover:brightness-110 transition cursor-pointer"
            >
              <span>Play Arena</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono text-xs">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
              <div className="text-slate-400 uppercase tracking-wider text-[10px]">Active Release</div>
              <div className="text-base font-bold text-[#D4B475] mt-1">{deployInfo.version}</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
              <div className="text-slate-400 uppercase tracking-wider text-[10px]">Deployed At</div>
              <div className="text-sm font-semibold text-slate-200 mt-1 truncate">
                {deployInfo.formattedTimestamp}
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
              <div className="text-slate-400 uppercase tracking-wider text-[10px]">Edge Routing</div>
              <div className="text-sm font-semibold text-[#22C55E] mt-1 truncate">
                {deployInfo.subdomain}.warden.autos
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default DemoHome;
