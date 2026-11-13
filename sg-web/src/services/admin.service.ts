// ==============================================================================
// Serviço de Administração Completo (Admin Service)
// Métricas, Gestão de Empresas (SaaS) e Usuários via Supabase
// ==============================================================================

import { supabase } from './supabase';
import { Company, Profile, UserRole, ApiKey } from '../types/database';

export interface CompanyDashboardStats {
  totalTrainings: number;
  publishedTrainings: number;
  draftTrainings: number;
  totalCategories: number;
  totalEmployees: number;
}

export interface CompanyWithStats extends Company {
  trainings_count: number;
  employees_count: number;
}

export interface PaginatedCompaniesResult {
  companies: CompanyWithStats[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const adminService = {
  // Retorna estatísticas da empresa para o dashboard do Admin de Empresa
  async getCompanyStats(companyId?: string | null): Promise<CompanyDashboardStats> {
    if (!companyId) {
      return {
        totalTrainings: 0,
        publishedTrainings: 0,
        draftTrainings: 0,
        totalCategories: 0,
        totalEmployees: 0,
      };
    }

    try {
      const [trainingsRes, categoriesRes, profilesRes] = await Promise.all([
        supabase.from('trainings').select('status', { count: 'exact' }).eq('company_id', companyId),
        supabase.from('categories').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      ]);

      const trainings = trainingsRes.data || [];
      const published = trainings.filter((t) => t.status === 'published').length;
      const draft = trainings.filter((t) => t.status === 'draft').length;

      return {
        totalTrainings: trainingsRes.count || 0,
        publishedTrainings: published,
        draftTrainings: draft,
        totalCategories: categoriesRes.count || 0,
        totalEmployees: profilesRes.count || 0,
      };
    } catch (error) {
      console.error('Erro ao obter estatísticas da empresa:', error);
      return {
        totalTrainings: 0,
        publishedTrainings: 0,
        draftTrainings: 0,
        totalCategories: 0,
        totalEmployees: 0,
      };
    }
  },

  // Retorna lista detalhada de empresas cadastradas com suporte a paginação e busca (Super Admin)
  async getCompaniesWithStats(
    page: number = 1,
    pageSize: number = 10,
    search: string = ''
  ): Promise<PaginatedCompaniesResult> {
    try {
      let query = supabase
        .from('companies')
        .select(
          `
          id,
          name,
          slug,
          logo_url,
          is_active,
          created_at,
          trainings (id),
          profiles (id)
        `,
          { count: 'exact' }
        );

      if (search && search.trim()) {
        query = query.ilike('name', `%${search.trim()}%`);
      }

      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data: companies, count, error } = await query
        .order('name')
        .range(from, to);

      if (error) throw error;

      const total = count || 0;
      const totalPages = Math.ceil(total / pageSize) || 1;

      const mapped: CompanyWithStats[] = (companies || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        logo_url: c.logo_url,
        is_active: c.is_active,
        created_at: c.created_at,
        updated_at: c.updated_at,
        trainings_count: c.trainings?.length || 0,
        employees_count: c.profiles?.length || 0,
      }));

      return {
        companies: mapped,
        total,
        page,
        pageSize,
        totalPages,
      };
    } catch (error) {
      console.error('Erro ao buscar empresas com estatísticas:', error);
      return {
        companies: [],
        total: 0,
        page,
        pageSize,
        totalPages: 1,
      };
    }
  },

  // Cria uma nova empresa (Super Admin)
  async createCompany(
    name: string,
    slug: string,
    logo_url?: string | null
  ): Promise<{ company: Company | null; error: string | null }> {
    try {
      const { data, error } = await supabase
        .from('companies')
        .insert({
          name: name.trim(),
          slug: slug.trim().toLowerCase(),
          logo_url: logo_url || null,
          is_active: true,
        })
        .select('id, name, slug, logo_url, is_active, created_at')
        .single();

      if (error) return { company: null, error: error.message };
      return { company: data as Company, error: null };
    } catch (err: any) {
      return { company: null, error: err.message || 'Erro ao criar empresa.' };
    }
  },

  // Atualiza uma empresa existente (Super Admin)
  async updateCompany(
    id: string,
    updates: Partial<Company>
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      const { error } = await supabase
        .from('companies')
        .update({
          name: updates.name,
          slug: updates.slug,
          logo_url: updates.logo_url,
          is_active: updates.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) return { success: false, error: error.message };
      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro ao atualizar empresa.' };
    }
  },

  // Ativa ou desativa uma empresa (Super Admin)
  async toggleCompanyStatus(id: string, is_active: boolean): Promise<{ success: boolean; error: string | null }> {
    return await this.updateCompany(id, { is_active });
  },

  // Exclui uma empresa (Super Admin)
  async deleteCompany(id: string): Promise<{ success: boolean; error: string | null }> {
    try {
      const { error } = await supabase.from('companies').delete().eq('id', id);
      if (error) return { success: false, error: error.message };
      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro ao deletar empresa.' };
    }
  },

  // Lista usuários de uma empresa específica
  async getCompanyUsers(companyId: string): Promise<Profile[]> {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, company_id, email, name, avatar_url, role, is_active, created_at')
        .eq('company_id', companyId)
        .order('name');

      if (error) throw error;
      return (data as Profile[]) || [];
    } catch (error) {
      console.error('Erro ao buscar usuários da empresa:', error);
      return [];
    }
  },

  // Cria um novo usuário dentro de uma empresa via Edge Function admin-create-user
  async createCompanyUser(
    companyId: string,
    name: string,
    email: string,
    role: UserRole,
    password: string
  ): Promise<{ profile: Profile | null; error: string | null }> {
    try {
      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: { company_id: companyId, name, email, role, password },
      });

      if (error) return { profile: null, error: error.message };
      if (data?.error) return { profile: null, error: data.error };
      return { profile: data?.profile || null, error: null };
    } catch (err: any) {
      return { profile: null, error: err.message || 'Erro ao criar usuário.' };
    }
  },

  // Altera o papel (role) de um usuário
  async updateUserRole(
    userId: string,
    role: UserRole
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      const { error } = await supabase.from('profiles').update({ role }).eq('id', userId);
      if (error) return { success: false, error: error.message };
      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro ao alterar papel do usuário.' };
    }
  },

  // Ativa ou desativa um usuário
  async toggleUserStatus(
    userId: string,
    is_active: boolean
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      const { error } = await supabase.from('profiles').update({ is_active }).eq('id', userId);
      if (error) return { success: false, error: error.message };
      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro ao alterar status do usuário.' };
    }
  },

  // Remove um usuário da empresa (apenas desativa; não deleta o auth.users)
  async removeCompanyUser(
    userId: string
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: false, company_id: null })
        .eq('id', userId);

      if (error) return { success: false, error: error.message };
      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro ao remover usuário.' };
    }
  },

  // Exclui um colaborador definitivamente da empresa
  async deleteCompanyUser(
    userId: string
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', userId);

      if (error) return { success: false, error: error.message };
      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro ao excluir colaborador.' };
    }
  },

  // Lista todas as chaves de API cadastradas na tabela api_keys para a empresa
  async getCompanyApiKeys(companyId: string): Promise<ApiKey[]> {
    try {
      const { data, error } = await supabase
        .from('api_keys')
        .select('id, company_id, name, key, is_active, created_at, last_used_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data as ApiKey[]) || [];
    } catch (err) {
      console.warn('Tabela api_keys não encontrada ou erro na consulta:', err);
      const fallbackKey = await this.getCompanyApiKey(companyId);
      if (fallbackKey) {
        return [
          {
            id: 'legacy-key',
            company_id: companyId,
            name: 'Chave Padrão',
            key: fallbackKey,
            is_active: true,
            created_at: new Date().toISOString(),
          },
        ];
      }
      return [];
    }
  },

  // Obtém a Chave de API ativa da empresa
  async getCompanyApiKey(companyId: string): Promise<string | null> {
    if (!companyId) return null;

    try {
      // 1. Tenta buscar da tabela dedicada api_keys usando maybeSingle
      const { data: keyRecord, error: keyErr } = await supabase
        .from('api_keys')
        .select('key')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!keyErr && keyRecord?.key) return keyRecord.key;

      // 2. Fallback para companies.api_key usando maybeSingle
      const { data: comp, error: compErr } = await supabase
        .from('companies')
        .select('api_key')
        .eq('id', companyId)
        .maybeSingle();

      if (!compErr && comp?.api_key) return comp.api_key;

      return null;
    } catch {
      return null;
    }
  },

  // Gera e insere uma nova Chave de API na tabela api_keys
  async generateApiKey(
    companyId: string,
    keyName: string = 'Chave Principal',
    userId?: string | null
  ): Promise<{ apiKey: ApiKey | null; error: string | null }> {
    const randomHex = Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
    const newKeyValue = `sg_live_${randomHex}`;

    try {
      // 1. Insere na tabela dedicada public.api_keys
      const { data, error } = await supabase
        .from('api_keys')
        .insert({
          company_id: companyId,
          name: keyName,
          key: newKeyValue,
          is_active: true,
          created_by: userId || null,
        })
        .select('id, company_id, name, key, is_active, created_at, last_used_at')
        .single();

      // 2. Atualiza companies.api_key para compatibilidade (melhor esforço, ignora erros)
      try {
        await supabase
          .from('companies')
          .update({ api_key: newKeyValue })
          .eq('id', companyId);
      } catch {
        // Ignora erro — companies pode não ter a coluna api_key
      }

      if (error) {
        // Fallback: se a tabela api_keys ainda não foi migrada, salva direto na tabela companies
        await supabase.from('companies').update({ api_key: newKeyValue }).eq('id', companyId);
        return {
          apiKey: {
            id: `legacy-${Date.now()}`,
            company_id: companyId,
            name: keyName,
            key: newKeyValue,
            is_active: true,
            created_at: new Date().toISOString(),
          },
          error: null,
        };
      }

      return { apiKey: data as ApiKey, error: null };
    } catch (err: any) {
      return { apiKey: null, error: err.message || 'Erro ao gerar chave de API.' };
    }
  },

  // Revoga / exclui uma chave de API da tabela api_keys
  async revokeApiKey(keyId: string): Promise<{ success: boolean; error: string | null }> {
    try {
      const { error } = await supabase.from('api_keys').delete().eq('id', keyId);
      if (error) return { success: false, error: error.message };
      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro ao revogar chave.' };
    }
  },
};
