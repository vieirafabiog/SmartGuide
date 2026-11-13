import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { z } from 'zod';
import { getRuntimeInfo } from '../src/index.js';

describe('sg-api scaffold', () => {
  it('returns runtime info with expected service identifier', () => {
    const info = getRuntimeInfo();
    expect(info.service).toBe('sg-api');
    expect(info.nodeVersion.startsWith('v')).toBe(true);
  });

  it('loads core ESM dependencies (Fastify and Zod)', () => {
    const app = Fastify({ logger: false });
    const schema = z.object({ service: z.literal('sg-api') });
    expect(app).toBeDefined();
    expect(schema.parse({ service: 'sg-api' }).service).toBe('sg-api');
  });
});

