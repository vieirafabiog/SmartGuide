import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AuthInstance } from '../src/auth/auth.js';
import {
  isAllowedMobileRedirectUri,
  MobileExchangeStore,
  registerMobileOAuthRoutes,
} from '../src/auth/mobile-oauth.js';
import { parseEnv } from '../src/config/env.js';

const makeEnv = (overrides?: Record<string, string>) =>
  parseEnv({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://smart_guide:secret@localhost:5432/smart_guide',
    BETTER_AUTH_SECRET: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
    CORS_ORIGINS: 'http://localhost:8080',
    GOOGLE_CLIENT_ID: 'google-id',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    ...overrides,
  });

function createMockAuth(sessionResult: unknown): AuthInstance {
  return {
    api: {
      getSession: vi.fn(async () => sessionResult),
    },
    handler: vi.fn(async () =>
      new Response(JSON.stringify({ url: 'https://accounts.google.com/o/oauth2/v2/auth?state=123' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'better-auth.state=xyz; Path=/; HttpOnly',
        },
      }),
    ),
  } as unknown as AuthInstance;
}

describe('Mobile OAuth deep-link bridge & strict redirect allowlist', () => {
  it('validates redirect_uri strictly by scheme and environment', () => {
    const devEnv = makeEnv({ NODE_ENV: 'development' });
    const prodEnv = makeEnv({ NODE_ENV: 'production' });

    expect(isAllowedMobileRedirectUri('smartguide://auth-callback', prodEnv)).toBe(true);
    expect(isAllowedMobileRedirectUri('exp://192.168.1.20:8081/--/auth-callback', devEnv)).toBe(
      true,
    );
    expect(isAllowedMobileRedirectUri('exp://192.168.1.20:8081/--/auth-callback', prodEnv)).toBe(
      false,
    );

    expect(isAllowedMobileRedirectUri('https://evil.example.com/callback', devEnv)).toBe(false);
    expect(isAllowedMobileRedirectUri('http://localhost:8080/callback', devEnv)).toBe(false);
    expect(isAllowedMobileRedirectUri('javascript:alert(1)', devEnv)).toBe(false);
    expect(isAllowedMobileRedirectUri('smartguide://evil-host', prodEnv)).toBe(false);
    expect(isAllowedMobileRedirectUri('smartguide://user:pass@auth-callback', prodEnv)).toBe(
      false,
    );
  });

  it('rejects invalid redirect_uri and disabled providers on /start', async () => {
    const env = makeEnv({ NODE_ENV: 'production' });
    const app = Fastify();
    registerMobileOAuthRoutes(app, createMockAuth(null), env);

    const invalidRedirect = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/mobile/start?provider=google&redirect_uri=https://attacker.tld',
    });
    expect(invalidRedirect.statusCode).toBe(400);
    expect(invalidRedirect.json().errorCode).toBe('INVALID_REDIRECT_URI');

    const disabledProvider = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/mobile/start?provider=microsoft&redirect_uri=smartguide://auth-callback',
    });
    expect(disabledProvider.statusCode).toBe(400);
    expect(disabledProvider.json().errorCode).toBe('PROVIDER_DISABLED');

    const validStart = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/mobile/start?provider=google&redirect_uri=smartguide://auth-callback',
    });
    expect(validStart.statusCode).toBe(302);
    expect(validStart.headers.location).toContain('https://accounts.google.com/');
  });

  it('completes /finish -> /exchange with single-use 60s code and rejects replay', async () => {
    let fakeNow = 1_700_000_000_000;
    const env = makeEnv();
    const store = new MobileExchangeStore(60_000);
    const mockAuth = createMockAuth({
      user: {
        id: 'u-mobile',
        email: 'mobile@example.com',
        name: 'Mobile User',
        role: 'user',
        isActive: true,
        preferredLocale: 'pt-BR',
        image: null,
      },
      session: {
        id: 'sess-1',
        token: 'bearer-session-token-xyz',
        expiresAt: new Date(fakeNow + 86_400_000),
      },
    });

    const app = Fastify();
    registerMobileOAuthRoutes(app, mockAuth, env, { store, now: () => fakeNow });

    const finishRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/mobile/finish?redirect_uri=smartguide://auth-callback',
    });

    expect(finishRes.statusCode).toBe(302);
    const location = finishRes.headers.location ?? '';
    expect(location.startsWith('smartguide://auth-callback?code=')).toBe(true);

    const code = new URL(location).searchParams.get('code') ?? '';
    expect(code.length).toBeGreaterThanOrEqual(32);

    // First exchange succeeds
    const exchange1 = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mobile/exchange',
      payload: { code, redirect_uri: 'smartguide://auth-callback' },
    });
    expect(exchange1.statusCode).toBe(200);
    expect(exchange1.json()).toEqual({
      token: 'bearer-session-token-xyz',
      tokenType: 'Bearer',
      user: {
        id: 'u-mobile',
        email: 'mobile@example.com',
        name: 'Mobile User',
        role: 'user',
        isActive: true,
        preferredLocale: 'pt-BR',
        image: null,
      },
    });

    // Replay attempt is strictly rejected
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mobile/exchange',
      payload: { code },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().errorCode).toBe('INVALID_OR_EXPIRED_CODE');

    // Expired code (>60s) is rejected
    const finish2 = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/mobile/finish?redirect_uri=smartguide://auth-callback',
    });
    const code2 = new URL(finish2.headers.location ?? '').searchParams.get('code') ?? '';
    fakeNow += 61_000;

    const expiredRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mobile/exchange',
      payload: { code: code2 },
    });
    expect(expiredRes.statusCode).toBe(401);
    expect(expiredRes.json().errorCode).toBe('INVALID_OR_EXPIRED_CODE');
  });

  it('rejects /finish when unauthenticated or user is disabled', async () => {
    const env = makeEnv();

    const appNoAuth = Fastify();
    registerMobileOAuthRoutes(appNoAuth, createMockAuth(null), env);
    const unauthRes = await appNoAuth.inject({
      method: 'GET',
      url: '/api/v1/auth/mobile/finish?redirect_uri=smartguide://auth-callback',
    });
    expect(unauthRes.statusCode).toBe(401);

    const appDisabled = Fastify();
    registerMobileOAuthRoutes(
      appDisabled,
      createMockAuth({
        user: {
          id: 'u-2',
          email: 'disabled@example.com',
          name: 'Disabled',
          role: 'user',
          isActive: false,
          preferredLocale: 'en',
          image: null,
        },
        session: { id: 's-2', token: 'tok-2', expiresAt: new Date(Date.now() + 60_000) },
      }),
      env,
    );
    const disabledRes = await appDisabled.inject({
      method: 'GET',
      url: '/api/v1/auth/mobile/finish?redirect_uri=smartguide://auth-callback',
    });
    expect(disabledRes.statusCode).toBe(403);
    expect(disabledRes.json().errorCode).toBe('ACCOUNT_DISABLED');
  });
});

