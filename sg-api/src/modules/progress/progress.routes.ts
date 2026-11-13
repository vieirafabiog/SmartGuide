import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthInstance } from '../../auth/auth.js';
import { createAuthGuards } from '../../auth/guards.js';
import { canViewTraining } from '../../auth/permissions.js';
import type { Database } from '../../db/index.js';
import {
  trainingPermissions,
  trainingProgress,
  trainings,
  trainingSteps,
  type PermissionLevel,
  type TrainingStatus,
} from '../../db/schema/index.js';

export interface StepProgressItem {
  stepId: string;
  stepOrder: number;
  title: string;
  completed: boolean;
  completedAt: Date | null;
  updatedAt: Date | null;
}

export interface TrainingProgressSummary {
  trainingId: string;
  userId: string;
  totalSteps: number;
  completedSteps: number;
  percentage: number;
  steps: StepProgressItem[];
}

export interface StepProgressRecord {
  id: string;
  userId: string;
  trainingId: string;
  stepId: string;
  completed: boolean;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface ProgressTrainingContext {
  id: string;
  createdBy: string;
  status: TrainingStatus;
  isPublic: boolean;
  permissionLevel: PermissionLevel | null;
}

export interface ProgressRepository {
  getTrainingContext(
    trainingId: string,
    actorId: string,
  ): Promise<ProgressTrainingContext | null>;
  stepBelongsToTraining(trainingId: string, stepId: string): Promise<boolean>;
  getProgressSummary(
    trainingId: string,
    userId: string,
  ): Promise<TrainingProgressSummary>;
  upsertStepProgress(input: {
    userId: string;
    trainingId: string;
    stepId: string;
    completed: boolean;
  }): Promise<StepProgressRecord>;
}

const trainingIdParamSchema = z.object({
  id: z.string().uuid(),
});

const stepProgressParamSchema = z.object({
  id: z.string().uuid(),
  stepId: z.string().uuid(),
});

const updateStepProgressBodySchema = z.object({
  completed: z.boolean(),
});

/**
 * Creates a Drizzle-backed ProgressRepository for session-bound user progress.
 */
export function createDrizzleProgressRepository(db: Database): ProgressRepository {
  async function getProgressSummary(
    trainingId: string,
    userId: string,
  ): Promise<TrainingProgressSummary> {
    const stepRows = await db
      .select({
        id: trainingSteps.id,
        stepOrder: trainingSteps.stepOrder,
        title: trainingSteps.title,
      })
      .from(trainingSteps)
      .where(eq(trainingSteps.trainingId, trainingId))
      .orderBy(asc(trainingSteps.stepOrder), asc(trainingSteps.createdAt));

    const progressRows = await db
      .select({
        stepId: trainingProgress.stepId,
        completed: trainingProgress.completed,
        completedAt: trainingProgress.completedAt,
        updatedAt: trainingProgress.updatedAt,
      })
      .from(trainingProgress)
      .where(
        and(
          eq(trainingProgress.trainingId, trainingId),
          eq(trainingProgress.userId, userId),
        ),
      );

    const progressByStep = new Map(progressRows.map((row) => [row.stepId, row]));

    const steps: StepProgressItem[] = stepRows.map((step) => {
      const entry = progressByStep.get(step.id);
      return {
        stepId: step.id,
        stepOrder: step.stepOrder,
        title: step.title,
        completed: entry?.completed ?? false,
        completedAt: entry?.completedAt ?? null,
        updatedAt: entry?.updatedAt ?? null,
      };
    });

    const totalSteps = steps.length;
    const completedSteps = steps.filter((s) => s.completed).length;
    const percentage =
      totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100);

    return {
      trainingId,
      userId,
      totalSteps,
      completedSteps,
      percentage,
      steps,
    };
  }

  return {
    async getTrainingContext(trainingId, actorId) {
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
    },

    async stepBelongsToTraining(trainingId, stepId) {
      const rows = await db
        .select({ id: trainingSteps.id })
        .from(trainingSteps)
        .where(
          and(
            eq(trainingSteps.id, stepId),
            eq(trainingSteps.trainingId, trainingId),
          ),
        )
        .limit(1);

      return Boolean(rows[0]);
    },

    getProgressSummary,

    async upsertStepProgress(input) {
      const now = new Date();
      const completedAt = input.completed ? now : null;

      const rows = await db
        .insert(trainingProgress)
        .values({
          userId: input.userId,
          trainingId: input.trainingId,
          stepId: input.stepId,
          completed: input.completed,
          completedAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [trainingProgress.userId, trainingProgress.stepId],
          set: {
            completed: input.completed,
            completedAt,
            updatedAt: now,
          },
        })
        .returning();

      const record = rows[0];
      if (!record) {
        throw new Error('Failed to upsert training progress');
      }
      return record;
    },
  };
}

export interface ProgressRoutesOptions {
  repository?: ProgressRepository;
}

/**
 * Registers session-bound training progress routes (`userId` derived strictly
 * from the authenticated session, never from request body or query params).
 */
export function registerProgressRoutes(
  app: FastifyInstance,
  deps: { db: Database; auth: AuthInstance },
  options?: ProgressRoutesOptions,
): void {
  const guards = createAuthGuards(deps.auth);
  const repo = options?.repository ?? createDrizzleProgressRepository(deps.db);

  app.get(
    '/api/v1/trainings/:id/progress',
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
      const training = await repo.getTrainingContext(params.data.id, actor.id);
      if (!training) {
        return reply.code(404).send({
          errorCode: 'TRAINING_NOT_FOUND',
          message: 'Training not found',
        });
      }

      if (!canViewTraining(actor.role, actor.id, training, training.permissionLevel)) {
        return reply.code(403).send({
          errorCode: 'FORBIDDEN',
          message: 'You do not have permission to view this training',
        });
      }

      const summary = await repo.getProgressSummary(params.data.id, actor.id);
      return reply.code(200).send({ summary });
    },
  );

  app.put(
    '/api/v1/trainings/:id/steps/:stepId/progress',
    { preHandler: [guards.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = stepProgressParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'Invalid training or step id',
        });
      }

      const parsed = updateStepProgressBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const actor = request.currentUser!;
      const training = await repo.getTrainingContext(params.data.id, actor.id);
      if (!training) {
        return reply.code(404).send({
          errorCode: 'TRAINING_NOT_FOUND',
          message: 'Training not found',
        });
      }

      if (!canViewTraining(actor.role, actor.id, training, training.permissionLevel)) {
        return reply.code(403).send({
          errorCode: 'FORBIDDEN',
          message: 'You do not have permission to access this training',
        });
      }

      const belongs = await repo.stepBelongsToTraining(
        params.data.id,
        params.data.stepId,
      );
      if (!belongs) {
        return reply.code(404).send({
          errorCode: 'STEP_NOT_FOUND',
          message: 'Step not found in this training',
        });
      }

      const progress = await repo.upsertStepProgress({
        userId: actor.id,
        trainingId: params.data.id,
        stepId: params.data.stepId,
        completed: parsed.data.completed,
      });

      const summary = await repo.getProgressSummary(params.data.id, actor.id);
      return reply.code(200).send({ progress, summary });
    },
  );
}

