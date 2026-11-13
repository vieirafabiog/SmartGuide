// ==============================================================================
// Tipos de Autenticação (Auth Types)
// ==============================================================================

import { Profile } from './database';

// Estado do contexto de autenticação
export interface AuthState {
  user: Profile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

// Resposta das ações de autenticação
export interface AuthResponse {
  success: boolean;
  error?: string;
}
