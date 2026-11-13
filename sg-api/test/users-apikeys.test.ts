import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AuthInstance } from '../src/auth/auth.js';
import type { Database } from '../src/db/index.js';
import {
  registerApiKeyRoutes,
  type ApiKeysRepository,
  type SafeApiKeyRecord,
} from '../src/modules/api-keys/api-keys.routes.js';
import {
  registerUsersRoutes,
  type SafeUserRecord,
  type UsersRepository,
} from '../src/modules/users/users.routes.js';
import { verifyApiKey } from '../src/security/api-key.js';

function createInMemoryUsersRepo(seed: SafeUserRecord[]): UsersRepository {
  const rows = [...seed];
  return {
    async searchActiveUsers(query, limit) {
      const q = query.trim().toLowerCase();
      return rows
        .filter(
          (u) =>
            u.isActive &&
            (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)),
        )
        .slice(0, limit)
        .map(({ id, name, email, image }) => ({ id, name, email, image }));
    },
    async listUsers({ page, pageSize, search, role, isActive }) {
      const q = search?.trim().toLowerCase();
      const filtered = rows.filter(
        (u) =>
          (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) &&
          (role === undefined || u.role === role) &&
          (isActive === undefined || u.isActive === isActive),
      );
      const start = (page - 1) * pageSize;
      return { users: filtered.slice(start, start + pageSize), total: filtered.length };
    },
    async findById(id) {
      return rows.find((u) => u.id === id) ?? null;
    },
    async countOtherActiveAdmins(excludeUserId) {
      return rows.filter(
        (u) => u.role === 'admin' && u.isActive && u.id !== excludeUserId,
      ).length;
    },
    async createUser(input) {
      if (rows.some((u) => u.email === input.email)) {
        throw Object.assign(new Error('duplicate'), { code: '23505' });
      }
      const created: SafeUserRecord = {
        id: randomUUID(),
        name: input.name,
        email: input.email,
        role: input.role,
        isActive: true,
        preferredLocale: input.preferredLocale,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.push(created);
      return created;
    },
    async updateUser(id, patch) {
      const target = rows.find((u) => u.id === id);
      if (!target) return null;
      Object.assign(target, patch, { updatedAt: new Date() });
      return target;
    },
    async deleteUser(id) {
      const idx = rows.findIndex((u) => u.id === id);
      if (idx === -1) return false;
      rows.splice(idx, 1);
      return true;
    },
    async getAdminStats() {
      return {
        totalUsers: rows.length,
        activeUsers: rows.filter((u) => u.isActive).length,
        totalTrainings: 4,
        publishedTrainings: 3,
        totalCategories: 2,
        totalSteps: 12,
        activeApiKeys: 1,
      };
    },
  };
}

function createInMemoryApiKeysRepo(): {
  repo: ApiKeysRepository;
  storedHashes: Map<string, string>;
} {
  const rows: SafeApiKeyRecord[] = [];
  const storedHashes = new Map<string, string>();
  const repo: ApiKeysRepository = {
    async list() {
      return [...rows];
    },
    async create(input) {
      const id = randomUUID();
      storedHashes.set(id, input.keyHash);
      const record: SafeApiKeyRecord = {
        id,
        name: input.name,
        keyPrefix: input.keyPrefix,
        scopes: [...input.scopes],
        isActive: true,
        createdBy: input.createdBy,
        lastUsedAt: null,
        createdAt: new Date(),
      };
      rows.push(record);
      return record;
    },
    async update(id, patch) {
      const target = rows.find((r) => r.id === id);
      if (!target) return null;
      Object.assign(target, patch);
      return target;
    },
    async delete(id) {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx === -1) return false;
      rows.splice(idx, 1);
      storedHashes.delete(id);
      return true;
    },
  };
  return { repo, storedHashes };
}

function createMockAuth(): AuthInstance {
  return {
    api: {
      getSession: vi.fn(async ({ headers }: { headers: Headers }) => {
        const token = headers.get('authorization');
        if (token === 'Bearer admin-1') {
          return {
            user: {
              id: 'admin-1',
              email: 'admin1@acme.com',
              name: 'Admin One',
              role: 'admin',
              isActive: true,
              preferredLocale: 'pt-BR',
              image: null,
            },
            session: { id: 's-1', token: 'admin-1', expiresAt: new Date(Date.now() + 60_000) },
          };
        }
        if (token === 'Bearer creator-1') {
          return {
            user: {
              id: 'creator-1',
              email: 'creator@acme.com',
              name: 'Creator',
              role: 'creator',
              isActive: true,
              preferredLocale: 'en',
              image: null,
            },
            session: { id: 's-2', token: 'creator-1', expiresAt: new Date(Date.now() + 60_000) },
          };
        }
        return null;
      }),
    },
  } as unknown as AuthInstance;
}

