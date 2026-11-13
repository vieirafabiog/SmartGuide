import WebSocket from 'ws';
import type { AppEnv } from '../config/env.js';

export interface TunnelClientConfig {
  licenseKey?: string;
  relayUrl?: string;
  instanceUuid: string;
  apiPort: number;
  baseReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

export interface TunnelRequestMessage {
  type: 'http_request';
  requestId: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  bodyBase64?: string;
}

export interface TunnelResponseMessage {
  type: 'http_response';
  requestId: string;
  status: number;
  headers: Record<string, string>;
  bodyBase64: string;
}

export interface TunnelClientHandle {
  readonly active: boolean;
  stop(): Promise<void>;
}

export interface TunnelSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: WebSocket.RawData) => void): this;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
}

export interface TunnelClientDependencies {
  createWebSocket?: (url: string) => TunnelSocketLike;
  fetchFn?: typeof fetch;
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

const ALLOWED_METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);

const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'upgrade',
]);

const WS_OPEN_STATE = 1;

/**
 * Returns true only when both `SG_LICENSE_KEY` and `SG_CLOUD_RELAY_URL`
 * are explicitly configured with non-empty values.
 */
export function isTunnelConfigured(
  env: Pick<AppEnv, 'SG_LICENSE_KEY' | 'SG_CLOUD_RELAY_URL'>,
): boolean {
  return Boolean(env.SG_LICENSE_KEY?.trim() && env.SG_CLOUD_RELAY_URL?.trim());
}

/**
 * Converts an `http(s)://` or `ws(s)://` relay URL to its WebSocket equivalent.
 */
export function normalizeRelayWebSocketUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('https://')) {
    return `wss://${trimmed.slice('https://'.length)}`;
  }
  if (trimmed.startsWith('http://')) {
    return `ws://${trimmed.slice('http://'.length)}`;
  }
  return trimmed;
}

/**
 * Strictly validates that an inbound tunnel request path targets only
 * allowed HTTP API/health/docs routes and contains no traversal or authority smuggling.
 */
export function isAllowedTunnelPath(rawPath: string): boolean {
  if (!rawPath || typeof rawPath !== 'string') return false;
  if (!rawPath.startsWith('/') || rawPath.startsWith('//')) return false;
  if (rawPath.includes('\\') || rawPath.includes('@') || /[\r\n\0]/.test(rawPath)) {
    return false;
  }

  const queryIdx = rawPath.indexOf('?');
  const pathOnly = queryIdx === -1 ? rawPath : rawPath.slice(0, queryIdx);

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    return false;
  }

  if (decoded.includes('..') || decoded.includes('\\') || decoded.startsWith('//')) {
    return false;
  }

  return (
    pathOnly === '/health' ||
    pathOnly === '/api' ||
    pathOnly.startsWith('/api/') ||
    pathOnly === '/docs' ||
    pathOnly.startsWith('/docs/')
  );
}

/**
 * Computes capped exponential backoff delay in milliseconds.
 */
export function computeReconnectDelayMs(
  attempt: number,
  baseDelayMs = 1_000,
  maxDelayMs = 30_000,
): number {
  const exponent = Math.max(0, Math.min(attempt, 15));
  return Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
}

function buildJsonErrorResponse(
  requestId: string,
  status: number,
  errorCode: string,
  message: string,
): TunnelResponseMessage {
  const payload = JSON.stringify({ errorCode, message });
  return {
    type: 'http_response',
    requestId,
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    bodyBase64: Buffer.from(payload, 'utf8').toString('base64'),
  };
}

function sanitizeForwardHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (STRIPPED_REQUEST_HEADERS.has(lower)) continue;
    if (typeof value === 'string') {
      result[lower] = value;
    }
  }
  return result;
}

/**
 * Starts the opt-in outbound WebSocket tunnel client when both `licenseKey`
 * and `relayUrl` are configured. Returns a clean no-op handle otherwise.
 */
