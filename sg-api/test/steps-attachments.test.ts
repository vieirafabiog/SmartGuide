import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AuthInstance } from '../src/auth/auth.js';
import type { Database } from '../src/db/index.js';
import type { PermissionLevel, TrainingStatus, UserRole } from '../src/db/schema/index.js';
import {
  registerAttachmentRoutes,
  type AttachmentRecord,
  type AttachmentsRepository,
} from '../src/modules/attachments/attachments.routes.js';
import {
  registerStepsRoutes,
  type StepRecord,
  type StepsRepository,
  type TrainingAccessContext,
} from '../src/modules/steps/steps.routes.js';
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
  createdBy: string;
  status: TrainingStatus;
  isPublic: boolean;
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

function createInMemoryRepos(opts: {
  trainings: StoredTraining[];
  permissions: Array<{ trainingId: string; userId: string; permission: PermissionLevel }>;
}): { stepsRepo: StepsRepository; attachmentsRepo: AttachmentsRepository } {
  const steps: Array<Omit<StepRecord, 'attachments'>> = [];
  const attachments: AttachmentRecord[] = [];

  function getTrainingContext(
    trainingId: string,
    actorId: string,
  ): TrainingAccessContext | null {
    const training = opts.trainings.find((t) => t.id === trainingId);
    if (!training) return null;
    const perm =
      opts.permissions.find((p) => p.trainingId === trainingId && p.userId === actorId)
        ?.permission ?? null;
    return {
      ...training,
      permissionLevel: perm,
    };
  }

  function hydrateStep(step: Omit<StepRecord, 'attachments'>): StepRecord {
    const stepAtts = attachments
      .filter((a) => a.stepId === step.id)
      .sort((a, b) => a.attOrder - b.attOrder);
    return { ...step, attachments: stepAtts };
  }

  const stepsRepo: StepsRepository = {
    async getTrainingAccessContext(trainingId, actorId) {
      return getTrainingContext(trainingId, actorId);
    },

    async getStepTrainingContext(stepId, actorId) {
      const step = steps.find((s) => s.id === stepId);
      if (!step) return null;
      const training = getTrainingContext(step.trainingId, actorId);
      if (!training) return null;
      return { stepId: step.id, training };
    },

    async listStepsByTraining(trainingId) {
      return steps
        .filter((s) => s.trainingId === trainingId)
        .sort((a, b) => a.stepOrder - b.stepOrder)
        .map(hydrateStep);
    },

    async createStep(input) {
      const existingOrders = steps
        .filter((s) => s.trainingId === input.trainingId)
        .map((s) => s.stepOrder);
      const nextOrder =
        input.stepOrder !== undefined
          ? input.stepOrder
          : (existingOrders.length > 0 ? Math.max(...existingOrders) : -1) + 1;
      const now = new Date();
      const created: Omit<StepRecord, 'attachments'> = {
        id: randomUUID(),
        trainingId: input.trainingId,
        title: input.title,
        content: input.content,
        stepOrder: nextOrder,
        createdAt: now,
        updatedAt: now,
      };
      steps.push(created);
      return hydrateStep(created);
    },

    async updateStep(stepId, patch) {
      const target = steps.find((s) => s.id === stepId);
      if (!target) return null;
      Object.assign(target, patch, { updatedAt: new Date() });
      return hydrateStep(target);
    },

    async deleteStepAndCollectMedia(stepId) {
      const idx = steps.findIndex((s) => s.id === stepId);
      if (idx === -1) {
        return { deleted: false, attachmentStorageKeys: [] };
      }
      steps.splice(idx, 1);
      const removedKeys: string[] = [];
      for (let i = attachments.length - 1; i >= 0; i--) {
        const att = attachments[i];
        if (att && att.stepId === stepId) {
          removedKeys.push(att.storageKey);
          attachments.splice(i, 1);
        }
      }
      return { deleted: true, attachmentStorageKeys: removedKeys };
    },

    async reorderSteps(trainingId, stepIds) {
      const uniqueIds = new Set(stepIds);
      if (uniqueIds.size !== stepIds.length) {
        return { ok: false, reason: 'stepIds must not contain duplicates' };
      }
      const trainingSteps = steps.filter((s) => s.trainingId === trainingId);
      const existingIds = new Set(trainingSteps.map((s) => s.id));
      if (existingIds.size !== stepIds.length || stepIds.some((id) => !existingIds.has(id))) {
        return { ok: false, reason: 'stepIds must match all steps belonging to this training' };
      }
      stepIds.forEach((id, index) => {
        const step = trainingSteps.find((s) => s.id === id);
        if (step) {
          step.stepOrder = index;
          step.updatedAt = new Date();
        }
      });
      return {
        ok: true,
        steps: await this.listStepsByTraining(trainingId),
      };
    },
  };

  const attachmentsRepo: AttachmentsRepository = {
    async getStepTrainingContext(stepId, actorId) {
      return stepsRepo.getStepTrainingContext(stepId, actorId);
    },

    async getAttachmentTrainingContext(attachmentId, actorId) {
      const att = attachments.find((a) => a.id === attachmentId);
      if (!att) return null;
      const step = steps.find((s) => s.id === att.stepId);
      if (!step) return null;
      const training = getTrainingContext(step.trainingId, actorId);
      if (!training) return null;
      return {
        attachmentId: att.id,
        stepId: att.stepId,
        storageKey: att.storageKey,
        training,
      };
    },

    async listByStep(stepId) {
      return attachments
        .filter((a) => a.stepId === stepId)
        .sort((a, b) => a.attOrder - b.attOrder);
    },

    async createAttachment(input) {
      const existingOrders = attachments
        .filter((a) => a.stepId === input.stepId)
        .map((a) => a.attOrder);
      const nextOrder =
        input.attOrder !== undefined
          ? input.attOrder
          : (existingOrders.length > 0 ? Math.max(...existingOrders) : -1) + 1;
      const created: AttachmentRecord = {
        id: randomUUID(),
        stepId: input.stepId,
        fileName: input.fileName,
        storageKey: input.storageKey,
        fileUrl: input.fileUrl,
        fileType: input.fileType,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        attOrder: nextOrder,
        createdAt: new Date(),
      };
      attachments.push(created);
      return created;
    },

    async updateAttachment(attachmentId, patch) {
      const target = attachments.find((a) => a.id === attachmentId);
      if (!target) return null;
      Object.assign(target, patch);
      return target;
    },

    async deleteAttachment(attachmentId) {
      const idx = attachments.findIndex((a) => a.id === attachmentId);
      if (idx === -1) return { deleted: false, storageKey: null };
      const [removed] = attachments.splice(idx, 1);
      return { deleted: true, storageKey: removed?.storageKey ?? null };
    },

    async reorderAttachments(stepId, attachmentIds) {
      const uniqueIds = new Set(attachmentIds);
      if (uniqueIds.size !== attachmentIds.length) {
        return { ok: false, reason: 'attachmentIds must not contain duplicates' };
      }
      const stepAtts = attachments.filter((a) => a.stepId === stepId);
      const existingIds = new Set(stepAtts.map((a) => a.id));
      if (
        existingIds.size !== attachmentIds.length ||
        attachmentIds.some((id) => !existingIds.has(id))
      ) {
        return {
          ok: false,
          reason: 'attachmentIds must match all attachments belonging to this step',
        };
      }
      attachmentIds.forEach((id, index) => {
        const att = stepAtts.find((a) => a.id === id);
        if (att) {
          att.attOrder = index;
        }
      });
      return {
        ok: true,
        attachments: await this.listByStep(stepId),
      };
    },
  };

  return { stepsRepo, attachmentsRepo };
}

