import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  canCreateTraining,
  canEditTraining,
  canManageTrainingOwnership,
  canViewTraining,
} from '../../auth/permissions.js';
import type { Database } from '../../db/index.js';
import {
  categories,
  stepAttachments,
  trainingCategories,
  trainingPermissions,
  trainings,
  trainingSteps,
  user,
  type PermissionLevel,
  type TrainingStatus,
  type UserRole,
} from '../../db/schema/index.js';
import { sanitizeRichTextHtml } from '../../security/html-sanitizer.js';
import type { StorageConnector } from '../../storage/index.js';

export interface TrainingCategorySummary {
  id: string;
  name: string;
  color: string;
  icon: string | null;
}

export interface TrainingRecord {
  id: string;
  title: string;
  description: string;
  coverUrl: string | null;
  status: TrainingStatus;
  isPublic: boolean;
  createdBy: string;
  creatorName: string | null;
  categories: TrainingCategorySummary[];
  stepCount: number;
  permissionLevel: PermissionLevel | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListTrainingsInput {
  actorId: string;
  actorRole: UserRole;
  page: number;
  pageSize: number;
  search?: string;
  status?: TrainingStatus;
  categoryId?: string;
  isPublic?: boolean;
}

export interface ListTrainingsResult {
  trainings: TrainingRecord[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface CreateTrainingInput {
  actorId: string;
  actorRole: UserRole;
  title: string;
  description?: string;
  coverUrl?: string | null;
  status?: TrainingStatus;
  isPublic?: boolean;
  categoryIds?: string[];
}

export interface UpdateTrainingInput {
  actorId: string;
  actorRole: UserRole;
  trainingId: string;
  title?: string;
  description?: string;
  coverUrl?: string | null;
  status?: TrainingStatus;
  isPublic?: boolean;
  categoryIds?: string[];
}

export interface DeleteTrainingResult {
  deleted: true;
  id: string;
  cleanedCoverKey: string | null;
  cleanedAttachmentKeys: string[];
}

export interface TrainingAccessSnapshot {
  id: string;
  createdBy: string;
  status: TrainingStatus;
  isPublic: boolean;
  coverUrl: string | null;
  permissionLevel: PermissionLevel | null;
}

export interface TrainingsRepository {
  listTrainings(input: ListTrainingsInput): Promise<ListTrainingsResult>;
  findByIdForActor(trainingId: string, actorId: string): Promise<TrainingRecord | null>;
  getAccessSnapshot(trainingId: string, actorId: string): Promise<TrainingAccessSnapshot | null>;
  countExistingCategories(categoryIds: readonly string[]): Promise<number>;
  createTraining(input: {
    title: string;
    description: string;
    coverUrl: string | null;
    status: TrainingStatus;
    isPublic: boolean;
    createdBy: string;
    categoryIds: readonly string[];
  }): Promise<TrainingRecord>;
  updateTraining(
    trainingId: string,
    actorId: string,
    patch: Partial<{
      title: string;
      description: string;
      coverUrl: string | null;
      status: TrainingStatus;
      isPublic: boolean;
    }>,
    categoryIds?: readonly string[],
  ): Promise<TrainingRecord | null>;
  deleteTrainingAndCollectMedia(trainingId: string): Promise<{
    deleted: boolean;
    coverUrl: string | null;
    attachmentStorageKeys: string[];
  }>;
}

export class TrainingServiceError extends Error {
  readonly statusCode: number;
  readonly errorCode: string;

  constructor(statusCode: number, errorCode: string, message: string) {
    super(message);
    this.name = 'TrainingServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

const COVER_MEDIA_PREFIX = '/api/v1/media/training-covers/';

/**
 * Extracts the `training-covers` object key from a stored `coverUrl`
 * (relative path or absolute URL, ignoring query parameters).
 */
export function extractTrainingCoverStorageKey(
  coverUrl: string | null | undefined,
): string | null {
  if (!coverUrl) return null;
  const trimmed = coverUrl.trim();
  if (!trimmed) return null;

  let pathname = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      pathname = new URL(trimmed).pathname;
    } catch {
      return null;
    }
  } else {
    const queryIdx = trimmed.indexOf('?');
    if (queryIdx !== -1) {
      pathname = trimmed.slice(0, queryIdx);
    }
  }

  const prefixIdx = pathname.indexOf(COVER_MEDIA_PREFIX);
  if (prefixIdx === -1) return null;

  const rawKey = pathname.slice(prefixIdx + COVER_MEDIA_PREFIX.length).replace(/^\/+/, '');
  if (!rawKey) return null;

  try {
    return decodeURIComponent(rawKey);
  } catch {
    return rawKey;
  }
}

function deduplicateIds(ids: readonly string[] | undefined): string[] {
  if (!ids || ids.length === 0) return [];
  return [...new Set(ids)];
}

/**
 * Creates a Drizzle-backed TrainingsRepository using PostgreSQL `pg_trgm`
 * similarity + `ILIKE` search, transactional category sync, and cascade media key lookup.
 */
export function createDrizzleTrainingsRepository(db: Database): TrainingsRepository {
  async function loadCategoriesByTrainingIds(
    trainingIds: readonly string[],
  ): Promise<Map<string, TrainingCategorySummary[]>> {
    const map = new Map<string, TrainingCategorySummary[]>();
    if (trainingIds.length === 0) return map;

    const rows = await db
      .select({
        trainingId: trainingCategories.trainingId,
        id: categories.id,
        name: categories.name,
        color: categories.color,
        icon: categories.icon,
      })
      .from(trainingCategories)
      .innerJoin(categories, eq(trainingCategories.categoryId, categories.id))
      .where(inArray(trainingCategories.trainingId, [...trainingIds]))
      .orderBy(asc(categories.name));

    for (const row of rows) {
      const list = map.get(row.trainingId) ?? [];
      list.push({
        id: row.id,
        name: row.name,
        color: row.color,
        icon: row.icon,
      });
      map.set(row.trainingId, list);
    }

    return map;
  }

  async function loadStepCountsByTrainingIds(
    trainingIds: readonly string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (trainingIds.length === 0) return map;

    const rows = await db
      .select({
        trainingId: trainingSteps.trainingId,
        total: count(),
      })
      .from(trainingSteps)
      .where(inArray(trainingSteps.trainingId, [...trainingIds]))
      .groupBy(trainingSteps.trainingId);

    for (const row of rows) {
      map.set(row.trainingId, Number(row.total ?? 0));
    }

    return map;
  }

  async function loadPermissionsByTrainingIds(
    trainingIds: readonly string[],
    actorId: string,
  ): Promise<Map<string, PermissionLevel>> {
    const map = new Map<string, PermissionLevel>();
    if (trainingIds.length === 0) return map;

    const rows = await db
      .select({
        trainingId: trainingPermissions.trainingId,
        permission: trainingPermissions.permission,
      })
      .from(trainingPermissions)
      .where(
        and(
          inArray(trainingPermissions.trainingId, [...trainingIds]),
          eq(trainingPermissions.userId, actorId),
        ),
      );

    for (const row of rows) {
      map.set(row.trainingId, row.permission);
    }

    return map;
  }

  return {
    async listTrainings(input: ListTrainingsInput): Promise<ListTrainingsResult> {
      const conditions: SQL[] = [];

      if (input.actorRole !== 'admin') {
        const hasPermission = exists(
          db
            .select({ id: trainingPermissions.id })
            .from(trainingPermissions)
            .where(
              and(
                eq(trainingPermissions.trainingId, trainings.id),
                eq(trainingPermissions.userId, input.actorId),
              ),
            ),
        );

        const isPublishedPublic = and(
          eq(trainings.status, 'published'),
          eq(trainings.isPublic, true),
        );

        const visibilityCondition = or(
          isPublishedPublic,
          eq(trainings.createdBy, input.actorId),
          hasPermission,
        );
        if (visibilityCondition) {
          conditions.push(visibilityCondition);
        }
      }

      if (input.status !== undefined) {
        conditions.push(eq(trainings.status, input.status));
      }

      if (input.isPublic !== undefined) {
        conditions.push(eq(trainings.isPublic, input.isPublic));
      }

      if (input.categoryId !== undefined) {
        const hasCategory = exists(
          db
            .select({ trainingId: trainingCategories.trainingId })
            .from(trainingCategories)
            .where(
              and(
                eq(trainingCategories.trainingId, trainings.id),
                eq(trainingCategories.categoryId, input.categoryId),
              ),
            ),
        );
        conditions.push(hasCategory);
      }

      const trimmedSearch = input.search?.trim();
      if (trimmedSearch) {
        const pattern = `%${trimmedSearch}%`;
        conditions.push(
          sql`(${trainings.title} % ${trimmedSearch} OR ${trainings.title} ILIKE ${pattern} OR ${trainings.description} ILIKE ${pattern})`,
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const totalRows = await db
        .select({ total: count() })
        .from(trainings)
        .where(whereClause);
      const total = Number(totalRows[0]?.total ?? 0);

      const offset = (input.page - 1) * input.pageSize;
      const orderByClauses: SQL[] = trimmedSearch
        ? [
            desc(
              sql`GREATEST(similarity(${trainings.title}, ${trimmedSearch}), similarity(${trainings.description}, ${trimmedSearch}))`,
            ),
            desc(trainings.updatedAt),
          ]
        : [desc(trainings.updatedAt)];

      const rows = await db
        .select({
          id: trainings.id,
          title: trainings.title,
          description: trainings.description,
          coverUrl: trainings.coverUrl,
          status: trainings.status,
          isPublic: trainings.isPublic,
          createdBy: trainings.createdBy,
          creatorName: user.name,
          createdAt: trainings.createdAt,
          updatedAt: trainings.updatedAt,
        })
        .from(trainings)
        .leftJoin(user, eq(trainings.createdBy, user.id))
        .where(whereClause)
        .orderBy(...orderByClauses)
        .limit(input.pageSize)
        .offset(offset);

      const ids = rows.map((row) => row.id);
      const [categoriesMap, stepCountsMap, permissionsMap] = await Promise.all([
        loadCategoriesByTrainingIds(ids),
        loadStepCountsByTrainingIds(ids),
        loadPermissionsByTrainingIds(ids, input.actorId),
      ]);

      const items: TrainingRecord[] = rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        coverUrl: row.coverUrl,
        status: row.status,
        isPublic: row.isPublic,
        createdBy: row.createdBy,
        creatorName: row.creatorName ?? null,
        categories: categoriesMap.get(row.id) ?? [],
        stepCount: stepCountsMap.get(row.id) ?? 0,
        permissionLevel: permissionsMap.get(row.id) ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));

      return {
        trainings: items,
        pagination: {
          page: input.page,
          pageSize: input.pageSize,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / input.pageSize),
        },
      };
    },

    async findByIdForActor(trainingId: string, actorId: string): Promise<TrainingRecord | null> {
      const rows = await db
        .select({
          id: trainings.id,
          title: trainings.title,
          description: trainings.description,
          coverUrl: trainings.coverUrl,
          status: trainings.status,
          isPublic: trainings.isPublic,
          createdBy: trainings.createdBy,
          creatorName: user.name,
          createdAt: trainings.createdAt,
          updatedAt: trainings.updatedAt,
        })
        .from(trainings)
        .leftJoin(user, eq(trainings.createdBy, user.id))
        .where(eq(trainings.id, trainingId))
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      const [categoriesMap, stepCountsMap, permissionsMap] = await Promise.all([
        loadCategoriesByTrainingIds([row.id]),
        loadStepCountsByTrainingIds([row.id]),
        loadPermissionsByTrainingIds([row.id], actorId),
      ]);

      return {
        id: row.id,
        title: row.title,
        description: row.description,
        coverUrl: row.coverUrl,
        status: row.status,
        isPublic: row.isPublic,
        createdBy: row.createdBy,
        creatorName: row.creatorName ?? null,
        categories: categoriesMap.get(row.id) ?? [],
        stepCount: stepCountsMap.get(row.id) ?? 0,
        permissionLevel: permissionsMap.get(row.id) ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },

    async getAccessSnapshot(
      trainingId: string,
      actorId: string,
    ): Promise<TrainingAccessSnapshot | null> {
      const rows = await db
        .select({
          id: trainings.id,
          createdBy: trainings.createdBy,
          status: trainings.status,
          isPublic: trainings.isPublic,
          coverUrl: trainings.coverUrl,
        })
        .from(trainings)
        .where(eq(trainings.id, trainingId))
        .limit(1);

      const row = rows[0];
      if (!row) return null;

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
        id: row.id,
        createdBy: row.createdBy,
        status: row.status,
        isPublic: row.isPublic,
        coverUrl: row.coverUrl,
        permissionLevel: permRows[0]?.permission ?? null,
      };
    },

    async countExistingCategories(categoryIds: readonly string[]): Promise<number> {
      if (categoryIds.length === 0) return 0;
      const rows = await db
        .select({ total: count() })
        .from(categories)
        .where(inArray(categories.id, [...categoryIds]));
      return Number(rows[0]?.total ?? 0);
    },

    async createTraining(input): Promise<TrainingRecord> {
      const createdId = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(trainings)
          .values({
            title: input.title,
            description: input.description,
            coverUrl: input.coverUrl,
            status: input.status,
            isPublic: input.isPublic,
            createdBy: input.createdBy,
          })
          .returning({ id: trainings.id });

        const trainingId = inserted[0]?.id;
        if (!trainingId) {
          throw new Error('Failed to insert training');
        }

        if (input.categoryIds.length > 0) {
          await tx.insert(trainingCategories).values(
            input.categoryIds.map((categoryId) => ({
              trainingId,
              categoryId,
            })),
          );
        }

        return trainingId;
      });

      const created = await this.findByIdForActor(createdId, input.createdBy);
      if (!created) {
        throw new Error('Failed to load newly created training');
      }
      return created;
    },

