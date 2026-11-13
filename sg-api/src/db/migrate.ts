import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import * as schema from './schema/index.js';

/** Arbitrary fixed advisory lock key preventing concurrent migration races across replicas. */
export const MIGRATION_ADVISORY_LOCK_ID = 84_210_042;

export interface RunMigrationsOptions {
  migrationsFolder?: string;
  lockId?: number;
  migrator?: typeof migrate;
}

function defaultMigrationsFolder(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, '../../drizzle');
}

/**
 * Runs pending Drizzle SQL migrations while holding a session-level PostgreSQL advisory lock.
 * Guarantees safe multi-replica startup without concurrent DDL races.
 */
export async function runMigrations(
  pool: pg.Pool,
  options?: RunMigrationsOptions,
): Promise<void> {
  const lockId = options?.lockId ?? MIGRATION_ADVISORY_LOCK_ID;
  const migrationsFolder = options?.migrationsFolder ?? defaultMigrationsFolder();
  const runDrizzleMigrate = options?.migrator ?? migrate;

  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query('SELECT pg_advisory_lock($1)', [lockId]);
    lockAcquired = true;

    const db = drizzle(client, { schema });
    await runDrizzleMigrate(db, { migrationsFolder });
  } finally {
    if (lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
      } catch {
        // Connection teardown will automatically release session-level advisory locks
      }
    }
    client.release();
  }
}
