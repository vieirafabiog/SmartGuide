import { verifyPassword } from 'better-auth/crypto';
import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import type { Database } from '../src/db/index.js';
import { account, categories, instanceSettings, user } from '../src/db/schema/index.js';
import { DEFAULT_CATEGORIES, seedDatabase } from '../src/db/seed.js';

interface MockDbState {
  settings: Array<Record<string, unknown>>;
  categories: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
  accounts: Array<Record<string, unknown>>;
}

function createMockDb(initial?: Partial<MockDbState>): { db: Database; state: MockDbState } {
  const state: MockDbState = {
    settings: initial?.settings ? [...initial.settings] : [],
    categories: initial?.categories ? [...initial.categories] : [],
    users: initial?.users ? [...initial.users] : [],
    accounts: initial?.accounts ? [...initial.accounts] : [],
  };

  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === instanceSettings) return state.settings.slice(0, 1);
            if (table === user) {
              return state.users.filter((u) => u.role === 'admin').slice(0, 1);
            }
            return [];
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        const executeCategoryInsert = () => {
          const exists = state.categories.some((c) => c.name === row.name);
          if (exists) return [];
          const inserted = { id: `cat-${state.categories.length + 1}`, ...row };
          state.categories.push(inserted);
          return [{ id: inserted.id }];
        };

        if (table === instanceSettings) {
          return {
            onConflictDoNothing: async () => {
              if (!state.settings.some((s) => s.id === row.id)) {
                state.settings.push(row);
              }
            },
          };
        }

        if (table === categories) {
          return {
            onConflictDoNothing: () => ({
              returning: async () => executeCategoryInsert(),
            }),
          };
        }

        if (table === user) {
          state.users.push(row);
          return Promise.resolve();
        }

        if (table === account) {
          state.accounts.push(row);
          return Promise.resolve();
        }

        return Promise.resolve();
      },
    }),
  };

  const db = {
    transaction: async <T>(fn: (trx: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  } as unknown as Database;

  return { db, state };
}

const baseEnv = (overrides?: Record<string, string>) =>
  parseEnv({
    NODE_ENV: 'development',
    INSTANCE_NAME: 'Acme Training Hub',
    APP_DEFAULT_LOCALE: 'pt-BR',
    DATABASE_URL: 'postgresql://smart_guide:secret@localhost:5432/smart_guide',
    BETTER_AUTH_SECRET: 'dev-secret-key-at-least-16-chars',
    SEED_ADMIN_EMAIL: 'Admin@Acme.com',
    SEED_ADMIN_PASSWORD: 'SuperStrongPassword!2026',
    SEED_ADMIN_NAME: 'Acme Admin',
    ...overrides,
  });

describe('idempotent database seed', () => {
  it('seeds instance settings, default categories, and initial admin with Better Auth password hash', async () => {
    const { db, state } = createMockDb();
    const env = baseEnv();

    const result = await seedDatabase(db, env);

    expect(result).toEqual({
      instanceCreated: true,
      categoriesInserted: DEFAULT_CATEGORIES.length,
      adminCreated: true,
    });

    expect(state.settings).toHaveLength(1);
    expect(state.settings[0]?.siteName).toBe('Acme Training Hub');
    expect(typeof state.settings[0]?.instanceUuid).toBe('string');
    expect(state.categories).toHaveLength(DEFAULT_CATEGORIES.length);

    expect(state.users).toHaveLength(1);
    expect(state.users[0]?.email).toBe('admin@acme.com');
    expect(state.users[0]?.role).toBe('admin');

    expect(state.accounts).toHaveLength(1);
    expect(state.accounts[0]?.providerId).toBe('credential');

    const storedHash = String(state.accounts[0]?.password);
    expect(storedHash).not.toBe('SuperStrongPassword!2026');
    await expect(
      verifyPassword({
        password: 'SuperStrongPassword!2026',
        hash: storedHash,
      }),
    ).resolves.toBe(true);
  });

  it('is completely idempotent when run a second time', async () => {
    const { db, state } = createMockDb();
    const env = baseEnv();

    await seedDatabase(db, env);
    const originalUuid = state.settings[0]?.instanceUuid;

    const second = await seedDatabase(db, env);
    expect(second).toEqual({
      instanceCreated: false,
      categoriesInserted: 0,
      adminCreated: false,
    });
    expect(state.settings).toHaveLength(1);
    expect(state.settings[0]?.instanceUuid).toBe(originalUuid);
    expect(state.users).toHaveLength(1);
    expect(state.accounts).toHaveLength(1);
  });

  it('skips admin creation safely when SEED_ADMIN_EMAIL or SEED_ADMIN_PASSWORD is absent', async () => {
    const { db, state } = createMockDb();
    const env = baseEnv({ SEED_ADMIN_EMAIL: '', SEED_ADMIN_PASSWORD: '' });

    const result = await seedDatabase(db, env);
    expect(result).toEqual({
      instanceCreated: true,
      categoriesInserted: DEFAULT_CATEGORIES.length,
      adminCreated: false,
    });
    expect(state.users).toHaveLength(0);
    expect(state.accounts).toHaveLength(0);
  });
});
