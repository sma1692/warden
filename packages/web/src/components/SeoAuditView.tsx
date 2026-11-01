import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FileCode2,
  FlaskConical,
  GitPullRequest,
  Globe,
  ListPlus,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import type { BacklogStage, PriorityLevel } from '../types/warden';

interface SeoCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

interface AuditReport {
  url: string;
  score: number;
  checks: SeoCheck[];
}

interface SeoAuditViewProps {
  onCreateBacklogItem: (payload: {
    title: string;
    spec_md: string;
    stage: BacklogStage;
    priority: PriorityLevel;
    project_slug: string;
    assigned_agent_id: string | null;
  }) => Promise<void> | void;
  onNotify: (summary: string) => void;
}

const STATUS_ICON: Record<SeoCheck['status'], React.ReactNode> = {
  pass: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
  warn: <AlertTriangle className="h-4 w-4 text-amber-400" />,
  fail: <XCircle className="h-4 w-4 text-red-400" />,
};

/**
 * SEO automation loop UI: audit a URL, file findings as backlog tasks,
 * generate the llms.txt + JSON-LD pack, and ship it as a GitHub PR.
 */
export const SeoAuditView: React.FC<SeoAuditViewProps> = ({
  onCreateBacklogItem,
  onNotify,
}) => {
  const [targetUrl, setTargetUrl] = useState<string>('');
  const [auditing, setAuditing] = useState<boolean>(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [filing, setFiling] = useState<boolean>(false);
  const [filedIds, setFiledIds] = useState<Set<string>>(new Set());

  const [company, setCompany] = useState<string>('');
  const [brief, setBrief] = useState<string>('');
  const [pack, setPack] = useState<{ llms_txt: string; jsonld: string } | null>(null);
  const [generating, setGenerating] = useState<boolean>(false);
  const [shipping, setShipping] = useState<boolean>(false);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [shipError, setShipError] = useState<string | null>(null);
  const [repo, setRepo] = useState<string>('');

  const runAudit = async () => {
    const target = targetUrl.trim();
    if (!target) {
      setAuditError('Enter a URL to audit, e.g. novapulse.io');
      return;
    }
    setAuditing(true);
    setAuditError(null);
    try {
      const res = await fetch(`/api/seo/audit?url=${encodeURIComponent(target)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setAuditError(data?.error || 'Audit failed. Is the orchestrator running?');
        return;
      }
      setReport({ url: data.url, score: data.score, checks: data.checks });
      try {
        const host = new URL(data.url).hostname.replace(/^www\./, '');
        if (!company) setCompany(host.split('.')[0] || '');
      } catch {
        // keep company field as-is
      }
    } catch {
      setAuditError('Cannot reach the Warden server. Start it with npm run dev:api.');
    } finally {
      setAuditing(false);
    }
  };

  const fileFinding = async (check: SeoCheck) => {
    await onCreateBacklogItem({
      title: `SEO: fix ${check.label} on ${report?.url || targetUrl}`,
      spec_md: `${check.detail}\n\nSource: Warden SEO audit (${check.id}). Assignee: verify, fix, re-run audit.`,
      stage: 'TODO',
      priority: check.status === 'fail' ? 'P0' : 'P1',
      project_slug: 'marketing',
      assigned_agent_id: '@aeo_specialist',
    });
    setFiledIds((prev) => new Set(prev).add(check.id));
  };

  const fileAllFindings = async () => {
    if (!report) return;
    const open = report.checks.filter(
      (c) => c.status !== 'pass' && !filedIds.has(c.id)
    );
    if (open.length === 0) return;
    setFiling(true);
    try {
      for (const check of open) {
        await fileFinding(check);
      }
      onNotify(`Filed ${open.length} SEO findings to the backlog`);
    } finally {
      setFiling(false);
    }
  };

  const generatePack = async () => {
    setGenerating(true);
    try {
      const domain = (() => {
        try {
          return new URL(report?.url || `https://${targetUrl}`).hostname;
        } catch {
          return targetUrl;
        }
      })();
      const res = await fetch('/api/seo/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company, domain, description: brief }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setPack({ llms_txt: data.llms_txt, jsonld: data.jsonld });
      }
    } finally {
      setGenerating(false);
    }
  };

  const shipPr = async () => {
    if (!pack) return;
    const repoName = repo.trim();
    if (!repoName || !repoName.includes('/')) {
      setShipError('Enter the target repo as owner/name.');
      return;
    }
    setShipping(true);
    setShipError(null);
    setPrUrl(null);
    try {
      const res = await fetch('/api/seo/ship-pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: repoName,
          title: 'SEO pack: llms.txt + JSON-LD schema',
          body: 'Generated by Warden @aeo_specialist from the SEO audit. Adds the answer-engine brief and SoftwareApplication structured data.',
          files: [
            { path: 'public/llms.txt', content: pack.llms_txt },
            { path: 'public/seo-schema.json', content: pack.jsonld },
          ],
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setPrUrl(data.pr_url);
        onNotify(`SEO pack PR opened: ${data.pr_url}`);
      } else {
        setShipError(data?.error || 'PR shipping failed.');
      }
    } catch {
      setShipError('Cannot reach the Warden server. Start it with npm run dev:api.');
    } finally {
      setShipping(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify(`${label} copied to clipboard`);
    } catch {
      onNotify('Copy failed in this browser');
    }
  };

  const openCount = report?.checks.filter((c) => c.status !== 'pass').length || 0;

  return (
    <div className="space-y-5">
      {/* Step 1: audit */}
      <section className="rounded-2xl border border-[#22262E] bg-[#14161A] p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-[#D4B475]" />
          <h2 className="text-sm font-black text-white">
            1. Audit a site — the technical SEO checklist, automated
          </h2>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="url"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runAudit();
            }}
            placeholder="novapulse.io or https://your-site.com/pricing"
            aria-label="URL to audit"
            className="flex-1 rounded-xl border border-[#2D3440] bg-[#101216] px-3.5 py-2.5 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#C6A664]/60"
          />
          <button
            type="button"
            onClick={() => void runAudit()}
            disabled={auditing}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-bold px-5 py-2.5 text-xs transition cursor-pointer disabled:opacity-50"
          >
            {auditing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
            <span>{report ? 'Re-run audit' : 'Run audit'}</span>
          </button>
        </div>
        {auditError && <p className="text-xs text-red-300">{auditError}</p>}

        {report && (
          <div className="space-y-3 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-300">
                Score{' '}
                <strong className="font-mono text-white">{report.score}/100</strong>{' '}
                <span className="font-mono text-slate-500">{report.url}</span>
              </p>
              <button
                type="button"
                onClick={() => void fileAllFindings()}
                disabled={filing || openCount === 0}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#C6A664]/50 bg-[#C6A664]/10 hover:bg-[#C6A664]/20 px-3 py-2 text-xs font-bold text-[#D4B475] transition cursor-pointer disabled:opacity-40"
              >
                {filing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListPlus className="h-4 w-4" />}
                <span>
                  {openCount === 0 ? 'All checks green' : `File ${openCount} findings to backlog`}
                </span>
              </button>
            </div>
            <ul className="space-y-2">
              {report.checks.map((check) => (
                <li
                  key={check.id}
                  className="flex items-start gap-2.5 rounded-xl border border-[#22262E] bg-[#101216] px-3 py-2"
                >
                  <span className="mt-0.5 shrink-0">{STATUS_ICON[check.status]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-white">{check.label}</span>
                    <span className="block text-[11px] text-slate-400 mt-0.5">{check.detail}</span>
                  </span>
                  {check.status !== 'pass' && (
                    <button
                      type="button"
                      onClick={() => void fileFinding(check)}
                      disabled={filedIds.has(check.id)}
                      className="shrink-0 rounded-lg border border-[#22262E] bg-[#1D2128] hover:bg-[#22262E] px-2 py-1 text-[10px] font-bold text-slate-200 transition cursor-pointer disabled:opacity-40"
                    >
                      {filedIds.has(check.id) ? 'Filed' : 'File task'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Step 2: generate + ship */}
      <section className="rounded-2xl border border-[#22262E] bg-[#14161A] p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-2">
          <FileCode2 className="h-4 w-4 text-[#D4B475]" />
          <h2 className="text-sm font-black text-white">
            2. Generate the answer-engine pack, ship it as a PR
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company name"
            aria-label="Company name"
            className="rounded-xl border border-[#2D3440] bg-[#101216] px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#C6A664]/60"
          />
          <input
            type="text"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="One-line brief (optional)"
            aria-label="Company brief"
            className="rounded-xl border border-[#2D3440] bg-[#101216] px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#C6A664]/60"
          />
        </div>
        <div>
          <button
            type="button"
            onClick={() => void generatePack()}
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-xl border border-[#22262E] bg-[#1D2128] hover:bg-[#22262E] px-4 py-2.5 text-xs font-bold text-slate-100 transition cursor-pointer disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCode2 className="h-4 w-4 text-[#D4B475]" />}
            <span>Generate llms.txt + JSON-LD</span>
          </button>
        </div>

        {pack && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="rounded-xl border border-[#22262E] bg-[#101216] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono font-bold text-gold-300">public/llms.txt</span>
                  <button
                    type="button"
                    onClick={() => void copyText(pack.llms_txt, 'llms.txt')}
                    className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-white cursor-pointer"
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </button>
                </div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[10px] font-mono text-slate-300">
                  {pack.llms_txt}
                </pre>
              </div>
              <div className="rounded-xl border border-[#22262E] bg-[#101216] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono font-bold text-gold-300">public/seo-schema.json</span>
                  <button
                    type="button"
                    onClick={() => void copyText(pack.jsonld, 'JSON-LD')}
                    className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-white cursor-pointer"
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </button>
                </div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[10px] font-mono text-slate-300">
                  {pack.jsonld}
                </pre>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="owner/repo to receive the PR"
                aria-label="Target repository"
                className="flex-1 rounded-xl border border-[#2D3440] bg-[#101216] px-3.5 py-2.5 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#C6A664]/60"
              />
              <button
                type="button"
                onClick={() => void shipPr()}
                disabled={shipping}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#F5F0E6] hover:bg-white text-[#0B121C] font-bold px-4 py-2.5 text-xs transition cursor-pointer disabled:opacity-50"
              >
                {shipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitPullRequest className="h-4 w-4" />}
                <span>Ship as PR</span>
              </button>
              <button
                type="button"
                onClick={() => void runAudit()}
                disabled={auditing || !targetUrl.trim()}
                title="Re-run the audit after merging to watch checks turn green"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#22262E] bg-[#1D2128] hover:bg-[#22262E] px-4 py-2.5 text-xs font-bold text-slate-200 transition cursor-pointer disabled:opacity-40"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Verify fix</span>
              </button>
            </div>
            {shipError && <p className="text-xs text-red-300">{shipError}</p>}
            {prUrl && (
              <a
                href={prUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/20 transition"
              >
                <GitPullRequest className="h-4 w-4" />
                <span>PR opened — review &amp; merge</span>
              </a>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

export default SeoAuditView;
