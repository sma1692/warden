import React from 'react';
import { formatCompactTokens } from '../utils/formatters';

interface TokenBreakdownBarProps {
  tokensIn: number;
  tokensCached: number;
  tokensThinking: number;
  tokensOut: number;
  maxTokensQuota?: number;
  compact?: boolean;
}

export const TokenBreakdownBar: React.FC<TokenBreakdownBarProps> = ({
  tokensIn,
  tokensCached,
  tokensThinking,
  tokensOut,
  maxTokensQuota,
  compact = false,
}) => {
  const total = Math.max(1, tokensIn + tokensCached + tokensThinking + tokensOut);
  const inPct = Math.max(2, (tokensIn / total) * 100);
  const cachedPct = Math.max(2, (tokensCached / total) * 100);
  const thinkingPct = Math.max(2, (tokensThinking / total) * 100);
  const outPct = Math.max(2, (tokensOut / total) * 100);

  const quotaPct = maxTokensQuota
    ? Math.min(100, Math.round(((tokensIn + tokensThinking + tokensOut) / maxTokensQuota) * 100))
    : null;

  return (
    <div className="space-y-1.5">
      <div className="h-2 w-full rounded-full bg-[var(--surface-muted)] border border-[var(--surface-border)] overflow-hidden flex">
        <div
          style={{ width: `${inPct}%` }}
          className="bg-[#5A6578] transition-all duration-300"
          title={`Input Tokens: ${formatCompactTokens(tokensIn)}`}
        />
        <div
          style={{ width: `${cachedPct}%` }}
          className="bg-[var(--surface-accent-gold)] transition-all duration-300"
          title={`Vertex Context Cached: ${formatCompactTokens(tokensCached)}`}
        />
        <div
          style={{ width: `${thinkingPct}%` }}
          className="bg-[var(--surface-accent)] transition-all duration-300"
          title={`Argon / Gemini Thinking Tokens: ${formatCompactTokens(tokensThinking)}`}
        />
        <div
          style={{ width: `${outPct}%` }}
          className="bg-[#E5E0D8] dark:bg-[#F0F4F8] transition-all duration-300"
          title={`Output Tokens: ${formatCompactTokens(tokensOut)}`}
        />
      </div>

      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] font-mono text-[var(--surface-text-secondary)]">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-[#5A6578]" />
              In: <strong className="text-[var(--surface-text)]">{formatCompactTokens(tokensIn)}</strong>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--surface-accent-gold)]" />
              Cached: <strong className="text-[var(--surface-accent-gold)]">{formatCompactTokens(tokensCached)}</strong>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--surface-accent)]" />
              Think: <strong className="text-[var(--surface-accent)]">{formatCompactTokens(tokensThinking)}</strong>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-[#E5E0D8] dark:bg-[#F0F4F8]" />
              Out: <strong className="text-[var(--surface-text)]">{formatCompactTokens(tokensOut)}</strong>
            </span>
          </div>

          {quotaPct !== null && maxTokensQuota && (
            <span className="text-[var(--surface-text-secondary)]">
              Run Cap: <strong className="text-[var(--surface-text)]">{formatCompactTokens(maxTokensQuota)}</strong>
            </span>
          )}
        </div>
      )}
    </div>
  );
};
