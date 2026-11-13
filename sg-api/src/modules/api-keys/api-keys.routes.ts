import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthInstance } from '../../auth/auth.js';
import { createAuthGuards } from '../../auth/guards.js';
import type { Database } from '../../db/index.js';
import { API_KEY_SCOPES, apiKeys, type ApiKeyScope } from '../../db/schema/index.js';
import { generateApiKey } from '../../security/api-key.js';

export interface SafeApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  isActive: boolean;
  createdBy: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface ApiKeysRepository {
  list(): Promise<SafeApiKeyRecord[]>;
  create(input: {
    name: string;
    keyPrefix: string;
    keyHash: string;
    scopes: ApiKeyScope[];
    createdBy: string;
  }): Promise<SafeApiKeyRecord>;
  update(
    id: string,
    patch: Partial<{ name: string; scopes: ApiKeyScope[]; isActive: boolean }>,
  ): Promise<SafeApiKeyRecord | null>;
  delete(id: string): Promise<boolean>;
}

const safeApiKeyColumns = {
  id: apiKeys.id,
  name: apiKeys.name,
  keyPrefix: apiKeys.keyPrefix,
  scopes: apiKeys.scopes,
  isActive: apiKeys.isActive,
  createdBy: apiKeys.createdBy,
  lastUsedAt: apiKeys.lastUsedAt,
  createdAt: apiKeys.createdAt,
};

export function createDrizzleApiKeysRepository(db: Database): ApiKeysRepository {
  return {
    async list() {
      return db
        .select(safeApiKeyColumns)
        .from(apiKeys)
        .orderBy(desc(apiKeys.createdAt));
    },

    async create(input) {
      const inserted = await db
        .insert(apiKeys)
        .values({
          name: input.name,
          keyPrefix: input.keyPrefix,
          keyHash: input.keyHash,
          scopes: input.scopes,
          isActive: true,
          createdBy: input.createdBy,
        })
        .returning(safeApiKeyColumns);
      return inserted[0]!;
    },

    async update(id, patch) {
      const updated = await db
        .update(apiKeys)
        .set(patch)
        .where(eq(apiKeys.id, id))
        .returning(safeApiKeyColumns);
      return updated[0] ?? null;
    },

    async delete(id) {
      const deleted = await db
        .delete(apiKeys)
        .where(eq(apiKeys.id, id))
        .returning({ id: apiKeys.id });
      return deleted.length > 0;
    },
  };
}

const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z
    .array(z.enum(API_KEY_SCOPES))
    .min(1)
    .default(['users:read', 'trainings:read']),
});

const updateApiKeySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.scopes !== undefined ||
      data.isActive !== undefined,
    { message: 'At least one API key field must be provided' },
  );

export interface ApiKeyRoutesOptions {
  repository?: ApiKeysRepository;
}

/**
 * Registers admin-only hashed API Key management routes.
 * Plaintext keys are returned strictly once on creation and never persisted or returned again.
 */
export function registerApiKeyRoutes(
  app: FastifyInstance,
  deps: { db: Database; auth: AuthInstance },
  options?: ApiKeyRoutesOptions,
): void {
  const guards = createAuthGuards(deps.auth);
  const repo = options?.repository ?? createDrizzleApiKeysRepository(deps.db);
  const adminOnly = [guards.requireAuth, guards.requireRole(['admin'])];

  app.get(
    '/api/v1/api-keys',
    { preHandler: adminOnly },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const rows = await repo.list();
      return reply.code(200).send({ apiKeys: rows });
    },
  );

  app.post(
    '/api/v1/api-keys',
    { preHandler: adminOnly },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createApiKeySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const generated = generateApiKey();
      const created = await repo.create({
        name: parsed.data.name,
        keyPrefix: generated.keyPrefix,
        keyHash: generated.keyHash,
        scopes: parsed.data.scopes,
        createdBy: request.currentUser!.id,
      });

      return reply.code(201).send({
        apiKey: created,
        plaintextKey: generated.plaintextKey,
      });
    },
  );

  app.patch(
    '/api/v1/api-keys/:id',
    { preHandler: adminOnly },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = uuidParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'API key id must be a valid UUID',
        });
      }

      const parsed = updateApiKeySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const updated = await repo.update(params.data.id, parsed.data);
      if (!updated) {
        return reply.code(404).send({
          errorCode: 'API_KEY_NOT_FOUND',
          message: 'API key not found',
        });
      }

      return reply.code(200).send({ apiKey: updated });
    },
  );

  app.delete(
    '/api/v1/api-keys/:id',
    { preHandler: adminOnly },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = uuidParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'API key id must be a valid UUID',
        });
      }

      const deleted = await repo.delete(params.data.id);
      if (!deleted) {
        return reply.code(404).send({
          errorCode: 'API_KEY_NOT_FOUND',
          message: 'API key not found',
        });
      }

      return reply.code(200).send({ deleted: true, id: params.data.id });
    },
  );
}

