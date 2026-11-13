import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

const emptyToUndefined = (val: unknown): unknown => {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  return val;
};

const envBoolean = (defaultValue: boolean) =>
  z.preprocess((val) => {
    if (val === undefined || val === null || val === '') {
      return defaultValue;
    }
    if (typeof val === 'boolean') {
      return val;
    }
    if (typeof val === 'string') {
      const normalized = val.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        return true;
      }
      if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
      }
    }
    return val;
  }, z.boolean());

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const optionalHttpUrl = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .url()
    .refine(
      (u) => u.startsWith('http://') || u.startsWith('https://'),
      'Must be an http:// or https:// URL',
    )
    .optional(),
);

const httpUrlWithDefault = (defaultUrl: string) =>
  z.preprocess(
    (val) => emptyToUndefined(val) ?? defaultUrl,
    z
      .string()
      .url()
      .refine(
        (u) => u.startsWith('http://') || u.startsWith('https://'),
        'Must be an http:// or https:// URL',
      ),
  );

const rawEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    INSTANCE_NAME: z.preprocess(
      (v) => emptyToUndefined(v) ?? 'Smart Guide',
      z.string().min(1).max(120),
    ),
    APP_DEFAULT_LOCALE: z.enum(['pt-BR', 'en', 'es']).default('pt-BR'),

    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    WEB_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    API_PUBLIC_URL: httpUrlWithDefault('http://localhost:3000'),
    WEB_PUBLIC_URL: httpUrlWithDefault('http://localhost:8080'),
    CORS_ORIGINS: z.preprocess(
      (v) => emptyToUndefined(v) ?? 'http://localhost:8080',
      z.string().transform((raw) =>
        raw
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      ),
    ),

    POSTGRES_HOST: z.preprocess((v) => emptyToUndefined(v) ?? 'localhost', z.string()),
    POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    POSTGRES_DB: z.preprocess((v) => emptyToUndefined(v) ?? 'smart_guide', z.string()),
    POSTGRES_USER: z.preprocess((v) => emptyToUndefined(v) ?? 'smart_guide', z.string()),
    POSTGRES_PASSWORD: z.string().optional().default(''),
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .refine(
        (u) => u.startsWith('postgresql://') || u.startsWith('postgres://'),
        'DATABASE_URL must start with postgresql:// or postgres://',
      ),

    BETTER_AUTH_SECRET: z
      .string()
      .min(16, 'BETTER_AUTH_SECRET must be at least 16 characters'),
    BETTER_AUTH_URL: optionalHttpUrl,
    AUTH_ALLOW_EMAIL_PASSWORD: envBoolean(true),
    AUTH_ALLOW_PUBLIC_SIGNUP: envBoolean(false),

    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    MICROSOFT_CLIENT_ID: optionalString,
    MICROSOFT_CLIENT_SECRET: optionalString,
    MICROSOFT_TENANT_ID: z.preprocess((v) => emptyToUndefined(v) ?? 'common', z.string().min(1)),
    MOBILE_APP_SCHEME: z.preprocess(
      (v) => emptyToUndefined(v) ?? 'smartguide',
      z
        .string()
        .regex(/^[a-z][a-z0-9+.-]*$/, 'MOBILE_APP_SCHEME must be a valid URI scheme'),
    ),

    STORAGE_DRIVER: z.enum(['local', 's3', 'azure']).default('local'),
    STORAGE_MAX_IMAGE_MB: z.coerce.number().positive().max(100).default(10),
    STORAGE_MAX_VIDEO_MB: z.coerce.number().positive().max(2048).default(150),
    STORAGE_PUBLIC_MEDIA: envBoolean(false),

    LOCAL_STORAGE_PATH: z.preprocess(
      (v) => emptyToUndefined(v) ?? './uploads',
      z.string().min(1),
    ),

    S3_ENDPOINT: optionalHttpUrl,
    S3_REGION: z.preprocess((v) => emptyToUndefined(v) ?? 'us-east-1', z.string().min(1)),
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_FORCE_PATH_STYLE: envBoolean(true),

    AZURE_STORAGE_CONNECTION_STRING: optionalString,
    AZURE_STORAGE_ACCOUNT_NAME: optionalString,
    AZURE_STORAGE_ACCOUNT_KEY: optionalString,
    AZURE_STORAGE_CONTAINER: z.preprocess(
      (v) => emptyToUndefined(v) ?? 'smart-guide-media',
      z.string().min(1),
    ),

    SEED_ADMIN_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
    SEED_ADMIN_PASSWORD: optionalString,
    SEED_ADMIN_NAME: z.preprocess(
      (v) => emptyToUndefined(v) ?? 'Administrator',
      z.string().min(1).max(120),
    ),

    SG_LICENSE_KEY: optionalString,
    SG_CLOUD_RELAY_URL: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .url()
        .refine(
          (u) =>
            u.startsWith('wss://') ||
            u.startsWith('ws://') ||
            u.startsWith('https://') ||
            u.startsWith('http://'),
          'SG_CLOUD_RELAY_URL must use wss://, ws://, https://, or http://',
        )
        .optional(),
    ),
  })
  .superRefine((data, ctx) => {
    if (data.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must contain at least one origin',
      });
    }

    if (data.NODE_ENV === 'production') {
      if (data.CORS_ORIGINS.includes('*')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGINS'],
          message: 'Wildcard "*" is forbidden in CORS_ORIGINS in production',
        });
      }

      if (data.BETTER_AUTH_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['BETTER_AUTH_SECRET'],
          message: 'BETTER_AUTH_SECRET must be at least 32 characters in production',
        });
      }

      if (
        data.BETTER_AUTH_SECRET.startsWith('CHANGE_ME') ||
        data.BETTER_AUTH_SECRET.toLowerCase().includes('placeholder')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['BETTER_AUTH_SECRET'],
          message: 'BETTER_AUTH_SECRET must not use a placeholder value in production',
        });
      }

      if (
        data.SEED_ADMIN_PASSWORD &&
        (data.SEED_ADMIN_PASSWORD.startsWith('CHANGE_ME') ||
          data.SEED_ADMIN_PASSWORD.length < 8)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SEED_ADMIN_PASSWORD'],
          message:
            'SEED_ADMIN_PASSWORD must be at least 8 characters and not a placeholder in production',
        });
      }

      if (
        data.SG_CLOUD_RELAY_URL &&
        (data.SG_CLOUD_RELAY_URL.startsWith('ws://') ||
          data.SG_CLOUD_RELAY_URL.startsWith('http://'))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SG_CLOUD_RELAY_URL'],
          message: 'SG_CLOUD_RELAY_URL must use TLS (wss:// or https://) in production',
        });
      }
    }

    if (Boolean(data.GOOGLE_CLIENT_ID) !== Boolean(data.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GOOGLE_CLIENT_ID'],
        message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must both be set together',
      });
    }

    if (Boolean(data.MICROSOFT_CLIENT_ID) !== Boolean(data.MICROSOFT_CLIENT_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MICROSOFT_CLIENT_ID'],
        message: 'MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must both be set together',
      });
    }

    if (data.STORAGE_DRIVER === 's3') {
      const missing: Array<keyof typeof data> = [];
      if (!data.S3_BUCKET) missing.push('S3_BUCKET');
      if (!data.S3_ACCESS_KEY_ID) missing.push('S3_ACCESS_KEY_ID');
      if (!data.S3_SECRET_ACCESS_KEY) missing.push('S3_SECRET_ACCESS_KEY');
      for (const field of missing) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required when STORAGE_DRIVER=s3`,
        });
      }
    }

    if (data.STORAGE_DRIVER === 'azure') {
      const hasConnStr = Boolean(data.AZURE_STORAGE_CONNECTION_STRING);
      const hasAccountPair =
        Boolean(data.AZURE_STORAGE_ACCOUNT_NAME) && Boolean(data.AZURE_STORAGE_ACCOUNT_KEY);
      if (!hasConnStr && !hasAccountPair) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AZURE_STORAGE_CONNECTION_STRING'],
          message:
            'Provide AZURE_STORAGE_CONNECTION_STRING or both AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY when STORAGE_DRIVER=azure',
        });
      }
    }

    if (data.SG_CLOUD_RELAY_URL && !data.SG_LICENSE_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SG_LICENSE_KEY'],
        message: 'SG_LICENSE_KEY is required when SG_CLOUD_RELAY_URL is configured',
      });
    }
  });

export type AppEnv = Omit<z.infer<typeof rawEnvSchema>, 'BETTER_AUTH_URL'> & {
  BETTER_AUTH_URL: string;
};

/**
 * Parses and validates a raw environment dictionary against the sg-api schema.
 */
export function parseEnv(rawEnv: Record<string, string | undefined>): AppEnv {
  const parsed = rawEnvSchema.safeParse(rawEnv);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return {
    ...parsed.data,
    BETTER_AUTH_URL: parsed.data.BETTER_AUTH_URL ?? parsed.data.API_PUBLIC_URL,
  };
}

/**
 * Loads `.env` from the current directory and parent workspace directory (`../.env`)
 * without overwriting already-defined container/process environment variables, then validates.
 */
export function loadEnv(options?: { cwd?: string }): AppEnv {
  const cwd = options?.cwd ?? process.cwd();
  const candidates = [resolve(cwd, '.env'), resolve(cwd, '..', '.env')];

  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false, quiet: true });
    }
  }

  return parseEnv(process.env);
}
