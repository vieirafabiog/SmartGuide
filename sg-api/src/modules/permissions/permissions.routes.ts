import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthInstance } from '../../auth/auth.js';
import { createAuthGuards } from '../../auth/guards.js';
import { canManageTrainingOwnership } from '../../auth/permissions.js';
import type { Database } from '../../db/index.js';
import {
  PERMISSION_LEVELS,
  trainingPermissions,
  trainings,
  user,
  type PermissionLevel,
} from '../../db/schema/index.js';

export interface TrainingPermissionRecord {
  id: string;
  trainingId: string;
  userId: string;
  userName: string;
  userEmail: string;
  userImage: string | null;
  permission: PermissionLevel;
  createdAt: Date;
}

export interface TrainingOwnershipContext {
  id: string;
  createdBy: string;
  creatorName: string | null;
  creatorEmail: string | null;
  actorPermission: PermissionLevel | null;
}

export interface PermissionsRepository {
  getTrainingOwnershipContext(
    trainingId: string,
    actorId: string,
  ): Promise<TrainingOwnershipContext | null>;
  userExists(userId: string): Promise<boolean>;
  listPermissions(trainingId: string): Promise<TrainingPermissionRecord[]>;
  upsertPermission(input: {
    trainingId: string;
    userId: string;
    permission: PermissionLevel;
  }): Promise<TrainingPermissionRecord>;
  removePermission(trainingId: string, userId: string): Promise<boolean>;
}

const trainingIdParamSchema = z.object({
  id: z.string().uuid(),
});

const trainingUserParamSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1),
});

const grantPermissionSchema = z.object({
  userId: z.string().min(1),
  permission: z.enum(PERMISSION_LEVELS),
});

const updatePermissionSchema = z.object({
  permission: z.enum(PERMISSION_LEVELS),
});

/**
 * Creates a Drizzle-backed PermissionsRepository for training sharing.
 */
export function createDrizzlePermissionsRepository(db: Database): PermissionsRepository {
  return {
    async getTrainingOwnershipContext(trainingId, actorId) {
      const rows = await db
        .select({
          id: trainings.id,
          createdBy: trainings.createdBy,
          creatorName: user.name,
          creatorEmail: user.email,
        })
        .from(trainings)
        .leftJoin(user, eq(trainings.createdBy, user.id))
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
        creatorName: training.creatorName ?? null,
        creatorEmail: training.creatorEmail ?? null,
        actorPermission: permRows[0]?.permission ?? null,
      };
    },

    async userExists(userId) {
      const rows = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      return Boolean(rows[0]);
    },

    async listPermissions(trainingId) {
      return db
        .select({
          id: trainingPermissions.id,
          trainingId: trainingPermissions.trainingId,
          userId: trainingPermissions.userId,
          userName: user.name,
          userEmail: user.email,
          userImage: user.image,
          permission: trainingPermissions.permission,
          createdAt: trainingPermissions.createdAt,
        })
        .from(trainingPermissions)
        .innerJoin(user, eq(trainingPermissions.userId, user.id))
        .where(eq(trainingPermissions.trainingId, trainingId))
        .orderBy(asc(user.name), asc(trainingPermissions.createdAt));
    },

    async upsertPermission(input) {
      await db
        .insert(trainingPermissions)
        .values({
          trainingId: input.trainingId,
          userId: input.userId,
          permission: input.permission,
        })
        .onConflictDoUpdate({
          target: [trainingPermissions.trainingId, trainingPermissions.userId],
          set: { permission: input.permission },
        });

      const rows = await db
        .select({
          id: trainingPermissions.id,
          trainingId: trainingPermissions.trainingId,
          userId: trainingPermissions.userId,
          userName: user.name,
          userEmail: user.email,
          userImage: user.image,
          permission: trainingPermissions.permission,
          createdAt: trainingPermissions.createdAt,
        })
        .from(trainingPermissions)
        .innerJoin(user, eq(trainingPermissions.userId, user.id))
        .where(
          and(
            eq(trainingPermissions.trainingId, input.trainingId),
            eq(trainingPermissions.userId, input.userId),
          ),
        )
        .limit(1);

      const record = rows[0];
      if (!record) {
        throw new Error('Failed to load upserted training permission');
      }
      return record;
    },

    async removePermission(trainingId, userId) {
      const deleted = await db
        .delete(trainingPermissions)
        .where(
          and(
            eq(trainingPermissions.trainingId, trainingId),
            eq(trainingPermissions.userId, userId),
          ),
        )
        .returning({ id: trainingPermissions.id });

      return Boolean(deleted[0]);
    },
  };
}

export interface PermissionsRoutesOptions {
  repository?: PermissionsRepository;
}

/**
 * Registers training sharing & permission management routes, protecting the
 * training creator from removal or permission downgrade.
 */
