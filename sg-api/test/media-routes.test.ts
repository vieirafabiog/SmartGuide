import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthInstance } from '../src/auth/auth.js';
import { parseEnv } from '../src/config/env.js';
import {
  registerMediaRoutes,
  signMediaToken,
  verifyMediaToken,
} from '../src/modules/media/media.routes.js';
import { LocalStorageConnector } from '../src/storage/local.connector.js';

const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52,
]);

const MP4_PAYLOAD = Buffer.concat([
  Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32,
    0x00, 0x00, 0x00, 0x00, 0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d,
  ]),
  Buffer.from('0123456789ABCDEF'),
]);

function buildMultipartPayload(
  fieldName: string,
  filename: string,
  contentType: string,
  content: Buffer,
) {
  const boundary = '----sgTestBoundary123456';
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    boundary,
    body: Buffer.concat([head, content, tail]),
  };
}

function createMockAuth(role: 'admin' | 'creator' | 'user' | null): AuthInstance {
  return {
    api: {
      getSession: vi.fn(async ({ headers }: { headers: Headers }) => {
        if (!role || headers.get('authorization') !== 'Bearer valid-token') {
          return null;
        }
        return {
          user: {
            id: `user-${role}`,
            email: `${role}@example.com`,
            name: role,
            role,
            isActive: true,
            preferredLocale: 'pt-BR',
            image: null,
          },
          session: {
            id: 'sess-1',
            token: 'valid-token',
            expiresAt: new Date(Date.now() + 60_000),
          },
        };
      }),
    },
  } as unknown as AuthInstance;
}

