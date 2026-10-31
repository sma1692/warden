/**
 * Voice-note transcription via Meta Muse audio API (standalone fetch, no ModelRouter).
 *
 * Env:
 *   META_MUSE_API_KEY      API key (never logged)
 *   META_MUSE_BASE_URL     API base URL (default https://api.meta.ai/v1)
 *   WHATSAPP_TRANSCRIBE_MODEL  Model override (default muse-voice-transcribe-1.0)
 */

export type TranscribeResult = { ok: true; text: string } | { ok: false; error: string };

const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
const NO_SPEECH = '[no speech]';

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

function apiKey(): string {
  return env('META_MUSE_API_KEY');
}

function baseUrl(): string {
  return (env('META_MUSE_BASE_URL') || 'https://api.meta.ai/v1').replace(/\/+$/, '');
}

function model(): string {
  return env('WHATSAPP_TRANSCRIBE_MODEL') || 'muse-voice-transcribe-1.0';
}

/** "audio/ogg; codecs=opus" -> "audio/ogg" (strip MIME parameters). */
function baseMime(mimeType: string): string {
  return (mimeType.split(';')[0] ?? '').trim().toLowerCase() || 'audio/ogg';
}

interface MuseTranscriptionResponse {
  text?: string;
  error?: { code?: number; message?: string; status?: string };
}

export async function transcribeAudio(audio: Buffer, mimeType: string): Promise<TranscribeResult> {
  const key = apiKey();
  if (!key) return { ok: false, error: 'Transcription not configured (missing META_MUSE_API_KEY)' };
  if (audio.length === 0) return { ok: false, error: 'Empty audio' };
  if (audio.length > MAX_AUDIO_BYTES) {
    return { ok: false, error: `Audio too large (${(audio.length / 1024 / 1024).toFixed(1)}MB > 20MB limit)` };
  }

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: baseMime(mimeType) }), 'voice-note.ogg');
  form.append('model', model());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl()}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => ({}))) as MuseTranscriptionResponse;
    if (!res.ok || json.error) {
      const e = json.error ?? {};
      return {
        ok: false,
        error: `Muse ${res.status} ${e.status ?? ''} (${model()}): ${e.message ?? 'unknown error'}`.replace(/\s+/g, ' '),
      };
    }
    const text = (json.text ?? '').trim();
    if (!text || text === NO_SPEECH) return { ok: false, error: 'no speech detected' };
    return { ok: true, text };
  } catch (err) {
    const e = err as Error;
    return { ok: false, error: e.name === 'AbortError' ? `Transcription timed out after ${TIMEOUT_MS / 1000}s` : `Network error: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}
