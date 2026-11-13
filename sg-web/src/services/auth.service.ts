import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import type { Profile, SupportedLocale, UserRole } from '@/types/database';
import { ApiError, apiClient, setApiAuthToken } from './apiClient';
import { getApiBaseUrl } from './serverConfig.service';

const STORAGE_KEY_AUTH_TOKEN = '@sg/auth_token';

interface BetterAuthUserPayload {
  id: string;
  email: string;
  name: string;
  role?: string;
  isActive?: boolean;
  preferredLocale?: string;
  image?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface BetterAuthSessionResponse {
  user?: BetterAuthUserPayload | null;
  session?: { token?: string } | null;
  token?: string | null;
}

interface MobileExchangeResponse {
  token: string;
  user: BetterAuthUserPayload;
}

function normalizeRole(role: string | undefined): UserRole {
  if (role === 'admin' || role === 'creator' || role === 'user') {
    return role;
  }
  return 'user';
}

function normalizeLocale(locale: string | undefined): SupportedLocale {
  if (locale === 'pt-BR' || locale === 'en' || locale === 'es') {
    return locale;
  }
  return 'pt-BR';
}

function mapUserToProfile(raw: BetterAuthUserPayload): Profile {
  return {
    id: raw.id,
    email: raw.email,
    name: raw.name,
    avatar_url: raw.image ?? null,
    role: normalizeRole(raw.role),
    is_active: raw.isActive !== false,
    preferred_locale: normalizeLocale(raw.preferredLocale),
    created_at: raw.createdAt,
    updated_at: raw.updatedAt,
  };
}

async function persistMobileToken(token: string | null | undefined): Promise<void> {
  if (Platform.OS === 'web') return;
  if (token && token.trim()) {
    const clean = token.trim();
    setApiAuthToken(clean);
    await AsyncStorage.setItem(STORAGE_KEY_AUTH_TOKEN, clean);
  } else {
    setApiAuthToken(null);
    await AsyncStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
  }
}

export const authService = {
  async hydrateStoredToken(): Promise<string | null> {
    if (Platform.OS === 'web') return null;
    const saved = await AsyncStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
    const token = saved?.trim() ? saved.trim() : null;
    setApiAuthToken(token);
    return token;
  },

  async getCurrentProfile(): Promise<Profile | null> {
    try {
      const data = await apiClient.get<BetterAuthSessionResponse | null>(
        '/api/auth/get-session',
        { timeoutMs: 5_000, skipUnauthorizedHook: true },
      );

      if (!data?.user) {
        return null;
      }

      return mapUserToProfile(data.user);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        await persistMobileToken(null);
        return null;
      }
      throw err;
    }
  },

  async signIn(
    email: string,
    password: string,
  ): Promise<{ profile: Profile | null; error: string | null }> {
    try {
      const data = await apiClient.post<BetterAuthSessionResponse>(
        '/api/auth/sign-in/email',
        {
          email: email.trim().toLowerCase(),
          password,
        },
        { skipUnauthorizedHook: true },
      );

      const token = data?.token ?? data?.session?.token;
      if (token) {
        await persistMobileToken(token);
      }

      if (data?.user) {
        return { profile: mapUserToProfile(data.user), error: null };
      }

      const profile = await this.getCurrentProfile();
      if (!profile) {
        return { profile: null, error: 'Falha ao carregar sessão do usuário.' };
      }
      return { profile, error: null };
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Credenciais inválidas.';
      return { profile: null, error: message };
    }
  },

  async signUp(
    name: string,
    email: string,
    password: string,
  ): Promise<{ profile: Profile | null; error: string | null }> {
    try {
      const data = await apiClient.post<BetterAuthSessionResponse>(
        '/api/auth/sign-up/email',
        {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
        },
        { skipUnauthorizedHook: true },
      );

      const token = data?.token ?? data?.session?.token;
      if (token) {
        await persistMobileToken(token);
      }

      if (data?.user) {
        return { profile: mapUserToProfile(data.user), error: null };
      }

      const profile = await this.getCurrentProfile();
      return { profile, error: profile ? null : 'Falha ao criar conta.' };
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Não foi possível concluir o cadastro.';
      return { profile: null, error: message };
    }
  },

  async signInWithProvider(
    provider: 'google' | 'microsoft',
  ): Promise<{ profile: Profile | null; error: string | null }> {
    try {
      const baseUrl = await getApiBaseUrl();

      if (Platform.OS === 'web') {
        const callbackURL =
          typeof window !== 'undefined' ? window.location.origin : '/';
        const data = await apiClient.post<{ url?: string }>(
          '/api/auth/sign-in/social',
          { provider, callbackURL },
          { skipUnauthorizedHook: true },
        );
        if (data?.url && typeof window !== 'undefined') {
          window.location.assign(data.url);
        }
        return { profile: null, error: null };
      }

      const redirectUri = Linking.createURL('auth-callback');
      const startUrl = `${baseUrl}/api/v1/auth/mobile/start?provider=${encodeURIComponent(
        provider,
      )}&redirect_uri=${encodeURIComponent(redirectUri)}`;

      const result = await WebBrowser.openAuthSessionAsync(startUrl, redirectUri);
      if (result.type !== 'success' || !result.url) {
        return { profile: null, error: 'Autenticação cancelada pelo usuário.' };
      }

      const parsed = Linking.parse(result.url);
      const codeParam = parsed.queryParams?.code;
      const code = Array.isArray(codeParam) ? codeParam[0] : codeParam;

      if (!code || typeof code !== 'string') {
        return { profile: null, error: 'Código de autenticação não recebido.' };
      }

      const exchange = await apiClient.post<MobileExchangeResponse>(
        '/api/v1/auth/mobile/exchange',
        { code, redirect_uri: redirectUri },
        { skipUnauthorizedHook: true },
      );

      if (!exchange?.token || !exchange?.user) {
        return { profile: null, error: 'Falha ao trocar código de autenticação.' };
      }

      await persistMobileToken(exchange.token);
      return { profile: mapUserToProfile(exchange.user), error: null };
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Erro ao autenticar com provedor externo.';
      return { profile: null, error: message };
    }
  },

  async signOut(): Promise<void> {
    try {
      await apiClient.post('/api/auth/sign-out', {}, { skipUnauthorizedHook: true });
    } catch {
      // Ignore network errors during sign out; always clear local token
    } finally {
      await persistMobileToken(null);
    }
  },
};