    async updateTraining(
      trainingId: string,
      actorId: string,
      patch,
      categoryIds?: readonly string[],
    ): Promise<TrainingRecord | null> {
      const updated = await db.transaction(async (tx) => {
        const rows = await tx
          .update(trainings)
          .set({
            ...patch,
            updatedAt: new Date(),
          })
          .where(eq(trainings.id, trainingId))
          .returning({ id: trainings.id });

        if (!rows[0]) {
          return false;
        }

        if (categoryIds !== undefined) {
          await tx
            .delete(trainingCategories)
            .where(eq(trainingCategories.trainingId, trainingId));

          if (categoryIds.length > 0) {
            await tx.insert(trainingCategories).values(
              categoryIds.map((categoryId) => ({
                trainingId,
                categoryId,
              })),
            );
          }
        }

        return true;
      });

      if (!updated) return null;
      return this.findByIdForActor(trainingId, actorId);
    },

    async deleteTrainingAndCollectMedia(trainingId: string): Promise<{
      deleted: boolean;
      coverUrl: string | null;
      attachmentStorageKeys: string[];
    }> {
      return db.transaction(async (tx) => {
        const existing = await tx
          .select({
            id: trainings.id,
            coverUrl: trainings.coverUrl,
          })
          .from(trainings)
          .where(eq(trainings.id, trainingId))
          .limit(1);

        const target = existing[0];
        if (!target) {
          return {
            deleted: false,
            coverUrl: null,
            attachmentStorageKeys: [],
          };
        }

        const attachmentRows = await tx
          .select({ storageKey: stepAttachments.storageKey })
          .from(stepAttachments)
          .innerJoin(trainingSteps, eq(stepAttachments.stepId, trainingSteps.id))
          .where(eq(trainingSteps.trainingId, trainingId));

        await tx.delete(trainings).where(eq(trainings.id, trainingId));

        return {
          deleted: true,
          coverUrl: target.coverUrl,
          attachmentStorageKeys: [
            ...new Set(attachmentRows.map((row) => row.storageKey).filter(Boolean)),
          ],
        };
      });
    },
  };
}