describe('Authenticated & Range-aware media routes', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  const setupApp = async (opts?: {
    role?: 'admin' | 'creator' | 'user' | null;
    publicMedia?: boolean;
  }) => {
    const dir = mkdtempSync(join(tmpdir(), 'sg-media-routes-'));
    tempDirs.push(dir);

    const env = parseEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://smart_guide:secret@localhost:5432/smart_guide',
      BETTER_AUTH_SECRET: 'media-test-secret-at-least-32-chars!!',
      CORS_ORIGINS: 'http://localhost:8080',
      LOCAL_STORAGE_PATH: dir,
      STORAGE_PUBLIC_MEDIA: opts?.publicMedia ? 'true' : 'false',
    });

    const storage = new LocalStorageConnector(dir);
    const auth = createMockAuth(opts?.role ?? 'creator');

    const app = Fastify();
    await app.register(multipart);
    registerMediaRoutes(app, { auth, storage, env });
    return { app, storage, env };
  };

  it('allows creator/admin upload with magic-byte check and rejects regular users and .svg', async () => {
    const { app: userApp } = await setupApp({ role: 'user' });
    const mpUser = buildMultipartPayload('file', 'pic.png', 'image/png', PNG_HEADER);
    const forbiddenUpload = await userApp.inject({
      method: 'POST',
      url: '/api/v1/media/upload',
      headers: {
        authorization: 'Bearer valid-token',
        'content-type': `multipart/form-data; boundary=${mpUser.boundary}`,
      },
      payload: mpUser.body,
    });
    expect(forbiddenUpload.statusCode).toBe(403);

    const { app: creatorApp } = await setupApp({ role: 'creator' });
    const mpSvg = buildMultipartPayload(
      'file',
      'xss.svg',
      'image/svg+xml',
      Buffer.from('<svg><script>alert(1)</script></svg>'),
    );
    const svgRes = await creatorApp.inject({
      method: 'POST',
      url: '/api/v1/media/upload',
      headers: {
        authorization: 'Bearer valid-token',
        'content-type': `multipart/form-data; boundary=${mpSvg.boundary}`,
      },
      payload: mpSvg.body,
    });
    expect(svgRes.statusCode).toBe(415);
    expect(svgRes.json().errorCode).toBe('SVG_FORBIDDEN');

    const mpValid = buildMultipartPayload('file', 'demo.mp4', 'video/mp4', MP4_PAYLOAD);
    const okRes = await creatorApp.inject({
      method: 'POST',
      url: '/api/v1/media/upload?bucket=step-attachments',
      headers: {
        authorization: 'Bearer valid-token',
        'content-type': `multipart/form-data; boundary=${mpValid.boundary}`,
      },
      payload: mpValid.body,
    });
    expect(okRes.statusCode).toBe(201);
    const body = okRes.json();
    expect(body).toMatchObject({
      bucket: 'step-attachments',
      fileType: 'video',
      mimeType: 'video/mp4',
      fileSize: MP4_PAYLOAD.length,
    });
    expect(body.signedUrl).toContain('?token=');
  });

  it('enforces auth/HMAC token on step-attachments and serves 206 Partial Content + nosniff', async () => {
    const { app } = await setupApp({ role: 'creator', publicMedia: false });

    const mpValid = buildMultipartPayload('file', 'clip.mp4', 'video/mp4', MP4_PAYLOAD);
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/media/upload?bucket=step-attachments',
      headers: {
        authorization: 'Bearer valid-token',
        'content-type': `multipart/form-data; boundary=${mpValid.boundary}`,
      },
      payload: mpValid.body,
    });
    const { url, signedUrl } = uploadRes.json() as { url: string; signedUrl: string };

    // Anonymous without token is rejected with 401
    const anonRes = await app.inject({ method: 'GET', url });
    expect(anonRes.statusCode).toBe(401);

    // Tampered token is rejected with 401
    const tamperedRes = await app.inject({
      method: 'GET',
      url: `${url}?token=9999999999.badsignature`,
    });
    expect(tamperedRes.statusCode).toBe(401);

    // Valid signedUrl supports 206 Range streaming and sets nosniff header
    const rangeRes = await app.inject({
      method: 'GET',
      url: signedUrl,
      headers: { range: 'bytes=24-39' },
    });
    expect(rangeRes.statusCode).toBe(206);
    expect(rangeRes.headers['x-content-type-options']).toBe('nosniff');
    expect(rangeRes.headers['content-range']).toBe(`bytes 24-39/${MP4_PAYLOAD.length}`);
    expect(rangeRes.rawPayload.toString()).toBe('0123456789ABCDEF');

    // Authenticated session without query token also succeeds
    const sessionRes = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: 'Bearer valid-token' },
    });
    expect(sessionRes.statusCode).toBe(200);
    expect(sessionRes.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows public reads when STORAGE_PUBLIC_MEDIA=true and verifies HMAC token expiry', async () => {
    const { app, env } = await setupApp({ role: 'creator', publicMedia: true });
    const mpPng = buildMultipartPayload('file', 'cover.png', 'image/png', PNG_HEADER);
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/media/upload?bucket=training-covers',
      headers: {
        authorization: 'Bearer valid-token',
        'content-type': `multipart/form-data; boundary=${mpPng.boundary}`,
      },
      payload: mpPng.body,
    });
    const { url } = uploadRes.json() as { url: string };

    const publicGet = await app.inject({ method: 'GET', url });
    expect(publicGet.statusCode).toBe(200);
    expect(publicGet.headers['x-content-type-options']).toBe('nosniff');

    const now = 1_700_000_000_000;
    const tok = signMediaToken('step-attachments', 'a/b.png', env.BETTER_AUTH_SECRET, 60, now);
    expect(verifyMediaToken(tok, 'step-attachments', 'a/b.png', env.BETTER_AUTH_SECRET, now + 30_000)).toBe(true);
    expect(verifyMediaToken(tok, 'step-attachments', 'a/other.png', env.BETTER_AUTH_SECRET, now + 30_000)).toBe(false);
    expect(verifyMediaToken(tok, 'step-attachments', 'a/b.png', env.BETTER_AUTH_SECRET, now + 61_000)).toBe(false);
  });
});
