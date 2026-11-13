import { describe, expect, it } from 'vitest';
import { createAuth } from '../src/auth/auth.js';
import {
  canCreateTraining,
  canEditTraining,
  canManageInstance,
  canManageTrainingOwnership,
  canViewTraining,
  hasRequiredRole,
} from '../src/auth/permissions.js';
import { parseEnv } from '../src/config/env.js';
import type { Database } from '../src/db/index.js';

const testEnv = (overrides?: Record<string, string>) =>
  parseEnv({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://smart_guide:secret@localhost:5432/smart_guide',
    BETTER_AUTH_SECRET: 'dev-secret-key-at-least-16-chars',
    CORS_ORIGINS: 'http://localhost:8080',
    ...overrides,
  });

describe('Better Auth core & single-tenant RBAC permissions', () => {
  it('instantiates Better Auth with Drizzle PG adapter, Bearer plugin, and signup gate', () => {
    const mockDb = {} as Database;
    const auth = createAuth(mockDb, testEnv({ AUTH_ALLOW_PUBLIC_SIGNUP: 'false' }));

    expect(auth).toBeDefined();
    expect(typeof auth.handler).toBe('function');
    expect(auth.options.emailAndPassword?.enabled).toBe(true);
    expect(auth.options.emailAndPassword?.minPasswordLength).toBe(8);
    expect(auth.options.emailAndPassword?.disableSignUp).toBe(true);
    expect(auth.options.user?.additionalFields?.role?.input).toBe(false);
    expect(auth.options.user?.additionalFields?.isActive?.input).toBe(false);
  });

  it('enables secure cookies only when production uses HTTPS', () => {
    const mockDb = {} as Database;

    const lanProd = createAuth(
      mockDb,
      testEnv({
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
        BETTER_AUTH_URL: 'http://192.168.1.50:3000',
      }),
    );
    expect(lanProd.options.advanced?.useSecureCookies).toBe(false);

    const httpsProd = createAuth(
      mockDb,
      testEnv({
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
        BETTER_AUTH_URL: 'https://guide.acme.com',
      }),
    );
    expect(httpsProd.options.advanced?.useSecureCookies).toBe(true);
  });

  it('enforces single-tenant RBAC visibility, edit, and ownership rules', () => {
    expect(hasRequiredRole('admin', ['admin'])).toBe(true);
    expect(hasRequiredRole('user', ['admin', 'creator'])).toBe(false);

    expect(canManageInstance('admin')).toBe(true);
    expect(canManageInstance('creator')).toBe(false);
    expect(canCreateTraining('creator')).toBe(true);
    expect(canCreateTraining('user')).toBe(false);

    const draftPrivate = { createdBy: 'creator-1', status: 'draft' as const, isPublic: false };
    const pubTraining = { createdBy: 'creator-1', status: 'published' as const, isPublic: true };

    expect(canViewTraining('user', 'user-1', draftPrivate, null)).toBe(false);
    expect(canViewTraining('user', 'user-1', draftPrivate, 'viewer')).toBe(true);
    expect(canViewTraining('user', 'user-1', pubTraining, null)).toBe(true);
    expect(canViewTraining('admin', 'admin-1', draftPrivate, null)).toBe(true);

    expect(canEditTraining('user', 'user-1', draftPrivate, 'viewer')).toBe(false);
    expect(canEditTraining('user', 'user-1', draftPrivate, 'editor')).toBe(true);
    expect(canEditTraining('creator', 'creator-1', draftPrivate, null)).toBe(true);

    expect(canManageTrainingOwnership('creator', 'creator-2', draftPrivate, 'editor')).toBe(false);
    expect(canManageTrainingOwnership('creator', 'creator-2', draftPrivate, 'owner')).toBe(true);
    expect(canManageTrainingOwnership('admin', 'admin-1', draftPrivate, null)).toBe(true);
  });
});