export function startOutboundTunnel(
  config: TunnelClientConfig,
  deps?: TunnelClientDependencies,
): TunnelClientHandle {
  const licenseKey = config.licenseKey?.trim();
  const relayUrl = config.relayUrl?.trim();

  if (!licenseKey || !relayUrl) {
    return {
      active: false,
      async stop() {
        // Intentional no-op when tunnel is unconfigured
      },
    };
  }

  const wsUrl = normalizeRelayWebSocketUrl(relayUrl);
  const createSocket =
    deps?.createWebSocket ?? ((url: string) => new WebSocket(url));
  const fetchImpl = deps?.fetchFn ?? fetch;
  const log = deps?.onLog ?? (() => {});
  const baseDelayMs = config.baseReconnectDelayMs ?? 1_000;
  const maxDelayMs = config.maxReconnectDelayMs ?? 30_000;
  const localOrigin = `http://127.0.0.1:${config.apiPort}`;

  let stopped = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSocket: TunnelSocketLike | null = null;

  function sendJson(socket: TunnelSocketLike, payload: unknown): void {
    if (socket.readyState === WS_OPEN_STATE) {
      socket.send(JSON.stringify(payload));
    }
  }

  async function handleTunnelRequest(
    socket: TunnelSocketLike,
    msg: TunnelRequestMessage,
  ): Promise<void> {
    if (!isAllowedTunnelPath(msg.path)) {
      sendJson(
        socket,
        buildJsonErrorResponse(
          msg.requestId,
          403,
          'TUNNEL_PATH_FORBIDDEN',
          'Requested path is not permitted over the outbound tunnel',
        ),
      );
      return;
    }

    const method = msg.method.toUpperCase();
    if (!ALLOWED_METHODS.has(method)) {
      sendJson(
        socket,
        buildJsonErrorResponse(
          msg.requestId,
          405,
          'METHOD_NOT_ALLOWED',
          `HTTP method "${method}" is not permitted`,
        ),
      );
      return;
    }

    try {
      const hasBody = method !== 'GET' && method !== 'HEAD' && Boolean(msg.bodyBase64);
      const body = hasBody ? Buffer.from(msg.bodyBase64!, 'base64') : undefined;

      const response = await fetchImpl(`${localOrigin}${msg.path}`, {
        method,
        headers: sanitizeForwardHeaders(msg.headers),
        body,
      });

      const responseBuf = Buffer.from(await response.arrayBuffer());
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const envelope: TunnelResponseMessage = {
        type: 'http_response',
        requestId: msg.requestId,
        status: response.status,
        headers: responseHeaders,
        bodyBase64: responseBuf.toString('base64'),
      };

      sendJson(socket, envelope);
    } catch {
      sendJson(
        socket,
        buildJsonErrorResponse(
          msg.requestId,
          502,
          'TUNNEL_UPSTREAM_ERROR',
          'Failed to forward request to local API server',
        ),
      );
    }
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    const delayMs = computeReconnectDelayMs(attempt, baseDelayMs, maxDelayMs);
    attempt += 1;
    log('info', `Scheduling outbound tunnel reconnect in ${delayMs}ms`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!stopped) {
        connect();
      }
    }, delayMs);
  }

  function connect(): void {
    if (stopped) return;
    const socket = createSocket(wsUrl);
    activeSocket = socket;

    socket.on('open', () => {
      attempt = 0;
      log('info', 'Outbound tunnel connected; registering instance');
      sendJson(socket, {
        type: 'register',
        licenseKey,
        instanceUuid: config.instanceUuid,
      });
    });

    socket.on('message', (raw) => {
      let parsed: unknown;
      try {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8');
        parsed = JSON.parse(text);
      } catch {
        return;
      }

      if (
        parsed &&
        typeof parsed === 'object' &&
        (parsed as { type?: unknown }).type === 'http_request' &&
        typeof (parsed as { requestId?: unknown }).requestId === 'string' &&
        typeof (parsed as { method?: unknown }).method === 'string' &&
        typeof (parsed as { path?: unknown }).path === 'string'
      ) {
        void handleTunnelRequest(socket, parsed as TunnelRequestMessage);
      }
    });

    socket.on('error', (err) => {
      log('warn', `Outbound tunnel socket error: ${err.message}`);
    });

    socket.on('close', () => {
      if (activeSocket === socket) {
        activeSocket = null;
      }
      scheduleReconnect();
    });
  }

  connect();

  return {
    active: true,
    async stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (activeSocket) {
        activeSocket.close(1000, 'Server shutting down');
        activeSocket = null;
      }
    },
  };
}

