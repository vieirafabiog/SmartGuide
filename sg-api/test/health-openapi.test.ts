import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { AuthInstance } from '../src/auth/auth.js';
import { parseEnv, type AppEnv } from '../src/config/env.js';
import type { Database } from '../src/db/index.js';
import { buildServer } from '../src/server.js';
import type { StorageConnector } from '../src/storage/index.js';

function createTestEnv(): AppEnv {
  return parseEnv({
    NODE_ENV: 'test',
    INSTANCE_NAME: 'Smart Guide Test',
    DATABASE_URL: 'postgresql://smart_guide@localhost:5432/smart_guide',
    BETTER_AUTH_SECRET: 'test-secret-with-at-least-32-characters-1234',
    CORS_ORIGINS: 'http://localhost:8080',
  });
}

function createMockAuth(): AuthInstance {
  return {
    handler: vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
    api: {
      getSession: vi.fn(async () => null),
    },
  } as unknown as AuthInstance;
}

function createMockStorage(healthy = true): StorageConnector {
  return {
    driver: 'local',
    putObject: vi.fn(),
    getObjectStream: vi.fn(),
    headObject: vi.fn(),
    deleteObject: vi.fn(),
    deleteObjects: vi.fn(),
    healthcheck: vi.fn(async () => healthy),
  };
}

describe('Fastify Server Assembly, Security Middleware, Health & Self-Hosted Swagger UI', () => {
  it('exposes /health diagnostics (200 ok / 503 degraded), Helmet headers, and strict CORS', async () => {
    let dbHealthy = true;
    const storage = createMockStorage(true);
    const app = await buildServer({
      env: createTestEnv(),
      db: {} as Database,
      pool: {} as pg.Pool,
      auth: createMockAuth(),
      storage,
      checkDbHealth: async () => dbHealthy,
      logger: false,
    });

    // Healthy -> 200
    const okRes = await app.inject({ method: 'GET', url: '/health' });
    expect(okRes.statusCode).toBe(200);
    expect(okRes.json().status).toBe('ok');
    expect(okRes.json().checks).toEqual({ postgres: 'up', storage: 'up' });
    expect(okRes.headers['x-content-type-options']).toBe('nosniff');
    expect(okRes.headers['content-security-policy']).toBeDefined();

    // Degraded -> 503
    dbHealthy = false;
    const degradedRes = await app.inject({ method: 'GET', url: '/health' });
    expect(degradedRes.statusCode).toBe(503);
    expect(degradedRes.json().status).toBe('degraded');
    expect(degradedRes.json().checks).toEqual({ postgres: 'down', storage: 'up' });

    // Strict CORS: allowed origin passes, unlisted origin rejected
    const allowedCors = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:8080' },
    });
    expect(allowedCors.headers['access-control-allow-origin']).toBe('http://localhost:8080');
    expect(allowedCors.headers['access-control-allow-credentials']).toBe('true');

    const blockedCors = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example.com' },
    });
    expect(blockedCors.headers['access-control-allow-origin']).toBeUndefined();

    await app.close();
  });

  it('serves self-hosted Swagger UI at /docs with zero external CDN references and valid OpenAPI 3.0.3 JSON', async () => {
    const app = await buildServer({
      env: createTestEnv(),
      db: {} as Database,
      pool: {} as pg.Pool,
      auth: createMockAuth(),
      storage: createMockStorage(true),
      checkDbHealth: async () => true,
      logger: false,
    });

    const docsHtmlRes = await app.inject({ method: 'GET', url: '/docs/' });
    expect(docsHtmlRes.statusCode).toBe(200);
    expect(docsHtmlRes.headers['content-type']).toContain('text/html');
    expect(docsHtmlRes.body).not.toMatch(/unpkg\.com|jsdelivr\.net|cloudflare\.com|https?:\/\//i);

    const openApiRes = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(openApiRes.statusCode).toBe(200);
    const spec = openApiRes.json();
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('Smart Guide Test API');
    expect(spec.components.securitySchemes).toHaveProperty('BearerAuth');
    expect(spec.components.securitySchemes).toHaveProperty('ApiKeyAuth');

    await app.close();
  });

  it('enforces tight per-route rate limiting on /api/auth/* and /api/v1/ext/* while exempting /health', async () => {
    const app = await buildServer({
      env: createTestEnv(),
      db: {} as Database,
      pool: {} as pg.Pool,
      auth: createMockAuth(),
      storage: createMockStorage(true),
      checkDbHealth: async () => true,
      rateLimits: {
        globalMax: 50,
        authMax: 2,
        extMax: 3,
        timeWindow: '1 minute',
      },
      logger: false,
    });

    // /api/auth/* limited at 2
    expect((await app.inject({ method: 'GET', url: '/api/auth/ok' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/ok' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/ok' })).statusCode).toBe(429);

    // /api/v1/ext/* limited at 3 (even unauthenticated 401 counts toward IP rate limit)
    expect((await app.inject({ method: 'GET', url: '/api/v1/ext/users' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/ext/users' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/ext/users' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/ext/users' })).statusCode).toBe(429);

    // /health remains exempt
    for (let i = 0; i < 5; i++) {
      expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    }

    await app.close();
  });
});

