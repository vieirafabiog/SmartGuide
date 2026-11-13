import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthInstance } from '../../auth/auth.js';
import { createAuthGuards } from '../../auth/guards.js';
import type { Database } from '../../db/index.js';
import { categories } from '../../db/schema/index.js';

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'color must be a 6-digit hex color (e.g. #3B82F6)')
    .default('#3B82F6'),
  icon: z.string().trim().min(1).max(60).nullable().optional(),
});

const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'color must be a 6-digit hex color (e.g. #3B82F6)')
      .optional(),
    icon: z.string().trim().min(1).max(60).nullable().optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined || data.color !== undefined || data.icon !== undefined,
    { message: 'At least one category field must be provided' },
  );

function isPgUniqueViolation(err: unknown): boolean {
  return Boolean(
    err && typeof err === 'object' && (err as { code?: string }).code === '23505',
  );
}

/**
 * Registers single-tenant Categories CRUD routes.
 */
export function registerCategoryRoutes(
  app: FastifyInstance,
  deps: { db: Database; auth: AuthInstance },
): void {
  const guards = createAuthGuards(deps.auth);

  app.get(
    '/api/v1/categories',
    { preHandler: [guards.requireAuth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const rows = await deps.db
        .select()
        .from(categories)
        .orderBy(asc(categories.name));

      return reply.code(200).send({ categories: rows });
    },
  );

  app.post(
    '/api/v1/categories',
    { preHandler: [guards.requireAuth, guards.requireRole(['admin'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createCategorySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      try {
        const inserted = await deps.db
          .insert(categories)
          .values({
            name: parsed.data.name,
            color: parsed.data.color,
            icon: parsed.data.icon ?? null,
          })
          .returning();

        return reply.code(201).send({ category: inserted[0] });
      } catch (err) {
        if (isPgUniqueViolation(err)) {
          return reply.code(409).send({
            errorCode: 'CATEGORY_ALREADY_EXISTS',
            message: `Category "${parsed.data.name}" already exists`,
          });
        }
        throw err;
      }
    },
  );

  app.patch(
    '/api/v1/categories/:id',
    { preHandler: [guards.requireAuth, guards.requireRole(['admin'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = uuidParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'Category id must be a valid UUID',
        });
      }

      const parsed = updateCategorySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const patchValues: {
        name?: string;
        color?: string;
        icon?: string | null;
      } = {};
      if (parsed.data.name !== undefined) patchValues.name = parsed.data.name;
      if (parsed.data.color !== undefined) patchValues.color = parsed.data.color;
      if (parsed.data.icon !== undefined) patchValues.icon = parsed.data.icon;

      try {
        const updated = await deps.db
          .update(categories)
          .set(patchValues)
          .where(eq(categories.id, params.data.id))
          .returning();

        if (!updated[0]) {
          return reply.code(404).send({
            errorCode: 'CATEGORY_NOT_FOUND',
            message: 'Category not found',
          });
        }

        return reply.code(200).send({ category: updated[0] });
      } catch (err) {
        if (isPgUniqueViolation(err)) {
          return reply.code(409).send({
            errorCode: 'CATEGORY_ALREADY_EXISTS',
            message: 'A category with that name already exists',
          });
        }
        throw err;
      }
    },
  );

  app.delete(
    '/api/v1/categories/:id',
    { preHandler: [guards.requireAuth, guards.requireRole(['admin'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = uuidParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'Category id must be a valid UUID',
        });
      }

      const deleted = await deps.db
        .delete(categories)
        .where(eq(categories.id, params.data.id))
        .returning({ id: categories.id });

      if (!deleted[0]) {
        return reply.code(404).send({
          errorCode: 'CATEGORY_NOT_FOUND',
          message: 'Category not found',
        });
      }

      return reply.code(200).send({ deleted: true, id: deleted[0].id });
    },
  );
}

