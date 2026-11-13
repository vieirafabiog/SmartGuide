import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthInstance } from '../../auth/auth.js';
import { createAuthGuards } from '../../auth/guards.js';
import { canEditTraining, canViewTraining } from '../../auth/permissions.js';
import type { Database } from '../../db/index.js';
import {
  stepAttachments,
  trainingPermissions,
  trainings,
  trainingSteps,
  type AttachmentType,
  type PermissionLevel,
  type TrainingStatus,
} from '../../db/schema/index.js';
import { sanitizeRichTextHtml } from '../../security/html-sanitizer.js';
import type { StorageConnector } from '../../storage/index.js';

export interface StepAttachmentSummary {
  id: string;
  stepId: string;
  fileName: string;
  storageKey: string;
  fileUrl: string;
  fileType: AttachmentType;
  mimeType: string;
  fileSize: number;
  attOrder: number;
  createdAt: Date;
}

export interface StepRecord {
  id: string;
  trainingId: string;
  title: string;
  content: string;
  stepOrder: number;
  attachments: StepAttachmentSummary[];
  createdAt: Date;
  updatedAt: Date;
}

export interface TrainingAccessContext {
  id: string;
  createdBy: string;
  status: TrainingStatus;
  isPublic: boolean;
  permissionLevel: PermissionLevel | null;
}

export interface StepsRepository {
  getTrainingAccessContext(
    trainingId: string,
    actorId: string,
  ): Promise<TrainingAccessContext | null>;
  getStepTrainingContext(
    stepId: string,
    actorId: string,
  ): Promise<{ stepId: string; training: TrainingAccessContext } | null>;
  listStepsByTraining(trainingId: string): Promise<StepRecord[]>;
  createStep(input: {
    trainingId: string;
    title: string;
    content: string;
    stepOrder?: number;
  }): Promise<StepRecord>;
  updateStep(
    stepId: string,
    patch: Partial<{ title: string; content: string; stepOrder: number }>,
  ): Promise<StepRecord | null>;
  deleteStepAndCollectMedia(stepId: string): Promise<{
    deleted: boolean;
    attachmentStorageKeys: string[];
  }>;
  reorderSteps(
    trainingId: string,
    stepIds: readonly string[],
  ): Promise<{ ok: true; steps: StepRecord[] } | { ok: false; reason: string }>;
}

const trainingIdParamSchema = z.object({
  id: z.string().uuid(),
});

const stepIdParamSchema = z.object({
  stepId: z.string().uuid(),
});

const createStepSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(100_000).optional(),
  stepOrder: z.number().int().min(0).optional(),
});

const updateStepSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().max(100_000).optional(),
    stepOrder: z.number().int().min(0).optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.content !== undefined ||
      data.stepOrder !== undefined,
    { message: 'At least one step field must be provided' },
  );

