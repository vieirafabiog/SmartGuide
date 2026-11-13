// ==============================================================================
// Serviço de Autenticação (Auth Service)
// Centraliza todas as operações de login, logout e sessão via Supabase Auth
// ==============================================================================

import { supabase } from './supabase';
import { Profile } from '../types/database';

export const authService = {
  // Retorna o perfil do usuário atualmente autenticado
  async getCurrentProfile(): Promise<Profile | null> {
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData?.session?.user) {
        return null;
      }

      const userId = sessionData.session.user.id;
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, company_id, email, name, avatar_url, role, is_active')
        .eq('id', userId)
        .single();

      if (profileError || !profile) {
        return {
          id: userId,
          email: sessionData.session.user.email || '',
          name: sessionData.session.user.user_metadata?.name || 'Usuário',
          role: sessionData.session.user.user_metadata?.role || 'user',
          company_id: null,
          is_active: true,
        };
      }

      return profile as Profile;
    } catch (error) {
      console.error('Erro ao buscar perfil atual:', error);
      return null;
    }
  },

  // Realiza login com email e senha
  async signIn(email: string, password: string): Promise<{ profile: Profile | null; error: string | null }> {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error || !data.user) {
        return { profile: null, error: error?.message || 'Falha ao autenticar usuário.' };
      }

      // Busca o perfil na tabela profiles
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, company_id, email, name, avatar_url, role, is_active')
        .eq('id', data.user.id)
        .single();

      const resolvedProfile: Profile = profile || {
        id: data.user.id,
        email: data.user.email || email,
        name: data.user.user_metadata?.name || 'Usuário',
        role: data.user.user_metadata?.role || 'user',
        company_id: null,
        is_active: true,
      };

      return { profile: resolvedProfile, error: null };
    } catch (err: any) {
      return { profile: null, error: err.message || 'Erro inesperado ao realizar login.' };
    }
  },

  // Finaliza a sessão do usuário
  async signOut(): Promise<void> {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Erro ao sair:', error);
    }
  },

  // Envia email de redefinição de senha
  async resetPassword(email: string): Promise<{ success: boolean; error: string | null }> {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro ao enviar email.' };
    }
  },
};
