// Dev-only screen browser (npm run dev:ui): every onboarding screen behind step pills,
// persona simulation and the Demo/Product toggle, plus the dashboard on seed data.
// Not part of the production bundle; the real app entry is src/main.tsx.
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from '../App';
import { AuthOnboardingFlow } from '../components/AuthOnboardingFlow';
import '../index.css';

const Gallery: React.FC = () => {
  const [view, setView] = useState<'flow' | 'dashboard'>('flow');
  if (view === 'dashboard') {
    return <App onSignOut={() => setView('flow')} signOutLabel="Back to screens" />;
  }
  return <AuthOnboardingFlow mode="gallery" onComplete={() => setView('dashboard')} />;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Gallery />
  </React.StrictMode>
);
