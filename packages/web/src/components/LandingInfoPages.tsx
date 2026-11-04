import React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  CheckCircle2,
  Cpu,
  Database,
  FileCode2,
  FolderGit2,
  Globe,
  KeyRound,
  Layers,
  Lock,
  Rocket,
  Server,
  Shield,
  Sparkles,
  Terminal,
  Zap,
} from 'lucide-react';

export type PublicLandingTab = 'landing' | 'architecture' | 'security' | 'docs';

interface LandingBottomNavProps {
  activeTab: PublicLandingTab;
  onSelectTab: (tab: PublicLandingTab) => void;
  variant: 'mobile' | 'desktop';
}

const NAV_ITEMS: { id: PublicLandingTab; label: string }[] = [
  { id: 'landing', label: 'Overview' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'security', label: 'Security' },
  { id: 'docs', label: 'Docs' },
];

export const LandingBottomNav: React.FC<LandingBottomNavProps> = ({
  activeTab,
  onSelectTab,
  variant,
}) => {
  if (variant === 'mobile') {
    return (
      <nav
        aria-label="Mobile bottom navigation"
        className="rounded-2xl border border-[#22262E] bg-[#14161A]/90 backdrop-blur-md px-3 py-2.5 flex items-center justify-around text-[11px] font-mono text-slate-400"
      >
        {NAV_ITEMS.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                active
                  ? 'text-[#D4B475] font-semibold bg-[#C6A664]/15 border border-[#C6A664]/35'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Desktop bottom navigation"
      className="hidden lg:flex items-center justify-between border-t border-[#22262E] px-10 xl:px-12 py-3 text-xs font-mono text-slate-400 shrink-0"
    >
      <button
        type="button"
        onClick={() => onSelectTab('landing')}
        className="text-[#D4B475] font-semibold tracking-wider hover:brightness-110 transition cursor-pointer"
      >
        WARDEN OS
      </button>
      <div className="flex items-center gap-6">
        {NAV_ITEMS.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`px-3 py-1 rounded-lg transition cursor-pointer ${
                active
                  ? 'text-[#D4B475] font-semibold bg-[#C6A664]/15 border border-[#C6A664]/35'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <span className="text-slate-500">v0.1.4</span>
    </nav>
  );
};

interface LandingInfoPageProps {
  tab: 'architecture' | 'security' | 'docs';
  onSelectTab: (tab: PublicLandingTab) => void;
  onStart: () => void;
}

export const LandingInfoPage: React.FC<LandingInfoPageProps> = ({
  tab,
  onSelectTab,
  onStart,
}) => {
  return (
    <div className="relative w-full min-h-dvh flex flex-col justify-between max-w-7xl mx-auto">
      {/* Subtle Ambient Sovereign Glow */}
      <div className="hidden lg:block pointer-events-none fixed -top-32 left-1/4 h-96 w-96 rounded-full bg-[#C6A664]/[0.06] blur-3xl" />
      <div className="hidden lg:block pointer-events-none fixed bottom-12 right-10 h-96 w-96 rounded-full bg-[#162030]/60 blur-3xl" />

      {/* Top Header Bar */}
      <header className="sticky top-0 z-20 border-b border-[#22262E] bg-[#090A0C]/90 backdrop-blur-md px-5 sm:px-8 lg:px-10 py-3.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onSelectTab('landing')}
            className="inline-flex items-center gap-2 rounded-xl border border-[#2D3440] bg-[#14161A] hover:border-[#C6A664]/50 px-3 py-1.5 text-xs font-mono text-slate-300 hover:text-white transition cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-[#D4B475]" />
            <span>Overview</span>
          </button>
          <div className="hidden sm:flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-b from-[#D4B475]/20 to-[#162030] border border-[#C6A664]/40 p-0.5 flex items-center justify-center">
              <img
                src="/warden-logo.webp"
                decoding="async"
                alt="WARDEN Logo"
                className="h-full w-full object-contain rounded-md"
              />
            </div>
            <span className="text-xs font-black tracking-[0.2em] text-white">
              WARDEN AUTOMATONS
            </span>
          </div>
        </div>

        {/* Center Pill Switcher */}
        <div className="hidden md:flex items-center gap-1 rounded-xl border border-[#22262E] bg-[#14161A] p-1 text-xs font-mono">
          {NAV_ITEMS.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                  active
                    ? 'bg-[#C6A664]/20 text-[#D4B475] border border-[#C6A664]/40 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onStart}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-black tracking-wider uppercase border border-[#D4B475] shadow-[0_4px_20px_rgba(198,166,100,0.28)] hover:brightness-110 px-4 py-2 text-xs transition cursor-pointer"
        >
          <span>Start</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 px-5 sm:px-8 lg:px-10 py-8 space-y-8">
        {tab === 'architecture' && <ArchitectureSection onStart={onStart} />}
        {tab === 'security' && <SecuritySection onStart={onStart} />}
        {tab === 'docs' && <DocsSection onStart={onStart} />}
      </main>

      {/* Mobile + Desktop Bottom Nav */}
      <div className="px-4 pb-4 lg:hidden">
        <LandingBottomNav
          activeTab={tab}
          onSelectTab={onSelectTab}
          variant="mobile"
        />
      </div>
      <LandingBottomNav
        activeTab={tab}
        onSelectTab={onSelectTab}
        variant="desktop"
      />
    </div>
  );
};

/* ========================================================================== */
/* 1. ARCHITECTURE PAGE                                                       */
/* ========================================================================== */

const ArchitectureSection: React.FC<{ onStart: () => void }> = ({ onStart }) => {
  return (
    <div className="space-y-8">
      {/* Hero Banner */}
      <div className="rounded-3xl border border-[#C6A664]/35 bg-gradient-to-r from-[#14161A] via-[#131923] to-[#0B121C] p-6 sm:p-8 shadow-2xl space-y-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#C6A664]/40 bg-[#C6A664]/15 px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-[#D4B475]">
          <Layers className="h-3.5 w-3.5" />
          <span>System Architecture • Persistent Context Engine</span>
        </div>
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white leading-tight">
          4-Tier Hierarchical Orchestration &amp; Context Firewalls
        </h1>
        <p className="text-sm sm:text-base text-slate-300 max-w-3xl leading-relaxed">
          Warden replaces flat, token-burning chat loops with a bottom-heavy corporate pyramid. Executive agents hold strategy and route directives; ephemeral specialist agents hydrate only the exact repo files and memory vectors required to ship the patch.
        </p>
      </div>

      {/* 4-Tier Hierarchy Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-mono uppercase tracking-wider text-[#D4B475] font-bold">
            1. The 4-Tier Agent Hierarchy &amp; Token Caps
          </h2>
          <span className="text-xs font-mono text-slate-400">
            90% Lower Context Overhead
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              tier: 'ROOT • LEVEL -1',
              slug: '@warden',
              title: 'Executive Chief of Staff',
              cap: '<= 1.5K tok/turn',
              desc: 'Single point of intake for the CEO via Dashboard or WhatsApp. Parses intent, locks approval gates, and dispatches C-Suite heads without reading raw source trees.',
            },
            {
              tier: 'C-SUITE • LEVEL 0',
              slug: '@cto • @cmo • @cbo',
              title: 'Department Executives',
              cap: '<= 4.0K tok/turn',
              desc: 'Own cross-project architecture, growth strategy, and revenue pipelines. Synthesize implementation specs and spawn Level 1 leads or Level 2 specialists.',
            },
            {
              tier: 'LEADS • LEVEL 1',
              slug: '@tech_lead • @pm • @designer • @seo_aeo_head • @social_lead',
              title: 'Domain & Sprint Leads',
              cap: '<= 3.0K tok/turn',
              desc: 'Own daily standup collation, backlog triage, API contracts, 8-bit sprite atlases, and technical SEO/AEO audits.',
            },
            {
              tier: 'EXECUTORS • LEVEL 2',
              slug: '@frontend_dev • @backend_dev • @infra_jr • @seo_content_dev',
              title: 'Ephemeral Specialists',
              cap: '<= 2.0K tok/turn',
              desc: 'Clock in for a single scoped task, patch isolated workspace files, run DOM and build checks, deploy to Cloudflare Pages, and dissolve.',
            },
          ].map((node) => (
            <div
              key={node.tier}
              className="rounded-2xl border border-[#C6A664]/30 bg-[#14161A]/95 p-5 flex flex-col justify-between gap-3"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#D4B475]">
                    {node.tier}
                  </span>
                  <span className="rounded-md bg-[#C6A664]/15 border border-[#C6A664]/35 px-2 py-0.5 text-[10px] font-mono text-gold-300">
                    {node.cap}
                  </span>
                </div>
                <div className="font-mono text-xs font-bold text-white">
                  {node.slug}
                </div>
                <div className="text-xs font-semibold text-slate-300">
                  {node.title}
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {node.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Core Subsystems (3 Columns) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="rounded-2xl border border-[#22262E] bg-[#14161A] p-6 space-y-3">
          <div className="flex items-center gap-2.5 text-[#D4B475]">
            <Cpu className="h-5 w-5" />
            <h3 className="text-base font-bold text-white">
              Meta Muse Model Router
            </h3>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Dynamic per-step model routing across three switchable profiles (<code className="font-mono text-[#D4B475]">META_MUSE_HACKATHON</code>, <code className="font-mono text-[#D4B475]">LOCAL_ZERO_COST</code>, and <code className="font-mono text-[#D4B475]">CUSTOM_HYBRID</code>):
          </p>
          <ul className="space-y-2 text-xs text-slate-300">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#D4B475] shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">muse-spark-1.3:</strong> Executive planning, architectural specs, and live workspace HTML/CSS/JS synthesis.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#D4B475] shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">muse-light:</strong> High-speed Level 2 tool-call loops and subagent status handoffs.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#D4B475] shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">muse-glimmer-30b &amp; muse-image:</strong> Context compaction and 8-bit arcade sprite sheet generation.
              </span>
            </li>
          </ul>
        </div>

        <div className="rounded-2xl border border-[#22262E] bg-[#14161A] p-6 space-y-3">
          <div className="flex items-center gap-2.5 text-[#D4B475]">
            <Database className="h-5 w-5" />
            <h3 className="text-base font-bold text-white">
              Hybrid Memory &amp; pgvector Store
            </h3>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Powered by <code className="font-mono text-[#D4B475]">@warden/db</code> with PostgreSQL + <code className="font-mono text-[#D4B475]">pgvector</code> and a local JSON snapshot fallback:
          </p>
          <ul className="space-y-2 text-xs text-slate-300">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#D4B475] shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">4 Memory Classes:</strong> <code className="font-mono">PINNED_PREFERENCE</code>, <code className="font-mono">REPO_GOTCHA</code>, <code className="font-mono">EPISODIC_LESSON</code>, and <code className="font-mono">CEO_DECISION</code>.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#D4B475] shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">Semantic Recall:</strong> Cosine similarity search across past chat threads, episodic memories, and indexed code chunks.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#D4B475] shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">Real-Time WebSocket Bus:</strong> Streams <code className="font-mono">BRAIN_STATUS</code>, <code className="font-mono">STEP_CREATED</code>, and <code className="font-mono">TELEMETRY_TICK</code> events over <code className="font-mono">/ws</code>.
              </span>
            </li>
          </ul>
        </div>

        <div className="rounded-2xl border border-[#22262E] bg-[#14161A] p-6 space-y-3">
          <div className="flex items-center gap-2.5 text-[#D4B475]">
            <Globe className="h-5 w-5" />
            <h3 className="text-base font-bold text-white">
              Isolated Workspaces &amp; Edge Deploy
            </h3>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Every operator gets an isolated workspace and instant edge preview pipeline:
          </p>
          <ul className="space-y-2 text-xs text-slate-300">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#D4B475] shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">Per-User Sandboxes:</strong> Dedicated <code className="font-mono">user-demos/u-&lt;userId&gt;</code> source &amp; <code className="font-mono">build/</code> bundle directories plus isolated <code className="font-mono">demo/u&lt;id&gt;</code> Git branches.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#D4B475] shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">Automated QA Verification:</strong> DOM marker assertions and bundle integrity checks run before any task transitions to <code className="font-mono">DONE</code>.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#D4B475] shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">Cloudflare Pages Edge:</strong> Direct Wrangler publishing to <code className="font-mono">*.warden.autos</code> subdomains on every completed run.
              </span>
            </li>
          </ul>
        </div>
      </div>

      {/* Bottom CTA Card */}
      <div className="rounded-2xl border border-[#C6A664]/40 bg-[#162030]/90 p-5 sm:p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="space-y-1 text-center sm:text-left">
          <div className="text-sm sm:text-base font-bold text-white">
            Ready to watch the 4-tier hierarchy close a live sprint task?
          </div>
          <p className="text-xs text-slate-300">
            Sign in with your email to provision an isolated studio workspace in seconds.
          </p>
        </div>
        <button
          type="button"
          onClick={onStart}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-black uppercase tracking-wider border border-[#D4B475] px-6 py-3 text-xs transition cursor-pointer shrink-0"
        >
          <span>Launch Live War Room</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

/* ========================================================================== */
/* 2. SECURITY PAGE                                                           */
/* ========================================================================== */

const SecuritySection: React.FC<{ onStart: () => void }> = ({ onStart }) => {
  return (
    <div className="space-y-8">
      {/* Hero Banner */}
      <div className="rounded-3xl border border-[#C6A664]/35 bg-gradient-to-r from-[#14161A] via-[#131923] to-[#0B121C] p-6 sm:p-8 shadow-2xl space-y-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#C6A664]/40 bg-[#C6A664]/15 px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-[#D4B475]">
          <Shield className="h-3.5 w-3.5" />
          <span>Security &amp; Governance • Sovereign Isolation</span>
        </div>
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white leading-tight">
          Human-Gated Autonomy, Tenant Isolation &amp; Hard Quota Walls
        </h1>
        <p className="text-sm sm:text-base text-slate-300 max-w-3xl leading-relaxed">
          Autonomous agents should never have unchecked production authority. Warden enforces strict per-operator database isolation, CSRF-hardened session tokens, mandatory CEO approval gates, and real-time watchdog circuit breakers.
        </p>
      </div>

      {/* 4 Security Pillars */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-[#C6A664]/30 bg-[#14161A] p-6 space-y-3">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#D4B475] font-bold">
              <Lock className="h-4 w-4" />
              <span>1. Multi-Tenant State Isolation</span>
            </span>
            <span className="rounded bg-[#C6A664]/15 border border-[#C6A664]/35 px-2 py-0.5 text-[10px] font-mono text-gold-300">
              PostgreSQL Scoped
            </span>
          </div>
          <h3 className="text-lg font-bold text-white">
            Zero Cross-Operator State Leakage
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed">
            Every signed-in operator is assigned a cryptographic UUID. All operational rows in PostgreSQL (<code className="font-mono text-[#D4B475]">onboarding_profiles</code>, <code className="font-mono text-[#D4B475]">demo_workspaces</code>, <code className="font-mono text-[#D4B475]">chat_threads</code>, <code className="font-mono text-[#D4B475]">chat_messages</code>, <code className="font-mono text-[#D4B475]">backlog_items</code>, <code className="font-mono text-[#D4B475]">agent_runs</code>, and <code className="font-mono text-[#D4B475]">inference_steps</code>) are strictly filtered by <code className="font-mono text-[#D4B475]">user_id</code>. Code edits execute inside isolated per-user directories and dedicated Git branches.
          </p>
        </div>

        <div className="rounded-2xl border border-[#C6A664]/30 bg-[#14161A] p-6 space-y-3">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#D4B475] font-bold">
              <KeyRound className="h-4 w-4" />
              <span>2. Auth &amp; CSRF Hardening</span>
            </span>
            <span className="rounded bg-[#C6A664]/15 border border-[#C6A664]/35 px-2 py-0.5 text-[10px] font-mono text-gold-300">
              JWT + Token Version
            </span>
          </div>
          <h3 className="text-lg font-bold text-white">
            Passwordless OTP &amp; Instant Revocation
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed">
            Operators authenticate via 6-digit Email OTP or WhatsApp Link verification with per-IP rate limiting and attempt counters. REST mutations require an explicit <code className="font-mono text-[#D4B475]">Authorization: Bearer</code> header (immune to cross-site request forgery), while <code className="font-mono text-[#D4B475]">HttpOnly; SameSite=Strict</code> session cookies are restricted to <code className="font-mono text-[#D4B475]">/ws</code> upgrades and <code className="font-mono text-[#D4B475]">/media/*</code> streams. Logging out increments <code className="font-mono text-[#D4B475]">token_version</code> and immediately drops live WebSockets.
          </p>
        </div>

        <div className="rounded-2xl border border-[#C6A664]/30 bg-[#14161A] p-6 space-y-3">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#D4B475] font-bold">
              <Shield className="h-4 w-4" />
              <span>3. Human-in-the-Loop Approval Gates</span>
            </span>
            <span className="rounded bg-[#C6A664]/15 border border-[#C6A664]/35 px-2 py-0.5 text-[10px] font-mono text-gold-300">
              3 Permission Tiers
            </span>
          </div>
          <h3 className="text-lg font-bold text-white">
            Explicit CEO Sign-Off Before Execution
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed">
            Every agent operates under a configurable permission tier (<code className="font-mono text-[#D4B475]">strict_gate</code>, <code className="font-mono text-[#D4B475]">standard_autonomous</code>, or <code className="font-mono text-[#D4B475]">full_overdrive</code>). High-impact backlog items and production deployments pause in <code className="font-mono text-[#D4B475]">NEEDS_CEO</code> until the operator clicks <strong className="text-white">Approve &amp; Execute</strong> (with optional custom directive overrides).
          </p>
        </div>

        <div className="rounded-2xl border border-[#C6A664]/30 bg-[#14161A] p-6 space-y-3">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-[#D4B475] font-bold">
              <Zap className="h-4 w-4" />
              <span>4. Watchdogs, BYOK &amp; Token Firewalls</span>
            </span>
            <span className="rounded bg-[#C6A664]/15 border border-[#C6A664]/35 px-2 py-0.5 text-[10px] font-mono text-gold-300">
              1-Click Kill Switch
            </span>
          </div>
          <h3 className="text-lg font-bold text-white">
            Runaway Loop Protection &amp; Write-Only Keys
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed">
            <code className="font-mono text-[#D4B475]">HealthAndQuotaGuard</code> monitors heartbeat age, subagent spawn counts, and per-run token budgets—automatically halting stuck loops and exposing a 1-Click Kill/Restart switch in Agent Studio. Operator BYOK Meta Muse API keys are stored write-only (GET responses expose only the last-4 hint) and enforce hard token caps (<code className="font-mono text-[#D4B475]">429 TOKEN_CAP_EXCEEDED</code>).
          </p>
        </div>
      </div>

      {/* Bottom CTA Card */}
      <div className="rounded-2xl border border-[#C6A664]/40 bg-[#162030]/90 p-5 sm:p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="space-y-1 text-center sm:text-left">
          <div className="text-sm sm:text-base font-bold text-white">
            Test CEO Approval Gates and 1-Click Kill Controls Live
          </div>
          <p className="text-xs text-slate-300">
            Enter the sandboxed demo studio with pre-staged P0 approval cards on your desk.
          </p>
        </div>
        <button
          type="button"
          onClick={onStart}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-black uppercase tracking-wider border border-[#D4B475] px-6 py-3 text-xs transition cursor-pointer shrink-0"
        >
          <span>Sign In &amp; Test Controls</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

/* ========================================================================== */
/* 3. DOCS PAGE                                                               */
/* ========================================================================== */

const DocsSection: React.FC<{ onStart: () => void }> = ({ onStart }) => {
  return (
    <div className="space-y-8">
      {/* Hero Banner */}
      <div className="rounded-3xl border border-[#C6A664]/35 bg-gradient-to-r from-[#14161A] via-[#131923] to-[#0B121C] p-6 sm:p-8 shadow-2xl space-y-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#C6A664]/40 bg-[#C6A664]/15 px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-[#D4B475]">
          <BookOpen className="h-3.5 w-3.5" />
          <span>Operator Documentation • Quickstart &amp; API Reference</span>
        </div>
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white leading-tight">
          Warden Operator Guide &amp; Control Plane Reference
        </h1>
        <p className="text-sm sm:text-base text-slate-300 max-w-3xl leading-relaxed">
          Everything you need to run the standalone Warden repo locally against PostgreSQL, command the 13-agent hierarchy from the dashboard or WhatsApp, and link your own repositories.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: Local Quickstart */}
        <div className="rounded-2xl border border-[#22262E] bg-[#14161A] p-6 space-y-4">
          <div className="flex items-center gap-2.5 text-[#D4B475]">
            <Terminal className="h-5 w-5" />
            <h2 className="text-base font-bold text-white">
              1. Local Dev Quickstart (DB-Backed Parity)
            </h2>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Warden ships a monorepo with <code className="font-mono text-[#D4B475]">packages/db</code>, <code className="font-mono text-[#D4B475]">packages/orchestrator</code>, <code className="font-mono text-[#D4B475]">packages/web</code>, <code className="font-mono text-[#D4B475]">packages/sandbox</code>, and <code className="font-mono text-[#D4B475]">packages/client</code>.
          </p>
          <pre className="rounded-xl border border-[#22262E] bg-[#0B0E14] p-4 text-[11px] font-mono text-gold-200 overflow-x-auto leading-relaxed">
{`# 1. Install workspace dependencies
npm install

# 2. Configure environment variables
cp .env.example .env
# Set META_MUSE_API_KEY and DATABASE_URL in .env

# 3. Boot PostgreSQL + pgvector & start Control Plane + Web UI
npm run db:up
npm run dev:db

# Dashboard: http://localhost:5173
# Control Plane API & WS: http://localhost:4000`}
          </pre>
        </div>

        {/* Card 2: Commanding Agents */}
        <div className="rounded-2xl border border-[#22262E] bg-[#14161A] p-6 space-y-4">
          <div className="flex items-center gap-2.5 text-[#D4B475]">
            <Bot className="h-5 w-5" />
            <h2 className="text-base font-bold text-white">
              2. Commanding Agents &amp; Approval Workflows
            </h2>
          </div>
          <ul className="space-y-2.5 text-xs text-slate-300 leading-relaxed">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#D4B475] shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">Priority Approval Cards (Home):</strong> Review P0 tasks in the Home Priority Window. Add an optional CEO directive note and click <strong className="text-white">Approve &amp; Execute</strong> to trigger <code className="font-mono text-[#D4B475]">@warden → @cto/@cmo → specialist</code> execution and live Cloudflare Pages deployment.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#D4B475] shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">Executive vs. Direct Mention Routing:</strong> Plain messages route to <code className="font-mono text-[#D4B475]">@warden</code> in executive mode. Prefix with <code className="font-mono text-[#D4B475]">@cto</code>, <code className="font-mono text-[#D4B475]">@designer</code>, <code className="font-mono text-[#D4B475]">@frontend_dev</code>, or <code className="font-mono text-[#D4B475]">@seo_aeo_head</code> to dispatch a direct specialist run.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#D4B475] shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">Live Brain Trace &amp; Studio:</strong> Click any active agent or task to inspect step-by-step LLM thinking, tool calls, diffs, and token breakdown in real time.
              </span>
            </li>
          </ul>
        </div>

        {/* Card 3: Connecting Code & Context Import */}
        <div className="rounded-2xl border border-[#22262E] bg-[#14161A] p-6 space-y-4">
          <div className="flex items-center gap-2.5 text-[#D4B475]">
            <FolderGit2 className="h-5 w-5" />
            <h2 className="text-base font-bold text-white">
              3. Connecting Repositories &amp; Importing Context
            </h2>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Onboard your own company via Track 1 (Solo Founder), Track 2 (Existing Team + AI Twins), or Track 3 (Bundle / Chat Export Import):
          </p>
          <pre className="rounded-xl border border-[#22262E] bg-[#0B0E14] p-4 text-[11px] font-mono text-gold-200 overflow-x-auto leading-relaxed">
{`# Link a private local repository to the cloud control plane:
npx @warden/runner link --workspace ~/your-project

# Verify build & TypeScript gates before pushing:
npm run typecheck
npm run build`}
          </pre>
        </div>

        {/* Card 4: REST & WebSocket Endpoints */}
        <div className="rounded-2xl border border-[#22262E] bg-[#14161A] p-6 space-y-4">
          <div className="flex items-center gap-2.5 text-[#D4B475]">
            <Server className="h-5 w-5" />
            <h2 className="text-base font-bold text-white">
              4. Control Plane API &amp; WebSocket Endpoints
            </h2>
          </div>
          <ul className="space-y-2 text-xs font-mono text-slate-300">
            <li className="flex items-center justify-between border-b border-[#22262E] pb-1.5">
              <span className="text-[#D4B475]">POST /api/auth/email/request &amp; /verify</span>
              <span className="text-slate-400 font-sans">Passwordless Email OTP</span>
            </li>
            <li className="flex items-center justify-between border-b border-[#22262E] pb-1.5">
              <span className="text-[#D4B475]">PATCH /api/auth/me/onboarding</span>
              <span className="text-slate-400 font-sans">Persist step &amp; provision</span>
            </li>
            <li className="flex items-center justify-between border-b border-[#22262E] pb-1.5">
              <span className="text-[#D4B475]">GET / POST /api/agents &amp; /api/runs</span>
              <span className="text-slate-400 font-sans">Roster &amp; brain traces</span>
            </li>
            <li className="flex items-center justify-between border-b border-[#22262E] pb-1.5">
              <span className="text-[#D4B475]">GET / POST /api/backlog</span>
              <span className="text-slate-400 font-sans">Sprint tasks &amp; approvals</span>
            </li>
            <li className="flex items-center justify-between border-b border-[#22262E] pb-1.5">
              <span className="text-[#D4B475]">POST /api/demo/deploy</span>
              <span className="text-slate-400 font-sans">Cloudflare Pages edge push</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-[#D4B475]">WS /ws</span>
              <span className="text-slate-400 font-sans">Real-time telemetry stream</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Bottom CTA Card */}
      <div className="rounded-2xl border border-[#C6A664]/40 bg-[#162030]/90 p-5 sm:p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="space-y-1 text-center sm:text-left">
          <div className="text-sm sm:text-base font-bold text-white">
            Explore the Live Demo Studio or Onboard Your Company
          </div>
          <p className="text-xs text-slate-300">
            Jump straight into the interactive Command Center Dashboard.
          </p>
        </div>
        <button
          type="button"
          onClick={onStart}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-black uppercase tracking-wider border border-[#D4B475] px-6 py-3 text-xs transition cursor-pointer shrink-0"
        >
          <span>Get Started</span>
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
