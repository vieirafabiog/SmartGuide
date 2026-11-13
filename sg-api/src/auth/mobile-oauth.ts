import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppEnv } from '../config/env.js';
import { SUPPORTED_LOCALES, USER_ROLES, type SupportedLocale, type UserRole } from '../db/schema/index.js';
import { getEnabledAuthProviders, type AuthInstance } from './auth.js';
import { extractAuthHeaders, type AuthenticatedUser } from './guards.js';

const EXCHANGE_CODE_TTL_MS = 60_000;
const MAX_PENDING_CODES = 10_000;

interface PendingExchangeEntry {
  token: string;
  user: AuthenticatedUser;
  redirectUri: string;
  expiresAt: number;
}

export class MobileExchangeStore {
  private readonly entries = new Map<string, PendingExchangeEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs = EXCHANGE_CODE_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  private hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  issue(payload: {
    token: string;
    user: AuthenticatedUser;
    redirectUri: string;
    now?: number;
  }): string {
    const now = payload.now ?? Date.now();
    this.pruneExpired(now);

    if (this.entries.size >= MAX_PENDING_CODES) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey) {
        this.entries.delete(oldestKey);
      }
    }

    const code = randomBytes(32).toString('base64url');
    this.entries.set(this.hashCode(code), {
      token: payload.token,
      user: payload.user,
      redirectUri: payload.redirectUri,
      expiresAt: now + this.ttlMs,
    });
    return code;
  }

  consume(code: string, now = Date.now()): PendingExchangeEntry | null {
    const key = this.hashCode(code);
    const entry = this.entries.get(key);
    // Delete immediately regardless of expiry to enforce strict single-use semantics
    this.entries.delete(key);

    if (!entry || entry.expiresAt <= now) {
      return null;
    }
    return entry;
  }
}

/**
 * Validates mobile OAuth redirect URIs against an explicit scheme & host allowlist.
 * `exp://` is permitted exclusively in `NODE_ENV=development` for Expo Go local testing.
 */
export function isAllowedMobileRedirectUri(
  redirectUri: string,
  env: Pick<AppEnv, 'MOBILE_APP_SCHEME' | 'NODE_ENV'>,
): boolean {
  if (!redirectUri || redirectUri.length > 512) return false;

  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return false;
  }

  if (parsed.username !== '' || parsed.password !== '') {
    return false;
  }

  const expectedScheme = `${env.MOBILE_APP_SCHEME.toLowerCase()}:`;
  const protocol = parsed.protocol.toLowerCase();

  if (protocol === expectedScheme) {
    return (
      parsed.hostname.toLowerCase() === 'auth-callback' ||
      parsed.pathname === '/auth-callback'
    );
  }

  if (env.NODE_ENV === 'development' && protocol === 'exp:') {
    return parsed.hostname.length > 0;
  }

  return false;
}

function normalizeRole(value: unknown): UserRole {
  if (typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value)) {
    return value as UserRole;
  }
  return 'user';
}

function normalizeLocale(value: unknown): SupportedLocale {
  if (
    typeof value === 'string' &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  ) {
    return value as SupportedLocale;
  }
  return 'pt-BR';
}

const startQuerySchema = z.object({
  provider: z.enum(['google', 'microsoft']),
  redirect_uri: z.string().min(1),
});

const finishQuerySchema = z.object({
  redirect_uri: z.string().min(1),
});

const exchangeBodySchema = z.object({
  code: z.string().min(16),
  redirect_uri: z.string().min(1).optional(),
});

export interface MobileOAuthRoutesOptions {
  store?: MobileExchangeStore;
  now?: () => number;
}

/**
 * Registers mobile OAuth deep-link bridge routes:
 * - GET  /api/v1/auth/mobile/start
 * - GET  /api/v1/auth/mobile/finish
 * - POST /api/v1/auth/mobile/exchange
 */
