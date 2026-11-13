import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import type { AttachmentType } from '../db/schema/index.js';

export interface ValidatedMediaFile {
  fileType: AttachmentType;
  mimeType: string;
  extension: string;
  sanitizedFileName: string;
  sizeBytes: number;
}

export interface MediaValidationLimits {
  maxImageBytes: number;
  maxVideoBytes: number;
}

export class MediaValidationError extends Error {
  readonly errorCode: string;
  readonly statusCode: number;

  constructor(errorCode: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'MediaValidationError';
    this.errorCode = errorCode;
    this.statusCode = statusCode;
  }
}

interface AllowedFormatSpec {
  readonly kind: AttachmentType;
  readonly allowedMimes: readonly string[];
}

const ALLOWED_EXTENSION_SPECS: Record<string, AllowedFormatSpec> = {
  jpg: { kind: 'image', allowedMimes: ['image/jpeg'] },
  jpeg: { kind: 'image', allowedMimes: ['image/jpeg'] },
  png: { kind: 'image', allowedMimes: ['image/png'] },
  webp: { kind: 'image', allowedMimes: ['image/webp'] },
  gif: { kind: 'image', allowedMimes: ['image/gif'] },
  avif: { kind: 'image', allowedMimes: ['image/avif'] },
  mp4: { kind: 'video', allowedMimes: ['video/mp4'] },
  webm: { kind: 'video', allowedMimes: ['video/webm'] },
  mov: { kind: 'video', allowedMimes: ['video/quicktime'] },
  mkv: { kind: 'video', allowedMimes: ['video/x-matroska', 'video/matroska'] },
};

const TEXT_SIGNATURE_PREFIXES = ['<svg', '<?xml', '<!doctype', '<html', '<script'];

export function sanitizeFileName(rawFileName: string): string {
  const base = basename(rawFileName || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '');
  return base.length > 0 ? base.slice(0, 120) : 'upload.bin';
}

export function buildStorageKey(prefix: string, safeFileName: string): string {
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, '');
  return `${cleanPrefix}/${randomUUID()}-${safeFileName}`;
}

/**
 * Validates an uploaded file buffer strictly using actual magic bytes (`file-type`),
 * extension allowlist, anti-SVG/HTML/executable checks, and size limits.
 */
export async function validateMediaBuffer(
  buffer: Buffer,
  originalFileName: string,
  limits: MediaValidationLimits,
): Promise<ValidatedMediaFile> {
  if (!buffer || buffer.length === 0) {
    throw new MediaValidationError('EMPTY_FILE', 'Uploaded file is empty');
  }

  const sanitizedFileName = sanitizeFileName(originalFileName);
  const rawExt = extname(sanitizedFileName).toLowerCase().replace('.', '');

  if (rawExt === 'svg') {
    throw new MediaValidationError(
      'SVG_FORBIDDEN',
      'SVG files are forbidden for security reasons',
      415,
    );
  }

  const spec = ALLOWED_EXTENSION_SPECS[rawExt];
  if (!spec) {
    throw new MediaValidationError(
      'UNSUPPORTED_FILE_EXTENSION',
      `File extension ".${rawExt || 'none'}" is not allowed`,
      415,
    );
  }

  // Defense-in-depth: reject text-based XML/SVG/HTML/script payloads even if renamed
  const headText = buffer.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
  if (TEXT_SIGNATURE_PREFIXES.some((prefix) => headText.startsWith(prefix))) {
    throw new MediaValidationError(
      'SVG_OR_HTML_FORBIDDEN',
      'SVG, XML, HTML, and script payloads are forbidden',
      415,
    );
  }

  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) {
    throw new MediaValidationError(
      'INVALID_FILE_SIGNATURE',
      'Unable to verify file magic bytes',
      415,
    );
  }

  if (!spec.allowedMimes.includes(detected.mime)) {
    throw new MediaValidationError(
      'MIME_EXTENSION_MISMATCH',
      `File content (${detected.mime}) does not match extension ".${rawExt}"`,
      415,
    );
  }

  const maxBytes =
    spec.kind === 'image' ? limits.maxImageBytes : limits.maxVideoBytes;
  if (buffer.length > maxBytes) {
    throw new MediaValidationError(
      'FILE_TOO_LARGE',
      `File size exceeds maximum allowed limit (${maxBytes} bytes)`,
      413,
    );
  }

  return {
    fileType: spec.kind,
    mimeType: detected.mime,
    extension: detected.ext,
    sanitizedFileName,
    sizeBytes: buffer.length,
  };
}

