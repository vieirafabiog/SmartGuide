import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AuthInstance } from '../src/auth/auth.js';
import { registerBetterAuthRoutes } from '../src/auth/fastify-plugin.js';
import { createAuthGuards } from '../src/auth/guards.js';

function createMockAuth(
  sessionImpl: (args: { headers: Headers }) => Promise<unknown>,
  handlerImpl?: (req: Request) => Promise<Response>,
): AuthInstance {
  return {
    api: {
      getSession: vi.fn(sessionImpl),
    },
    handler: vi.fn(
      handlerImpl ??
        (async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'set-cookie': 'better-auth.session_token=abc; Path=/; HttpOnly',
            },
          })),
    ),
  } as unknown as AuthInstance;
}

describe('Fastify Better Auth mount & session/role guards', () => {
  it('mounts ALL /api/auth/* and forwards headers, body, status, and Set-Cookie', async () => {
    const captured: { method?: string; url?: string; body?: string } = {};
    const mockAuth = createMockAuth(
      async () => null,
      async (req) => {
        captured.method = req.method;
        captured.url = req.url;
        captured.body = await req.text();
        return new Response(JSON.stringify({ signedIn: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'set-cookie': 'sg_session=xyz; Path=/; HttpOnly',
          },
        });
      },
    );

    const app = Fastify();
    registerBetterAuthRoutes(app, mockAuth);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email: 'admin@example.com', password: 'password123' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ signedIn: true });
    const setCookieHeader = res.headers['set-cookie'];
    const cookieText = Array.isArray(setCookieHeader)
      ? setCookieHeader.join('; ')
      : String(setCookieHeader ?? '');
    expect(cookieText).toContain('sg_session=xyz');
    expect(captured.method).toBe('POST');
    expect(captured.url).toContain('/api/auth/sign-in/email');
    expect(captured.body).toContain('admin@example.com');
  });

  it('rejects unauthenticated requests with 401 UNAUTHORIZED', async () => {
    const mockAuth = createMockAuth(async () => null);
    const guards = createAuthGuards(mockAuth);

    const app = Fastify();
    app.get('/protected', { preHandler: [guards.requireAuth] }, async (req) => ({
      user: req.currentUser,
    }));

    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(401);
    expect(res.json().errorCode).toBe('UNAUTHORIZED');
  });

  it('rejects disabled users (isActive === false) with 403 ACCOUNT_DISABLED', async () => {
    const mockAuth = createMockAuth(async () => ({
      user: {
        id: 'u-disabled',
        email: 'disabled@example.com',
        name: 'Disabled User',
        role: 'creator',
        isActive: false,
        preferredLocale: 'en',
        image: null,
      },
      session: {
        id: 's-1',
        token: 'tok-1',
        expiresAt: new Date(Date.now() + 60_000),
      },
    }));

    const guards = createAuthGuards(mockAuth);
    const app = Fastify();
    app.get('/protected', { preHandler: [guards.requireAuth] }, async () => ({ ok: true }));

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer tok-1' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().errorCode).toBe('ACCOUNT_DISABLED');
  });

  it('attaches request.currentUser from cookie/Bearer and enforces requireRole', async () => {
    let seenAuthHeader: string | null = null;
    const mockAuth = createMockAuth(async ({ headers }) => {
      seenAuthHeader = headers.get('authorization');
      if (seenAuthHeader === 'Bearer creator-token') {
        return {
          user: {
            id: 'u-creator',
            email: 'creator@example.com',
            name: 'Creator',
            role: 'creator',
            isActive: true,
            preferredLocale: 'es',
            image: null,
          },
          session: {
            id: 's-creator',
            token: 'creator-token',
            expiresAt: new Date(Date.now() + 60_000),
          },
        };
      }
      return null;
    });

    const guards = createAuthGuards(mockAuth);
    const app = Fastify();

    app.get(
      '/creator-area',
      { preHandler: [guards.requireAuth, guards.requireRole(['admin', 'creator'])] },
      async (req) => ({ currentUser: req.currentUser }),
    );

    app.get(
      '/admin-only',
      { preHandler: [guards.requireRole(['admin'])] },
      async () => ({ ok: true }),
    );

    const creatorRes = await app.inject({
      method: 'GET',
      url: '/creator-area',
      headers: { authorization: 'Bearer creator-token' },
    });
    expect(creatorRes.statusCode).toBe(200);
    expect(creatorRes.json().currentUser).toMatchObject({
      id: 'u-creator',
      role: 'creator',
      preferredLocale: 'es',
    });

    const adminDenied = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { authorization: 'Bearer creator-token' },
    });
    expect(adminDenied.statusCode).toBe(403);
    expect(adminDenied.json().errorCode).toBe('FORBIDDEN');
  });
});
