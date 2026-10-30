import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { MessageSquare, RefreshCw } from 'lucide-react';
import type { AuthUser } from '../api/auth';

export interface WhatsAppSignInResult {
  token: string;
  is_new_user: boolean;
  user: AuthUser;
}

interface WhatsAppQrLoginProps {
  onVerified: (result: WhatsAppSignInResult) => void;
  onUseCode: () => void;
}

interface LoginRequest {
  id: string;
  code: string;
  message: string;
  wa_link: string;
  business_number: string;
  expires_at: string;
}

const POLL_MS = 2000;

/**
 * Click-to-chat sign-in: the user sends a prefilled "LOGIN-XXXXXX" message to our WhatsApp
 * number (QR on desktop, Open WhatsApp button on phones); the webhook verifies the sender and
 * this component picks the JWT up by polling /api/auth/wa/status.
 */
export const WhatsAppQrLogin: React.FC<WhatsAppQrLoginProps> = ({ onVerified, onUseCode }) => {
  const [request, setRequest] = useState<LoginRequest | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [now, setNow] = useState(Date.now());
  const onVerifiedRef = useRef(onVerified);
  onVerifiedRef.current = onVerified;

  const startRequest = useCallback(async () => {
    setError(null);
    setExpired(false);
    setRequest(null);
    setQrDataUrl('');
    try {
      const res = await fetch('/api/auth/wa/start', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || 'Could not start WhatsApp sign-in.');
        return;
      }
      setRequest(data);
      setQrDataUrl(
        await QRCode.toDataURL(data.wa_link, { margin: 1, width: 440, errorCorrectionLevel: 'M' })
      );
    } catch {
      setError('Cannot reach the Commando server. Is the orchestrator running?');
    }
  }, []);

  useEffect(() => {
    void startRequest();
  }, [startRequest]);

  // Poll until the webhook verifies the sender; also check right away when the tab regains focus
  // (phones come back here from WhatsApp).
  useEffect(() => {
    if (!request || expired) return;
    let stopped = false;
    const check = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/auth/wa/status?id=${encodeURIComponent(request.id)}`);
        const data = await res.json().catch(() => ({}));
        if (stopped) return;
        if (data.status === 'VERIFIED') {
          stopped = true;
          onVerifiedRef.current(data as WhatsAppSignInResult);
        } else if (data.status === 'EXPIRED' || res.status === 410) {
          setExpired(true);
        }
      } catch {
        /* transient: next tick retries */
      }
    };
    const interval = window.setInterval(check, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [request, expired]);

  useEffect(() => {
    if (!request || expired) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [request, expired]);

  const secondsLeft = request ? Math.max(0, Math.round((Date.parse(request.expires_at) - now) / 1000)) : 0;
  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  if (error) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-[#C6A664]/40 bg-[#162030] px-3 py-2 text-xs text-[#F5F0E6]">{error}</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void startRequest()}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#2D3440] bg-[#101216] py-2.5 text-xs font-semibold text-slate-200 hover:border-[#C6A664]/50 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
          <button
            type="button"
            onClick={onUseCode}
            className="flex-1 rounded-xl border border-[#2D3440] bg-[#101216] py-2.5 text-xs font-semibold text-slate-200 hover:border-[#C6A664]/50 cursor-pointer"
          >
            Use a 6-digit code
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-3">
        <div className="relative rounded-2xl bg-white p-2.5 shadow-lg">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="QR code that opens a WhatsApp chat with the Warden sign-in message"
              className={`h-52 w-52 ${expired ? 'opacity-15 blur-[2px]' : ''}`}
            />
          ) : (
            <div className="h-52 w-52 animate-pulse rounded-lg bg-slate-200" aria-busy="true" />
          )}
          {expired && (
            <button
              type="button"
              onClick={() => void startRequest()}
              className="absolute inset-0 m-auto h-10 w-36 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#14161A] text-xs font-bold text-[#D4B475] border border-[#C6A664]/50 cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" /> New QR code
            </button>
          )}
        </div>
        <p className="text-center text-xs text-slate-300 leading-relaxed">
          Scan with your phone camera, then tap <span className="font-semibold text-white">Send</span> in WhatsApp.
          <br />
          <span className="text-slate-400">We sign in the number you send it from.</span>
        </p>
      </div>

      <a
        href={request?.wa_link || undefined}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={!request || expired}
        className={`w-full inline-flex items-center justify-center gap-2 rounded-xl py-3 text-xs font-bold transition ${
          request && !expired
            ? 'bg-[#25D366] text-[#0B121C] hover:brightness-110 cursor-pointer'
            : 'pointer-events-none bg-[#1D2128] text-slate-500'
        }`}
      >
        <MessageSquare className="h-4 w-4" />
        On this phone? Open WhatsApp
      </a>

      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          {!expired && request && <span className="h-1.5 w-1.5 rounded-full bg-[#25D366] animate-pulse" />}
          {expired ? 'Code expired' : request ? `Waiting for your message · ${countdown}` : 'Preparing your code…'}
        </span>
        {request && !expired && <span className="font-mono text-slate-500">LOGIN-{request.code}</span>}
      </div>

      <button
        type="button"
        onClick={onUseCode}
        className="w-full text-center text-[11px] text-slate-400 hover:text-white underline-offset-2 hover:underline cursor-pointer"
      >
        Can't scan? Get a 6-digit code instead
      </button>
    </div>
  );
};
