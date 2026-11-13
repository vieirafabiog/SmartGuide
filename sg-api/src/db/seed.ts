import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../config/env.js';
import type { Database } from './index.js';
import { account, categories, instanceSettings, user } from './schema/index.js';

export interface SeedCategoryDefinition {
  readonly name: string;
  readonly color: string;
  readonly icon: string;
}

export const DEFAULT_CATEGORIES: readonly SeedCategoryDefinition[] = [
  { name: 'Onboarding', color: '#3B82F6', icon: 'rocket-outline' },
  { name: 'Operations', color: '#10B981', icon: 'layers-outline' },
  { name: 'Security', color: '#EF4444', icon: 'shield-checkmark-outline' },
  { name: 'Systems', color: '#8B5CF6', icon: 'hardware-chip-outline' },
] as const;

export interface SeedResult {
  instanceCreated: boolean;
  categoriesInserted: number;
  adminCreated: boolean;
}

export interface SeedOptions {
  passwordHasher?: (password: string) => Promise<string>;
}

/**
 * Idempotently initializes instance settings, default categories, and the initial admin user.
 * - `instanceSettings` (id=1) is inserted only once so `instanceUuid` remains stable across restarts.
 * - Initial `admin` user is created only if zero admins exist and both SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are set.
 */
export async function seedDatabase(
  db: Database,
  env: AppEnv,
  options?: SeedOptions,
): Promise<SeedResult> {
  const hashFn = options?.passwordHasher ?? hashPassword;

  return db.transaction(async (tx) => {
    const existingSettings = await tx
      .select({ id: instanceSettings.id })
      .from(instanceSettings)
      .where(eq(instanceSettings.id, 1))
      .limit(1);

    let instanceCreated = false;
    if (existingSettings.length === 0) {
      await tx
        .insert(instanceSettings)
        .values({
          id: 1,
          instanceUuid: randomUUID(),
          siteName: env.INSTANCE_NAME,
          defaultLocale: env.APP_DEFAULT_LOCALE,
          allowPublicSignup: env.AUTH_ALLOW_PUBLIC_SIGNUP,
        })
        .onConflictDoNothing({ target: instanceSettings.id });
      instanceCreated = true;
    }

    let categoriesInserted = 0;
    for (const cat of DEFAULT_CATEGORIES) {
      const inserted = await tx
        .insert(categories)
        .values({
          name: cat.name,
          color: cat.color,
          icon: cat.icon,
        })
        .onConflictDoNothing({ target: categories.name })
        .returning({ id: categories.id });
      if (inserted.length > 0) {
        categoriesInserted += 1;
      }
    }

    const existingAdmins = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.role, 'admin'))
      .limit(1);

    let adminCreated = false;
    if (
      existingAdmins.length === 0 &&
      env.SEED_ADMIN_EMAIL &&
      env.SEED_ADMIN_PASSWORD
    ) {
      const normalizedEmail = env.SEED_ADMIN_EMAIL.trim().toLowerCase();
      const adminId = randomUUID();
      const passwordHash = await hashFn(env.SEED_ADMIN_PASSWORD);

      await tx.insert(user).values({
        id: adminId,
        name: env.SEED_ADMIN_NAME,
        email: normalizedEmail,
        emailVerified: true,
        role: 'admin',
        isActive: true,
        preferredLocale: env.APP_DEFAULT_LOCALE,
      });

      await tx.insert(account).values({
        id: randomUUID(),
        accountId: adminId,
        providerId: 'credential',
        userId: adminId,
        password: passwordHash,
      });

      adminCreated = true;
    }

    return {
      instanceCreated,
      categoriesInserted,
      adminCreated,
    };
  });
}
