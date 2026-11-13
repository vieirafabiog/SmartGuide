// ==============================================================================
// Serviço de Categorias (Categories Service)
// Gerenciamento de categorias exclusivas de cada empresa
// ==============================================================================

import { supabase } from './supabase';
import { Category } from '../types/database';

export const categoriesService = {
  // Lista todas as categorias da empresa do usuário
  async getCategories(companyId?: string | null): Promise<Category[]> {
    if (!companyId) {
      return [];
    }

    try {
      const { data, error } = await supabase
        .from('categories')
        .select('id, company_id, name, color, icon')
        .eq('company_id', companyId)
        .order('name', { ascending: true });

      if (error) {
        console.error('Erro ao buscar categorias:', error);
        return [];
      }

      return (data as Category[]) || [];
    } catch (error) {
      console.error('Erro inesperado ao buscar categorias:', error);
      return [];
    }
  },

  // Cria uma nova categoria para a empresa (Admin da empresa)
  async createCategory(
    companyId: string,
    name: string,
    color: string = '#F39C12',
    icon: string = 'folder'
  ): Promise<{ category: Category | null; error: string | null }> {
    try {
      const { data, error } = await supabase
        .from('categories')
        .insert({
          company_id: companyId,
          name: name.trim(),
          color,
          icon,
        })
        .select('id, company_id, name, color, icon')
        .single();

      if (error) {
        return { category: null, error: error.message };
      }

      return { category: data as Category, error: null };
    } catch (err: any) {
      return { category: null, error: err.message || 'Erro ao criar categoria.' };
    }
  },

  // Exclui uma categoria da empresa
  async deleteCategory(id: string): Promise<{ success: boolean; error: string | null }> {
    try {
      const { error } = await supabase.from('categories').delete().eq('id', id);
      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro ao excluir categoria.' };
    }
  },
};
