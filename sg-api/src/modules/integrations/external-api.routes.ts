import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { asc, count, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../../db/index.js';
import {
  account,
  apiKeys,
  SUPPORTED_LOCALES,
  trainings,
  user,
  USER_ROLES,
  type ApiKeyScope,
  type SupportedLocale,
  type TrainingStatus,
  type UserRole,
} from '../../db/schema/index.js';
import { hasApiKeyScope, hashApiKey, verifyApiKey } from '../../security/api-key.js';

export interface ApiKeyAuthRecord {
  id: string;
  keyHash: string;
  scopes: string[];
  isActive: boolean;
}

export interface ExternalUserRecord {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  preferredLocale: SupportedLocale;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExternalTrainingRecord {
  id: string;
  title: string;
  description: string;
  coverUrl: string | null;
  status: TrainingStatus;
  isPublic: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExternalApiRepository {
  findApiKeyByHash(keyHash: string): Promise<ApiKeyAuthRecord | null>;
  touchApiKeyLastUsed(keyId: string): Promise<void>;
  listUsers(page: number, pageSize: number): Promise<{ users: ExternalUserRecord[]; total: number }>;
  createUser(input: {
    name: string;
    email: string;
    passwordHash: string;
    role: UserRole;
    preferredLocale: SupportedLocale;
  }): Promise<ExternalUserRecord>;
  updateUser(
    id: string,
    patch: Partial<{
      name: string;
      role: UserRole;
      isActive: boolean;
      preferredLocale: SupportedLocale;
    }>,
  ): Promise<ExternalUserRecord | null>;
  listTrainings(
    page: number,
    pageSize: number,
  ): Promise<{ trainings: ExternalTrainingRecord[]; total: number }>;
}

declare module 'fastify' {
  interface FastifyRequest {
    apiKeyAuth?: ApiKeyAuthRecord;
  }
}

const QUERY_KEY_PARAMS = ['apikey', 'api_key', 'key', 'token', 'x-api-key'] as const;

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const extCreateUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255).transform((e) => e.toLowerCase()),
  password: z.string().min(8).max(128),
  role: z.enum(USER_ROLES).default('user'),
  preferredLocale: z.enum(SUPPORTED_LOCALES).default('pt-BR'),
});

const extUserIdParamSchema = z.object({
  id: z.string().min(1),
});

const extUpdateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    role: z.enum(USER_ROLES).optional(),
    isActive: z.boolean().optional(),
    preferredLocale: z.enum(SUPPORTED_LOCALES).optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.role !== undefined ||
      data.isActive !== undefined ||
      data.preferredLocale !== undefined,
    { message: 'At least one user field must be provided' },
  );

function isPgUniqueViolation(err: unknown): boolean {
  return Boolean(
    err && typeof err === 'object' && (err as { code?: string }).code === '23505',
  );
}

function hasForbiddenQueryKey(query: unknown): boolean {
  if (!query || typeof query !== 'object') return false;
  const keys = Object.keys(query as Record<string, unknown>).map((k) => k.toLowerCase());
  return QUERY_KEY_PARAMS.some((forbidden) => keys.includes(forbidden));
}

/**
 * Creates a Drizzle-backed ExternalApiRepository for `/api/v1/ext/*`.
 */
export function createDrizzleExternalApiRepository(db: Database): ExternalApiRepository {
  return {
    async findApiKeyByHash(keyHash) {
      const rows = await db
        .select({
          id: apiKeys.id,
          keyHash: apiKeys.keyHash,
          scopes: apiKeys.scopes,
          isActive: apiKeys.isActive,
        })
        .from(apiKeys)
        .where(eq(apiKeys.keyHash, keyHash))
        .limit(1);

      return rows[0] ?? null;
    },

    async touchApiKeyLastUsed(keyId) {
      await db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, keyId));
    },

    async listUsers(page, pageSize) {
      const totalRows = await db.select({ total: count() }).from(user);
      const total = Number(totalRows[0]?.total ?? 0);
      const offset = (page - 1) * pageSize;

      const users = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
          preferredLocale: user.preferredLocale,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })
        .from(user)
        .orderBy(asc(user.name), asc(user.email))
        .limit(pageSize)
        .offset(offset);

      return { users, total };
    },

    async createUser(input) {
      const userId = randomUUID();
      const accountId = randomUUID();
      const now = new Date();

      await db.transaction(async (tx) => {
        await tx.insert(user).values({
          id: userId,
          name: input.name,
          email: input.email,
          emailVerified: true,
          role: input.role,
          isActive: true,
          preferredLocale: input.preferredLocale,
          createdAt: now,
          updatedAt: now,
        });

        await tx.insert(account).values({
          id: accountId,
          accountId: userId,
          providerId: 'credential',
          userId,
          password: input.passwordHash,
          createdAt: now,
          updatedAt: now,
        });
      });

      const rows = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
          preferredLocale: user.preferredLocale,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);

      const created = rows[0];
      if (!created) {
        throw new Error('Failed to load newly created user');
      }
      return created;
    },

    async updateUser(id, patch) {
      const updated = await db
        .update(user)
        .set({
          ...patch,
          updatedAt: new Date(),
        })
        .where(eq(user.id, id))
        .returning({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
          preferredLocale: user.preferredLocale,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        });

      return updated[0] ?? null;
    },

    async listTrainings(page, pageSize) {
      const totalRows = await db.select({ total: count() }).from(trainings);
      const total = Number(totalRows[0]?.total ?? 0);
      const offset = (page - 1) * pageSize;

      const rows = await db
        .select({
          id: trainings.id,
          title: trainings.title,
          description: trainings.description,
          coverUrl: trainings.coverUrl,
          status: trainings.status,
          isPublic: trainings.isPublic,
          createdBy: trainings.createdBy,
          createdAt: trainings.createdAt,
          updatedAt: trainings.updatedAt,
        })
        .from(trainings)
        .orderBy(desc(trainings.updatedAt))
        .limit(pageSize)
        .offset(offset);

      return { trainings: rows, total };
    },
  };
}