/**
 * Domain service encapsulating training visibility isolation, rich-text HTML
 * sanitization, transactional category validation/sync, and cascade media cleanup.
 */
export class TrainingsService {
  private readonly repo: TrainingsRepository;
  private readonly storage: StorageConnector;

  constructor(deps: { repo: TrainingsRepository; storage: StorageConnector }) {
    this.repo = deps.repo;
    this.storage = deps.storage;
  }

  async listTrainings(input: ListTrainingsInput): Promise<ListTrainingsResult> {
    return this.repo.listTrainings(input);
  }

  async getTrainingById(
    trainingId: string,
    actorId: string,
    actorRole: UserRole,
  ): Promise<TrainingRecord> {
    const training = await this.repo.findByIdForActor(trainingId, actorId);
    if (!training) {
      throw new TrainingServiceError(404, 'TRAINING_NOT_FOUND', 'Training not found');
    }

    if (
      !canViewTraining(
        actorRole,
        actorId,
        {
          createdBy: training.createdBy,
          status: training.status,
          isPublic: training.isPublic,
        },
        training.permissionLevel,
      )
    ) {
      throw new TrainingServiceError(
        403,
        'FORBIDDEN',
        'You do not have permission to view this training',
      );
    }

    return training;
  }

  async createTraining(input: CreateTrainingInput): Promise<TrainingRecord> {
    if (!canCreateTraining(input.actorRole)) {
      throw new TrainingServiceError(
        403,
        'FORBIDDEN',
        'Only administrators and creators can create trainings',
      );
    }

    const categoryIds = deduplicateIds(input.categoryIds);
    if (categoryIds.length > 0) {
      const existingCount = await this.repo.countExistingCategories(categoryIds);
      if (existingCount !== categoryIds.length) {
        throw new TrainingServiceError(
          400,
          'INVALID_CATEGORY',
          'One or more categoryIds do not exist',
        );
      }
    }

    return this.repo.createTraining({
      title: input.title,
      description: sanitizeRichTextHtml(input.description ?? ''),
      coverUrl: input.coverUrl ?? null,
      status: input.status ?? 'draft',
      isPublic: input.isPublic ?? true,
      createdBy: input.actorId,
      categoryIds,
    });
  }

