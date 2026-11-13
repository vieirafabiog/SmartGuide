import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthInstance } from '../../auth/auth.js';
import { createAuthGuards } from '../../auth/guards.js';
import { canEditTraining, canViewTraining } from '../../auth/permissions.js';
import type { Database } from '../../db/index.js';
import {
  ATTACHMENT_TYPES,
  stepAttachments,
  trainingPermissions,
  trainings,
  trainingSteps,
  type AttachmentType,
} from '../../db/schema/index.js';
import type { StorageConnector } from '../../storage/index.js';
import type { TrainingAccessContext } from '../steps/steps.routes.js';

export interface AttachmentRecord {
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

export interface AttachmentsRepository {
  getStepTrainingContext(
    stepId: string,
    actorId: string,
  ): Promise<{ stepId: string; training: TrainingAccessContext } | null>;
  getAttachmentTrainingContext(
    attachmentId: string,
    actorId: string,
  ): Promise<{
    attachmentId: string;
    stepId: string;
    storageKey: string;
    training: TrainingAccessContext;
  } | null>;
  listByStep(stepId: string): Promise<AttachmentRecord[]>;
  createAttachment(input: {
    stepId: string;
    fileName: string;
    storageKey: string;
    fileUrl: string;
    fileType: AttachmentType;
    mimeType: string;
    fileSize: number;
    attOrder?: number;
  }): Promise<AttachmentRecord>;
  updateAttachment(
    attachmentId: string,
    patch: Partial<{ fileName: string; attOrder: number }>,
  ): Promise<AttachmentRecord | null>;
  deleteAttachment(attachmentId: string): Promise<{ deleted: boolean; storageKey: string | null }>;
  reorderAttachments(
    stepId: string,
    attachmentIds: readonly string[],
  ): Promise<
    { ok: true; attachments: AttachmentRecord[] } | { ok: false; reason: string }
  >;
}

const stepIdParamSchema = z.object({
  stepId: z.string().uuid(),
});

const attachmentIdParamSchema = z.object({
  attachmentId: z.string().uuid(),
});

const createAttachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  storageKey: z.string().trim().min(1).max(512),
  fileUrl: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine(
      (value) => value.startsWith('/api/v1/media/') || /^https?:\/\//i.test(value),
      'fileUrl must be an /api/v1/media/ path or http(s) URL',
    ),
  fileType: z.enum(ATTACHMENT_TYPES),
  mimeType: z.string().trim().min(1).max(120),
  fileSize: z.number().int().min(0),
  attOrder: z.number().int().min(0).optional(),
});

const updateAttachmentSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255).optional(),
    attOrder: z.number().int().min(0).optional(),
  })
  .refine((data) => data.fileName !== undefined || data.attOrder !== undefined, {
    message: 'At least one attachment field must be provided',
  });

