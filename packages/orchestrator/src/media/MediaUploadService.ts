/**
 * DYNAMO COMMANDO — Multimodal Chat Attachment & Local Media Upload Service
 * (`dynamocommando.md` Section 4.1 Table 7 & Section 5.2)
 *
 * Responsibilities:
 * 1. Accepts multimodal chat attachments uploaded via base64 JSON or `multipart/form-data`
 *    from the Dashboard PWA (screenshots, Figma mockups, architecture diagrams, videos, PDFs).
 * 2. Saves files locally to `.state/media/<filename>` (served at `/media/<filename>`).
 * 3. Assigns a deterministic `media://` URI (`media://${MEDIA_BUCKET}/<filename>`) for
 *    native `fileData` references in `ModelRouter`.
 * 4. Returns structured `ChatAttachment` objects (`{ type, media_uri, public_url, filename, size_bytes, base64Data }`)
 *    ready for `chat_messages.attachments_json` and `ModelRouter`.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type SupportedAttachmentMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'video/mp4'
  | 'application/pdf';

export interface ChatAttachment {
  id?: string;
  type: SupportedAttachmentMimeType | string;
  media_uri: string | null;
  public_url: string;
  filename: string;
  size_bytes: number;
  base64Data?: string;
  base64_data?: string;
}

export interface MediaUploadInput {
  id?: string;
  filename?: string;
  mimeType?: string;
  type?: string;
  /** Base64 string or `data:<mime>;base64,...` data URI */
  base64Data?: string;
  base64_data?: string;
  data?: string;
  /** Raw binary buffer if uploaded via multipart */
  buffer?: Buffer | Uint8Array;
  /** Include base64Data in returned ChatAttachment (default true for < 8MB so inlineData works immediately) */
  includeBase64?: boolean;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'application/pdf': '.pdf',
};

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
};

/**
 * Infers MIME type from a data URL prefix, explicit mime string, or filename extension.
 */
export function inferMimeType(params: {
  mimeType?: string;
  filename?: string;
  dataUri?: string;
}): string {
  if (params.dataUri && params.dataUri.startsWith('data:')) {
    const match = params.dataUri.match(/^data:([^;]+);base64,/i);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }
  if (params.mimeType) {
    const clean = params.mimeType.trim().toLowerCase();
    return clean === 'image/jpg' ? 'image/jpeg' : clean;
  }
  if (params.filename) {
    const ext = path.extname(params.filename).toLowerCase();
    if (EXT_TO_MIME[ext]) {
      return EXT_TO_MIME[ext];
    }
  }
  return 'image/png';
}

/**
 * Sanitizes a user-supplied filename and prefixes a timestamp + short random hash
 * so files stored in `.state/media/` never collide or allow directory traversal.
 */
export function buildSafeMediaFilename(originalName: string | undefined, mimeType: string): string {
  const defaultExt = MIME_TO_EXT[mimeType] || '.bin';
  const baseRaw = originalName ? path.basename(originalName) : `attachment${defaultExt}`;
  const ext = path.extname(baseRaw).toLowerCase() || defaultExt;
  const stem = path
    .basename(baseRaw, path.extname(baseRaw))
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'media';

  const shortHash = crypto.randomBytes(4).toString('hex');
  return `${Date.now()}-${shortHash}-${stem}${ext}`;
}

export class MediaUploadService {
  private readonly mediaDir: string;
  private readonly mediaBucket: string;
  private readonly publicBaseUrl: string;

  constructor(options?: {
    mediaDir?: string;
    mediaBucket?: string;
    publicBaseUrl?: string;
  }) {
    this.mediaDir =
      options?.mediaDir || path.resolve(process.cwd(), '.state', 'media');
    this.mediaBucket =
      options?.mediaBucket ?? (process.env.MEDIA_BUCKET || 'local-media');
    this.publicBaseUrl = (
      options?.publicBaseUrl ||
      process.env.VITE_API_URL ||
      `http://localhost:${process.env.PORT || 4000}`
    ).replace(/\/+$/, '');

    fs.mkdirSync(this.mediaDir, { recursive: true });
  }

  public getMediaDirectory(): string {
    fs.mkdirSync(this.mediaDir, { recursive: true });
    return this.mediaDir;
  }

