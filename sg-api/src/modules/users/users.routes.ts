import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { and, asc, count, eq, ilike, ne, or, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthInstance } from '../../auth/auth.js';
import { createAuthGuards } from '../../auth/guards.js';
import type { Database } from '../../db/index.js';
import {
  account,
  apiKeys,
  categories,
  SUPPORTED_LOCALES,
  trainings,
  trainingSteps,
  user,
  USER_ROLES,
  type SupportedLocale,
  type UserRole,
} from '../../db/schema/index.js';

export interface SafeUserRecord {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  preferredLocale: SupportedLocale;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserSearchRecord {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  totalTrainings: number;
  publishedTrainings: number;
  totalCategories: number;
  totalSteps: number;
  activeApiKeys: number;
}

export interface UsersRepository {
  searchActiveUsers(query: string, limit: number): Promise<UserSearchRecord[]>;
  listUsers(params: {
    page: number;
    pageSize: number;
    search?: string;
    role?: UserRole;
    isActive?: boolean;
  }): Promise<{ users: SafeUserRecord[]; total: number }>;
  findById(id: string): Promise<SafeUserRecord | null>;
  countOtherActiveAdmins(excludeUserId: string): Promise<number>;
  createUser(input: {
    name: string;
    email: string;
    passwordHash: string;
    role: UserRole;
    preferredLocale: SupportedLocale;
  }): Promise<SafeUserRecord>;
  updateUser(
    id: string,
    patch: Partial<{
      name: string;
      role: UserRole;
      isActive: boolean;
      preferredLocale: SupportedLocale;
    }>,
  ): Promise<SafeUserRecord | null>;
  deleteUser(id: string): Promise<boolean>;
  getAdminStats(): Promise<AdminStats>;
}

const safeUserColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  preferredLocale: user.preferredLocale,
  image: user.image,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
};

export function createDrizzleUsersRepository(db: Database): UsersRepository {
  return {
    async searchActiveUsers(query, limit) {
      const conditions: SQL[] = [eq(user.isActive, true)];
      if (query.trim()) {
        const pattern = `%${query.trim()}%`;
        const match = or(ilike(user.name, pattern), ilike(user.email, pattern));
        if (match) conditions.push(match);
      }

      return db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        })
        .from(user)
        .where(and(...conditions))
        .orderBy(asc(user.name))
        .limit(limit);
    },

    async listUsers({ page, pageSize, search, role, isActive }) {
      const conditions: SQL[] = [];
      if (search?.trim()) {
        const pattern = `%${search.trim()}%`;
        const match = or(ilike(user.name, pattern), ilike(user.email, pattern));
        if (match) conditions.push(match);
      }
      if (role !== undefined) conditions.push(eq(user.role, role));
      if (isActive !== undefined) conditions.push(eq(user.isActive, isActive));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, totalRows] = await Promise.all([
        db
          .select(safeUserColumns)
          .from(user)
          .where(whereClause)
          .orderBy(asc(user.name))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ value: count() }).from(user).where(whereClause),
      ]);

      return {
        users: rows,
        total: Number(totalRows[0]?.value ?? 0),
      };
    },

    async findById(id) {
      const rows = await db
        .select(safeUserColumns)
        .from(user)
        .where(eq(user.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async countOtherActiveAdmins(excludeUserId) {
      const rows = await db
        .select({ value: count() })
        .from(user)
        .where(
          and(
            eq(user.role, 'admin'),
            eq(user.isActive, true),
            ne(user.id, excludeUserId),
          ),
        );
      return Number(rows[0]?.value ?? 0);
    },

    async createUser(input) {
      return db.transaction(async (tx) => {
        const id = randomUUID();
        const inserted = await tx
          .insert(user)
          .values({
            id,
            name: input.name,
            email: input.email,
            emailVerified: true,
            role: input.role,
            isActive: true,
            preferredLocale: input.preferredLocale,
          })
          .returning(safeUserColumns);

        await tx.insert(account).values({
          id: randomUUID(),
          accountId: id,
          providerId: 'credential',
          userId: id,
          password: input.passwordHash,
        });

        return inserted[0]!;
      });
    },

    async updateUser(id, patch) {
      const updated = await db
        .update(user)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(user.id, id))
        .returning(safeUserColumns);
      return updated[0] ?? null;
    },

    async deleteUser(id) {
      const deleted = await db
        .delete(user)
        .where(eq(user.id, id))
        .returning({ id: user.id });
      return deleted.length > 0;
    },

    async getAdminStats() {
      const [
        totalUsersRows,
        activeUsersRows,
        totalTrainingsRows,
        publishedTrainingsRows,
        totalCategoriesRows,
        totalStepsRows,
        activeApiKeysRows,
      ] = await Promise.all([
        db.select({ value: count() }).from(user),
        db.select({ value: count() }).from(user).where(eq(user.isActive, true)),
        db.select({ value: count() }).from(trainings),
        db
          .select({ value: count() })
          .from(trainings)
          .where(eq(trainings.status, 'published')),
        db.select({ value: count() }).from(categories),
        db.select({ value: count() }).from(trainingSteps),
        db.select({ value: count() }).from(apiKeys).where(eq(apiKeys.isActive, true)),
      ]);

      return {
        totalUsers: Number(totalUsersRows[0]?.value ?? 0),
        activeUsers: Number(activeUsersRows[0]?.value ?? 0),
        totalTrainings: Number(totalTrainingsRows[0]?.value ?? 0),
        publishedTrainings: Number(publishedTrainingsRows[0]?.value ?? 0),
        totalCategories: Number(totalCategoriesRows[0]?.value ?? 0),
        totalSteps: Number(totalStepsRows[0]?.value ?? 0),
        activeApiKeys: Number(activeApiKeysRows[0]?.value ?? 0),
      };
    },
  };
}

