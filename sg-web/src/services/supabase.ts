// ==============================================================================
// Cliente Supabase (Supabase Client)
// Configuração de autenticação persistente com suporte a Web e Mobile
// ==============================================================================

import { Platform, AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';

// Polyfill de armazenamento local para dispositivos móveis
if (Platform.OS !== 'web') {
  try {
    require('expo-sqlite/localStorage/install');
  } catch (error) {
    console.warn('Polyfill do expo-sqlite nao pôde ser carregado:', error);
  }
}

// Carrega as variáveis de ambiente
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

// Validação da configuração do Supabase
export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl !== 'https://placeholder.supabase.co' &&
    supabaseAnonKey !== 'placeholder-anon-key'
);

// Criação do cliente oficial do Supabase
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: typeof localStorage !== 'undefined' ? localStorage : undefined,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

// Otimização: renova o token automaticamente apenas quando o app está em primeiro plano
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
