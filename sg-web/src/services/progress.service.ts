// ==============================================================================
// Serviço de Progresso (Progress Service)
// Rastreamento de conclusão de etapas pelos colaboradores via Supabase
// ==============================================================================

import { supabase } from './supabase';

export const progressService = {
  // Retorna os IDs das etapas concluídas pelo usuário no treinamento
  async getCompletedStepIds(userId: string, trainingId: string): Promise<string[]> {
    try {
      const { data, error } = await supabase
        .from('training_progress')
        .select('step_id')
        .eq('user_id', userId)
        .eq('training_id', trainingId)
        .eq('completed', true);

      if (error) {
        console.error('Erro ao buscar progresso:', error);
        return [];
      }

      return (data || []).map((row) => row.step_id);
    } catch (error) {
      console.error('Erro inesperado ao buscar progresso:', error);
      return [];
    }
  },

  // Marca ou desmarca uma etapa como concluída
  async toggleStepProgress(
    userId: string,
    trainingId: string,
    stepId: string,
    completed: boolean
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      const { error } = await supabase
        .from('training_progress')
        .upsert(
          {
            user_id: userId,
            training_id: trainingId,
            step_id: stepId,
            completed,
            completed_at: completed ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,step_id' }
        );

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro ao registrar progresso.' };
    }
  },
};