const searchQuerySchema = z.object({
  q: z.string().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  role: z.enum(USER_ROLES).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

const createUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  role: z.enum(USER_ROLES).default('user'),
  preferredLocale: z.enum(SUPPORTED_LOCALES).default('pt-BR'),
});

const updateUserSchema = z
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

function getPgErrorCode(err: unknown): string | undefined {
  return err && typeof err === 'object' ? (err as { code?: string }).code : undefined;
}

export interface UsersRoutesOptions {
  repository?: UsersRepository;
  passwordHasher?: (password: string) => Promise<string>;
}

/**
 * Registers single-tenant user management, sharing search autocomplete, and admin stats routes.
 */
export function registerUsersRoutes(
  app: FastifyInstance,
  deps: { db: Database; auth: AuthInstance },
  options?: UsersRoutesOptions,
): void {
  const guards = createAuthGuards(deps.auth);
  const repo = options?.repository ?? createDrizzleUsersRepository(deps.db);
  const hashFn = options?.passwordHasher ?? hashPassword;

  app.get(
    '/api/v1/users/search',
    { preHandler: [guards.requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = searchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const users = await repo.searchActiveUsers(parsed.data.q, parsed.data.limit);
      return reply.code(200).send({ users });
    },
  );

  app.get(
    '/api/v1/users',
    { preHandler: [guards.requireAuth, guards.requireRole(['admin'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = listUsersQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const result = await repo.listUsers(parsed.data);
      return reply.code(200).send({
        users: result.users,
        total: result.total,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
      });
    },
  );

  app.post(
    '/api/v1/users',
    { preHandler: [guards.requireAuth, guards.requireRole(['admin'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      try {
        const passwordHash = await hashFn(parsed.data.password);
        const created = await repo.createUser({
          name: parsed.data.name,
          email: parsed.data.email.toLowerCase(),
          passwordHash,
          role: parsed.data.role,
          preferredLocale: parsed.data.preferredLocale,
        });
        return reply.code(201).send({ user: created });
      } catch (err) {
        if (getPgErrorCode(err) === '23505') {
          return reply.code(409).send({
            errorCode: 'USER_ALREADY_EXISTS',
            message: 'A user with this email already exists',
          });
        }
        throw err;
      }
    },
  );

  app.patch(
    '/api/v1/users/:id',
    { preHandler: [guards.requireAuth, guards.requireRole(['admin'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      if (!id || id.trim() === '') {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'User id is required',
        });
      }

      const parsed = updateUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const currentActorId = request.currentUser?.id;
      if (id === currentActorId) {
        if (parsed.data.role !== undefined && parsed.data.role !== 'admin') {
          return reply.code(400).send({
            errorCode: 'CANNOT_DEMOTE_SELF',
            message: 'Administrators cannot demote themselves',
          });
        }
        if (parsed.data.isActive === false) {
          return reply.code(400).send({
            errorCode: 'CANNOT_DEACTIVATE_SELF',
            message: 'Administrators cannot deactivate themselves',
          });
        }
      }

      const target = await repo.findById(id);
      if (!target) {
        return reply.code(404).send({
          errorCode: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      const removesAdminPrivileges =
        target.role === 'admin' &&
        target.isActive &&
        ((parsed.data.role !== undefined && parsed.data.role !== 'admin') ||
          parsed.data.isActive === false);

      if (removesAdminPrivileges) {
        const otherAdmins = await repo.countOtherActiveAdmins(id);
        if (otherAdmins === 0) {
          return reply.code(400).send({
            errorCode: 'LAST_ADMIN_REQUIRED',
            message: 'At least one active administrator must remain in the instance',
          });
        }
      }

      const updated = await repo.updateUser(id, parsed.data);
      return reply.code(200).send({ user: updated });
    },
  );

  app.delete(
    '/api/v1/users/:id',
    { preHandler: [guards.requireAuth, guards.requireRole(['admin'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      if (!id || id.trim() === '') {
        return reply.code(400).send({
          errorCode: 'INVALID_ID',
          message: 'User id is required',
        });
      }

      if (id === request.currentUser?.id) {
        return reply.code(400).send({
          errorCode: 'CANNOT_DELETE_SELF',
          message: 'Administrators cannot delete their own account',
        });
      }

      const target = await repo.findById(id);
      if (!target) {
        return reply.code(404).send({
          errorCode: 'USER_NOT_FOUND',
          message: 'User not found',
        });
      }

      if (target.role === 'admin' && target.isActive) {
        const otherAdmins = await repo.countOtherActiveAdmins(id);
        if (otherAdmins === 0) {
          return reply.code(400).send({
            errorCode: 'LAST_ADMIN_REQUIRED',
            message: 'Cannot delete the last active administrator',
          });
        }
      }

      try {
        await repo.deleteUser(id);
        return reply.code(200).send({ deleted: true, id });
      } catch (err) {
        if (getPgErrorCode(err) === '23503') {
          return reply.code(409).send({
            errorCode: 'USER_HAS_TRAININGS',
            message: 'Cannot delete user who owns existing trainings; deactivate instead',
          });
        }
        throw err;
      }
    },
  );

  app.get(
    '/api/v1/admin/stats',
    { preHandler: [guards.requireAuth, guards.requireRole(['admin'])] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const stats = await repo.getAdminStats();
      return reply.code(200).send({ stats });
    },
  );
}

