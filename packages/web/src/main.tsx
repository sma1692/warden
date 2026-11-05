import React from 'react';
import ReactDOM from 'react-dom/client';
import Root from './Root';
import './index.css';
import { initGA } from './utils/analytics';

// Initialize GA4 telemetry if VITE_GA_MEASUREMENT_ID is defined
initGA();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
