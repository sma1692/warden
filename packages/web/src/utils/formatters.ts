export function formatStopwatch(ms: number): string {
  const safeMs = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');
}

export function formatWorkDuration(ms: number): string {
  const safeMs = Math.max(0, Math.floor(ms));
  const totalMinutes = Math.floor(safeMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

export function formatCompactTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0';
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return String(Math.round(tokens));
}

export function formatUsd(amount: number): string {
  const num = Number(amount) || 0;
  return `$${num.toFixed(2)}`;
}

export function formatModelBadge(provider: string, modelId: string): string {
  const labelMap: Record<string, string> = {
    meta_muse: 'Meta Muse',
    ollama: 'Ollama',
    huggingface: 'HF vLLM',
  };
  const prefix = labelMap[provider] || provider;
  if (modelId === 'muse-wonder-1.0') return `${prefix}: Muse Wonder 1.0`;
  if (modelId === 'muse-pro' || modelId === 'meta-muse-pro') return `${prefix}: Muse Pro`;
  if (modelId === 'muse-spark-1.3') return `${prefix}: Muse Spark 1.3`;
  if (modelId === 'muse-light') return `${prefix}: Muse Light`;
  if (modelId === 'muse-flash') return `${prefix}: Muse Flash`;
  if (modelId === 'muse-glimmer-30b') return `${prefix}: Muse Glimmer 30B`;
  if (modelId === 'muse-image') return `${prefix}: Muse Image`;
  if (modelId === 'muse-voice') return `${prefix}: Muse Voice`;
  if (modelId === 'muse-voice-transcribe-1.0') return `${prefix}: Muse Voice Transcribe`;
  if (modelId === 'muse-embed-1.0') return `${prefix}: Muse Embed`;
  if (modelId === 'llama-3.3-70b') return `${prefix}: Llama 3.3 70B`;
  if (modelId === 'meta-llama/Llama-3.3-70B-Instruct') return `${prefix}: Llama 3.3 70B Instruct`;
  if (modelId === 'llama-4-maverick') return `${prefix}: Llama 4 Maverick`;
  return `${prefix}: ${modelId}`;
}

export function formatRelativeTime(isoString: string | null | undefined): string {
  if (!isoString) return 'just now';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / 1000));
  if (diffSec < 45) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}
