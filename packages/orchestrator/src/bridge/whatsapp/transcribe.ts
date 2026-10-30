/**
 * Voice-note transcription via Google Gemini generateContent (standalone fetch, no ModelRouter).
 *
 * Env:
 *   GEMINI_API_KEY / VERTEX_API_KEY  API key (same resolution order as ModelRouter; never logged)
 *   WHATSAPP_TRANSCRIBE_MODEL        Model override (default COMMANDO_STUDIO_FLASH_MODEL, else gemini-3-flash-preview)
 */

export type TranscribeResult = { ok: true; text: string } | { ok: false; error: string };

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
const NO_SPEECH = '[no speech]';

const PROMPT =
  'Transcribe this audio verbatim. Keep the original language (do not translate). ' +
  'Output only the transcript, with no commentary, labels or timestamps. ' +
  `If there is no intelligible speech, output exactly "${NO_SPEECH}".`;

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

function apiKey(): string {
  return env('GEMINI_API_KEY') || env('VERTEX_API_KEY');
}

function model(): string {
  return env('WHATSAPP_TRANSCRIBE_MODEL') || env('COMMANDO_STUDIO_FLASH_MODEL') || 'gemini-3-flash-preview';
}

/** "audio/ogg; codecs=opus" -> "audio/ogg" (Gemini rejects MIME parameters). */
function baseMime(mimeType: string): string {
  return (mimeType.split(';')[0] ?? '').trim().toLowerCase() || 'audio/ogg';
}

/** Studio keys hit generativelanguage; "AQ." keys are Vertex express keys (same as ModelRouter). */
function endpoints(key: string, m: string): string[] {
  const studio = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`;
  if (!key.startsWith('AQ.')) return [studio];
  return [`https://aiplatform.googleapis.com/v1beta1/publishers/google/models/${m}:generateContent?key=${key}`, studio];
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { code?: number; message?: string; status?: string };
}

export async function transcribeAudio(audio: Buffer, mimeType: string): Promise<TranscribeResult> {
  const key = apiKey();
  if (!key) return { ok: false, error: 'Transcription not configured (missing GEMINI_API_KEY / VERTEX_API_KEY)' };
  if (audio.length === 0) return { ok: false, error: 'Empty audio' };
  if (audio.length > MAX_AUDIO_BYTES) {
    return { ok: false, error: `Audio too large (${(audio.length / 1024 / 1024).toFixed(1)}MB > 20MB inline limit)` };
  }

  const m = model();
  const body = JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [{ inlineData: { mimeType: baseMime(mimeType), data: audio.toString('base64') } }, { text: PROMPT }],
      },
    ],
    generationConfig: { temperature: 0 },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let lastError = 'unknown error';
    for (const url of endpoints(key, m)) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => ({}))) as GeminiResponse;
      if (!res.ok || json.error) {
        const e = json.error ?? {};
        lastError = `Gemini ${res.status} ${e.status ?? ''} (${m}): ${e.message ?? 'unknown error'}`.replace(/\s+/g, ' ');
        // Vertex express 403 -> retry on the studio endpoint (mirrors ModelRouter).
        if (res.status === 403 && url.includes('aiplatform.googleapis.com')) continue;
        return { ok: false, error: lastError };
      }
      const text = (json.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? '')
        .join('')
        .trim();
      if (!text || text === NO_SPEECH) return { ok: false, error: 'no speech detected' };
      return { ok: true, text };
    }
    return { ok: false, error: lastError };
  } catch (err) {
    const e = err as Error;
    return { ok: false, error: e.name === 'AbortError' ? `Transcription timed out after ${TIMEOUT_MS / 1000}s` : `Network error: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}