export function registerMobileOAuthRoutes(
  app: FastifyInstance,
  auth: AuthInstance,
  env: AppEnv,
  options?: MobileOAuthRoutesOptions,
): void {
  const store = options?.store ?? new MobileExchangeStore();
  const nowFn = options?.now ?? (() => Date.now());

  app.get('/api/v1/auth/mobile/start', async (request, reply) => {
    const parsed = startQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        errorCode: 'INVALID_REQUEST',
        message: 'provider and redirect_uri are required',
      });
    }

    const { provider, redirect_uri: redirectUri } = parsed.data;
    if (!isAllowedMobileRedirectUri(redirectUri, env)) {
      return reply.code(400).send({
        errorCode: 'INVALID_REDIRECT_URI',
        message: 'redirect_uri is not in the mobile allowlist',
      });
    }

    const enabled = getEnabledAuthProviders(env);
    if (!enabled[provider]) {
      return reply.code(400).send({
        errorCode: 'PROVIDER_DISABLED',
        message: `OAuth provider "${provider}" is not configured`,
      });
    }

    const baseApiUrl = env.API_PUBLIC_URL.replace(/\/+$/, '');
    const callbackUrl = `${baseApiUrl}/api/v1/auth/mobile/finish?redirect_uri=${encodeURIComponent(redirectUri)}`;
    const betterAuthStartUrl = `${env.BETTER_AUTH_URL.replace(/\/+$/, '')}/api/auth/sign-in/social`;

    const authRes = await auth.handler(
      new Request(betterAuthStartUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          provider,
          callbackURL: callbackUrl,
          disableRedirect: true,
        }),
      }),
    );

    const setCookies =
      typeof authRes.headers.getSetCookie === 'function'
        ? authRes.headers.getSetCookie()
        : [];
    if (setCookies.length > 0) {
      reply.header('set-cookie', setCookies);
    }

    if (!authRes.ok) {
      return reply.code(502).send({
        errorCode: 'OAUTH_START_FAILED',
        message: 'Failed to initiate OAuth flow',
      });
    }

    const payload = (await authRes.json()) as { url?: string };
    if (!payload.url) {
      return reply.code(502).send({
        errorCode: 'OAUTH_START_FAILED',
        message: 'OAuth provider did not return a redirect URL',
      });
    }

    return reply.redirect(payload.url, 302);
  });

  app.get('/api/v1/auth/mobile/finish', async (request, reply) => {
    const parsed = finishQuerySchema.safeParse(request.query);
    if (!parsed.success || !isAllowedMobileRedirectUri(parsed.data.redirect_uri, env)) {
      return reply.code(400).send({
        errorCode: 'INVALID_REDIRECT_URI',
        message: 'redirect_uri is not in the mobile allowlist',
      });
    }

    const sessionResult = await auth.api.getSession({
      headers: extractAuthHeaders(request),
    });

    if (!sessionResult || !sessionResult.user || !sessionResult.session) {
      return reply.code(401).send({
        errorCode: 'UNAUTHORIZED',
        message: 'Authenticated session required to finish mobile login',
      });
    }

    const rawUser = sessionResult.user as Record<string, unknown>;
    const rawSession = sessionResult.session as Record<string, unknown>;

    if (rawUser.isActive === false) {
      return reply.code(403).send({
        errorCode: 'ACCOUNT_DISABLED',
        message: 'Account is disabled',
      });
    }

    const authenticatedUser: AuthenticatedUser = {
      id: String(rawUser.id),
      email: String(rawUser.email),
      name: String(rawUser.name),
      role: normalizeRole(rawUser.role),
      isActive: true,
      preferredLocale: normalizeLocale(rawUser.preferredLocale),
      image: typeof rawUser.image === 'string' ? rawUser.image : null,
    };

    const code = store.issue({
      token: String(rawSession.token),
      user: authenticatedUser,
      redirectUri: parsed.data.redirect_uri,
      now: nowFn(),
    });

    const target = new URL(parsed.data.redirect_uri);
    target.searchParams.set('code', code);

    return reply.redirect(target.toString(), 302);
  });

  app.post('/api/v1/auth/mobile/exchange', async (request, reply) => {
    const parsed = exchangeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        errorCode: 'INVALID_REQUEST',
        message: 'Valid exchange code is required',
      });
    }

    const entry = store.consume(parsed.data.code, nowFn());
    if (!entry) {
      return reply.code(401).send({
        errorCode: 'INVALID_OR_EXPIRED_CODE',
        message: 'Exchange code is invalid, already used, or expired',
      });
    }

    if (parsed.data.redirect_uri && parsed.data.redirect_uri !== entry.redirectUri) {
      return reply.code(400).send({
        errorCode: 'INVALID_REDIRECT_URI',
        message: 'redirect_uri mismatch',
      });
    }

    return reply.code(200).send({
      token: entry.token,
      tokenType: 'Bearer',
      user: entry.user,
    });
  });
}

