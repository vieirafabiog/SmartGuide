// ==============================================================================
// Serviço de Treinamentos (Trainings Service)
// Centraliza listagem, busca com filtros, paginação e CRUD de treinamentos via Supabase
// ==============================================================================

import { supabase } from './supabase';
import { Training, TrainingStatus } from '../types/database';
import { APP_CONFIG } from '../constants/app';
import { storageService } from './storage.service';

export interface TrainingFilterOptions {
  companyId?: string | null;
  userId?: string | null;
  categoryId?: string | null;
  search?: string;
  status?: TrainingStatus;
  onlyMyTrainings?: boolean;
  page?: number;
  pageSize?: number;
}

export const trainingsService = {
  // Lista treinamentos com paginação e filtros
  async getTrainings(options: TrainingFilterOptions = {}): Promise<{ trainings: Training[]; total: number }> {
    const page = options.page || 1;
    const pageSize = options.pageSize || APP_CONFIG.pagination.trainingsPerPage;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    try {
      let query = supabase
        .from('trainings')
        .select(
          `
          id,
          company_id,
          title,
          cover_url,
          status,
          is_public,
          created_by,
          created_at,
          updated_at,
          training_categories (
            category:categories (id, name, color)
          ),
          training_steps (id)
        `,
          { count: 'exact' }
        );

      if (options.companyId) {
        query = query.eq('company_id', options.companyId);
      }

      // Filtro por Categoria via tabela associativa training_categories
      if (options.categoryId) {
        const { data: catAssocs, error: catError } = await supabase
          .from('training_categories')
          .select('training_id')
          .eq('category_id', options.categoryId);

        if (catError) {
          console.error('Erro ao filtrar por categoria:', catError);
        } else {
          const trainingIds = (catAssocs || []).map((ca: any) => ca.training_id);
          if (trainingIds.length === 0) {
            return { trainings: [], total: 0 };
          }
          query = query.in('id', trainingIds);
        }
      }

      if (options.onlyMyTrainings && options.userId) {
        query = query.eq('created_by', options.userId);
        if (options.status) {
          query = query.eq('status', options.status);
        }
      } else if (options.status) {
        query = query.eq('status', options.status);
      } else {
        query = query.eq('status', 'published');
      }

      if (options.search && options.search.trim() !== '') {
        query = query.ilike('title', `%${options.search.trim()}%`);
      }

      const { data, count, error } = await query
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) {
        console.error('Erro ao buscar treinamentos:', error);
        return { trainings: [], total: 0 };
      }

      // Mapeia e formata os dados retornados
      const mappedTrainings: Training[] = (data || []).map((item: any) => ({
        id: item.id,
        company_id: item.company_id,
        title: item.title,
        description: item.description || '',
        cover_url: item.cover_url,
        status: item.status,
        is_public: item.is_public,
        created_by: item.created_by,
        created_at: item.created_at,
        updated_at: item.updated_at,
        total_steps: item.training_steps?.length || 0,
        user_progress: 0,
        categories: (item.training_categories || [])
          .map((tc: any) => tc.category)
          .filter(Boolean),
      }));

      // Calcula o progresso real do usuário autenticado para cada treinamento
      if (options.userId && mappedTrainings.length > 0) {
        const trainingIds = mappedTrainings.map((t) => t.id);
        const { data: progressList } = await supabase
          .from('training_progress')
          .select('training_id, completed')
          .eq('user_id', options.userId)
          .eq('completed', true)
          .in('training_id', trainingIds);

        const progressCountMap: Record<string, number> = {};
        (progressList || []).forEach((row: any) => {
          progressCountMap[row.training_id] = (progressCountMap[row.training_id] || 0) + 1;
        });

        mappedTrainings.forEach((t) => {
          const completedSteps = progressCountMap[t.id] || 0;
          t.user_progress =
            (t.total_steps || 0) > 0
              ? Math.min(100, Math.round((completedSteps / (t.total_steps || 1)) * 100))
              : 0;
        });
      }

      return { trainings: mappedTrainings, total: count || 0 };
    } catch (error) {
      console.error('Erro inesperado em getTrainings:', error);
      return { trainings: [], total: 0 };
    }
  },

  // Retorna um treinamento detalhado por ID
  async getTrainingById(id: string, userId?: string): Promise<Training | null> {
    try {
      const { data, error } = await supabase
        .from('trainings')
        .select(`
          id,
          company_id,
          title,
          description,
          cover_url,
          status,
          is_public,
          created_by,
          created_at,
          updated_at,
          training_categories (
            category:categories (id, name, color, icon)
          ),
          training_steps (id)
        `)
        .eq('id', id)
        .single();

      if (error || !data) {
        return null;
      }

      let userProgress = 0;
      const totalSteps = data.training_steps?.length || 0;

      if (userId && data.id) {
        const { data: progList } = await supabase
          .from('training_progress')
          .select('id')
          .eq('user_id', userId)
          .eq('training_id', data.id)
          .eq('completed', true);

        const completedCount = progList?.length || 0;
        userProgress = totalSteps > 0 ? Math.min(100, Math.round((completedCount / totalSteps) * 100)) : 0;
      }

      return {
        ...data,
        total_steps: totalSteps,
        user_progress: userProgress,
        categories: (data.training_categories || []).map((tc: any) => tc.category).filter(Boolean),
      } as Training;
    } catch (error) {
      console.error('Erro ao buscar treinamento por id:', error);
      return null;
    }
  },

  // Cria um novo treinamento
  async createTraining(
    trainingData: Partial<Training>,
    categoryIds: string[] = []
  ): Promise<{ training: Training | null; error: string | null }> {
    try {
      const { data, error } = await supabase
        .from('trainings')
        .insert({
          company_id: trainingData.company_id,
          title: trainingData.title,
          description: trainingData.description,
          cover_url: trainingData.cover_url,
          status: trainingData.status || 'draft',
          is_public: trainingData.is_public ?? false,
          created_by: trainingData.created_by,
        })
        .select('id, company_id, title, status, is_public, created_by, created_at, updated_at')
        .single();

      if (error || !data) {
        return { training: null, error: error?.message || 'Erro ao criar treinamento' };
      }

      // Se houver categorias associadas, cria as associações
      if (categoryIds.length > 0) {
        const associations = categoryIds.map((catId) => ({
          training_id: data.id,
          category_id: catId,
        }));
        await supabase.from('training_categories').insert(associations);
      }

      return { training: data as Training, error: null };
    } catch (err: any) {
      return { training: null, error: err.message || 'Erro inesperado ao criar treinamento' };
    }
  },

  // Atualiza um treinamento existente
  async updateTraining(
    id: string,
    updates: Partial<Training>,
    categoryIds?: string[]
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      const updatePayload: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };
      if (updates.title !== undefined) updatePayload.title = updates.title;
      if (updates.description !== undefined) updatePayload.description = updates.description;
      if (updates.cover_url !== undefined) updatePayload.cover_url = updates.cover_url;
      if (updates.status !== undefined) updatePayload.status = updates.status;
      if (updates.is_public !== undefined) updatePayload.is_public = updates.is_public;

      const { error } = await supabase
        .from('trainings')
        .update(updatePayload)
        .eq('id', id);

      if (error) {
        return { success: false, error: error.message };
      }

      // Atualiza categorias se fornecidas
      if (categoryIds) {
        await supabase.from('training_categories').delete().eq('training_id', id);
        if (categoryIds.length > 0) {
          const associations = categoryIds.map((catId) => ({
            training_id: id,
            category_id: catId,
          }));
          await supabase.from('training_categories').insert(associations);
        }
      }

      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro ao atualizar treinamento' };
    }
  },

  // Exclui um treinamento e todas as suas mídias físicas no Storage
  async deleteTraining(id: string): Promise<{ success: boolean; error: string | null }> {
    try {
      // 1. Busca a capa do treinamento
      const { data: trainingData } = await supabase
        .from('trainings')
        .select('cover_url')
        .eq('id', id)
        .single();

      // 2. Busca todos os anexos de todas as etapas do treinamento
      const { data: stepsWithAtts } = await supabase
        .from('training_steps')
        .select('id, step_attachments (file_url)')
        .eq('training_id', id);

      const mediaUrls: string[] = [];
      (stepsWithAtts || []).forEach((st: any) => {
        (st.step_attachments || []).forEach((att: any) => {
          if (att.file_url) mediaUrls.push(att.file_url);
        });
      });

      // 3. Remove os arquivos físicos do Storage
      if (mediaUrls.length > 0) {
        await storageService.deleteFiles('step-attachments', mediaUrls);
      }
      if (trainingData?.cover_url) {
        await storageService.deleteFile('training-covers', trainingData.cover_url);
      }

      // 4. Remove o treinamento do banco (tabelas filhas sofrem CASCADE)
      const { error } = await supabase.from('trainings').delete().eq('id', id);
      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro ao deletar treinamento' };
    }
  },
};
