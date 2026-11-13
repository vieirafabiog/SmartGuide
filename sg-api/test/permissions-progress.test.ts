import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AuthInstance } from '../src/auth/auth.js';
import type { Database } from '../src/db/index.js';
import type { PermissionLevel, TrainingStatus, UserRole } from '../src/db/schema/index.js';
import {
  registerExternalApiRoutes,
  type ApiKeyAuthRecord,
  type ExternalApiRepository,
  type ExternalTrainingRecord,
  type ExternalUserRecord,
} from '../src/modules/integrations/external-api.routes.js';
import {
  registerPermissionRoutes,
  type PermissionsRepository,
  type TrainingPermissionRecord,
} from '../src/modules/permissions/permissions.routes.js';
import {
  registerProgressRoutes,
  type ProgressRepository,
  type StepProgressRecord,
} from '../src/modules/progress/progress.routes.js';
import { generateApiKey } from '../src/security/api-key.js';

interface TestUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
}

function createFakeAuth(usersByToken: Record<string, TestUser>): AuthInstance {
  return {
    api: {
      getSession: vi.fn(async ({ headers }: { headers: Headers }) => {
        const authHeader = headers.get('authorization');
        const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
        const found = token ? usersByToken[token] : undefined;
        if (!found) return null;
        return {
          user: {
            ...found,
            preferredLocale: 'pt-BR',
            image: null,
          },
          session: {
            id: `sess-${found.id}`,
            token: token!,
            expiresAt: new Date(Date.now() + 60_000),
          },
        };
      }),
    },
  } as unknown as AuthInstance;
}

