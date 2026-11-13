import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { syncLocaleFromProfile } from '@/i18n';
import { checkMobileLicenseAccess } from '@/licensing/licenseGate';
import { setUnauthorizedHandler } from '@/services/apiClient';
import { authService } from '@/services/auth.service';
import {
  clearServerConfig,
  discoverInstanceInfo,
  getApiBaseUrl,
  getSavedInstanceInfo,
} from '@/services/serverConfig.service';
import type { InstanceInfo, Profile } from '@/types/database';

interface AuthResult {
  success: boolean;
  error?: string;
}

interface AuthContextData {
  user: Profile | null;
  instanceInfo: InstanceInfo | null;
  serverUrl: string;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (name: string, email: string, password: string) => Promise<AuthResult>;
  signInWithProvider: (provider: 'google' | 'microsoft') => Promise<AuthResult>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshInstanceInfo: () => Promise<InstanceInfo | null>;
  disconnectServer: () => Promise<void>;
}

const AuthContext = createContext<AuthContextData>({} as AuthContextData);
const CACHED_PROFILE_KEY = '@smartguide_cached_profile';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<Profile | null>(null);
  const [instanceInfo, setInstanceInfo] = useState<InstanceInfo | null>(null);
  const [serverUrl, setServerUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const signOut = useCallback(async () => {
    await authService.signOut();
    await AsyncStorage.removeItem(CACHED_PROFILE_KEY);
    setUser(null);
  }, []);

  const refreshInstanceInfo = useCallback(async (): Promise<InstanceInfo | null> => {
    const baseUrl = await getApiBaseUrl();
    setServerUrl(baseUrl);

    if (Platform.OS !== 'web' && !baseUrl) {
      setInstanceInfo(null);
      return null;
    }

    try {
      const liveInfo = await discoverInstanceInfo(baseUrl, 5_000);
      if (Platform.OS !== 'web') {
        const licenseCheck = await checkMobileLicenseAccess(liveInfo);
        if (!licenseCheck.allowed) {
          await signOut();
          setInstanceInfo(null);
          return null;
        }
      }
      setInstanceInfo(liveInfo);
      return liveInfo;
    } catch {
      const cached = await getSavedInstanceInfo();
      if (cached) {
        if (Platform.OS !== 'web') {
          const licenseCheck = await checkMobileLicenseAccess(cached);
          if (!licenseCheck.allowed) {
            await signOut();
            setInstanceInfo(null);
            return null;
          }
        }
        setInstanceInfo(cached);
        return cached;
      }
      return null;
    }
  }, [signOut]);

  const loadInitialState = useCallback(async () => {
    try {
      await authService.hydrateStoredToken();

      const cachedProfile = await AsyncStorage.getItem(CACHED_PROFILE_KEY);
      if (cachedProfile) {
        try {
          const parsed = JSON.parse(cachedProfile) as Profile;
          if (parsed?.id) {
            setUser(parsed);
            setIsLoading(false);
          }
        } catch {
          // Ignore malformed cached profile
        }
      }

      const resolvedBaseUrl = await getApiBaseUrl();
      setServerUrl(resolvedBaseUrl);

      if (Platform.OS !== 'web' && !resolvedBaseUrl) {
        setIsLoading(false);
        return;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const savedInfo = await getSavedInstanceInfo();
        if (savedInfo) setInstanceInfo(savedInfo);
        setIsLoading(false);
        return;
      }

      await refreshInstanceInfo();

      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 2_500),
      );
      const profile = await Promise.race([
        authService.getCurrentProfile(),
        timeoutPromise,
      ]);

      if (profile) {
        setUser(profile);
        await AsyncStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(profile));
        await syncLocaleFromProfile(profile.preferred_locale);
      } else if (profile === null) {
        // Explicit unauthenticated response (not timeout) clears stale cache
        const liveCheck = await authService.getCurrentProfile().catch(() => undefined);
        if (liveCheck === null) {
          await AsyncStorage.removeItem(CACHED_PROFILE_KEY);
          setUser(null);
        }
      }
    } catch {
      // Offline or unreachable server: keep cached profile if present
    } finally {
      setIsLoading(false);
    }
  }, [refreshInstanceInfo]);

  useEffect(() => {
    setUnauthorizedHandler(signOut);
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  useEffect(() => {
    void Promise.resolve().then(() => loadInitialState());
  }, [loadInitialState]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void refreshInstanceInfo();
      }
    });
    return () => subscription.remove();
  }, [refreshInstanceInfo]);

  const signIn = async (email: string, password: string): Promise<AuthResult> => {
    const { profile, error } = await authService.signIn(email, password);
    if (error || !profile) {
      return { success: false, error: error || 'Erro ao realizar login.' };
    }
    setUser(profile);
    await AsyncStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(profile));
    await syncLocaleFromProfile(profile.preferred_locale);
    return { success: true };
  };

  const signUp = async (
    name: string,
    email: string,
    password: string,
  ): Promise<AuthResult> => {
    const { profile, error } = await authService.signUp(name, email, password);
    if (error || !profile) {
      return { success: false, error: error || 'Erro ao criar conta.' };
    }
    setUser(profile);
    await AsyncStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(profile));
    await syncLocaleFromProfile(profile.preferred_locale);
    return { success: true };
  };

  const signInWithProvider = async (
    provider: 'google' | 'microsoft',
  ): Promise<AuthResult> => {
    const { profile, error } = await authService.signInWithProvider(provider);
    if (error) {
      return { success: false, error };
    }
    if (profile) {
      setUser(profile);
      await AsyncStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(profile));
      await syncLocaleFromProfile(profile.preferred_locale);
    }
    return { success: true };
  };

  const refreshProfile = async () => {
    const profile = await authService.getCurrentProfile();
    if (profile) {
      setUser(profile);
      await AsyncStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(profile));
      await syncLocaleFromProfile(profile.preferred_locale);
    }
  };

  const disconnectServer = async () => {
    await signOut();
    await clearServerConfig();
    setServerUrl('');
    setInstanceInfo(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        instanceInfo,
        serverUrl,
        isLoading,
        signIn,
        signUp,
        signInWithProvider,
        signOut,
        refreshProfile,
        refreshInstanceInfo,
        disconnectServer,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um AuthProvider');
  }
  return context;
}
