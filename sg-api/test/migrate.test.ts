import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { checkDatabaseHealth } from '../src/db/index.js';
import { MIGRATION_ADVISORY_LOCK_ID, runMigrations } from '../src/db/migrate.js';

describe('Postgres pool health & advisory-lock migration runner', () => {
  it('acquires pg_advisory_lock before migrating and releases in finally', async () => {
    const calls: string[] = [];
    const mockClient = {
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        return { rows: [] };
      }),
      release: vi.fn(() => {
        calls.push('release');
      }),
    };
    const mockPool = {
      connect: vi.fn(async () => mockClient),
    } as unknown as pg.Pool;

    const mockMigrator = vi.fn(async () => {
      calls.push('migrate');
    });

    await runMigrations(mockPool, {
      migrationsFolder: '/tmp/drizzle',
      migrator: mockMigrator,
    });

    expect(calls).toEqual([
      'SELECT pg_advisory_lock($1)',
      'migrate',
      'SELECT pg_advisory_unlock($1)',
      'release',
    ]);
    expect(mockClient.query).toHaveBeenCalledWith('SELECT pg_advisory_lock($1)', [
      MIGRATION_ADVISORY_LOCK_ID,
    ]);
    expect(mockClient.query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [
      MIGRATION_ADVISORY_LOCK_ID,
    ]);
    expect(mockMigrator).toHaveBeenCalledWith(expect.anything(), {
      migrationsFolder: '/tmp/drizzle',
    });
  });

  it('always unlocks advisory lock and releases client if migration throws', async () => {
    const mockClient = {
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    };
    const mockPool = {
      connect: vi.fn(async () => mockClient),
    } as unknown as pg.Pool;

    const failingMigrator = vi.fn(async () => {
      throw new Error('DDL failure');
    });

    await expect(
      runMigrations(mockPool, { migrator: failingMigrator }),
    ).rejects.toThrow('DDL failure');

    expect(mockClient.query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [
      MIGRATION_ADVISORY_LOCK_ID,
    ]);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('checkDatabaseHealth returns true on SELECT 1 and false on connection failure', async () => {
    const healthyPool = {
      query: vi.fn(async () => ({ rows: [{ '?column?': 1 }] })),
    } as unknown as pg.Pool;
    const brokenPool = {
      query: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    } as unknown as pg.Pool;

    await expect(checkDatabaseHealth(healthyPool)).resolves.toBe(true);
    await expect(checkDatabaseHealth(brokenPool)).resolves.toBe(false);
  });

  it('generated Drizzle SQL migrations include all tables and pg_trgm GIN index', () => {
    const drizzleDir = resolve(process.cwd(), 'drizzle');
    const journal = JSON.parse(
      readFileSync(resolve(drizzleDir, 'meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };

    expect(journal.entries.map((e) => e.tag)).toEqual([
      '0000_init_schema',
      '0001_enable_pg_trgm_search',
    ]);

    const initSql = readFileSync(resolve(drizzleDir, '0000_init_schema.sql'), 'utf8');
    expect(initSql).toContain('CREATE TABLE "trainings"');
    expect(initSql).toContain('CREATE TABLE "instance_settings"');
    expect(initSql).toContain('CREATE TABLE "api_keys"');
    expect(initSql).not.toContain('"companies"');
    expect(initSql).not.toContain('"company_id"');

    const trgmSql = readFileSync(
      resolve(drizzleDir, '0001_enable_pg_trgm_search.sql'),
      'utf8',
    );
    expect(trgmSql).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    expect(trgmSql).toContain('USING gin ("title" gin_trgm_ops)');
  });
});
