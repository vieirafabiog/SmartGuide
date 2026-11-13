import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeReconnectDelayMs,
  isAllowedTunnelPath,
  isTunnelConfigured,
  normalizeRelayWebSocketUrl,
  startOutboundTunnel,
  type TunnelSocketLike,
} from '../src/tunnel/client.js';

class MockTunnelSocket extends EventEmitter implements TunnelSocketLike {
  readyState = 0;
  readonly sentMessages: string[] = [];
  closedWith: { code?: number; reason?: string } | null = null;

  emitOpen(): void {
    this.readyState = 1;
    this.emit('open');
  }

  emitMessage(payload: unknown): void {
    const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.emit('message', Buffer.from(raw, 'utf8'));
  }

  emitClose(code = 1006, reason = ''): void {
    this.readyState = 3;
    this.emit('close', code, Buffer.from(reason, 'utf8'));
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
    this.readyState = 3;
  }
}

describe('Optional Outbound Tunnel Client', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is a clean no-op when SG_LICENSE_KEY or SG_CLOUD_RELAY_URL is unconfigured', async () => {
    expect(isTunnelConfigured({ SG_LICENSE_KEY: undefined, SG_CLOUD_RELAY_URL: undefined })).toBe(
      false,
    );
    expect(
      isTunnelConfigured({ SG_LICENSE_KEY: 'sg_lic_123', SG_CLOUD_RELAY_URL: undefined }),
    ).toBe(false);
    expect(
      isTunnelConfigured({
        SG_LICENSE_KEY: '',
        SG_CLOUD_RELAY_URL: 'https://relay.example.com/ws',
      }),
    ).toBe(false);

    const createWebSocket = vi.fn();
    const handle = startOutboundTunnel(
      {
        licenseKey: undefined,
        relayUrl: 'https://relay.example.com/ws',
        instanceUuid: '11111111-1111-4111-8111-111111111111',
        apiPort: 3000,
      },
      { createWebSocket },
    );

    expect(handle.active).toBe(false);
    expect(createWebSocket).not.toHaveBeenCalled();
    await expect(handle.stop()).resolves.toBeUndefined();
  });

  it('enforces strict path allowlist and blocks traversal or non-API paths', () => {
    expect(isAllowedTunnelPath('/health')).toBe(true);
    expect(isAllowedTunnelPath('/health?verbose=1')).toBe(true);
    expect(isAllowedTunnelPath('/api/v1/trainings?page=1')).toBe(true);
    expect(isAllowedTunnelPath('/api/auth/session')).toBe(true);
    expect(isAllowedTunnelPath('/docs')).toBe(true);
    expect(isAllowedTunnelPath('/docs/static/swagger-ui.js')).toBe(true);

    expect(isAllowedTunnelPath('/')).toBe(false);
    expect(isAllowedTunnelPath('/admin')).toBe(false);
    expect(isAllowedTunnelPath('/etc/passwd')).toBe(false);
    expect(isAllowedTunnelPath('/api/../secret')).toBe(false);
    expect(isAllowedTunnelPath('/api/%2e%2e/secret')).toBe(false);
    expect(isAllowedTunnelPath('//evil.com/api/v1')).toBe(false);
    expect(isAllowedTunnelPath('/api/v1\\..\\secret')).toBe(false);
    expect(isAllowedTunnelPath('/api/v1@evil.com')).toBe(false);
    expect(isAllowedTunnelPath('http://127.0.0.1:5432/')).toBe(false);
  });

  it('registers on open, forwards allowed paths to 127.0.0.1:${API_PORT}, and rejects forbidden paths', async () => {
    expect(normalizeRelayWebSocketUrl('https://relay.example.com/tunnel')).toBe(
      'wss://relay.example.com/tunnel',
    );
    expect(normalizeRelayWebSocketUrl('http://localhost:9000/tunnel')).toBe(
      'ws://localhost:9000/tunnel',
    );

    const sockets: MockTunnelSocket[] = [];
    const fetchFn = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const handle = startOutboundTunnel(
      {
        licenseKey: 'sg_lic_test_key',
        relayUrl: 'https://relay.example.com/tunnel',
        instanceUuid: '22222222-2222-4222-8222-222222222222',
        apiPort: 4100,
      },
      {
        createWebSocket: () => {
          const sock = new MockTunnelSocket();
          sockets.push(sock);
          return sock;
        },
        fetchFn,
      },
    );

    expect(handle.active).toBe(true);
    expect(sockets).toHaveLength(1);
    const sock = sockets[0]!;
    sock.emitOpen();

    expect(JSON.parse(sock.sentMessages[0]!)).toEqual({
      type: 'register',
      licenseKey: 'sg_lic_test_key',
      instanceUuid: '22222222-2222-4222-8222-222222222222',
    });

    // Forbidden path is rejected without calling local fetch
    sock.emitMessage({
      type: 'http_request',
      requestId: 'req-forbidden',
      method: 'GET',
      path: '/etc/passwd',
    });
    await vi.waitFor(() => expect(sock.sentMessages).toHaveLength(2));
    const forbiddenResp = JSON.parse(sock.sentMessages[1]!) as {
      type: string;
      requestId: string;
      status: number;
      bodyBase64: string;
    };
    expect(forbiddenResp.status).toBe(403);
    expect(
      JSON.parse(Buffer.from(forbiddenResp.bodyBase64, 'base64').toString('utf8')).errorCode,
    ).toBe('TUNNEL_PATH_FORBIDDEN');
    expect(fetchFn).not.toHaveBeenCalled();

    // Allowed path is forwarded strictly to 127.0.0.1:4100
    sock.emitMessage({
      type: 'http_request',
      requestId: 'req-allowed',
      method: 'GET',
      path: '/api/v1/instance/info',
      headers: { host: 'relay.example.com', accept: 'application/json' },
    });
    await vi.waitFor(() => expect(sock.sentMessages).toHaveLength(3));
    expect(fetchFn).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/api/v1/instance/info',
      expect.objectContaining({
        method: 'GET',
        headers: { accept: 'application/json' },
      }),
    );

    const allowedResp = JSON.parse(sock.sentMessages[2]!) as {
      status: number;
      bodyBase64: string;
    };
    expect(allowedResp.status).toBe(200);
    expect(Buffer.from(allowedResp.bodyBase64, 'base64').toString('utf8')).toBe('{"ok":true}');

    await handle.stop();
    expect(sock.closedWith).toEqual({ code: 1000, reason: 'Server shutting down' });
  });

  it('reconnects with exponential backoff on close and halts after stop()', async () => {
    vi.useFakeTimers();

    expect(computeReconnectDelayMs(0, 100, 1000)).toBe(100);
    expect(computeReconnectDelayMs(1, 100, 1000)).toBe(200);
    expect(computeReconnectDelayMs(2, 100, 1000)).toBe(400);
    expect(computeReconnectDelayMs(10, 100, 1000)).toBe(1000);

    const sockets: MockTunnelSocket[] = [];
    const handle = startOutboundTunnel(
      {
        licenseKey: 'sg_lic_reconnect',
        relayUrl: 'wss://relay.example.com/tunnel',
        instanceUuid: '33333333-3333-4333-8333-333333333333',
        apiPort: 3000,
        baseReconnectDelayMs: 100,
        maxReconnectDelayMs: 1000,
      },
      {
        createWebSocket: () => {
          const sock = new MockTunnelSocket();
          sockets.push(sock);
          return sock;
        },
      },
    );

    expect(sockets).toHaveLength(1);
    sockets[0]!.emitClose(1006, 'network drop');

    await vi.advanceTimersByTimeAsync(99);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(2);

    sockets[1]!.emitClose(1006, 'still down');
    await vi.advanceTimersByTimeAsync(199);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(3);

    await handle.stop();
    sockets[2]!.emitClose(1000, 'stopped');
    await vi.advanceTimersByTimeAsync(5000);
    expect(sockets).toHaveLength(3);
  });
});

