import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import type { AppEnv } from '../config/env.js';
import type { Database } from '../db/index.js';
import * as schema from '../db/schema/index.js';

export interface AuthProvidersStatus {
  emailPassword: boolean;
  google: boolean;
  microsoft: boolean;
}

/**
 * Returns safe boolean flags indicating which authentication providers are active.
 * Never exposes OAuth credentials or secrets.
 */
export function getEnabledAuthProviders(env: AppEnv): AuthProvidersStatus {
  return {
    emailPassword: env.AUTH_ALLOW_EMAIL_PASSWORD,
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    microsoft: Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET),
  };
}

/**
 * Creates the Better Auth instance backed by Drizzle PostgreSQL,
 * single-tenant custom fields (`role`, `isActive`, `preferredLocale`),
 * conditional Google & Microsoft Entra ID OAuth providers,
 * signup gating, secure cookie defaults, and Bearer token support for mobile.
 */
export function createAuth(db: Database, env: AppEnv) {
  const isHttps = env.BETTER_AUTH_URL.startsWith('https://');
  const mobileOrigin = `${env.MOBILE_APP_SCHEME}://`;

  const socialProviders: {
    google?: {
      clientId: string;
      clientSecret: string;
      prompt: 'select_account';
    };
    microsoft?: {
      clientId: string;
      clientSecret: string;
      tenantId: string;
      prompt: 'select_account';
    };
  } = {};

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      prompt: 'select_account',
    };
  }

  if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET) {
    socialProviders.microsoft = {
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      tenantId: env.MICROSOFT_TENANT_ID,
      prompt: 'select_account',
    };
  }

  return betterAuth({
    appName: env.INSTANCE_NAME,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [...env.CORS_ORIGINS, mobileOrigin],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema,
    }),
    emailAndPassword: {
      enabled: env.AUTH_ALLOW_EMAIL_PASSWORD,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      disableSignUp: !env.AUTH_ALLOW_PUBLIC_SIGNUP,
    },
    socialProviders,
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: 'user',
          input: false,
        },
        isActive: {
          type: 'boolean',
          required: false,
          defaultValue: true,
          input: false,
        },
        preferredLocale: {
          type: 'string',
          required: false,
          defaultValue: env.APP_DEFAULT_LOCALE,
          input: true,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
    },
    advanced: {
      useSecureCookies: env.NODE_ENV === 'production' && isHttps,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      },
    },
    plugins: [bearer()],
  });
}

export type AuthInstance = ReturnType<typeof createAuth>;

