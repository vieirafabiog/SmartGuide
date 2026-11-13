import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv, parseEnv } from '../src/config/env.js';

const validBaseEnv = (): Record<string, string> => ({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://smart_guide:secret@localhost:5432/smart_guide',
  BETTER_AUTH_SECRET: 'dev-secret-key-at-least-16-chars',
  CORS_ORIGINS: 'http://localhost:8080, http://localhost:8081',
});

describe('sg-api env loader & Zod validation', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('parses valid development defaults and splits CORS_ORIGINS cleanly', () => {
    const env = parseEnv(validBaseEnv());
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3000);
    expect(env.APP_DEFAULT_LOCALE).toBe('pt-BR');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:8080', 'http://localhost:8081']);
    expect(env.BETTER_AUTH_URL).toBe('http://localhost:3000');
    expect(env.AUTH_ALLOW_EMAIL_PASSWORD).toBe(true);
    expect(env.AUTH_ALLOW_PUBLIC_SIGNUP).toBe(false);
    expect(env.STORAGE_DRIVER).toBe('local');
    expect(env.STORAGE_PUBLIC_MEDIA).toBe(false);
  });

  it('parses boolean flags accurately without coercing "false" to true', () => {
    const env = parseEnv({
      ...validBaseEnv(),
      AUTH_ALLOW_EMAIL_PASSWORD: 'false',
      AUTH_ALLOW_PUBLIC_SIGNUP: 'true',
      STORAGE_PUBLIC_MEDIA: '0',
      S3_FORCE_PATH_STYLE: 'no',
    });
    expect(env.AUTH_ALLOW_EMAIL_PASSWORD).toBe(false);
    expect(env.AUTH_ALLOW_PUBLIC_SIGNUP).toBe(true);
    expect(env.STORAGE_PUBLIC_MEDIA).toBe(false);
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('enforces strong BETTER_AUTH_SECRET and forbids wildcard CORS in production', () => {
    expect(() =>
      parseEnv({
        ...validBaseEnv(),
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: 'short-secret-under-32-chars',
      }),
    ).toThrow(/BETTER_AUTH_SECRET/);

    expect(() =>
      parseEnv({
        ...validBaseEnv(),
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: 'CHANGE_ME_GENERATE_32_PLUS_BYTES_RANDOM_HEX',
      }),
    ).toThrow(/placeholder/);

    expect(() =>
      parseEnv({
        ...validBaseEnv(),
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
        CORS_ORIGINS: '*',
      }),
    ).toThrow(/Wildcard "\*"/);
  });

  it('requires S3 credentials when STORAGE_DRIVER=s3', () => {
    expect(() =>
      parseEnv({
        ...validBaseEnv(),
        STORAGE_DRIVER: 's3',
      }),
    ).toThrow(/S3_BUCKET/);

    const s3Env = parseEnv({
      ...validBaseEnv(),
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: 'http://minio:9000',
      S3_BUCKET: 'smart-guide-media',
      S3_ACCESS_KEY_ID: 'minioadmin',
      S3_SECRET_ACCESS_KEY: 'minioadmin123',
    });
    expect(s3Env.STORAGE_DRIVER).toBe('s3');
    expect(s3Env.S3_BUCKET).toBe('smart-guide-media');
  });

  it('requires Azure connection string or account pair when STORAGE_DRIVER=azure', () => {
    expect(() =>
      parseEnv({
        ...validBaseEnv(),
        STORAGE_DRIVER: 'azure',
      }),
    ).toThrow(/AZURE_STORAGE_CONNECTION_STRING/);

    const azureEnv = parseEnv({
      ...validBaseEnv(),
      STORAGE_DRIVER: 'azure',
      AZURE_STORAGE_ACCOUNT_NAME: 'sgaccount',
      AZURE_STORAGE_ACCOUNT_KEY: 'base64key==',
      AZURE_STORAGE_CONTAINER: 'media',
    });
    expect(azureEnv.STORAGE_DRIVER).toBe('azure');
    expect(azureEnv.AZURE_STORAGE_CONTAINER).toBe('media');
  });

  it('requires paired OAuth client ID and secret for Google and Microsoft', () => {
    expect(() =>
      parseEnv({
        ...validBaseEnv(),
        GOOGLE_CLIENT_ID: 'google-id-only',
      }),
    ).toThrow(/GOOGLE_CLIENT_ID/);

    expect(() =>
      parseEnv({
        ...validBaseEnv(),
        MICROSOFT_CLIENT_SECRET: 'ms-secret-only',
      }),
    ).toThrow(/MICROSOFT_CLIENT_ID/);
  });

  it('validates optional SG_CLOUD_RELAY_URL + SG_LICENSE_KEY pairing and TLS in production', () => {
    expect(() =>
      parseEnv({
        ...validBaseEnv(),
        SG_CLOUD_RELAY_URL: 'wss://relay.example.com',
      }),
    ).toThrow(/SG_LICENSE_KEY/);

    expect(() =>
      parseEnv({
        ...validBaseEnv(),
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
        SG_LICENSE_KEY: 'sg_lic_123',
        SG_CLOUD_RELAY_URL: 'ws://insecure-relay.example.com',
      }),
    ).toThrow(/TLS/);

    const validRelayEnv = parseEnv({
      ...validBaseEnv(),
      NODE_ENV: 'production',
      BETTER_AUTH_SECRET: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
      SG_LICENSE_KEY: 'sg_lic_123',
      SG_CLOUD_RELAY_URL: 'wss://relay.example.com',
    });
    expect(validRelayEnv.SG_CLOUD_RELAY_URL).toBe('wss://relay.example.com');
  });

  it('loads ../.env for local dev while respecting already-set process env vars', () => {
    const parentDir = mkdtempSync(join(tmpdir(), 'sg-env-test-'));
    tempDirs.push(parentDir);
    const subDir = join(parentDir, 'sg-api');
    mkdtempSync(join(parentDir, 'dummy'));
    writeFileSync(
      join(parentDir, '.env'),
      [
        'NODE_ENV=development',
        'DATABASE_URL=postgresql://u:p@localhost:5432/db_from_parent',
        'BETTER_AUTH_SECRET=parent_secret_1234567890',
        'INSTANCE_NAME=Parent Instance',
      ].join('\n'),
    );

    const prevDbUrl = process.env.DATABASE_URL;
    const prevSecret = process.env.BETTER_AUTH_SECRET;
    const prevName = process.env.INSTANCE_NAME;

    try {
      delete process.env.DATABASE_URL;
      delete process.env.BETTER_AUTH_SECRET;
      process.env.INSTANCE_NAME = 'Container Override';

      // Create actual subDir
      const nested = mkdtempSync(join(parentDir, 'sub-'));
      expect(subDir).toBeTruthy();

      const loaded = loadEnv({ cwd: nested });
      expect(loaded.DATABASE_URL).toBe('postgresql://u:p@localhost:5432/db_from_parent');
      expect(loaded.INSTANCE_NAME).toBe('Container Override');
    } finally {
      if (prevDbUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevDbUrl;

      if (prevSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = prevSecret;

      if (prevName === undefined) delete process.env.INSTANCE_NAME;
      else process.env.INSTANCE_NAME = prevName;
    }
  });
});
