import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  SUPPORTED_LOCALES,
  USER_ROLES,
  type SupportedLocale,
  type UserRole,
} from '../db/schema/index.js';
import type { AuthInstance } from './auth.js';
import { hasRequiredRole } from './permissions.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  preferredLocale: SupportedLocale;
  image: string | null;
}

export interface AuthSessionInfo {
  id: string;
  token: string;
  expiresAt: Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: AuthenticatedUser;
    authSession?: AuthSessionInfo;
  }
}

function normalizeRole(value: unknown): UserRole {
  if (typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value)) {
    return value as UserRole;
  }
  return 'user';
}

function normalizeLocale(value: unknown): SupportedLocale {
  if (
    typeof value === 'string' &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  ) {
    return value as SupportedLocale;
  }
  return 'pt-BR';
}

export function extractAuthHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

/**
 * Creates Fastify `preHandler` guards backed by Better Auth session verification
 * (supporting both browser cookies and mobile `Authorization: Bearer` tokens).
 */
export function createAuthGuards(auth: AuthInstance) {
  async function loadSession(request: FastifyRequest): Promise<{
    user: AuthenticatedUser;
    session: AuthSessionInfo;
  } | null> {
    const result = await auth.api.getSession({
      headers: extractAuthHeaders(request),
    });

    if (!result || !result.user || !result.session) {
      return null;
    }

    const rawUser = result.user as Record<string, unknown>;
    const rawSession = result.session as Record<string, unknown>;

    const user: AuthenticatedUser = {
      id: String(rawUser.id),
      email: String(rawUser.email),
      name: String(rawUser.name),
      role: normalizeRole(rawUser.role),
      isActive: rawUser.isActive !== false,
      preferredLocale: normalizeLocale(rawUser.preferredLocale),
      image: typeof rawUser.image === 'string' ? rawUser.image : null,
    };

    const session: AuthSessionInfo = {
      id: String(rawSession.id),
      token: String(rawSession.token),
      expiresAt:
        rawSession.expiresAt instanceof Date
          ? rawSession.expiresAt
          : new Date(String(rawSession.expiresAt)),
    };

    return { user, session };
  }

  async function optionalAuth(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const resolved = await loadSession(request);
    if (!resolved) return;

    if (!resolved.user.isActive) {
      await reply.code(403).send({
        errorCode: 'ACCOUNT_DISABLED',
        message: 'Account is disabled',
      });
      return;
    }

    request.currentUser = resolved.user;
    request.authSession = resolved.session;
  }

  async function requireAuth(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const resolved = await loadSession(request);
    if (!resolved) {
      await reply.code(401).send({
        errorCode: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
      return;
    }

    if (!resolved.user.isActive) {
      await reply.code(403).send({
        errorCode: 'ACCOUNT_DISABLED',
        message: 'Account is disabled',
      });
      return;
    }

    request.currentUser = resolved.user;
    request.authSession = resolved.session;
  }

  function requireRole(allowedRoles: readonly UserRole[]) {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      if (!request.currentUser) {
        await requireAuth(request, reply);
        if (reply.sent || !request.currentUser) {
          return;
        }
      }

      if (!hasRequiredRole(request.currentUser.role, allowedRoles)) {
        await reply.code(403).send({
          errorCode: 'FORBIDDEN',
          message: 'Insufficient permissions',
        });
      }
    };
  }

  return {
    optionalAuth,
    requireAuth,
    requireRole,
  };
}