  async updateTraining(input: UpdateTrainingInput): Promise<TrainingRecord> {
    const snapshot = await this.repo.getAccessSnapshot(input.trainingId, input.actorId);
    if (!snapshot) {
      throw new TrainingServiceError(404, 'TRAINING_NOT_FOUND', 'Training not found');
    }

    if (
      !canEditTraining(
        input.actorRole,
        input.actorId,
        { createdBy: snapshot.createdBy },
        snapshot.permissionLevel,
      )
    ) {
      throw new TrainingServiceError(
        403,
        'FORBIDDEN',
        'You do not have permission to edit this training',
      );
    }

    const categoryIds =
      input.categoryIds !== undefined ? deduplicateIds(input.categoryIds) : undefined;
    if (categoryIds && categoryIds.length > 0) {
      const existingCount = await this.repo.countExistingCategories(categoryIds);
      if (existingCount !== categoryIds.length) {
        throw new TrainingServiceError(
          400,
          'INVALID_CATEGORY',
          'One or more categoryIds do not exist',
        );
      }
    }

    const patch: Partial<{
      title: string;
      description: string;
      coverUrl: string | null;
      status: TrainingStatus;
      isPublic: boolean;
    }> = {};

    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) {
      patch.description = sanitizeRichTextHtml(input.description);
    }
    if (input.coverUrl !== undefined) patch.coverUrl = input.coverUrl;
    if (input.status !== undefined) patch.status = input.status;
    if (input.isPublic !== undefined) patch.isPublic = input.isPublic;

