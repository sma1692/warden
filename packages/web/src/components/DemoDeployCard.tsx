import React from 'react';
import { DemoDashboardView } from './DemoDashboardView';

/**
 * Demo game release banner on Warden's dashboard.
 * Displays the live Cloudflare deployment URL with deploy and copy controls.
 */
export const DemoDeployCard: React.FC<{ onError?: (message: string) => void }> = ({ onError }) => {
  return <DemoDashboardView onError={onError} />;
};

export default DemoDeployCard;

