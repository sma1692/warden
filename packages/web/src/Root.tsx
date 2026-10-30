import React, { useCallback, useEffect, useState } from 'react';
import App from './App';
import { AuthOnboardingFlow, type OnboardingStepId } from './components/AuthOnboardingFlow';
import { apiClient } from './api/client';
import { fetchMe, onUnauthorized, signOut, type AuthUser } from './api/auth';

type Session =
  | { state: 'checking' }
  | { state: 'signed_out' }
  | { state: 'onboarding'; step: OnboardingStepId }
  | { state: 'ready' };

/** Picks the screen for a signed-in user from their server-side onboarding state. */
function sessionFor(user: AuthUser): Session {
  if (user.onboarding.status === 'COMPLETE') return { state: 'ready' };
  return { state: 'onboarding', step: (user.onboarding.step as OnboardingStepId) || 'f1' };
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
      setSession({ state: 'signed_out' });
    });
    let cancelled = false;
    fetchMe().then((user) => {
      if (!cancelled) setSession(user ? sessionFor(user) : { state: 'signed_out' });
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
    setSession({ state: 'signed_out' });
  }, []);

  if (session.state === 'checking') {
    return <div className="h-screen bg-[#090A0C]" aria-busy="true" />;
  }

  if (session.state === 'ready') {
    return <App onSignOut={handleSignOut} />;
  }

  return (
    <AuthOnboardingFlow
      // Remount on sign-out so the flow restarts from the loader.
      key={session.state}
      mode="live"
      initialStep={session.state === 'onboarding' ? session.step : 'loading'}
      onComplete={() => setSession({ state: 'ready' })}
    />
  );
};

export default Root;
