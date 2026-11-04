import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { apiClient, type DemoWorkspaceState } from '../api/client';

export interface DemoDeployMeta {
  version: string;
  versionNumber: number;
  updatedAt: string;
  formattedTimestamp: string;
  subdomain: string;
  url: string;
}

const STORAGE_KEY = 'warden_demo_deploy_info';
const CHANNEL_NAME = 'warden_demo_deploy_channel';

export function getDemoSubdomain(projectName?: string, deployUrl?: string | null): string {
  if (deployUrl) {
    try {
      const parsed = new URL(deployUrl.startsWith('http') ? deployUrl : `https://${deployUrl}`);
      if (parsed.hostname) {
        const host = parsed.hostname.toLowerCase();
        // If already ending with .warden.autos, preserve the full subdomain without stripping or truncating hostnames
        if (host.endsWith('.warden.autos')) {
          const sub = host.slice(0, -'.warden.autos'.length);
          if (sub) {
            return sub.replace(/[^a-zA-Z0-9-.]/g, '-').replace(/^-+|-+$/g, '') || 'demo-arena';
          }
        }
        // If it's a .pages.dev preview URL (e.g. hash.projectName.pages.dev), normalize and extract canonical projectName
        if (host.endsWith('.pages.dev')) {
          let clean = host.slice(0, -'.pages.dev'.length);
          if (clean.includes('.')) {
            const parts = clean.split('.').filter(Boolean);
            clean = parts[parts.length - 1];
          }
          return clean.replace(/[^a-zA-Z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'demo-arena';
        }
        // Generic hostname fallback: preserve full host structure
        const clean = host.replace(/[^a-zA-Z0-9-.]/g, '-').replace(/^-+|-+$/g, '');
        return clean || 'demo-arena';
      }
    } catch {
      // Fall through to project name
    }
  }
  if (projectName) {
    let clean = projectName.trim().toLowerCase();
    if (clean.endsWith('.warden.autos')) {
      clean = clean.slice(0, -'.warden.autos'.length);
    } else if (clean.endsWith('.pages.dev')) {
      clean = clean.slice(0, -'.pages.dev'.length);
      if (clean.includes('.')) {
        const parts = clean.split('.').filter(Boolean);
        clean = parts[parts.length - 1];
      }
    }
    return clean.replace(/[^a-zA-Z0-9-.]/g, '-').replace(/^-+|-+$/g, '') || 'demo-arena';
  }
  return 'demo-arena';
}

export function formatSubdomainUrl(subdomain: string): string {
  if (!subdomain || !subdomain.trim()) {
    return 'https://demo-arena.warden.autos';
  }
  const trimmed = subdomain.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname.toLowerCase();
      // If already ending with .warden.autos, preserve exact hostname without stripping or truncating
      if (host.endsWith('.warden.autos')) {
        return `https://${host}`;
      }
      if (host.endsWith('.pages.dev')) {
        let clean = host.slice(0, -'.pages.dev'.length);
        if (clean.includes('.')) {
          const parts = clean.split('.').filter(Boolean);
          clean = parts[parts.length - 1];
        }
        const cleanSub = clean.replace(/[^a-zA-Z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'demo-arena';
        return `https://${cleanSub}.warden.autos`;
      }
      const cleanHost = host.replace(/[^a-zA-Z0-9-.]/g, '-').replace(/^-+|-+$/g, '') || 'demo-arena';
      return `https://${cleanHost}.warden.autos`;
    } catch {
      // Fall through
    }
  }
  if (trimmed.toLowerCase().endsWith('.warden.autos')) {
    const cleanHost = trimmed.replace(/^\/+|\/+$/g, '').toLowerCase();
    return `https://${cleanHost}`;
  }
  let clean = trimmed.toLowerCase();
  if (clean.endsWith('.pages.dev')) {
    clean = clean.slice(0, -'.pages.dev'.length);
    if (clean.includes('.')) {
      const parts = clean.split('.').filter(Boolean);
      clean = parts[parts.length - 1];
    }
  }
  clean = clean.replace(/[^a-zA-Z0-9-.]/g, '-').replace(/^-+|-+$/g, '') || 'demo-arena';
  return `https://${clean}.warden.autos`;
}

export const getDemoProject = getDemoSubdomain;
export const formatPagesDevUrl = formatSubdomainUrl;

export const DemoDashboardView: React.FC<{
  onError?: (message: string) => void;
  className?: string;
}> = ({ onError, className = '' }) => {
  const [state, setState] = useState<DemoWorkspaceState | null>(null);
  const [loading, setLoading] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deployMeta, setDeployMeta] = useState<DemoDeployMeta>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            const sub = getDemoSubdomain(parsed.subdomain, parsed.url);
            const url = formatSubdomainUrl(sub);
            return {
              ...parsed,
              subdomain: sub,
              url,
            };
          }
        }
      } catch {
        // ignore
      }
    }
    const now = new Date();
    return {
      version: 'v1',
      versionNumber: 1,
      updatedAt: now.toISOString(),
      formattedTimestamp: now.toLocaleString(),
      subdomain: 'demo-arena',
      url: 'https://demo-arena.warden.autos',
    };
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const remote = await apiClient.getDemoWorkspace().catch(() => null);
      setState(remote);
      if (remote) {
        const sub = getDemoSubdomain(
          remote.deploy.project_name,
          remote.workspace.deploy_url
        );
        const url = formatSubdomainUrl(sub);
        setDeployMeta((prev) => {
          const next: DemoDeployMeta = {
            ...prev,
            subdomain: sub,
            url,
          };
          if (typeof window !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          }
          return next;
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const subdomain = useMemo(() => {
    return getDemoSubdomain(
      state?.deploy.project_name,
      state?.workspace.deploy_url
    );
  }, [state]);

  const liveUrl = useMemo(() => {
    return formatSubdomainUrl(subdomain);
  }, [subdomain]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(liveUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  }, [liveUrl]);

  const handleDeploy = useCallback(async () => {
    setDeploying(true);
    try {
      const res = await apiClient.deployDemo().catch((err) => {
        onError?.(err instanceof Error ? err.message : String(err));
        return null;
      });

      const nextNum = (deployMeta.versionNumber || 1) + 1;
      const nextVer = `v${nextNum}`;
      const now = new Date();
      const updatedMeta: DemoDeployMeta = {
        version: nextVer,
        versionNumber: nextNum,
        updatedAt: now.toISOString(),
        formattedTimestamp: now.toLocaleString(),
        subdomain,
        url: liveUrl,
      };

      setDeployMeta(updatedMeta);

      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedMeta));
          window.dispatchEvent(
            new CustomEvent('warden:demo-deployed', { detail: updatedMeta })
          );
          if ('BroadcastChannel' in window) {
            const bc = new BroadcastChannel(CHANNEL_NAME);
            bc.postMessage(updatedMeta);
            bc.close();
          }
        } catch {
          // ignore
        }
      }

      await refresh();
    } finally {
      setDeploying(false);
    }
  }, [deployMeta, liveUrl, onError, refresh, subdomain]);

  const deployStatus = state?.workspace.deploy_status || 'ACTIVE';

  return (
    <div
      className={`w-full rounded-2xl border border-[#C6A664]/45 bg-gradient-to-r from-[#162030] via-[#14161A] to-[#14161A] p-4 shadow-xl shadow-black/30 ${className}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#C6A664]/15 border border-[#C6A664]/40 text-[#D4B475]">
            <Globe className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-[#D4B475]">
                <Sparkles className="h-3 w-3" />
                <span>Live Demo Deployment</span>
              </span>
              <span className="inline-flex items-center rounded-full bg-[#22C55E]/15 border border-[#22C55E]/40 px-2 py-0.5 text-[10px] font-mono font-bold text-[#22C55E]">
                {deployStatus}
              </span>
              <span className="inline-flex items-center rounded-full bg-[#C6A664]/15 border border-[#C6A664]/40 px-2 py-0.5 text-[10px] font-mono font-bold text-[#D4B475]">
                {deployMeta.version}
              </span>
            </div>

            {/* Prominently display the https://<subdomain>.warden.autos URL */}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-400 font-mono">Demo URL:</span>
              <a
                href={liveUrl}
                target="_blank"
                rel="noreferrer"
                data-testid="demo-subdomain-url"
                className="group inline-flex items-center gap-1.5 font-mono text-sm sm:text-base font-bold text-[#D4B475] hover:text-white transition underline decoration-[#C6A664]/50 hover:decoration-[#D4B475]"
              >
                <span>{liveUrl}</span>
                <ExternalLink className="h-3.5 w-3.5 opacity-70 group-hover:opacity-100 transition" />
              </a>
            </div>

            <p className="mt-0.5 text-xs text-slate-400">
              Live automated preview deployment. Last updated: {deployMeta.formattedTimestamp}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 pt-1 sm:pt-0">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 hover:text-white transition cursor-pointer"
            title="Copy URL"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-[#22C55E]" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? 'Copied' : 'Copy URL'}</span>
          </button>

          <button
            type="button"
            onClick={handleDeploy}
            disabled={deploying}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] px-3.5 py-2 text-xs font-bold text-[#0B121C] hover:brightness-110 disabled:opacity-50 transition cursor-pointer shadow-sm"
          >
            <Rocket className={`h-3.5 w-3.5 ${deploying ? 'animate-spin' : ''}`} />
            <span>{deploying ? 'Deploying…' : 'Deploy Version'}</span>
          </button>

          <a
            href={liveUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#C6A664]/50 bg-[#C6A664]/10 px-3.5 py-2 text-xs font-bold text-[#D4B475] hover:bg-[#C6A664]/20 transition cursor-pointer"
          >
            <span>Open Demo</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
};

export default DemoDashboardView;
