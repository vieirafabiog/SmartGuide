import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from '../src/db/schema/index.js';

describe('sg-api single-tenant Drizzle PostgreSQL schema', () => {
  it('exports all required Better Auth and core tables', () => {
    const tableConfigs = [
      getTableConfig(schema.user),
      getTableConfig(schema.session),
      getTableConfig(schema.account),
      getTableConfig(schema.verification),
      getTableConfig(schema.instanceSettings),
      getTableConfig(schema.categories),
      getTableConfig(schema.trainings),
      getTableConfig(schema.trainingCategories),
      getTableConfig(schema.trainingSteps),
      getTableConfig(schema.stepAttachments),
      getTableConfig(schema.trainingPermissions),
      getTableConfig(schema.trainingProgress),
      getTableConfig(schema.apiKeys),
    ];

    const names = tableConfigs.map((t) => t.name);
    expect(names).toEqual([
      'user',
      'session',
      'account',
      'verification',
      'instance_settings',
      'categories',
      'trainings',
      'training_categories',
      'training_steps',
      'step_attachments',
      'training_permissions',
      'training_progress',
      'api_keys',
    ]);
  });

  it('contains zero multi-tenant tables, columns, or SaaS roles', () => {
    const tables = [
      schema.user,
      schema.session,
      schema.account,
      schema.verification,
      schema.instanceSettings,
      schema.categories,
      schema.trainings,
      schema.trainingCategories,
      schema.trainingSteps,
      schema.stepAttachments,
      schema.trainingPermissions,
      schema.trainingProgress,
      schema.apiKeys,
    ];

    for (const table of tables) {
      const cfg = getTableConfig(table);
      expect(cfg.name).not.toBe('companies');
      for (const col of cfg.columns) {
        expect(col.name).not.toBe('company_id');
      }
    }

    expect(schema.USER_ROLES).toEqual(['admin', 'creator', 'user']);
    expect(schema.ATTACHMENT_TYPES).toEqual(['image', 'video']);
  });

  it('defines unique constraints on training_permissions and training_progress', () => {
    const permsCfg = getTableConfig(schema.trainingPermissions);
    const progressCfg = getTableConfig(schema.trainingProgress);
    const apiKeysCfg = getTableConfig(schema.apiKeys);

    expect(permsCfg.indexes.some((idx) => idx.config.unique)).toBe(true);
    expect(progressCfg.indexes.some((idx) => idx.config.unique)).toBe(true);
    expect(apiKeysCfg.columns.find((c) => c.name === 'key_hash')?.isUnique).toBe(true);
  });
});
