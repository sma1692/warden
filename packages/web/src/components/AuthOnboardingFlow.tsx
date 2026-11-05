import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Gamepad2,
  Globe,
  KeyRound,
  Layers,
  Lock,
  Mail,
  MessageSquare,
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
import {
  INITIAL_BACKLOG_DRAFTS,
  INITIAL_HUMAN_ROSTER,
  INITIAL_SOLO_AGENTS,
  type HumanTeamMember,
  type OnboardingBacklogDraft,
  type SuggestedAgentNode,
} from '../data/onboardingPresets';
import { authRequest, fetchDemoWorkspace, saveOnboarding, setToken, type AuthUser } from '../api/auth';
import { AsyncButton, ToastHost, useToasts, type ActionOutcome } from './AsyncButton';
import {
  authStepForPath,
  getPathname,
  navigateTo,
  onLocationChange,
  pathForAuthStep,
} from '../router';
import { StorageKeys, readStorage, writeStorage } from '../utils/storage';
import { LandingBottomNav, LandingInfoPage } from './LandingInfoPages';

export type OnboardingStepId =
  | 'loading'
  | 'landing'
  | 'architecture'
  | 'security'
  | 'docs'
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
  /** Live mode: form snapshot restored from the DB so refresh resumes field values. */
  initialForm?: Record<string, any> | null;
}

const PERSISTED_STEPS: OnboardingStepId[] = ['f1', '1a', '1b', '1c', '2a', '2b', '2c', '3_import'];


