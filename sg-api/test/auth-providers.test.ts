import { describe, expect, it } from 'vitest';
import { createAuth, getEnabledAuthProviders } from '../src/auth/auth.js';
import { parseEnv } from '../src/config/env.js';
import type { Database } from '../src/db/index.js';

const baseEnv = (overrides?: Record<string, string>) =>
  parseEnv({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://smart_guide:secret@localhost:5432/smart_guide',
    BETTER_AUTH_SECRET: 'dev-secret-key-at-least-16-chars',
    CORS_ORIGINS: 'http://localhost:8080',
    ...overrides,
  });

describe('conditional Google & Microsoft Entra ID OAuth providers', () => {
  const mockDb = {} as Database;

  it('disables both social providers when OAuth credentials are absent', () => {
    const env = baseEnv();
    const auth = createAuth(mockDb, env);
    const status = getEnabledAuthProviders(env);

    expect(status).toEqual({
      emailPassword: true,
      google: false,
      microsoft: false,
    });
    expect(auth.options.socialProviders?.google).toBeUndefined();
    expect(auth.options.socialProviders?.microsoft).toBeUndefined();
  });

  it('enables Google OAuth only when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set', () => {
    const env = baseEnv({
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
    });
    const auth = createAuth(mockDb, env);
    const status = getEnabledAuthProviders(env);

    expect(status).toEqual({
      emailPassword: true,
      google: true,
      microsoft: false,
    });
    expect(auth.options.socialProviders?.google).toEqual({
      clientId: 'google-client-id',
      clientSecret: 'google-client-secret',
      prompt: 'select_account',
    });
    expect(auth.options.socialProviders?.microsoft).toBeUndefined();
  });

  it('enables Microsoft Entra ID with custom tenantId when configured', () => {
    const env = baseEnv({
      MICROSOFT_CLIENT_ID: 'ms-client-id',
      MICROSOFT_CLIENT_SECRET: 'ms-client-secret',
      MICROSOFT_TENANT_ID: '11111111-2222-3333-4444-555555555555',
    });
    const auth = createAuth(mockDb, env);
    const status = getEnabledAuthProviders(env);

    expect(status).toEqual({
      emailPassword: true,
      google: false,
      microsoft: true,
    });
    expect(auth.options.socialProviders?.microsoft).toEqual({
      clientId: 'ms-client-id',
      clientSecret: 'ms-client-secret',
      tenantId: '11111111-2222-3333-4444-555555555555',
      prompt: 'select_account',
    });
    expect(auth.options.socialProviders?.google).toBeUndefined();
  });

  it('supports SSO-only mode with both Google and Microsoft enabled and email/password disabled', () => {
    const env = baseEnv({
      AUTH_ALLOW_EMAIL_PASSWORD: 'false',
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      MICROSOFT_CLIENT_ID: 'ms-id',
      MICROSOFT_CLIENT_SECRET: 'ms-secret',
    });
    const auth = createAuth(mockDb, env);
    const status = getEnabledAuthProviders(env);

    expect(status).toEqual({
      emailPassword: false,
      google: true,
      microsoft: true,
    });
    expect(auth.options.emailAndPassword?.enabled).toBe(false);
    expect(auth.options.socialProviders?.google?.clientId).toBe('google-id');
    expect(auth.options.socialProviders?.microsoft?.tenantId).toBe('common');
  });
});

