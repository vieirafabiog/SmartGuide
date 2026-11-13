import { createHmac, timingSafeEqual } from 'node:crypto';
import '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthInstance } from '../../auth/auth.js';
import { createAuthGuards } from '../../auth/guards.js';
import type { AppEnv } from '../../config/env.js';
import {
  buildStorageKey,
  MediaValidationError,
  validateMediaBuffer,
} from '../../security/file-validator.js';
import {
  RangeNotSatisfiableError,
  StoragePathError,
  type ByteRange,
  type StorageBucket,
  type StorageConnector,
} from '../../storage/index.js';

const ALLOWED_BUCKETS = new Set<StorageBucket>([
  'training-covers',
  'step-attachments',
  'instance-assets',
]);

const DEFAULT_MEDIA_TOKEN_TTL_SEC = 900;

function isValidBucket(value: string): value is StorageBucket {
  return ALLOWED_BUCKETS.has(value as StorageBucket);
}

/**
 * Generates an HMAC-SHA256 signed query token scoped to a specific `(bucket, key)` pair.
 */
export function signMediaToken(
  bucket: StorageBucket,
  key: string,
  secret: string,
  ttlSeconds = DEFAULT_MEDIA_TOKEN_TTL_SEC,
  nowMs = Date.now(),
): string {
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  const message = `${bucket}:${key}:${exp}`;
  const sig = createHmac('sha256', secret).update(message).digest('base64url');
  return `${exp}.${sig}`;
}

/**
 * Verifies an HMAC-SHA256 media query token using constant-time comparison.
 */
export function verifyMediaToken(
  token: string,
  bucket: StorageBucket,
  key: string,
  secret: string,
  nowMs = Date.now(),
): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expStr, providedSig] = parts;
  if (!expStr || !providedSig || !/^\d+$/.test(expStr)) return false;

  const exp = Number(expStr);
  if (!Number.isSafeInteger(exp) || exp <= Math.floor(nowMs / 1000)) {
    return false;
  }

  const expectedSig = createHmac('sha256', secret)
    .update(`${bucket}:${key}:${exp}`)
    .digest('base64url');

  const a = Buffer.from(providedSig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseByteRangeHeader(headerValue: string): ByteRange | 'invalid' {
  const match = /^bytes=(\d+)-(\d*)$/.exec(headerValue.trim());
  if (!match || !match[1]) return 'invalid';

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : undefined;

  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    (end !== undefined && (!Number.isSafeInteger(end) || end < start))
  ) {
    return 'invalid';
  }

  return end !== undefined ? { start, end } : { start };
}

export interface MediaRoutesOptions {
  now?: () => number;
}

/**
 * Registers authenticated, magic-byte-validated, Range-aware media upload & download endpoints.
 */