    const updated = await this.repo.updateTraining(
      input.trainingId,
      input.actorId,
      patch,
      categoryIds,
    );
    if (!updated) {
      throw new TrainingServiceError(404, 'TRAINING_NOT_FOUND', 'Training not found');
    }

    return updated;
  }

  async deleteTraining(
    trainingId: string,
    actorId: string,
    actorRole: UserRole,
  ): Promise<DeleteTrainingResult> {
    const snapshot = await this.repo.getAccessSnapshot(trainingId, actorId);
    if (!snapshot) {
      throw new TrainingServiceError(404, 'TRAINING_NOT_FOUND', 'Training not found');
    }

    if (
      !canManageTrainingOwnership(
        actorRole,
        actorId,
        { createdBy: snapshot.createdBy },
        snapshot.permissionLevel,
      )
    ) {
      throw new TrainingServiceError(
        403,
        'FORBIDDEN',
        'You do not have permission to delete this training',
      );
    }

    const result = await this.repo.deleteTrainingAndCollectMedia(trainingId);
    if (!result.deleted) {
      throw new TrainingServiceError(404, 'TRAINING_NOT_FOUND', 'Training not found');
    }

    const coverKey = extractTrainingCoverStorageKey(result.coverUrl);
    const attachmentKeys = [...new Set(result.attachmentStorageKeys.filter(Boolean))];

    const cleanupTasks: Promise<void>[] = [];
    if (coverKey) {
      cleanupTasks.push(this.storage.deleteObject('training-covers', coverKey));
    }
    if (attachmentKeys.length > 0) {
      cleanupTasks.push(this.storage.deleteObjects('step-attachments', attachmentKeys));
    }

    if (cleanupTasks.length > 0) {
      await Promise.allSettled(cleanupTasks);
    }

    return {
      deleted: true,
      id: trainingId,
      cleanedCoverKey: coverKey,
      cleanedAttachmentKeys: attachmentKeys,
    };
  }
}