const reorderAttachmentsSchema = z.object({
  attachmentIds: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * Creates a Drizzle-backed AttachmentsRepository with transactional ordering
 * and storage key retrieval on deletion.
 */
export function createDrizzleAttachmentsRepository(db: Database): AttachmentsRepository {
  async function loadTrainingContext(
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

  async function listByStep(stepId: string): Promise<AttachmentRecord[]> {
    return db
      .select()
      .from(stepAttachments)
      .where(eq(stepAttachments.stepId, stepId))
      .orderBy(asc(stepAttachments.attOrder), asc(stepAttachments.createdAt));
  }

  return {
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

      const training = await loadTrainingContext(stepRow.trainingId, actorId);
      if (!training) return null;

      return { stepId: stepRow.stepId, training };
    },

    async getAttachmentTrainingContext(attachmentId, actorId) {
      const rows = await db
        .select({
          attachmentId: stepAttachments.id,
          stepId: stepAttachments.stepId,
          storageKey: stepAttachments.storageKey,
          trainingId: trainingSteps.trainingId,
        })
        .from(stepAttachments)
        .innerJoin(trainingSteps, eq(stepAttachments.stepId, trainingSteps.id))
        .where(eq(stepAttachments.id, attachmentId))
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      const training = await loadTrainingContext(row.trainingId, actorId);
      if (!training) return null;

      return {
        attachmentId: row.attachmentId,
        stepId: row.stepId,
        storageKey: row.storageKey,
        training,
      };
    },

    listByStep,

    async createAttachment(input) {
      const nextOrder =
        input.attOrder !== undefined
          ? input.attOrder
          : Number(
              (
                await db
                  .select({
                    maxOrder: sql<number>`coalesce(max(${stepAttachments.attOrder}), -1)`,
                  })
                  .from(stepAttachments)
                  .where(eq(stepAttachments.stepId, input.stepId))
              )[0]?.maxOrder ?? -1,
            ) + 1;

      const inserted = await db
        .insert(stepAttachments)
        .values({
          stepId: input.stepId,
          fileName: input.fileName,
          storageKey: input.storageKey,
          fileUrl: input.fileUrl,
          fileType: input.fileType,
          mimeType: input.mimeType,
          fileSize: input.fileSize,
          attOrder: nextOrder,
        })
        .returning();

      const created = inserted[0];
      if (!created) {
        throw new Error('Failed to create step attachment');
      }
      return created;
    },

    async updateAttachment(attachmentId, patch) {
      const updated = await db
        .update(stepAttachments)
        .set(patch)
        .where(eq(stepAttachments.id, attachmentId))
        .returning();

      return updated[0] ?? null;
    },

    async deleteAttachment(attachmentId) {
      const deleted = await db
        .delete(stepAttachments)
        .where(eq(stepAttachments.id, attachmentId))
        .returning({ storageKey: stepAttachments.storageKey });

      const row = deleted[0];
      if (!row) {
        return { deleted: false, storageKey: null };
      }

      return { deleted: true, storageKey: row.storageKey };
    },

    async reorderAttachments(stepId, attachmentIds) {
      const uniqueIds = new Set(attachmentIds);
      if (uniqueIds.size !== attachmentIds.length) {
        return { ok: false, reason: 'attachmentIds must not contain duplicates' };
      }

      const reordered = await db.transaction(async (tx) => {
        const existing = await tx
          .select({ id: stepAttachments.id })
          .from(stepAttachments)
          .where(eq(stepAttachments.stepId, stepId));

        const existingIds = new Set(existing.map((r) => r.id));
        if (existingIds.size !== attachmentIds.length) {
          return false;
        }
        for (const id of attachmentIds) {
          if (!existingIds.has(id)) return false;
        }

        for (let index = 0; index < attachmentIds.length; index++) {
          const attachmentId = attachmentIds[index]!;
          await tx
            .update(stepAttachments)
            .set({ attOrder: index })
            .where(
              and(
                eq(stepAttachments.id, attachmentId),
                eq(stepAttachments.stepId, stepId),
              ),
            );
        }

        return true;
      });

      if (!reordered) {
        return {
          ok: false,
          reason: 'attachmentIds must match all attachments belonging to this step',
        };
      }

      const attachments = await listByStep(stepId);
      return { ok: true, attachments };
    },
  };
}

export interface AttachmentsRoutesOptions {
  repository?: AttachmentsRepository;
}

/**
 * Registers Step Attachments CRUD and transactional reordering routes.
 */
export function registerAttachmentRoutes(
  app: FastifyInstance,
  deps: { db: Database; auth: AuthInstance; storage: StorageConnector },
  options?: AttachmentsRoutesOptions,
): void {
  const guards = createAuthGuards(deps.auth);
  const repo = options?.repository ?? createDrizzleAttachmentsRepository(deps.db);

  app.get(
    '/api/v1/steps/:stepId/attachments',
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
        !canViewTraining(
          actor.role,
          actor.id,
          context.training,
          context.training.permissionLevel,
        )
      ) {
        return reply.code(403).send({
          errorCode: 'FORBIDDEN',
          message: 'You do not have permission to view attachments for this step',
        });
      }

      const attachments = await repo.listByStep(params.data.stepId);
      return reply.code(200).send({ attachments });
    },
  );

  app.post(
    '/api/v1/steps/:stepId/attachments',
    { preHandler: [guards.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = stepIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'Step id must be a valid UUID',
        });
      }

      const parsed = createAttachmentSchema.safeParse(request.body);
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
          message: 'You do not have permission to add attachments to this step',
        });
      }

      const attachment = await repo.createAttachment({
        stepId: params.data.stepId,
        fileName: parsed.data.fileName,
        storageKey: parsed.data.storageKey,
        fileUrl: parsed.data.fileUrl,
        fileType: parsed.data.fileType,
        mimeType: parsed.data.mimeType,
        fileSize: parsed.data.fileSize,
        attOrder: parsed.data.attOrder,
      });

      return reply.code(201).send({ attachment });
    },
  );

  app.put(
    '/api/v1/steps/:stepId/attachments/reorder',
    { preHandler: [guards.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = stepIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'Step id must be a valid UUID',
        });
      }

      const parsed = reorderAttachmentsSchema.safeParse(request.body);
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
          message: 'You do not have permission to reorder attachments for this step',
        });
      }

      const result = await repo.reorderAttachments(
        params.data.stepId,
        parsed.data.attachmentIds,
      );
      if (!result.ok) {
        return reply.code(400).send({
          errorCode: 'INVALID_ATTACHMENT_ORDER',
          message: result.reason,
        });
      }

      return reply.code(200).send({ attachments: result.attachments });
    },
  );

  app.patch(
    '/api/v1/attachments/:attachmentId',
    { preHandler: [guards.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = attachmentIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'Attachment id must be a valid UUID',
        });
      }

      const parsed = updateAttachmentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const actor = request.currentUser!;
      const context = await repo.getAttachmentTrainingContext(
        params.data.attachmentId,
        actor.id,
      );
      if (!context) {
        return reply.code(404).send({
          errorCode: 'ATTACHMENT_NOT_FOUND',
          message: 'Attachment not found',
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
          message: 'You do not have permission to edit this attachment',
        });
      }

      const patch: Partial<{ fileName: string; attOrder: number }> = {};
      if (parsed.data.fileName !== undefined) patch.fileName = parsed.data.fileName;
      if (parsed.data.attOrder !== undefined) patch.attOrder = parsed.data.attOrder;

      const attachment = await repo.updateAttachment(params.data.attachmentId, patch);
      if (!attachment) {
        return reply.code(404).send({
          errorCode: 'ATTACHMENT_NOT_FOUND',
          message: 'Attachment not found',
        });
      }

      return reply.code(200).send({ attachment });
    },
  );

  app.delete(
    '/api/v1/attachments/:attachmentId',
    { preHandler: [guards.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = attachmentIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'Attachment id must be a valid UUID',
        });
      }

      const actor = request.currentUser!;
      const context = await repo.getAttachmentTrainingContext(
        params.data.attachmentId,
        actor.id,
      );
      if (!context) {
        return reply.code(404).send({
          errorCode: 'ATTACHMENT_NOT_FOUND',
          message: 'Attachment not found',
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
          message: 'You do not have permission to delete this attachment',
        });
      }

      const result = await repo.deleteAttachment(params.data.attachmentId);
      if (!result.deleted) {
        return reply.code(404).send({
          errorCode: 'ATTACHMENT_NOT_FOUND',
          message: 'Attachment not found',
        });
      }

      if (result.storageKey) {
        await Promise.allSettled([
          deps.storage.deleteObject('step-attachments', result.storageKey),
        ]);
      }

      return reply.code(200).send({
        deleted: true,
        id: params.data.attachmentId,
        cleanedStorageKey: result.storageKey,
      });
    },
  );
}

