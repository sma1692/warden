import React, { useState } from 'react';
import { MessageSquareText, Send } from 'lucide-react';

interface HomeChatStripProps {
  onStartChat: (message: string) => void;
}

/**
 * Compact home-page composer. Typing here opens a direct @warden channel
 * with the text prefilled, so a demo user can start chatting immediately.
 */
export const HomeChatStrip: React.FC<HomeChatStripProps> = ({ onStartChat }) => {
  const [value, setValue] = useState('');
  const submittingRef = React.useRef(false);

  const submit = async () => {
    const text = value.trim();
    if (!text || submittingRef.current) return;
    submittingRef.current = true;
    setValue('');
    try {
      await onStartChat(text);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <div className="shrink-0 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-card)] px-3.5 py-2.5 shadow-xs">
      <div className="flex items-center gap-2.5">
        <MessageSquareText className="h-4 w-4 shrink-0 text-[var(--surface-accent-gold)]" />
        <span className="hidden sm:inline shrink-0 text-[11px] font-mono font-bold text-[var(--surface-accent-gold)]">
          @warden
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Ask Warden anything to start chatting..."
          aria-label="Start chatting with Warden"
          className="min-w-0 flex-1 bg-transparent text-sm text-[var(--surface-text)] placeholder:text-[var(--surface-text-muted)] focus:outline-none"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim()}
          aria-label="Send and open chat"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--surface-accent-gold)] px-3 py-1.5 text-xs font-bold text-black shadow-xs transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
        >
          <Send className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Chat</span>
        </button>
      </div>
    </div>
  );
};
export default HomeChatStrip;
