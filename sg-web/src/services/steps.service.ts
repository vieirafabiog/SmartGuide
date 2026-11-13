// ==============================================================================
// Serviço de Etapas do Treinamento (Steps Service)
// Gerencia a criação, edição, ordenação e exclusão de etapas via Supabase
// ==============================================================================

import { supabase } from './supabase';
import { TrainingStep } from '../types/database';
import { storageService } from './storage.service';

export const stepsService = {
  // Lista todas as etapas de um treinamento em ordem
  async getStepsByTrainingId(trainingId: string): Promise<TrainingStep[]> {
    try {
      const { data, error } = await supabase
        .from('training_steps')
        .select(`
          id,
          training_id,
          title,
          content,
          step_order,
          attachments:step_attachments (
            id,
            step_id,
            file_name,
            file_url,
            file_type,
            file_size
          )
        `)
        .eq('training_id', trainingId)
        .order('step_order', { ascending: true });

      if (error) {
        console.error('Erro ao buscar etapas:', error);
        return [];
      }

      return (data as TrainingStep[]) || [];
    } catch (error) {
      console.error('Erro inesperado em getStepsByTrainingId:', error);
      return [];
    }
  },

  // Cria uma nova etapa
  async createStep(
    stepData: Partial<TrainingStep>
  ): Promise<{ step: TrainingStep | null; error: string | null }> {
    try {
      const { data, error } = await supabase
        .from('training_steps')
        .insert({
          training_id: stepData.training_id,
          title: stepData.title,
          content: stepData.content,
          step_order: stepData.step_order || 1,
        })
        .select('id, training_id, title, content, step_order')
        .single();

      if (error) {
        return { step: null, error: error.message };
      }

      return { step: data as TrainingStep, error: null };
    } catch (err: any) {
      return { step: null, error: err.message || 'Erro ao criar etapa.' };
    }
  },

  // Atualiza uma etapa existente
  async updateStep(
    id: string,
    updates: Partial<TrainingStep>
  ): Promise<{ success: boolean; error: string | null }> {
    try {
      const { error } = await supabase
        .from('training_steps')
        .update({
          title: updates.title,
          content: updates.content,
          step_order: updates.step_order,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro ao atualizar etapa.' };
    }
  },

  // Exclui uma etapa e todos os seus arquivos físicos no Storage
  async deleteStep(id: string, trainingId: string): Promise<{ success: boolean; error: string | null }> {
    try {
      // 1. Busca todos os anexos vinculados a esta etapa para remover do Storage
      const { data: attachments } = await supabase
        .from('step_attachments')
        .select('file_url')
        .eq('step_id', id);

      if (attachments && attachments.length > 0) {
        const urls = attachments.map((a) => a.file_url);
        await storageService.deleteFiles('step-attachments', urls);
      }

      // 2. Remove a etapa do banco
      const { error } = await supabase.from('training_steps').delete().eq('id', id);
      if (error) {
        return { success: false, error: error.message };
      }

      // 3. Reorganiza a ordem das etapas restantes
      const remainingSteps = await this.getStepsByTrainingId(trainingId);
      for (let i = 0; i < remainingSteps.length; i++) {
        if (remainingSteps[i].step_order !== i + 1) {
          await supabase
            .from('training_steps')
            .update({ step_order: i + 1 })
            .eq('id', remainingSteps[i].id);
        }
      }

      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro ao excluir etapa.' };
    }
  },
};