export interface ExternalApiRoutesOptions {
  repository?: ExternalApiRepository;
  hashPasswordFn?: (password: string) => Promise<string>;
}

/**
 * Registers scoped external integration endpoints (`/api/v1/ext/*`)
 * authenticating strictly via the `x-api-key` header (rejecting query-string keys).
 */
export function registerExternalApiRoutes(
  app: FastifyInstance,
  deps: { db: Database },
  options?: ExternalApiRoutesOptions,
): void {
  const repo = options?.repository ?? createDrizzleExternalApiRepository(deps.db);
  const hashPwd = options?.hashPasswordFn ?? hashPassword;

  function requireApiKeyScope(requiredScope: ApiKeyScope) {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      if (hasForbiddenQueryKey(request.query)) {
        await reply.code(401).send({
          errorCode: 'API_KEY_IN_QUERY_FORBIDDEN',
          message: 'API keys must be provided in the x-api-key header, never in query parameters',
        });
        return;
      }

      const rawHeader = request.headers['x-api-key'];
      const providedKey = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
      if (!providedKey || typeof providedKey !== 'string' || !providedKey.trim()) {
        await reply.code(401).send({
          errorCode: 'MISSING_API_KEY',
          message: 'x-api-key header is required',
        });
        return;
      }

      const trimmedKey = providedKey.trim();
      const keyRecord = await repo.findApiKeyByHash(hashApiKey(trimmedKey));
      if (
        !keyRecord ||
        !keyRecord.isActive ||
        !verifyApiKey(trimmedKey, keyRecord.keyHash)
      ) {
        await reply.code(401).send({
          errorCode: 'INVALID_API_KEY',
          message: 'Invalid or revoked API key',
        });
        return;
      }

      if (!hasApiKeyScope(keyRecord.scopes, requiredScope)) {
        await reply.code(403).send({
          errorCode: 'INSUFFICIENT_SCOPE',
          message: `API key lacks required scope: ${requiredScope}`,
        });
        return;
      }

      request.apiKeyAuth = keyRecord;
      void repo.touchApiKeyLastUsed(keyRecord.id).catch(() => undefined);
    };
  }

  app.get(
    '/api/v1/ext/users',
    { preHandler: [requireApiKeyScope('users:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = paginationQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_QUERY',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const { page, pageSize } = parsed.data;
      const { users, total } = await repo.listUsers(page, pageSize);
      return reply.code(200).send({
        users,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
        },
      });
    },
  );

  app.post(
    '/api/v1/ext/users',
    { preHandler: [requireApiKeyScope('users:write')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = extCreateUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const passwordHash = await hashPwd(parsed.data.password);
      try {
        const created = await repo.createUser({
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash,
          role: parsed.data.role,
          preferredLocale: parsed.data.preferredLocale,
        });
        return reply.code(201).send({ user: created });
      } catch (err) {
        if (isPgUniqueViolation(err)) {
          return reply.code(409).send({
            errorCode: 'EMAIL_ALREADY_EXISTS',
            message: `User with email "${parsed.data.email}" already exists`,
          });
        }
        throw err;
      }
    },
  );

  app.patch(
    '/api/v1/ext/users/:id',
    { preHandler: [requireApiKeyScope('users:write')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = extUserIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'User id is required',
        });
      }

      const bodyParsed = extUpdateUserSchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: bodyParsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const updated = await repo.updateUser(params.data.id, bodyParsed.data);
      if (!updated) {
        return reply.code(404).send({
          errorCode: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      return reply.code(200).send({ user: updated });
    },
  );

  app.get(
    '/api/v1/ext/trainings',
    { preHandler: [requireApiKeyScope('trainings:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = paginationQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_QUERY',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const { page, pageSize } = parsed.data;
      const result = await repo.listTrainings(page, pageSize);
      return reply.code(200).send({
        trainings: result.trainings,
        pagination: {
          page,
          pageSize,
          total: result.total,
          totalPages: result.total === 0 ? 0 : Math.ceil(result.total / pageSize),
        },
      });
    },
  );
}
