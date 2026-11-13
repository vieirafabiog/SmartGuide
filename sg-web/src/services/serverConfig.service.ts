import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { checkMobileLicenseAccess } from '@/licensing/licenseGate';
import type { InstanceInfo } from '@/types/database';

const STORAGE_KEY_SERVER_URL = '@sg/server_url';
const STORAGE_KEY_INSTANCE_INFO = '@sg/instance_info';
const DEFAULT_DISCOVERY_TIMEOUT_MS = 10_000;

let cachedServerUrl: string | null = null;
let cachedInstanceInfo: InstanceInfo | null = null;

export class ServerConfigError extends Error {
  readonly code:
    | 'INVALID_URL'
    | 'NETWORK_ERROR'
    | 'INVALID_RESPONSE'
    | 'LICENSE_DENIED';

  constructor(
    code: 'INVALID_URL' | 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'LICENSE_DENIED',
    message: string,
  ) {
    super(message);
    this.name = 'ServerConfigError';
    this.code = code;
  }
}

/**
 * Returns the build-time pinned API URL (`EXPO_PUBLIC_API_URL`) if configured.
 */
export function getPinnedApiUrl(): string | null {
  const raw = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

/**
 * Validates and normalizes a user-entered Smart Guide server URL.
 */
export function normalizeServerUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new ServerConfigError('INVALID_URL', 'Server URL is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ServerConfigError(
      'INVALID_URL',
      'Server URL must be a valid http:// or https:// URL',
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ServerConfigError(
      'INVALID_URL',
      'Server URL must use http:// or https://',
    );
  }

  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

function isValidInstanceInfo(value: unknown): value is InstanceInfo {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.instanceUuid === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.authProviders === 'object' &&
    candidate.authProviders !== null
  );
}

/**
 * Resolves the active API base URL:
 * - Web: `EXPO_PUBLIC_API_URL` if set, otherwise `''` (same-origin `/api/*`).
 * - Native Mobile: `EXPO_PUBLIC_API_URL` if pinned, otherwise saved BYOS URL from `AsyncStorage`.
 */
export async function getApiBaseUrl(): Promise<string> {
  const pinned = getPinnedApiUrl();
  if (pinned) {
    return pinned;
  }

  if (Platform.OS === 'web') {
    return '';
  }

  if (cachedServerUrl) {
    return cachedServerUrl;
  }

  const saved = await AsyncStorage.getItem(STORAGE_KEY_SERVER_URL);
  if (saved) {
    cachedServerUrl = saved.replace(/\/+$/, '');
    return cachedServerUrl;
  }

  return '';
}

/**
 * Queries `GET /api/v1/instance/info` on a Smart Guide server and validates the payload.
 */
export async function discoverInstanceInfo(
  serverUrl: string,
  timeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS,
): Promise<InstanceInfo> {
  const baseUrl = serverUrl ? normalizeServerUrl(serverUrl) : '';
  const endpoint = `${baseUrl}/api/v1/instance/info`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'Connection timed out while contacting Smart Guide server'
        : 'Unable to reach Smart Guide server';
    throw new ServerConfigError('NETWORK_ERROR', message);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new ServerConfigError(
      'INVALID_RESPONSE',
      `Server responded with HTTP ${response.status}`,
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ServerConfigError(
      'INVALID_RESPONSE',
      'Server returned invalid JSON from /api/v1/instance/info',
    );
  }

  if (!isValidInstanceInfo(data)) {
    throw new ServerConfigError(
      'INVALID_RESPONSE',
      'Server response does not match Smart Guide instance metadata',
    );
  }

  return data;
}

/**
 * Validates a BYOS server URL via `/api/v1/instance/info`, evaluates the neutral
 * `licenseGate` hook on native mobile, and persists both URL and `instanceInfo`.
 */
export async function connectToServer(
  rawUrl: string,
): Promise<{ serverUrl: string; instanceInfo: InstanceInfo }> {
  const normalizedUrl = normalizeServerUrl(rawUrl);
  const instanceInfo = await discoverInstanceInfo(normalizedUrl);

  if (Platform.OS !== 'web') {
    const licenseCheck = await checkMobileLicenseAccess(instanceInfo);
    if (!licenseCheck.allowed) {
      throw new ServerConfigError(
        'LICENSE_DENIED',
        licenseCheck.reason ?? 'Server connection is not permitted',
      );
    }
  }

  cachedServerUrl = normalizedUrl;
  cachedInstanceInfo = instanceInfo;

  await AsyncStorage.multiSet([
    [STORAGE_KEY_SERVER_URL, normalizedUrl],
    [STORAGE_KEY_INSTANCE_INFO, JSON.stringify(instanceInfo)],
  ]);

  return { serverUrl: normalizedUrl, instanceInfo };
}

/**
 * Returns the persisted `InstanceInfo` from memory or `AsyncStorage`.
 */
export async function getSavedInstanceInfo(): Promise<InstanceInfo | null> {
  if (cachedInstanceInfo) {
    return cachedInstanceInfo;
  }

  const raw = await AsyncStorage.getItem(STORAGE_KEY_INSTANCE_INFO);
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (isValidInstanceInfo(parsed)) {
      cachedInstanceInfo = parsed;
      return parsed;
    }
  } catch {
    // Ignore corrupted cache entry
  }

  return null;
}

/**
 * Clears saved BYOS server configuration and cached instance metadata.
 */
export async function clearServerConfig(): Promise<void> {
  cachedServerUrl = null;
  cachedInstanceInfo = null;
  await AsyncStorage.multiRemove([STORAGE_KEY_SERVER_URL, STORAGE_KEY_INSTANCE_INFO]);
}