export function registerMediaRoutes(
  app: FastifyInstance,
  deps: { auth: AuthInstance; storage: StorageConnector; env: AppEnv },
  options?: MediaRoutesOptions,
): void {
  const guards = createAuthGuards(deps.auth);
  const nowFn = options?.now ?? (() => Date.now());
  const maxImageBytes = Math.floor(deps.env.STORAGE_MAX_IMAGE_MB * 1024 * 1024);
  const maxVideoBytes = Math.floor(deps.env.STORAGE_MAX_VIDEO_MB * 1024 * 1024);

  app.post(
    '/api/v1/media/upload',
    { preHandler: [guards.requireAuth, guards.requireRole(['admin', 'creator'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { bucket?: string };
      const requestedBucket = query.bucket ?? 'step-attachments';

      if (!isValidBucket(requestedBucket)) {
        return reply.code(400).send({
          errorCode: 'INVALID_BUCKET',
          message: 'Invalid target storage bucket',
        });
      }

      if (requestedBucket === 'instance-assets' && request.currentUser?.role !== 'admin') {
        return reply.code(403).send({
          errorCode: 'FORBIDDEN',
          message: 'Only administrators can upload instance assets',
        });
      }

      const filePart = await request.file({
        limits: {
          fileSize: Math.max(maxImageBytes, maxVideoBytes),
          files: 1,
        },
      });

      if (!filePart) {
        return reply.code(400).send({
          errorCode: 'MISSING_FILE',
          message: 'Multipart file field is required',
        });
      }

      let buffer: Buffer;
      try {
        buffer = await filePart.toBuffer();
      } catch {
        return reply.code(413).send({
          errorCode: 'FILE_TOO_LARGE',
          message: 'Uploaded file exceeds maximum allowed size',
        });
      }

      try {
        const validated = await validateMediaBuffer(buffer, filePart.filename, {
          maxImageBytes,
          maxVideoBytes,
        });

        const prefix =
          requestedBucket === 'step-attachments'
            ? 'attachments'
            : requestedBucket === 'training-covers'
              ? 'covers'
              : 'branding';

        const storageKey = buildStorageKey(prefix, validated.sanitizedFileName);
        await deps.storage.putObject({
          bucket: requestedBucket,
          key: storageKey,
          body: buffer,
          contentType: validated.mimeType,
          contentLength: validated.sizeBytes,
        });

        const token = signMediaToken(
          requestedBucket,
          storageKey,
          deps.env.BETTER_AUTH_SECRET,
          DEFAULT_MEDIA_TOKEN_TTL_SEC,
          nowFn(),
        );

        const basePath = `/api/v1/media/${requestedBucket}/${storageKey}`;
        return reply.code(201).send({
          bucket: requestedBucket,
          storageKey,
          fileName: validated.sanitizedFileName,
          fileType: validated.fileType,
          mimeType: validated.mimeType,
          fileSize: validated.sizeBytes,
          url: basePath,
          signedUrl: `${basePath}?token=${encodeURIComponent(token)}`,
        });
      } catch (err) {
        if (err instanceof MediaValidationError) {
          return reply.code(err.statusCode).send({
            errorCode: err.errorCode,
            message: err.message,
          });
        }
        throw err;
      }
    },
  );

  app.get('/api/v1/media/:bucket/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { bucket: string; '*': string };
    const { bucket } = params;
    const key = params['*'];

    if (!isValidBucket(bucket)) {
      return reply.code(400).send({
        errorCode: 'INVALID_BUCKET',
        message: 'Invalid storage bucket',
      });
    }

    const requiresAuth =
      !deps.env.STORAGE_PUBLIC_MEDIA && bucket !== 'instance-assets';

    if (requiresAuth) {
      const query = request.query as { token?: string };
      const hasValidToken =
        typeof query.token === 'string' &&
        verifyMediaToken(
          query.token,
          bucket,
          key,
          deps.env.BETTER_AUTH_SECRET,
          nowFn(),
        );

      if (!hasValidToken) {
        await guards.optionalAuth(request, reply);
        if (reply.sent) return;
        if (!request.currentUser) {
          return reply.code(401).send({
            errorCode: 'UNAUTHORIZED',
            message: 'Authentication or valid signed media token required',
          });
        }
      }
    }

    const rawRange = request.headers.range;
    let parsedRange: ByteRange | undefined;
    if (typeof rawRange === 'string' && rawRange.trim() !== '') {
      const candidate = parseByteRangeHeader(rawRange);
      if (candidate === 'invalid') {
        return reply.code(416).send({
          errorCode: 'RANGE_NOT_SATISFIABLE',
          message: 'Invalid Range header',
        });
      }
      parsedRange = candidate;
    }

    try {
      const result = await deps.storage.getObjectStream(bucket, key, parsedRange);
      if (!result) {
        return reply.code(404).send({
          errorCode: 'NOT_FOUND',
          message: 'Media object not found',
        });
      }

      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Content-Type', result.contentType);
      reply.header('Content-Length', String(result.contentLength));
      reply.header(
        'Cache-Control',
        deps.env.STORAGE_PUBLIC_MEDIA ? 'public, max-age=3600' : 'private, max-age=300',
      );
      if (result.statusCode === 206 && result.contentRange) {
        reply.header('Content-Range', result.contentRange);
      }

      return reply.code(result.statusCode).send(result.stream);
    } catch (err) {
      if (err instanceof StoragePathError) {
        return reply.code(400).send({
          errorCode: err.errorCode,
          message: err.message,
        });
      }
      if (err instanceof RangeNotSatisfiableError) {
        reply.header('Content-Range', `bytes */${err.totalLength}`);
        return reply.code(416).send({
          errorCode: err.errorCode,
          message: err.message,
        });
      }
      throw err;
    }
  });
}
