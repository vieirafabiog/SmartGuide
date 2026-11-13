import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AuthInstance } from '../src/auth/auth.js';
import type { Database } from '../src/db/index.js';
import type { PermissionLevel, TrainingStatus, UserRole } from '../src/db/schema/index.js';
import { registerTrainingRoutes } from '../src/modules/trainings/trainings.routes.js';
import {
  extractTrainingCoverStorageKey,
  type TrainingCategorySummary,
  type TrainingRecord,
  type TrainingsRepository,
} from '../src/modules/trainings/trainings.service.js';
import type { StorageConnector } from '../src/storage/index.js';

interface TestUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
}

interface StoredTraining {
  id: string;
  title: string;
  description: string;
  coverUrl: string | null;
  status: TrainingStatus;
  isPublic: boolean;
  createdBy: string;
  categoryIds: string[];
  attachmentStorageKeys: string[];
  stepCount: number;
  createdAt: Date;
  updatedAt: Date;
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

function createMockStorage(): StorageConnector {
  return {
    driver: 'local',
    putObject: vi.fn(),
    getObjectStream: vi.fn(),
    headObject: vi.fn(),
    deleteObject: vi.fn(async () => undefined),
    deleteObjects: vi.fn(async () => undefined),
    healthcheck: vi.fn(async () => true),
  };
}

function createInMemoryTrainingsRepo(opts: {
  categories: TrainingCategorySummary[];
  users: Record<string, string>;
  seedTrainings?: StoredTraining[];
  permissions?: Array<{ trainingId: string; userId: string; permission: PermissionLevel }>;
}): TrainingsRepository {
  const categoryMap = new Map(opts.categories.map((c) => [c.id, c]));
  const rows: StoredTraining[] = [...(opts.seedTrainings ?? [])];
  const permissions = [...(opts.permissions ?? [])];

  function getPermission(trainingId: string, userId: string): PermissionLevel | null {
    return (
      permissions.find((p) => p.trainingId === trainingId && p.userId === userId)
        ?.permission ?? null
    );
  }

  function toRecord(row: StoredTraining, actorId: string): TrainingRecord {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      coverUrl: row.coverUrl,
      status: row.status,
      isPublic: row.isPublic,
      createdBy: row.createdBy,
      creatorName: opts.users[row.createdBy] ?? null,
      categories: row.categoryIds
        .map((id) => categoryMap.get(id))
        .filter((cat): cat is TrainingCategorySummary => Boolean(cat)),
      stepCount: row.stepCount,
      permissionLevel: getPermission(row.id, actorId),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  return {
    async listTrainings(input) {
      const q = input.search?.trim().toLowerCase();
      const filtered = rows.filter((row) => {
        if (input.actorRole !== 'admin') {
          const isPublishedPublic = row.status === 'published' && row.isPublic;
          const isOwner = row.createdBy === input.actorId;
          const isShared = getPermission(row.id, input.actorId) !== null;
          if (!isPublishedPublic && !isOwner && !isShared) return false;
        }
        if (input.status !== undefined && row.status !== input.status) return false;
        if (input.isPublic !== undefined && row.isPublic !== input.isPublic) return false;
        if (input.categoryId !== undefined && !row.categoryIds.includes(input.categoryId)) {
          return false;
        }
        if (
          q &&
          !row.title.toLowerCase().includes(q) &&
          !row.description.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      });

      const start = (input.page - 1) * input.pageSize;
      const sliced = filtered.slice(start, start + input.pageSize);
      return {
        trainings: sliced.map((row) => toRecord(row, input.actorId)),
        pagination: {
          page: input.page,
          pageSize: input.pageSize,
          total: filtered.length,
          totalPages:
            filtered.length === 0 ? 0 : Math.ceil(filtered.length / input.pageSize),
        },
      };
    },

    async findByIdForActor(trainingId, actorId) {
      const row = rows.find((item) => item.id === trainingId);
      return row ? toRecord(row, actorId) : null;
    },

    async getAccessSnapshot(trainingId, actorId) {
      const row = rows.find((item) => item.id === trainingId);
      if (!row) return null;
      return {
        id: row.id,
        createdBy: row.createdBy,
        status: row.status,
        isPublic: row.isPublic,
        coverUrl: row.coverUrl,
        permissionLevel: getPermission(row.id, actorId),
      };
    },

    async countExistingCategories(categoryIds) {
      return categoryIds.filter((id) => categoryMap.has(id)).length;
    },

    async createTraining(input) {
      const now = new Date();
      const created: StoredTraining = {
        id: randomUUID(),
        title: input.title,
        description: input.description,
        coverUrl: input.coverUrl,
        status: input.status,
        isPublic: input.isPublic,
        createdBy: input.createdBy,
        categoryIds: [...input.categoryIds],
        attachmentStorageKeys: [],
        stepCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(created);
      return toRecord(created, input.createdBy);
    },

    async updateTraining(trainingId, actorId, patch, categoryIds) {
      const target = rows.find((item) => item.id === trainingId);
      if (!target) return null;
      Object.assign(target, patch, { updatedAt: new Date() });
      if (categoryIds !== undefined) {
        target.categoryIds = [...categoryIds];
      }
      return toRecord(target, actorId);
    },

    async deleteTrainingAndCollectMedia(trainingId) {
      const idx = rows.findIndex((item) => item.id === trainingId);
      if (idx === -1) {
        return { deleted: false, coverUrl: null, attachmentStorageKeys: [] };
      }
      const [removed] = rows.splice(idx, 1);
      if (!removed) {
        return { deleted: false, coverUrl: null, attachmentStorageKeys: [] };
      }
      return {
        deleted: true,
        coverUrl: removed.coverUrl,
        attachmentStorageKeys: [...removed.attachmentStorageKeys],
      };
    },
  };
}

describe('Trainings CRUD, Search, Visibility Isolation & Cascade Media Cleanup', () => {
  it('extracts training-covers storage keys safely from relative and absolute URLs', () => {
    expect(
      extractTrainingCoverStorageKey('/api/v1/media/training-covers/covers/2026/hero.webp?token=abc'),
    ).toBe('covers/2026/hero.webp');
    expect(
      extractTrainingCoverStorageKey(
        'https://guide.example.com/api/v1/media/training-covers/covers/banner%201.png',
      ),
    ).toBe('covers/banner 1.png');
    expect(extractTrainingCoverStorageKey('/api/v1/media/step-attachments/a.png')).toBeNull();
    expect(extractTrainingCoverStorageKey(null)).toBeNull();
  });

  it('enforces role/visibility isolation, HTML sanitization, category sync, and cascade storage cleanup', async () => {
    const adminUser: TestUser = {
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
      isActive: true,
    };
    const creatorUser: TestUser = {
      id: 'creator-1',
      email: 'creator@example.com',
      name: 'Creator One',
      role: 'creator',
      isActive: true,
    };
    const regularUser: TestUser = {
      id: 'user-1',
      email: 'viewer@example.com',
      name: 'Regular Viewer',
      role: 'user',
      isActive: true,
    };

    const catOps: TrainingCategorySummary = {
      id: randomUUID(),
      name: 'Operations',
      color: '#3B82F6',
      icon: 'wrench',
    };
    const catSec: TrainingCategorySummary = {
      id: randomUUID(),
      name: 'Security',
      color: '#10B981',
      icon: 'shield',
    };

    const publicPublishedId = randomUUID();
    const privateSharedId = randomUUID();
    const creatorDraftId = randomUUID();

    const seedTrainings: StoredTraining[] = [
      {
        id: publicPublishedId,
        title: 'Safety Onboarding',
        description: '<p>Public guide</p>',
        coverUrl: null,
        status: 'published',
        isPublic: true,
        createdBy: adminUser.id,
        categoryIds: [catOps.id],
        attachmentStorageKeys: [],
        stepCount: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: privateSharedId,
        title: 'Internal Incident Playbook',
        description: '<p>Shared confidential</p>',
        coverUrl: '/api/v1/media/training-covers/covers/playbook.png?token=xyz',
        status: 'published',
        isPublic: false,
        createdBy: creatorUser.id,
        categoryIds: [catSec.id],
        attachmentStorageKeys: ['attachments/step-1.png', 'attachments/step-2.mp4'],
        stepCount: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: creatorDraftId,
        title: 'Unfinished Draft',
        description: '<p>WIP</p>',
        coverUrl: null,
        status: 'draft',
        isPublic: true,
        createdBy: creatorUser.id,
        categoryIds: [],
        attachmentStorageKeys: [],
        stepCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const repo = createInMemoryTrainingsRepo({
      categories: [catOps, catSec],
      users: {
        [adminUser.id]: adminUser.name,
        [creatorUser.id]: creatorUser.name,
        [regularUser.id]: regularUser.name,
      },
      seedTrainings,
      permissions: [
        {
          trainingId: privateSharedId,
          userId: regularUser.id,
          permission: 'viewer',
        },
      ],
    });

    const storage = createMockStorage();
    const app = Fastify();
    registerTrainingRoutes(
      app,
      {
        db: {} as Database,
        auth: createFakeAuth({
          'tok-admin': adminUser,
          'tok-creator': creatorUser,
          'tok-user': regularUser,
        }),
        storage,
      },
      { repository: repo },
    );

    // Regular user cannot create trainings
    const forbiddenCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/trainings',
      headers: { authorization: 'Bearer tok-user' },
      payload: { title: 'Blocked' },
    });
    expect(forbiddenCreate.statusCode).toBe(403);

    // Regular user sees published+public + shared private, but NOT creatorDraftId
    const userList = await app.inject({
      method: 'GET',
      url: '/api/v1/trainings',
      headers: { authorization: 'Bearer tok-user' },
    });
    expect(userList.statusCode).toBe(200);
    const userIds = (userList.json().trainings as TrainingRecord[]).map((t) => t.id);
    expect(userIds).toEqual([publicPublishedId, privateSharedId]);

    // Regular user gets 403 on unshared draft detail
    const draftDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/trainings/${creatorDraftId}`,
      headers: { authorization: 'Bearer tok-user' },
    });
    expect(draftDetail.statusCode).toBe(403);

    // Admin sees all 3 seeded trainings
    const adminList = await app.inject({
      method: 'GET',
      url: '/api/v1/trainings',
      headers: { authorization: 'Bearer tok-admin' },
    });
    expect(adminList.statusCode).toBe(200);
    expect(adminList.json().pagination.total).toBe(3);

    // Search + category filter
    const filteredList = await app.inject({
      method: 'GET',
      url: `/api/v1/trainings?search=playbook&categoryId=${catSec.id}`,
      headers: { authorization: 'Bearer tok-user' },
    });
    expect(filteredList.statusCode).toBe(200);
    expect(filteredList.json().trainings).toHaveLength(1);
    expect(filteredList.json().trainings[0].id).toBe(privateSharedId);

    // Invalid categoryId rejected on POST
    const invalidCatRes = await app.inject({
      method: 'POST',
      url: '/api/v1/trainings',
      headers: { authorization: 'Bearer tok-creator' },
      payload: {
        title: 'Bad Cat',
        categoryIds: [randomUUID()],
      },
    });
    expect(invalidCatRes.statusCode).toBe(400);
    expect(invalidCatRes.json().errorCode).toBe('INVALID_CATEGORY');

    // Creator creates training with dirty HTML description -> sanitized + categories synced
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/trainings',
      headers: { authorization: 'Bearer tok-creator' },
      payload: {
        title: 'Forklift Safety',
        description:
          '<p onclick="alert(1)">Read carefully</p><script>evil()</script><a href="javascript:xss()">bad</a>',
        coverUrl: '/api/v1/media/training-covers/covers/forklift.webp',
        status: 'published',
        isPublic: true,
        categoryIds: [catOps.id, catOps.id],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const createdTraining = createRes.json().training as TrainingRecord;
    expect(createdTraining.description).toBe('<p>Read carefully</p>bad');
    expect(createdTraining.categories).toHaveLength(1);
    expect(createdTraining.categories[0]?.id).toBe(catOps.id);

    // Viewer permission cannot PATCH
    const viewerPatch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/trainings/${privateSharedId}`,
      headers: { authorization: 'Bearer tok-user' },
      payload: { title: 'Hacked Title' },
    });
    expect(viewerPatch.statusCode).toBe(403);

    // Creator updates own training + replaces categories + sanitizes HTML
    const creatorPatch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/trainings/${createdTraining.id}`,
      headers: { authorization: 'Bearer tok-creator' },
      payload: {
        description: '<h2>Updated</h2><img src=x onerror=alert(1)>',
        categoryIds: [catSec.id],
      },
    });
    expect(creatorPatch.statusCode).toBe(200);
    expect(creatorPatch.json().training.description).toBe('<h2>Updated</h2>');
    expect(creatorPatch.json().training.categories.map((c: TrainingCategorySummary) => c.id)).toEqual([
      catSec.id,
    ]);

    // Viewer cannot DELETE
    const viewerDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/trainings/${privateSharedId}`,
      headers: { authorization: 'Bearer tok-user' },
    });
    expect(viewerDelete.statusCode).toBe(403);

    // Creator deletes own training -> cascades cover + step attachments to StorageConnector
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/trainings/${privateSharedId}`,
      headers: { authorization: 'Bearer tok-creator' },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json()).toEqual({
      deleted: true,
      id: privateSharedId,
      cleanedCoverKey: 'covers/playbook.png',
      cleanedAttachmentKeys: ['attachments/step-1.png', 'attachments/step-2.mp4'],
    });
    expect(storage.deleteObject).toHaveBeenCalledWith(
      'training-covers',
      'covers/playbook.png',
    );
    expect(storage.deleteObjects).toHaveBeenCalledWith('step-attachments', [
      'attachments/step-1.png',
      'attachments/step-2.mp4',
    ]);

    await app.close();
  });
});

