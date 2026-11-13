import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthInstance } from './auth.js';

function buildWebRequest(request: FastifyRequest): Request {
  const protocol = request.protocol || 'http';
  const host = request.headers.host || 'localhost';
  const url = new URL(request.url, `${protocol}://${host}`);

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

  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  let body: RequestInit['body'];

  if (hasBody && request.body !== undefined && request.body !== null) {
    if (typeof request.body === 'string' || request.body instanceof Uint8Array) {
      body = request.body as RequestInit['body'];
    } else {
      body = JSON.stringify(request.body);
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
    }
  }

  return new Request(url.toString(), {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  });
}

async function forwardAuthResponse(
  response: Response,
  reply: FastifyReply,
): Promise<void> {
  reply.status(response.status);

  const setCookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return;
    reply.header(key, value);
  });

  if (setCookies.length > 0) {
    reply.header('set-cookie', setCookies);
  } else {
    const fallbackCookie = response.headers.get('set-cookie');
    if (fallbackCookie) {
      reply.header('set-cookie', fallbackCookie);
    }
  }

  if (response.status === 204 || response.status === 304 || !response.body) {
    await reply.send();
    return;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await reply.send(buffer);
}

/**
 * Mounts Better Auth's Web Standard fetch handler on Fastify under `/api/auth/*`.
 */
export function registerBetterAuthRoutes(
  app: FastifyInstance,
  auth: AuthInstance,
): void {
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const webRequest = buildWebRequest(request);
    const response = await auth.handler(webRequest);
    await forwardAuthResponse(response, reply);
  };

  app.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    url: '/api/auth/*',
    handler,
  });
}
