import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { SUPPORTED_LOCALES, user } from './auth.js';

export const TRAINING_STATUSES = ['draft', 'published', 'archived'] as const;
export type TrainingStatus = (typeof TRAINING_STATUSES)[number];

export const ATTACHMENT_TYPES = ['image', 'video'] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

export const PERMISSION_LEVELS = ['owner', 'editor', 'viewer'] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

export const API_KEY_SCOPES = ['users:read', 'users:write', 'trainings:read'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const instanceSettings = pgTable('instance_settings', {
  id: integer('id').primaryKey().default(1),
  instanceUuid: uuid('instance_uuid').notNull().unique(),
  siteName: text('site_name').notNull().default('Smart Guide'),
  logoUrl: text('logo_url'),
  defaultLocale: text('default_locale', { enum: SUPPORTED_LOCALES })
    .notNull()
    .default('pt-BR'),
  allowPublicSignup: boolean('allow_public_signup').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  color: text('color').notNull().default('#3B82F6'),
  icon: text('icon'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const trainings = pgTable(
  'trainings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    coverUrl: text('cover_url'),
    status: text('status', { enum: TRAINING_STATUSES }).notNull().default('draft'),
    isPublic: boolean('is_public').notNull().default(true),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('trainings_created_by_idx').on(table.createdBy),
    index('trainings_status_public_idx').on(table.status, table.isPublic),
  ],
);

export const trainingCategories = pgTable(
  'training_categories',
  {
    trainingId: uuid('training_id')
      .notNull()
      .references(() => trainings.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.trainingId, table.categoryId] }),
    index('training_categories_category_id_idx').on(table.categoryId),
  ],
);

export const trainingSteps = pgTable(
  'training_steps',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    trainingId: uuid('training_id')
      .notNull()
      .references(() => trainings.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    stepOrder: integer('step_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('training_steps_training_order_idx').on(table.trainingId, table.stepOrder)],
);

export const stepAttachments = pgTable(
  'step_attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    stepId: uuid('step_id')
      .notNull()
      .references(() => trainingSteps.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    storageKey: text('storage_key').notNull(),
    fileUrl: text('file_url').notNull(),
    fileType: text('file_type', { enum: ATTACHMENT_TYPES }).notNull(),
    mimeType: text('mime_type').notNull(),
    fileSize: integer('file_size').notNull().default(0),
    attOrder: integer('att_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('step_attachments_step_order_idx').on(table.stepId, table.attOrder)],
);

export const trainingPermissions = pgTable(
  'training_permissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    trainingId: uuid('training_id')
      .notNull()
      .references(() => trainings.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    permission: text('permission', { enum: PERMISSION_LEVELS }).notNull().default('viewer'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('training_permissions_training_user_uidx').on(table.trainingId, table.userId),
    index('training_permissions_user_id_idx').on(table.userId),
  ],
);

export const trainingProgress = pgTable(
  'training_progress',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    trainingId: uuid('training_id')
      .notNull()
      .references(() => trainings.id, { onDelete: 'cascade' }),
    stepId: uuid('step_id')
      .notNull()
      .references(() => trainingSteps.id, { onDelete: 'cascade' }),
    completed: boolean('completed').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('training_progress_user_step_uidx').on(table.userId, table.stepId),
    index('training_progress_user_training_idx').on(table.userId, table.trainingId),
  ],
);

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  scopes: text('scopes')
    .array()
    .notNull()
    .default(['users:read', 'trainings:read']),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
