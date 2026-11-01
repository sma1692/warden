import React, { useState } from 'react';
import { BellRing, Bot, CheckCheck, ChevronRight, User, X, Zap } from 'lucide-react';

interface HandoffStep {
  id: string;
  actor: string;
  actorKind: 'human' | 'copilot';
  text: string;
  time: string;
}

const HANDOFF_STEPS: HandoffStep[] = [
  {
    id: 's1',
    actor: 'Maya (human, Growth)',
    actorKind: 'human',
    text: 'Asks her copilot: "What is the checkout P99 latency on pulse-core this week?"',
    time: '09:41:02',
  },
  {
    id: 's2',
    actor: 'Maya copilots twin',
    actorKind: 'copilot',
    text: 'Resolves the owner: telemetry lives with @backend_dev under @tech_lead (TECH vertical). No human ping needed yet.',
    time: '09:41:03',
  },
  {
    id: 's3',
    actor: 'Maya copilots twin → Arjun copilots twin',
    actorKind: 'copilot',
    text: 'Opens a copilot-to-copilot channel and requests the signed latency digest for pulse-core.',
    time: '09:41:04',
  },
  {
    id: 's4',
    actor: 'Arjun copilots twin (TECH)',
    actorKind: 'copilot',
    text: 'Replies with "P99 22ms, P50 9ms, 0 duplicate webhooks" plus the telemetry link. Arjun is never interrupted.',
    time: '09:41:06',
  },
  {
    id: 's5',
    actor: 'Maya copilots twin → Maya',
    actorKind: 'copilot',
    text: 'Delivers the answer with provenance. Maya ships the investor update. Zero meetings, zero pings.',
    time: '09:41:07',
  },
];

/**
 * Demo-sandbox alert. Sits at the top of the Home tab in the demo workspace.
 * Clicking it opens the copilot-to-copilot orchestration timeline: one human
 * asks their copilot, the copilot finds the right owner, talks to that owner's
 * copilot, and answers — the second human is never disturbed.
 */
export const CopilotHandoffCard: React.FC = () => {
  const [open, setOpen] = useState<boolean>(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left rounded-2xl border border-[#C6A664]/50 bg-gradient-to-r from-[#162030] via-[#14161A] to-[#14161A] px-4 py-3 shadow-lg shadow-black/30 hover:border-[#D4B475] transition cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#C6A664]/15 border border-[#C6A664]/40">
            <BellRing className="h-4 w-4 text-[#D4B475]" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#D4B475] opacity-60" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-[#D4B475]" />
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-mono uppercase tracking-wider text-[#D4B475]">
              Live in demo sandbox • Copilot handoff resolved
            </span>
            <span className="block truncate text-sm font-bold text-white">
              Maya got checkout latency without pinging Arjun — copilots handled it
            </span>
            <span className="block truncate text-xs text-slate-400">
              Tap to replay the 5-step orchestration: human → copilot → copilot → answer.
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-[#D4B475]" />
        </div>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Copilot to copilot orchestration replay"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-3xl border border-[#C6A664]/40 bg-[#101216] p-5 sm:p-6 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-[#D4B475]">
                  Orchestration replay • 5s end-to-end
                </p>
                <h2 className="text-lg font-black text-white mt-1">
                  One question, zero interruptions
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Maya asks her copilot. Her copilot finds the owner and talks to
                  their copilot. Arjun never gets pinged.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close orchestration replay"
                className="rounded-lg border border-[#22262E] bg-[#1D2128] p-1.5 text-slate-400 hover:text-white transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <ol className="space-y-3">
              {HANDOFF_STEPS.map((step, idx) => (
                <li
                  key={step.id}
                  className="flex gap-3 rounded-2xl border border-[#22262E] bg-[#14161A] p-3"
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${
                      step.actorKind === 'human'
                        ? 'border-sky-400/40 bg-sky-400/10 text-sky-300'
                        : 'border-[#C6A664]/40 bg-[#C6A664]/10 text-[#D4B475]'
                    }`}
                  >
                    {step.actorKind === 'human' ? (
                      <User className="h-4 w-4" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-white">
                        {idx + 1}. {step.actor}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500 shrink-0">
                        {step.time}
                      </span>
                    </span>
                    <span className="block text-xs text-slate-300 mt-0.5 leading-relaxed">
                      {step.text}
                    </span>
                  </span>
                </li>
              ))}
            </ol>

            <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
              <CheckCheck className="h-4 w-4 shrink-0 text-emerald-300" />
              <p className="text-xs text-emerald-200">
                Resolved copilot-to-copilot in ~5s. Arjun got zero pings and a
                one-line log entry.
              </p>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <Zap className="h-3.5 w-3.5 text-[#D4B475]" />
              <span>Demo sandbox data — connect your team to run this live.</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CopilotHandoffCard;
