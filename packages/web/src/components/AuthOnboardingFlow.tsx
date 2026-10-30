import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  Cpu,
  FileCode2,
  FolderGit2,
  Globe,
  KeyRound,
  Layers,
  Lock,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  Rocket,
  Share2,
  Shield,
  Sparkles,
  Trash2,
  Unlock,
  Upload,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { CountryCodePicker } from './CountryCodePicker';
import { COUNTRIES, detectCountryIso, findCountry } from '../data/countries';
import { saveOnboarding, setToken, type AuthUser } from '../api/auth';
import { WhatsAppQrLogin, type WhatsAppSignInResult } from './WhatsAppQrLogin';

export type OnboardingStepId =
  | 'loading'
  | 'landing'
  | 'login'
  | 'otp'
  | 'f1'
  | '1a'
  | '1b'
  | '1c'
  | '2a'
  | '2b'
  | '2c'
  | '3_import';

export type ReturnUserPersona =
  | 'FIRST_TIME'
  | 'RETURN_MID_ONBOARDING'
  | 'RETURN_COMPLETE';

export interface AuthOnboardingFlowProps {
  onComplete: () => void;
  /**
   * 'live' (default): the real product flow. WhatsApp OTP against the backend, routing
   * from the user's saved onboarding state, steps persisted to /api/auth/me/onboarding.
   * 'gallery': dev-only screen browser (npm run dev:ui) with step pills, persona
   * simulation and the Demo/Product toggle.
   */
  mode?: 'live' | 'gallery';
  /** Live mode: called after the JWT is stored, with the server's user record. */
  onSignedIn?: (user: AuthUser) => void;
  initialDemoMode?: boolean;
  initialStep?: OnboardingStepId;
}

const PERSISTED_STEPS: OnboardingStepId[] = ['f1', '1a', '1b', '1c', '2a', '2b', '2c', '3_import'];

interface SuggestedAgentNode {
  slug: string;
  name: string;
  roleTitle: string;
  vertical: 'TECH' | 'SEO_AEO' | 'SOCIAL';
  level: -1 | 0 | 1 | 2;
  supervisorSlug: string | null;
  tokenCap: string;
  accepted: boolean;
  rationale: string;
}

interface HumanTeamMember {
  id: string;
  humanName: string;
  humanRole: string;
  currentFocus: string;
  vertical: 'TECH' | 'SEO_AEO' | 'SOCIAL';
  pairedAiTwinSlug: string;
  pairedAiTwinRole: string;
  supervisorSlug: string;
}

interface OnboardingBacklogDraft {
  id: string;
  title: string;
  vertical: 'TECH' | 'SEO_AEO' | 'SOCIAL';
  priority: 'P0' | 'P1';
  assignee: string;
  project: string;
  enabled: boolean;
}

export const StrictOverseerCrest: React.FC<{
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}> = ({ className = '', size = 'lg' }) => {
  const imgClass = size === 'lg' ? 'h-24 w-24' : size === 'sm' ? 'h-6 w-6' : 'h-14 w-14';
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <div className="relative flex items-center justify-center rounded-2xl bg-gradient-to-b from-[#D4B475]/25 via-[#162030] to-[#0B121C] border border-[#C6A664]/40 p-2 shadow-2xl shadow-[#C6A664]/10 backdrop-blur-sm">
        <img
          src="/warden-logo.png"
          alt="WARDEN Strict Overseer Logo"
          className={`${imgClass} object-contain rounded-xl`}
          onError={(e) => {
            (e.target as HTMLElement).style.display = 'none';
          }}
        />
      </div>
    </div>
  );
};

const SAVED_STEP_STORAGE_KEY = 'commando_onboarding_saved_step_v1';

const INITIAL_SOLO_AGENTS: SuggestedAgentNode[] = [
  {
    slug: '@warden',
    name: 'Warden',
    roleTitle: 'Root Chief of Staff',
    vertical: 'TECH',
    level: -1,
    supervisorSlug: null,
    tokenCap: '<= 1.5K tok/turn',
    accepted: true,
    rationale: 'Routes executive directives across Tech, SEO/AEO, and Social Media.',
  },
  {
    slug: '@cto',
    name: 'CTO',
    roleTitle: 'Level 0 Head of Tech',
    vertical: 'TECH',
    level: 0,
    supervisorSlug: '@warden',
    tokenCap: '<= 4.0K tok/turn',
    accepted: true,
    rationale: 'Owns technical architecture, contract gates, and multi-repo orchestration.',
  },
  {
    slug: '@cbo',
    name: 'CBO',
    roleTitle: 'Level 0 Chief Business Officer',
    vertical: 'SEO_AEO',
    level: 0,
    supervisorSlug: '@warden',
    tokenCap: '<= 4.0K tok/turn',
    accepted: true,
    rationale: 'Owns revenue EV, AEO citation growth, and social distribution strategy.',
  },
  {
    slug: '@pm',
    name: 'Product Manager',
    roleTitle: 'Level 1 Backlog & Standup Lead',
    vertical: 'TECH',
    level: 1,
    supervisorSlug: '@cto',
    tokenCap: '<= 3.0K tok/turn',
    accepted: true,
    rationale: 'Collates worklist backlogs and runs the 12:00 PM IST daily standup.',
  },
  {
    slug: '@tech_lead',
    name: 'Tech Lead',
    roleTitle: 'Level 1 Architecture & Sharding Lead',
    vertical: 'TECH',
    level: 1,
    supervisorSlug: '@cto',
    tokenCap: '<= 3.5K tok/turn',
    accepted: true,
    rationale: 'Locks API contracts and shards disjoint file sets to Level 2 devs.',
  },
  {
    slug: '@frontend_dev',
    name: 'Frontend & Web App Dev',
    roleTitle: 'Level 2 React / SaaS UI Builder',
    vertical: 'TECH',
    level: 2,
    supervisorSlug: '@tech_lead',
    tokenCap: 'Mirror Sandbox',
    accepted: true,
    rationale: 'Executes NovaPulse web & mobile UI components inside .state/mirror/pulse-core.',
  },
  {
    slug: '@backend_dev',
    name: 'Backend & API Dev',
    roleTitle: 'Level 2 API, Billing & Support Builder',
    vertical: 'TECH',
    level: 2,
    supervisorSlug: '@tech_lead',
    tokenCap: 'Mirror Sandbox',
    accepted: true,
    rationale: 'Implements REST/WebSocket APIs, billing webhooks, and WhatsApp/Email support workflows in pulse-api & pulse-support.',
  },
  {
    slug: '@aeo_lead',
    name: 'SEO / AEO Lead',
    roleTitle: 'Level 1 Search & Answer Engine Lead',
    vertical: 'SEO_AEO',
    level: 1,
    supervisorSlug: '@cbo',
    tokenCap: '<= 2.5K tok/turn',
    accepted: true,
    rationale: 'Maximizes NovaPulse LLM citation share across Perplexity, ChatGPT Search, and Gemini (pulse-seo).',
  },
  {
    slug: '@aeo_specialist',
    name: 'AEO Schema Specialist',
    roleTitle: 'Level 2 JSON-LD & llms.txt Specialist',
    vertical: 'SEO_AEO',
    level: 2,
    supervisorSlug: '@aeo_lead',
    tokenCap: '<= 2.0K tok/turn',
    accepted: true,
    rationale: 'Ships programmatic JSON-LD schemas, /llms.txt, and high-intent comparison clusters on novapulse.io.',
  },
  {
    slug: '@social_lead',
    name: 'Digital Marketing & Social Lead',
    roleTitle: 'Level 1 Viral Growth & Paid Funnel Lead',
    vertical: 'SOCIAL',
    level: 1,
    supervisorSlug: '@cbo',
    tokenCap: '<= 2.5K tok/turn',
    accepted: true,
    rationale: 'Owns founder X/LinkedIn threads, paid acquisition ROAS, and short-form video hook retention (pulse-social).',
  },
  {
    slug: '@social_creator',
    name: 'Content & Ad Creative Builder',
    roleTitle: 'Level 2 Short-Form Video & Campaign Creator',
    vertical: 'SOCIAL',
    level: 2,
    supervisorSlug: '@social_lead',
    tokenCap: '<= 2.0K tok/turn',
    accepted: true,
    rationale: 'Produces 9:16 product demo hooks, customer case-study reels, and X/LinkedIn launch threads.',
  },
];

