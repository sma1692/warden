/**
 * GA4 (Google Analytics 4) telemetry helper for Warden Web.
 * Uses VITE_GA_MEASUREMENT_ID environment variable.
 */

declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
  }
}

let isInitialized = false;

export function getMeasurementId(): string | undefined {
  return import.meta.env.VITE_GA_MEASUREMENT_ID;
}

/**
 * Initialize Google Analytics 4 (gtag.js) script dynamically if
 * VITE_GA_MEASUREMENT_ID is configured in the environment.
 */
export function initGA(): void {
  if (typeof window === 'undefined' || isInitialized) return;

  const measurementId = getMeasurementId();
  if (!measurementId) {
    return;
  }

  // Ensure dataLayer and gtag are initialized
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer?.push(arguments);
  };

  window.gtag('js', new Date());
  window.gtag('config', measurementId, {
    send_page_view: false, // SPA handles page views manually
  });

  // Inject gtag.js script if not already present
  const existingScript = document.querySelector(`script[src*="googletagmanager.com/gtag/js?id=${measurementId}"]`);
  if (!existingScript) {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.appendChild(script);
  }

  isInitialized = true;
}

/**
 * Send custom event to GA4
 */
export function trackEvent(eventName: string, params?: Record<string, any>): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', eventName, params);
}

/**
 * Track SPA page view navigation
 */
export function trackPageView(path: string = window.location.pathname, title?: string): void {
  const measurementId = getMeasurementId();
  if (!measurementId || typeof window === 'undefined' || typeof window.gtag !== 'function') return;

  window.gtag('event', 'page_view', {
    page_path: path,
    page_title: title || document.title,
    page_location: window.location.href,
  });
}

/**
 * Track user signup / onboard completion
 */
export function trackUserSignup(method: string = 'password', userId?: string): void {
  trackEvent('user_signup', {
    method,
    user_id: userId,
  });
}

/**
 * Track conversation started in chat / agent terminal
 */
export function trackConversationStarted(conversationId?: string, agentId?: string): void {
  trackEvent('conversation_started', {
    conversation_id: conversationId,
    agent_id: agentId,
  });
}

/**
 * Track dynamic agent spawn event
 */
export function trackAgentSpawned(agentRole: string, parentId?: string): void {
  trackEvent('agent_spawned', {
    agent_role: agentRole,
    parent_id: parentId,
  });
}

/**
 * Track LLM token usage telemetry
 */
export function trackTokensConsumed(tokenCount: number, agentRole?: string, model?: string): void {
  trackEvent('tokens_consumed', {
    value: tokenCount,
    token_count: tokenCount,
    agent_role: agentRole,
    model: model,
  });
}
