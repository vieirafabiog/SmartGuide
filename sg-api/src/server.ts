import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { AuthInstance } from './auth/auth.js';
import { registerBetterAuthRoutes } from './auth/fastify-plugin.js';
import { registerMobileOAuthRoutes } from './auth/mobile-oauth.js';
import type { AppEnv } from './config/env.js';
import { checkDatabaseHealth, type Database } from './db/index.js';
import { registerApiKeyRoutes } from './modules/api-keys/api-keys.routes.js';
import { registerAttachmentRoutes } from './modules/attachments/attachments.routes.js';
import { registerCategoryRoutes } from './modules/categories/categories.routes.js';
import { registerInstanceRoutes } from './modules/instance/instance.routes.js';
import { registerExternalApiRoutes } from './modules/integrations/external-api.routes.js';
import { registerMediaRoutes } from './modules/media/media.routes.js';
import { registerPermissionRoutes } from './modules/permissions/permissions.routes.js';
import { registerProgressRoutes } from './modules/progress/progress.routes.js';
import { registerStepsRoutes } from './modules/steps/steps.routes.js';
import { registerTrainingRoutes } from './modules/trainings/trainings.routes.js';
import { registerUsersRoutes } from './modules/users/users.routes.js';
import type { StorageConnector } from './storage/index.js';

export interface RateLimitProfile {
  globalMax?: number;
  authMax?: number;
  extMax?: number;
  timeWindow?: string | number;
}

export interface ServerDependencies {
  env: AppEnv;
  db: Database;
  pool: pg.Pool;
  auth: AuthInstance;
  storage: StorageConnector;
  checkDbHealth?: (pool: pg.Pool) => Promise<boolean>;
  rateLimits?: RateLimitProfile;
  logger?: boolean;
}

/**
 * Builds and configures the Fastify server with Helmet, strict CORS,
 * tiered per-route rate limiting, self-hosted Swagger UI (`/docs`),
 * `/health` diagnostics, Better Auth, and all domain API routes.
 */
export async function buildServer(deps: ServerDependencies): Promise<FastifyInstance> {
  const { env, db, pool, auth, storage } = deps;
  const checkDb = deps.checkDbHealth ?? checkDatabaseHealth;
  const allowedOrigins = new Set(env.CORS_ORIGINS);

  const app = Fastify({
    logger: deps.logger ?? env.NODE_ENV !== 'test',
    trustProxy: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, allowedOrigins.has(origin));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'Range'],
    exposedHeaders: [
      'Content-Range',
      'Accept-Ranges',
      'Content-Length',
      'Content-Disposition',
    ],
  });

  const maxUploadBytes =
    Math.max(env.STORAGE_MAX_IMAGE_MB, env.STORAGE_MAX_VIDEO_MB) * 1024 * 1024;
  await app.register(multipart, {
    limits: {
      fileSize: maxUploadBytes,
      files: 1,
    },
  });

  const timeWindow = deps.rateLimits?.timeWindow ?? '1 minute';
  const globalMax = deps.rateLimits?.globalMax ?? 300;
  const authMax = deps.rateLimits?.authMax ?? 30;
  const extMax = deps.rateLimits?.extMax ?? 60;

  // Register before @fastify/rate-limit so its onRoute hook sees per-route limits.
  app.addHook('onRoute', (routeOptions) => {
    const url = routeOptions.url;
    if (url === '/health' || url.startsWith('/docs')) {
      routeOptions.config = {
        ...routeOptions.config,
        rateLimit: false,
      };
      return;
    }

    if (url.startsWith('/api/auth/') || url.startsWith('/api/v1/auth/')) {
      routeOptions.config = {
        ...routeOptions.config,
        rateLimit: {
          max: authMax,
          timeWindow,
        },
      };
      return;
    }

    if (url.startsWith('/api/v1/ext/')) {
      routeOptions.config = {
        ...routeOptions.config,
        rateLimit: {
          max: extMax,
          timeWindow,
        },
      };
    }
  });

  await app.register(rateLimit, {
    global: true,
    max: globalMax,
    timeWindow,
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: `${env.INSTANCE_NAME} API`,
        description:
          'Smart Guide open-source REST API for interactive trainings, steps, media, permissions, and integrations.',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
          ApiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'x-api-key',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  app.get('/health', async (_request, reply) => {
    const [postgresHealthy, storageHealthy] = await Promise.all([
      checkDb(pool).catch(() => false),
      storage.healthcheck().catch(() => false),
    ]);

    const healthy = postgresHealthy && storageHealthy;
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      checks: {
        postgres: postgresHealthy ? 'up' : 'down',
        storage: storageHealthy ? 'up' : 'down',
      },
      timestamp: new Date().toISOString(),
    });
  });

  registerBetterAuthRoutes(app, auth);
  registerMobileOAuthRoutes(app, auth, env);
  registerInstanceRoutes(app, { db, auth, env });
  registerCategoryRoutes(app, { db, auth });
  registerUsersRoutes(app, { db, auth });
  registerApiKeyRoutes(app, { db, auth });
  registerMediaRoutes(app, { auth, storage, env });
  registerTrainingRoutes(app, { db, auth, storage });
  registerStepsRoutes(app, { db, auth, storage });
  registerAttachmentRoutes(app, { db, auth, storage });
  registerPermissionRoutes(app, { db, auth });
  registerProgressRoutes(app, { db, auth });
  registerExternalApiRoutes(app, { db });

  return app;
}
