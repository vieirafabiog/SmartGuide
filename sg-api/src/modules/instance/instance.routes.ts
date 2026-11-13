import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getEnabledAuthProviders, type AuthInstance } from '../../auth/auth.js';
import { createAuthGuards } from '../../auth/guards.js';
import type { AppEnv } from '../../config/env.js';
import type { Database } from '../../db/index.js';
import { instanceSettings, SUPPORTED_LOCALES } from '../../db/schema/index.js';

/**
 * Produces a non-sensitive display hint for SG_LICENSE_KEY without leaking raw secrets.
 */
export function buildLicenseKeyHint(licenseKey?: string): string | null {
  if (!licenseKey) return null;
  const trimmed = licenseKey.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 12) return '****';
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
}

const updateSettingsSchema = z
  .object({
    siteName: z.string().trim().min(1).max(120).optional(),
    logoUrl: z
      .string()
      .trim()
      .max(500)
      .refine(
        (val) =>
          val === '' ||
          val.startsWith('/api/v1/media/') ||
          val.startsWith('https://') ||
          val.startsWith('http://'),
        'logoUrl must be a relative /api/v1/media/ path or http(s) URL',
      )
      .nullable()
      .optional(),
    defaultLocale: z.enum(SUPPORTED_LOCALES).optional(),
    allowPublicSignup: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.siteName !== undefined ||
      data.logoUrl !== undefined ||
      data.defaultLocale !== undefined ||
      data.allowPublicSignup !== undefined,
    { message: 'At least one setting field must be provided' },
  );

/**
 * Registers instance discovery (`GET /api/v1/instance/info`) and admin settings (`PATCH /api/v1/instance/settings`).
 */
export function registerInstanceRoutes(
  app: FastifyInstance,
  deps: { db: Database; auth: AuthInstance; env: AppEnv },
): void {
  const guards = createAuthGuards(deps.auth);

  app.get('/api/v1/instance/info', async (_request: FastifyRequest, reply: FastifyReply) => {
    const rows = await deps.db
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.id, 1))
      .limit(1);

    const settings = rows[0];

    return reply.code(200).send({
      instanceUuid: settings?.instanceUuid ?? null,
      name: settings?.siteName ?? deps.env.INSTANCE_NAME,
      logoUrl: settings?.logoUrl ?? null,
      defaultLocale: settings?.defaultLocale ?? deps.env.APP_DEFAULT_LOCALE,
      allowPublicSignup:
        settings?.allowPublicSignup ?? deps.env.AUTH_ALLOW_PUBLIC_SIGNUP,
      authProviders: getEnabledAuthProviders(deps.env),
      licenseConfigured: Boolean(deps.env.SG_LICENSE_KEY),
      licenseKeyHint: buildLicenseKeyHint(deps.env.SG_LICENSE_KEY),
    });
  });

  app.patch(
    '/api/v1/instance/settings',
    { preHandler: [guards.requireAuth, guards.requireRole(['admin'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = updateSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          errorCode: 'INVALID_REQUEST',
          message: parsed.error.issues.map((i) => i.message).join('; '),
        });
      }

      const patchValues: {
        siteName?: string;
        logoUrl?: string | null;
        defaultLocale?: (typeof SUPPORTED_LOCALES)[number];
        allowPublicSignup?: boolean;
        updatedAt: Date;
      } = {
        updatedAt: new Date(),
      };

      if (parsed.data.siteName !== undefined) {
        patchValues.siteName = parsed.data.siteName;
      }
      if (parsed.data.logoUrl !== undefined) {
        patchValues.logoUrl = parsed.data.logoUrl === '' ? null : parsed.data.logoUrl;
      }
      if (parsed.data.defaultLocale !== undefined) {
        patchValues.defaultLocale = parsed.data.defaultLocale;
      }
      if (parsed.data.allowPublicSignup !== undefined) {
        patchValues.allowPublicSignup = parsed.data.allowPublicSignup;
      }

      const updated = await deps.db
        .update(instanceSettings)
        .set(patchValues)
        .where(eq(instanceSettings.id, 1))
        .returning();

      if (!updated[0]) {
        return reply.code(404).send({
          errorCode: 'INSTANCE_NOT_INITIALIZED',
          message: 'Instance settings record was not found',
        });
      }

      return reply.code(200).send({ settings: updated[0] });
    },
  );
}

