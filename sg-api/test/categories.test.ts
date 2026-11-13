import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AuthInstance } from '../src/auth/auth.js';
import { parseEnv } from '../src/config/env.js';
import type { Database } from '../src/db/index.js';
import { categories, instanceSettings } from '../src/db/schema/index.js';
import { registerCategoryRoutes } from '../src/modules/categories/categories.routes.js';
import {
  buildLicenseKeyHint,
  registerInstanceRoutes,
} from '../src/modules/instance/instance.routes.js';

interface CategoryRecord {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  createdAt: Date;
}

function createMockDb() {
  const settingsRow = {
    id: 1,
    instanceUuid: '11111111-1111-4111-8111-111111111111',
    siteName: 'Acme Smart Guide',
    logoUrl: null as string | null,
    defaultLocale: 'pt-BR' as const,
    allowPublicSignup: false,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  const categoryRows: CategoryRecord[] = [
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Onboarding',
      color: '#3B82F6',
      icon: 'rocket-outline',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
  ];

  const db = {
    select: () => ({
      from: (table: unknown) => {
        if (table === instanceSettings) {
          return {
            where: () => ({
              limit: async () => [settingsRow],
            }),
          };
        }
        if (table === categories) {
          return {
            orderBy: async () =>
              [...categoryRows].sort((a, b) => a.name.localeCompare(b.name)),
          };
        }
        return {};
      },
    }),
    insert: (table: unknown) => ({
      values: (vals: { name: string; color: string; icon: string | null }) => ({
        returning: async () => {
          if (table === categories) {
            if (categoryRows.some((c) => c.name.toLowerCase() === vals.name.toLowerCase())) {
              throw Object.assign(new Error('duplicate'), { code: '23505' });
            }
            const created: CategoryRecord = {
              id: randomUUID(),
              name: vals.name,
              color: vals.color,
              icon: vals.icon,
              createdAt: new Date(),
            };
            categoryRows.push(created);
            return [created];
          }
          return [];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (table === instanceSettings) {
              Object.assign(settingsRow, vals);
              return [settingsRow];
            }
            if (table === categories) {
              // Extract target id from most recent test operation: update first matching or none if unknown
              const target = categoryRows[0];
              if (!target) return [];
              if (
                typeof vals.name === 'string' &&
                categoryRows.some(
                  (c) => c.id !== target.id && c.name.toLowerCase() === vals.name?.toString().toLowerCase(),
                )
              ) {
                throw Object.assign(new Error('duplicate'), { code: '23505' });
              }
              Object.assign(target, vals);
              return [target];
            }
            return [];
          },
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: () => ({
        returning: async () => {
          if (table === categories && categoryRows.length > 0) {
            const removed = categoryRows.pop()!;
            return [{ id: removed.id }];
          }
          return [];
        },
      }),
    }),
  } as unknown as Database;

  return { db, settingsRow, categoryRows };
}

function createMockAuth(): AuthInstance {
  return {
    api: {
      getSession: vi.fn(async ({ headers }: { headers: Headers }) => {
        const authHeader = headers.get('authorization');
        if (authHeader === 'Bearer admin-token') {
          return {
            user: {
              id: 'u-admin',
              email: 'admin@acme.com',
              name: 'Admin',
              role: 'admin',
              isActive: true,
              preferredLocale: 'pt-BR',
              image: null,
            },
            session: { id: 's-1', token: 'admin-token', expiresAt: new Date(Date.now() + 60_000) },
          };
        }
        if (authHeader === 'Bearer user-token') {
          return {
            user: {
              id: 'u-regular',
              email: 'user@acme.com',
              name: 'User',
              role: 'user',
              isActive: true,
              preferredLocale: 'en',
              image: null,
            },
            session: { id: 's-2', token: 'user-token', expiresAt: new Date(Date.now() + 60_000) },
          };
        }
        return null;
      }),
    },
  } as unknown as AuthInstance;
}

describe('Instance info, settings & Categories CRUD routes', () => {
  it('GET /api/v1/instance/info exposes safe metadata and masked licenseKeyHint without secrets', async () => {
    const { db } = createMockDb();
    const env = parseEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://smart_guide:secret@localhost:5432/smart_guide',
      BETTER_AUTH_SECRET: 'dev-secret-key-at-least-16-chars',
      CORS_ORIGINS: 'http://localhost:8080',
      GOOGLE_CLIENT_ID: 'g-id',
      GOOGLE_CLIENT_SECRET: 'g-secret',
      SG_LICENSE_KEY: 'sg_lic_secret_token_9876543210',
    });

    const app = Fastify();
    registerInstanceRoutes(app, { db, auth: createMockAuth(), env });

    const res = await app.inject({ method: 'GET', url: '/api/v1/instance/info' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({
      instanceUuid: '11111111-1111-4111-8111-111111111111',
      name: 'Acme Smart Guide',
      logoUrl: null,
      defaultLocale: 'pt-BR',
      allowPublicSignup: false,
      authProviders: { emailPassword: true, google: true, microsoft: false },
      licenseConfigured: true,
      licenseKeyHint: 'sg_lic_s...3210',
    });
    expect(JSON.stringify(body)).not.toContain('sg_lic_secret_token_9876543210');
    expect(buildLicenseKeyHint(undefined)).toBeNull();
    expect(buildLicenseKeyHint('short')).toBe('****');
  });

  it('PATCH /api/v1/instance/settings requires admin role and updates settings', async () => {
    const { db } = createMockDb();
    const env = parseEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://smart_guide:secret@localhost:5432/smart_guide',
      BETTER_AUTH_SECRET: 'dev-secret-key-at-least-16-chars',
      CORS_ORIGINS: 'http://localhost:8080',
    });

    const app = Fastify();
    registerInstanceRoutes(app, { db, auth: createMockAuth(), env });

    const userAttempt = await app.inject({
      method: 'PATCH',
      url: '/api/v1/instance/settings',
      headers: { authorization: 'Bearer user-token' },
      payload: { siteName: 'Hacked Name' },
    });
    expect(userAttempt.statusCode).toBe(403);

    const adminUpdate = await app.inject({
      method: 'PATCH',
      url: '/api/v1/instance/settings',
      headers: { authorization: 'Bearer admin-token' },
      payload: {
        siteName: 'Global Academy',
        defaultLocale: 'en',
        allowPublicSignup: true,
        logoUrl: '/api/v1/media/instance-assets/logo.png',
      },
    });
    expect(adminUpdate.statusCode).toBe(200);
    expect(adminUpdate.json().settings).toMatchObject({
      siteName: 'Global Academy',
      defaultLocale: 'en',
      allowPublicSignup: true,
      logoUrl: '/api/v1/media/instance-assets/logo.png',
    });
  });

  it('supports Categories CRUD with auth/admin RBAC, validation, duplicate 409, and delete', async () => {
    const { db } = createMockDb();
    const app = Fastify();
    registerCategoryRoutes(app, { db, auth: createMockAuth() });

    const unauth = await app.inject({ method: 'GET', url: '/api/v1/categories' });
    expect(unauth.statusCode).toBe(401);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/categories',
      headers: { authorization: 'Bearer user-token' },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().categories).toHaveLength(1);

    const userCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: { authorization: 'Bearer user-token' },
      payload: { name: 'HR' },
    });
    expect(userCreate.statusCode).toBe(403);

    const dupCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: { authorization: 'Bearer admin-token' },
      payload: { name: 'Onboarding' },
    });
    expect(dupCreate.statusCode).toBe(409);
    expect(dupCreate.json().errorCode).toBe('CATEGORY_ALREADY_EXISTS');

    const createdRes = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: { authorization: 'Bearer admin-token' },
      payload: { name: 'Compliance', color: '#10B981', icon: 'shield-outline' },
    });
    expect(createdRes.statusCode).toBe(201);
    const createdId = createdRes.json().category.id as string;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/categories/${createdId}`,
      headers: { authorization: 'Bearer admin-token' },
      payload: { color: '#F59E0B' },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().category.color).toBe('#F59E0B');

    const badIdRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/categories/not-a-uuid',
      headers: { authorization: 'Bearer admin-token' },
    });
    expect(badIdRes.statusCode).toBe(400);

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/categories/${createdId}`,
      headers: { authorization: 'Bearer admin-token' },
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json()).toMatchObject({ deleted: true });
  });
});

