// ==============================================================================
// Serviço de Compartilhamento de Treinamentos (Sharing Service)
// Gerencia permissões de acesso: proprietário, editor e visualizador via Supabase
// ==============================================================================

import { supabase } from './supabase';
import { TrainingPermission, PermissionLevel, Profile } from '../types/database';

export const sharingService = {
  // Lista permissões de um treinamento
  async getTrainingPermissions(trainingId: string): Promise<TrainingPermission[]> {
    try {
      // 1. Busca as permissões do treinamento
      const { data: perms, error } = await supabase
        .from('training_permissions')
        .select('id, training_id, user_id, permission')
        .eq('training_id', trainingId)
        .order('permission');

      if (error) throw error;
      if (!perms || perms.length === 0) return [];

      // 2. Busca os perfis dos usuários para enriquecer os dados sem depender de cache de relacionamento do PostgREST
      const userIds = perms.map((p) => p.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name, email')
        .in('id', userIds);

      const profileMap = new Map((profiles || []).map((pr) => [pr.id, pr]));

      return perms.map((p) => ({
        ...p,
        user: profileMap.get(p.user_id) || { name: 'Colaborador', email: '' },
      })) as TrainingPermission[];
    } catch (error) {
      console.error('Erro ao buscar permissões do treinamento:', error);
      return [];
    }
  },

  // Verifica a permissão de um usuário em um treinamento
  async getUserPermission(trainingId: string, userId: string): Promise<PermissionLevel | null> {
    try {
      const { data, error } = await supabase
        .from('training_permissions')
        .select('permission')
        .eq('training_id', trainingId)
        .eq('user_id', userId)
        .single();

      if (error || !data) return null;
      return (data as TrainingPermission).permission;
    } catch {
      return null;
    }
  },

  // Busca colaboradores da empresa por nome ou email (para autocomplete com delayOutput)
  async searchCompanyUsers(
    companyId: string,
    query: string
  ): Promise<Profile[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    try {
      let req = supabase
        .from('profiles')
        .select('id, name, email, avatar_url, role')
        .eq('is_active', true);

      if (companyId) {
        req = req.eq('company_id', companyId);
      }

      req = req.or(`name.ilike.%${q}%,email.ilike.%${q}%`).limit(8);

      const { data, error } = await req;
      if (error) throw error;
      return (data as Profile[]) || [];
    } catch (error) {
      console.error('Erro ao buscar colaboradores da empresa:', error);
      return [];
    }
  },

  // Compartilha um treinamento com um usuário pelo email ou perfil selecionado
  async shareWithUser(
    trainingId: string,
    target: string | { id: string; email: string; name: string },
    permission: PermissionLevel,
    companyId: string
  ): Promise<{ perm: TrainingPermission | null; error: string | null }> {
    const isObject = typeof target !== 'string';
    const email = isObject ? target.email : target;
    const targetUserId = isObject ? target.id : undefined;

    try {
      let finalUserId = targetUserId;
      let finalUserName = isObject ? target.name : '';
      let finalUserEmail = email;

      // Se não passou o ID direto, busca o usuário pelo email
      if (!finalUserId) {
        let profileReq = supabase
          .from('profiles')
          .select('id, name, email')
          .eq('email', email.trim().toLowerCase());

        if (companyId) {
          profileReq = profileReq.eq('company_id', companyId);
        }

        const { data: profileData, error: profileErr } = await profileReq.single();

        if (profileErr || !profileData) {
          return { perm: null, error: 'Usuário não encontrado nesta empresa.' };
        }

        finalUserId = profileData.id;
        finalUserName = profileData.name;
        finalUserEmail = profileData.email;
      }

      // Upsert da permissão (cria ou atualiza)
      const { data, error } = await supabase
        .from('training_permissions')
        .upsert(
          {
            training_id: trainingId,
            user_id: finalUserId,
            permission,
          },
          { onConflict: 'training_id,user_id' }
        )
        .select('id, training_id, user_id, permission')
        .single();

      if (error) return { perm: null, error: error.message };

      return {
        perm: {
          ...data,
          user: { name: finalUserName, email: finalUserEmail },
        } as TrainingPermission,
        error: null,
      };
    } catch (err: any) {
      return { perm: null, error: err.message || 'Erro ao compartilhar treinamento.' };
    }
  },

  // Remove uma permissão específica de um treinamento
  async removePermission(
    permId: string
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      const { error } = await supabase
        .from('training_permissions')
        .delete()
        .eq('id', permId);

      if (error) return { success: false, error: error.message };
      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro ao remover permissão.' };
    }
  },
};