const INITIAL_HUMAN_ROSTER: HumanTeamMember[] = [
  {
    id: 'hum-1',
    humanName: 'Alex Rivera',
    humanRole: 'Founder & CEO (NovaPulse — Year 3 Post-Seed/Series A)',
    currentFocus: 'Product Strategy, Enterprise ARR Expansion & Multi-Vertical AI Governance',
    vertical: 'TECH',
    pairedAiTwinSlug: '@warden',
    pairedAiTwinRole: 'Root Chief of Staff + @cto / @cbo Executive Layer',
    supervisorSlug: 'CEO',
  },
  {
    id: 'hum-2',
    humanName: 'Maya Lin',
    humanRole: 'Lead Full-Stack Engineer',
    currentFocus: 'pulse-core & pulse-api v3 checkout orchestration and real-time analytics',
    vertical: 'TECH',
    pairedAiTwinSlug: '@tech_lead',
    pairedAiTwinRole: 'Level 1 Tech Lead + @frontend_dev / @backend_dev Twins',
    supervisorSlug: '@cto',
  },
  {
    id: 'hum-3',
    humanName: 'Liam Vance',
    humanRole: 'Infra & Cloud Lead',
    currentFocus: 'pulse-infra multi-region edge caching, zero-downtime CI/CD & SOC2 monitoring',
    vertical: 'TECH',
    pairedAiTwinSlug: '@infra_head',
    pairedAiTwinRole: 'Level 1 Cloud & Edge Infra Twin (reports to @cto)',
    supervisorSlug: '@cto',
  },
  {
    id: 'hum-4',
    humanName: 'Elena Rostova',
    humanRole: 'Head of SEO & AEO',
    currentFocus: 'pulse-seo programmatic comparison pages, /llms.txt & Perplexity/ChatGPT citations',
    vertical: 'SEO_AEO',
    pairedAiTwinSlug: '@aeo_lead',
    pairedAiTwinRole: 'Level 1 SEO/AEO Lead + @aeo_specialist Twin',
    supervisorSlug: '@cbo',
  },
  {
    id: 'hum-5',
    humanName: 'Marcus Sterling',
    humanRole: 'Digital Marketing & Social Lead',
    currentFocus: 'pulse-social founder X/LinkedIn authority funnels & product launch campaigns',
    vertical: 'SOCIAL',
    pairedAiTwinSlug: '@social_lead',
    pairedAiTwinRole: 'Level 1 Digital Marketing & Social Lead Twin',
    supervisorSlug: '@cbo',
  },
  {
    id: 'hum-6',
    humanName: 'Chloe Park',
    humanRole: 'Content & Paid Campaigns Lead',
    currentFocus: 'pulse-social 9:16 product reels, YouTube shorts & paid acquisition creatives',
    vertical: 'SOCIAL',
    pairedAiTwinSlug: '@social_creator',
    pairedAiTwinRole: 'Level 2 Content & Ad Creative Twin (reports to @social_lead)',
    supervisorSlug: '@cbo',
  },
  {
    id: 'hum-7',
    humanName: 'Samir Patel',
    humanRole: 'Customer Support & Ops Lead',
    currentFocus: 'pulse-support 24/7 WhatsApp/Email AI concierge & enterprise SLA triage',
    vertical: 'TECH',
    pairedAiTwinSlug: '@support_lead',
    pairedAiTwinRole: 'Level 1 Customer Support & Concierge Twin (reports to @cbo)',
    supervisorSlug: '@cbo',
  },
];

const INITIAL_BACKLOG_DRAFTS: OnboardingBacklogDraft[] = [
  {
    id: 'ob-1',
    title: 'Ship NovaPulse v3 One-Click Checkout & Real-Time Webhook Pipeline',
    vertical: 'TECH',
    priority: 'P0',
    assignee: '@tech_lead',
    project: 'pulse-core',
    enabled: true,
  },
  {
    id: 'ob-2',
    title: 'Automate Multi-Region Edge Failover & Daily Encrypted DB Snapshots',
    vertical: 'TECH',
    priority: 'P0',
    assignee: '@backend_dev',
    project: 'pulse-infra',
    enabled: true,
  },
  {
    id: 'ob-3',
    title: 'Publish /llms.txt & SoftwareApplication JSON-LD Schema on novapulse.io',
    vertical: 'SEO_AEO',
    priority: 'P0',
    assignee: '@aeo_lead',
    project: 'pulse-seo',
    enabled: true,
  },
  {
    id: 'ob-4',
    title: 'Launch 25 Programmatic High-Intent SaaS Comparison Landing Pages',
    vertical: 'SEO_AEO',
    priority: 'P1',
    assignee: '@aeo_specialist',
    project: 'pulse-seo',
    enabled: true,
  },
  {
    id: 'ob-5',
    title: 'Produce 5 Short-Form 9:16 Product Demo Hooks & Customer ROI Reels',
    vertical: 'SOCIAL',
    priority: 'P0',
    assignee: '@social_creator',
    project: 'pulse-social',
    enabled: true,
  },
  {
    id: 'ob-6',
    title: 'Deploy Automated WhatsApp & Email Tier-1 Support Concierge Deflection Flow',
    vertical: 'TECH',
    priority: 'P1',
    assignee: '@backend_dev',
    project: 'pulse-support',
    enabled: true,
  },
];