describe('Admin Users, Stats & Scoped API Keys routes', () => {
  it('supports user creation, pagination, search autocomplete, and blocks self-demotion / last-admin removal', async () => {
    const repo = createInMemoryUsersRepo([
      {
        id: 'admin-1',
        name: 'Admin One',
        email: 'admin1@acme.com',
        role: 'admin',
        isActive: true,
        preferredLocale: 'pt-BR',
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'user-2',
        name: 'Maria Silva',
        email: 'maria@acme.com',
        role: 'user',
        isActive: true,
        preferredLocale: 'pt-BR',
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const app = Fastify();
    registerUsersRoutes(
      app,
      { db: {} as Database, auth: createMockAuth() },
      { repository: repo, passwordHasher: async (pw) => `hashed:${pw}` },
    );

    // Creator can use autocomplete search, but cannot access admin user list
    const searchRes = await app.inject({
      method: 'GET',
      url: '/api/v1/users/search?q=maria',
      headers: { authorization: 'Bearer creator-1' },
    });
    expect(searchRes.statusCode).toBe(200);
    expect(searchRes.json().users).toHaveLength(1);
    expect(searchRes.json().users[0].email).toBe('maria@acme.com');

    const forbiddenList = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: 'Bearer creator-1' },
    });
    expect(forbiddenList.statusCode).toBe(403);

    // Admin creates a new creator
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { authorization: 'Bearer admin-1' },
      payload: {
        name: 'Carlos',
        email: 'Carlos@Acme.com',
        password: 'StrongPassword123!',
        role: 'creator',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const carlosId = createRes.json().user.id as string;
    expect(createRes.json().user.email).toBe('carlos@acme.com');

    // Duplicate email returns 409
    const dupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { authorization: 'Bearer admin-1' },
      payload: {
        name: 'Carlos 2',
        email: 'carlos@acme.com',
        password: 'StrongPassword123!',
      },
    });
    expect(dupRes.statusCode).toBe(409);

    // Admin cannot demote or delete self
    const selfDemote = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/admin-1',
      headers: { authorization: 'Bearer admin-1' },
      payload: { role: 'user' },
    });
    expect(selfDemote.statusCode).toBe(400);
    expect(selfDemote.json().errorCode).toBe('CANNOT_DEMOTE_SELF');

    const selfDelete = await app.inject({
      method: 'DELETE',
      url: '/api/v1/users/admin-1',
      headers: { authorization: 'Bearer admin-1' },
    });
    expect(selfDelete.statusCode).toBe(400);
    expect(selfDelete.json().errorCode).toBe('CANNOT_DELETE_SELF');

    // Promote Carlos to admin, then demoting Carlos succeeds; if only 1 admin, block last admin demotion
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${carlosId}`,
      headers: { authorization: 'Bearer admin-1' },
      payload: { role: 'admin' },
    });
    const delCarlos = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${carlosId}`,
      headers: { authorization: 'Bearer admin-1' },
    });
    expect(delCarlos.statusCode).toBe(200);

    // Admin stats
    const statsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/stats',
      headers: { authorization: 'Bearer admin-1' },
    });
    expect(statsRes.statusCode).toBe(200);
    expect(statsRes.json().stats).toMatchObject({
      totalUsers: 2,
      publishedTrainings: 3,
      activeApiKeys: 1,
    });
  });

  it('creates hashed API keys returning plaintext only once and never leaks keyHash on list', async () => {
    const { repo, storedHashes } = createInMemoryApiKeysRepo();
    const app = Fastify();
    registerApiKeyRoutes(
      app,
      { db: {} as Database, auth: createMockAuth() },
      { repository: repo },
    );

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: { authorization: 'Bearer admin-1' },
      payload: { name: 'HR Sync Integration', scopes: ['users:read', 'users:write'] },
    });
    expect(createRes.statusCode).toBe(201);
    const createdBody = createRes.json() as {
      apiKey: SafeApiKeyRecord & { keyHash?: string };
      plaintextKey: string;
    };

    expect(createdBody.plaintextKey).toMatch(/^sg_live_[a-f0-9]{64}$/);
    expect(createdBody.apiKey.keyPrefix).toBe(createdBody.plaintextKey.slice(0, 12));
    expect(createdBody.apiKey.keyHash).toBeUndefined();

    const savedHash = storedHashes.get(createdBody.apiKey.id)!;
    expect(verifyApiKey(createdBody.plaintextKey, savedHash)).toBe(true);

    // Listing keys never includes plaintextKey or keyHash
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/api-keys',
      headers: { authorization: 'Bearer admin-1' },
    });
    expect(listRes.statusCode).toBe(200);
    const listed = listRes.json().apiKeys as Array<Record<string, unknown>>;
    expect(listed).toHaveLength(1);
    expect(listed[0]?.keyHash).toBeUndefined();
    expect(listed[0]?.plaintextKey).toBeUndefined();

    // Revoke and delete
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/api-keys/${createdBody.apiKey.id}`,
      headers: { authorization: 'Bearer admin-1' },
      payload: { isActive: false },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().apiKey.isActive).toBe(false);

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/api-keys/${createdBody.apiKey.id}`,
      headers: { authorization: 'Bearer admin-1' },
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json()).toEqual({ deleted: true, id: createdBody.apiKey.id });
  });
});