describe('Sharing Permissions, Session-Bound Progress & Scoped External API', () => {
  it('manages training permissions while blocking creator removal, and binds progress strictly to session userId', async () => {
    const creatorUser: TestUser = {
      id: 'creator-1',
      email: 'creator@example.com',
      name: 'Creator Owner',
      role: 'creator',
      isActive: true,
    };
    const editorUser: TestUser = {
      id: 'editor-1',
      email: 'editor@example.com',
      name: 'Editor User',
      role: 'user',
      isActive: true,
    };
    const viewerUser: TestUser = {
      id: 'viewer-1',
      email: 'viewer@example.com',
      name: 'Viewer User',
      role: 'user',
      isActive: true,
    };
    const outsiderUser: TestUser = {
      id: 'outsider-1',
      email: 'outsider@example.com',
      name: 'Outsider',
      role: 'user',
      isActive: true,
    };

    const usersMap = new Map<string, TestUser>([
      [creatorUser.id, creatorUser],
      [editorUser.id, editorUser],
      [viewerUser.id, viewerUser],
      [outsiderUser.id, outsiderUser],
    ]);

    const trainingId = randomUUID();
    const otherTrainingId = randomUUID();
    const step1Id = randomUUID();
    const step2Id = randomUUID();
    const foreignStepId = randomUUID();

    const trainingData = {
      id: trainingId,
      createdBy: creatorUser.id,
      status: 'published' as TrainingStatus,
      isPublic: false,
    };

    const permRows: Array<{
      id: string;
      trainingId: string;
      userId: string;
      permission: PermissionLevel;
      createdAt: Date;
    }> = [
      {
        id: randomUUID(),
        trainingId,
        userId: editorUser.id,
        permission: 'editor',
        createdAt: new Date(),
      },
    ];

    const progressRows: StepProgressRecord[] = [];

    const permissionsRepo: PermissionsRepository = {
      async getTrainingOwnershipContext(id, actorId) {
        if (id !== trainingId) return null;
        const perm =
          permRows.find((p) => p.trainingId === id && p.userId === actorId)
            ?.permission ?? null;
        return {
          id: trainingData.id,
          createdBy: trainingData.createdBy,
          creatorName: creatorUser.name,
          creatorEmail: creatorUser.email,
          actorPermission: perm,
        };
      },
      async userExists(userId) {
        return usersMap.has(userId);
      },
      async listPermissions(id) {
        return permRows
          .filter((p) => p.trainingId === id)
          .map((p): TrainingPermissionRecord => {
            const u = usersMap.get(p.userId)!;
            return {
              id: p.id,
              trainingId: p.trainingId,
              userId: p.userId,
              userName: u.name,
              userEmail: u.email,
              userImage: null,
              permission: p.permission,
              createdAt: p.createdAt,
            };
          });
      },
      async upsertPermission(input) {
        const existing = permRows.find(
          (p) => p.trainingId === input.trainingId && p.userId === input.userId,
        );
        if (existing) {
          existing.permission = input.permission;
        } else {
          permRows.push({
            id: randomUUID(),
            trainingId: input.trainingId,
            userId: input.userId,
            permission: input.permission,
            createdAt: new Date(),
          });
        }
        const list = await this.listPermissions(input.trainingId);
        return list.find((p) => p.userId === input.userId)!;
      },
      async removePermission(id, userId) {
        const idx = permRows.findIndex(
          (p) => p.trainingId === id && p.userId === userId,
        );
        if (idx === -1) return false;
        permRows.splice(idx, 1);
        return true;
      },
    };

    const stepsData = [
      { id: step1Id, trainingId, stepOrder: 0, title: 'Step 1' },
      { id: step2Id, trainingId, stepOrder: 1, title: 'Step 2' },
      { id: foreignStepId, trainingId: otherTrainingId, stepOrder: 0, title: 'Foreign' },
    ];

    const progressRepo: ProgressRepository = {
      async getTrainingContext(id, actorId) {
        if (id !== trainingId) return null;
        const perm =
          permRows.find((p) => p.trainingId === id && p.userId === actorId)
            ?.permission ?? null;
        return { ...trainingData, permissionLevel: perm };
      },
      async stepBelongsToTraining(tId, sId) {
        return stepsData.some((s) => s.id === sId && s.trainingId === tId);
      },
      async getProgressSummary(tId, userId) {
        const tSteps = stepsData.filter((s) => s.trainingId === tId);
        const mapped = tSteps.map((s) => {
          const entry = progressRows.find(
            (r) => r.trainingId === tId && r.stepId === s.id && r.userId === userId,
          );
          return {
            stepId: s.id,
            stepOrder: s.stepOrder,
            title: s.title,
            completed: entry?.completed ?? false,
            completedAt: entry?.completedAt ?? null,
            updatedAt: entry?.updatedAt ?? null,
          };
        });
        const completedSteps = mapped.filter((m) => m.completed).length;
        return {
          trainingId: tId,
          userId,
          totalSteps: mapped.length,
          completedSteps,
          percentage:
            mapped.length === 0 ? 0 : Math.round((completedSteps / mapped.length) * 100),
          steps: mapped,
        };
      },
      async upsertStepProgress(input) {
        const existing = progressRows.find(
          (r) => r.userId === input.userId && r.stepId === input.stepId,
        );
        const now = new Date();
        const completedAt = input.completed ? now : null;
        if (existing) {
          existing.completed = input.completed;
          existing.completedAt = completedAt;
          existing.updatedAt = now;
          return existing;
        }
        const created: StepProgressRecord = {
          id: randomUUID(),
          userId: input.userId,
          trainingId: input.trainingId,
          stepId: input.stepId,
          completed: input.completed,
          completedAt,
          updatedAt: now,
        };
        progressRows.push(created);
        return created;
      },
    };

    const auth = createFakeAuth({
      'tok-creator': creatorUser,
      'tok-editor': editorUser,
      'tok-viewer': viewerUser,
      'tok-outsider': outsiderUser,
    });

    const app = Fastify();
    registerPermissionRoutes(app, { db: {} as Database, auth }, { repository: permissionsRepo });
    registerProgressRoutes(app, { db: {} as Database, auth }, { repository: progressRepo });

    // Editor cannot manage permissions (owner+ only)
    const editorListPerm = await app.inject({
      method: 'GET',
      url: `/api/v1/trainings/${trainingId}/permissions`,
      headers: { authorization: 'Bearer tok-editor' },
    });
    expect(editorListPerm.statusCode).toBe(403);

    // Creator cannot be removed or downgraded
    const removeCreatorRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/trainings/${trainingId}/permissions/${creatorUser.id}`,
      headers: { authorization: 'Bearer tok-creator' },
    });
    expect(removeCreatorRes.statusCode).toBe(400);
    expect(removeCreatorRes.json().errorCode).toBe('CREATOR_IMMUTABLE');

    const modifyCreatorRes = await app.inject({
      method: 'POST',
      url: `/api/v1/trainings/${trainingId}/permissions`,
      headers: { authorization: 'Bearer tok-creator' },
      payload: { userId: creatorUser.id, permission: 'viewer' },
    });
    expect(modifyCreatorRes.statusCode).toBe(400);
    expect(modifyCreatorRes.json().errorCode).toBe('CREATOR_IMMUTABLE');

    // Creator grants viewer permission to viewerUser
    const grantRes = await app.inject({
      method: 'POST',
      url: `/api/v1/trainings/${trainingId}/permissions`,
      headers: { authorization: 'Bearer tok-creator' },
      payload: { userId: viewerUser.id, permission: 'viewer' },
    });
    expect(grantRes.statusCode).toBe(200);
    expect(grantRes.json().permission.permission).toBe('viewer');

    // Outsider without permission cannot record progress
    const outsiderProgress = await app.inject({
      method: 'PUT',
      url: `/api/v1/trainings/${trainingId}/steps/${step1Id}/progress`,
      headers: { authorization: 'Bearer tok-outsider' },
      payload: { completed: true },
    });
    expect(outsiderProgress.statusCode).toBe(403);

    // Foreign stepId rejected with 404
    const foreignStepProgress = await app.inject({
      method: 'PUT',
      url: `/api/v1/trainings/${trainingId}/steps/${foreignStepId}/progress`,
      headers: { authorization: 'Bearer tok-viewer' },
      payload: { completed: true },
    });
    expect(foreignStepProgress.statusCode).toBe(404);

    // Viewer records progress; spoofed userId in body is ignored and session userId is enforced
    const viewerProgress = await app.inject({
      method: 'PUT',
      url: `/api/v1/trainings/${trainingId}/steps/${step1Id}/progress`,
      headers: { authorization: 'Bearer tok-viewer' },
      payload: { completed: true, userId: outsiderUser.id },
    });
    expect(viewerProgress.statusCode).toBe(200);
    expect(viewerProgress.json().progress.userId).toBe(viewerUser.id);
    expect(viewerProgress.json().summary.percentage).toBe(50);
    expect(viewerProgress.json().summary.completedSteps).toBe(1);

    // Creator removes viewer permission
    const revokeRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/trainings/${trainingId}/permissions/${viewerUser.id}`,
      headers: { authorization: 'Bearer tok-creator' },
    });
    expect(revokeRes.statusCode).toBe(200);
    expect(revokeRes.json().deleted).toBe(true);

    await app.close();
  });

  it('authenticates /api/v1/ext/* strictly via x-api-key header, rejects query-string keys, and enforces scopes', async () => {
    const readOnlyKey = generateApiKey();
    const writeUsersKey = generateApiKey();
    const trainingReadKey = generateApiKey();

    const keyStore: ApiKeyAuthRecord[] = [
      {
        id: randomUUID(),
        keyHash: readOnlyKey.keyHash,
        scopes: ['users:read'],
        isActive: true,
      },
      {
        id: randomUUID(),
        keyHash: writeUsersKey.keyHash,
        scopes: ['users:read', 'users:write'],
        isActive: true,
      },
      {
        id: randomUUID(),
        keyHash: trainingReadKey.keyHash,
        scopes: ['trainings:read'],
        isActive: true,
      },
    ];

    const extUsers: ExternalUserRecord[] = [
      {
        id: randomUUID(),
        name: 'Existing User',
        email: 'existing@example.com',
        role: 'user',
        isActive: true,
        preferredLocale: 'pt-BR',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const extTrainings: ExternalTrainingRecord[] = [
      {
        id: randomUUID(),
        title: 'API Synced Training',
        description: '<p>Guide</p>',
        coverUrl: null,
        status: 'published',
        isPublic: true,
        createdBy: extUsers[0]!.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const extRepo: ExternalApiRepository = {
      async findApiKeyByHash(hash) {
        return keyStore.find((k) => k.keyHash === hash) ?? null;
      },
      async touchApiKeyLastUsed() {},
      async listUsers(page, pageSize) {
        const start = (page - 1) * pageSize;
        return { users: extUsers.slice(start, start + pageSize), total: extUsers.length };
      },
      async createUser(input) {
        if (extUsers.some((u) => u.email === input.email)) {
          throw Object.assign(new Error('duplicate'), { code: '23505' });
        }
        const created: ExternalUserRecord = {
          id: randomUUID(),
          name: input.name,
          email: input.email,
          role: input.role,
          isActive: true,
          preferredLocale: input.preferredLocale,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        extUsers.push(created);
        return created;
      },
      async updateUser(id, patch) {
        const target = extUsers.find((u) => u.id === id);
        if (!target) return null;
        Object.assign(target, patch, { updatedAt: new Date() });
        return target;
      },
      async listTrainings(page, pageSize) {
        const start = (page - 1) * pageSize;
        return {
          trainings: extTrainings.slice(start, start + pageSize),
          total: extTrainings.length,
        };
      },
    };

    const app = Fastify();
    registerExternalApiRoutes(
      app,
      { db: {} as Database },
      { repository: extRepo, hashPasswordFn: async (pwd) => `hashed:${pwd}` },
    );

    // Rejects query-string API key even if header is also sent
    const queryKeyRes = await app.inject({
      method: 'GET',
      url: `/api/v1/ext/users?apiKey=${readOnlyKey.plaintextKey}`,
      headers: { 'x-api-key': readOnlyKey.plaintextKey },
    });
    expect(queryKeyRes.statusCode).toBe(401);
    expect(queryKeyRes.json().errorCode).toBe('API_KEY_IN_QUERY_FORBIDDEN');

    // Missing header -> 401
    const missingRes = await app.inject({
      method: 'GET',
      url: '/api/v1/ext/users',
    });
    expect(missingRes.statusCode).toBe(401);

    // users:read key can read users, but gets 403 on users:write and trainings:read
    const readUsersRes = await app.inject({
      method: 'GET',
      url: '/api/v1/ext/users',
      headers: { 'x-api-key': readOnlyKey.plaintextKey },
    });
    expect(readUsersRes.statusCode).toBe(200);
    expect(readUsersRes.json().users).toHaveLength(1);

    const forbiddenWriteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/ext/users',
      headers: { 'x-api-key': readOnlyKey.plaintextKey },
      payload: {
        name: 'New',
        email: 'new@example.com',
        password: 'Password123!',
      },
    });
    expect(forbiddenWriteRes.statusCode).toBe(403);
    expect(forbiddenWriteRes.json().errorCode).toBe('INSUFFICIENT_SCOPE');

    // users:write key creates user
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/ext/users',
      headers: { 'x-api-key': writeUsersKey.plaintextKey },
      payload: {
        name: 'HR Sync User',
        email: 'hr@example.com',
        password: 'Password123!',
        role: 'creator',
      },
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().user.role).toBe('creator');

    // trainings:read key lists trainings
    const trainingsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/ext/trainings',
      headers: { 'x-api-key': trainingReadKey.plaintextKey },
    });
    expect(trainingsRes.statusCode).toBe(200);
    expect(trainingsRes.json().trainings).toHaveLength(1);

    await app.close();
  });
});