export const AuthOnboardingFlow: React.FC<AuthOnboardingFlowProps> = ({
  onComplete,
  mode = 'live',
  onSignedIn,
  initialDemoMode = true,
  initialStep = 'loading',
}) => {
  const isLive = mode === 'live';
  const [demoMode, setDemoMode] = useState<boolean>(isLive ? false : initialDemoMode);
  // Live: the landing ".md Import" CTA signs in first, then a new user lands on this track.
  const [pendingTrack, setPendingTrack] = useState<OnboardingStepId | null>(null);
  const [signedIn, setSignedIn] = useState<boolean>(isLive && PERSISTED_STEPS.includes(initialStep));
  const [step, setStep] = useState<OnboardingStepId>(initialStep);
  const [persona, setPersona] = useState<ReturnUserPersona>('FIRST_TIME');

  // Step 0: Loader state
  const [loadProgress, setLoadProgress] = useState<number>(0);

  // Step 2 & 2.1: Login & OTP state (Hardcoded test OTP 123123 across WhatsApp & Email)
  const TEST_OTP_CODE = '123123';
  const TEST_OTP_DIGITS = ['1', '2', '3', '1', '2', '3'];
  const [authChannel, setAuthChannel] = useState<'WHATSAPP' | 'EMAIL'>('WHATSAPP');
  const [detectedIso] = useState<string>(() => detectCountryIso());
  const [countryIso, setCountryIso] = useState<string>(detectedIso);
  const [localNumber, setLocalNumber] = useState<string>('');
  const dialCode = findCountry(countryIso)?.dial ?? '1';
  const whatsappNumber = `+${dialCode} ${localNumber.trim()}`;
  const [emailAddress, setEmailAddress] = useState<string>('alex@example.com');
  const [otpDigits, setOtpDigits] = useState<string[]>(['1', '2', '3', '1', '2', '3']);
  const [authError, setAuthError] = useState<string | null>(null);
  // Product Mode + WhatsApp sends a real code via /api/auth/otp/*; Demo Mode keeps the 123123 preset.
  const liveOtp = !demoMode && authChannel === 'WHATSAPP';
  const [otpBusy, setOtpBusy] = useState<boolean>(false);
  // Live WhatsApp sign-in defaults to click-to-chat (QR); the 6-digit code is the fallback.
  const [loginMethod, setLoginMethod] = useState<'qr' | 'code'>('qr');
  const [resendAt, setResendAt] = useState<number>(0);
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const resendInSec = Math.max(0, Math.ceil((resendAt - nowTick) / 1000));

  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [resendAt]);

  // Track 1 (Solo Founder — Year 0 Day-1 Launch of NovaPulse) state
  const [companyName, setCompanyName] = useState<string>('NovaPulse (novapulse.io)');
  const [companyBrief, setCompanyBrief] = useState<string>(
    'AI-Powered Commerce, SEO/AEO Growth, Digital Marketing & Customer Support SaaS company (Year 0 Solo Founder Alex Rivera launching pulse-core, pulse-api, pulse-seo, pulse-social, and pulse-support).'
  );
  const [enabledVerticals, setEnabledVerticals] = useState<
    Record<'TECH' | 'SEO_AEO' | 'SOCIAL', boolean>
  >({
    TECH: true,
    SEO_AEO: true,
    SOCIAL: true,
  });
  const [soloAgents, setSoloAgents] = useState<SuggestedAgentNode[]>(INITIAL_SOLO_AGENTS);
  const [showCustomCreatorForSlug, setShowCustomCreatorForSlug] = useState<string | null>(
    null
  );
  const [customSlug, setCustomSlug] = useState<string>('@custom_specialist');
  const [customTitle, setCustomTitle] = useState<string>('Custom Domain Specialist');
  const [customVertical, setCustomVertical] = useState<'TECH' | 'SEO_AEO' | 'SOCIAL'>(
    'TECH'
  );
  const [customSupervisor, setCustomSupervisor] = useState<string>('@cto');

  // Track 2 (Existing Team — NovaPulse 3 Years Later, Post-$4.5M Seed/Series A) state
  const [teamWebsite, setTeamWebsite] = useState<string>('https://novapulse.io');
  const [teamRepos, setTeamRepos] = useState<string>(
    'pulse-core, pulse-api, pulse-infra, pulse-seo, pulse-social, pulse-support'
  );
  const [teamSocials, setTeamSocials] = useState<string>(
    'x.com/novapulse_ai, linkedin.com/company/novapulse, youtube.com/@novapulse'
  );
  const [humanRoster, setHumanRoster] = useState<HumanTeamMember[]>(INITIAL_HUMAN_ROSTER);
  const [newHumanName, setNewHumanName] = useState<string>('');
  const [newHumanRole, setNewHumanRole] = useState<string>('');
  const [newHumanFocus, setNewHumanFocus] = useState<string>('');
  const [newHumanVertical, setNewHumanVertical] = useState<'TECH' | 'SEO_AEO' | 'SOCIAL'>(
    'TECH'
  );

  // Shared 1C / 2C Backlog state
  const [backlogDrafts, setBacklogDrafts] =
    useState<OnboardingBacklogDraft[]>(INITIAL_BACKLOG_DRAFTS);

  // Track 3 (.md Bundle Import) state
  const [bundleLoading, setBundleLoading] = useState<boolean>(false);
  const [bundleFileCount, setBundleFileCount] = useState<number>(42);
  const [bundlePreviewKeys, setBundlePreviewKeys] = useState<string[]>([
    'AGENTS.md',
    'projects.yaml',
    '.claude/agents/cto.md',
    '.claude/agents/cbo.md',
    '.claude/agents/pm.md',
    '.claude/agents/tech_lead.md',
    '.claude/agents/seo_aeo.json',
    '.claude/agents/social_media.json',
    'worklist/COLLATED_BACKLOG.md',
  ]);

  // Live: save the current onboarding step server-side so a return visit resumes here.
  useEffect(() => {
    if (isLive && signedIn && PERSISTED_STEPS.includes(step)) void saveOnboarding({ step });
  }, [isLive, signedIn, step]);

  // Gallery: persist mid-onboarding steps to localStorage for Return User simulation
  useEffect(() => {
    if (isLive) return;
    if (['1a', '1b', '1c', '2a', '2b', '2c', '3_import'].includes(step)) {
      try {
        window.localStorage.setItem(SAVED_STEP_STORAGE_KEY, step);
      } catch {
        // ignore storage errors
      }
    }
  }, [isLive, step]);

  // Step 0 Loader progress animation
  useEffect(() => {
    if (step !== 'loading') return;
    setLoadProgress(0);
    const interval = window.setInterval(() => {
      setLoadProgress((prev) => {
        if (prev >= 100) {
          window.clearInterval(interval);
          return 100;
        }
        return prev + 20;
      });
    }, 280);
    return () => window.clearInterval(interval);
  }, [step]);

  useEffect(() => {
    if (step === 'loading' && loadProgress >= 100) {
      const t = window.setTimeout(() => setStep('landing'), 350);
      return () => window.clearTimeout(t);
    }
  }, [step, loadProgress]);

  // Fetch /warden-demo-bundle.json when entering 3_import
  useEffect(() => {
    if (step !== '3_import') return;
    let cancelled = false;
    setBundleLoading(true);
    fetch('/warden-demo-bundle.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const keys = Object.keys(data);
        setBundleFileCount(keys.length);
        setBundlePreviewKeys(keys.slice(0, 14));
      })
      .catch(() => {
        // keep default preview keys
      })
      .finally(() => {
        if (!cancelled) setBundleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step]);

  // E.164 caps the full number at 15 digits; national parts are rarely under 6.
  const isPhoneValid = useMemo(() => {
    const digits = localNumber.replace(/\D/g, '');
    return digits.length >= 6 && digits.length + dialCode.length <= 15;
  }, [localNumber, dialCode]);

  // A pasted "+44 7700..." switches the country instead of doubling the code.
  const handleLocalNumberChange = (raw: string) => {
    if (raw.trim().startsWith('+')) {
      const digits = raw.replace(/\D/g, '');
      const match = COUNTRIES.filter((c) => digits.startsWith(c.dial)).sort(
        (a, b) => b.dial.length - a.dial.length || (a.iso === countryIso ? -1 : 1)
      )[0];
      if (match) {
        if (match.dial !== dialCode) setCountryIso(match.iso);
        setLocalNumber(digits.slice(match.dial.length));
        return;
      }
    }
    setLocalNumber(raw.replace(/[^\d\s-]/g, ''));
  };

  const isEmailValid = useMemo(
    () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress.trim()),
    [emailAddress]
  );

  const routeAfterOtpVerification = (user?: AuthUser) => {
    setAuthError(null);
    if (user) {
      const { status, step: savedStep } = user.onboarding;
      if (status === 'COMPLETE') {
        onComplete();
        return;
      }
      if (status === 'IN_PROGRESS' && savedStep && PERSISTED_STEPS.includes(savedStep as OnboardingStepId)) {
        setStep(savedStep as OnboardingStepId);
        return;
      }
      setStep(pendingTrack ?? 'f1');
      return;
    }
    if (persona === 'RETURN_COMPLETE') {
      onComplete();
      return;
    }
    if (persona === 'RETURN_MID_ONBOARDING') {
      const saved =
        (window.localStorage.getItem(SAVED_STEP_STORAGE_KEY) as OnboardingStepId) || '1b';
      setStep(saved);
      return;
    }
    setStep('f1');
  };

  const postAuth = async (path: string, body: Record<string, string>) => {
    try {
      const res = await fetch(`/api/auth/otp/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok && data.ok !== false, data };
    } catch {
      return { ok: false, data: { error: 'Cannot reach the Commando server. Is the orchestrator running?' } };
    }
  };

  const sendLiveOtp = async (): Promise<boolean> => {
    setOtpBusy(true);
    const { ok, data } = await postAuth('request', { phone: whatsappNumber });
    setOtpBusy(false);
    if (!ok) {
      setAuthError(data.error || 'Could not send the code.');
      if (data.retry_after_sec) setResendAt(Date.now() + data.retry_after_sec * 1000);
      return false;
    }
    setResendAt(Date.now() + (data.resend_in_sec ?? 30) * 1000);
    setNowTick(Date.now());
    return true;
  };

  const handleProceedToOtp = async () => {
    if (authChannel === 'WHATSAPP' && !isPhoneValid) {
      setAuthError('Enter a valid WhatsApp phone number with country code.');
      return;
    }
    if (authChannel === 'EMAIL' && !isEmailValid) {
      setAuthError('Enter a valid work email address.');
      return;
    }
    setAuthError(null);
    if (liveOtp) {
      if (!(await sendLiveOtp())) return;
      setOtpDigits(['', '', '', '', '', '']);
    } else {
      setOtpDigits([...TEST_OTP_DIGITS]);
    }
    setStep('otp');
  };

  const handleResendOtp = async () => {
    setAuthError(null);
    if (await sendLiveOtp()) setOtpDigits(['', '', '', '', '', '']);
  };

  // Typing a digit advances focus; pasting / autofilling all 6 fills every box.
  const handleOtpDigitChange = (idx: number, raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '');
    const inputs = document.querySelectorAll<HTMLInputElement>('input[data-otp-digit]');
    if (digits.length > 1) {
      setOtpDigits((prev) => prev.map((d, i) => (i >= idx && digits[i - idx] ? digits[i - idx] : d)));
      inputs[Math.min(idx + digits.length, 5)]?.focus();
      return;
    }
    setOtpDigits((prev) => prev.map((d, i) => (i === idx ? digits : d)));
    if (digits && idx < 5) inputs[idx + 1]?.focus();
  };

  const handleAutoVerifyOtp = () => {
    setOtpDigits([...TEST_OTP_DIGITS]);
    routeAfterOtpVerification();
  };

  // Both sign-in paths (QR click-to-chat and 6-digit code) end here with the server's JWT.
  const completeSignIn = (data: WhatsAppSignInResult) => {
    setToken(data.token);
    if (isLive) {
      setSignedIn(true);
      onSignedIn?.(data.user);
    }
    routeAfterOtpVerification(data.user);
  };

  const handleVerifyOtp = async () => {
    const code = otpDigits.join('');
    if (liveOtp) {
      if (code.length !== 6) {
        setAuthError('Enter the 6-digit code from WhatsApp.');
        return;
      }
      setOtpBusy(true);
      const { ok, data } = await postAuth('verify', { phone: whatsappNumber, code });
      setOtpBusy(false);
      if (!ok) {
        const left = typeof data.attempts_left === 'number' && data.attempts_left > 0 ? ` ${data.attempts_left} attempts left.` : '';
        setAuthError(`${data.error || 'Verification failed.'}${left}`);
        return;
      }
      completeSignIn(data);
      return;
    }
    if (code !== TEST_OTP_CODE) {
      setAuthError('Invalid OTP. Use test OTP 123123 while live WhatsApp/Email providers are in sandbox mode.');
      return;
    }
    routeAfterOtpVerification();
  };

  const finishOnboarding = async () => {
    if (isLive) await saveOnboarding({ status: 'COMPLETE' });
    onComplete();
  };

  const handleToggleAgentAccepted = (slug: string, accept: boolean) => {
    setSoloAgents((prev) =>
      prev.map((a) => (a.slug === slug ? { ...a, accepted: accept } : a))
    );
    if (!accept) {
      setShowCustomCreatorForSlug(slug);
    } else if (showCustomCreatorForSlug === slug) {
      setShowCustomCreatorForSlug(null);
    }
  };

  const handleChangeSupervisor = (slug: string, nextSupervisor: string) => {
    setSoloAgents((prev) =>
      prev.map((a) =>
        a.slug === slug
          ? { ...a, supervisorSlug: nextSupervisor === 'NONE' ? null : nextSupervisor }
          : a
      )
    );
  };

  const handleAddCustomAgent = () => {
    if (!customSlug.trim() || !customTitle.trim()) return;
    const formattedSlug = customSlug.startsWith('@')
      ? customSlug.trim()
      : `@${customSlug.trim()}`;
    const newAgent: SuggestedAgentNode = {
      slug: formattedSlug,
      name: customTitle.trim(),
      roleTitle: customTitle.trim(),
      vertical: customVertical,
      level: 2,
      supervisorSlug: customSupervisor,
      tokenCap: '<= 2.0K tok/turn',
      accepted: true,
      rationale: 'Custom specialist agent created during 1B hierarchy setup.',
    };
    setSoloAgents((prev) => [...prev, newAgent]);
    setShowCustomCreatorForSlug(null);
  };

  const handleAddHumanMember = () => {
    if (!newHumanName.trim() || !newHumanRole.trim()) return;
    const slugBase = newHumanRole
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 14);
    const created: HumanTeamMember = {
      id: `hum-${Date.now()}`,
      humanName: newHumanName.trim(),
      humanRole: newHumanRole.trim(),
      currentFocus: newHumanFocus.trim() || 'Core vertical delivery & review',
      vertical: newHumanVertical,
      pairedAiTwinSlug: `@${slugBase || 'specialist'}_twin`,
      pairedAiTwinRole: `AI Twin for ${newHumanRole.trim()}`,
      supervisorSlug: newHumanVertical === 'TECH' ? '@cto' : '@cbo',
    };
    setHumanRoster((prev) => [...prev, created]);
    setNewHumanName('');
    setNewHumanRole('');
    setNewHumanFocus('');
  };

  const acceptedSoloAgents = useMemo(
    () => soloAgents.filter((a) => a.accepted),
    [soloAgents]
  );

  return (
    <div className="fixed inset-0 z-50 bg-[#090A0C] text-slate-100 flex flex-col overflow-y-auto">
      {/* 1. TOP FLOATING DEMO & NAVIGATION BAR (gallery only) */}
      {!isLive && (
      <div className="sticky top-0 z-30 border-b border-[#22262E] bg-[#14161A]/95 backdrop-blur-md px-3 sm:px-5 py-2">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          {/* Left: Brand + Demo vs Product Mode Toggle */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-b from-[#E5A93C]/20 to-[#1D2128] border border-[#E5A93C]/40 p-0.5 shadow-xs">
                <img
                  src="/warden-logo.png"
                  alt="WARDEN Logo"
                  className="h-full w-full object-contain rounded-md"
                />
              </div>
              <span className="text-xs font-black tracking-widest text-[#F0F4F8]">
                WARDEN
              </span>
            </div>

            <button
              type="button"
              onClick={() => setDemoMode(!demoMode)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-mono font-semibold transition cursor-pointer ${
                demoMode
                  ? 'border-[#C6A664]/50 bg-[#C6A664]/20 text-[#D4B475]'
                  : 'border-[#C6A664]/30 bg-[#162030] text-[#F5F0E6]'
              }`}
            >
              {demoMode ? (
                <>
                  <Lock className="h-3 w-3" />
                  <span>Demo Mode (Locked Presets)</span>
                </>
              ) : (
                <>
                  <Unlock className="h-3 w-3" />
                  <span>Product Mode (Editable)</span>
                </>
              )}
            </button>

            {/* Return-User Simulation Selector */}
            <div className="inline-flex items-center gap-1.5 rounded-xl bg-[#101216] border border-[#22262E] px-2.5 py-1 text-[11px]">
              <span className="text-slate-400 font-mono hidden sm:inline">Persona:</span>
              <select
                value={persona}
                onChange={(e) => setPersona(e.target.value as ReturnUserPersona)}
                aria-label="Return User Simulation Mode"
                className="bg-transparent text-gold-300 font-semibold focus:outline-none cursor-pointer"
              >
                <option value="FIRST_TIME" className="bg-[#101216]">
                  1. First-Time User (→ F1 Tracks)
                </option>
                <option value="RETURN_MID_ONBOARDING" className="bg-[#101216]">
                  2. Return User (Mid-Onboarding Resume)
                </option>
                <option value="RETURN_COMPLETE" className="bg-[#101216]">
                  3. Return User (Complete → Dashboard)
                </option>
              </select>
            </div>
          </div>

          {/* Right: Quick Step Jump Pills + Skip to Dashboard */}
          <div className="flex items-center gap-1 flex-wrap">
            {(
              [
                { id: 'loading', label: '0. Loader' },
                { id: 'landing', label: '1. Landing' },
                { id: 'login', label: '2. Login' },
                { id: 'otp', label: '2.1 OTP' },
                { id: 'f1', label: 'F1 Tracks' },
                { id: '1a', label: '1A Brief' },
                { id: '1b', label: '1B Org' },
                { id: '1c', label: '1C Backlog' },
                { id: '2a', label: '2A Links' },
                { id: '2b', label: '2B Twins' },
                { id: '2c', label: '2C Backlog' },
                { id: '3_import', label: '3. .md Import' },
              ] as { id: OnboardingStepId; label: string }[]
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setStep(pill.id)}
                className={`rounded-lg px-2 py-1 text-[10px] font-mono transition cursor-pointer ${
                  step === pill.id
                    ? 'bg-gold-500/20 text-gold-200 border border-gold-500/40 font-bold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#1D2128]'
                }`}
              >
                {pill.label}
              </button>
            ))}

            <button
              type="button"
              onClick={onComplete}
              className="ml-1 inline-flex items-center gap-1 rounded-xl bg-[#C6A664]/20 border border-[#C6A664]/40 hover:bg-[#C6A664]/30 px-2.5 py-1 text-[11px] font-bold text-[#D4B475] transition cursor-pointer"
            >
              <span>Dashboard</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      )}

      {/* MAIN ONBOARDING STAGE CONTAINER */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
        {/* STEP 0: LOADING SCREEN */}
        {step === 'loading' && (
          <div className="max-w-lg w-full rounded-3xl border border-[#22262E] bg-[#14161A]/95 p-6 sm:p-8 shadow-2xl space-y-6 text-center">
            <div className="mx-auto flex flex-col items-center justify-center">
              <StrictOverseerCrest size="lg" />
            </div>
            <div>
              <span className="rounded-full bg-gold-500/15 border border-gold-500/30 px-2.5 py-0.5 text-[10px] font-mono text-gold-300">
                BOOTSTRAPPING AUTONOMOUS WORKFORCE OS
              </span>
              <h1 className="text-xl font-black text-white mt-2">
                Warming Up Multi-Vertical Hierarchy
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                Preloading bottom-heavy token firewalls across Tech, SEO/AEO, and Social Media.
              </p>
            </div>

            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="h-2.5 w-full rounded-full bg-[#101216] overflow-hidden border border-[#22262E]">
                <div
                  className="h-full bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] transition-all duration-300"
                  style={{ width: `${loadProgress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono text-gold-300">
                <span>Loading Blueprints &amp; Mirrors...</span>
                <span>{loadProgress}%</span>
              </div>
            </div>

            {/* Checklist */}
            <div className="space-y-2 text-left rounded-2xl bg-[#101216]/90 border border-[#22262E] p-4 text-xs">
              {[
                { pct: 20, label: 'Root & Level 0 Executive Firewall (warden, cto, cbo)' },
                { pct: 40, label: 'Tech Vertical: Repo Mirrors & Contract Sharding' },
                { pct: 60, label: 'SEO / AEO Engine: /llms.txt & Programmatic JSON-LD' },
                { pct: 80, label: 'Social Media Loop: 9:16 Hooks & X/LinkedIn Funnels' },
                { pct: 100, label: 'Consultation Depth Knob & 94.2% Token Compression' },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-2.5">
                  <CheckCircle2
                    className={`h-4 w-4 shrink-0 ${
                      loadProgress >= item.pct ? 'text-[#D4B475]' : 'text-slate-600'
                    }`}
                  />
                  <span
                    className={
                      loadProgress >= item.pct ? 'text-slate-200' : 'text-slate-500'
                    }
                  >
                    {item.label}
                  </span>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setStep('landing')}
              className="w-full rounded-xl bg-[#1D2128] hover:bg-[#22262E] border border-[#22262E] py-2.5 text-xs font-semibold text-slate-200 transition cursor-pointer"
            >
              Skip Preloader → Landing Page
            </button>
          </div>
        )}

        {/* STEP 1: LANDING PAGE */}
        {step === 'landing' && (
          <div className="max-w-5xl w-full space-y-8 py-4">
            <div className="text-center space-y-4 max-w-3xl mx-auto">
              <div className="flex items-center justify-center pb-2">
                <StrictOverseerCrest size="lg" />
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-gold-500/15 border border-gold-500/35 px-3 py-1 text-xs font-mono text-gold-300">
                <Sparkles className="h-3.5 w-3.5" />
                <span>WARDEN • STRICT OVERSEER WORKFORCE ENGINE</span>
              </div>
              <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-white leading-tight">
                Run Your Entire Company Across{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#F5F0E6]">
                  Tech, SEO/AEO &amp; Social
                </span>
              </h1>
              <p className="text-sm sm:text-base text-slate-300 max-w-2xl mx-auto">
                Data and code reads stay downstairs in isolated Level 2 sandboxes while you steer architecture, search citations, and viral distribution from one executive command center.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep('login')}
                  className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-bold border border-[#D4B475] shadow-[0_2px_12px_rgba(198,166,100,0.25)] hover:brightness-110 px-6 py-3.5 text-sm transition cursor-pointer"
                >
                  <span>Sign Up / Login</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (isLive) {
                      setPendingTrack('3_import');
                      setStep('login');
                    } else {
                      setStep('3_import');
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-2xl border border-[#22262E] bg-[#1D2128] hover:bg-[#22262E] px-5 py-3.5 text-sm font-semibold text-slate-200 transition cursor-pointer"
                >
                  <FileCode2 className="h-4 w-4 text-gold-400" />
                  <span>Import .md Bundle</span>
                </button>
              </div>
            </div>

            {/* 3 Vertical Pillars Showcase */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-2xl border border-gold-500/30 bg-[#14161A]/90 p-5 space-y-2.5">
                <div className="inline-flex items-center gap-2 rounded-xl bg-gold-500/15 border border-gold-500/30 px-2.5 py-1 text-xs font-bold text-gold-300">
                  <Cpu className="h-4 w-4" />
                  <span>1. Tech &amp; Product Vertical</span>
                </div>
                <h3 className="text-sm font-bold text-white">
                  Sharded Multi-Repo Execution
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  `@cto`, `@pm`, and `@tech_lead` orchestrate `@frontend_dev`, `@backend_dev`, `@rust_lowlat_dev`, and `@xr_3d_dev` with mandatory `sync-in → work → pushit`.
                </p>
              </div>

              <div className="rounded-2xl border border-[#C6A664]/30 bg-[#162030]/90 p-5 space-y-2.5">
                <div className="inline-flex items-center gap-2 rounded-xl bg-[#C6A664]/15 border border-[#C6A664]/30 px-2.5 py-1 text-xs font-bold text-[#D4B475]">
                  <Globe className="h-4 w-4" />
                  <span>2. SEO &amp; AEO Vertical</span>
                </div>
                <h3 className="text-sm font-bold text-white">
                  LLM Citation &amp; Answer Engine Share
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  `@aeo_lead` and `@aeo_specialist` ship `/llms.txt`, `VideoGame` JSON-LD schemas, and comparative clusters across Perplexity, ChatGPT Search, and Gemini.
                </p>
              </div>

              <div className="rounded-2xl border border-[#C6A664]/30 bg-[#162030]/90 p-5 space-y-2.5">
                <div className="inline-flex items-center gap-2 rounded-xl bg-[#C6A664]/15 border border-[#C6A664]/30 px-2.5 py-1 text-xs font-bold text-[#D4B475]">
                  <Share2 className="h-4 w-4" />
                  <span>3. Social Media Vertical</span>
                </div>
                <h3 className="text-sm font-bold text-white">
                  High-Retention Hooks &amp; Founder Threads
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  `@social_lead` and `@social_creator` produce 9:16 gameplay hooks, Devpost trailers, and technical X/LinkedIn devlogs.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: LOGIN MODAL (WhatsApp Default + Email Tab) */}
        {step === 'login' && (
          <div className="max-w-md w-full rounded-3xl border border-[#22262E] bg-[#14161A] p-6 sm:p-7 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-gold-400">
                  STEP 2 • PASSWORDLESS EXECUTIVE AUTH
                </span>
                <h2 className="text-lg font-bold text-white mt-0.5">
                  Sign In to Command Center
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setStep('landing')}
                className="text-xs text-slate-400 hover:text-white"
              >
                ← Back
              </button>
            </div>

            {/* Channel Tabs: WhatsApp (Default) vs Email (gallery only; email OTP has no backend yet) */}
            {!isLive && (
            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-[#101216] border border-[#22262E] p-1">
              <button
                type="button"
                onClick={() => {
                  setAuthChannel('WHATSAPP');
                  setAuthError(null);
                }}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition cursor-pointer ${
                  authChannel === 'WHATSAPP'
                    ? 'bg-[#C6A664]/20 text-[#D4B475] border border-[#C6A664]/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Phone className="h-3.5 w-3.5" />
                <span>WhatsApp (Default)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthChannel('EMAIL');
                  setAuthError(null);
                }}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition cursor-pointer ${
                  authChannel === 'EMAIL'
                    ? 'bg-gold-500/20 text-gold-200 border border-gold-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Mail className="h-3.5 w-3.5" />
                <span>Work Email</span>
              </button>
            </div>
            )}

            {liveOtp && loginMethod === 'qr' ? (
              <WhatsAppQrLogin
                onVerified={completeSignIn}
                onUseCode={() => {
                  setAuthError(null);
                  setLoginMethod('code');
                }}
              />
            ) : (
            <>
            {authChannel === 'WHATSAPP' ? (
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-300">
                  WhatsApp Number (Instant 6-Digit Code + Gate Alerts)
                </label>
                <div className="flex items-stretch gap-2">
                  <CountryCodePicker value={countryIso} onChange={setCountryIso} detectedIso={detectedIso} />
                  <div className="relative flex-1 min-w-0">
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    value={localNumber}
                    onChange={(e) => handleLocalNumberChange(e.target.value)}
                    placeholder="98765 43210"
                    aria-label="WhatsApp number"
                    className={`w-full rounded-xl border bg-[#101216] px-3.5 py-2.5 text-sm font-mono text-slate-100 focus:outline-none ${
                      isPhoneValid ? 'border-[#C6A664]/50' : 'border-[#2D3440]'
                    }`}
                  />
                  {isPhoneValid && (
                    <CheckCircle2 className="h-4 w-4 text-[#D4B475] absolute right-3 top-1/2 -translate-y-1/2" />
                  )}
                  </div>
                </div>
                <p className="text-[11px] text-slate-400">
                  Used for 1-tap OTP sign-in and urgent `[NEEDS_CEO]` standup notifications.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-300">
                  Founder / Executive Email
                </label>
                <div className="relative">
                  <input
                    type="email"
                    value={emailAddress}
                    onChange={(e) => setEmailAddress(e.target.value)}
                    placeholder="ceo@example.com"
                    className={`w-full rounded-xl border bg-[#101216] px-3.5 py-2.5 text-sm font-mono text-slate-100 focus:outline-none ${
                      isEmailValid ? 'border-[#C6A664]/50' : 'border-[#2D3440]'
                    }`}
                  />
                  {isEmailValid && (
                    <CheckCircle2 className="h-4 w-4 text-[#D4B475] absolute right-3 top-1/2 -translate-y-1/2" />
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  We will dispatch a 6-digit verification code and daily standup digest.
                </p>
              </div>
            )}

            {/* Prominent Hardcoded Test OTP Helper Badge + 1-Click Bypass */}
            {!liveOtp && (
            <button
              type="button"
              onClick={handleAutoVerifyOtp}
              className="w-full flex items-center justify-between gap-2 rounded-xl border border-[#C6A664]/45 bg-[#C6A664]/15 hover:bg-[#C6A664]/25 px-3.5 py-2.5 text-xs font-mono font-bold text-[#D4B475] transition cursor-pointer"
            >
              <span>🔑 Test OTP: 123123 (Click to auto-verify)</span>
              <span className="text-[10px] underline text-[#F5F0E6]">
                1-Click Bypass → F1
              </span>
            </button>
            )}

            {authError && (
              <div className="rounded-xl border border-[#C6A664]/40 bg-[#162030] px-3 py-2 text-xs text-[#F5F0E6]">
                {authError}
              </div>
            )}

            <button
              type="button"
              onClick={handleProceedToOtp}
              disabled={otpBusy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-bold border border-[#D4B475] shadow-[0_2px_12px_rgba(198,166,100,0.25)] hover:brightness-110 py-3 text-xs transition cursor-pointer"
            >
              <span>
                {otpBusy ? 'Sending…' : `Send 6-Digit Code via ${authChannel === 'WHATSAPP' ? 'WhatsApp' : 'Email'}`}
              </span>
              <ArrowRight className="h-4 w-4" />
            </button>

            {liveOtp && (
              <button
                type="button"
                onClick={() => {
                  setAuthError(null);
                  setLoginMethod('qr');
                }}
                className="w-full text-center text-[11px] text-slate-400 hover:text-white underline-offset-2 hover:underline cursor-pointer"
              >
                Sign in with a WhatsApp message instead (QR)
              </button>
            )}
            </>
            )}
          </div>
        )}

        {/* STEP 2.1: OTP VERIFICATION SCREEN (Divergent Routing by ReturnUserPersona) */}
        {step === 'otp' && (
          <div className="max-w-md w-full rounded-3xl border border-[#22262E] bg-[#14161A] p-6 sm:p-7 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#D4B475]">
                  STEP 2.1 • 6-DIGIT VERIFICATION
                </span>
                <h2 className="text-lg font-bold text-white mt-0.5">
                  Enter Verification Code
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setStep('login')}
                className="text-xs text-slate-400 hover:text-white"
              >
                ← Change
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-slate-300">
                Sent to{' '}
                <span className="font-mono text-gold-300 font-semibold">
                  {authChannel === 'WHATSAPP' ? whatsappNumber : emailAddress}
                </span>
              </p>
              {liveOtp ? (
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={otpBusy || resendInSec > 0}
                  className="text-[11px] font-mono text-[#D4B475] hover:underline disabled:text-slate-500 disabled:no-underline cursor-pointer disabled:cursor-default"
                >
                  {resendInSec > 0 ? `Resend in ${resendInSec}s` : 'Resend code'}
                </button>
              ) : (
              <span className="rounded-md bg-[#C6A664]/15 border border-[#C6A664]/35 px-2 py-0.5 text-[10px] font-mono text-[#D4B475]">
                Expected: 123123
              </span>
              )}
            </div>

            {/* Prominent Hardcoded Test OTP Helper Badge + 1-Click Auto-Verify */}
            {!liveOtp && (
            <button
              type="button"
              onClick={handleAutoVerifyOtp}
              className="w-full flex items-center justify-between gap-2 rounded-xl border border-[#C6A664]/45 bg-[#C6A664]/15 hover:bg-[#C6A664]/25 px-3.5 py-2.5 text-xs font-mono font-bold text-[#D4B475] transition cursor-pointer"
            >
              <span>🔑 Test OTP: 123123 (Click to auto-verify)</span>
              <span className="text-[10px] underline text-[#F5F0E6]">
                Instant Verify →
              </span>
            </button>
            )}

            {/* 6 Digit Boxes */}
            <div className="grid grid-cols-6 gap-2">
              {otpDigits.map((digit, idx) => (
                <input
                  key={idx}
                  type="text"
                  inputMode="numeric"
                  autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                  autoFocus={liveOtp && idx === 0}
                  data-otp-digit
                  maxLength={idx === 0 ? 6 : 1}
                  value={digit}
                  onChange={(e) => handleOtpDigitChange(idx, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !digit && idx > 0) {
                      document.querySelectorAll<HTMLInputElement>('input[data-otp-digit]')[idx - 1]?.focus();
                    } else if (e.key === 'Enter') {
                      handleVerifyOtp();
                    }
                  }}
                  aria-label={`OTP Digit ${idx + 1}`}
                  className="w-full h-12 text-center rounded-xl border border-gold-500/40 bg-[#101216] text-base font-mono font-bold text-gold-200 focus:outline-none focus:border-gold-400"
                />
              ))}
            </div>

            {authError && (
              <div className="rounded-xl border border-[#C6A664]/40 bg-[#162030] px-3 py-2 text-xs text-[#F5F0E6]">
                {authError}
              </div>
            )}

            {/* Divergent Routing Preview Box (gallery only) */}
            {!isLive && (
            <div className="rounded-xl border border-[#22262E] bg-[#101216]/90 p-3 space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Active Persona Routing:</span>
                <span className="font-mono font-bold text-[#D4B475]">{persona}</span>
              </div>
              <p className="text-[11px] text-slate-300">
                {persona === 'FIRST_TIME'
                  ? '→ Routes to F1 Track Selection (Solo Founder / Existing Team / .md Import).'
                  : persona === 'RETURN_MID_ONBOARDING'
                  ? `→ Resumes saved mid-onboarding step (${
                      window.localStorage.getItem(SAVED_STEP_STORAGE_KEY) || '1b'
                    }) from localStorage.`
                  : '→ Completed onboarding detected: launches straight into the Command Center Dashboard.'}
              </p>
            </div>
            )}

            <button
              type="button"
              onClick={handleVerifyOtp}
              disabled={otpBusy}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-bold border border-[#D4B475] shadow-[0_2px_12px_rgba(198,166,100,0.25)] hover:brightness-110 py-3 text-xs transition cursor-pointer"
            >
              <KeyRound className="h-4 w-4" />
              <span>{liveOtp ? (otpBusy ? 'Verifying…' : 'Verify Code & Continue') : 'Verify OTP (123123) & Continue'}</span>
            </button>
          </div>
        )}

        {/* STEP F1: ONBOARDING TRACK SELECTION (2 Main CTAs + 1 Secondary .md Import CTA) */}
        {step === 'f1' && (
          <div className="max-w-4xl w-full space-y-6">
            <div className="text-center space-y-2">
              <span className="rounded-full bg-gold-500/15 border border-gold-500/35 px-3 py-0.5 text-[10px] font-mono text-gold-300">
                F1 • SELECT YOUR WORKSPACE ARCHITECTURE PATH
              </span>
              <h1 className="text-2xl sm:text-3xl font-black text-white">
                How Would You Like to Provision Your Workforce?
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 max-w-xl mx-auto">
                Choose between starting from a clean founder brief, mirroring an existing human team, or importing an open-source Warden `.md` bundle.
              </p>
            </div>

            {/* 2 Primary Track Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Track 1: Solo Founder */}
              <div className="rounded-3xl border border-gold-500/40 bg-gradient-to-b from-gold-950/25 to-[#14161A] p-6 flex flex-col justify-between gap-5 shadow-xl">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="rounded-xl bg-gold-500/20 border border-gold-500/40 px-2.5 py-1 text-xs font-bold text-gold-300">
                      Track 1 • Solo Founder (1A → 1B → 1C)
                    </span>
                    <Rocket className="h-5 w-5 text-gold-400" />
                  </div>
                  <h2 className="text-lg font-bold text-white">
                    I Am a Solo Founder / New Venture
                  </h2>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Enter your company brief and select capacities across Tech, SEO/AEO, and Social Media. Warden suggests a complete AI agent hierarchy with a live visual Org Chart and starter backlog.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setStep('1a')}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-bold border border-[#D4B475] shadow-[0_2px_12px_rgba(198,166,100,0.25)] hover:brightness-110 py-3 text-xs transition cursor-pointer"
                >
                  <span>Start Solo Founder Setup (1A)</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              {/* Track 2: Pre-Existing Team */}
              <div className="rounded-3xl border border-[#C6A664]/40 bg-gradient-to-b from-[#162030] to-[#0F1824] p-6 flex flex-col justify-between gap-5 shadow-xl">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="rounded-xl bg-[#C6A664]/20 border border-[#C6A664]/40 px-2.5 py-1 text-xs font-bold text-[#D4B475]">
                      Track 2 • Existing Team (2A → 2B → 2C)
                    </span>
                    <Users className="h-5 w-5 text-[#D4B475]" />
                  </div>
                  <h2 className="text-lg font-bold text-white">
                    We Have an Existing Company &amp; Team
                  </h2>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Connect your website, repositories, and social channels, then map your current human employees and their active work into paired AI Agent Twins.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setStep('2a')}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-bold border border-[#D4B475] shadow-[0_2px_12px_rgba(198,166,100,0.25)] hover:brightness-110 py-3 text-xs transition cursor-pointer"
                >
                  <span>Start Existing Team Setup (2A)</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Secondary Option 3: Import Open-Source .md File Structure Bundle */}
            <div className="flex justify-center pt-1">
              <button
                type="button"
                onClick={() => setStep('3_import')}
                className="inline-flex items-center gap-2.5 rounded-2xl border border-[#22262E] bg-[#1D2128]/90 hover:border-[#C6A664]/50 hover:bg-[#1D2128] px-5 py-2.5 text-xs font-semibold text-slate-200 hover:text-[#D4B475] transition cursor-pointer"
              >
                <Upload className="h-4 w-4 text-[#D4B475]" />
                <span>
                  Option 3: Import Open-Source <code className="font-mono text-[#D4B475]">.md</code> File Structure Bundle (<code className="font-mono">AGENTS.md</code> + <code className="font-mono">projects.yaml</code>)
                </span>
              </button>
            </div>
          </div>
        )}

        {/* STEP 1A: SOLO FOUNDER — BRIEF & VERTICAL CAPACITIES */}
        {step === '1a' && (
          <div className="max-w-3xl w-full rounded-3xl border border-[#22262E] bg-[#14161A] p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase text-gold-400">
                  TRACK 1 • STEP 1A OF 1C
                </span>
                <h2 className="text-xl font-bold text-white">
                  Company Brief &amp; Vertical Capacities
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setStep('f1')}
                className="text-xs text-slate-400 hover:text-white"
              >
                ← Back to Tracks
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Company / Studio Name
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full rounded-xl border border-[#2D3440] bg-[#101216] px-3.5 py-2.5 text-sm text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Executive Mission &amp; Product Portfolio Brief
                </label>
                <textarea
                  rows={3}
                  value={companyBrief}
                  onChange={(e) => setCompanyBrief(e.target.value)}
                  className="w-full rounded-xl border border-[#2D3440] bg-[#101216] p-3.5 text-xs text-slate-200 leading-relaxed"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Select Autonomous Workforce Capacities
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(
                    [
                      {
                        id: 'TECH',
                        title: 'Tech & Engineering',
                        desc: '@cto, @pm, @tech_lead, @frontend_dev, @backend_dev',
                      },
                      {
                        id: 'SEO_AEO',
                        title: 'SEO & AEO Citations',
                        desc: '@cbo, @aeo_lead, @aeo_specialist (/llms.txt & JSON-LD)',
                      },
                      {
                        id: 'SOCIAL',
                        title: 'Social Media & Video',
                        desc: '@social_lead, @social_creator (9:16 Hooks & X/LinkedIn)',
                      },
                    ] as const
                  ).map((v) => {
                    const active = enabledVerticals[v.id];
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() =>
                          setEnabledVerticals((prev) => ({
                            ...prev,
                            [v.id]: !prev[v.id],
                          }))
                        }
                        className={`rounded-2xl border p-3.5 text-left transition cursor-pointer ${
                          active
                            ? 'border-gold-500/50 bg-gold-950/25'
                            : 'border-[#22262E] bg-[#101216]/60 opacity-60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">{v.title}</span>
                          <CheckCircle2
                            className={`h-4 w-4 ${
                              active ? 'text-gold-400' : 'text-slate-600'
                            }`}
                          />
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1">{v.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setStep('1b')}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-bold border border-[#D4B475] shadow-[0_2px_12px_rgba(198,166,100,0.25)] hover:brightness-110 px-6 py-3 text-xs transition cursor-pointer"
              >
                <span>Generate Suggested Agent Hierarchy (1B)</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 1B: SUGGESTED AGENTS + ACCEPT/REJECT + INLINE CREATOR + LIVE VISUAL ORG CHART */}
        {step === '1b' && (
          <div className="max-w-6xl w-full rounded-3xl border border-[#22262E] bg-[#14161A] p-5 sm:p-7 shadow-2xl space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#22262E] pb-4">
              <div>
                <span className="text-[10px] font-mono uppercase text-gold-400">
                  TRACK 1 • STEP 1B OF 1C • INTERACTIVE HIERARCHY ARCHITECT
                </span>
                <h2 className="text-lg sm:text-xl font-bold text-white">
                  Approve, Customize &amp; Re-Parent Your AI Workforce ({acceptedSoloAgents.length} Active)
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep('1a')}
                  className="rounded-xl border border-[#2D3440] px-3 py-1.5 text-xs text-slate-300 hover:text-white"
                >
                  ← 1A Brief
                </button>
                <button
                  type="button"
                  onClick={() => setStep('1c')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-bold border border-[#D4B475] shadow-[0_2px_12px_rgba(198,166,100,0.25)] hover:brightness-110 px-4 py-2 text-xs transition cursor-pointer"
                >
                  <span>Continue to Initial Backlog (1C)</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left 7 Cols: Suggested Agent Roster with Accept / Reject / Supervisor Dropdown */}
              <div className="lg:col-span-7 space-y-2.5 max-h-[540px] overflow-y-auto pr-1">
                {soloAgents.map((agent) => (
                  <div
                    key={agent.slug}
                    className={`rounded-2xl border p-3.5 transition ${
                      agent.accepted
                        ? 'border-[#22262E] bg-[#101216]/80'
                        : 'border-[#C6A664]/30 bg-[#162030]/60 opacity-75'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-gold-300">
                          {agent.slug}
                        </span>
                        <span className="text-xs font-semibold text-white">
                          {agent.roleTitle}
                        </span>
                        <span className="rounded bg-[#1D2128] border border-[#22262E] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
                          {agent.vertical}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Supervisor Dropdown */}
                        <div className="flex items-center gap-1 text-[10px] text-slate-400">
                          <span>Boss:</span>
                          <select
                            value={agent.supervisorSlug || 'NONE'}
                            onChange={(e) =>
                              handleChangeSupervisor(agent.slug, e.target.value)
                            }
                            aria-label={`Supervisor for ${agent.slug}`}
                            className="rounded-lg bg-[#1D2128] border border-[#2D3440] px-2 py-0.5 text-[10px] font-mono text-gold-200"
                          >
                            <option value="NONE">CEO (Root)</option>
                            {soloAgents
                              .filter((s) => s.slug !== agent.slug)
                              .map((s) => (
                                <option key={s.slug} value={s.slug}>
                                  {s.slug}
                                </option>
                              ))}
                          </select>
                        </div>

                        {/* Accept / Reject Toggle */}
                        <button
                          type="button"
                          onClick={() => handleToggleAgentAccepted(agent.slug, true)}
                          className={`rounded-lg px-2 py-1 text-[10px] font-bold transition cursor-pointer ${
                            agent.accepted
                              ? 'bg-[#C6A664]/20 text-[#D4B475] border border-[#C6A664]/40'
                              : 'bg-[#1D2128] text-slate-400'
                          }`}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleAgentAccepted(agent.slug, false)}
                          className={`rounded-lg px-2 py-1 text-[10px] font-bold transition cursor-pointer ${
                            !agent.accepted
                              ? 'bg-[#162030] text-[#8A94A6] border border-[#C6A664]/30'
                              : 'bg-[#1D2128] text-slate-400'
                          }`}
                        >
                          Reject / Replace
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">{agent.rationale}</p>

                    {/* Inline Custom Agent Creator when rejected */}
                    {showCustomCreatorForSlug === agent.slug && (
                      <div className="mt-3 rounded-xl border border-gold-500/40 bg-[#1D2128]/95 p-3 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-gold-300">
                            Create Custom Replacement Agent
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowCustomCreatorForSlug(null)}
                            className="text-slate-400 hover:text-white"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={customSlug}
                            onChange={(e) => setCustomSlug(e.target.value)}
                            placeholder="@custom_agent"
                            className="rounded-lg bg-[#101216] border border-[#2D3440] px-2.5 py-1.5 text-xs font-mono text-gold-200"
                          />
                          <input
                            type="text"
                            value={customTitle}
                            onChange={(e) => setCustomTitle(e.target.value)}
                            placeholder="Role Title"
                            className="rounded-lg bg-[#101216] border border-[#2D3440] px-2.5 py-1.5 text-xs text-slate-100"
                          />
                          <button
                            type="button"
                            onClick={handleAddCustomAgent}
                            className="rounded-lg bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-bold border border-[#D4B475] shadow-[0_2px_12px_rgba(198,166,100,0.25)] hover:brightness-110 text-xs py-1.5 cursor-pointer"
                          >
                            + Add Agent
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Right 5 Cols: Live Rendered Visual Org Chart */}
              <div className="lg:col-span-5 rounded-2xl border border-[#22262E] bg-[#101216]/90 p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-[#22262E] pb-2.5">
                  <span className="text-xs font-bold text-slate-100">
                    Live Visual Org Chart (Bottom-Heavy Pyramid)
                  </span>
                  <span className="text-[10px] font-mono text-[#D4B475]">
                    Auto-Synced
                  </span>
                </div>

                {/* CEO Root Node */}
                <div className="space-y-2.5 text-xs">
                  <div className="rounded-xl border border-[#C6A664]/40 bg-[#C6A664]/10 px-3 py-2 text-center font-bold text-[#D4B475]">
                    👑 Founder / CEO ({companyName})
                  </div>

                  {/* Root & Level 0 */}
                  {acceptedSoloAgents
                    .filter((a) => !a.supervisorSlug || a.supervisorSlug === '@warden')
                    .map((execAgent) => {
                      const directReports = acceptedSoloAgents.filter(
                        (r) => r.supervisorSlug === execAgent.slug
                      );
                      return (
                        <div
                          key={execAgent.slug}
                          className="ml-3 pl-3 border-l-2 border-gold-500/40 space-y-2"
                        >
                          <div className="rounded-xl border border-gold-500/35 bg-[#1D2128] px-3 py-2 flex items-center justify-between">
                            <div>
                              <span className="font-mono font-bold text-gold-300">
                                {execAgent.slug}
                              </span>{' '}
                              <span className="text-slate-300">
                                — {execAgent.roleTitle}
                              </span>
                            </div>
                            <span className="text-[9px] font-mono text-slate-400">
                              {execAgent.tokenCap}
                            </span>
                          </div>

                          {directReports.length > 0 && (
                            <div className="ml-4 pl-3 border-l border-[#2D3440] space-y-1.5">
                              {directReports.map((rep) => {
                                const l2Reports = acceptedSoloAgents.filter(
                                  (l2) => l2.supervisorSlug === rep.slug
                                );
                                return (
                                  <div key={rep.slug} className="space-y-1">
                                    <div className="rounded-lg border border-[#22262E] bg-[#101216] px-2.5 py-1.5 flex items-center justify-between text-[11px]">
                                      <span className="font-mono text-[#D4B475]">
                                        {rep.slug}
                                      </span>
                                      <span className="text-slate-400 truncate max-w-[160px]">
                                        {rep.roleTitle}
                                      </span>
                                    </div>
                                    {l2Reports.length > 0 && (
                                      <div className="ml-3 pl-2.5 border-l border-[#22262E] flex flex-wrap gap-1">
                                        {l2Reports.map((l2) => (
                                          <span
                                            key={l2.slug}
                                            className="rounded bg-[#1D2128] border border-[#22262E] px-2 py-0.5 text-[10px] font-mono text-[#D4B475]"
                                          >
                                            {l2.slug}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 1C & 2C: INITIAL COLLATED BACKLOG → LAUNCH DASHBOARD */}
        {(step === '1c' || step === '2c') && (
          <div className="max-w-4xl w-full rounded-3xl border border-[#22262E] bg-[#14161A] p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-[10px] font-mono uppercase text-[#D4B475]">
                  STEP {step.toUpperCase()} • INITIAL MULTI-VERTICAL SPRINT BACKLOG
                </span>
                <h2 className="text-xl font-bold text-white">
                  Review &amp; Activate Day-1 Sprint Tasks
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setStep(step === '1c' ? '1b' : '2b')}
                className="text-xs text-slate-400 hover:text-white"
              >
                ← Back to Hierarchy
              </button>
            </div>

            <div className="space-y-2.5">
              {backlogDrafts.map((task) => (
                <div
                  key={task.id}
                  onClick={() =>
                    setBacklogDrafts((prev) =>
                      prev.map((t) =>
                        t.id === task.id ? { ...t, enabled: !t.enabled } : t
                      )
                    )
                  }
                  className={`rounded-2xl border p-3.5 flex items-center justify-between gap-3 transition cursor-pointer ${
                    task.enabled
                      ? 'border-[#22262E] bg-[#101216]/90'
                      : 'border-[#22262E]/40 bg-[#101216]/30 opacity-50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <CheckCircle2
                      className={`h-4 w-4 shrink-0 ${
                        task.enabled ? 'text-[#D4B475]' : 'text-slate-600'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-100 truncate">
                        {task.title}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 mt-0.5">
                        <span className="text-[#D4B475] font-bold">{task.priority}</span>
                        <span>•</span>
                        <span className="text-gold-300">{task.vertical}</span>
                        <span>•</span>
                        <span>{task.project}</span>
                        <span>•</span>
                        <span>Assigned: {task.assignee}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={finishOnboarding}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-bold border border-[#D4B475] shadow-[0_2px_12px_rgba(198,166,100,0.25)] hover:brightness-110 px-6 py-3.5 text-xs transition cursor-pointer"
              >
                <span>Launch Command Center Dashboard</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2A: EXISTING TEAM — BRIEF, REPOS, WEBSITE & SOCIALS */}
        {step === '2a' && (
          <div className="max-w-3xl w-full rounded-3xl border border-[#22262E] bg-[#14161A] p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase text-[#D4B475]">
                  TRACK 2 • STEP 2A OF 2C • EXISTING COMPANY FOOTPRINT
                </span>
                <h2 className="text-xl font-bold text-white">
                  Connect Website, Repositories &amp; Social Channels
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setStep('f1')}
                className="text-xs text-slate-400 hover:text-white"
              >
                ← Back to Tracks
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Production Website &amp; Store URLs
                </label>
                <input
                  type="text"
                  value={teamWebsite}
                  onChange={(e) => setTeamWebsite(e.target.value)}
                  className="w-full rounded-xl border border-[#2D3440] bg-[#101216] px-3.5 py-2.5 text-xs font-mono text-gold-200"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Connected Git Repositories (`projects.yaml` Mirror Targets)
                </label>
                <input
                  type="text"
                  value={teamRepos}
                  onChange={(e) => setTeamRepos(e.target.value)}
                  className="w-full rounded-xl border border-[#2D3440] bg-[#101216] px-3.5 py-2.5 text-xs font-mono text-slate-200"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Social &amp; Distribution Channels (X, LinkedIn, YouTube, TikTok)
                </label>
                <input
                  type="text"
                  value={teamSocials}
                  onChange={(e) => setTeamSocials(e.target.value)}
                  className="w-full rounded-xl border border-[#2D3440] bg-[#101216] px-3.5 py-2.5 text-xs font-mono text-slate-200"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setStep('2b')}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-bold border border-[#D4B475] shadow-[0_2px_12px_rgba(198,166,100,0.25)] hover:brightness-110 px-6 py-3 text-xs transition cursor-pointer"
              >
                <span>Map Human Employees &amp; AI Twins (2B)</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2B: HUMAN EMPLOYEES & PAIRED AI AGENT TWINS + VISUAL ORG CHART */}
        {step === '2b' && (
          <div className="max-w-6xl w-full rounded-3xl border border-[#22262E] bg-[#14161A] p-5 sm:p-7 shadow-2xl space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#22262E] pb-4">
              <div>
                <span className="text-[10px] font-mono uppercase text-[#D4B475]">
                  TRACK 2 • STEP 2B OF 2C • HUMAN TEAM + AI AGENT TWINS
                </span>
                <h2 className="text-lg sm:text-xl font-bold text-white">
                  Human Roster &amp; Paired AI Twins ({humanRoster.length} Mapped)
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep('2a')}
                  className="rounded-xl border border-[#2D3440] px-3 py-1.5 text-xs text-slate-300 hover:text-white"
                >
                  ← 2A Links
                </button>
                <button
                  type="button"
                  onClick={() => setStep('2c')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-bold border border-[#D4B475] shadow-[0_2px_12px_rgba(198,166,100,0.25)] hover:brightness-110 px-4 py-2 text-xs transition cursor-pointer"
                >
                  <span>Continue to Team Backlog (2C)</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left 7 Cols: Human Employees + Add Employee Form */}
              <div className="lg:col-span-7 space-y-3">
                {humanRoster.map((member) => (
                  <div
                    key={member.id}
                    className="rounded-2xl border border-[#22262E] bg-[#101216]/85 p-3.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-bold text-white">
                          👤 {member.humanName}
                        </span>{' '}
                        <span className="text-[11px] text-slate-400">
                          ({member.humanRole})
                        </span>
                      </div>
                      <span className="rounded-full bg-[#C6A664]/20 border border-[#C6A664]/40 px-2 py-0.5 text-[10px] font-mono text-[#D4B475]">
                        Twin: {member.pairedAiTwinSlug}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Current Work: {member.currentFocus}
                    </p>
                  </div>
                ))}

                {/* Add Human Employee Bar */}
                <div className="rounded-2xl border border-[#22262E] bg-[#1D2128]/60 p-3.5 space-y-2.5">
                  <div className="text-xs font-bold text-slate-200">
                    + Add Human Team Member &amp; Auto-Create AI Agent Twin
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={newHumanName}
                      onChange={(e) => setNewHumanName(e.target.value)}
                      placeholder="Teammate Name"
                      className="rounded-lg bg-[#101216] border border-[#2D3440] px-2.5 py-1.5 text-xs text-slate-100"
                    />
                    <input
                      type="text"
                      value={newHumanRole}
                      onChange={(e) => setNewHumanRole(e.target.value)}
                      placeholder="Role (e.g. DevOps Lead)"
                      className="rounded-lg bg-[#101216] border border-[#2D3440] px-2.5 py-1.5 text-xs text-slate-100"
                    />
                    <select
                      value={newHumanVertical}
                      onChange={(e) =>
                        setNewHumanVertical(
                          e.target.value as 'TECH' | 'SEO_AEO' | 'SOCIAL'
                        )
                      }
                      className="rounded-lg bg-[#101216] border border-[#2D3440] px-2.5 py-1.5 text-xs text-gold-200"
                    >
                      <option value="TECH">Tech Vertical</option>
                      <option value="SEO_AEO">SEO / AEO Vertical</option>
                      <option value="SOCIAL">Social Media Vertical</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newHumanFocus}
                      onChange={(e) => setNewHumanFocus(e.target.value)}
                      placeholder="Current work / sprint focus..."
                      className="flex-1 rounded-lg bg-[#101216] border border-[#2D3440] px-2.5 py-1.5 text-xs text-slate-200"
                    />
                    <button
                      type="button"
                      onClick={handleAddHumanMember}
                      className="rounded-lg bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-bold border border-[#D4B475] shadow-[0_2px_12px_rgba(198,166,100,0.25)] hover:brightness-110 px-3.5 py-1.5 text-xs cursor-pointer"
                    >
                      Pair AI Twin
                    </button>
                  </div>
                </div>
              </div>

              {/* Right 5 Cols: Visual Hybrid Human + AI Twin Org Chart */}
              <div className="lg:col-span-5 rounded-2xl border border-[#22262E] bg-[#101216]/90 p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-[#22262E] pb-2">
                  <span className="text-xs font-bold text-slate-100">
                    Hybrid Human ↔ AI Twin Org Chart
                  </span>
                  <span className="text-[10px] font-mono text-[#D4B475]">
                    1:1 Paired
                  </span>
                </div>
                <div className="space-y-2.5">
                  {humanRoster.map((m) => (
                    <div
                      key={m.id}
                      className="rounded-xl border border-[#22262E] bg-[#1D2128]/90 p-2.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <div className="font-bold text-slate-100">{m.humanName}</div>
                        <div className="text-[10px] text-slate-400">{m.humanRole}</div>
                      </div>
                      <span className="text-gold-400 font-mono">⇄</span>
                      <div className="text-right">
                        <div className="font-mono font-bold text-gold-300">
                          {m.pairedAiTwinSlug}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Reports to {m.supervisorSlug}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: IMPORT OPEN-SOURCE .MD FILE STRUCTURE BUNDLE */}
        {step === '3_import' && (
          <div className="max-w-4xl w-full rounded-3xl border border-[#22262E] bg-[#14161A] p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase text-[#D4B475]">
                  TRACK 3 • OPEN-SOURCE .MD WORKSPACE BUNDLE IMPORTER
                </span>
                <h2 className="text-xl font-bold text-white">
                  Import <code className="font-mono text-gold-300">AGENTS.md</code>,{' '}
                  <code className="font-mono text-gold-300">projects.yaml</code> &amp;{' '}
                  <code className="font-mono text-gold-300">worklist/*</code>
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setStep('f1')}
                className="text-xs text-slate-400 hover:text-white"
              >
                ← Back to Tracks
              </button>
            </div>

            <div className="rounded-2xl border border-[#C6A664]/35 bg-[#162030] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="text-xs font-bold text-[#F5F0E6] flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#D4B475]" />
                  <span>
                    Loaded <code className="font-mono">/warden-demo-bundle.json</code> (
                    {bundleLoading ? 'scanning...' : `${bundleFileCount} workspace nodes`})
                  </span>
                </div>
                <p className="text-[11px] text-slate-300">
                  Includes NovaPulse (`novapulse.io`) active projects (`pulse-core`, `pulse-api`, `pulse-infra`, `pulse-seo`, `pulse-social`, `pulse-support`) and 13 agent blueprints across Tech, SEO/AEO, Digital Marketing, and Customer Support.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {bundlePreviewKeys.map((key) => (
                <div
                  key={key}
                  className="rounded-xl border border-[#22262E] bg-[#101216] px-3 py-2 text-xs font-mono text-gold-300 truncate"
                >
                  📄 {key}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={finishOnboarding}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-bold border border-[#D4B475] shadow-[0_2px_12px_rgba(198,166,100,0.25)] hover:brightness-110 px-6 py-3.5 text-xs transition cursor-pointer"
              >
                <span>Import Bundle &amp; Open Dashboard</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