const reorderStepsSchema = z.object({
  stepIds: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * Creates a Drizzle-backed StepsRepository with transactional step ordering
 * and cascade attachment key lookup.
 */
export function createDrizzleStepsRepository(db: Database): StepsRepository {
  async function loadAttachmentsForSteps(
    stepIds: readonly string[],
  ): Promise<Map<string, StepAttachmentSummary[]>> {
    const map = new Map<string, StepAttachmentSummary[]>();
    if (stepIds.length === 0) return map;

    const rows = await db
      .select()
      .from(stepAttachments)
      .where(inArray(stepAttachments.stepId, [...stepIds]))
      .orderBy(asc(stepAttachments.attOrder), asc(stepAttachments.createdAt));

    for (const row of rows) {
      const list = map.get(row.stepId) ?? [];
      list.push({
        id: row.id,
        stepId: row.stepId,
        fileName: row.fileName,
        storageKey: row.storageKey,
        fileUrl: row.fileUrl,
        fileType: row.fileType,
        mimeType: row.mimeType,
        fileSize: row.fileSize,
        attOrder: row.attOrder,
        createdAt: row.createdAt,
      });
      map.set(row.stepId, list);
    }

    return map;
  }

  async function getTrainingAccessContext(
    trainingId: string,
    actorId: string,
  ): Promise<TrainingAccessContext | null> {
    const rows = await db
      .select({
        id: trainings.id,
        createdBy: trainings.createdBy,
        status: trainings.status,
        isPublic: trainings.isPublic,
      })
      .from(trainings)
      .where(eq(trainings.id, trainingId))
      .limit(1);

    const training = rows[0];
    if (!training) return null;

    const permRows = await db
      .select({ permission: trainingPermissions.permission })
      .from(trainingPermissions)
      .where(
        and(
          eq(trainingPermissions.trainingId, trainingId),
          eq(trainingPermissions.userId, actorId),
        ),
      )
      .limit(1);

    return {
      id: training.id,
      createdBy: training.createdBy,
      status: training.status,
      isPublic: training.isPublic,
      permissionLevel: permRows[0]?.permission ?? null,
    };
  }

  async function listStepsByTraining(trainingId: string): Promise<StepRecord[]> {
    const rows = await db
      .select()
      .from(trainingSteps)
      .where(eq(trainingSteps.trainingId, trainingId))
      .orderBy(asc(trainingSteps.stepOrder), asc(trainingSteps.createdAt));

    const attMap = await loadAttachmentsForSteps(rows.map((r) => r.id));
    return rows.map((row) => ({
      id: row.id,
      trainingId: row.trainingId,
      title: row.title,
      content: row.content,
      stepOrder: row.stepOrder,
      attachments: attMap.get(row.id) ?? [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  return {
    getTrainingAccessContext,

    async getStepTrainingContext(stepId, actorId) {
      const rows = await db
        .select({
          stepId: trainingSteps.id,
          trainingId: trainingSteps.trainingId,
        })
        .from(trainingSteps)
        .where(eq(trainingSteps.id, stepId))
        .limit(1);

      const stepRow = rows[0];
      if (!stepRow) return null;

      const training = await getTrainingAccessContext(stepRow.trainingId, actorId);
      if (!training) return null;

      return { stepId: stepRow.stepId, training };
    },

    listStepsByTraining,

    async createStep(input) {
      const nextOrder =
        input.stepOrder !== undefined
          ? input.stepOrder
          : Number(
              (
                await db
                  .select({
                    maxOrder: sql<number>`coalesce(max(${trainingSteps.stepOrder}), -1)`,
                  })
                  .from(trainingSteps)
                  .where(eq(trainingSteps.trainingId, input.trainingId))
              )[0]?.maxOrder ?? -1,
            ) + 1;

      const inserted = await db
        .insert(trainingSteps)
        .values({
          trainingId: input.trainingId,
          title: input.title,
          content: input.content,
          stepOrder: nextOrder,
        })
        .returning();

      const created = inserted[0];
      if (!created) {
        throw new Error('Failed to create training step');
      }

      return {
        id: created.id,
        trainingId: created.trainingId,
        title: created.title,
        content: created.content,
        stepOrder: created.stepOrder,
        attachments: [],
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      };
    },

    async updateStep(stepId, patch) {
      const updated = await db
        .update(trainingSteps)
        .set({
          ...patch,
          updatedAt: new Date(),
        })
        .where(eq(trainingSteps.id, stepId))
        .returning();

      const row = updated[0];
      if (!row) return null;

      const attMap = await loadAttachmentsForSteps([row.id]);
      return {
        id: row.id,
        trainingId: row.trainingId,
        title: row.title,
        content: row.content,
        stepOrder: row.stepOrder,
        attachments: attMap.get(row.id) ?? [],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },

    async deleteStepAndCollectMedia(stepId) {
      return db.transaction(async (tx) => {
        const attachmentRows = await tx
          .select({ storageKey: stepAttachments.storageKey })
          .from(stepAttachments)
          .where(eq(stepAttachments.stepId, stepId));

        const deletedRows = await tx
          .delete(trainingSteps)
          .where(eq(trainingSteps.id, stepId))
          .returning({ id: trainingSteps.id });

        if (!deletedRows[0]) {
          return { deleted: false, attachmentStorageKeys: [] };
        }

        return {
          deleted: true,
          attachmentStorageKeys: [
            ...new Set(attachmentRows.map((r) => r.storageKey).filter(Boolean)),
          ],
        };
      });
    },

    async reorderSteps(trainingId, stepIds) {
      const uniqueIds = new Set(stepIds);
      if (uniqueIds.size !== stepIds.length) {
        return { ok: false, reason: 'stepIds must not contain duplicates' };
      }

      const reordered = await db.transaction(async (tx) => {
        const existing = await tx
          .select({ id: trainingSteps.id })
          .from(trainingSteps)
          .where(eq(trainingSteps.trainingId, trainingId));

        const existingIds = new Set(existing.map((r) => r.id));
        if (existingIds.size !== stepIds.length) {
          return false;
        }
        for (const id of stepIds) {
          if (!existingIds.has(id)) return false;
        }

        const now = new Date();
        for (let index = 0; index < stepIds.length; index++) {
          const stepId = stepIds[index]!;
          await tx
            .update(trainingSteps)
            .set({ stepOrder: index, updatedAt: now })
            .where(
              and(
                eq(trainingSteps.id, stepId),
                eq(trainingSteps.trainingId, trainingId),
              ),
            );
        }

        return true;
      });

      if (!reordered) {
        return {
          ok: false,
          reason: 'stepIds must match all steps belonging to this training',
        };
      }

      const steps = await listStepsByTraining(trainingId);
      return { ok: true, steps };
    },
  };
}

export interface StepsRoutesOptions {
  repository?: StepsRepository;
}

/**
 * Registers Training Steps CRUD and transactional reordering routes.
 */
export function registerStepsRoutes(
  app: FastifyInstance,
  deps: { db: Database; auth: AuthInstance; storage: StorageConnector },
  options?: StepsRoutesOptions,
): void {
  const guards = createAuthGuards(deps.auth);
  const repo = options?.repository ?? createDrizzleStepsRepository(deps.db);

  app.get(
    '/api/v1/trainings/:id/steps',
    { preHandler: [guards.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = trainingIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'Training id must be a valid UUID',
        });
      }

      const actor = request.currentUser!;
      const training = await repo.getTrainingAccessContext(params.data.id, actor.id);
      if (!training) {
        return reply.code(404).send({
          errorCode: 'TRAINING_NOT_FOUND',
          message: 'Training not found',
        });
      }

      if (!canViewTraining(actor.role, actor.id, training, training.permissionLevel)) {
        return reply.code(403).send({
          errorCode: 'FORBIDDEN',
          message: 'You do not have permission to view steps for this training',
        });
      }

      const steps = await repo.listStepsByTraining(params.data.id);
      return reply.code(200).send({ steps });
    },
  );

  app.post(
    '/api/v1/trainings/:id/steps',
    { preHandler: [guards.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = trainingIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'Training id must be a valid UUID',
        });
      }

      const parsed = createStepSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const actor = request.currentUser!;
      const training = await repo.getTrainingAccessContext(params.data.id, actor.id);
      if (!training) {
        return reply.code(404).send({
          errorCode: 'TRAINING_NOT_FOUND',
          message: 'Training not found',
        });
      }

      if (!canEditTraining(actor.role, actor.id, training, training.permissionLevel)) {
        return reply.code(403).send({
          errorCode: 'FORBIDDEN',
          message: 'You do not have permission to create steps for this training',
        });
      }

      const step = await repo.createStep({
        trainingId: params.data.id,
        title: parsed.data.title,
        content: sanitizeRichTextHtml(parsed.data.content ?? ''),
        stepOrder: parsed.data.stepOrder,
      });

      return reply.code(201).send({ step });
    },
  );

  app.put(
    '/api/v1/trainings/:id/steps/reorder',
    { preHandler: [guards.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = trainingIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'Training id must be a valid UUID',
        });
      }

      const parsed = reorderStepsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const actor = request.currentUser!;
      const training = await repo.getTrainingAccessContext(params.data.id, actor.id);
      if (!training) {
        return reply.code(404).send({
          errorCode: 'TRAINING_NOT_FOUND',
          message: 'Training not found',
        });
      }

      if (!canEditTraining(actor.role, actor.id, training, training.permissionLevel)) {
        return reply.code(403).send({
          errorCode: 'FORBIDDEN',
          message: 'You do not have permission to reorder steps for this training',
        });
      }

      const result = await repo.reorderSteps(params.data.id, parsed.data.stepIds);
      if (!result.ok) {
        return reply.code(400).send({
          errorCode: 'INVALID_STEP_ORDER',
          message: result.reason,
        });
      }

      return reply.code(200).send({ steps: result.steps });
    },
  );

  app.patch(
    '/api/v1/steps/:stepId',
    { preHandler: [guards.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = stepIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'Step id must be a valid UUID',
        });
      }

      const parsed = updateStepSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const actor = request.currentUser!;
      const context = await repo.getStepTrainingContext(params.data.stepId, actor.id);
      if (!context) {
        return reply.code(404).send({
          errorCode: 'STEP_NOT_FOUND',
          message: 'Step not found',
        });
      }

      if (
        !canEditTraining(
          actor.role,
          actor.id,
          context.training,
          context.training.permissionLevel,
        )
      ) {
        return reply.code(403).send({
          errorCode: 'FORBIDDEN',
          message: 'You do not have permission to edit this step',
        });
      }

      const patch: Partial<{ title: string; content: string; stepOrder: number }> = {};
      if (parsed.data.title !== undefined) patch.title = parsed.data.title;
      if (parsed.data.content !== undefined) {
        patch.content = sanitizeRichTextHtml(parsed.data.content);
      }
      if (parsed.data.stepOrder !== undefined) patch.stepOrder = parsed.data.stepOrder;

      const step = await repo.updateStep(params.data.stepId, patch);
      if (!step) {
        return reply.code(404).send({
          errorCode: 'STEP_NOT_FOUND',
          message: 'Step not found',
        });
      }

      return reply.code(200).send({ step });
    },
  );

  app.delete(
    '/api/v1/steps/:stepId',
    { preHandler: [guards.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = stepIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'Step id must be a valid UUID',
        });
      }

      const actor = request.currentUser!;
      const context = await repo.getStepTrainingContext(params.data.stepId, actor.id);
      if (!context) {
        return reply.code(404).send({
          errorCode: 'STEP_NOT_FOUND',
          message: 'Step not found',
        });
      }

      if (
        !canEditTraining(
          actor.role,
          actor.id,
          context.training,
          context.training.permissionLevel,
        )
      ) {
        return reply.code(403).send({
          errorCode: 'FORBIDDEN',
          message: 'You do not have permission to delete this step',
        });
      }

      const result = await repo.deleteStepAndCollectMedia(params.data.stepId);
      if (!result.deleted) {
        return reply.code(404).send({
          errorCode: 'STEP_NOT_FOUND',
          message: 'Step not found',
        });
      }

      if (result.attachmentStorageKeys.length > 0) {
        await Promise.allSettled([
          deps.storage.deleteObjects('step-attachments', result.attachmentStorageKeys),
        ]);
      }

      return reply.code(200).send({
        deleted: true,
        id: params.data.stepId,
        cleanedAttachmentKeys: result.attachmentStorageKeys,
      });
    },
  );
}

