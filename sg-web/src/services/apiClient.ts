import { Platform } from 'react-native';
import { getApiBaseUrl } from './serverConfig.service';

const DEFAULT_TIMEOUT_MS = 15_000;

let authToken: string | null = null;
let unauthorizedHandler: (() => void | Promise<void>) | null = null;

export class ApiError extends Error {
  readonly status: number;
  readonly errorCode: string;
  readonly details?: unknown;

  constructor(status: number, errorCode: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errorCode = errorCode;
    this.details = details;
  }
}

export interface ApiRequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  skipUnauthorizedHook?: boolean;
}

/**
 * Sets or clears the in-memory Bearer token used on native mobile requests.
 */
export function setApiAuthToken(token: string | null): void {
  authToken = token?.trim() ? token.trim() : null;
}

/**
 * Returns the currently active in-memory Bearer token (mobile).
 */
export function getApiAuthToken(): string | null {
  return authToken;
}

/**
 * Registers a callback invoked whenever an API request returns HTTP 401
 * (unless `skipUnauthorizedHook: true` is passed).
 */
export function setUnauthorizedHandler(
  handler: (() => void | Promise<void>) | null,
): void {
  unauthorizedHandler = handler;
}

function buildUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) {
    return undefined;
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json().catch(() => undefined);
  }
  const text = await response.text().catch(() => '');
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  options?: ApiRequestOptions,
): Promise<T> {
  const baseUrl = await getApiBaseUrl();
  const url = buildUrl(baseUrl, path);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const externalSignal = options?.signal;

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options?.headers,
  };

  if (!isFormData && body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (authToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const init: RequestInit = {
    method,
    headers,
    signal: controller.signal,
    ...(Platform.OS === 'web' ? { credentials: 'include' } : {}),
    ...(body !== undefined
      ? { body: isFormData ? (body as BodyInit) : JSON.stringify(body) }
      : {}),
  };

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(408, 'REQUEST_TIMEOUT', 'Request timed out');
    }
    throw new ApiError(0, 'NETWORK_ERROR', 'Network request failed');
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  const payload = await parseResponseBody(response);

  if (!response.ok) {
    if (response.status === 401 && !options?.skipUnauthorizedHook && unauthorizedHandler) {
      void Promise.resolve(unauthorizedHandler()).catch(() => undefined);
    }

    const errObj =
      payload && typeof payload === 'object'
        ? (payload as { errorCode?: unknown; message?: unknown })
        : null;

    const errorCode =
      typeof errObj?.errorCode === 'string'
        ? errObj.errorCode
        : `HTTP_${response.status}`;
    const message =
      typeof errObj?.message === 'string'
        ? errObj.message
        : `Request failed with status ${response.status}`;

    throw new ApiError(response.status, errorCode, message, payload);
  }

  return payload as T;
}

export const apiClient = {
  get<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    return request<T>('GET', path, undefined, options);
  },

  post<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return request<T>('POST', path, body, options);
  },

  put<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return request<T>('PUT', path, body, options);
  },

  patch<T>(path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    return request<T>('PATCH', path, body, options);
  },

  delete<T>(path: string, options?: ApiRequestOptions): Promise<T> {
    return request<T>('DELETE', path, undefined, options);
  },

  uploadFormData<T>(
    path: string,
    formData: FormData,
    options?: ApiRequestOptions,
  ): Promise<T> {
    return request<T>('POST', path, formData, options);
  },
};