export const StrictOverseerCrest: React.FC<{
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}> = ({ className = '', size = 'lg' }) => {
  const imgClass = size === 'lg' ? 'h-24 w-24' : size === 'sm' ? 'h-6 w-6' : 'h-14 w-14';
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <div className="relative flex items-center justify-center rounded-2xl bg-gradient-to-b from-[#D4B475]/25 via-[#162030] to-[#0B121C] border border-[#C6A664]/40 p-2 shadow-2xl shadow-[#C6A664]/10 backdrop-blur-sm">
        <img
          src="/warden-logo.webp" decoding="async"
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


export const AuthOnboardingFlow: React.FC<AuthOnboardingFlowProps> = ({
  onComplete,
  mode = 'live',
  onSignedIn,
  initialDemoMode = true,
  initialStep = 'loading',
  initialForm = null,
}) => {
  const isLive = mode === 'live';
  // DB-restored snapshot (live resume only); gallery/demo keeps local presets.
  const savedForm: Record<string, any> = isLive ? initialForm ?? {} : {};
  const [demoMode, setDemoMode] = useState<boolean>(isLive ? false : initialDemoMode);
  // Live: the landing ".md Import" CTA signs in first, then a new user lands on this track.
  const [pendingTrack, setPendingTrack] = useState<OnboardingStepId | null>(null);
  const [signedIn, setSignedIn] = useState<boolean>(isLive && PERSISTED_STEPS.includes(initialStep));
  const [step, setStep] = useState<OnboardingStepId>(initialStep);
  const [persona, setPersona] = useState<ReturnUserPersona>('FIRST_TIME');
  // Explore-live-demo: S1 -> S2 (loading + Cloudflare deploy) -> S3 (company guide) -> Dashboard.
  const [lockedFullMode, setLockedFullMode] = useState<boolean>(
    () => Boolean(savedForm.chosenMode === 'full' || savedForm.mode === 'full')
  );
  const [f1Phase, setF1Phase] = useState<'s1' | 's2' | 's3' | 'tracks'>(() =>
    savedForm.chosenMode === 'full' || savedForm.mode === 'full' ? 'tracks' : 's1'
  );
  const [exploreBooting, setExploreBooting] = useState<boolean>(false);
  const [s2Progress, setS2Progress] = useState<number>(15);
  const [s2StatusIdx, setS2StatusIdx] = useState<number>(0);
  const [pendingExplore, setPendingExplore] = useState<boolean>(false);

  const S2_DEPLOY_MESSAGES = [
    'Provisioning isolated demo workspace & PostgreSQL state…',
    'Seeding initial sprint backlog & agent memory vectors…',
    'Compiling Tic-Tac-Toe Arena v1 production bundle…',
    'Packing @designer 8-bit sprite atlas & trophy SVGs…',
    'Running Wrangler deploy to Cloudflare Pages edge network…',
    'Propagating live HTTPS subdomain & edge asset routing…',
    'Waking up @warden, @cto, @cmo, and 13 specialist agents…',
    'Finalizing studio command center — almost ready…',
  ];

  // Live: each step owns a URL (/login, /otp, /onboarding/f1 …) so Back, Forward,
  // refresh, and deep links work. Gallery mode is a dev screen browser: no URL sync.
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  const urlSyncedRef = useRef(false);
  useEffect(() => {
    if (!isLive) return;
    const target = pathForAuthStep(step);
    if (getPathname() === target) {
      urlSyncedRef.current = true;
      return;
    }
    // First sync replaces (mount / deep link / loader); later steps push.
    navigateTo(target, { replace: !urlSyncedRef.current });
    urlSyncedRef.current = true;
  }, [isLive, step]);
  useEffect(() => {
    if (!isLive) return;
    return onLocationChange((pathname) => {
      const next = authStepForPath(pathname);
      if (next) {
        setStep((prev) => (prev === next ? prev : (next as OnboardingStepId)));
      } else {
        // Foreign path reached via Back/Forward: heal the URL back to this step.
        navigateTo(pathForAuthStep(stepRef.current), { replace: true });
      }
    });
  }, [isLive]);

  // Step 0: Loader state
  const [loadProgress, setLoadProgress] = useState<number>(0);

  // Step 2 & 2.1: Login & Email OTP state (Hardcoded test OTP 123123 in Demo Mode)
  const TEST_OTP_CODE = '123123';
  const TEST_OTP_DIGITS = ['1', '2', '3', '1', '2', '3'];
  const [emailAddress, setEmailAddress] = useState<string>('');
  const [otpDigits, setOtpDigits] = useState<string[]>(['1', '2', '3', '1', '2', '3']);
  const [authError, setAuthError] = useState<string | null>(null);
  // Inline authError is for client-side validation; API failures toast.
  const { toasts, notifyError, dismiss: dismissToast } = useToasts();
  // Product Mode sends a real code via /api/auth/email/*; Demo Mode keeps the 123123 preset.
  const liveOtp = !demoMode;
  // Button spinners are owned by AsyncButton while each API call settles.
  // Provisioning swaps the OTP form for a full loader panel while the
  // server-side demo provision (including the Cloudflare deploy) finishes.
  const [provisioning, setProvisioning] = useState<boolean>(false);
  const [provisionMsgIdx, setProvisionMsgIdx] = useState<number>(0);
  const [resendAt, setResendAt] = useState<number>(0);
  const [nowTick, setNowTick] = useState<number>(Date.now());
  const resendInSec = Math.max(0, Math.ceil((resendAt - nowTick) / 1000));

  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [resendAt]);

  useEffect(() => {
    if (!provisioning) return;
    setProvisionMsgIdx(0);
    const id = window.setInterval(() => {
      setProvisionMsgIdx((prev) => (prev + 1) % S2_DEPLOY_MESSAGES.length);
    }, 2200);
    return () => window.clearInterval(id);
  }, [provisioning]);

  // Track 1 state — live product starts blank so founders enter their own
  // company; gallery/demo keeps the NovaPulse preset for the sandbox tour.
  const [companyName, setCompanyName] = useState<string>(
    isLive ? String(savedForm.companyName ?? '') : 'NovaPulse (novapulse.io)'
  );
  const [companyBrief, setCompanyBrief] = useState<string>(
    isLive
      ? String(savedForm.companyBrief ?? '')
      : 'AI-Powered Commerce, SEO/AEO Growth, Digital Marketing & Customer Support SaaS company (Year 0 Solo Founder Alex Rivera launching pulse-core, pulse-api, pulse-seo, pulse-social, and pulse-support).'
  );
  const [enabledVerticals, setEnabledVerticals] = useState<
    Record<'TECH' | 'SEO_AEO' | 'SOCIAL', boolean>
  >({
    TECH: isLive ? Boolean(savedForm.enabledVerticals?.TECH ?? true) : true,
    SEO_AEO: isLive ? Boolean(savedForm.enabledVerticals?.SEO_AEO ?? true) : true,
    SOCIAL: isLive ? Boolean(savedForm.enabledVerticals?.SOCIAL ?? true) : true,
  });
  const [soloAgents, setSoloAgents] = useState<SuggestedAgentNode[]>(
    isLive && Array.isArray(savedForm.soloAgents) && savedForm.soloAgents.length > 0
      ? (savedForm.soloAgents as SuggestedAgentNode[])
      : INITIAL_SOLO_AGENTS
  );
  const [showCustomCreatorForSlug, setShowCustomCreatorForSlug] = useState<string | null>(
    null
  );
  const [customSlug, setCustomSlug] = useState<string>('@custom_specialist');
  const [customTitle, setCustomTitle] = useState<string>('Custom Domain Specialist');
  const [customVertical, setCustomVertical] = useState<'TECH' | 'SEO_AEO' | 'SOCIAL'>(
    'TECH'
  );
  const [customSupervisor, setCustomSupervisor] = useState<string>('@cto');

  // Track 2 state — live product starts blank; gallery/demo keeps presets.
  const [teamWebsite, setTeamWebsite] = useState<string>(
    isLive ? String(savedForm.teamWebsite ?? '') : 'https://novapulse.io'
  );
  const [teamRepos, setTeamRepos] = useState<string>(
    isLive
      ? String(savedForm.teamRepos ?? '')
      : 'pulse-core, pulse-api, pulse-infra, pulse-seo, pulse-social, pulse-support'
  );
  const [teamSocials, setTeamSocials] = useState<string>(
    isLive
      ? String(savedForm.teamSocials ?? '')
      : 'x.com/novapulse_ai, linkedin.com/company/novapulse, youtube.com/@novapulse'
  );
  const [humanRoster, setHumanRoster] = useState<HumanTeamMember[]>(
    isLive
      ? Array.isArray(savedForm.humanRoster)
        ? (savedForm.humanRoster as HumanTeamMember[])
        : []
      : INITIAL_HUMAN_ROSTER
  );
  const [newHumanName, setNewHumanName] = useState<string>('');
  const [newHumanRole, setNewHumanRole] = useState<string>('');
  const [newHumanFocus, setNewHumanFocus] = useState<string>('');
  const [newHumanVertical, setNewHumanVertical] = useState<'TECH' | 'SEO_AEO' | 'SOCIAL'>(
    'TECH'
  );

  // Code connection: paste the repo URL agents should work with.
  const [repoUrl, setRepoUrl] = useState<string>(
    isLive ? String(savedForm.repoUrl ?? '') : ''
  );

  // Shared 1C / 2C Backlog state
  const [backlogDrafts, setBacklogDrafts] = useState<OnboardingBacklogDraft[]>(
    isLive && Array.isArray(savedForm.backlogDrafts) && savedForm.backlogDrafts.length > 0
      ? (savedForm.backlogDrafts as OnboardingBacklogDraft[])
      : INITIAL_BACKLOG_DRAFTS
  );

  // Track 3 (.md Bundle Import + LLM chat import) state
  const [importSource, setImportSource] = useState<'warden' | 'chatgpt' | 'claude' | 'paste'>(
    isLive && typeof savedForm.importSource === 'string' &&
    ['warden', 'chatgpt', 'claude', 'paste'].includes(savedForm.importSource)
      ? (savedForm.importSource as 'warden' | 'chatgpt' | 'claude' | 'paste')
      : 'warden'
  );
  const [pastedContext, setPastedContext] = useState<string>(
    isLive ? String(savedForm.pastedContext ?? '') : ''
  );
  const [contextFileName, setContextFileName] = useState<string | null>(null);
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

  // Live: snapshot the whole form so every step lands in Postgres, debounced.
  const formSnapshot = useMemo(
    () => ({
      companyName,
      companyBrief,
      enabledVerticals,
      soloAgents,
      teamWebsite,
      teamRepos,
      teamSocials,
      humanRoster,
      backlogDrafts,
      importSource,
      pastedContext: pastedContext.slice(0, 20000),
      repoUrl,
      ...(lockedFullMode ? { mode: 'full', chosenMode: 'full', demo: false } : {}),
    }),
    [
      companyName,
      companyBrief,
      enabledVerticals,
      soloAgents,
      teamWebsite,
      teamRepos,
      teamSocials,
      humanRoster,
      backlogDrafts,
      importSource,
      pastedContext,
      repoUrl,
      lockedFullMode,
    ]
  );

  // Live: save step + form snapshot server-side so a return visit resumes
  // on the same step with every field intact.
  useEffect(() => {
    if (!isLive || !signedIn || !PERSISTED_STEPS.includes(step)) return;
    const id = window.setTimeout(() => {
      void saveOnboarding({ step, form: formSnapshot });
    }, 800);
    return () => window.clearTimeout(id);
  }, [isLive, signedIn, step, formSnapshot]);

  // Gallery: persist mid-onboarding steps to localStorage for Return User simulation
  useEffect(() => {
    if (isLive) return;
    if (['1a', '1b', '1c', '2a', '2b', '2c', '3_import'].includes(step)) {
      writeStorage(StorageKeys.onboardingStep, step);
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

  const isEmailValid = useMemo(
    () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress.trim()),
    [emailAddress]
  );

  const routeAfterOtpVerification = (user?: AuthUser) => {
    setAuthError(null);
    if (user) {
      const { status, step: savedStep, form: userForm } = user.onboarding;
      if (userForm && (userForm.chosenMode === 'full' || userForm.mode === 'full')) {
        setLockedFullMode(true);
        setF1Phase('tracks');
      }
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
        (readStorage(StorageKeys.onboardingStep) as OnboardingStepId) || '1b';
      setStep(saved);
      return;
    }
    setStep('f1');
  };

  const postAuth = async (path: string, body: Record<string, string>) => {
    const { ok, data } = await authRequest(`email/${path}`, { method: 'POST', body });
    return { ok, data };
  };

  const sendLiveOtp = async (): Promise<{ ok: boolean; error?: string }> => {
    const { ok, data } = await postAuth('request', {
      email: emailAddress.trim().toLowerCase(),
    });
    if (!ok) {
      if (data.retry_after_sec) setResendAt(Date.now() + data.retry_after_sec * 1000);
      return { ok: false, error: data.error || 'Could not send the code.' };
    }
    setResendAt(Date.now() + (data.resend_in_sec ?? 30) * 1000);
    setNowTick(Date.now());
    return { ok: true };
  };

  const handleProceedToOtp = async (): Promise<ActionOutcome> => {
    if (!isEmailValid) {
      setAuthError('Enter a valid email address.');
      return;
    }
    setAuthError(null);
    if (liveOtp) {
      const sent = await sendLiveOtp();
      if (!sent.ok) return sent;
      setOtpDigits(['', '', '', '', '', '']);
    } else {
      setOtpDigits([...TEST_OTP_DIGITS]);
    }
    setStep('otp');
  };

  const handleResendOtp = async (): Promise<ActionOutcome> => {
    setAuthError(null);
    if (!isEmailValid) {
      setAuthError('Enter a valid email address.');
      return;
    }
    const sent = await sendLiveOtp();
    if (!sent.ok) return sent;
    setOtpDigits(['', '', '', '', '', '']);
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

  // Waits for the server-side provision to land the workspace row (the
  // initial Cloudflare deploy takes ~15-20s). Always resolves: on timeout the
  // dashboard opens anyway and shows the workspace once it lands.
  const waitForDemoWorkspace = async () => {
    const deadline = Date.now() + 120_000;
    for (;;) {
      const ws = await fetchDemoWorkspace();
      if (ws) return;
      if (Date.now() >= deadline) return;
      await new Promise((r) => setTimeout(r, 2000));
    }
  };

  const completeSignIn = async (data: { token: string; user: AuthUser }) => {
    setToken(data.token);
    // DEMO SHORTCUT (deadline): skip onboarding tracks — every live sign-in
    // lands straight in the demo dashboard. Remove after judging.
    if (isLive && data.user.onboarding.status !== 'COMPLETE') {
      // Loader first: the PATCH returns fast (provisioning continues
      // server-side), then poll until the workspace is ready.
      setProvisioning(true);
      try {
        const saved = await saveOnboarding({
          status: 'COMPLETE',
          form: { demo: true, mode: 'demo', chosenMode: 'demo', exploreDemo: true },
        });
        if (!saved) {
          notifyError('Signed in, but demo setup could not be saved. Please retry.');
          return;
        }
        await waitForDemoWorkspace();
        setSignedIn(true);
        onSignedIn?.(saved);
        routeAfterOtpVerification(saved);
      } finally {
        setProvisioning(false);
      }
      return;
    }
    if (isLive) {
      setSignedIn(true);
      onSignedIn?.(data.user);
    }
    routeAfterOtpVerification(data.user);
  };

  const handleVerifyOtp = async (): Promise<ActionOutcome> => {
    const code = otpDigits.join('');
    if (liveOtp) {
      if (code.length !== 6) {
        setAuthError('Enter the 6-digit code from your email.');
        return;
      }
      const { ok, data } = await postAuth('verify', {
        email: emailAddress.trim().toLowerCase(),
        code,
      });
      if (!ok) {
        const left = typeof data.attempts_left === 'number' && data.attempts_left > 0 ? ` ${data.attempts_left} attempts left.` : '';
        return { ok: false, error: `${data.error || 'Verification failed.'}${left}` };
      }
      await completeSignIn(data);
      return;
    }
    if (code !== TEST_OTP_CODE) {
      setAuthError('Invalid OTP. Use test OTP 123123 while in demo mode.');
      return;
    }
    routeAfterOtpVerification();
  };

  const finishOnboarding = async (): Promise<ActionOutcome> => {
    if (isLive) {
      const saved = await saveOnboarding({ status: 'COMPLETE', form: formSnapshot });
      if (!saved) {
        return { ok: false, error: 'Could not save your progress. Please try again.' };
      }
    }
    onComplete();
  };

  // Explore-live-demo: S1 -> S2 (at least ~1.2s while backend provisions + deploys to Cloudflare) -> S3.
  const handleExploreDemo = async () => {
    if (exploreBooting) return;
    setF1Phase('s2');
    setExploreBooting(true);
    setS2Progress(18);
    setS2StatusIdx(0);
    const progressTimer = window.setInterval(() => {
      setS2Progress((prev) => {
        if (prev < 65) return prev + 6;
        if (prev < 85) return prev + 2;
        if (prev < 96) return prev + 1;
        return prev;
      });
    }, 350);
    const statusTimer = window.setInterval(() => {
      setS2StatusIdx((prev) => (prev + 1) % S2_DEPLOY_MESSAGES.length);
    }, 1600);
    try {
      const minWait = new Promise((r) => setTimeout(r, 1250));
      if (isLive) {
        const [saved] = await Promise.all([
          saveOnboarding({
            status: 'COMPLETE',
            form: { ...formSnapshot, demo: true, mode: 'demo', exploreDemo: true },
          }),
          minWait,
        ]);
        // The demo runs on seed data, so enter anyway — but say so.
        if (!saved) notifyError('Demo started, but progress could not be saved to the server.');
      } else {
        await minWait;
      }
      setS2Progress(100);
    } finally {
      window.clearInterval(progressTimer);
      window.clearInterval(statusTimer);
      setExploreBooting(false);
      setF1Phase('s3');
    }
  };

  const handleJoinAlpha = async (): Promise<ActionOutcome> => {
    setLockedFullMode(true);
    if (isLive) {
      void saveOnboarding({
        status: 'IN_PROGRESS',
        step: 'f1',
        form: { ...formSnapshot, mode: 'full', chosenMode: 'full', demo: false },
      });
    }
    setF1Phase('tracks');
  };

  // Landing "explore" goes through login first, then auto-freezes onto the demo path.
  useEffect(() => {
    if (step === 'f1' && pendingExplore && !exploreBooting) {
      setPendingExplore(false);
      void handleExploreDemo();
    }
  }, [step, pendingExplore, exploreBooting]);

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
                  src="/warden-logo.webp" decoding="async"
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
      <div
        className={
          step === 'landing' ||
          step === 'architecture' ||
          step === 'security' ||
          step === 'docs' ||
          (step === 'f1' && f1Phase !== 'tracks')
            ? 'flex-1 flex flex-col'
            : 'flex-1 flex items-center justify-center p-4 sm:p-6'
        }
      >
        {/* STEP 0: LOADING SCREEN */}
        {step === 'loading' && (
          <div className="flex flex-col items-center justify-center gap-6">
            <div className="relative flex items-center justify-center">
              <div className="absolute -inset-6 rounded-full bg-[#C6A664]/15 blur-3xl pointer-events-none" />
              <div className="relative h-56 w-56 sm:h-72 sm:w-72 rounded-3xl bg-gradient-to-b from-[#D4B475]/20 via-[#162030] to-[#0B121C] border border-[#C6A664]/45 p-3 shadow-2xl shadow-[#C6A664]/20 flex items-center justify-center overflow-hidden">
                <img
                  src="/warden-logo.webp" decoding="async"
                  alt="WARDEN Strict Overseer Logo"
                  className="h-full w-full object-cover rounded-2xl"
                />
              </div>
            </div>
            <div className="inline-flex items-center gap-2.5 rounded-2xl border border-[#C6A664]/45 bg-[#14161A]/95 px-4 py-2 shadow-[0_0_24px_rgba(198,166,100,0.16)]">
              <span className="h-2.5 w-2.5 rounded-full bg-[#D4B475] shadow-[0_0_8px_#D4B475]" />
              <span className="text-lg sm:text-xl font-black uppercase tracking-[0.16em] text-transparent bg-clip-text bg-gradient-to-r from-[#F5F0E6] via-[#D4B475] to-[#C6A664]">
                Warden Automatons
              </span>
            </div>
            <div className="w-56 sm:w-72 h-1.5 rounded-full bg-[#14161A] overflow-hidden border border-[#C6A664]/25 shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] transition-all duration-300"
                style={{ width: `${loadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* STEP 1: LANDING PAGE (2 Viewports on Mobile, 1 Split Viewport on Desktop) */}
        {step === 'landing' && (
          <div className="relative w-full lg:h-dvh lg:overflow-hidden flex flex-col justify-between max-w-md lg:max-w-7xl mx-auto">
            {/* Subtle Ambient Sovereign Glow (Desktop) */}
            <div className="hidden lg:block pointer-events-none absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-[#C6A664]/[0.06] blur-3xl" />
            <div className="hidden lg:block pointer-events-none absolute bottom-12 right-10 h-96 w-96 rounded-full bg-[#162030]/60 blur-3xl" />

            <div className="relative flex-1 flex flex-col lg:grid lg:grid-cols-12 lg:gap-10 xl:gap-14 lg:items-center lg:px-10 xl:px-12 lg:py-6 min-h-0">
              {/* VIEWPORT 1 (Mobile) / LEFT HERO COLUMN (Desktop) */}
              <section className="min-h-dvh lg:min-h-0 lg:h-full w-full px-5 py-6 lg:p-0 flex flex-col justify-between lg:justify-center lg:items-start lg:col-span-5 lg:gap-7">
                {/* Top Half on Mobile / Hero Emblem on Desktop */}
                <div className="h-[48dvh] lg:h-auto w-full flex items-center justify-center lg:justify-start">
                  <div className="relative group">
                    <div className="hidden lg:block absolute -inset-4 rounded-3xl bg-[#C6A664]/15 blur-2xl opacity-75 pointer-events-none" />
                    <div className="relative aspect-square h-full lg:h-60 xl:h-68 max-h-full rounded-3xl bg-gradient-to-b from-[#D4B475]/20 via-[#162030] to-[#0B121C] border border-[#C6A664]/45 p-3 shadow-2xl shadow-[#C6A664]/15 flex items-center justify-center overflow-hidden">
                      <img
                        src="/warden-logo.webp" decoding="async"
                        alt="WARDEN Strict Overseer Logo"
                        className="h-full w-full object-cover rounded-2xl"
                      />
                    </div>
                  </div>
                </div>

                {/* Bottom Half: Text + Subtext + Start Button */}
                <div className="flex-1 lg:flex-initial flex flex-col items-center lg:items-start justify-evenly lg:justify-start text-center lg:text-left pt-4 lg:pt-0 pb-2 lg:pb-0 gap-4 lg:gap-6">
                  <div className="space-y-3">
                    <div className="inline-flex items-center gap-2.5 rounded-2xl border border-[#C6A664]/45 bg-[#14161A]/95 px-4 py-2 shadow-[0_0_24px_rgba(198,166,100,0.16)]">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#D4B475] shadow-[0_0_8px_#D4B475]" />
                      <span className="text-lg sm:text-xl xl:text-2xl font-black uppercase tracking-[0.16em] text-transparent bg-clip-text bg-gradient-to-r from-[#F5F0E6] via-[#D4B475] to-[#C6A664]">
                        Warden Automatons
                      </span>
                    </div>
                    <h1 className="text-xl sm:text-2xl xl:text-3xl font-extrabold tracking-tight text-white leading-snug">
                      Your Company Brain.
                      <span className="block mt-1 text-transparent bg-clip-text bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#F5F0E6]">
                        Copilot Agents for Every Employee.
                      </span>
                    </h1>
                    <p className="text-xs sm:text-sm lg:text-base text-slate-300 max-w-xs sm:max-w-md mx-auto lg:mx-0 leading-relaxed">
                      One persistent brain that pairs your team with autonomous agents across engineering, growth, and ops at a fraction of the token cost.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setStep('login')}
                    className="w-full max-w-xs inline-flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-black tracking-widest uppercase border border-[#D4B475] shadow-[0_6px_28px_rgba(198,166,100,0.32)] hover:brightness-110 px-8 py-4 text-sm sm:text-base transition cursor-pointer"
                  >
                    <span>Start</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </section>

              {/* VIEWPORT 2 (Mobile < lg): 3 Alternating Rows + Bottom Nav */}
              <section className="lg:hidden min-h-dvh w-full px-4 pt-4 pb-4 flex flex-col justify-between gap-3">
                <div className="flex-1 grid grid-rows-3 gap-3 items-center">
                  {/* Row 1: Card 1 Text & Subtext -> Image */}
                  <div className="grid grid-cols-2 gap-3 items-center">
                    <div className="rounded-2xl border border-[#C6A664]/35 bg-[#14161A]/95 p-3.5 sm:p-4 flex flex-col justify-center space-y-1.5 h-full">
                      <span className="text-[11px] font-mono uppercase tracking-wider text-[#D4B475]">
                        Company Brain
                      </span>
                      <h3 className="text-base sm:text-lg font-black text-white leading-snug">
                        Shared memory, 90%* lower token burn
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                        One brain holds your repos, backlogs, and decisions. Tiered context firewalls slash token costs so you never pay to re-explain.
                      </p>
                    </div>
                    <div className="relative flex items-center justify-center">
                      <div className="pointer-events-none absolute h-28 w-28 rounded-full bg-[#C6A664]/15 blur-2xl" />
                      <img
                        src="/landing-brain-tokens.webp" decoding="async"
                        alt="Company Brain and Token Firewall"
                        className="relative h-36 w-36 sm:h-40 sm:w-40 object-contain mix-blend-lighten drop-shadow-[0_0_24px_rgba(198,166,100,0.2)]"
                      />
                    </div>
                  </div>

                  {/* Row 2: Image -> Card 2 Text & Subtext */}
                  <div className="grid grid-cols-2 gap-3 items-center">
                    <div className="relative flex items-center justify-center">
                      <div className="pointer-events-none absolute h-28 w-28 rounded-full bg-[#C6A664]/15 blur-2xl" />
                      <img
                        src="/landing-ephemeral-agents.webp" decoding="async"
                        alt="Ephemeral Agentic Workforce"
                        className="relative h-36 w-36 sm:h-40 sm:w-40 object-contain mix-blend-lighten drop-shadow-[0_0_24px_rgba(198,166,100,0.2)]"
                      />
                    </div>
                    <div className="rounded-2xl border border-[#C6A664]/35 bg-[#162030]/95 p-3.5 sm:p-4 flex flex-col justify-center space-y-1.5 h-full">
                      <span className="text-[11px] font-mono uppercase tracking-wider text-[#D4B475]">
                        Transient Workforce
                      </span>
                      <h3 className="text-base sm:text-lg font-black text-white leading-snug">
                        Ephemeral agents at a button click
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                        Spin up on-demand agentic employees for a single mission. They ship the patch or campaign and dissolve—zero idle overhead.
                      </p>
                    </div>
                  </div>

                  {/* Row 3: Card 3 Text & Subtext -> Image */}
                  <div className="grid grid-cols-2 gap-3 items-center">
                    <div className="rounded-2xl border border-[#C6A664]/35 bg-[#14161A]/95 p-3.5 sm:p-4 flex flex-col justify-center space-y-1.5 h-full">
                      <span className="text-[11px] font-mono uppercase tracking-wider text-[#D4B475]">
                        Force Multiplier
                      </span>
                      <h3 className="text-base sm:text-lg font-black text-white leading-snug">
                        Augment every employee with an AI twin
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                        Pair your team with autonomous agents that crush busywork, clear ticket queues, and bring down operational drag.
                      </p>
                    </div>
                    <div className="relative flex items-center justify-center">
                      <div className="pointer-events-none absolute h-28 w-28 rounded-full bg-[#C6A664]/15 blur-2xl" />
                      <img
                        src="/landing-augmented-team.webp" decoding="async"
                        alt="Human Augmented with Autonomous Agent Twin"
                        className="relative h-36 w-36 sm:h-40 sm:w-40 object-contain mix-blend-lighten drop-shadow-[0_0_24px_rgba(198,166,100,0.2)]"
                      />
                    </div>
                  </div>
                </div>

                {/* Bottom Navigation (Mobile) */}
                <LandingBottomNav
                  activeTab="landing"
                  onSelectTab={(t) => setStep(t)}
                  variant="mobile"
                />
              </section>

              {/* RIGHT EDITORIAL ARCHITECTURE SHOWCASE (Desktop lg+) */}
              <section className="hidden lg:flex lg:col-span-7 flex-col justify-center h-full">
                <div className="rounded-3xl border border-[#C6A664]/25 bg-gradient-to-b from-[#14161A]/90 via-[#0E131B]/90 to-[#0B1017]/90 p-6 xl:p-7 shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-md space-y-5">
                  {/* Editorial Section Header */}
                  <div className="flex items-center justify-between border-b border-[#C6A664]/15 pb-3.5">
                    <div className="flex items-center gap-2.5">
                      <span className="h-2 w-2 rounded-full bg-[#D4B475]" />
                      <span className="text-[11px] font-mono uppercase tracking-[0.22em] text-[#D4B475] font-semibold">
                        System Architecture • Three Pillars
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-400">
                      PERSISTENT CONTEXT ENGINE
                    </span>
                  </div>

                  {/* Pillar 1 — Featured Wide Showcase */}
                  <div className="relative overflow-hidden rounded-2xl border border-[#C6A664]/35 bg-gradient-to-r from-[#14161A] via-[#131923] to-[#0B121C] p-6 xl:p-7 flex items-center justify-between gap-6">
                    <div className="pointer-events-none absolute -right-10 -top-10 h-52 w-52 rounded-full bg-[#C6A664]/15 blur-3xl" />
                    <div className="space-y-2.5 max-w-lg z-10">
                      <div className="inline-flex items-center gap-2.5">
                        <span className="rounded-md bg-[#C6A664]/15 border border-[#C6A664]/35 px-2.5 py-0.5 text-[11px] font-mono font-bold uppercase tracking-wider text-[#D4B475]">
                          Company Brain
                        </span>
                        <span className="text-xs font-mono text-[#D4B475]/80">
                          −90%* Token Burn
                        </span>
                      </div>
                      <h3 className="text-xl xl:text-2xl font-black text-white leading-snug">
                        Shared memory, 90%* lower token burn
                      </h3>
                      <p className="text-sm xl:text-[15px] text-slate-300 leading-relaxed">
                        One brain holds your repos, backlogs, and decisions. Tiered context firewalls slash token costs so you never pay to re-explain.
                      </p>
                    </div>
                    <div className="relative shrink-0 flex items-center justify-center">
                      <div className="pointer-events-none absolute inset-0 rounded-full bg-[#C6A664]/20 blur-2xl" />
                      <img
                        src="/landing-brain-tokens.webp" decoding="async" loading="lazy"
                        alt="Company Brain and Token Firewall"
                        className="relative h-36 w-36 xl:h-40 xl:w-40 object-contain mix-blend-lighten drop-shadow-[0_0_28px_rgba(212,180,117,0.28)]"
                      />
                    </div>
                  </div>

                  {/* Pillars 2 & 3 — Balanced Architectural Pair */}
                  <div className="grid grid-cols-2 gap-5">
                    {/* Pillar 2 */}
                    <div className="relative overflow-hidden rounded-2xl border border-[#C6A664]/30 bg-gradient-to-b from-[#162030]/90 to-[#0B121C]/95 p-5 xl:p-6 flex flex-col justify-between gap-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="space-y-1">
                          <span className="inline-block rounded-md bg-[#C6A664]/15 border border-[#C6A664]/35 px-2.5 py-0.5 text-[11px] font-mono font-bold uppercase tracking-wider text-[#D4B475]">
                            Transient Workforce
                          </span>
                          <div className="text-xs font-mono text-[#D4B475]/80">
                            Zero Idle Overhead
                          </div>
                        </div>
                        <img
                          src="/landing-ephemeral-agents.webp" decoding="async" loading="lazy"
                          alt="Ephemeral Agentic Workforce"
                          className="h-20 w-20 xl:h-24 xl:w-24 object-contain mix-blend-lighten drop-shadow-[0_0_22px_rgba(212,180,117,0.25)] shrink-0"
                        />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-lg xl:text-xl font-black text-white leading-snug">
                          Ephemeral agents at a button click
                        </h3>
                        <p className="text-sm text-slate-300 leading-relaxed">
                          Spin up on-demand agentic employees for a single mission. They ship the patch or campaign and dissolve—zero idle overhead.
                        </p>
                      </div>
                    </div>

                    {/* Pillar 3 */}
                    <div className="relative overflow-hidden rounded-2xl border border-[#C6A664]/30 bg-gradient-to-b from-[#14161A]/95 to-[#0B121C]/95 p-5 xl:p-6 flex flex-col justify-between gap-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="space-y-1">
                          <span className="inline-block rounded-md bg-[#C6A664]/15 border border-[#C6A664]/35 px-2.5 py-0.5 text-[11px] font-mono font-bold uppercase tracking-wider text-[#D4B475]">
                            Force Multiplier
                          </span>
                          <div className="text-xs font-mono text-[#D4B475]/80">
                            24/7 Parallel Execution
                          </div>
                        </div>
                        <img
                          src="/landing-augmented-team.webp" decoding="async" loading="lazy"
                          alt="Human Augmented with Autonomous Agent Twin"
                          className="h-20 w-20 xl:h-24 xl:w-24 object-contain mix-blend-lighten drop-shadow-[0_0_22px_rgba(212,180,117,0.25)] shrink-0"
                        />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-lg xl:text-xl font-black text-white leading-snug">
                          Augment every employee with an AI twin
                        </h3>
                        <p className="text-sm text-slate-300 leading-relaxed">
                          Pair your team with autonomous agents that crush busywork, clear ticket queues, and bring down operational drag.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            {/* Bottom Bar (Desktop) */}
            <LandingBottomNav
              activeTab="landing"
              onSelectTab={(t) => setStep(t)}
              variant="desktop"
            />
          </div>
        )}

        {/* PUBLIC LANDING INFO PAGES: ARCHITECTURE / SECURITY / DOCS */}
        {(step === 'architecture' || step === 'security' || step === 'docs') && (
          <LandingInfoPage
            tab={step}
            onSelectTab={(t) => setStep(t)}
            onStart={() => setStep('login')}
          />
        )}

        {/* STEP 2: LOGIN MODAL (Email OTP) */}
        {step === 'login' && (
          <div className="max-w-md w-full rounded-3xl border border-[#22262E] bg-[#14161A] p-6 sm:p-7 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-gold-400">
                  STEP 2 • PASSWORDLESS SIGN IN
                </span>
                <h2 className="text-lg font-bold text-white mt-0.5">
                  Sign in to Warden
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

            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <Mail className="h-3.5 w-3.5 text-[#D4B475]" />
                <span>Founder / Executive Email</span>
              </label>
              <div className="relative">
                <input
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={emailAddress}
                  onChange={(e) => setEmailAddress(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void handleProceedToOtp();
                    }
                  }}
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
                We will dispatch a 6-digit verification code to your email.
              </p>
            </div>

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

            <AsyncButton
              type="button"
              action={handleProceedToOtp}
              onError={notifyError}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-bold border border-[#D4B475] shadow-[0_2px_12px_rgba(198,166,100,0.25)] hover:brightness-110 py-3 text-xs transition cursor-pointer"
            >
              <span>Send 6-Digit Code via Email</span>
              <ArrowRight className="h-4 w-4" />
            </AsyncButton>
          </div>
        )}

        {/* STEP 2.1: OTP VERIFICATION SCREEN (Divergent Routing by ReturnUserPersona) */}
        {step === 'otp' && (
          provisioning ? (
            <div className="max-w-md w-full rounded-3xl border border-[#C6A664]/40 bg-[#101216] p-8 sm:p-10 text-center space-y-6 shadow-2xl" aria-busy="true">
              <div className="relative mx-auto flex h-28 w-28 items-center justify-center">
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full border-[3px] border-[#C6A664]/15 border-t-[#D4B475] border-r-[#C6A664] animate-spin"
                />
                <span
                  aria-hidden="true"
                  style={{ animationDirection: 'reverse', animationDuration: '2.2s' }}
                  className="absolute inset-2 rounded-full border-2 border-dashed border-[#D4B475]/35 animate-spin"
                />
                <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-b from-[#D4B475]/20 via-[#162030] to-[#0B121C] border border-[#C6A664]/45 p-2 shadow-xl">
                  <img
                    src="/warden-logo.webp" decoding="async"
                    alt="WARDEN Logo"
                    className="h-full w-full object-contain rounded-xl"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <h2 className="text-lg font-black text-white">
                  Setting up your live demo…
                </h2>
                <p className="text-xs font-mono text-[#D4B475] min-h-8">
                  {S2_DEPLOY_MESSAGES[provisionMsgIdx]}
                </p>
                <p className="text-[11px] text-slate-400">
                  Verified. Provisioning your workspace and deploying the live build — this takes about 20 seconds.
                </p>
              </div>
            </div>
          ) : (
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
                  {emailAddress}
                </span>
              </p>
              {liveOtp ? (
                <AsyncButton
                  type="button"
                  action={handleResendOtp}
                  onError={notifyError}
                  disabled={resendInSec > 0}
                  spinnerClassName="h-3 w-3"
                  className="inline-flex items-center gap-1 text-[11px] font-mono text-[#D4B475] hover:underline disabled:text-slate-500 disabled:no-underline cursor-pointer disabled:cursor-default"
                >
                  {resendInSec > 0 ? `Resend in ${resendInSec}s` : 'Resend code'}
                </AsyncButton>
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
                      // Route through the button so AsyncButton's pending
                      // guard blocks double submits from repeated Enter keys.
                      document.getElementById('otp-verify-btn')?.click();
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
                      readStorage(StorageKeys.onboardingStep) || '1b'
                    }) from localStorage.`
                  : '→ Completed onboarding detected: launches straight into the Command Center Dashboard.'}
              </p>
            </div>
            )}

            <AsyncButton
              type="button"
              id="otp-verify-btn"
              action={handleVerifyOtp}
              onError={notifyError}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-bold border border-[#D4B475] shadow-[0_2px_12px_rgba(198,166,100,0.25)] hover:brightness-110 py-3 text-xs transition cursor-pointer"
            >
              <KeyRound className="h-4 w-4" />
              <span>{liveOtp ? 'Verify Code & Continue' : 'Verify OTP (123123) & Continue'}</span>
            </AsyncButton>
          </div>
          )
        )}

        {/* STEP F1: S1 (Logo + Live Demo / Full Flow) -> S2 (Loading + Cloudflare Deploy) -> S3 (Company Guide) */}
        {step === 'f1' && (
          <>
            {/* S1: Large Logo & WARDEN Section + Catchy Free Live Demo Button + Smaller Full Flow Button */}
            {f1Phase === 's1' && (
              <div className="relative flex-1 w-full lg:h-dvh lg:overflow-hidden flex flex-col justify-between max-w-md lg:max-w-6xl mx-auto px-5 py-6 lg:px-10 lg:py-8">
                <div className="hidden lg:block pointer-events-none absolute -top-28 left-1/4 h-96 w-96 rounded-full bg-[#C6A664]/[0.07] blur-3xl" />
                <div className="hidden lg:block pointer-events-none absolute bottom-10 right-12 h-96 w-96 rounded-full bg-[#162030]/60 blur-3xl" />

                <div className="relative flex-1 flex flex-col lg:grid lg:grid-cols-12 lg:gap-12 lg:items-center min-h-0">
                  {/* Top Half on Mobile (~48dvh) / Left Column on Desktop: Logo + WARDEN Text */}
                  <div className="h-[46dvh] lg:h-auto w-full flex flex-col items-center justify-center lg:col-span-6 gap-5">
                    <div className="relative group flex items-center justify-center">
                      <div className="absolute -inset-5 rounded-3xl bg-[#C6A664]/15 blur-2xl opacity-80 pointer-events-none" />
                      <div className="relative aspect-square h-52 w-52 sm:h-64 sm:w-64 lg:h-80 lg:w-80 xl:h-96 xl:w-96 rounded-3xl bg-gradient-to-b from-[#D4B475]/20 via-[#162030] to-[#0B121C] border border-[#C6A664]/45 p-3 shadow-2xl shadow-[#C6A664]/15 flex items-center justify-center overflow-hidden">
                        <img
                          src="/warden-logo.webp" decoding="async"
                          alt="WARDEN Strict Overseer Logo"
                          className="h-full w-full object-cover rounded-2xl"
                        />
                      </div>
                    </div>
                    <div className="text-center space-y-1.5">
                      <span className="block font-sans text-3xl sm:text-4xl lg:text-5xl font-black tracking-[0.24em] text-white">
                        WARDEN
                      </span>
                      <span className="block text-xs sm:text-sm font-mono uppercase tracking-[0.22em] text-[#D4B475]">
                        ONE SHARED BRAIN • EVERY WING
                      </span>
                    </div>
                  </div>

                  {/* Bottom Half on Mobile / Right Column on Desktop: Primary Live Demo Button + Secondary Full Flow Button */}
                  <div className="flex-1 lg:flex-initial w-full flex flex-col items-center justify-center lg:col-span-6 gap-5">
                    <div className="w-full max-w-lg lg:max-w-xl rounded-3xl border border-[#C6A664]/40 bg-[#14161A]/95 p-7 sm:p-10 shadow-2xl space-y-7 text-center">
                      <div className="space-y-3">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#C6A664]/35 bg-[#C6A664]/15 px-3 py-0.5 text-[10px] font-mono uppercase tracking-wider text-[#D4B475]">
                          <Sparkles className="h-3 w-3" />
                          <span>LIVE SIMULATION • 13 AGENTS MID-SPRINT</span>
                        </span>
                        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white leading-tight">
                          Step Into a Company That Runs Itself
                        </h1>
                        <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
                          Three humans and thirteen AI agents are mid-sprint inside an indie gaming studio. A live build is running and four critical decisions are waiting on your desk.
                        </p>
                      </div>

                      {/* Primary Catchy Live Demo CTA */}
                      <AsyncButton
                        type="button"
                        action={handleExploreDemo}
                        onError={notifyError}
                        className="w-full rounded-2xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] border border-[#D4B475] shadow-[0_8px_30px_rgba(198,166,100,0.32)] hover:brightness-110 px-6 py-4 transition cursor-pointer flex flex-col items-center justify-center gap-1"
                      >
                        <span className="inline-flex items-center gap-2 text-sm sm:text-base font-black tracking-wider uppercase">
                          <Sparkles className="h-5 w-5" />
                          <span>Enter the Live War Room</span>
                          <ArrowRight className="h-4 w-4" />
                        </span>
                        <span className="text-[11px] font-mono font-semibold text-[#0B121C]/80">
                          Take command as CEO • Instant live environment
                        </span>
                      </AsyncButton>

                      {/* Smaller Secondary Button Underneath: Alpha / Community Full Onboarding Flow */}
                      <div className="pt-1">
                        <AsyncButton
                          type="button"
                          action={handleJoinAlpha}
                          onError={notifyError}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#2D3440] bg-[#101216] hover:border-[#C6A664]/50 hover:text-[#D4B475] px-4 py-2.5 text-xs font-semibold text-slate-300 transition cursor-pointer"
                        >
                          <span>Join Alpha Community — Onboard My Own Company →</span>
                        </AsyncButton>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* S2: Loading Screen (>= 1.2s while provisioning & deploying to Cloudflare subdomain) */}
            {(f1Phase === 's2' || exploreBooting) && (
              <div className="flex-1 flex flex-col items-center justify-center p-6">
                <div className="max-w-md w-full rounded-3xl border border-[#C6A664]/40 bg-[#101216] p-8 sm:p-10 text-center space-y-6 shadow-2xl">
                  <div className="relative mx-auto flex h-28 w-28 items-center justify-center">
                    {/* Outer glowing circular loader ring */}
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full border-[3px] border-[#C6A664]/15 border-t-[#D4B475] border-r-[#C6A664] animate-spin"
                    />
                    {/* Inner counter-rotating dashed circle loader */}
                    <span
                      aria-hidden="true"
                      style={{ animationDirection: 'reverse', animationDuration: '2.2s' }}
                      className="absolute inset-2 rounded-full border-2 border-dashed border-[#D4B475]/35 animate-spin"
                    />
                    <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-b from-[#D4B475]/20 via-[#162030] to-[#0B121C] border border-[#C6A664]/45 p-2 shadow-xl">
                      <img
                        src="/warden-logo.webp" decoding="async"
                        alt="WARDEN Logo"
                        className="h-full w-full object-contain rounded-xl"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <span className="inline-flex items-center gap-2 rounded-full border border-[#C6A664]/35 bg-[#C6A664]/15 px-3 py-1 text-[10px] font-mono uppercase tracking-widest text-[#D4B475]">
                      <span className="inline-block h-3 w-3 rounded-full border-2 border-[#D4B475]/30 border-t-[#D4B475] animate-spin shrink-0" />
                      <span>Deploying to Cloudflare Edge • {s2Progress}%</span>
                    </span>
                    <h1 className="text-xl sm:text-2xl font-black text-white">
                      Spinning up your live studio…
                    </h1>
                    <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                      Deploying v1 of <strong className="text-slate-200">Tic-Tac-Toe Arena</strong> to your unique subdomain and briefing your AI workforce.
                    </p>
                  </div>
                  <div className="space-y-3.5">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2.5 rounded-full bg-[#14161A] overflow-hidden border border-[#C6A664]/30">
                        <div
                          className="h-full bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] transition-all duration-300 animate-pulse"
                          style={{ width: `${s2Progress}%` }}
                        />
                      </div>
                      <span
                        aria-label="Deployment in progress"
                        className="inline-block h-5 w-5 rounded-full border-2 border-[#C6A664]/25 border-t-[#D4B475] border-r-[#C6A664] animate-spin shrink-0"
                      />
                    </div>
                    <div className="rounded-2xl border border-[#C6A664]/25 bg-[#14161A]/90 px-4 py-3 space-y-2">
                      <div className="flex items-center justify-center gap-2.5 text-xs font-mono font-semibold text-[#D4B475] min-h-[20px]">
                        <span className="inline-block h-4 w-4 rounded-full border-2 border-[#D4B475]/25 border-t-[#D4B475] animate-spin shrink-0" />
                        <span key={s2StatusIdx} className="transition-opacity duration-300">
                          {S2_DEPLOY_MESSAGES[s2StatusIdx]}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Setting up your isolated environment &amp; pushing live via Wrangler — hang tight, still working…
                      </p>
                      <div className="flex items-center justify-center gap-1.5 pt-0.5">
                        {S2_DEPLOY_MESSAGES.map((_, i) => (
                          <span
                            key={i}
                            className={`h-1.5 rounded-full transition-all duration-300 ${
                              i === s2StatusIdx
                                ? 'w-4 bg-[#D4B475]'
                                : i < s2StatusIdx
                                  ? 'w-1.5 bg-[#C6A664]/60'
                                  : 'w-1.5 bg-[#22262E]'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* S3: Indie Gaming Company Briefing & Guided Walkthrough Screen -> Begin Button */}
            {f1Phase === 's3' && !exploreBooting && (
              <div className="relative flex-1 w-full lg:h-dvh lg:overflow-hidden flex flex-col justify-between max-w-md lg:max-w-6xl mx-auto px-5 py-6 lg:px-10 lg:py-8">
                <div className="relative flex-1 flex flex-col lg:grid lg:grid-cols-12 lg:gap-10 lg:items-center min-h-0">
                  {/* Left / Top Column: Studio Identity & High-Level Workforce Structure */}
                  <div className="w-full lg:col-span-5 space-y-5">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#C6A664]/40 bg-[#C6A664]/15 px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-[#D4B475]">
                      <Gamepad2 className="h-3.5 w-3.5" />
                      <span>Welcome • Live Demo Briefing</span>
                    </div>
                    <div className="space-y-2">
                      <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white leading-tight">
                        You Run an Indie Gaming Studio
                      </h1>
                      <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                        Welcome! In this live demo, you are the CEO of the studio behind <strong className="text-[#D4B475]">Tic-Tac-Toe Arena</strong>. Your v1 build is already deployed and live.
                      </p>
                    </div>

                    {/* High-Level Company Structure Stats */}
                    <div className="grid grid-cols-3 gap-2.5">
                      <div className="rounded-2xl border border-[#C6A664]/35 bg-[#14161A] p-3.5 text-center">
                        <span className="block text-xl sm:text-2xl font-black text-[#D4B475]">3</span>
                        <span className="block text-[10px] font-mono uppercase tracking-wider text-slate-300 mt-0.5">
                          Real Employees
                        </span>
                        <span className="block text-[10px] text-slate-500 mt-0.5">
                          Tech, Growth, Ops
                        </span>
                      </div>
                      <div className="rounded-2xl border border-[#C6A664]/35 bg-[#14161A] p-3.5 text-center">
                        <span className="block text-xl sm:text-2xl font-black text-[#D4B475]">13</span>
                        <span className="block text-[10px] font-mono uppercase tracking-wider text-slate-300 mt-0.5">
                          AI Agents
                        </span>
                        <span className="block text-[10px] text-slate-500 mt-0.5">
                          Tech • SEO • Social
                        </span>
                      </div>
                      <div className="rounded-2xl border border-[#C6A664]/35 bg-[#14161A] p-3.5 text-center">
                        <span className="block text-xl sm:text-2xl font-black text-emerald-400">Live</span>
                        <span className="block text-[10px] font-mono uppercase tracking-wider text-slate-300 mt-0.5">
                          v1 Deployed
                        </span>
                        <span className="block text-[10px] text-slate-500 mt-0.5">
                          Cloudflare Edge
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right / Bottom Column: Guided Process + Begin Button */}
                  <div className="w-full lg:col-span-7 mt-5 lg:mt-0">
                    <div className="rounded-3xl border border-[#C6A664]/40 bg-[#14161A]/95 p-5 sm:p-7 shadow-2xl space-y-5">
                      <div className="flex items-center justify-between border-b border-[#22262E] pb-3">
                        <span className="text-xs font-mono uppercase tracking-wider text-[#D4B475]">
                          THE WARDEN WORKFLOW
                        </span>
                        <span className="text-[11px] font-mono text-slate-400">
                          Powered by Meta
                        </span>
                      </div>

                      <div className="space-y-3.5">
                        <div className="flex items-start gap-3.5 rounded-2xl border border-[#22262E] bg-[#101216] p-3.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#C6A664]/20 border border-[#C6A664]/40 text-xs font-mono font-bold text-[#D4B475]">
                            1
                          </span>
                          <div className="space-y-0.5">
                            <h3 className="text-xs sm:text-sm font-bold text-white">
                              Employees Command Dedicated AI Agents
                            </h3>
                            <p className="text-[11px] sm:text-xs text-slate-400 leading-relaxed">
                              Your 3 human leads each direct specialized AI agents in parallel across code, growth, and ops.
                            </p>
                          </div>
                        </div>

                        <div className="flex items-start gap-3.5 rounded-2xl border border-[#22262E] bg-[#101216] p-3.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#C6A664]/20 border border-[#C6A664]/40 text-xs font-mono font-bold text-[#D4B475]">
                            2
                          </span>
                          <div className="space-y-0.5">
                            <h3 className="text-xs sm:text-sm font-bold text-white">
                              Meta-Powered Orchestration
                            </h3>
                            <p className="text-[11px] sm:text-xs text-slate-400 leading-relaxed">
                              Warden coordinates every agent using Meta models and brings only final 1-click approvals to your desk.
                            </p>
                          </div>
                        </div>

                        <div className="flex items-start gap-3.5 rounded-2xl border border-[#22262E] bg-[#101216] p-3.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#C6A664]/20 border border-[#C6A664]/40 text-xs font-mono font-bold text-[#D4B475]">
                            3
                          </span>
                          <div className="space-y-0.5">
                            <h3 className="text-xs sm:text-sm font-bold text-white">
                              One Shared Brain (90%* Lower Token Burn)
                            </h3>
                            <p className="text-[11px] sm:text-xs text-slate-400 leading-relaxed">
                              Every repo, spec, and decision lives in shared memory — zero context re-pasting.
                            </p>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={onComplete}
                        className="w-full inline-flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-black tracking-widest uppercase border border-[#D4B475] shadow-[0_6px_28px_rgba(198,166,100,0.32)] hover:brightness-110 py-4 text-sm sm:text-base transition cursor-pointer"
                      >
                        <span>Begin</span>
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Full Onboarding Track Selector (when user clicks "Join Alpha Community" on S1) */}
            {f1Phase === 'tracks' && !exploreBooting && (
              <div className="max-w-4xl w-full space-y-6">
                <div className="flex items-center justify-between">
                  {!lockedFullMode && savedForm.chosenMode !== 'full' && savedForm.mode !== 'full' ? (
                    <button
                      type="button"
                      onClick={() => setF1Phase('s1')}
                      className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white cursor-pointer"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      <span>Back</span>
                    </button>
                  ) : (
                    <div />
                  )}
                  <span className="rounded-full bg-gold-500/15 border border-gold-500/35 px-3 py-0.5 text-[10px] font-mono text-gold-300">
                    FULL ONBOARDING FLOW
                  </span>
                </div>

                <div className="text-center space-y-2">
                  <h1 className="text-2xl sm:text-3xl font-black text-white">
                    Tell Warden about your company
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-400 max-w-xl mx-auto">
                    Start from a founder brief, mirror your existing team, or import a markdown bundle.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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
          </>
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
                  placeholder="e.g. Acme (acme.com)"
                  className="w-full rounded-xl border border-[#2D3440] bg-[#101216] px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500"
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
                  placeholder="What does your company build? Which products, repos, and growth channels matter most?"
                  className="w-full rounded-xl border border-[#2D3440] bg-[#101216] p-3.5 text-xs text-slate-200 leading-relaxed placeholder:text-slate-500"
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

            <div className="rounded-2xl border border-[#22262E] bg-[#101216] p-4 space-y-3">
              <div className="flex items-center gap-2">
                <FolderGit2 className="h-4 w-4 text-gold-400" />
                <h3 className="text-xs font-bold text-white">
                  Connect code — how should agents edit your repos?
                </h3>
              </div>
              <input
                type="url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/you/your-repo (optional — add later)"
                className="w-full rounded-xl border border-[#2D3440] bg-[#14161A] px-3.5 py-2.5 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#C6A664]/60"
              />
              <p className="text-[11px] text-slate-500">
                Paste the repo URL agents should work with. For private folders the cloud cannot reach, run a small client agent on your machine:
              </p>
              <code className="block rounded-xl border border-[#22262E] bg-[#14161A] px-3.5 py-2.5 text-[11px] font-mono text-gold-300">
                npx @warden/runner link --workspace ~/your-project
              </code>
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
              <AsyncButton
                type="button"
                action={finishOnboarding}
                onError={notifyError}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-bold border border-[#D4B475] shadow-[0_2px_12px_rgba(198,166,100,0.25)] hover:brightness-110 px-6 py-3.5 text-xs transition cursor-pointer"
              >
                <span>Launch Command Center Dashboard</span>
                <ArrowRight className="h-4 w-4" />
              </AsyncButton>
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

              {/* Right 5 Cols: Visual Team + AI Twin Org Chart */}
              <div className="lg:col-span-5 rounded-2xl border border-[#22262E] bg-[#101216]/90 p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-[#22262E] pb-2">
                  <span className="text-xs font-bold text-slate-100">
                    Team + AI Twin Org Chart
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
                  IMPORT • WORKSPACE BUNDLE OR CHAT HISTORY
                </span>
                <h2 className="text-xl font-bold text-white">
                  Import <code className="font-mono text-gold-300">AGENTS.md</code>,{' '}
                  <code className="font-mono text-gold-300">projects.yaml</code> &amp;{' '}
                  <code className="font-mono text-gold-300">worklist/*</code>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Bring a Warden bundle, or export chats from ChatGPT / Claude and paste them below — Warden seeds company context and backlog drafts from it.
                </p>
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

            <div className="rounded-2xl border border-[#22262E] bg-[#101216] p-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 rounded-xl bg-[#14161A] border border-[#22262E] p-1">
                {(
                  [
                    { id: 'warden', label: 'Warden bundle' },
                    { id: 'chatgpt', label: 'ChatGPT export' },
                    { id: 'claude', label: 'Claude export' },
                    { id: 'paste', label: 'Paste text' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setImportSource(tab.id)}
                    className={`rounded-lg py-2 text-xs font-bold transition cursor-pointer ${
                      importSource === tab.id
                        ? 'bg-[#C6A664]/20 text-[#D4B475] border border-[#C6A664]/40'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {importSource === 'warden' && (
                <p className="text-xs text-slate-300 leading-relaxed">
                  Using the loaded <code className="font-mono text-gold-300">/warden-demo-bundle.json</code> preview above. Point Warden at your own bundle file to seed agents, projects, and backlog in one step.
                </p>
              )}
              {importSource === 'chatgpt' && (
                <ol className="text-xs text-slate-300 leading-relaxed space-y-1 list-decimal list-inside">
                  <li>Open ChatGPT → Settings → Data controls → Export data, and download the ZIP.</li>
                  <li>Unzip it and open <code className="font-mono text-gold-300">conversations.json</code>.</li>
                  <li>Copy the threads that describe your product and paste them below — Warden extracts company context and starter tasks.</li>
                </ol>
              )}
              {importSource === 'claude' && (
                <ol className="text-xs text-slate-300 leading-relaxed space-y-1 list-decimal list-inside">
                  <li>Open the Claude chat with your product context → Share / Export, or copy the full thread.</li>
                  <li>For bulk history, use Settings → Export data and unzip the archive.</li>
                  <li>Paste the most relevant conversations below — Warden seeds your workspace brief and backlog drafts.</li>
                </ol>
              )}
              {importSource === 'paste' && (
                <p className="text-xs text-slate-300 leading-relaxed">
                  Paste anything: PRDs, meeting notes, support threads. Warden turns it into company context and backlog drafts.
                </p>
              )}

              {importSource !== 'warden' && (
                <div className="space-y-2">
                  <textarea
                    value={pastedContext}
                    onChange={(e) => setPastedContext(e.target.value)}
                    placeholder="Paste exported chat or notes here…"
                    rows={5}
                    className="w-full rounded-xl border border-[#2D3440] bg-[#14161A] px-3.5 py-2.5 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#C6A664]/60"
                  />
                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 rounded-xl border border-[#22262E] bg-[#1D2128] hover:bg-[#22262E] px-3 py-2 text-xs font-semibold text-slate-200 transition cursor-pointer">
                      <Upload className="h-3.5 w-3.5 text-gold-400" />
                      <span>{contextFileName ?? 'Attach export file (.json / .md / .txt)'}</span>
                      <input
                        type="file"
                        accept=".json,.md,.txt,.zip"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          setContextFileName(file.name);
                          if (file.size > 2_000_000) return;
                          void file.text().then((text) => {
                            setPastedContext((prev) =>
                              prev ? `${prev}\n\n--- ${file.name} ---\n${text.slice(0, 20000)}` : text.slice(0, 20000)
                            );
                          });
                        }}
                      />
                    </label>
                    {pastedContext.trim() && (
                      <span className="text-[11px] font-mono text-emerald-300">
                        {pastedContext.trim().length.toLocaleString()} chars ready
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <AsyncButton
                type="button"
                action={finishOnboarding}
                onError={notifyError}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#D4B475] via-[#C6A664] to-[#A88948] text-[#0B121C] font-bold border border-[#D4B475] shadow-[0_2px_12px_rgba(198,166,100,0.25)] hover:brightness-110 px-6 py-3.5 text-xs transition cursor-pointer"
              >
                <span>Import &amp; Open Dashboard</span>
                <ArrowRight className="h-4 w-4" />
              </AsyncButton>
            </div>
          </div>
        )}
      </div>
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};
