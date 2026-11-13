// ==============================================================================
// Contexto de Autenticação (AuthContext)
// Fornece o estado do usuário logado para todas as telas do aplicativo
// ==============================================================================

import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Profile } from '../types/database';
import { authService } from '../services/auth.service';

interface AuthContextData {
  user: Profile | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextData>({} as AuthContextData);
const CACHED_PROFILE_KEY = '@smartguide_cached_profile';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Carrega o usuário logado ao iniciar o app (com suporte offline imediato)
  const loadUser = async () => {
    try {
      // 1. Tenta carregar do cache local imediatamente para abrir o app sem esperar rede
      const cached = await AsyncStorage.getItem(CACHED_PROFILE_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed && parsed.id) {
            setUser(parsed);
            setIsLoading(false);
          }
        } catch {}
      }

      // Se comprovadamente sem conexão, encerra imediatamente sem travar
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setIsLoading(false);
        return;
      }

      // 2. Busca dados atualizados no Supabase (com timeout de 2.5s para não travar quando offline)
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), 2500)
      );
      const profilePromise = authService.getCurrentProfile();
      const profile = await Promise.race([profilePromise, timeoutPromise]);

      if (profile) {
        setUser(profile);
        await AsyncStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(profile));
      }
    } catch (error) {
      console.warn('[AuthContext] Modo offline ativo ou erro ao buscar perfil online:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUser();
  }, []);

  // Função de login
  const signIn = async (email: string, password: string) => {
    const { profile, error } = await authService.signIn(email, password);
    if (error || !profile) {
      return { success: false, error: error || 'Erro ao realizar login.' };
    }
    setUser(profile);
    await AsyncStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(profile));
    return { success: true };
  };

  // Função de logout
  const signOut = async () => {
    await authService.signOut();
    await AsyncStorage.removeItem(CACHED_PROFILE_KEY);
    setUser(null);
  };

  // Atualizar dados do perfil em memória
  const refreshProfile = async () => {
    const profile = await authService.getCurrentProfile();
    if (profile) {
      setUser(profile);
      await AsyncStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(profile));
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// Hook personalizado para usar a autenticação de forma simples
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um AuthProvider');
  }
  return context;
}
