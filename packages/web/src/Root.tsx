import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import type { OnboardingStepId } from './components/AuthOnboardingFlow';
import { apiClient } from './api/client';

// Route-split: signed-out visitors never download the dashboard and vice versa.
const App = lazy(() => import('./App'));
const AuthOnboardingFlow = lazy(() =>
  import('./components/AuthOnboardingFlow').then((m) => ({ default: m.AuthOnboardingFlow }))
);

const RouteFallback: React.FC = () => <div className="h-screen bg-[#090A0C]" aria-busy="true" />;
import { fetchMe, onUnauthorized, signOut, type AuthUser } from './api/auth';
import {
  appTabForPath,
  authStepForPath,
  getPathname,
  navigateTo,
  pathForAppTab,
  pathForAuthStep,
} from './router';

type Session =
  | { state: 'checking' }
  | { state: 'signed_out' }
  | { state: 'onboarding'; step: OnboardingStepId; form: Record<string, any> | null }
  | { state: 'ready'; initialTab: string };

/**
 * Picks the screen for a visitor from auth state plus the URL. The server owns
 * onboarding progress (deep links never skip ahead); the URL owns the
 * signed-out step and the dashboard tab.
 */
function sessionFor(user: AuthUser | null): Session {
  const path = getPathname();
  if (!user) {
    const urlStep = authStepForPath(path);
    // A cold /otp deep link has no pending code: start at login instead.
    if (urlStep === 'otp') navigateTo('/login', { replace: true });
    else if (urlStep !== 'login' && path !== '/') navigateTo('/', { replace: true });
    return { state: 'signed_out' };
  }
  if (user.onboarding.status === 'COMPLETE') {
    const tab = path === '/' ? 'home' : appTabForPath(path);
    if (!tab) navigateTo('/home', { replace: true });
    else if (path === '/') navigateTo(pathForAppTab(tab), { replace: true });
    return { state: 'ready', initialTab: tab ?? 'home' };
  }
  const step = (user.onboarding.step as OnboardingStepId) || 'f1';
  navigateTo(pathForAuthStep(step), { replace: true });
  return { state: 'onboarding', step, form: user.onboarding.form || null };
}

/**
 * Signed-out entry step from the URL. `/` boots through the loader as before;
 * `/login` deep links straight to login.
 */
function signedOutStep(): OnboardingStepId {
  return getPathname() === '/login' ? 'login' : 'loading';
}

/**
 * Auth gate. Signed out: loader -> landing -> WhatsApp OTP. Signed in: resume onboarding
 * at the saved step, or open the dashboard once onboarding is COMPLETE.
 */
export const Root: React.FC = () => {
  const [session, setSession] = useState<Session>({ state: 'checking' });

  useEffect(() => {
    onUnauthorized(() => {
      apiClient.disconnect();
      navigateTo('/', { replace: true });
      setSession({ state: 'signed_out' });
    });
    let cancelled = false;
    fetchMe().then((user) => {
      if (!cancelled) setSession(sessionFor(user));
    });
    return () => {
      cancelled = true;
      onUnauthorized(null);
    };
  }, []);

  // Live data and the WebSocket only run while signed in.
  useEffect(() => {
    if (session.state === 'ready') apiClient.connect();
  }, [session.state]);

  const handleSignOut = useCallback(async () => {
    apiClient.disconnect();
    await signOut();
    navigateTo('/', { replace: true });
    setSession({ state: 'signed_out' });
  }, []);

  const handleComplete = useCallback(() => {
    // Replace so Back from a fresh dashboard never re-enters finished onboarding.
    navigateTo('/home', { replace: true });
    setSession({ state: 'ready', initialTab: 'home' });
  }, []);

  if (session.state === 'checking') {
    return <RouteFallback />;
  }

  if (session.state === 'ready') {
    return (
      <Suspense fallback={<RouteFallback />}>
        <App onSignOut={handleSignOut} initialTab={session.initialTab} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<RouteFallback />}>
      <AuthOnboardingFlow
        // Remount on sign-out so the flow restarts from the entry step.
        key={session.state}
        mode="live"
        initialStep={session.state === 'onboarding' ? session.step : signedOutStep()}
        initialForm={session.state === 'onboarding' ? session.form : null}
        onComplete={handleComplete}
      />
    </Suspense>
  );
};

export default Root;
