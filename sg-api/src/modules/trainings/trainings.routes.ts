import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthInstance } from '../../auth/auth.js';
import { createAuthGuards } from '../../auth/guards.js';
import type { Database } from '../../db/index.js';
import { TRAINING_STATUSES } from '../../db/schema/index.js';
import type { StorageConnector } from '../../storage/index.js';
import {
  createDrizzleTrainingsRepository,
  TrainingServiceError,
  TrainingsService,
  type TrainingsRepository,
} from './trainings.service.js';

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

const listTrainingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: z.enum(TRAINING_STATUSES).optional(),
  categoryId: z.string().uuid().optional(),
  isPublic: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

const coverUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    (value) => value.startsWith('/api/v1/media/') || /^https?:\/\//i.test(value),
    'coverUrl must be an /api/v1/media/ path or http(s) URL',
  );

const createTrainingSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(100_000).optional(),
  coverUrl: coverUrlSchema.nullable().optional(),
  status: z.enum(TRAINING_STATUSES).optional(),
  isPublic: z.boolean().optional(),
  categoryIds: z.array(z.string().uuid()).max(50).optional(),
});

const updateTrainingSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(100_000).optional(),
    coverUrl: coverUrlSchema.nullable().optional(),
    status: z.enum(TRAINING_STATUSES).optional(),
    isPublic: z.boolean().optional(),
    categoryIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.description !== undefined ||
      data.coverUrl !== undefined ||
      data.status !== undefined ||
      data.isPublic !== undefined ||
      data.categoryIds !== undefined,
    { message: 'At least one training field must be provided' },
  );

export interface TrainingsRoutesOptions {
  repository?: TrainingsRepository;
  service?: TrainingsService;
}

function handleServiceError(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof TrainingServiceError) {
    return reply.code(err.statusCode).send({
      errorCode: err.errorCode,
      message: err.message,
    });
  }
  throw err;
}

/**
 * Registers Trainings CRUD, visibility-isolated search/listing, and cascade
 * media cleanup routes.
 */
export function registerTrainingRoutes(
  app: FastifyInstance,
  deps: { db: Database; auth: AuthInstance; storage: StorageConnector },
  options?: TrainingsRoutesOptions,
): void {
  const guards = createAuthGuards(deps.auth);
  const repo = options?.repository ?? createDrizzleTrainingsRepository(deps.db);
  const service =
    options?.service ?? new TrainingsService({ repo, storage: deps.storage });

  app.get(
    '/api/v1/trainings',
    { preHandler: [guards.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = listTrainingsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_QUERY',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const actor = request.currentUser!;
      const result = await service.listTrainings({
        actorId: actor.id,
        actorRole: actor.role,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        search: parsed.data.search,
        status: parsed.data.status,
        categoryId: parsed.data.categoryId,
        isPublic: parsed.data.isPublic,
      });

      return reply.code(200).send(result);
    },
  );

  app.get(
    '/api/v1/trainings/:id',
    { preHandler: [guards.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = uuidParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'Training id must be a valid UUID',
        });
      }

      const actor = request.currentUser!;
      try {
        const training = await service.getTrainingById(
          params.data.id,
          actor.id,
          actor.role,
        );
        return reply.code(200).send({ training });
      } catch (err) {
        return handleServiceError(err, reply);
      }
    },
  );

  app.post(
    '/api/v1/trainings',
    { preHandler: [guards.requireAuth, guards.requireRole(['admin', 'creator'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createTrainingSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const actor = request.currentUser!;
      try {
        const training = await service.createTraining({
          actorId: actor.id,
          actorRole: actor.role,
          title: parsed.data.title,
          description: parsed.data.description,
          coverUrl: parsed.data.coverUrl,
          status: parsed.data.status,
          isPublic: parsed.data.isPublic,
          categoryIds: parsed.data.categoryIds,
        });
        return reply.code(201).send({ training });
      } catch (err) {
        return handleServiceError(err, reply);
      }
    },
  );

  app.patch(
    '/api/v1/trainings/:id',
    { preHandler: [guards.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = uuidParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'Training id must be a valid UUID',
        });
      }

      const parsed = updateTrainingSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const actor = request.currentUser!;
      try {
        const training = await service.updateTraining({
          actorId: actor.id,
          actorRole: actor.role,
          trainingId: params.data.id,
          title: parsed.data.title,
          description: parsed.data.description,
          coverUrl: parsed.data.coverUrl,
          status: parsed.data.status,
          isPublic: parsed.data.isPublic,
          categoryIds: parsed.data.categoryIds,
        });
        return reply.code(200).send({ training });
      } catch (err) {
        return handleServiceError(err, reply);
      }
    },
  );

  app.delete(
    '/api/v1/trainings/:id',
    { preHandler: [guards.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = uuidParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'Training id must be a valid UUID',
        });
      }

      const actor = request.currentUser!;
      try {
        const result = await service.deleteTraining(
          params.data.id,
          actor.id,
          actor.role,
        );
        return reply.code(200).send(result);
      } catch (err) {
        return handleServiceError(err, reply);
      }
    },
  );
}