export function registerPermissionRoutes(
  app: FastifyInstance,
  deps: { db: Database; auth: AuthInstance },
  options?: PermissionsRoutesOptions,
): void {
  const guards = createAuthGuards(deps.auth);
  const repo = options?.repository ?? createDrizzlePermissionsRepository(deps.db);

  app.get(
    '/api/v1/trainings/:id/permissions',
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
      const context = await repo.getTrainingOwnershipContext(params.data.id, actor.id);
      if (!context) {
        return reply.code(404).send({
          errorCode: 'TRAINING_NOT_FOUND',
          message: 'Training not found',
        });
      }

      if (
        !canManageTrainingOwnership(
          actor.role,
          actor.id,
          { createdBy: context.createdBy },
          context.actorPermission,
        )
      ) {
        return reply.code(403).send({
          errorCode: 'FORBIDDEN',
          message: 'You do not have permission to manage sharing for this training',
        });
      }

      const permissions = await repo.listPermissions(params.data.id);
      return reply.code(200).send({
        creator: {
          id: context.createdBy,
          name: context.creatorName,
          email: context.creatorEmail,
        },
        permissions,
      });
    },
  );

  app.post(
    '/api/v1/trainings/:id/permissions',
    { preHandler: [guards.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = trainingIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'Training id must be a valid UUID',
        });
      }

      const parsed = grantPermissionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const actor = request.currentUser!;
      const context = await repo.getTrainingOwnershipContext(params.data.id, actor.id);
      if (!context) {
        return reply.code(404).send({
          errorCode: 'TRAINING_NOT_FOUND',
          message: 'Training not found',
        });
      }

      if (
        !canManageTrainingOwnership(
          actor.role,
          actor.id,
          { createdBy: context.createdBy },
          context.actorPermission,
        )
      ) {
        return reply.code(403).send({
          errorCode: 'FORBIDDEN',
          message: 'You do not have permission to manage sharing for this training',
        });
      }

      if (parsed.data.userId === context.createdBy) {
        return reply.code(400).send({
          errorCode: 'CREATOR_IMMUTABLE',
          message: 'Training creator ownership cannot be modified or removed',
        });
      }

      const targetExists = await repo.userExists(parsed.data.userId);
      if (!targetExists) {
        return reply.code(404).send({
          errorCode: 'USER_NOT_FOUND',
          message: 'Target user not found',
        });
      }

      const permission = await repo.upsertPermission({
        trainingId: params.data.id,
        userId: parsed.data.userId,
        permission: parsed.data.permission,
      });

      return reply.code(200).send({ permission });
    },
  );

  app.patch(
    '/api/v1/trainings/:id/permissions/:userId',
    { preHandler: [guards.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = trainingUserParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'Invalid training or user id',
        });
      }

      const parsed = updatePermissionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const actor = request.currentUser!;
      const context = await repo.getTrainingOwnershipContext(params.data.id, actor.id);
      if (!context) {
        return reply.code(404).send({
          errorCode: 'TRAINING_NOT_FOUND',
          message: 'Training not found',
        });
      }

      if (
        !canManageTrainingOwnership(
          actor.role,
          actor.id,
          { createdBy: context.createdBy },
          context.actorPermission,
        )
      ) {
        return reply.code(403).send({
          errorCode: 'FORBIDDEN',
          message: 'You do not have permission to manage sharing for this training',
        });
      }

      if (params.data.userId === context.createdBy) {
        return reply.code(400).send({
          errorCode: 'CREATOR_IMMUTABLE',
          message: 'Training creator ownership cannot be modified or removed',
        });
      }

      const targetExists = await repo.userExists(params.data.userId);
      if (!targetExists) {
        return reply.code(404).send({
          errorCode: 'USER_NOT_FOUND',
          message: 'Target user not found',
        });
      }

      const permission = await repo.upsertPermission({
        trainingId: params.data.id,
        userId: params.data.userId,
        permission: parsed.data.permission,
      });

      return reply.code(200).send({ permission });
    },
  );

  app.delete(
    '/api/v1/trainings/:id/permissions/:userId',
    { preHandler: [guards.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = trainingUserParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'Invalid training or user id',
        });
      }

      const actor = request.currentUser!;
      const context = await repo.getTrainingOwnershipContext(params.data.id, actor.id);
      if (!context) {
        return reply.code(404).send({
          errorCode: 'TRAINING_NOT_FOUND',
          message: 'Training not found',
        });
      }

      if (
        !canManageTrainingOwnership(
          actor.role,
          actor.id,
          { createdBy: context.createdBy },
          context.actorPermission,
        )
      ) {
        return reply.code(403).send({
          errorCode: 'FORBIDDEN',
          message: 'You do not have permission to manage sharing for this training',
        });
      }

      if (params.data.userId === context.createdBy) {
        return reply.code(400).send({
          errorCode: 'CREATOR_IMMUTABLE',
          message: 'Training creator cannot be removed from training permissions',
        });
      }

      const removed = await repo.removePermission(params.data.id, params.data.userId);
      if (!removed) {
        return reply.code(404).send({
          errorCode: 'PERMISSION_NOT_FOUND',
          message: 'Permission entry not found',
        });
      }

      return reply.code(200).send({
        deleted: true,
        trainingId: params.data.id,
        userId: params.data.userId,
      });
    },
  );
}