describe('Steps, Attachments & Transactional Reordering routes', () => {
  it('supports steps/attachments CRUD, transactional reordering, strict RBAC, and storage cleanup', async () => {
    const adminUser: TestUser = {
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      isActive: true,
    };
    const creatorUser: TestUser = {
      id: 'creator-1',
      email: 'creator@example.com',
      name: 'Creator',
      role: 'creator',
      isActive: true,
    };
    const editorUser: TestUser = {
      id: 'editor-1',
      email: 'editor@example.com',
      name: 'Editor',
      role: 'user',
      isActive: true,
    };
    const viewerUser: TestUser = {
      id: 'viewer-1',
      email: 'viewer@example.com',
      name: 'Viewer',
      role: 'user',
      isActive: true,
    };

    const trainingId = randomUUID();
    const { stepsRepo, attachmentsRepo } = createInMemoryRepos({
      trainings: [
        {
          id: trainingId,
          createdBy: creatorUser.id,
          status: 'published',
          isPublic: false,
        },
      ],
      permissions: [
        { trainingId, userId: editorUser.id, permission: 'editor' },
        { trainingId, userId: viewerUser.id, permission: 'viewer' },
      ],
    });

    const storage = createMockStorage();
    const auth = createFakeAuth({
      'tok-admin': adminUser,
      'tok-creator': creatorUser,
      'tok-editor': editorUser,
      'tok-viewer': viewerUser,
    });

    const app = Fastify();
    registerStepsRoutes(app, { db: {} as Database, auth, storage }, { repository: stepsRepo });
    registerAttachmentRoutes(
      app,
      { db: {} as Database, auth, storage },
      { repository: attachmentsRepo },
    );

    // Viewer cannot create steps
    const viewerCreateStep = await app.inject({
      method: 'POST',
      url: `/api/v1/trainings/${trainingId}/steps`,
      headers: { authorization: 'Bearer tok-viewer' },
      payload: { title: 'Blocked Step' },
    });
    expect(viewerCreateStep.statusCode).toBe(403);

    // Creator creates Step 1 (with XSS content sanitized) and Editor creates Step 2
    const step1Res = await app.inject({
      method: 'POST',
      url: `/api/v1/trainings/${trainingId}/steps`,
      headers: { authorization: 'Bearer tok-creator' },
      payload: {
        title: 'Inspect Equipment',
        content: '<p>Check brakes</p><script>alert(1)</script>',
      },
    });
    expect(step1Res.statusCode).toBe(201);
    const step1 = step1Res.json().step as StepRecord;
    expect(step1.content).toBe('<p>Check brakes</p>');
    expect(step1.stepOrder).toBe(0);

    const step2Res = await app.inject({
      method: 'POST',
      url: `/api/v1/trainings/${trainingId}/steps`,
      headers: { authorization: 'Bearer tok-editor' },
      payload: { title: 'Start Engine' },
    });
    expect(step2Res.statusCode).toBe(201);
    const step2 = step2Res.json().step as StepRecord;
    expect(step2.stepOrder).toBe(1);

    // Invalid step reorder (missing step1 or duplicate ID) returns 400
    const badReorder = await app.inject({
      method: 'PUT',
      url: `/api/v1/trainings/${trainingId}/steps/reorder`,
      headers: { authorization: 'Bearer tok-editor' },
      payload: { stepIds: [step2.id, step2.id] },
    });
    expect(badReorder.statusCode).toBe(400);
    expect(badReorder.json().errorCode).toBe('INVALID_STEP_ORDER');

    // Valid transactional step reorder swaps Step 2 -> 0, Step 1 -> 1
    const reorderStepsRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/trainings/${trainingId}/steps/reorder`,
      headers: { authorization: 'Bearer tok-editor' },
      payload: { stepIds: [step2.id, step1.id] },
    });
    expect(reorderStepsRes.statusCode).toBe(200);
    const reorderedSteps = reorderStepsRes.json().steps as StepRecord[];
    expect(reorderedSteps.map((s) => [s.id, s.stepOrder])).toEqual([
      [step2.id, 0],
      [step1.id, 1],
    ]);

    // Editor adds two attachments to Step 1
    const att1Res = await app.inject({
      method: 'POST',
      url: `/api/v1/steps/${step1.id}/attachments`,
      headers: { authorization: 'Bearer tok-editor' },
      payload: {
        fileName: 'diagram.png',
        storageKey: 'attachments/diagram.png',
        fileUrl: '/api/v1/media/step-attachments/attachments/diagram.png',
        fileType: 'image',
        mimeType: 'image/png',
        fileSize: 2048,
      },
    });
    expect(att1Res.statusCode).toBe(201);
    const att1 = att1Res.json().attachment as AttachmentRecord;

    const att2Res = await app.inject({
      method: 'POST',
      url: `/api/v1/steps/${step1.id}/attachments`,
      headers: { authorization: 'Bearer tok-creator' },
      payload: {
        fileName: 'walkthrough.mp4',
        storageKey: 'attachments/walkthrough.mp4',
        fileUrl: '/api/v1/media/step-attachments/attachments/walkthrough.mp4',
        fileType: 'video',
        mimeType: 'video/mp4',
        fileSize: 102400,
      },
    });
    expect(att2Res.statusCode).toBe(201);
    const att2 = att2Res.json().attachment as AttachmentRecord;

    // Viewer can read steps & attachments
    const viewerListSteps = await app.inject({
      method: 'GET',
      url: `/api/v1/trainings/${trainingId}/steps`,
      headers: { authorization: 'Bearer tok-viewer' },
    });
    expect(viewerListSteps.statusCode).toBe(200);
    expect(viewerListSteps.json().steps[1].attachments).toHaveLength(2);

    // Viewer cannot reorder attachments
    const viewerReorderAtt = await app.inject({
      method: 'PUT',
      url: `/api/v1/steps/${step1.id}/attachments/reorder`,
      headers: { authorization: 'Bearer tok-viewer' },
      payload: { attachmentIds: [att2.id, att1.id] },
    });
    expect(viewerReorderAtt.statusCode).toBe(403);

    // Editor reorders attachments
    const reorderAttRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/steps/${step1.id}/attachments/reorder`,
      headers: { authorization: 'Bearer tok-editor' },
      payload: { attachmentIds: [att2.id, att1.id] },
    });
    expect(reorderAttRes.statusCode).toBe(200);
    expect(
      (reorderAttRes.json().attachments as AttachmentRecord[]).map((a) => [a.id, a.attOrder]),
    ).toEqual([
      [att2.id, 0],
      [att1.id, 1],
    ]);

    // Admin deletes att1 -> deletes from step-attachments bucket
    const delAttRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/attachments/${att1.id}`,
      headers: { authorization: 'Bearer tok-admin' },
    });
    expect(delAttRes.statusCode).toBe(200);
    expect(storage.deleteObject).toHaveBeenCalledWith(
      'step-attachments',
      'attachments/diagram.png',
    );

    // Creator deletes step1 -> cleans up remaining attachment att2 from storage
    const delStepRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/steps/${step1.id}`,
      headers: { authorization: 'Bearer tok-creator' },
    });
    expect(delStepRes.statusCode).toBe(200);
    expect(delStepRes.json().cleanedAttachmentKeys).toEqual(['attachments/walkthrough.mp4']);
    expect(storage.deleteObjects).toHaveBeenCalledWith('step-attachments', [
      'attachments/walkthrough.mp4',
    ]);

    await app.close();
  });
});

