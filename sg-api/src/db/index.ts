import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DbContext {
  pool: pg.Pool;
  db: Database;
}

/**
 * Creates a configured PostgreSQL connection pool.
 */
export function createPgPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 15,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

/**
 * Creates a Drizzle ORM client bound to the sg-api schema.
 */
export function createDb(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}

/**
 * Creates both the PostgreSQL pool and Drizzle client.
 */
export function createDbContext(databaseUrl: string): DbContext {
  const pool = createPgPool(databaseUrl);
  const db = createDb(pool);
  return { pool, db };
}

/**
 * Verifies live PostgreSQL connectivity via a lightweight SELECT 1 query.
 */
export async function checkDatabaseHealth(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