  /**
   * Uploads a single attachment from base64, data URI, or Buffer.
   * Saves locally to `.state/media/<filename>` and assigns a `media://` URI.
   */
  public async uploadAttachment(input: MediaUploadInput): Promise<ChatAttachment> {
    const rawString = input.base64Data || input.base64_data || input.data || '';
    const mimeType = inferMimeType({
      mimeType: input.mimeType || input.type,
      filename: input.filename,
      dataUri: rawString,
    });

    let binaryBuffer: Buffer;
    let cleanBase64: string;

    if (input.buffer) {
      binaryBuffer = Buffer.isBuffer(input.buffer)
        ? input.buffer
        : Buffer.from(input.buffer);
      cleanBase64 = binaryBuffer.toString('base64');
    } else if (rawString) {
      cleanBase64 = rawString.includes('base64,')
        ? rawString.split('base64,')[1].trim()
        : rawString.trim();
      binaryBuffer = Buffer.from(cleanBase64, 'base64');
    } else {
      throw new Error('MediaUploadService.uploadAttachment requires either `base64Data` or `buffer`.');
    }

    const safeFilename = buildSafeMediaFilename(input.filename, mimeType);
    const localFilePath = path.join(this.getMediaDirectory(), safeFilename);
    fs.writeFileSync(localFilePath, binaryBuffer);

    const sizeBytes = binaryBuffer.byteLength;
    const publicUrl = `/media/${safeFilename}`;

    const mediaUri = `media://${this.mediaBucket}/${safeFilename}`;

    // Include base64Data for attachments <= 8MB so ModelRouter can pass inlineData directly when offline
    const includeBase64 = input.includeBase64 ?? sizeBytes <= 8 * 1024 * 1024;

    return {
      id: input.id || `att_${crypto.randomUUID().slice(0, 8)}`,
      type: mimeType,
      media_uri: mediaUri,
      public_url: publicUrl,
      filename: safeFilename,
      size_bytes: sizeBytes,
      ...(includeBase64 ? { base64Data: cleanBase64, base64_data: cleanBase64 } : {}),
    };
  }

  /**
   * Alias for `uploadAttachment` when uploading base64 payloads.
   */
  public async uploadBase64(input: MediaUploadInput): Promise<ChatAttachment> {
    return this.uploadAttachment(input);
  }

  /**
   * Uploads multiple attachments in parallel.
   */
  public async uploadBatch(inputs: MediaUploadInput[]): Promise<ChatAttachment[]> {
    return Promise.all(inputs.map((item) => this.uploadAttachment(item)));
  }

  /**
   * Parses a raw `multipart/form-data` HTTP request body buffer and saves all uploaded file parts.
   */
  public async uploadMultipart(
    rawBody: Buffer,
    contentTypeHeader: string
  ): Promise<ChatAttachment[]> {
    const boundaryMatch = contentTypeHeader.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
    if (!boundary) {
      throw new Error('Invalid multipart/form-data Content-Type: missing boundary parameter.');
    }

    const delimiter = Buffer.from(`--${boundary}`);
    const parts: MediaUploadInput[] = [];

    let start = rawBody.indexOf(delimiter);
    while (start !== -1) {
      const nextStart = rawBody.indexOf(delimiter, start + delimiter.length);
      if (nextStart === -1) break;

      // Slice part content between boundaries (strip leading \r\n and trailing \r\n)
      const partSlice = rawBody.subarray(start + delimiter.length + 2, nextStart - 2);
      const headerEndIdx = partSlice.indexOf(Buffer.from('\r\n\r\n'));

      if (headerEndIdx !== -1) {
        const headerText = partSlice.subarray(0, headerEndIdx).toString('utf8');
        const fileBuffer = partSlice.subarray(headerEndIdx + 4);

        const filenameMatch = headerText.match(/filename="([^"]+)"/i);
        const contentTypeMatch = headerText.match(/Content-Type:\s*([^\r\n;]+)/i);

        if (filenameMatch && fileBuffer.byteLength > 0) {
          parts.push({
            filename: filenameMatch[1],
            mimeType: contentTypeMatch?.[1]?.trim() || 'application/octet-stream',
            buffer: fileBuffer,
          });
        }
      }

      start = nextStart;
    }

    return this.uploadBatch(parts);
  }

  /**
   * Safely resolves a local file inside `.state/media/<filename>` for serving `GET /media/:filename`.
   */
  public resolveLocalMediaFile(filename: string): {
    filePath: string;
    mimeType: string;
    sizeBytes: number;
  } | null {
    const safeName = path.basename(filename || '');
    if (!safeName) return null;
    const fullPath = path.join(this.getMediaDirectory(), safeName);
    if (!fs.existsSync(fullPath)) return null;
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return null;
    return {
      filePath: fullPath,
      mimeType: inferMimeType({ filename: safeName }),
      sizeBytes: stat.size,
    };
  }

}

export const mediaUploadService = new MediaUploadService();
export default mediaUploadService;
