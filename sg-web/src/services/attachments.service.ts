// ==============================================================================
// Serviço de Anexos das Etapas (Attachments Service)
// Gerencia a gravação e consulta de mídias anexadas às etapas do treinamento via Supabase
// ==============================================================================

import { supabase } from './supabase';
import { StepAttachment } from '../types/database';
import { storageService } from './storage.service';

export const attachmentsService = {
  // Lista anexos de uma etapa
  async getAttachmentsByStepId(stepId: string): Promise<StepAttachment[]> {
    try {
      const { data, error } = await supabase
        .from('step_attachments')
        .select('id, step_id, file_name, file_url, file_type, file_size')
        .eq('step_id', stepId)
        .order('att_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });

      if (error) throw error;
      return (data as StepAttachment[]) || [];
    } catch (error) {
      console.error('Erro ao buscar anexos da etapa:', error);
      return [];
    }
  },

  // Insere um anexo no banco de dados após o upload para o Storage
  async createAttachment(
    stepId: string,
    fileData: Omit<StepAttachment, 'id' | 'created_at'>
  ): Promise<{ attachment: StepAttachment | null; error: string | null }> {
    try {
      const { data, error } = await supabase
        .from('step_attachments')
        .insert({
          step_id: stepId,
          file_name: fileData.file_name,
          file_url: fileData.file_url,
          file_type: fileData.file_type,
          file_size: fileData.file_size,
        })
        .select('id, step_id, file_name, file_url, file_type, file_size')
        .single();

      if (error) return { attachment: null, error: error.message };
      return { attachment: data as StepAttachment, error: null };
    } catch (err: any) {
      return { attachment: null, error: err.message || 'Erro ao salvar anexo.' };
    }
  },

  // Exclui um anexo do banco e do Storage físico
  async deleteAttachment(id: string, stepId: string): Promise<{ success: boolean; error: string | null }> {
    try {
      // 1. Busca a URL do arquivo antes de excluir
      const { data: attData } = await supabase
        .from('step_attachments')
        .select('file_url')
        .eq('id', id)
        .single();

      // 2. Remove do banco de dados
      const { error } = await supabase.from('step_attachments').delete().eq('id', id);
      if (error) return { success: false, error: error.message };

      // 3. Remove o arquivo físico correspondente no Storage
      if (attData?.file_url) {
        await storageService.deleteFile('step-attachments', attData.file_url);
      }

      return { success: true, error: null };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro ao excluir anexo.' };
    }
  },

  // Reordena anexos de uma etapa
  async reorderAttachments(stepId: string, attachments: StepAttachment[]): Promise<boolean> {
    try {
      const updates = attachments.map((att, index) =>
        supabase
          .from('step_attachments')
          .update({ att_order: index + 1 })
          .eq('id', att.id)
      );

      await Promise.all(updates);
      return true;
    } catch (err) {
      console.error('Erro ao salvar nova ordem das mídias:', err);
      return false;
    }
  },
};
