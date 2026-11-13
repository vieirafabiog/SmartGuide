import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import { createAuth } from './auth/auth.js';
import { loadEnv } from './config/env.js';
import { createDbContext } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { instanceSettings } from './db/schema/index.js';
import { seedDatabase } from './db/seed.js';
import { buildServer } from './server.js';
import { createStorageConnector } from './storage/index.js';
import { startOutboundTunnel } from './tunnel/client.js';

export interface RuntimeInfo {
  readonly service: 'sg-api';
  readonly nodeVersion: string;
}

/**
 * Returns basic runtime metadata for sg-api.
 */
export function getRuntimeInfo(): RuntimeInfo {
  return {
    service: 'sg-api',
    nodeVersion: process.version,
  };
}

/**
 * Bootstraps environment, PostgreSQL migrations & idempotent seed,
 * storage connector, Fastify HTTP server, and optional outbound tunnel.
 */
export async function startServer(): Promise<void> {
  const env = loadEnv();
  const { pool, db } = createDbContext(env.DATABASE_URL);

  await runMigrations(pool);
  await seedDatabase(db, env);

  const settingsRows = await db
    .select({ instanceUuid: instanceSettings.instanceUuid })
    .from(instanceSettings)
    .where(eq(instanceSettings.id, 1))
    .limit(1);

  const instanceUuid = settingsRows[0]?.instanceUuid ?? '';
  const storage = createStorageConnector(env);
  const auth = createAuth(db, env);

  const app = await buildServer({ env, db, pool, auth, storage });

  await app.listen({
    host: '0.0.0.0',
    port: env.API_PORT,
  });

  const tunnel = startOutboundTunnel(
    {
      licenseKey: env.SG_LICENSE_KEY,
      relayUrl: env.SG_CLOUD_RELAY_URL,
      instanceUuid,
      apiPort: env.API_PORT,
    },
    {
      onLog(level, message) {
        app.log[level](message);
      },
    },
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Received ${signal}; shutting down sg-api`);
    await tunnel.stop();
    await app.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

const isDirectEntrypoint =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectEntrypoint) {
  startServer().catch((err) => {
    console.error('Failed to start sg-api:', err);
    process.exit(1);
  });
}
